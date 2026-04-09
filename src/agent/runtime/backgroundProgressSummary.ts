import type { AgentProgressSnapshot } from './types';

type BackgroundProgressEvent = {
  summary: string;
  detail: string;
  at: number;
};

export type BackgroundProgressState = {
  events: BackgroundProgressEvent[];
  pendingEvents: number;
  lastComputedAt: number;
};

const MAX_EVENTS = 10;
const SUMMARY_REFRESH_INTERVAL_MS = 15_000;
const MIN_PENDING_EVENTS = 3;

function compactText(text: string | undefined, maxLength = 160): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function toSentenceStart(text: string): string {
  const value = compactText(text, 120);
  if (!value) return '';
  return value.charAt(0).toLowerCase() + value.slice(1);
}

export function createBackgroundProgressState(): BackgroundProgressState {
  return {
    events: [],
    pendingEvents: 0,
    lastComputedAt: 0,
  };
}

export function resetBackgroundProgressState(state: BackgroundProgressState): void {
  state.events = [];
  state.pendingEvents = 0;
  state.lastComputedAt = 0;
}

export function recordBackgroundProgressEvent(
  state: BackgroundProgressState,
  phase: string,
  text: string,
  meta?: any,
): void {
  const summary = selectSummaryForPhase(phase, text, meta);
  if (!summary) return;

  const detail = compactText(meta?.detail || '', 140);
  const last = state.events[state.events.length - 1];
  if (last && last.summary === summary && last.detail === detail) {
    return;
  }

  state.events.push({
    summary,
    detail,
    at: Date.now(),
  });
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(-MAX_EVENTS);
  }
  state.pendingEvents++;
}

export function maybeRefreshBackgroundProgressSummary(
  progress: AgentProgressSnapshot,
  state: BackgroundProgressState,
  now = Date.now(),
  force = false,
): boolean {
  if (!force) {
    if (state.pendingEvents < MIN_PENDING_EVENTS) return false;
    if (state.lastComputedAt && now - state.lastComputedAt < SUMMARY_REFRESH_INTERVAL_MS) return false;
  }

  const nextSummary = buildBackgroundProgressSummary(progress, state.events);
  state.lastComputedAt = now;
  state.pendingEvents = 0;

  if (progress.backgroundSummary === nextSummary) {
    return false;
  }

  progress.backgroundSummary = nextSummary;
  progress.backgroundUpdatedAt = now;
  return true;
}

function buildBackgroundProgressSummary(
  progress: AgentProgressSnapshot,
  events: BackgroundProgressEvent[],
): string {
  const recentSummaries = Array.from(
    new Set(
      events
        .map((event) => compactText(event.summary, 88))
        .filter(Boolean),
    ),
  ).slice(-3);

  const activity = compactText(progress.activitySummary, 96);
  const latest = recentSummaries[recentSummaries.length - 1] || '';
  const previous = recentSummaries.length > 1 ? recentSummaries[recentSummaries.length - 2] : '';

  if (activity && latest && activity !== latest) {
    if (previous && previous !== latest && previous !== activity) {
      return `${previous}. ${latest}. Сейчас ${toSentenceStart(activity)}.`;
    }
    return `${latest}. Сейчас ${toSentenceStart(activity)}.`;
  }

  if (latest && previous && latest !== previous) {
    return `${previous}. ${latest}.`;
  }

  if (latest) {
    return latest;
  }

  if (activity) {
    return `Сейчас ${toSentenceStart(activity)}.`;
  }

  return '';
}

function selectSummaryForPhase(phase: string, text: string, meta?: any): string {
  if ((phase === 'agent-think' || phase === 'subagent-step') && meta?.retryUntilSuccess) {
    return compactText(meta?.summary || 'Жду восстановление API', 96);
  }

  if (phase === 'agent-tool-summary' || phase === 'agent-flow-summary') {
    return compactText(meta?.summary || text, 96);
  }

  if (phase === 'approval-request') {
    if (meta?.autoApproved) {
      return compactText(meta?.summary || text || 'Подтверждение пропущено по настройке', 96);
    }
    return compactText(meta?.summary || text || 'Жду подтверждения', 96);
  }

  if (phase === 'question-request') {
    return compactText(meta?.summary || text || 'Жду ответа пользователя', 96);
  }

  if (
    phase === 'subagent-batch' ||
    phase === 'subagent-start' ||
    phase === 'subagent-done' ||
    phase === 'subagent-error' ||
    phase === 'subagent-summarized'
  ) {
    return compactText(meta?.summary || text, 96);
  }

  if (phase === 'agent-recovery' || phase === 'agent-transition') {
    return compactText(meta?.summary || text, 96);
  }

  if (phase === 'agent-answer') {
    return compactText(text || 'Формирую итоговый ответ', 96);
  }

  if (phase === 'agent-plan-approval' || phase === 'agent-todos' || phase === 'agent-mode') {
    return compactText(meta?.summary || text, 96);
  }

  return '';
}
