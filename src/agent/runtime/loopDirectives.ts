import type { AgentAction } from '../prompt';
import type { AgentSession } from './agentSession';
import { createContinuationDecision } from './decisionFactory';
import { resolveActionLoopDirective } from './actionLoopDirectives';
import { validateActionSequence } from './actionSequenceExecution';
import { resolveMissingActionLoopDirective } from './missingActionLoopDirectives';
import type { TurnLoopState } from './turnState';
import type { AgentTurnTransition } from './transitions';
import type { TurnContinuationDecision } from './turnStateMachine';

export type AgentLoopDirective =
  | {
      kind: 'continue';
      response: string;
      decision: TurnContinuationDecision;
    }
  | {
      kind: 'fallback_final';
      response: string;
      transition: AgentTurnTransition;
      finalPrompt: string;
      progressLabel: string;
    }
  | {
      kind: 'error';
      message: string;
    }
  | {
      kind: 'enter_plan_mode';
      response: string;
      transition: AgentTurnTransition;
      followupPrompt: string;
    }
  | {
      kind: 'exit_plan_mode';
      response: string;
      action: AgentAction;
    }
  | {
      kind: 'final_answer';
      response: string;
      finalPrompt: string;
    }
  | {
      kind: 'execute_tool';
      response: string;
      action: AgentAction;
      transition?: AgentTurnTransition;
      synthetic?: boolean;
    }
  | {
      kind: 'execute_actions';
      response: string;
      actions: AgentAction[];
    };

export function resolveLoopDirective(
  session: AgentSession,
  state: TurnLoopState,
  response: string,
  action: AgentAction | null,
  actions: AgentAction[] = action ? [action] : [],
): AgentLoopDirective {
  if (!actions.length || !action) {
    return resolveMissingActionLoopDirective(session, state, response);
  }

  if (actions.length > 1) {
    const sequenceError = validateActionSequence(actions);
    if (sequenceError) {
      return {
        kind: 'continue',
        response,
        decision: createContinuationDecision(
          state,
          'no_action_retry',
          'Массив действий содержит недопустимую комбинацию.',
          sequenceError,
        ),
      };
    }

    return {
      kind: 'execute_actions',
      response,
      actions,
    };
  }

  return resolveActionLoopDirective(session, state, response, action);
}
