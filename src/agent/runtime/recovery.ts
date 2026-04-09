import { truncate } from '../../core/utils';
import { getApprovalRejectedRecoverySummary, getToolRecoverySummary } from '../tooling/catalog';
import type { ToolExecutionResult } from '../tooling/results';

export type AgentRecoveryKind =
  | 'tool_error'
  | 'tool_blocked'
  | 'tool_degraded'
  | 'approval_rejected';

export type AgentRecoveryState = {
  active: boolean;
  kind: AgentRecoveryKind | '';
  toolName: string;
  summary: string;
  detail: string;
  updatedAt: number;
  repeatCount: number;
};

export function createAgentRecoveryState(): AgentRecoveryState {
  return {
    active: false,
    kind: '',
    toolName: '',
    summary: '',
    detail: '',
    updatedAt: 0,
    repeatCount: 0,
  };
}

export function clearAgentRecovery(state: AgentRecoveryState): void {
  state.active = false;
  state.kind = '';
  state.toolName = '';
  state.summary = '';
  state.detail = '';
  state.updatedAt = 0;
  state.repeatCount = 0;
}

export function beginToolRecovery(
  state: AgentRecoveryState,
  toolName: string,
  execution: ToolExecutionResult,
): AgentRecoveryState {
  const kind = mapExecutionStatusToRecoveryKind(execution.status);
  if (!kind) {
    clearAgentRecovery(state);
    return state;
  }
  const status = execution.status as Extract<ToolExecutionResult['status'], 'blocked' | 'error' | 'degraded'>;

  const sameIssue = state.active && state.kind === kind && state.toolName === toolName;
  state.active = true;
  state.kind = kind;
  state.toolName = toolName;
  state.summary = getToolRecoverySummary(toolName, status);
  state.detail = truncate(String(execution.content || '').trim(), 220);
  state.updatedAt = Date.now();
  state.repeatCount = sameIssue ? state.repeatCount + 1 : 1;
  return state;
}

export function beginApprovalRejectedRecovery(
  state: AgentRecoveryState,
  toolName: string,
  detail = '',
): AgentRecoveryState {
  const sameIssue = state.active && state.kind === 'approval_rejected' && state.toolName === toolName;
  state.active = true;
  state.kind = 'approval_rejected';
  state.toolName = toolName;
  state.summary = getApprovalRejectedRecoverySummary(toolName);
  state.detail = truncate(String(detail || '').trim(), 220);
  state.updatedAt = Date.now();
  state.repeatCount = sameIssue ? state.repeatCount + 1 : 1;
  return state;
}

function mapExecutionStatusToRecoveryKind(
  status: ToolExecutionResult['status'],
): AgentRecoveryKind | null {
  if (status === 'error') return 'tool_error';
  if (status === 'blocked') return 'tool_blocked';
  if (status === 'degraded') return 'tool_degraded';
  return null;
}
