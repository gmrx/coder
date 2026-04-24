import type { ToolExecutionStatus } from '../results';
import {
  checkToolPermissions,
  type ToolPermissionCheckContext,
  type ToolPermissionCheckResult,
} from './toolPermissionChecks';
import {
  validateToolInput,
  type ToolInputValidationContext,
} from './toolInputValidators';

export type ToolRuntimeContract = {
  validateInput?: boolean;
  checkPermissions?: boolean;
  repeatPolicy?: {
    allowSameArgsRetryAfter?: ToolExecutionStatus[];
    maxAttemptsPerCall?: number;
  };
};

export const TOOL_RUNTIME_CONTRACTS: Partial<Record<string, ToolRuntimeContract>> = {
  tool_search: { validateInput: true },
  skill: { validateInput: true },
  ask_user: { validateInput: true },
  task_create: { validateInput: true },
  task_list: { validateInput: true },
  task_get: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 3 },
  },
  task_update: { validateInput: true },
  task_stop: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  list_mcp_resources: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  list_mcp_tools: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  read_mcp_resource: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  mcp_tool: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded', 'blocked'], maxAttemptsPerCall: 2 },
  },
  mcp_auth: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'blocked'], maxAttemptsPerCall: 2 },
  },
  enter_worktree: { validateInput: true },
  exit_worktree: { validateInput: true },
  tool_batch: { validateInput: true },
  scan_structure: { validateInput: true },
  list_files: { validateInput: true, checkPermissions: true },
  read_file: { validateInput: true, checkPermissions: true },
  read_file_range: { validateInput: true, checkPermissions: true },
  extract_symbols: { validateInput: true, checkPermissions: true },
  dependencies: { validateInput: true, checkPermissions: true },
  glob: { validateInput: true, checkPermissions: true },
  find_files: { validateInput: true, checkPermissions: true },
  detect_stack: { validateInput: true },
  grep: { validateInput: true },
  workspace_symbols: { validateInput: true },
  lsp_inspect: { validateInput: true, checkPermissions: true },
  read_lints: { validateInput: true, checkPermissions: true },
  get_diagnostics: { validateInput: true, checkPermissions: true },
  semantic_search: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  find_relevant_files: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  web_search: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  web_fetch: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  jira_list_projects: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  jira_search_tasks: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  jira_get_task: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  tfs_list_projects: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  tfs_search_tasks: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  tfs_get_task: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
  shell: { validateInput: true, checkPermissions: true },
  str_replace: { validateInput: true, checkPermissions: true },
  write_file: { validateInput: true, checkPermissions: true },
  delete_file: { validateInput: true, checkPermissions: true },
  edit_notebook: { validateInput: true, checkPermissions: true },
  subagent: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error'], maxAttemptsPerCall: 2 },
  },
  verification_agent: {
    validateInput: true,
    repeatPolicy: { allowSameArgsRetryAfter: ['error', 'degraded'], maxAttemptsPerCall: 2 },
  },
};

export function getToolRuntimeContract(toolName: string): ToolRuntimeContract {
  return TOOL_RUNTIME_CONTRACTS[toolName] || {};
}

export function canRetrySameToolCall(
  toolName: string,
  previousStatus: ToolExecutionStatus,
  previousAttempts: number,
): boolean {
  const repeatPolicy = getToolRuntimeContract(toolName).repeatPolicy;
  if (!repeatPolicy) return false;
  if (!repeatPolicy.allowSameArgsRetryAfter?.includes(previousStatus)) return false;
  const maxAttempts = repeatPolicy.maxAttemptsPerCall ?? 1;
  return previousAttempts < maxAttempts;
}

export function getToolMaxAttemptsPerCall(toolName: string): number {
  return getToolRuntimeContract(toolName).repeatPolicy?.maxAttemptsPerCall ?? 1;
}

export function validateToolViaContract(
  toolName: string,
  args: any,
  context: ToolInputValidationContext = {},
): string | null {
  if (!getToolRuntimeContract(toolName).validateInput) return null;
  return validateToolInput(toolName, args, context);
}

export async function checkToolPermissionsViaContract(
  toolName: string,
  args: any,
  context: ToolPermissionCheckContext = {},
): Promise<ToolPermissionCheckResult> {
  if (!getToolRuntimeContract(toolName).checkPermissions) {
    return { allowed: true };
  }
  return checkToolPermissions(toolName, args, context);
}
