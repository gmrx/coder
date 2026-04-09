import type { AgentSession } from './agentSession';
import type { TurnContinuationDecision } from './decisionFactory';
import type { TurnLoopState } from './turnState';
import { emitAgentTransition } from './transitionDispatcher';
export {
  evaluateActionContinuation,
} from './continuationDecisions';
export type { TurnContinuationDecision } from './decisionFactory';
export {
  evaluateMissingAction,
  type MissingActionDecision,
} from './missingActionDecisions';

export function applyContinuationDecision(
  session: AgentSession,
  state: TurnLoopState,
  response: string,
  decision: TurnContinuationDecision,
): void {
  session.pushAssistant(response);
  emitAgentTransition(session, state, decision.transition);
  if (decision.prompt) {
    session.pushUser(decision.prompt);
  }
}
