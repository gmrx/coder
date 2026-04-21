import { resolveToolAlias } from './tooling/aliases';
import {
  checkToolPermissionsViaContract,
  createToolPreflightResult,
  getUnknownToolMessage,
  validateToolViaContract,
} from './tooling/catalog';
import { createToolHandlers } from './tooling/registry';
import {
  createToolExecutionResult,
  normalizeToolExecutionOutput,
  type ToolExecutionResult,
} from './tooling/results';
import { executeToolBatch } from './tooling/toolBatch';
import type { ToolEventCallback, ToolRuntimeHints } from './tooling/types';
import type { AgentToolSearchRecommendation } from './runtime/types';

const handlers = createToolHandlers(executeTool, executeToolResult);

export async function executeTool(
  toolName: string,
  args: any,
  query?: string,
  onEvent?: ToolEventCallback,
  signal?: AbortSignal,
  recommendation?: AgentToolSearchRecommendation | null,
  runtimeHints?: ToolRuntimeHints,
): Promise<string> {
  const result = await executeToolResult(toolName, args, query, onEvent, signal, recommendation, runtimeHints);
  return result.content;
}

export async function executeToolResult(
  toolName: string,
  args: any,
  query?: string,
  onEvent?: ToolEventCallback,
  signal?: AbortSignal,
  recommendation?: AgentToolSearchRecommendation | null,
  runtimeHints?: ToolRuntimeHints,
): Promise<ToolExecutionResult> {
  const resolved = resolveToolAlias(toolName, args);

  if (resolved.toolName === 'tool_batch') {
    return executeToolBatch(resolved.args || {}, {
      query,
      onEvent,
      signal,
      recommendation,
      runtimeHints,
      executeChild: executeToolResult,
    });
  }

  const handler = handlers[resolved.toolName];
  if (!handler) {
    return createToolExecutionResult(resolved.toolName, 'blocked', getUnknownToolMessage(resolved.toolName));
  }

  const validationError = validateToolViaContract(resolved.toolName, resolved.args || {}, { query });
  if (validationError) {
    return createToolPreflightResult(
      resolved.toolName,
      resolved.args || {},
      'validation',
      validationError,
      recommendation,
    );
  }

  const permission = await checkToolPermissionsViaContract(resolved.toolName, resolved.args || {}, {
    query,
    studiedFiles: runtimeHints?.studiedFiles,
  });
  if (!permission.allowed) {
    return createToolPreflightResult(
      resolved.toolName,
      resolved.args || {},
      'permission',
      permission.message || `Действие "${resolved.toolName}" заблокировано политикой выполнения.`,
      recommendation,
    );
  }

  const output = await handler(resolved.args || {}, {
    query,
    onEvent,
    signal,
    studiedFiles: runtimeHints?.studiedFiles,
    worktreeSession: runtimeHints?.worktreeSession,
    setWorktreeSession: runtimeHints?.setWorktreeSession,
  });
  return normalizeToolExecutionOutput(resolved.toolName, output);
}
