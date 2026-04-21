import { truncate } from '../../core/utils';
import { executeToolResult } from '../executor';
import type { AgentAction } from '../prompt';
import { updateMemory } from '../runnerMemory';
import { buildVerificationWorkflowPrompt } from '../tooling/catalog';
import { collectStudiedFilesFromUsedCalls } from '../tooling/studyContext';
import {
  createToolExecutionResult,
  type ToolBatchChildResult,
  type ToolExecutionResult,
} from '../tooling/results';
import type { AgentSession } from './agentSession';
import { applyPostToolOutcome } from './postToolStateMachine';
import { clearAgentRecovery } from './recovery';
import type { TurnLoopState } from './turnState';
import { createTurnTransition } from './transitions';
import { emitAgentTransition } from './transitionDispatcher';
import type { AgentApprovalRequest } from './approvals';
import type { AgentQuestionRequest } from './questions';

type ExecuteToolStepOptions = {
  pushAssistant?: boolean;
  stepKey?: number | string;
};

export async function executeAgentToolStep(
  session: AgentSession,
  state: TurnLoopState,
  response: string,
  action: AgentAction,
  options: ExecuteToolStepOptions = {},
): Promise<ToolExecutionResult> {
  const stepKey = options.stepKey ?? state.iteration;
  const pushAssistantResponse = options.pushAssistant !== false;
  const callKey = session.buildToolCallKey(action.tool, action.args || {});
  session.usedCalls.add(callKey);
  session.modelUsedTools.add(action.tool);
  state.consecutiveDupes = 0;
  state.noActionRetryCount = 0;
  state.lastToolUsed = action.tool;
  state.lastToolReasoning = action.reasoning || null;

  session.trace.tool(
    stepKey,
    action.tool,
    action.args || {},
    action.reasoning,
  );

  if (action.tool === 'todo_write') {
    const todoUpdate = session.applyTodoWrite(action.args || {});
    const execution = createToolExecutionResult(
      'todo_write',
      'success',
      todoUpdate.content,
    );
    session.recordToolCallResult(callKey, execution);
    state.lastToolStatus = execution.status;
    clearAgentRecovery(state.recovery);
    session.trace.result(stepKey, action.tool, execution);
    if (pushAssistantResponse) session.pushAssistant(response);
    session.pushUser(`[Результат ${action.tool}]:\n${truncate(execution.content)}`);
    emitAgentTransition(
      session,
      state,
      createTurnTransition(
        state.iteration,
        'todo_updated',
        'Список задач заведен и обновлён.',
        action.tool,
      ),
    );
    if (todoUpdate.verificationNudgeNeeded) {
      session.pushUser(buildVerificationWorkflowPrompt());
    }
    return execution;
  }

  const execution = await runTool(session, state, action, stepKey);
  session.recordToolCallResult(callKey, execution);
  state.lastToolStatus = execution.status;
  if (action.tool === 'tool_search' && execution.status === 'success') {
    state.recommendedToolNudgeSent = false;
  }
  syncBatchChildHistory(session, execution);
  session.trace.result(stepKey, action.tool, execution);

  updateExecutionMemory(session, action, execution);
  if (pushAssistantResponse) session.pushAssistant(response);
  session.pushUser(`[Результат ${action.tool}]:\n${truncate(execution.content)}`);
  applyPostToolOutcome(session, state, action.tool, action.args || {}, execution);
  return execution;
}

async function runTool(
  session: AgentSession,
  state: TurnLoopState,
  action: AgentAction,
  stepKey: number | string,
): Promise<ToolExecutionResult> {
  try {
    const runtimeHints = {
      studiedFiles: collectStudiedFilesFromUsedCalls(session.usedCalls),
      worktreeSession: session.getWorktreeSession(),
      setWorktreeSession: (nextSession: ReturnType<AgentSession['getWorktreeSession']>) => {
        session.setWorktreeSession(nextSession);
      },
    };
    const onEvent = (phase: string, message: string, meta?: any): void | Promise<any> => {
      if (phase === 'approval-request' && meta?.confirmId && meta?.kind) {
        return session.trace.event('approval-request', message, {
          ...meta,
          step: stepKey,
          toolName: action.tool,
        } as AgentApprovalRequest);
      }
      if (phase === 'question-request' && meta?.confirmId && Array.isArray(meta?.questions)) {
        return session.trace.event('question-request', message, {
          ...meta,
          step: stepKey,
          toolName: action.tool,
        } as AgentQuestionRequest);
      }
      if (phase === 'tool-batch-child-start' || phase === 'tool-batch-child-result') {
        return session.trace.event(phase, message, {
          ...meta,
          step: stepKey,
          toolName: action.tool,
        });
      }
      if (phase === 'file-change') {
        return session.trace.event(phase, message, {
          ...meta,
          step: stepKey,
          toolName: action.tool,
        });
      }
      return session.trace.event(phase, message, meta);
    };
    return await executeToolResult(
      action.tool,
      action.args || {},
      session.lastQuestion,
      onEvent,
      session.signal,
      session.getToolSearchRecommendation(),
      runtimeHints,
    );
  } catch (error: any) {
    return createToolExecutionResult(
      action.tool,
      'error',
      `Ошибка: ${error?.message || error}`,
    );
  }
}

function syncBatchChildHistory(
  session: AgentSession,
  execution: ToolExecutionResult,
): void {
  const children = execution.meta?.batchResults;
  if (!children?.length) return;

  for (const child of children) {
    const callKey = session.buildToolCallKey(child.toolName, child.args || {});
    session.usedCalls.add(callKey);
    session.modelUsedTools.add(child.toolName);
    session.recordToolCallResult(
      callKey,
      createToolExecutionResult(child.toolName, child.status, child.content, child.meta),
    );
  }
}

function updateExecutionMemory(
  session: AgentSession,
  action: AgentAction,
  execution: ToolExecutionResult,
): void {
  const children = execution.meta?.batchResults;
  if (!children?.length) {
    updateMemory(session.memory, action.tool, action.args || {}, execution);
    return;
  }

  for (const child of children) {
    updateBatchChildMemory(session, child);
  }
}

function updateBatchChildMemory(
  session: AgentSession,
  child: ToolBatchChildResult,
): void {
  updateMemory(
    session.memory,
    child.toolName,
    child.args || {},
    createToolExecutionResult(child.toolName, child.status, child.content, child.meta),
  );
}
