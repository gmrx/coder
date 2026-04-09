import { resolveToolAlias } from './aliases';
import {
  checkToolPermissionsViaContract,
  getToolDefinition,
  getToolResultDetail,
  getToolResultPreview,
  getToolResultSummary,
  getToolStartSummary,
  isToolConcurrencySafe,
  isToolReadOnly,
  requiresToolApproval,
  shouldDeferTool,
  toolRequiresUserInteraction,
  validateToolViaContract,
  getToolTraceMeta,
} from './catalog';
import {
  createToolExecutionResult,
  type ToolBatchChildResult,
  type ToolExecutionResult,
  type ToolExecutionStatus,
} from './results';
import type { ExecuteToolResultFn, ToolEventCallback, ToolRuntimeHints } from './types';
import type { AgentToolSearchRecommendation } from '../runtime/types';

type ToolBatchContext = {
  query?: string;
  onEvent?: ToolEventCallback;
  signal?: AbortSignal;
  recommendation?: AgentToolSearchRecommendation | null;
  runtimeHints?: ToolRuntimeHints;
  executeChild: ExecuteToolResultFn;
};

type ToolBatchCall = {
  tool: string;
  args?: any;
};

const MIN_BATCH_ITEMS = 1;
const DEFAULT_BATCH_CONCURRENCY = 3;
const DEFAULT_MAX_BATCH_CONCURRENCY = 6;

export async function executeToolBatch(
  args: any,
  context: ToolBatchContext,
): Promise<ToolExecutionResult> {
  const calls = Array.isArray(args?.tools) ? args.tools : [];
  if (calls.length < MIN_BATCH_ITEMS) {
    return createToolExecutionResult(
      'tool_batch',
      'error',
      'tool_batch требует хотя бы один независимый вызов.',
    );
  }

  const prepared: ToolBatchCall[] = [];
  for (let index = 0; index < calls.length; index++) {
    const raw = calls[index];
    const invalid = await validateBatchCall(raw, index, context);
    if (invalid) return invalid;

    const resolved = resolveToolAlias(String(raw.tool), raw.args || {});
    prepared.push({
      tool: resolved.toolName,
      args: resolved.args || {},
    });
  }

  const results = await executeBatchCalls(prepared, context);

  return createToolExecutionResult(
    'tool_batch',
    aggregateBatchStatus(results),
    buildBatchContent(results),
    { batchResults: results },
  );
}

async function executeBatchCalls(
  calls: ToolBatchCall[],
  context: ToolBatchContext,
): Promise<ToolBatchChildResult[]> {
  const results = new Array<ToolBatchChildResult>(calls.length);
  const concurrency = Math.max(
    1,
    Math.min(getBatchConcurrencyLimit(), calls.length),
  );
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < calls.length) {
      const currentIndex = nextIndex++;
      const call = calls[currentIndex];
      if (!call) return;

      await emitBatchChildStart(call, currentIndex, calls.length, context);

      let childResult: ToolBatchChildResult;
      try {
        const execution = await context.executeChild(
          call.tool,
          call.args,
          context.query,
          context.onEvent,
          context.signal,
          context.recommendation,
          context.runtimeHints,
        );
        childResult = {
          toolName: execution.toolName,
          args: call.args,
          status: execution.status,
          content: execution.content,
          ...(execution.meta ? { meta: execution.meta } : {}),
        };
      } catch (error: any) {
        childResult = {
          toolName: call.tool,
          args: call.args,
          status: 'error',
          content: `Ошибка: ${error?.message || error}`,
        };
      }

      results[currentIndex] = childResult;
      await emitBatchChildResult(childResult, currentIndex, calls.length, context);
    }
  };

  await Promise.all(
    Array.from({ length: concurrency }, () => worker()),
  );

  return results.filter(Boolean);
}

async function validateBatchCall(
  raw: any,
  index: number,
  context: ToolBatchContext,
): Promise<ToolExecutionResult | null> {
  const resolved = resolveToolAlias(String(raw?.tool || ''), raw?.args || {});
  const toolName = resolved.toolName;
  const itemLabel = `args.tools[${index}]`;
  const definition = getToolDefinition(toolName);

  if (!definition) {
    return createToolExecutionResult(
      'tool_batch',
      'blocked',
      `${itemLabel}: неизвестная утилита "${toolName}".`,
    );
  }

  if (toolName === 'tool_batch') {
    return createToolExecutionResult(
      'tool_batch',
      'blocked',
      `${itemLabel}: вложенный tool_batch запрещён.`,
    );
  }

  const batchRestriction = getBatchRestrictionReason(toolName);
  if (batchRestriction) {
    return createToolExecutionResult(
      'tool_batch',
      'blocked',
      `${itemLabel}: ${batchRestriction}`,
    );
  }

  const validationError = validateToolViaContract(toolName, resolved.args || {}, {
    query: context.query,
  });
  if (validationError) {
    return createToolExecutionResult(
      'tool_batch',
      'error',
      `${itemLabel}: ${validationError}`,
    );
  }

  const permission = await checkToolPermissionsViaContract(toolName, resolved.args || {}, {
    query: context.query,
    studiedFiles: context.runtimeHints?.studiedFiles,
  });
  if (!permission.allowed) {
    return createToolExecutionResult(
      'tool_batch',
      'blocked',
      `${itemLabel}: ${permission.message || `утилита "${toolName}" заблокирована политикой выполнения`}.`,
    );
  }

  return null;
}

function getBatchRestrictionReason(toolName: string): string | null {
  if (toolName === 'final_answer') {
    return '"final_answer" нельзя вызывать внутри tool_batch';
  }
  if (!isToolReadOnly(toolName)) {
    return `утилита "${toolName}" не подходит: она не read-only`;
  }
  if (!isToolConcurrencySafe(toolName)) {
    return `утилита "${toolName}" не помечена как concurrency-safe`;
  }
  if (toolRequiresUserInteraction(toolName) || requiresToolApproval(toolName)) {
    return `утилита "${toolName}" требует подтверждения пользователя`;
  }
  if (shouldDeferTool(toolName)) {
    return `утилита "${toolName}" должна вызываться как отдельный осмысленный шаг, а не внутри batch`;
  }
  if (getToolDefinition(toolName)?.virtual) {
    return `утилита "${toolName}" является служебной и не подходит для tool_batch`;
  }
  return null;
}

function getBatchConcurrencyLimit(): number {
  const value = Number.parseInt(process.env.CURSORCODER_MAX_BATCH_CONCURRENCY || '', 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_BATCH_CONCURRENCY;
  return Math.min(DEFAULT_MAX_BATCH_CONCURRENCY, Math.max(1, value));
}

function aggregateBatchStatus(results: ToolBatchChildResult[]): ToolExecutionStatus {
  if (results.some((result) => result.status === 'error')) return 'error';
  if (results.some((result) => result.status === 'blocked')) return 'blocked';
  if (results.some((result) => result.status === 'degraded')) return 'degraded';
  return 'success';
}

async function emitBatchChildStart(
  call: ToolBatchCall,
  index: number,
  total: number,
  context: ToolBatchContext,
): Promise<void> {
  if (!context.onEvent) return;
  const traceMeta = getToolTraceMeta(call.tool);
  await context.onEvent(
    'tool-batch-child-start',
    `↳ [${index + 1}/${total}] ${traceMeta.displayName}`,
    {
      index: index + 1,
      total,
      tool: call.tool,
      displayName: traceMeta.displayName,
      args: call.args || {},
      startSummary: getToolStartSummary(call.tool),
      readOnly: traceMeta.readOnly,
      destructive: traceMeta.destructive,
      requiresUserInteraction: traceMeta.requiresUserInteraction,
      deferred: traceMeta.deferred,
      interruptBehavior: traceMeta.interruptBehavior,
      parentTool: 'tool_batch',
    },
  );
}

async function emitBatchChildResult(
  child: ToolBatchChildResult,
  index: number,
  total: number,
  context: ToolBatchContext,
): Promise<void> {
  if (!context.onEvent) return;
  const execution = createToolExecutionResult(
    child.toolName,
    child.status,
    child.content,
    child.meta,
  );
  const traceMeta = getToolTraceMeta(child.toolName);
  await context.onEvent(
    'tool-batch-child-result',
    `↳ [${index + 1}/${total}] ${traceMeta.displayName} завершён`,
    {
      index: index + 1,
      total,
      tool: child.toolName,
      displayName: traceMeta.displayName,
      args: child.args || {},
      status: child.status,
      resultPresentation: execution.meta?.presentation || null,
      resultSummary: getToolResultSummary(child.toolName, execution),
      resultDetail: getToolResultDetail(child.toolName, execution),
      resultPreview: getToolResultPreview(child.toolName, execution),
      error: child.status === 'error' || child.status === 'blocked',
      readOnly: traceMeta.readOnly,
      destructive: traceMeta.destructive,
      requiresUserInteraction: traceMeta.requiresUserInteraction,
      deferred: traceMeta.deferred,
      interruptBehavior: traceMeta.interruptBehavior,
      parentTool: 'tool_batch',
    },
  );
}

function buildBatchContent(results: ToolBatchChildResult[]): string {
  const counts = {
    success: results.filter((result) => result.status === 'success').length,
    degraded: results.filter((result) => result.status === 'degraded').length,
    blocked: results.filter((result) => result.status === 'blocked').length,
    error: results.filter((result) => result.status === 'error').length,
  };

  const lines = [
    `Tool batch: ${results.length} вызова(ов)`,
    `Итог: success=${counts.success}, degraded=${counts.degraded}, blocked=${counts.blocked}, error=${counts.error}`,
    '',
  ];

  results.forEach((result, index) => {
    lines.push(`=== [${index + 1}/${results.length}] ${result.toolName} ${stringifyArgs(result.args)} ===`);
    lines.push(`STATUS: ${result.status}`);
    if (result.content) {
      lines.push(result.content.trim());
    }
    lines.push('');
  });

  return lines.join('\n').trim();
}

function stringifyArgs(args: any): string {
  try {
    return JSON.stringify(args || {});
  } catch {
    return '{}';
  }
}
