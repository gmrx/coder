import type { AgentProgressSnapshot, AgentProgressState } from './types';
import { createAgentContextWindowState, hydrateAgentContextWindow } from './contextWindow';

function compactText(text: string | undefined, maxLength = 160): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function toolLabel(meta: any): string {
  return String(meta?.displayName || meta?.tool || 'инструмент');
}

function summarizeArgs(args: any): string {
  if (!args || typeof args !== 'object') return '';
  const keys = Object.keys(args);
  const parts: string[] = [];

  for (const key of keys.slice(0, 2)) {
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
    }
  }

  return parts.join(' • ');
}

function summarizeToolStart(meta: any): string {
  if (meta?.startSummary) return String(meta.startSummary);
  return `Выполняю ${toolLabel(meta).toLowerCase()}`;
}

function summarizeToolResult(meta: any): string {
  if (meta?.resultSummary) return String(meta.resultSummary);
  return `${toolLabel(meta)} завершён`;
}

function summarizeApproval(meta: any): { summary: string; detail: string } {
  const kind = String(meta?.kind || '');
  const autoApproved = meta?.autoApproved === true;
  if (kind === 'shell') {
    return {
      summary: autoApproved ? 'Авторазрешаю команду' : 'Жду подтверждения команды',
      detail: compactText(meta?.command || '', 140),
    };
  }

  if (kind === 'plan') {
    return {
      summary: 'Жду согласования плана',
      detail: compactText(meta?.description || '', 140),
    };
  }

  if (kind === 'worktree') {
    return {
      summary: autoApproved ? 'Авторазрешаю действие с worktree' : 'Жду подтверждения действия с worktree',
      detail: compactText(meta?.worktreePath || meta?.originalRootPath || '', 140),
    };
  }

  if (kind === 'mcp') {
    return {
      summary: autoApproved ? 'Авторазрешаю вызов MCP' : 'Жду подтверждения вызова MCP',
      detail: compactText([meta?.server, meta?.mcpToolName].filter(Boolean).join(' • '), 140),
    };
  }

  return {
    summary: autoApproved ? 'Авторазрешаю изменение файла' : 'Жду подтверждения изменения файла',
    detail: compactText(meta?.filePath || '', 140),
  };
}

function setProgress(
  progress: AgentProgressSnapshot,
  state: AgentProgressState,
  summary: string,
  detail = '',
): boolean {
  const nextSummary = compactText(summary, 96);
  const nextDetail = compactText(detail, 180);
  if (
    progress.state === state &&
    progress.summary === nextSummary &&
    progress.detail === nextDetail
  ) {
    return false;
  }

  progress.state = state;
  progress.summary = nextSummary;
  progress.detail = nextDetail;
  progress.updatedAt = Date.now();
  return true;
}

function setProgressFromMeta(
  progress: AgentProgressSnapshot,
  state: AgentProgressState,
  meta: any,
  fallbackSummary: string,
  fallbackDetail = '',
): boolean {
  return setProgress(
    progress,
    state,
    compactText(meta?.summary || fallbackSummary, 96),
    compactText(meta?.detail || fallbackDetail, 180),
  );
}

export function createAgentProgressState(): AgentProgressSnapshot {
  return {
    state: 'idle',
    summary: '',
    detail: '',
    activitySummary: '',
    activityUpdatedAt: 0,
    backgroundSummary: '',
    backgroundUpdatedAt: 0,
    connectionState: 'idle',
    connectionSummary: '',
    connectionDetail: '',
    connectionRetryAttempt: 0,
    connectionDelayMs: 0,
    connectionUpdatedAt: 0,
    updatedAt: 0,
    lastCompletedSummary: '',
    lastCompletedDetail: '',
    lastCompletedAt: 0,
    context: createAgentContextWindowState(),
  };
}

function clearConnectionRetry(progress: AgentProgressSnapshot): void {
  if (
    progress.connectionState === 'idle' &&
    !progress.connectionSummary &&
    !progress.connectionDetail &&
    !progress.connectionRetryAttempt &&
    !progress.connectionDelayMs &&
    !progress.connectionUpdatedAt
  ) {
    return;
  }
  progress.connectionState = 'idle';
  progress.connectionSummary = '';
  progress.connectionDetail = '';
  progress.connectionRetryAttempt = 0;
  progress.connectionDelayMs = 0;
  progress.connectionUpdatedAt = 0;
}

function setConnectionRetry(
  progress: AgentProgressSnapshot,
  summary: string,
  detail: string,
  meta?: any,
): void {
  progress.connectionState = 'reconnecting';
  progress.connectionSummary = compactText(summary, 96);
  progress.connectionDetail = compactText(detail, 180);
  progress.connectionRetryAttempt = Number.isFinite(meta?.retry) ? Number(meta.retry) : 0;
  progress.connectionDelayMs = Number.isFinite(meta?.delayMs) ? Number(meta.delayMs) : 0;
  progress.connectionUpdatedAt = Date.now();
}

export function hydrateAgentProgress(
  progress: AgentProgressSnapshot,
  snapshot?: Partial<AgentProgressSnapshot> | null,
): void {
  const state = snapshot?.state;
  const isTransient = state === 'running' || state === 'waiting';
  progress.state =
    state === 'done' || state === 'error' || state === 'stopped' || state === 'idle'
      ? (isTransient ? 'idle' : state)
      : 'idle';
  progress.summary = isTransient ? '' : compactText(snapshot?.summary || '', 96);
  progress.detail = isTransient ? '' : compactText(snapshot?.detail || '', 180);
  progress.activitySummary = isTransient ? '' : compactText(snapshot?.activitySummary || '', 96);
  progress.activityUpdatedAt = Number.isFinite(snapshot?.activityUpdatedAt) ? Number(snapshot!.activityUpdatedAt) : 0;
  progress.backgroundSummary = isTransient ? '' : compactText(snapshot?.backgroundSummary || '', 140);
  progress.backgroundUpdatedAt = Number.isFinite(snapshot?.backgroundUpdatedAt) ? Number(snapshot!.backgroundUpdatedAt) : 0;
  progress.connectionState = isTransient ? 'idle' : (snapshot?.connectionState === 'reconnecting' ? 'reconnecting' : 'idle');
  progress.connectionSummary = isTransient ? '' : compactText(snapshot?.connectionSummary || '', 96);
  progress.connectionDetail = isTransient ? '' : compactText(snapshot?.connectionDetail || '', 180);
  progress.connectionRetryAttempt = isTransient ? 0 : (Number.isFinite(snapshot?.connectionRetryAttempt) ? Number(snapshot!.connectionRetryAttempt) : 0);
  progress.connectionDelayMs = isTransient ? 0 : (Number.isFinite(snapshot?.connectionDelayMs) ? Number(snapshot!.connectionDelayMs) : 0);
  progress.connectionUpdatedAt = isTransient ? 0 : (Number.isFinite(snapshot?.connectionUpdatedAt) ? Number(snapshot!.connectionUpdatedAt) : 0);
  progress.updatedAt = Number.isFinite(snapshot?.updatedAt) ? Number(snapshot!.updatedAt) : 0;
  progress.lastCompletedSummary = compactText(snapshot?.lastCompletedSummary || '', 96);
  progress.lastCompletedDetail = compactText(snapshot?.lastCompletedDetail || '', 180);
  progress.lastCompletedAt = Number.isFinite(snapshot?.lastCompletedAt) ? Number(snapshot!.lastCompletedAt) : 0;
  hydrateAgentContextWindow(progress.context, snapshot?.context);
}

export function startAgentProgress(progress: AgentProgressSnapshot, question: string): boolean {
  progress.lastCompletedSummary = '';
  progress.lastCompletedDetail = '';
  progress.lastCompletedAt = 0;
  clearConnectionRetry(progress);
  setActivity(progress, 'Разбираю запрос');
  return setProgress(progress, 'running', 'Собираю контекст', compactText(question, 160));
}

export function finishAgentProgress(
  progress: AgentProgressSnapshot,
  state: 'done' | 'error' | 'stopped',
  detail?: string,
): boolean {
  clearConnectionRetry(progress);
  const summary =
    state === 'done'
      ? 'Готово'
      : state === 'error'
        ? 'Во время выполнения возникла ошибка'
        : 'Запуск остановлен';
  return setProgress(progress, state, summary, detail || '');
}

function rememberCompleted(progress: AgentProgressSnapshot, summary: string, detail = ''): void {
  progress.lastCompletedSummary = compactText(summary, 96);
  progress.lastCompletedDetail = compactText(detail, 180);
  progress.lastCompletedAt = Date.now();
}

function setActivity(progress: AgentProgressSnapshot, summary: string): void {
  const nextSummary = compactText(summary, 96);
  if (!nextSummary || progress.activitySummary === nextSummary) return;
  progress.activitySummary = nextSummary;
  progress.activityUpdatedAt = Date.now();
}

export function updateAgentProgressFromStep(
  progress: AgentProgressSnapshot,
  phase: string,
  text: string,
  meta?: any,
): boolean {
  const isConnectionRetry =
    (phase === 'agent-think' || phase === 'subagent-step') &&
    meta?.retryUntilSuccess === true;

  if (!isConnectionRetry) {
    clearConnectionRetry(progress);
  }

  if (phase === 'agent-think') {
    if (isConnectionRetry) {
      const summary = compactText(meta?.summary || 'Нет соединения с API, продолжаю переподключение', 96);
      const detail = compactText(meta?.detail || text, 180);
      setConnectionRetry(progress, summary, detail, meta);
      setActivity(progress, 'Переподключаюсь к API');
      return setProgress(progress, 'waiting', summary, detail);
    }
    setActivity(progress, 'Планирую следующий шаг');
    return setProgress(progress, 'running', 'Планирую следующий шаг', text);
  }

  if (phase === 'agent-tool') {
    setActivity(progress, summarizeToolStart(meta));
    return setProgress(
      progress,
      'running',
      summarizeToolStart(meta),
      String(meta?.reasoning || summarizeArgs(meta?.args) || ''),
    );
  }

  if (phase === 'agent-action-sequence') {
    const totalActions = Number(meta?.totalActions) || 0;
    const summary = compactText(
      meta?.summary || (totalActions > 1 ? `Выполняю волну из ${totalActions} шагов` : 'Выполняю волну шагов'),
      96,
    );
    const detail = compactText(meta?.detail || '', 180);
    setActivity(progress, summary);
    return setProgress(progress, 'running', summary, detail);
  }

  if (phase === 'agent-result') {
    rememberCompleted(progress, summarizeToolResult(meta), meta?.resultPreview || '');
    return setProgress(progress, 'running', summarizeToolResult(meta), meta?.resultPreview || '');
  }

  if (phase === 'tool-batch-child-start') {
    const label = compactText(meta?.displayName || toolLabel(meta), 72);
    const position = meta?.index && meta?.total ? `${meta.index}/${meta.total}` : '';
    setActivity(progress, 'Выполняю пакет утилит');
    return setProgress(
      progress,
      'running',
      position ? `Пакет утилит • ${position}` : 'Выполняю пакет утилит',
      label,
    );
  }

  if (phase === 'tool-batch-child-result') {
    const summary = compactText(meta?.resultSummary || 'Шаг пакета завершён', 96);
    const detail = compactText(meta?.resultDetail || meta?.resultPreview || '', 180);
    setActivity(progress, 'Собираю результаты пакета');
    rememberCompleted(progress, summary, detail);
    return setProgress(progress, 'running', summary, detail);
  }

  if (phase === 'agent-tool-summary') {
    const summary = compactText(meta?.summary || text || 'Подготовил сводку по шагам', 96);
    const detail = compactText(meta?.detail || '', 180);
    setActivity(progress, meta?.activitySummary || summary);
    rememberCompleted(progress, summary, detail);
    return setProgress(progress, 'running', summary, detail);
  }

  if (phase === 'agent-flow-summary') {
    const summary = compactText(meta?.summary || text || 'Скорректировал ход выполнения', 96);
    const detail = compactText(meta?.detail || '', 180);
    setActivity(progress, meta?.activitySummary || summary);
    rememberCompleted(progress, summary, detail);
    return setProgress(progress, 'running', summary, detail);
  }

  if (phase === 'agent-auto') {
    setActivity(progress, meta?.summary || 'Собираю стартовый контекст');
    return setProgressFromMeta(progress, 'running', meta, 'Собираю стартовый контекст', toolLabel(meta));
  }

  if (phase === 'agent-auto-done') {
    rememberCompleted(progress, 'Стартовый контекст обновлён', toolLabel(meta));
    return setProgressFromMeta(progress, 'running', meta, 'Стартовый контекст обновлён', toolLabel(meta));
  }

  if (phase === 'approval-request') {
    const approval = summarizeApproval(meta);
    setActivity(progress, approval.summary);
    return setProgressFromMeta(progress, meta?.autoApproved ? 'running' : 'waiting', meta, approval.summary, approval.detail);
  }

  if (phase === 'question-request') {
    const summary = compactText(meta?.summary || text || 'Жду ответа пользователя', 96);
    const detail = compactText(meta?.detail || '', 180);
    setActivity(progress, summary);
    return setProgressFromMeta(progress, 'waiting', meta, summary, detail);
  }

  if (phase === 'subagent-batch') {
    const count = Array.isArray(meta?.tasks) ? meta.tasks.length : 0;
    setActivity(progress, 'Координирую подагентов');
    return setProgressFromMeta(progress, 'running', meta, 'Запускаю волну подагентов', count > 0 ? `задач: ${count}` : '');
  }

  if (phase === 'subagent-start') {
    setActivity(progress, 'Веду подагента');
    return setProgressFromMeta(progress, 'running', meta, 'Подагент выполняется', meta?.label || meta?.purpose || '');
  }

  if (phase === 'subagent-step') {
    if (isConnectionRetry) {
      const summary = compactText(meta?.summary || 'Подагент ждёт восстановление API', 96);
      const detail = compactText(meta?.detail || text, 180);
      setConnectionRetry(progress, summary, detail, meta);
      setActivity(progress, 'Жду восстановление API для подагента');
      return setProgress(progress, 'waiting', summary, detail);
    }
    setActivity(progress, 'Координирую подагента');
    return setProgressFromMeta(progress, 'running', meta, 'Подагент продолжает работу', '');
  }

  if (phase === 'subagent-tool') {
    setActivity(progress, 'Собираю результаты от подагента');
    return setProgressFromMeta(progress, 'running', meta, 'Подагент выполняет действие', meta?.toolText || '');
  }

  if (phase === 'subagent-result') {
    setActivity(progress, 'Собираю результаты от подагента');
    rememberCompleted(progress, compactText(meta?.summary || 'Подагент получил результат', 96), compactText(meta?.detail || meta?.resultPreview || '', 180));
    return setProgressFromMeta(progress, 'running', meta, 'Подагент получил результат', meta?.resultPreview || '');
  }

  if (phase === 'subagent-done' || phase === 'subagent-summarized') {
    setActivity(progress, 'Собираю результаты от подагентов');
    rememberCompleted(progress, compactText(meta?.summary || 'Подагент завершён', 96), compactText(meta?.detail || meta?.preview || '', 180));
    return setProgressFromMeta(progress, 'running', meta, 'Подагент завершён', meta?.preview || '');
  }

  if (phase === 'subagent-error') {
    setActivity(progress, 'Перестраиваю работу подагента');
    return setProgressFromMeta(progress, 'running', meta, 'Подагент завершился с ошибкой', meta?.error || '');
  }

  if (phase === 'agent-answer') {
    setActivity(progress, 'Готовлю итоговый ответ');
    return setProgress(progress, 'running', 'Формирую итоговый ответ', text);
  }

  if (phase === 'agent-recovery') {
    setActivity(progress, meta?.summary || 'Перестраиваю следующий шаг');
    return setProgress(
      progress,
      'running',
      compactText(meta?.summary || text || 'Перестраиваю следующий шаг', 96),
      compactText(meta?.detail || '', 180),
    );
  }

  if (phase === 'agent-transition') {
    setActivity(progress, meta?.summary || 'Перехожу к следующему шагу');
    return setProgress(
      progress,
      'running',
      compactText(meta?.summary || text || 'Перехожу к следующему шагу', 96),
      compactText(meta?.detail || '', 180),
    );
  }

  if (phase === 'agent-plan-approval') {
    const status = String(meta?.status || '');
    if (status === 'requested') {
      setActivity(progress, 'Жду согласования плана');
      return setProgressFromMeta(progress, 'waiting', meta, 'Жду согласования плана', '');
    }
    if (status === 'approved') {
      setActivity(progress, 'Продолжаю после согласования плана');
      rememberCompleted(progress, 'План согласован', '');
      return setProgressFromMeta(progress, 'running', meta, 'План согласован', '');
    }
    if (status === 'rejected') {
      setActivity(progress, 'Дорабатываю план');
      return setProgressFromMeta(progress, 'running', meta, 'Дорабатываю план', '');
    }
    if (status === 'cancelled') {
      setActivity(progress, 'Согласование плана прервано');
      return setProgressFromMeta(progress, 'stopped', meta, 'Согласование плана прервано', '');
    }
  }

  if (phase === 'agent-mode') {
    if (meta?.mode === 'plan') {
      setActivity(progress, 'Работаю в режиме плана');
      return setProgressFromMeta(progress, 'running', meta, 'Работаю в режиме плана', text);
    }
    if (meta?.mode === 'normal') {
      setActivity(progress, 'Продолжаю обычный запуск');
      return setProgressFromMeta(progress, 'running', meta, 'Продолжаю обычный запуск', text);
    }
  }

  if (phase === 'agent-todos') {
    const count = Array.isArray(meta?.todos) ? meta.todos.length : 0;
    setActivity(progress, 'Уточняю план работ');
    rememberCompleted(progress, 'План работ обновлён', count > 0 ? `задач: ${count}` : '');
    return setProgressFromMeta(progress, 'running', meta, 'Обновляю план работ', count > 0 ? `задач: ${count}` : '');
  }

  return false;
}
