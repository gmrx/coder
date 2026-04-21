import type { AgentAction } from '../prompt';
import { buildDuplicateToolWorkflowPrompt, canRetrySameToolCall } from '../tooling/catalog';
import { extractToolSearchRecommendation } from '../tooling/definitions/toolSearch';
import type { ToolExecutionStatus } from '../tooling/results';
import { createContinuationDecision, type TurnContinuationDecision } from './decisionFactory';
import type { AgentSession } from './agentSession';
import type { TurnLoopState } from './turnState';

export function evaluateDuplicateDecision(
  session: AgentSession,
  state: TurnLoopState,
  action: AgentAction,
): TurnContinuationDecision | null {
  const callKey = session.buildToolCallKey(action.tool, action.args || {});
  const previous = session.getToolCallRecord(callKey);
  if (!previous) return null;
  if (canRetrySameToolCall(previous.toolName, previous.status, previous.attempts)) {
    return null;
  }

  state.consecutiveDupes++;
  const specialized = buildSpecializedDuplicateDecision(state, action, previous);
  if (specialized) return specialized;
  return createContinuationDecision(
    state,
    'duplicate_tool',
    buildDuplicateSummary(action.tool, previous.status, previous.attempts, session.getToolSearchRecommendation()),
    buildDuplicateToolWorkflowPrompt(action.tool, previous.status, previous.attempts, session.getToolSearchRecommendation()),
    action.tool,
  );
}

function buildSpecializedDuplicateDecision(
  state: TurnLoopState,
  action: AgentAction,
  previous: {
    toolName: string;
    status: ToolExecutionStatus;
    attempts: number;
    lastContent: string;
    recommendation?: ReturnType<AgentSession['getToolSearchRecommendation']>;
  },
): TurnContinuationDecision | null {
  if (action.tool !== 'tool_search' || previous.status !== 'success') {
    return null;
  }

  const recommendation = extractToolSearchRecommendation(previous.lastContent);
  const directRecommendation = previous.recommendation || recommendation;
  if (!directRecommendation?.toolName) {
    return null;
  }

  const suffix = previous.attempts > 1 ? ` после ${previous.attempts} одинаковых поисков` : '';
  const summary = `Повторный tool_search${suffix}; подходящий инструмент уже найден: ${directRecommendation.toolName}.`;
  const prompt = directRecommendation.nextStep
    ? (
      `Ты уже выполнил такой же tool_search и получил рекомендацию: ${directRecommendation.toolName}.\n` +
      `Не повторяй поиск без новой информации. Следующим ходом вызови рекомендованный инструмент.\n` +
      `Готовый шаблон:\n${directRecommendation.nextStep}`
    )
    : (
      `Ты уже выполнил такой же tool_search и получил рекомендацию: ${directRecommendation.toolName}.\n` +
      'Не повторяй поиск без новой информации. Следующим ходом вызови рекомендованный инструмент.'
    );

  return createContinuationDecision(
    state,
    'duplicate_tool',
    summary,
    prompt,
    action.tool,
  );
}

function buildDuplicateSummary(
  toolName: string,
  status: ToolExecutionStatus,
  attempts: number,
  recommendation: ReturnType<AgentSession['getToolSearchRecommendation']>,
): string {
  const suffix = attempts > 1 ? ` после ${attempts} одинаковых попыток` : '';
  const recommendationSuffix =
    recommendation?.toolName && recommendation.toolName !== toolName
      ? ` Подходящий альтернативный шаг уже найден: ${recommendation.toolName}.`
      : '';
  return `Повторный вызов ${toolName} с теми же аргументами после статуса ${formatStatus(status)}${suffix}.${recommendationSuffix}`;
}

function formatStatus(status: ToolExecutionStatus): string {
  switch (status) {
    case 'success':
      return 'успеха';
    case 'blocked':
      return 'блокировки';
    case 'degraded':
      return 'частичного результата';
    case 'error':
      return 'ошибки';
  }
}
