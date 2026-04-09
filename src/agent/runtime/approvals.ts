export type AgentApprovalKind = 'shell' | 'plan' | 'file' | 'worktree' | 'mcp' | 'web';
export type AgentFileApprovalChangeType =
  | 'edit'
  | 'create'
  | 'overwrite'
  | 'delete'
  | 'notebook-new-cell'
  | 'notebook-edit-cell';

export interface AgentApprovalRequestBase {
  kind: AgentApprovalKind;
  confirmId: string;
  title: string;
  description?: string;
  toolName?: string;
  step?: number | string;
}

export interface AgentShellApprovalRequest extends AgentApprovalRequestBase {
  kind: 'shell';
  command: string;
  cwd: string;
  canEditCommand?: boolean;
  destructive?: boolean;
  readOnly?: boolean;
  riskLabel?: string;
  commandKind?: string;
  summary?: string;
  cwdLabel?: string;
}

export interface AgentPlanApprovalRequest extends AgentApprovalRequestBase {
  kind: 'plan';
  plan: string;
  mutationQuery: boolean;
  feedbackPlaceholder?: string;
}

export interface AgentFileApprovalRequest extends AgentApprovalRequestBase {
  kind: 'file';
  filePath: string;
  changeType: AgentFileApprovalChangeType;
  oldSnippet?: string;
  newSnippet?: string;
  cellIdx?: number;
  language?: string;
  summary?: string;
  stats?: {
    beforeLines: number;
    afterLines: number;
    oldBytes: number;
    newBytes: number;
    changedLines: number;
  };
}

export interface AgentWorktreeApprovalRequest extends AgentApprovalRequestBase {
  kind: 'worktree';
  action: 'enter' | 'keep' | 'remove';
  worktreePath: string;
  worktreeBranch?: string;
  originalRootPath: string;
  slug?: string;
  destructive?: boolean;
  summary?: string;
}

export interface AgentMcpApprovalRequest extends AgentApprovalRequestBase {
  kind: 'mcp';
  server: string;
  mcpToolName: string;
  argsJson: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  summary?: string;
}

export interface AgentWebApprovalRequest extends AgentApprovalRequestBase {
  kind: 'web';
  url: string;
  host: string;
  prompt?: string;
  trustKind?: 'preapproved' | 'trusted' | 'external' | 'blocked' | 'restricted';
  summary?: string;
}

export type AgentApprovalRequest =
  | AgentShellApprovalRequest
  | AgentPlanApprovalRequest
  | AgentFileApprovalRequest
  | AgentWorktreeApprovalRequest
  | AgentMcpApprovalRequest
  | AgentWebApprovalRequest;

export interface AgentApprovalResultBase {
  kind: AgentApprovalKind;
  confirmId: string;
  approved: boolean;
  cancelled?: boolean;
  reason?: string;
}

export interface AgentShellApprovalResult extends AgentApprovalResultBase {
  kind: 'shell';
  command?: string;
}

export interface AgentPlanApprovalResult extends AgentApprovalResultBase {
  kind: 'plan';
  plan?: string;
  feedback?: string;
}

export interface AgentFileApprovalResult extends AgentApprovalResultBase {
  kind: 'file';
}

export interface AgentWorktreeApprovalResult extends AgentApprovalResultBase {
  kind: 'worktree';
}

export interface AgentMcpApprovalResult extends AgentApprovalResultBase {
  kind: 'mcp';
  rememberTool?: boolean;
  server?: string;
  mcpToolName?: string;
}

export interface AgentWebApprovalResult extends AgentApprovalResultBase {
  kind: 'web';
  rememberHost?: boolean;
}

export type AgentApprovalResult =
  | AgentShellApprovalResult
  | AgentPlanApprovalResult
  | AgentFileApprovalResult
  | AgentWorktreeApprovalResult
  | AgentMcpApprovalResult
  | AgentWebApprovalResult;

export interface AgentPlanApprovalDecision {
  approved: boolean;
  cancelled?: boolean;
  reason?: string;
  plan?: string;
  feedback?: string;
}
