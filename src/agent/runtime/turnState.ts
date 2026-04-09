import { createAgentRecoveryState, type AgentRecoveryState } from './recovery';
import type { ToolExecutionStatus } from '../tooling/results';
import type { AgentTurnTransition } from './transitions';

export type TurnLoopState = {
  iteration: number;
  consecutiveDupes: number;
  noActionRetryCount: number;
  lastMonotonyCheck: number;
  subagentUsed: boolean;
  subagentRecoveryNudgeSent: boolean;
  subagentProactiveNudges: number;
  retrievalNudgeSent: boolean;
  enoughContextNudgeSent: boolean;
  planModeCompleted: boolean;
  todoNudgeSent: boolean;
  deferredToolNudgeSent: boolean;
  interactiveToolNudgeSent: boolean;
  toolSearchNudgeSent: boolean;
  recommendedToolNudgeSent: boolean;
  lastToolUsed: string | null;
  lastToolReasoning: string | null;
  lastToolStatus: ToolExecutionStatus | null;
  recovery: AgentRecoveryState;
  lastTransition: AgentTurnTransition | null;
};

export function createTurnLoopState(): TurnLoopState {
  return {
    iteration: 0,
    consecutiveDupes: 0,
    noActionRetryCount: 0,
    lastMonotonyCheck: 0,
    subagentUsed: false,
    subagentRecoveryNudgeSent: false,
    subagentProactiveNudges: 0,
    retrievalNudgeSent: false,
    enoughContextNudgeSent: false,
    planModeCompleted: false,
    todoNudgeSent: false,
    deferredToolNudgeSent: false,
    interactiveToolNudgeSent: false,
    toolSearchNudgeSent: false,
    recommendedToolNudgeSent: false,
    lastToolUsed: null,
    lastToolReasoning: null,
    lastToolStatus: null,
    recovery: createAgentRecoveryState(),
    lastTransition: null,
  };
}
