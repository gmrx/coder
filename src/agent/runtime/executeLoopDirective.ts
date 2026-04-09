import type { AgentSession } from './agentSession';
import { executeAgentActionSequence } from './actionSequenceExecution';
import type { AgentLoopDirective } from './loopDirectives';
import { handlePlanModeExit } from './planModeExitFlow';
import type { TurnLoopState } from './turnState';
import { applyContinuationDecision } from './turnStateMachine';
import { emitAgentTransition } from './transitionDispatcher';
import { executeAgentToolStep } from './toolExecutionStep';

type ContinueDirective = Extract<AgentLoopDirective, { kind: 'continue' }>;
type FallbackFinalDirective = Extract<AgentLoopDirective, { kind: 'fallback_final' }>;
type ErrorDirective = Extract<AgentLoopDirective, { kind: 'error' }>;
type EnterPlanModeDirective = Extract<AgentLoopDirective, { kind: 'enter_plan_mode' }>;
type ExitPlanModeDirective = Extract<AgentLoopDirective, { kind: 'exit_plan_mode' }>;
type FinalAnswerDirective = Extract<AgentLoopDirective, { kind: 'final_answer' }>;
type ExecuteToolDirective = Extract<AgentLoopDirective, { kind: 'execute_tool' }>;
type ExecuteActionsDirective = Extract<AgentLoopDirective, { kind: 'execute_actions' }>;

export type AgentLoopExecutionResult =
  | { kind: 'continue' }
  | { kind: 'return'; answer: string };

type DirectiveExecutor<TDirective extends AgentLoopDirective> = (
  session: AgentSession,
  state: TurnLoopState,
  directive: TDirective,
) => Promise<AgentLoopExecutionResult>;

const LOOP_DIRECTIVE_EXECUTORS: {
  [K in AgentLoopDirective['kind']]: DirectiveExecutor<Extract<AgentLoopDirective, { kind: K }>>;
} = {
  continue: async (session, state, directive: ContinueDirective) => {
    applyContinuationDecision(session, state, directive.response, directive.decision);
    return { kind: 'continue' };
  },

  fallback_final: async (session, state, directive: FallbackFinalDirective) => {
    emitAgentTransition(session, state, directive.transition);
    session.pushAssistant(directive.response);
    return {
      kind: 'return',
      answer: await session.finalizeAnswer(
        directive.finalPrompt,
        state.iteration,
        directive.progressLabel,
      ),
    };
  },

  error: async (_session, _state, directive: ErrorDirective) => {
    return {
      kind: 'return',
      answer: directive.message,
    };
  },

  enter_plan_mode: async (session, state, directive: EnterPlanModeDirective) => {
    emitAgentTransition(session, state, directive.transition);
    session.pushAssistant(directive.response);
    session.enterPlanMode();
    session.pushUser(directive.followupPrompt);
    return { kind: 'continue' };
  },

  exit_plan_mode: async (session, state, directive: ExitPlanModeDirective) => {
    const result = await handlePlanModeExit(session, state, directive.response);
    if (result.kind === 'return') {
      return { kind: 'return', answer: result.answer };
    }
    return { kind: 'continue' };
  },

  final_answer: async (session, state, directive: FinalAnswerDirective) => {
    session.pushAssistant(directive.response);
    return {
      kind: 'return',
      answer: await session.finalizeAnswer(
        directive.finalPrompt,
        state.iteration,
      ),
    };
  },

  execute_tool: async (session, state, directive: ExecuteToolDirective) => {
    if (directive.transition) {
      emitAgentTransition(session, state, directive.transition);
    }
    await executeAgentToolStep(session, state, directive.response, directive.action, {
      pushAssistant: !directive.synthetic && !!directive.response.trim(),
    });
    return { kind: 'continue' };
  },

  execute_actions: async (session, state, directive: ExecuteActionsDirective) => {
    await executeAgentActionSequence(session, state, directive.response, directive.actions);
    return { kind: 'continue' };
  },
};

export async function executeLoopDirective(
  session: AgentSession,
  state: TurnLoopState,
  directive: AgentLoopDirective,
): Promise<AgentLoopExecutionResult> {
  const executor = LOOP_DIRECTIVE_EXECUTORS[directive.kind] as DirectiveExecutor<AgentLoopDirective>;
  return executor(session, state, directive);
}
