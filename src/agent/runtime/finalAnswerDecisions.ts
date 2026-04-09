import type { AgentAction } from '../prompt';
import {
  buildMutationRequiredWorkflowPrompt,
  buildPlanModeFinalAnswerNudgeContract,
  buildVerificationWorkflowPrompt,
  shouldRequireVerificationByWorkflow,
} from '../tooling/catalog';
import type { AgentSession } from './agentSession';
import type { TurnLoopState } from './turnState';
import { createContinuationDecision, type TurnContinuationDecision } from './decisionFactory';

export function evaluateFinalAnswerDecision(
  session: AgentSession,
  state: TurnLoopState,
  action: AgentAction,
): TurnContinuationDecision | null {
  if (action.tool === 'none' || action.tool === 'noop') {
    return createContinuationDecision(
      state,
      'none_tool_to_final',
      'Служебный tool none/noop не нужен, если фактов уже хватает.',
      'Ты вернул служебный tool ("none/noop"), значит данных достаточно. Сразу переходи к final_answer и затем дай итоговый markdown-ответ без JSON.',
    );
  }

  if (action.tool !== 'final_answer') return null;

  if (state.lastToolStatus === 'error' || state.lastToolStatus === 'blocked') {
    return createContinuationDecision(
      state,
      'no_action_retry',
      'Последний шаг завершился ошибкой или блокировкой, сначала нужен recovery.',
      'Последний инструмент завершился ошибкой или блокировкой. Не переходи к final_answer. Сначала исправь этот шаг, выбери другой инструмент или задай ask_user, если без пользователя нельзя продолжать.',
    );
  }

  if (session.requiresFreshMcpFacts() && !session.hasFreshMcpContextForCurrentRun()) {
    return createContinuationDecision(
      state,
      'final_answer_blocked_mcp_freshness',
      'Для вопроса про MCP сначала нужны свежие MCP-данные текущего запуска.',
      session.buildFreshMcpWorkflowPrompt(),
    );
  }

  if (session.isPlanMode()) {
    return createContinuationDecision(
      state,
      'final_answer_blocked_plan',
      'В режиме плана сначала нужен exit_plan_mode.',
      buildPlanModeFinalAnswerNudgeContract(),
    );
  }

  if (session.shouldBlockFinalAnswerWithoutMutation()) {
    return createContinuationDecision(
      state,
      'final_answer_blocked_mutation',
      'Изменения в workspace ещё не выполнены.',
      buildMutationRequiredWorkflowPrompt(),
    );
  }

  if (
    shouldRequireVerificationByWorkflow({
      mutationQuery: session.mutationQuery,
      workspaceMutations: session.memory.workspaceMutations,
      modelUsedTools: session.modelUsedTools,
    })
  ) {
    return createContinuationDecision(
      state,
      'final_answer_blocked_verification',
      'Перед завершением нужен verification_agent.',
      buildVerificationWorkflowPrompt(),
    );
  }

  return null;
}
