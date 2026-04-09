import type { TurnLoopState } from './turnState';
import { createTurnTransition, type AgentTurnTransition } from './transitions';

export type TurnContinuationDecision = {
  transition: AgentTurnTransition;
  prompt?: string;
};

export function createContinuationDecision(
  state: TurnLoopState,
  reason: AgentTurnTransition['reason'],
  detail: string,
  prompt?: string,
  toolName?: string,
): TurnContinuationDecision {
  return {
    transition: createTurnTransition(state.iteration, reason, detail, toolName),
    prompt,
  };
}
