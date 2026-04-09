import { getToolResultSummary, getToolStartSummary, getToolUserFacingName } from './catalog';
import { classifyToolExecutionResult } from './results';
import type { NormalizedSubagentTask, SubagentLifecycleState } from './subagentTypes';

type SubagentEventMeta = {
  summary: string;
  detail: string;
  metaText?: string;
  toolText?: string;
  displayName?: string;
  resultSummary?: string;
};

function compactText(text: string | undefined, maxLength = 180): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function summarizeArgs(args: any): string {
  if (!args || typeof args !== 'object') return '';

  const parts: string[] = [];
  for (const key of Object.keys(args).slice(0, 3)) {
    const value = args[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string') {
      parts.push(`${key}: ${compactText(value, 40)}`);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}: ${String(value)}`);
      continue;
    }
    if (Array.isArray(value)) {
      parts.push(`${key}: ${value.length}`);
      continue;
    }
    if (typeof value === 'object') {
      parts.push(`${key}: …`);
    }
  }

  return parts.join(' • ');
}

export function describeSubagentMode(subagentType: string | undefined, readonly: boolean | undefined): string {
  const typeLabel =
    subagentType === 'explore'
      ? 'анализ'
      : subagentType === 'generalPurpose'
        ? 'универсальный'
        : subagentType === 'verification'
          ? 'проверка'
          : subagentType === 'shell'
            ? 'shell'
            : String(subagentType || 'подагент');
  return `${typeLabel} • ${readonly === false ? 'запись' : 'только чтение'}`;
}

export function buildSubagentBatchTaskPresentation(task: NormalizedSubagentTask): SubagentEventMeta {
  return {
    summary: 'Подагент поставлен в очередь',
    detail: compactText(task.prompt || task.label || 'Задача подагента', 180),
    metaText: describeSubagentMode(task.subagentType, task.readonly),
  };
}

export function buildSubagentBatchPresentation(
  tasks: Array<{ label?: string; purpose?: string }>,
): SubagentEventMeta {
  const items = Array.isArray(tasks) ? tasks : [];
  if (items.length === 0) {
    return {
      summary: 'Запускаю волну подагентов',
      detail: '',
    };
  }

  const labels = items
    .map((task) => compactText(task?.label || task?.purpose || '', 48))
    .filter(Boolean)
    .slice(0, 3);

  return {
    summary: 'Запускаю волну подагентов',
    detail:
      labels.length > 0
        ? labels.join(' • ') + (items.length > labels.length ? ` +${items.length - labels.length}` : '')
        : `задач: ${items.length}`,
  };
}

export function buildSubagentQueuedPresentation(input: {
  purpose?: string;
  subagentType?: string;
  readonly?: boolean;
}): SubagentEventMeta {
  return {
    summary: 'Подагент поставлен в очередь',
    detail: compactText(input.purpose || 'Задача подагента', 180),
    metaText: describeSubagentMode(input.subagentType, input.readonly),
  };
}

export function buildSubagentStartPresentation(input: {
  purpose?: string;
  subagentType?: string;
  readonly?: boolean;
  files?: string[];
  mode?: string;
}): SubagentEventMeta {
  const files = Array.isArray(input.files) ? input.files : [];
  const detail = compactText(input.purpose || '', 180);
  const metaParts = [describeSubagentMode(input.subagentType, input.readonly)];
  if (files.length > 0) metaParts.push(`файлов: ${files.length}`);
  if (input.mode === 'direct') metaParts.push('прямое действие');

  return {
    summary:
      files.length > 0
        ? `Подагент изучает ${files.length} ${pluralizeFiles(files.length)}`
        : input.mode === 'direct'
          ? 'Подагент выполняет прямое действие'
          : 'Подагент начал работу',
    detail,
    metaText: metaParts.filter(Boolean).join(' • '),
  };
}

export function buildSubagentStepPresentation(input: {
  step?: number;
  retry?: number;
  maxAttempts?: number;
  retryUntilSuccess?: boolean;
  delayMs?: number;
  reason?: string;
  error?: string;
}): SubagentEventMeta {
  if (input.retry) {
    const attemptLabel = input.retryUntilSuccess
      ? `попытка ${input.retry}`
      : `попытка ${input.retry}/${input.maxAttempts || '?'}`;
    const detailParts = [attemptLabel];
    if (input.delayMs) {
      detailParts.push(`через ${Math.round(input.delayMs / 1000)}с`);
    }
    if (input.retryUntilSuccess) {
      detailParts.push('продолжаю до восстановления соединения');
    }
    if (input.reason) detailParts.push(compactText(input.reason, 72));
    if (input.error) detailParts.push(compactText(input.error, 72));
    return {
      summary: 'Повторяю запрос к модели подагента',
      detail: detailParts.join(' • '),
      metaText: input.retryUntilSuccess
        ? `повтор ${input.retry}`
        : `повтор ${input.retry}/${input.maxAttempts || '?'}`,
    };
  }

  return {
    summary: `Подагент выполняет шаг ${input.step || 1}`,
    detail: '',
    metaText: `шаг ${input.step || 1}`,
  };
}

export function buildSubagentToolPresentation(input: {
  tool?: string;
  args?: any;
  reasoning?: string;
}): SubagentEventMeta {
  const toolName = String(input.tool || '');
  const argsText = summarizeArgs(input.args);
  const displayName = getToolUserFacingName(toolName);
  return {
    summary: getToolStartSummary(toolName),
    detail: compactText(input.reasoning || argsText, 180),
    toolText: displayName + (argsText ? ` • ${argsText}` : ''),
    displayName,
  };
}

export function buildSubagentResultPresentation(input: {
  tool?: string;
  resultPreview?: string;
}): SubagentEventMeta {
  const toolName = String(input.tool || '');
  const execution = classifyToolExecutionResult(toolName, input.resultPreview || '');
  const resultSummary = getToolResultSummary(toolName, execution);
  const displayName = getToolUserFacingName(toolName);
  return {
    summary: resultSummary,
    detail: compactText(input.resultPreview || '', 180),
    toolText: `${displayName} • результат`,
    displayName,
    resultSummary,
  };
}

export function buildSubagentDonePresentation(input: { preview?: string }): SubagentEventMeta {
  return {
    summary: 'Подагент завершён',
    detail: compactText(input.preview || '', 180),
  };
}

export function buildSubagentSummarizedPresentation(input: { preview?: string }): SubagentEventMeta {
  return {
    summary: 'Подагент подготовил итог',
    detail: compactText(input.preview || '', 180),
  };
}

export function buildSubagentErrorPresentation(input: { error?: string }): SubagentEventMeta {
  return {
    summary: 'Подагент завершился с ошибкой',
    detail: compactText(input.error || '', 180),
  };
}

export function buildSubagentLifecyclePresentation(
  state: SubagentLifecycleState,
  input: {
    purpose?: string;
    subagentType?: string;
    readonly?: boolean;
    files?: string[];
    mode?: string;
    summary?: string;
    error?: string;
    degraded?: boolean;
  },
): SubagentEventMeta {
  if (state === 'planned') {
    return {
      summary: 'Подагент запланирован',
      detail: compactText(input.purpose || 'Задача подагента', 180),
      metaText: describeSubagentMode(input.subagentType, input.readonly),
    };
  }

  if (state === 'queued') {
    return {
      summary: 'Подагент поставлен в очередь',
      detail: compactText(input.purpose || 'Задача подагента', 180),
      metaText: describeSubagentMode(input.subagentType, input.readonly),
    };
  }

  if (state === 'running') {
    return {
      summary:
        input.mode === 'guided'
          ? 'Подагент ведёт направленный анализ'
          : input.mode === 'direct'
            ? 'Подагент выполняет прямое действие'
            : 'Подагент выполняется',
      detail: compactText(input.purpose || '', 180),
      metaText: [describeSubagentMode(input.subagentType, input.readonly), Array.isArray(input.files) && input.files.length > 0 ? `файлов: ${input.files.length}` : '', input.mode || '']
        .filter(Boolean)
        .join(' • '),
    };
  }

  if (state === 'done') {
    return {
      summary: input.degraded ? 'Подагент завершён с fallback' : 'Подагент завершён',
      detail: compactText(input.summary || '', 180),
    };
  }

  if (state === 'error') {
    return {
      summary: 'Подагент завершился с ошибкой',
      detail: compactText(input.error || '', 180),
    };
  }

  return {
    summary: input.degraded ? 'Подагент подготовил итог с fallback' : 'Подагент подготовил итог',
    detail: compactText(input.summary || '', 180),
  };
}

function pluralizeFiles(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return 'файл';
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'файла';
  return 'файлов';
}
