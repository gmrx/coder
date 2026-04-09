import type { AgentSession } from './agentSession';
import type { TurnLoopState } from './turnState';
import type { AgentTurnTransition } from './transitions';

export function emitAgentTransition(
  session: AgentSession,
  state: TurnLoopState,
  transition: AgentTurnTransition,
): void {
  state.lastTransition = transition;
  session.trace.transition(transition.summary, transition);
}
