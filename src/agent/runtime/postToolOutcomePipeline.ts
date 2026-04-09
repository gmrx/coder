import type { ToolExecutionResult } from '../tooling/results';
import type { AgentSession } from './agentSession';
import { executePostToolDirective, resolvePostToolDirective } from './postToolDirectives';
import { resolvePostToolRecoveryDirective } from './postToolRecoveryDirectives';
import { beginToolRecovery, clearAgentRecovery } from './recovery';
import type { TurnLoopState } from './turnState';

type PostToolOutcomeStage = (
  session: AgentSession,
  state: TurnLoopState,
  toolName: string,
  toolArgs: any,
  execution: ToolExecutionResult,
) => boolean;

const POST_TOOL_OUTCOME_PIPELINE: PostToolOutcomeStage[] = [
  handleRecoveryStage,
  handleDirectiveStage,
  handleClearRecoveryStage,
];

export function applyPostToolOutcomePipeline(
  session: AgentSession,
  state: TurnLoopState,
  toolName: string,
  toolArgs: any,
  execution: ToolExecutionResult,
): void {
  for (const stage of POST_TOOL_OUTCOME_PIPELINE) {
    if (stage(session, state, toolName, toolArgs, execution)) {
      return;
    }
  }
}

function handleRecoveryStage(
  session: AgentSession,
  state: TurnLoopState,
  toolName: string,
  _toolArgs: any,
  execution: ToolExecutionResult,
): boolean {
  if (execution.status !== 'blocked' && execution.status !== 'error' && execution.status !== 'degraded') {
    return false;
  }

  const recovery = beginToolRecovery(state.recovery, toolName, execution);
  session.trace.recovery(recovery.summary, {
    step: state.iteration,
    kind: recovery.kind,
    tool: recovery.toolName,
    summary: recovery.summary,
    detail: recovery.detail,
    repeatCount: recovery.repeatCount,
  });

  const directive = resolvePostToolRecoveryDirective(session, toolName, execution);
  if (directive) {
    session.pushUser(directive.prompt);
  }
  return true;
}

function handleDirectiveStage(
  session: AgentSession,
  state: TurnLoopState,
  toolName: string,
  toolArgs: any,
  execution: ToolExecutionResult,
): boolean {
  const directive = resolvePostToolDirective(session, state, toolName, toolArgs, execution);
  if (!directive) {
    return false;
  }

  executePostToolDirective(session, state, directive);
  return true;
}

function handleClearRecoveryStage(
  _session: AgentSession,
  state: TurnLoopState,
  _toolName: string,
  _toolArgs: any,
  _execution: ToolExecutionResult,
): boolean {
  clearAgentRecovery(state.recovery);
  return true;
}
