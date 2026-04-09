import type { AgentAction } from '../prompt';
import type { AgentSession } from './agentSession';
import { ACTION_CONTINUATION_PIPELINE } from './actionContinuationPipeline';
import { type TurnContinuationDecision } from './decisionFactory';
import type { TurnLoopState } from './turnState';

export function evaluateActionContinuation(
  session: AgentSession,
  state: TurnLoopState,
  action: AgentAction,
): TurnContinuationDecision | null {
  for (const evaluate of ACTION_CONTINUATION_PIPELINE) {
    const decision = evaluate(session, state, action);
    if (decision) return decision;
  }
  return null;
}
