import type { AgentAction } from '../prompt';
import {
  buildDeferredToolWorkflowNudgePrompt,
  buildInteractiveToolWorkflowNudgePrompt,
  buildMutationWorkflowNudgePrompt,
  buildPlanModeBlockedWorkflowPrompt,
  buildPlanModeWorkflowPrompt,
  buildRecommendedToolWorkflowNudgePrompt,
  buildRetrievalWorkflowNudgePrompt,
  buildSubagentWorkflowNudgePrompt,
  buildTodoWriteWorkflowPrompt,
  buildToolSearchWorkflowNudgePrompt,
  shouldSendDeferredToolNudgeByWorkflow,
  shouldSendInteractiveToolNudgeByWorkflow,
  shouldSendMutationNudgeByWorkflow,
  shouldSendRecommendedToolNudgeByWorkflow,
  shouldSendRetrievalNudgeByWorkflow,
  shouldSendSubagentNudgeByWorkflow,
  shouldSendToolSearchNudgeByWorkflow,
  shouldSuggestPlanModeByWorkflow,
  shouldSuggestTodoWriteByWorkflow,
} from '../tooling/catalog';
import type { AgentSession } from './agentSession';
import { createContinuationDecision, type TurnContinuationDecision } from './decisionFactory';
import { isToolBlockedInPlanMode } from './planMode';
import type { TurnLoopState } from './turnState';

export function evaluateNudgeDecision(
  session: AgentSession,
  state: TurnLoopState,
  action: AgentAction,
): TurnContinuationDecision | null {
  if (
    shouldSuggestTodoWriteByWorkflow({
      question: session.lastQuestion,
      iteration: state.iteration,
      actionTool: action.tool,
      modelUsedTools: session.modelUsedTools,
    }) &&
    !state.todoNudgeSent
  ) {
    state.todoNudgeSent = true;
    return createContinuationDecision(
      state,
      'todo_suggestion',
      'Задача выглядит многошаговой.',
      buildTodoWriteWorkflowPrompt(),
    );
  }

  if (
    shouldSuggestPlanModeByWorkflow(session.lastQuestion, state.iteration, action.tool) &&
    !session.isPlanMode() &&
    !state.planModeCompleted
  ) {
    return createContinuationDecision(
      state,
      'plan_mode_suggestion',
      'Сначала стоит согласовать подход.',
      buildPlanModeWorkflowPrompt(),
    );
  }

  if (session.isPlanMode() && isToolBlockedInPlanMode(action.tool, action.args || {})) {
    return createContinuationDecision(
      state,
      'plan_mode_blocked_tool',
      `Инструмент ${action.tool} недоступен в режиме плана.`,
      buildPlanModeBlockedWorkflowPrompt(action.tool),
      action.tool,
    );
  }

  if (
    shouldSendRecommendedToolNudgeByWorkflow({
      recommendationToolName: session.getToolSearchRecommendation()?.toolName,
      alreadySent: state.recommendedToolNudgeSent,
      actionTool: action.tool,
      modelUsedTools: session.modelUsedTools,
    })
  ) {
    state.recommendedToolNudgeSent = true;
    const recommendation = session.getToolSearchRecommendation()!;
    return createContinuationDecision(
      state,
      'recommended_tool_nudge',
      `Подходящий инструмент уже найден: ${recommendation.toolName}.`,
      buildRecommendedToolWorkflowNudgePrompt(recommendation),
      action.tool,
    );
  }

  if (
    shouldSendDeferredToolNudgeByWorkflow({
      toolName: action.tool,
      iteration: state.iteration,
      question: session.lastQuestion,
      enoughContext: session.hasSufficientContext(),
      mutationQuery: session.mutationQuery,
      alreadySent: state.deferredToolNudgeSent,
    })
  ) {
    state.deferredToolNudgeSent = true;
    return createContinuationDecision(
      state,
      'deferred_tool_nudge',
      `Инструмент ${action.tool} лучше вызвать позже.`,
      buildDeferredToolWorkflowNudgePrompt(action.tool),
      action.tool,
    );
  }

  if (
    shouldSendInteractiveToolNudgeByWorkflow({
      toolName: action.tool,
      iteration: state.iteration,
      question: session.lastQuestion,
      enoughContext: session.hasSufficientContext(),
      mutationQuery: session.mutationQuery,
      alreadySent: state.interactiveToolNudgeSent,
    })
  ) {
    state.interactiveToolNudgeSent = true;
    return createContinuationDecision(
      state,
      'interactive_tool_nudge',
      `Для ${action.tool} сначала нужен более уверенный контекст.`,
      buildInteractiveToolWorkflowNudgePrompt(action.tool),
      action.tool,
    );
  }

  if (
    shouldSendRetrievalNudgeByWorkflow({
      embeddingsModel: session.embeddingsModel,
      retrievalAutoContext: session.retrievalAutoContext,
      retrievalNudgeSent: state.retrievalNudgeSent,
      modelUsedTools: session.modelUsedTools,
      actionTool: action.tool,
      iteration: state.iteration,
    })
  ) {
    state.retrievalNudgeSent = true;
    return createContinuationDecision(
      state,
      'retrieval_nudge',
      'Сначала сузим область поиска по смыслу.',
      buildRetrievalWorkflowNudgePrompt(),
    );
  }

  if (
    shouldSendSubagentNudgeByWorkflow({
      subagentUsed: state.subagentUsed,
      subagentProactiveNudges: state.subagentProactiveNudges,
      question: session.lastQuestion,
      iteration: state.iteration,
      actionTool: action.tool,
      modelUsedTools: session.modelUsedTools,
    })
  ) {
    state.subagentProactiveNudges++;
    return createContinuationDecision(
      state,
      'subagent_nudge',
      'Параллельный анализ даст контекст быстрее.',
      buildSubagentWorkflowNudgePrompt(),
    );
  }

  if (
    shouldSendMutationNudgeByWorkflow({
      mutationQuery: session.mutationQuery,
      workspaceMutations: session.memory.workspaceMutations,
      actionTool: action.tool,
      iteration: state.iteration,
    })
  ) {
    return createContinuationDecision(
      state,
      'mutation_nudge',
      'Пора переходить от чтения к правке.',
      buildMutationWorkflowNudgePrompt(),
    );
  }

  if (
    shouldSendToolSearchNudgeByWorkflow({
      alreadySent: state.toolSearchNudgeSent,
      question: session.lastQuestion,
      iteration: state.iteration,
      actionTool: action.tool,
      modelUsedTools: session.modelUsedTools,
      mutationQuery: session.mutationQuery,
      enoughContext: session.hasSufficientContext(),
    })
  ) {
    state.toolSearchNudgeSent = true;
    return createContinuationDecision(
      state,
      'tool_search_nudge',
      'Сначала стоит уточнить, какой специализированный инструмент лучше подходит.',
      buildToolSearchWorkflowNudgePrompt(),
      action.tool,
    );
  }

  return null;
}
