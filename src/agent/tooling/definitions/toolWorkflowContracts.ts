import type { AgentToolSearchRecommendation } from '../../runtime/types';
import type { ToolExecutionStatus } from '../results';
import { getToolUserFacingName } from './toolCapabilities';
import { getToolRecoveryPrompt } from './toolRecoveryContracts';
import { canRetrySameToolCall, getToolMaxAttemptsPerCall } from './toolRuntimeContracts';
import { isRecommendationRedirectTool } from './toolWorkflowDecisions';
import { getToolDefinition } from './toolPolicies';
import { getToolPromptGuidance, getToolPromptWhenToUse } from './toolPromptPresentation';

function requireTool(toolName: string) {
  const definition = getToolDefinition(toolName);
  if (!definition) {
    throw new Error(`Missing tool definition: ${toolName}`);
  }
  return definition;
}

function formatExamples(toolNames: string[]): string {
  return toolNames.map(getToolUserFacingName).join(', ');
}

function firstWhenToUse(toolName: string, fallback: string): string {
  return getToolPromptWhenToUse(requireTool(toolName))[0] || fallback;
}

function guidance(toolName: string, fallback = ''): string {
  return getToolPromptGuidance(requireTool(toolName)) || fallback;
}

function firstExample(toolName: string, fallback: string): string {
  return requireTool(toolName).examples?.[0] || fallback;
}

function shouldAppendRecommendationHint(
  toolName: string,
  recommendation?: AgentToolSearchRecommendation | null,
): boolean {
  if (!recommendation?.toolName) return false;
  if (toolName === recommendation.toolName) return false;
  return isRecommendationRedirectTool(toolName);
}

function buildRecommendationHintText(
  recommendation: AgentToolSearchRecommendation,
  intro: string,
): string {
  return (
    `${intro}: ${recommendation.toolName}.\n` +
    'Не возвращайся к общим шагам без новой информации.\n' +
    (recommendation.nextStep
      ? `Следующим ходом лучше использовать:\n${recommendation.nextStep}`
      : `Следующим ходом лучше вернуть JSON-вызов инструмента ${recommendation.toolName}.`)
  );
}

export function buildForcedSubagentWorkflowPrompt(): string {
  const toolName = 'subagent';
  return (
    `Перед дальнейшим линейным анализом используй ${getToolUserFacingName(toolName).toLowerCase()}: ` +
    `${firstWhenToUse(toolName, 'задача уже распадается на независимые направления')}.\n` +
    `${guidance(toolName, 'Разбей задачу на 3-6 независимых подзадач и запускай их параллельно.')}\n` +
    'Верни JSON-вызов с tasks[] и parallel:true, исходя из уже прочитанных частей проекта.\n' +
    `Пример формы:\n${firstExample(
      toolName,
      '{ "tool": "subagent", "args": { "parallel": true, "tasks": [{ "task": "..." }, { "task": "..." }], "subagent_type": "explore", "readonly": true } }',
    )}`
  );
}

export function buildSubagentWorkflowNudgePrompt(): string {
  const toolName = 'subagent';
  return (
    `Ты тратишь шаги на линейное чтение. Пора перейти к ${getToolUserFacingName(toolName).toLowerCase()}: ` +
    `${firstWhenToUse(toolName, 'широкий анализ лучше делать параллельно')}.\n` +
    `${guidance(toolName, 'Используй batches для независимых подзадач.')}\n` +
    `Пример формы:\n${firstExample(
      toolName,
      '{ "tool": "subagent", "args": { "parallel": true, "tasks": [{ "prompt": "..." }, { "prompt": "..." }], "subagent_type": "explore", "readonly": true } }',
    )}`
  );
}

export function buildVerificationWorkflowPrompt(): string {
  const toolName = 'verification_agent';
  return (
    `Изменения уже нетривиальны, а независимая проверка ещё не запускалась. Перед final_answer вызови ${getToolUserFacingName(toolName).toLowerCase()}.\n` +
    `${firstWhenToUse(toolName, 'после нетривиальных изменений перед финальным ответом')}.\n` +
    `${guidance(toolName, 'Это отдельная фаза проверки, а не первый инструмент хода.')}\n` +
    `Пример формы:\n${firstExample(
      toolName,
      '{ "tool": "verification_agent", "args": { "task": "<исходная задача>", "changed_files": ["<файлы>"], "approach": "<что уже сделано>", "focus": "<что проверить>" } }',
    )}`
  );
}

export function buildToolSearchWorkflowNudgePrompt(): string {
  const toolName = 'tool_search';
  return (
    `Похоже, ты продолжаешь идти через общие инструменты, но следующий специализированный шаг ещё не выбран.\n` +
    `Сначала вызови ${getToolUserFacingName(toolName).toLowerCase()} и опиши capability короткой intent-фразой.\n` +
    `${guidance(toolName, 'После этого сразу используй найденный инструмент.')}\n` +
    'Примеры query:\n' +
    '- "как лучше проверить нетривиальные изменения перед финальным ответом"\n' +
    '- "какой инструмент лучше подходит для смыслового поиска по коду"\n' +
    '- "как лучше делегировать параллельный анализ"'
  );
}

export function buildRetrievalWorkflowNudgePrompt(): string {
  const filesTool = 'find_relevant_files';
  const chunksTool = 'semantic_search';
  return (
    'Сначала используй retrieval, чтобы не читать файлы вслепую.\n' +
    `${getToolUserFacingName(filesTool)}: ${guidance(filesTool, firstWhenToUse(filesTool, 'быстро выбрать, какие файлы читать по смыслу запроса'))}\n` +
    `${getToolUserFacingName(chunksTool)}: ${guidance(chunksTool, firstWhenToUse(chunksTool, 'получить релевантные фрагменты кода по смыслу'))}\n` +
    'После retrieval переходи к чтению конкретных файлов.'
  );
}

export function buildMutationRequiredWorkflowPrompt(): string {
  const editTool = 'str_replace';
  const writeTool = 'write_file';
  const deleteTool = 'delete_file';
  const notebookTool = 'edit_notebook';
  const diagnosticsTool = 'get_diagnostics';

  return (
    'Пользователь просит именно изменить файлы workspace.\n' +
    `Не переходи к final_answer, пока не выполнишь реальную правку через ${formatExamples([
      editTool,
      writeTool,
      deleteTool,
      notebookTool,
    ])}.\n` +
    'Сначала дочитай только нужный фрагмент, затем внеси изменение и при необходимости проверь ' +
    `${getToolUserFacingName(diagnosticsTool).toLowerCase()}.`
  );
}

export function buildMutationWorkflowNudgePrompt(): string {
  const editTool = 'str_replace';
  const writeTool = 'write_file';
  const deleteTool = 'delete_file';
  const diagnosticsTool = 'get_diagnostics';

  return (
    'Запрос требует реального изменения кода, а не только анализа.\n' +
    'После минимально достаточного чтения переходи к edit-инструментам:\n' +
    `- ${getToolUserFacingName(editTool)} — ${guidance(editTool, 'предпочтительный инструмент для обычных правок кода')}\n` +
    `- ${getToolUserFacingName(writeTool)} — когда ${firstWhenToUse(writeTool, 'нужно создать новый файл или полностью заменить содержимое')}\n` +
    `- ${getToolUserFacingName(deleteTool)} — когда ${firstWhenToUse(deleteTool, 'удаление действительно является частью задачи')}\n` +
    `- ${getToolUserFacingName(diagnosticsTool)} — после изменения, если это уместно\n` +
    'Не завершайся final_answer без попытки внести правку или без явного блокера.'
  );
}

export function buildDeferredToolWorkflowNudgePrompt(toolName: string): string {
  const name = getToolUserFacingName(toolName);
  return (
    `${name} лучше вызывать не первым ходом, а когда это действительно нужно.\n` +
    'Сначала сделай более прямой следующий шаг: чтение, поиск, retrieval или другой сбор фактов.\n' +
    'Переходи к этому инструменту только когда без него уже нельзя двигаться дальше.'
  );
}

export function buildInteractiveToolWorkflowNudgePrompt(toolName: string): string {
  const name = getToolUserFacingName(toolName);
  return (
    `${name} требует явного подтверждения пользователя.\n` +
    'Не запрашивай такой шаг преждевременно на широком исследовании.\n' +
    'Сначала собери минимально достаточный контекст, чтобы следующее действие с подтверждением было действительно обоснованным.'
  );
}

export function buildTodoWriteWorkflowPrompt(): string {
  return (
    'Задача выглядит нетривиальной и многошаговой.\n' +
    'Сначала заведи список задач через todo_write.\n' +
    'Разбей работу на 3-7 конкретных шагов, держи ровно одну задачу в статусе in_progress и обновляй список по мере продвижения.'
  );
}

export function buildPlanModeWorkflowPrompt(): string {
  return (
    'Пользователь просит сначала продумать подход и план без немедленной реализации.\n' +
    'Перейди в режим плана через enter_plan_mode.\n' +
    'В этом режиме можно только исследовать код и проектировать решение без правок файлов.\n' +
    'Когда план будет готов, используй exit_plan_mode, чтобы оформить его для пользователя.'
  );
}

export function buildPlanModeBlockedWorkflowPrompt(toolName: string): string {
  return (
    `Сейчас активен режим плана, поэтому ${getToolUserFacingName(toolName)} недоступен.\n` +
    'В plan mode можно только читать, искать, анализировать и строить план.\n' +
    'Если нужен итоговый план — используй exit_plan_mode.\n' +
    'Если ещё не хватает фактов — продолжай read-only исследование.'
  );
}

export function buildNoActionRetryWorkflowPrompt(
  recommendation?: AgentToolSearchRecommendation | null,
): string {
  if (recommendation?.toolName) {
    return (
      'Ты не вызвал утилиту.\n' +
      buildRecommendationHintText(recommendation, 'Подходящий следующий шаг уже найден через tool_search')
    );
  }

  return (
    'Ты не вызвал утилиту. Верни ровно один JSON-вызов инструмента или final_answer.\n' +
    'Если данных достаточно (авто-контекст уже собран) — верни {"tool":"final_answer"}.\n' +
    'Если запрос широкий и есть независимые области, предпочти subagent с tasks[] и parallel:true.'
  );
}

export function buildRecommendedToolWorkflowNudgePrompt(
  recommendation: AgentToolSearchRecommendation,
): string {
  return buildRecommendationHintText(recommendation, 'Подходящий следующий инструмент уже найден');
}

export function buildRecommendedToolRecoveryWorkflowPrompt(
  toolName: string,
  status: Extract<ToolExecutionStatus, 'blocked' | 'error' | 'degraded'>,
  recommendation?: AgentToolSearchRecommendation | null,
): string {
  const basePrompt = getToolRecoveryPrompt(toolName, status);
  if (!shouldAppendRecommendationHint(toolName, recommendation)) {
    return basePrompt;
  }

  return (
    basePrompt + '\n\n' +
    buildRecommendationHintText(recommendation!, 'Подходящий следующий инструмент уже найден через tool_search')
  );
}

export function buildDuplicateToolWorkflowPrompt(
  toolName: string,
  previousStatus: ToolExecutionStatus = 'success',
  previousAttempts = 1,
  recommendation?: AgentToolSearchRecommendation | null,
): string {
  const displayName = getToolUserFacingName(toolName);
  const recommendationHint = shouldAppendRecommendationHint(toolName, recommendation)
    ? `\n\n${buildRecommendationHintText(recommendation!, 'Подходящий следующий инструмент уже найден через tool_search')}`
    : '';

  if (previousStatus === 'blocked') {
    return (
      `${displayName} уже была заблокирована или отклонена с этими аргументами.\n` +
      'Не повторяй тот же вызов без изменения плана действий.\n' +
      getToolRecoveryPrompt(toolName, 'blocked') +
      recommendationHint
    );
  }

  if (previousStatus === 'error' || previousStatus === 'degraded') {
    const maxAttempts = getToolMaxAttemptsPerCall(toolName);
    const retryAllowed = canRetrySameToolCall(toolName, previousStatus, previousAttempts);
    if (!retryAllowed) {
      return (
        `${displayName} уже завершалась со статусом ${previousStatus} с теми же аргументами ${previousAttempts} раз(а).\n` +
        `Лимит одинаковых попыток для этого инструмента исчерпан (${maxAttempts}).\n` +
        'Смени запрос, сузь область, выбери другой инструмент или другой recovery-шаг.\n' +
        getToolRecoveryPrompt(toolName, previousStatus) +
        recommendationHint
      );
    }
  }

  return (
    `${displayName} с этими аргументами уже вызывалась успешно. Используй другой следующий шаг.` +
    recommendationHint
  );
}
