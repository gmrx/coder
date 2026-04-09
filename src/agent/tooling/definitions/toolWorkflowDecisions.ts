import { getReadTopDirs } from '../../runtime/memory/coverageMemory';
import { isBroadStudyQuery, isMutationIntentQuery, isPlanningIntentQuery } from '../../runtime/memory/intents';
import { shouldDeferTool, toolRequiresUserInteraction } from './toolCapabilities';
import type { ToolWorkflowRole } from './toolDefinitions';
import { getToolDefinition } from './toolPolicies';

function getToolWorkflowRoles(toolName: string): ToolWorkflowRole[] {
  return getToolDefinition(toolName)?.workflowRoles || [];
}

function toolHasWorkflowRole(toolName: string, role: ToolWorkflowRole): boolean {
  return getToolWorkflowRoles(toolName).includes(role);
}

export function isRecommendationRedirectTool(toolName: string): boolean {
  return toolHasWorkflowRole(toolName, 'recommendation_redirect_source');
}

export function isToolSearchSuggestionTool(toolName: string): boolean {
  return toolHasWorkflowRole(toolName, 'tool_search_suggestion_source');
}

function isRetrievalNudgeSourceTool(toolName: string): boolean {
  return toolHasWorkflowRole(toolName, 'retrieval_nudge_source');
}

function isLinearStudySourceTool(toolName: string): boolean {
  return toolHasWorkflowRole(toolName, 'linear_study_source');
}

function isMutationReadSourceTool(toolName: string): boolean {
  return toolHasWorkflowRole(toolName, 'mutation_read_source');
}

export function shouldPrimeRetrievalByWorkflow(question: string, embeddingsModel: string): boolean {
  if (!embeddingsModel) return false;
  if (isMutationIntentQuery(question)) return false;

  const value = (question || '').trim().toLowerCase();
  if (value.length < 12) return false;

  const semanticIntent =
    /где|как|почему|зачем|что отвечает|какой файл|какой модуль|архитектур|поток|workflow|flow|обработка|логик|инициализ|конфиг|взаимодейств|связ|route|router|auth|error|where|how|why|architecture|data flow|initiali[sz]|config|relevant/.test(value);
  const explicitLiteralLookup =
    /[`'"][^`'"]+\.[a-z0-9]{1,8}[`'"]/.test(question) ||
    /(^|\s)(src|app|lib|test|tests|packages|docs|media|dist)\/[^\s]+/.test(question) ||
    /\b(read_file|grep|glob|find_files|workspace_symbols)\b/.test(value);

  if (isBroadStudyQuery(question)) return true;
  if (semanticIntent) return true;
  if (explicitLiteralLookup) return false;
  return /\bпроект\b|\bкод\b|\bmodule\b|\bservice\b|\bfunction\b/.test(value);
}

export function shouldForceSubagentRecoveryByWorkflow(params: {
  subagentUsed: boolean;
  subagentRecoveryNudgeSent: boolean;
  question: string;
  usedCalls: Set<string>;
}): boolean {
  if (isMutationIntentQuery(params.question)) return false;
  const topDirs = getReadTopDirs(params.usedCalls);
  return (
    !params.subagentUsed &&
    !params.subagentRecoveryNudgeSent &&
    isBroadStudyQuery(params.question) &&
    params.usedCalls.size >= 3 &&
    topDirs.length >= 1
  );
}

export function shouldSendRetrievalNudgeByWorkflow(params: {
  embeddingsModel: string;
  retrievalAutoContext: boolean;
  retrievalNudgeSent: boolean;
  modelUsedTools: Set<string>;
  actionTool: string;
  iteration: number;
}): boolean {
  return (
    !!params.embeddingsModel &&
    params.retrievalAutoContext &&
    !params.retrievalNudgeSent &&
    !params.modelUsedTools.has('find_relevant_files') &&
    !params.modelUsedTools.has('semantic_search') &&
    params.actionTool !== 'find_relevant_files' &&
    params.actionTool !== 'semantic_search' &&
    params.actionTool !== 'subagent' &&
    params.actionTool !== 'final_answer' &&
    isRetrievalNudgeSourceTool(params.actionTool) &&
    params.iteration >= 2
  );
}

export function shouldSendToolSearchNudgeByWorkflow(params: {
  alreadySent: boolean;
  question: string;
  iteration: number;
  actionTool: string;
  modelUsedTools: Set<string>;
  mutationQuery: boolean;
  enoughContext: boolean;
}): boolean {
  if (params.alreadySent) return false;
  if (params.mutationQuery) return false;
  if (params.enoughContext) return false;
  if (params.iteration < 2 || params.iteration > 4) return false;
  if (params.modelUsedTools.has('tool_search')) return false;
  if (params.actionTool === 'tool_search' || params.actionTool === 'final_answer') return false;

  const broadOrPlanning = isBroadStudyQuery(params.question) || isPlanningIntentQuery(params.question);
  if (!broadOrPlanning) return false;

  return isToolSearchSuggestionTool(params.actionTool);
}

export function shouldSendRecommendedToolNudgeByWorkflow(params: {
  recommendationToolName?: string | null;
  alreadySent: boolean;
  actionTool: string;
  modelUsedTools: Set<string>;
}): boolean {
  if (params.alreadySent) return false;
  if (!params.recommendationToolName) return false;
  if (params.actionTool === params.recommendationToolName) return false;
  if (params.modelUsedTools.has(params.recommendationToolName)) return false;

  return isRecommendationRedirectTool(params.actionTool);
}

export function shouldSendSubagentNudgeByWorkflow(params: {
  subagentUsed: boolean;
  subagentProactiveNudges: number;
  question: string;
  iteration: number;
  actionTool: string;
  modelUsedTools: Set<string>;
}): boolean {
  if (isMutationIntentQuery(params.question)) return false;
  return (
    !params.subagentUsed &&
    params.subagentProactiveNudges < 2 &&
    isBroadStudyQuery(params.question) &&
    params.iteration >= 3 &&
    params.actionTool !== 'subagent' &&
    params.actionTool !== 'final_answer' &&
    !params.modelUsedTools.has('subagent') &&
    isLinearStudySourceTool(params.actionTool)
  );
}

export function shouldSendMutationNudgeByWorkflow(params: {
  mutationQuery: boolean;
  workspaceMutations: number;
  actionTool: string;
  iteration: number;
}): boolean {
  return (
    params.mutationQuery &&
    params.workspaceMutations === 0 &&
    params.iteration >= 2 &&
    isMutationReadSourceTool(params.actionTool)
  );
}

export function shouldSendDeferredToolNudgeByWorkflow(params: {
  toolName: string;
  iteration: number;
  question: string;
  enoughContext: boolean;
  mutationQuery: boolean;
  alreadySent: boolean;
}): boolean {
  if (params.alreadySent) return false;
  if (!shouldDeferTool(params.toolName)) return false;
  if (params.iteration > 2) return false;
  if (params.enoughContext) return false;

  if (params.toolName === 'todo_write' || params.toolName === 'enter_plan_mode') {
    return false;
  }

  if (params.toolName === 'verification_agent') {
    return !params.mutationQuery;
  }

  if (params.toolName === 'exit_plan_mode') {
    return false;
  }

  return isBroadStudyQuery(params.question) || isPlanningIntentQuery(params.question);
}

export function shouldSendInteractiveToolNudgeByWorkflow(params: {
  toolName: string;
  iteration: number;
  question: string;
  enoughContext: boolean;
  mutationQuery: boolean;
  alreadySent: boolean;
}): boolean {
  if (params.alreadySent) return false;
  if (!toolRequiresUserInteraction(params.toolName)) return false;
  if (params.iteration > 3) return false;
  if (params.enoughContext) return false;
  if (params.mutationQuery) return false;
  if (params.toolName === 'exit_plan_mode') return false;

  return isBroadStudyQuery(params.question) || isPlanningIntentQuery(params.question);
}

export function shouldRequireVerificationByWorkflow(params: {
  mutationQuery: boolean;
  workspaceMutations: number;
  modelUsedTools: Set<string>;
}): boolean {
  return (
    params.mutationQuery &&
    params.workspaceMutations >= 2 &&
    !params.modelUsedTools.has('verification_agent')
  );
}

export function shouldSuggestPlanModeByWorkflow(
  question: string,
  iteration: number,
  actionTool: string,
): boolean {
  if (!isPlanningIntentQuery(question)) return false;
  if (iteration > 2) return false;
  return actionTool !== 'enter_plan_mode' && actionTool !== 'final_answer';
}

export function shouldSuggestTodoWriteByWorkflow(params: {
  question: string;
  iteration: number;
  actionTool: string;
  modelUsedTools: Set<string>;
}): boolean {
  if (params.modelUsedTools.has('todo_write')) return false;
  if (params.iteration > 2) return false;
  if (params.actionTool === 'todo_write' || params.actionTool === 'final_answer') return false;

  const value = (params.question || '').trim().toLowerCase();
  const hasMultiItemPattern =
    /\n\s*\d+[.)]/.test(params.question) ||
    /[,;]\s*[^,;]{6,}\s+и\s+[^,;]{6,}/i.test(params.question) ||
    /\b(и ещё|потом|затем|после этого|несколько|по очереди|сначала)\b/i.test(params.question);

  return isBroadStudyQuery(params.question) || isPlanningIntentQuery(params.question) || hasMultiItemPattern || value.length >= 120;
}
