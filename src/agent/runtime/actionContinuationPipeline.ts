import type { AgentAction } from '../prompt';
import type { AgentSession } from './agentSession';
import type { TurnContinuationDecision } from './decisionFactory';
import { evaluateDuplicateDecision } from './duplicateDecision';
import { evaluateFinalAnswerDecision } from './finalAnswerDecisions';
import { evaluateNudgeDecision } from './nudgeDecisions';
import type { TurnLoopState } from './turnState';

export type ActionContinuationEvaluator = (
  session: AgentSession,
  state: TurnLoopState,
  action: AgentAction,
) => TurnContinuationDecision | null;

export const ACTION_CONTINUATION_PIPELINE: ActionContinuationEvaluator[] = [
  evaluateFinalAnswerDecision,
  evaluateNudgeDecision,
  evaluateDuplicateDecision,
];
