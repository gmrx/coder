import type { AgentAction } from '../prompt';
import type { AgentSession } from './agentSession';
import type { AgentLoopDirective } from './loopDirectives';
import { buildPlanModeActivationPrompt } from './loopDirectiveContracts';
import type { TurnLoopState } from './turnState';
import { createTurnTransition } from './transitions';
import { evaluateActionContinuation } from './turnStateMachine';

export function resolveActionLoopDirective(
  session: AgentSession,
  state: TurnLoopState,
  response: string,
  action: AgentAction,
): AgentLoopDirective {
  if (action.tool === 'enter_plan_mode') {
    return {
      kind: 'enter_plan_mode',
      response,
      transition: createTurnTransition(
        state.iteration,
        'enter_plan_mode',
        'Переключаюсь в read-only планирование.',
      ),
      followupPrompt: buildPlanModeActivationPrompt(),
    };
  }

  if (action.tool === 'exit_plan_mode') {
    return {
      kind: 'exit_plan_mode',
      response,
      action,
    };
  }

  const continuation = evaluateActionContinuation(session, state, action);
  if (continuation) {
    return {
      kind: 'continue',
      response,
      decision: continuation,
    };
  }

  if (action.tool === 'final_answer') {
    return {
      kind: 'final_answer',
      response,
      finalPrompt: session.buildStandardFinalPrompt(),
    };
  }

  return {
    kind: 'execute_tool',
    response,
    action,
  };
}
