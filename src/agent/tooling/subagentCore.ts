import { parseAgentAction, stripJsonBlocks } from '../prompt';
import { readConfig, sendChatRequest } from '../../core/api';
import { truncate } from '../../core/utils';
import { getSubagentAllowedTools, validateSubagentArgs } from './catalog';
import { isMcpFocusedSubagentTask, narrowAllowedToolsForMcpFocus } from './subagentMcpFocus';
import {
  buildMcpRemoteStateKey,
  buildMcpScopedCallKey,
  getMcpArgumentsArg,
  getMcpServerArg,
  getMcpToolNameArg,
} from '../mcp/executionPolicy';
import {
  buildSubagentDisallowedToolPrompt,
  buildSubagentDuplicatePrompt,
  buildSubagentFinalMarkdownPrompt,
  buildSubagentInvalidArgsPrompt,
  buildSubagentNoActionPrompt,
  buildSubagentSystemPrompt,
} from './subagentPromptContracts';
import {
  buildSubagentDonePresentation,
  buildSubagentErrorPresentation,
  buildSubagentResultPresentation,
  buildSubagentStartPresentation,
  buildSubagentStepPresentation,
  buildSubagentToolPresentation,
} from './subagentEventPresentation';
import { createToolExecutionResult, type ToolExecutionResult } from './results';
import type { ExecuteToolResultFn, ToolEventCallback, ToolExecutionContext } from './types';

let subagentSequence = 0;

function formatSubagentRetryText(retry: {
  attempt: number;
  maxAttempts?: number;
  delayMs: number;
  retryUntilSuccess?: boolean;
}): string {
  const delaySeconds = Math.max(1, Math.round(retry.delayMs / 1000));
  const retryLabel = retry.retryUntilSuccess
    ? `повтор ${retry.attempt}`
    : `повтор ${retry.attempt}/${retry.maxAttempts ?? '?'}`;
  const suffix = retry.retryUntilSuccess
    ? '. Продолжаю пробовать до восстановления соединения...'
    : '...';
  return `${retryLabel} через ${delaySeconds}с${suffix}`;
}

export async function sendChatWithStepRetry(
  apiBaseUrl: string,
  apiKey: string,
  model: string,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: { temperature: number; signal?: AbortSignal },
  id: string,
  onEvent?: ToolEventCallback,
): Promise<string> {
  return sendChatRequest(apiBaseUrl, apiKey, model, messages, {
    ...options,
    retryUntilSuccess: true,
    onRetry: (retry) => {
      onEvent?.(
        'subagent-step',
        ` [Subagent ${id}] Временная ошибка API, ${formatSubagentRetryText(retry)}`,
        {
          ...buildSubagentStepPresentation({
            retry: retry.attempt,
            maxAttempts: retry.maxAttempts,
            retryUntilSuccess: retry.retryUntilSuccess,
            delayMs: retry.delayMs,
            reason: retry.reason,
            error: retry.error,
          }),
          id,
          retry: retry.attempt,
          maxAttempts: retry.maxAttempts,
          retryUntilSuccess: retry.retryUntilSuccess,
          delayMs: retry.delayMs,
          reason: retry.reason,
          status: retry.status,
          error: retry.error,
        },
      );
    },
  });
}

function buildSubagentCallKey(
  action: { tool: string; args?: any },
  remoteStateVersions: Map<string, number>,
): string {
  if (action.tool === 'mcp_tool') {
    const server = getMcpServerArg(action.args || {});
    const name = getMcpToolNameArg(action.args || {});
    if (server && name) {
      const stateKey = buildMcpRemoteStateKey(server);
      return buildMcpScopedCallKey(
        server,
        name,
        getMcpArgumentsArg(action.args || {}),
        remoteStateVersions.get(stateKey) || 0,
      );
    }
  }
  return `${action.tool}:${JSON.stringify(action.args || {})}`;
}

function updateSubagentRemoteState(
  execution: ToolExecutionResult,
  remoteStateVersions: Map<string, number>,
): void {
  const hint = execution.meta?.remoteStateHint;
  if (!hint || hint.system !== 'mcp' || !hint.changed) return;
  if (execution.status !== 'success' && execution.status !== 'degraded') return;
  remoteStateVersions.set(hint.key, (remoteStateVersions.get(hint.key) || 0) + 1);
}

export async function runSubagentSingle(args: any, executeTool: ExecuteToolResultFn, context: ToolExecutionContext): Promise<string> {
  const task = (args?.prompt || args?.task || args?.query || '').toString().trim();
  if (!task) return '(subagent) укажи "prompt" (или "task").';

  const subagentType = (args?.subagent_type || 'explore').toString();
  const readonly = args?.readonly !== undefined ? args.readonly !== false : subagentType !== 'verification';
  const mcpFocused = args?.mcp_focused === true || isMcpFocusedSubagentTask(task, context.query || '');
  const allowed = mcpFocused
    ? narrowAllowedToolsForMcpFocus(getSubagentAllowedTools(subagentType, readonly))
    : getSubagentAllowedTools(subagentType, readonly);
  const allowedList = [...allowed].sort().join(', ');
  const id = `sa-${++subagentSequence}`;
  context.onEvent?.('subagent-start', ` [Subagent ${id}] старт: ${subagentType}${readonly ? ', readonly' : ''}`, {
    ...buildSubagentStartPresentation({
      purpose: task,
      subagentType,
      readonly,
      mode: 'single',
    }),
    id,
    purpose: task,
    subagentType,
    readonly,
  });

  const config = readConfig();
  if (!config.apiBaseUrl || !config.apiKey || !config.model) {
    return '(subagent) не настроены API-параметры (apiBaseUrl/apiKey/model).';
  }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    {
      role: 'system',
      content: buildSubagentSystemPrompt({ subagentType, readonly, allowedList, mcpFocused }),
    },
    {
      role: 'user',
      content:
        `Задача: ${task}\n` +
        (context.query ? `Контекст родительского запроса: ${context.query}\n` : '') +
        (mcpFocused
          ? 'Это задача про MCP/внешнюю систему. Не уходи в read_file/find_relevant_files/semantic_search по workspace, если только задача явно не просит разбирать локальный MCP config. Сначала работай через list_mcp_tools, затем через mcp_tool. Если в задаче уже перечислены GUID проектов и нужный MCP tool, не делай лишние подготовительные вызовы вроде whoami/list_projects без необходимости.\n'
          : '') +
        'Сначала получи факты инструментами, затем дай final_answer.',
    },
  ];

  let step = 0;
  let noActionCount = 0;
  let disallowedCount = 0;
  let consecutiveDuplicates = 0;
  let lastCallKey: string | null = null;
  const remoteStateVersions = new Map<string, number>();

  while (true) {
    step++;
    context.onEvent?.('subagent-step', ` [Subagent ${id}] Шаг ${step}`, {
      ...buildSubagentStepPresentation({ step }),
      id,
      step,
    });

    let llmResponse: string;
    try {
      llmResponse = await sendChatWithStepRetry(
        config.apiBaseUrl,
        config.apiKey,
        config.model,
        messages,
        { temperature: 0.15, signal: context.signal },
        id,
        context.onEvent,
      );
    } catch (error: any) {
      context.onEvent?.('subagent-error', ` [Subagent ${id}] Ошибка API: ${error?.message || error}`, {
        ...buildSubagentErrorPresentation({
          error: error?.message || String(error),
        }),
        id,
        error: error?.message || String(error),
      });
      return `(subagent) Ошибка API: ${error?.message || error}`;
    }

    const { action } = parseAgentAction(llmResponse);
    if (!action) {
      noActionCount++;
      if (noActionCount >= 5) {
        context.onEvent?.('subagent-error', ` [Subagent ${id}] Не удалось получить валидный JSON-вызов`, {
          ...buildSubagentErrorPresentation({
            error: 'Не удалось получить валидный JSON-вызов',
          }),
          id,
          error: 'invalid-json',
        });
        return '(subagent) не удалось получить валидный JSON-вызов после нескольких попыток.';
      }

      messages.push({ role: 'assistant', content: llmResponse });
      messages.push({ role: 'user', content: buildSubagentNoActionPrompt() });
      continue;
    }
    noActionCount = 0;

    if (action.tool === 'final_answer') {
      const ready = action.args?.text || action.args?.answer || '';
      if (ready && typeof ready === 'string') {
        context.onEvent?.('subagent-done', ` [Subagent ${id}] Завершён`, {
          ...buildSubagentDonePresentation({ preview: stripJsonBlocks(ready) }),
          id,
          preview: stripJsonBlocks(ready),
        });
        return stripJsonBlocks(ready);
      }

      messages.push({ role: 'assistant', content: llmResponse });
      messages.push({ role: 'user', content: buildSubagentFinalMarkdownPrompt() });
      try {
        const done = stripJsonBlocks(await sendChatWithStepRetry(
          config.apiBaseUrl,
          config.apiKey,
          config.model,
          messages,
          { temperature: 0.4, signal: context.signal },
          id,
          context.onEvent,
        ));
        context.onEvent?.('subagent-done', ` [Subagent ${id}] Завершён`, {
          ...buildSubagentDonePresentation({ preview: done }),
          id,
          preview: done,
        });
        return done;
      } catch (error: any) {
        context.onEvent?.('subagent-error', ` [Subagent ${id}] Ошибка API: ${error?.message || error}`, {
          ...buildSubagentErrorPresentation({
            error: error?.message || String(error),
          }),
          id,
          error: error?.message || String(error),
        });
        return `(subagent) Ошибка API: ${error?.message || error}`;
      }
    }

    if (!allowed.has(action.tool)) {
      disallowedCount++;
      if (disallowedCount >= 5) {
        context.onEvent?.('subagent-error', ` [Subagent ${id}] Слишком много запрещённых вызовов`, {
          ...buildSubagentErrorPresentation({
            error: 'Слишком много запрещённых вызовов',
          }),
          id,
          error: 'disallowed-tools',
        });
        return '(subagent) остановлен: модель многократно вызывает запрещённые инструменты.';
      }

      messages.push({ role: 'assistant', content: llmResponse });
      messages.push({ role: 'user', content: buildSubagentDisallowedToolPrompt(action.tool, allowedList) });
      continue;
    }
    disallowedCount = 0;

    const argsError = validateSubagentArgs(action.tool, action.args);
    if (argsError) {
      messages.push({ role: 'assistant', content: llmResponse });
      messages.push({
        role: 'user',
        content: buildSubagentInvalidArgsPrompt(argsError),
      });
      continue;
    }

    const callKey = buildSubagentCallKey(action, remoteStateVersions);
    if (lastCallKey === callKey) {
      consecutiveDuplicates++;
      if (consecutiveDuplicates >= 3) {
        context.onEvent?.('subagent-error', ` [Subagent ${id}] Зацикливание на одинаковых вызовах`, {
          ...buildSubagentErrorPresentation({
            error: 'Зацикливание на одинаковых вызовах',
          }),
          id,
          error: 'duplicate-calls',
        });
        return '(subagent) остановлен: зацикливание на одинаковых вызовах.';
      }

      messages.push({ role: 'assistant', content: llmResponse });
      messages.push({ role: 'user', content: buildSubagentDuplicatePrompt(action.tool) });
      continue;
    }

    consecutiveDuplicates = 0;
    lastCallKey = callKey;
    context.onEvent?.('subagent-tool', ` [Subagent ${id}] ${action.tool}`, {
      ...buildSubagentToolPresentation({
        tool: action.tool,
        args: action.args || {},
        reasoning: action.reasoning || '',
      }),
      id,
      tool: action.tool,
      args: action.args || {},
      reasoning: action.reasoning || '',
    });

    let execution: ToolExecutionResult;
    try {
      execution = await executeTool(action.tool, action.args || {}, task, context.onEvent, context.signal);
    } catch (error: any) {
      execution = createToolExecutionResult(
        action.tool,
        'error',
        `Ошибка инструмента ${action.tool}: ${error?.message || error}`,
      );
    }
    const toolResult = execution.content;
    updateSubagentRemoteState(execution, remoteStateVersions);

    context.onEvent?.('subagent-result', ` [Subagent ${id}] ${action.tool} → ${toolResult.split('\n').length} строк`, {
      ...buildSubagentResultPresentation({
        tool: action.tool,
        resultPreview: truncate(toolResult, 400),
      }),
      id,
      tool: action.tool,
      resultPreview: truncate(toolResult, 400),
    });
    messages.push({ role: 'assistant', content: llmResponse });
    messages.push({ role: 'user', content: `[Результат ${action.tool}]\n${truncate(toolResult, 6000)}` });
  }
}
