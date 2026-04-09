import type { AgentRecoveryKind } from './recovery';
import type { AgentTurnTransitionReason } from './transitions';

export type RuntimeFlowSummaryEntry = {
  kind: 'recovery' | 'transition';
  summary: string;
  detail?: string;
  transitionReason?: AgentTurnTransitionReason;
  recoveryKind?: AgentRecoveryKind;
};

export type RuntimeFlowSummaryPresentation = {
  summary: string;
  detail: string;
  activitySummary: string;
  count: number;
};

function compactText(text: string | undefined, maxLength = 180): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function hasReason(
  entries: RuntimeFlowSummaryEntry[],
  reason: AgentTurnTransitionReason,
): boolean {
  return entries.some((entry) => entry.kind === 'transition' && entry.transitionReason === reason);
}

function hasRecovery(
  entries: RuntimeFlowSummaryEntry[],
  kind: AgentRecoveryKind,
): boolean {
  return entries.some((entry) => entry.kind === 'recovery' && entry.recoveryKind === kind);
}

function buildSummary(entries: RuntimeFlowSummaryEntry[]): string {
  if (hasReason(entries, 'no_action_retry')) {
    return 'Добиваюсь явного следующего шага';
  }

  if (hasReason(entries, 'duplicate_tool')) {
    return 'Убираю повторный вызов';
  }

  if (
    hasReason(entries, 'verification_failed') ||
    hasReason(entries, 'verification_partial')
  ) {
    return 'Перестроил шаги после проверки';
  }

  if (
    hasReason(entries, 'final_answer_blocked_plan') ||
    hasReason(entries, 'final_answer_blocked_mutation') ||
    hasReason(entries, 'final_answer_blocked_verification')
  ) {
    return 'Уточнил путь к итоговому ответу';
  }

  if (
    hasReason(entries, 'recommended_tool_nudge') ||
    hasReason(entries, 'tool_search_nudge') ||
    hasReason(entries, 'retrieval_nudge') ||
    hasReason(entries, 'subagent_nudge') ||
    hasReason(entries, 'mutation_nudge')
  ) {
    return 'Скорректировал следующий шаг';
  }

  if (
    hasReason(entries, 'deferred_tool_nudge') ||
    hasReason(entries, 'interactive_tool_nudge')
  ) {
    return 'Убрал лишний или преждевременный шаг';
  }

  if (
    hasReason(entries, 'enter_plan_mode') ||
    hasReason(entries, 'plan_mode_suggestion') ||
    hasReason(entries, 'plan_mode_blocked_tool') ||
    hasReason(entries, 'plan_approval_rejected')
  ) {
    return 'Перестроил режим работы';
  }

  if (hasRecovery(entries, 'tool_error') || hasRecovery(entries, 'tool_blocked') || hasRecovery(entries, 'tool_degraded')) {
    return 'Перестроил маршрут после сбоя';
  }

  if (hasRecovery(entries, 'approval_rejected')) {
    return 'Учёл отклонённое подтверждение';
  }

  return 'Скорректировал ход выполнения';
}

function buildActivitySummary(entries: RuntimeFlowSummaryEntry[]): string {
  if (hasReason(entries, 'no_action_retry')) {
    return 'Добиваюсь явного следующего шага';
  }

  if (hasReason(entries, 'duplicate_tool')) {
    return 'Убираю повторный вызов';
  }

  if (
    hasReason(entries, 'verification_failed') ||
    hasReason(entries, 'verification_partial')
  ) {
    return 'Перестраиваю шаги после проверки';
  }

  if (
    hasReason(entries, 'final_answer_blocked_plan') ||
    hasReason(entries, 'final_answer_blocked_mutation') ||
    hasReason(entries, 'final_answer_blocked_verification')
  ) {
    return 'Подготавливаю путь к итоговому ответу';
  }

  if (
    hasReason(entries, 'recommended_tool_nudge') ||
    hasReason(entries, 'tool_search_nudge') ||
    hasReason(entries, 'retrieval_nudge') ||
    hasReason(entries, 'subagent_nudge') ||
    hasReason(entries, 'mutation_nudge')
  ) {
    return 'Перенаправляю следующий шаг';
  }

  if (
    hasReason(entries, 'deferred_tool_nudge') ||
    hasReason(entries, 'interactive_tool_nudge')
  ) {
    return 'Убираю преждевременный шаг';
  }

  if (
    hasReason(entries, 'enter_plan_mode') ||
    hasReason(entries, 'plan_mode_suggestion') ||
    hasReason(entries, 'plan_mode_blocked_tool') ||
    hasReason(entries, 'plan_approval_rejected')
  ) {
    return 'Перестраиваю режим работы';
  }

  if (hasRecovery(entries, 'tool_error') || hasRecovery(entries, 'tool_blocked') || hasRecovery(entries, 'tool_degraded')) {
    return 'Восстанавливаюсь после сбоя';
  }

  if (hasRecovery(entries, 'approval_rejected')) {
    return 'Учитываю отклонённое подтверждение';
  }

  return 'Корректирую ход выполнения';
}

function buildDetail(entries: RuntimeFlowSummaryEntry[]): string {
  const parts = Array.from(
    new Set(
      entries
        .flatMap((entry) => [entry.summary, entry.detail || ''])
        .map((value) => compactText(value, 72))
        .filter(Boolean),
    ),
  ).slice(0, 3);

  const extra = entries.length - parts.length;
  if (parts.length === 0) return entries.length > 0 ? `событий: ${entries.length}` : '';
  return parts.join(' • ') + (extra > 0 ? ` +${extra}` : '');
}

export function buildRuntimeFlowSummary(
  entries: RuntimeFlowSummaryEntry[],
): RuntimeFlowSummaryPresentation | null {
  if (entries.length < 2) return null;
  return {
    summary: buildSummary(entries),
    detail: buildDetail(entries),
    activitySummary: buildActivitySummary(entries),
    count: entries.length,
  };
}
