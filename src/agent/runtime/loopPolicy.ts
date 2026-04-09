import type { RetryNotice } from '../../core/modelClient';
import type { AgentMemory } from '../runnerMemory';
import { buildMemorySnapshot, hasEnoughContext } from '../runnerMemory';

export const MAX_CONSECUTIVE_DUPES = 3;
export const TOOL_CALL_TEMPERATURE = 0.15;
export const FINAL_ANSWER_TEMPERATURE = 0.5;

export function buildRetryMessage(
  step: number,
  prefix: string,
  retry: RetryNotice,
): { text: string; meta: Record<string, any> } {
  const delaySeconds = Math.max(1, Math.round(retry.delayMs / 1000));
  const retryLabel = retry.retryUntilSuccess
    ? `повтор ${retry.attempt}`
    : `повтор ${retry.attempt}/${retry.maxAttempts ?? '?'}`;
  const suffix = retry.retryUntilSuccess
    ? 'Продолжаю пробовать до восстановления соединения.'
    : '';
  const connectionSummary = retry.retryUntilSuccess
    ? 'Нет соединения с API, продолжаю переподключение'
    : prefix;
  const connectionDetailParts = [];
  if (retry.status) connectionDetailParts.push(`HTTP ${retry.status}`);
  connectionDetailParts.push(retryLabel);
  connectionDetailParts.push(`следующая попытка через ${delaySeconds}с`);
  if (retry.error) connectionDetailParts.push(retry.error);
  return {
    text: suffix
      ? `${prefix} ${retryLabel} через ${delaySeconds}с. ${suffix}`
      : `${prefix} ${retryLabel} через ${delaySeconds}с.`,
    meta: {
      step,
      retry: retry.attempt,
      maxAttempts: retry.maxAttempts ?? null,
      retryUntilSuccess: !!retry.retryUntilSuccess,
      delayMs: retry.delayMs,
      reason: retry.reason,
      status: retry.status,
      error: retry.error,
      summary: connectionSummary,
      detail: connectionDetailParts.join(' • '),
      connectionState: retry.retryUntilSuccess ? 'reconnecting' : 'idle',
    },
  };
}

export function shouldSendEnoughContextReminder(
  iteration: number,
  enoughContextNudgeSent: boolean,
  question: string,
  memory: AgentMemory,
  options: { freshMcpRequired?: boolean } = {},
): boolean {
  return !enoughContextNudgeSent && iteration >= 8 && hasEnoughContext(question, memory, options);
}

export function buildEnoughContextReminder(memory: AgentMemory): string {
  return (
    buildMemorySnapshot(memory) +
    '\n\n[Система] Контекста уже достаточно для цели пользователя. Не делай лишних шагов: если нет критичных пробелов, переходи к final_answer.'
  );
}
