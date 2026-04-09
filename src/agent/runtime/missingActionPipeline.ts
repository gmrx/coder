import {
  buildForcedSubagentWorkflowPrompt,
  buildNoActionRetryWorkflowPrompt,
  shouldForceSubagentRecoveryByWorkflow,
} from '../tooling/catalog';
import type { AgentAction } from '../prompt';
import type { AgentSession } from './agentSession';
import { createContinuationDecision, type TurnContinuationDecision } from './decisionFactory';
import type { TurnLoopState } from './turnState';
import { createTurnTransition, type AgentTurnTransition } from './transitions';

export type MissingActionDecision =
  | { kind: 'continue'; decision: TurnContinuationDecision }
  | { kind: 'execute_tool'; action: AgentAction; transition: AgentTurnTransition }
  | { kind: 'fallback_final'; transition: AgentTurnTransition }
  | { kind: 'error'; message: string };

export type MissingActionEvaluator = (
  session: AgentSession,
  state: TurnLoopState,
) => MissingActionDecision | null;

const MISSING_ACTION_PIPELINE: MissingActionEvaluator[] = [
  evaluateForcedSubagentRecovery,
  evaluateBootstrapReadOnlyAction,
  evaluateNoActionRetry,
  evaluateFallbackFinal,
];

export function evaluateMissingActionPipeline(
  session: AgentSession,
  state: TurnLoopState,
): MissingActionDecision {
  for (const evaluate of MISSING_ACTION_PIPELINE) {
    const decision = evaluate(session, state);
    if (decision) return decision;
  }

  return {
    kind: 'error',
    message: 'Не удалось распарсить корректный JSON-вызов утилиты после нескольких попыток. Сформулируй запрос иначе или сузь задачу.',
  };
}

function evaluateForcedSubagentRecovery(
  session: AgentSession,
  state: TurnLoopState,
): MissingActionDecision | null {
  if (
    !shouldForceSubagentRecoveryByWorkflow({
      subagentUsed: state.subagentUsed,
      subagentRecoveryNudgeSent: state.subagentRecoveryNudgeSent,
      question: session.lastQuestion,
      usedCalls: session.usedCalls,
    })
  ) {
    return null;
  }

  state.subagentRecoveryNudgeSent = true;
  state.noActionRetryCount = 0;
  return {
    kind: 'continue',
    decision: createDecision(
      state,
      'forced_subagent_recovery',
      'Линейного чтения уже достаточно, пора распараллелить анализ.',
      buildForcedSubagentWorkflowPrompt(),
    ),
  };
}

function evaluateNoActionRetry(
  session: AgentSession,
  state: TurnLoopState,
): MissingActionDecision | null {
  if (state.noActionRetryCount >= 3) return null;

  state.noActionRetryCount++;
  return {
    kind: 'continue',
    decision: createDecision(
      state,
      'no_action_retry',
      'Модель не вернула корректный tool call.',
      buildNoActionRetryWorkflowPrompt(session.getToolSearchRecommendation()),
    ),
  };
}

function evaluateBootstrapReadOnlyAction(
  session: AgentSession,
  state: TurnLoopState,
): MissingActionDecision | null {
  if (state.lastToolUsed) return null;
  if (state.noActionRetryCount < 1) return null;

  const action = chooseBootstrapAction(session);
  if (!action) return null;

  state.noActionRetryCount = 0;
  return {
    kind: 'execute_tool',
    action,
    transition: createTurnTransition(
      state.iteration,
      'bootstrap_recovery',
      `Модель не выбрала стартовый шаг. Автоматически беру безопасный read-only обзор через ${action.tool}.`,
      action.tool,
    ),
  };
}

function evaluateFallbackFinal(
  session: AgentSession,
  state: TurnLoopState,
): MissingActionDecision | null {
  if (state.lastToolStatus === 'error' || state.lastToolStatus === 'blocked') {
    return null;
  }
  if (session.requiresFreshMcpFacts() && !session.hasFreshMcpContextForCurrentRun()) {
    return null;
  }
  if (session.usedCalls.size < 2) return null;

  return {
    kind: 'fallback_final',
    transition: createTurnTransition(
      state.iteration,
      'fallback_final_answer',
      'JSON больше не получается, но фактов уже достаточно для финализации.',
    ),
  };
}

function createDecision(
  state: TurnLoopState,
  reason: AgentTurnTransition['reason'],
  detail: string,
  prompt?: string,
): TurnContinuationDecision {
  return createContinuationDecision(state, reason, detail, prompt);
}

function chooseBootstrapAction(session: AgentSession): AgentAction | null {
  const question = session.lastQuestion;
  const text = String(question || '').trim().toLowerCase();
  if (!text) return null;

  if (session.requiresFreshMcpFacts()) {
    return {
      tool: 'list_mcp_tools',
      reasoning: 'Модель не выбрала стартовый шаг. Сначала получаю свежий каталог MCP-инструментов для внешней системы.',
      args: {},
    };
  }

  if (isBroadProjectQuestion(text)) {
    return {
      tool: 'tool_batch',
      reasoning: 'Модель не выбрала стартовый шаг. Беру безопасный обзор проекта автоматически.',
      args: {
        tools: [
          { tool: 'scan_structure', args: { outputMode: 'overview' } },
          { tool: 'detect_stack', args: { outputMode: 'summary' } },
        ],
      },
    };
  }

  return {
    tool: 'find_relevant_files',
    reasoning: 'Модель не выбрала стартовый шаг. Сначала подбираю релевантные файлы автоматически.',
    args: {
      query: question,
      outputMode: 'summary',
      limit: 8,
    },
  };
}

function isBroadProjectQuestion(text: string): boolean {
  return [
    'изучи проект',
    'изучи кодовую базу',
    'изучи кодовую',
    'изучи репозиторий',
    'расскажи о проекте',
    'обзор проекта',
    'разберись в проекте',
    'разберись в кодовой базе',
    'пойми проект',
    'пойми кодовую базу',
    'что это за проект',
    'как устроен проект',
    'архитектура проекта',
    'кодовая база',
    'repo overview',
    'project overview',
    'codebase overview',
  ].some((needle) => text.includes(needle));
}
