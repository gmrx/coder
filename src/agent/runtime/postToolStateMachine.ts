import type { ToolExecutionResult } from '../tooling/results';
import type { AgentSession } from './agentSession';
import { applyPostToolOutcomePipeline } from './postToolOutcomePipeline';
import type { TurnLoopState } from './turnState';

export function applyPostToolOutcome(
  session: AgentSession,
  state: TurnLoopState,
  toolName: string,
  toolArgs: any,
  execution: ToolExecutionResult,
): void {
  applyPostToolOutcomePipeline(session, state, toolName, toolArgs, execution);
}
