export type AgentTurnTransitionReason =
  | 'none_tool_to_final'
  | 'enter_plan_mode'
  | 'plan_approval_rejected'
  | 'final_answer_blocked_plan'
  | 'final_answer_blocked_mutation'
  | 'final_answer_blocked_verification'
  | 'final_answer_blocked_mcp_freshness'
  | 'todo_suggestion'
  | 'todo_updated'
  | 'plan_mode_suggestion'
  | 'plan_mode_blocked_tool'
  | 'deferred_tool_nudge'
  | 'interactive_tool_nudge'
  | 'tool_search_nudge'
  | 'recommended_tool_nudge'
  | 'retrieval_nudge'
  | 'subagent_nudge'
  | 'mutation_nudge'
  | 'duplicate_tool'
  | 'subagent_followup'
  | 'verification_failed'
  | 'verification_partial'
  | 'verification_passed'
  | 'trace_file_guard'
  | 'forced_subagent_recovery'
  | 'bootstrap_recovery'
  | 'no_action_retry'
  | 'fallback_final_answer';

export type AgentTurnTransition = {
  step: number;
  reason: AgentTurnTransitionReason;
  summary: string;
  detail: string;
  toolName?: string;
};

export function createTurnTransition(
  step: number,
  reason: AgentTurnTransitionReason,
  detail = '',
  toolName?: string,
): AgentTurnTransition {
  return {
    step,
    reason,
    summary: summarizeTransitionReason(reason),
    detail: String(detail || '').trim(),
    toolName,
  };
}

function summarizeTransitionReason(reason: AgentTurnTransitionReason): string {
  switch (reason) {
    case 'none_tool_to_final':
      return 'Перехожу к итоговому ответу';
    case 'enter_plan_mode':
      return 'Перехожу в режим плана';
    case 'plan_approval_rejected':
      return 'Дорабатываю план';
    case 'final_answer_blocked_plan':
      return 'План ещё не завершён';
    case 'final_answer_blocked_mutation':
      return 'Нужна реальная правка';
    case 'final_answer_blocked_verification':
      return 'Нужна независимая проверка';
    case 'final_answer_blocked_mcp_freshness':
      return 'Нужны свежие данные MCP';
    case 'todo_suggestion':
      return 'Сначала раскладываю работу на шаги';
    case 'todo_updated':
      return 'План работ обновлён';
    case 'plan_mode_suggestion':
      return 'Сначала строю план';
    case 'plan_mode_blocked_tool':
      return 'Этот шаг недоступен в режиме плана';
    case 'deferred_tool_nudge':
      return 'Откладываю преждевременный шаг';
    case 'interactive_tool_nudge':
      return 'Сначала собираю контекст для шага с подтверждением';
    case 'tool_search_nudge':
      return 'Сначала уточняю нужный инструмент';
    case 'recommended_tool_nudge':
      return 'Использую уже найденный инструмент';
    case 'retrieval_nudge':
      return 'Сужаю область через retrieval';
    case 'subagent_nudge':
      return 'Перехожу к параллельному анализу';
    case 'mutation_nudge':
      return 'Перехожу от анализа к правке';
    case 'duplicate_tool':
      return 'Не повторяю тот же вызов';
    case 'subagent_followup':
      return 'Разбираю результаты подагентов';
    case 'verification_failed':
      return 'Исправляю проблему после проверки';
    case 'verification_partial':
      return 'Добираю недостающую проверку';
    case 'verification_passed':
      return 'Проверка завершена успешно';
    case 'trace_file_guard':
      return 'Возвращаю фокус на исходный код';
    case 'forced_subagent_recovery':
      return 'Делаю обязательную волну подагентов';
    case 'bootstrap_recovery':
      return 'Беру стартовый контекст автоматически';
    case 'no_action_retry':
      return 'Нужен явный следующий шаг';
    case 'fallback_final_answer':
      return 'Формирую итог из собранных фактов';
    default:
      return 'Перехожу к следующему шагу';
  }
}
