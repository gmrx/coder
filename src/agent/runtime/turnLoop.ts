import { USER_ABORT_MESSAGE } from '../../core/modelClient';
import { trimContext } from '../../core/utils';
import { checkMonotony } from '../checks';
import { parseAgentAction } from '../prompt';
import {
  buildMemorySnapshot,
  buildThinkMessage,
} from '../runnerMemory';
import {
  buildLoopExitFinalPromptContract,
} from '../tooling/catalog';
import {
  buildEnoughContextReminder,
  MAX_CONSECUTIVE_DUPES,
  shouldSendEnoughContextReminder,
  TOOL_CALL_TEMPERATURE,
} from './loopPolicy';
import { AgentSession } from './agentSession';
import { executeLoopDirective } from './executeLoopDirective';
import { resolveLoopDirective } from './loopDirectives';
import { createTurnLoopState } from './turnState';

export async function runAgentTurnLoop(session: AgentSession): Promise<string> {
  const state = createTurnLoopState();

  while (true) {
    if (session.signal?.aborted) return USER_ABORT_MESSAGE;

    state.iteration++;
    session.trace.think(
      buildThinkMessage(
        state.iteration,
        session.lastQuestion,
        session.memory,
        state.lastToolUsed,
        state.lastToolReasoning,
        { freshMcpRequired: session.requiresFreshMcpFacts() },
      ),
      {
        step: state.iteration,
        enoughContext: session.hasSufficientContext(),
        readFiles: session.memory.readFiles.size,
        topDirs: session.memory.topDirs.size,
        subagentBatches: session.memory.subagentBatches,
        lastTool: state.lastToolUsed || '',
        lastReasoning: state.lastToolReasoning || '',
      },
    );

    if (state.consecutiveDupes >= MAX_CONSECUTIVE_DUPES) {
      session.trace.loop('Зацикливание. Завершаю.');
      break;
    }

    if (state.iteration - state.lastMonotonyCheck >= 3) {
      const hint = checkMonotony(session.usedCalls, session.modelUsedTools);
      if (hint) {
        session.pushUser(hint);
        state.lastMonotonyCheck = state.iteration;
      }
    }

    if (state.iteration % 4 === 0 && session.memory.toolCalls > 0) {
      session.pushUser(buildMemorySnapshot(session.memory));
    }

    if (
      shouldSendEnoughContextReminder(
        state.iteration,
        state.enoughContextNudgeSent,
        session.lastQuestion,
        session.memory,
        { freshMcpRequired: session.requiresFreshMcpFacts() },
      )
    ) {
      state.enoughContextNudgeSent = true;
      session.pushUser(buildEnoughContextReminder(session.memory));
    }

    trimContext(session.messages);

    let response: string;
    try {
      response = await session.requestModel(session.messages, {
        temperature: TOOL_CALL_TEMPERATURE,
        step: state.iteration,
        retryPrefix: `Ошибка API на шаге ${state.iteration},`,
        retryUntilSuccess: true,
      });
    } catch (error: any) {
      const message = error?.message || String(error);
      if (String(message).startsWith(USER_ABORT_MESSAGE)) return String(message);
      return `Ошибка API: ${message}`;
    }

    const { action, actions } = parseAgentAction(response);
    const directive = resolveLoopDirective(session, state, response, action, actions);
    const execution = await executeLoopDirective(session, state, directive);
    if (execution.kind === 'return') return execution.answer;
  }

  if (session.signal?.aborted) return USER_ABORT_MESSAGE;
  return session.finalizeAnswer(
    buildLoopExitFinalPromptContract(session.lastQuestion),
    state.iteration,
  );
}
