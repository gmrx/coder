import { getToolUserFacingName, shouldDeferTool, toolRequiresUserInteraction } from './toolCapabilities';
import { TOOL_DEFINITIONS, type ToolDefinition } from './toolDefinitions';
import { getToolDefinition } from './toolPolicies';
import { getToolPromptAvoidWhen, getToolPromptGuidance, getToolPromptWhenToUse } from './toolPromptPresentation';

function requireTool(toolName: string): ToolDefinition {
  const definition = getToolDefinition(toolName);
  if (!definition) {
    throw new Error(`Missing tool definition: ${toolName}`);
  }
  return definition;
}

function firstWhenToUse(toolName: string, fallback: string): string {
  return getToolPromptWhenToUse(requireTool(toolName))[0] || fallback;
}

function firstAvoidWhen(toolName: string, fallback = ''): string {
  return getToolPromptAvoidWhen(requireTool(toolName))[0] || fallback;
}

function guidance(toolName: string, fallback = ''): string {
  return getToolPromptGuidance(requireTool(toolName)) || fallback;
}

function formatExamples(toolNames: string[]): string {
  return toolNames.map(getToolUserFacingName).join(', ');
}

export function buildDeferredCapabilityNote(): string {
  const examples = TOOL_DEFINITIONS
    .filter((definition) => shouldDeferTool(definition.name))
    .slice(0, 4)
    .map((definition) => definition.name);

  return (
    'Если у инструмента есть свойство "лучше не вызывать первым ходом", не используй его преждевременно без явной причины.' +
    (examples.length > 0 ? ` Примеры: ${formatExamples(examples)}.` : '')
  );
}

export function buildInteractiveCapabilityNote(): string {
  const examples = TOOL_DEFINITIONS
    .filter((definition) => toolRequiresUserInteraction(definition.name))
    .slice(0, 4)
    .map((definition) => definition.name);

  return (
    'Если инструмент требует явного взаимодействия пользователя, сначала собери минимально достаточный контекст и убедись, что это действительно следующий необходимый шаг.' +
    (examples.length > 0 ? ` Примеры: ${formatExamples(examples)}.` : '')
  );
}

export function buildToolSearchStrategyNote(): string {
  const toolName = 'tool_search';
  return (
    `Если неясно, какой специализированный инструмент подходит лучше, сначала используй ${getToolUserFacingName(toolName).toLowerCase()}: ${firstWhenToUse(toolName, 'нужно быстро выбрать capability по намерению')}. ` +
    guidance(toolName, 'После этого обычно сразу вызывай найденный инструмент.') +
    ' Если нужен точный выбор по имени, допустим запрос вида select:tool_name.'
  );
}

export function buildToolBatchStrategyNote(): string {
  const toolName = 'tool_batch';
  return (
    `Если нужно за один ход выполнить несколько независимых read-only шагов, используй ${getToolUserFacingName(toolName).toLowerCase()}: ` +
    `${firstWhenToUse(toolName, 'нужно параллельно прочитать несколько независимых источников контекста')}. ` +
    guidance(toolName, 'Подходит для параллельного чтения и поиска.') +
    ' Не используй его для зависимых шагов, мутаций, shell, mcp_tool и действий с подтверждением пользователя.'
  );
}

export function buildAskUserStrategyNote(): string {
  const toolName = 'ask_user';
  const exitPlanTool = 'exit_plan_mode';
  return (
    `Если задача упирается в неоднозначность или реальный выбор пользователя, используй ${getToolUserFacingName(toolName).toLowerCase()}: ` +
    `${firstWhenToUse(toolName, 'нужно уточнить требования или выбрать один из вариантов')}. ` +
    guidance(toolName, 'Задавай 1-4 коротких вопроса с 2-4 вариантами.') +
    ` Если план уже готов и нужен именно approval плана, вместо этого используй ${getToolUserFacingName(exitPlanTool).toLowerCase()}.`
  );
}

export function buildSkillStrategyNote(): string {
  const toolName = 'skill';
  return (
    `Если пользователь явно упоминает навык, slash-команду или reusable workflow, используй ${getToolUserFacingName(toolName).toLowerCase()}: ` +
    `${firstWhenToUse(toolName, 'нужно подтянуть готовую инструкцию навыка вместо импровизации')}. ` +
    guidance(toolName, 'После загрузки навыка сразу следуй его инструкциям в текущем цикле.') +
    ' Это особенно полезно для повторяемых процедур вроде review, docs lookup, commit flow или специализированных project workflows.'
  );
}

export function buildTaskStrategyNote(): string {
  const listTool = 'task_list';
  const getTool = 'task_get';
  const stopTool = 'task_stop';
  const shellTool = 'shell';
  return (
    `Если команда или работа может идти долго и не требует синхронного ожидания, используй task stack. ` +
    `${getToolUserFacingName(shellTool)}: для долгих build/test/package/watch-команд ставь run_in_background=true. ` +
    `${getToolUserFacingName(listTool)}: ${guidance(listTool, firstWhenToUse(listTool, 'нужно увидеть активные или завершённые background jobs'))}. ` +
    `${getToolUserFacingName(getTool)}: ${guidance(getTool, firstWhenToUse(getTool, 'id задачи уже известен и нужен статус/stdout/stderr preview'))}. ` +
    `${getToolUserFacingName(stopTool)} используй только если задачу реально нужно остановить.`
  );
}

export function buildProjectOverviewStrategyNote(): string {
  const structureTool = 'scan_structure';
  const stackTool = 'detect_stack';
  return (
    `Для первого входа в незнакомый репозиторий используй обзорные утилиты. ` +
    `${getToolUserFacingName(structureTool)}: ${guidance(structureTool, firstWhenToUse(structureTool, 'сначала понять layout проекта'))}. ` +
    `${getToolUserFacingName(stackTool)}: ${guidance(stackTool, firstWhenToUse(stackTool, 'быстро определить стек, entrypoints и инфраструктуру'))}. ` +
    'После overview переходи к list_files, read_file, extract_symbols, dependencies или lsp_inspect, а не повторяй одни и те же обзорные шаги.'
  );
}

export function buildReadStudyStrategyNote(): string {
  const toolName = 'read_file';
  const rangeTool = 'read_file_range';
  return (
    `Когда файл уже известен, используй ${getToolUserFacingName(toolName).toLowerCase()} осмысленно: ` +
    `${guidance(toolName, firstWhenToUse(toolName, 'нужно изучить конкретный файл'))}. ` +
    `Для больших файлов сначала бери overview, потом переходи к ${getToolUserFacingName(rangeTool).toLowerCase()} по подсказанным диапазонам. ` +
    'Для package.json, tsconfig, pyproject.toml и других manifest/config файлов используй outputMode=manifest, а для нетекстовых или подозрительных артефактов — outputMode=metadata.'
  );
}

export function buildGrepStudyStrategyNote(): string {
  const toolName = 'grep';
  return (
    `Если известен точный токен, строка или regex, предпочитай ${getToolUserFacingName(toolName).toLowerCase()}: ` +
    `${guidance(toolName, firstWhenToUse(toolName, 'нужно быстро найти конкретный текст по коду'))}. ` +
    'Для широкого обзора чаще начинай с files_with_matches, для плотности совпадений используй count, а к content переходи, когда уже нужен контекст вокруг найденных мест.'
  );
}

export function buildFileSearchStrategyNote(): string {
  const globTool = 'glob';
  const findTool = 'find_files';
  return (
    `Если нужно искать файлы по имени или маске, используй файловые search-утилиты осмысленно. ` +
    `${getToolUserFacingName(globTool)}: ${guidance(globTool, firstWhenToUse(globTool, 'известна файловая маска или расширение'))}. ` +
    `${getToolUserFacingName(findTool)}: ${guidance(findTool, firstWhenToUse(findTool, 'известно имя файла или узкий паттерн'))}. ` +
    'Для широких результатов полезно начать с grouped, чтобы сначала увидеть директории, а уже потом переходить к list_files и read_file.'
  );
}

export function buildDirectoryStudyStrategyNote(): string {
  const toolName = 'list_files';
  return (
    `Если уже известна директория, используй ${getToolUserFacingName(toolName).toLowerCase()} режимами. ` +
    `${guidance(toolName, firstWhenToUse(toolName, 'нужно быстро понять состав конкретной директории'))}. ` +
    ' Для первого входа в большую папку начинай с dirs, затем переходи к tree или flat, а потом уже к read_file.'
  );
}

export function buildRetrievalStrategyNote(): string {
  const filesTool = 'find_relevant_files';
  const chunksTool = 'semantic_search';
  return (
    `Если вопрос дан естественным языком про логику кода, архитектуру, поток данных или обработку ошибок, предпочитай retrieval-инструменты. ` +
    `${getToolUserFacingName(filesTool)}: ${guidance(filesTool, firstWhenToUse(filesTool, 'быстро выбрать, какие файлы читать'))}. ` +
    `${getToolUserFacingName(chunksTool)}: ${guidance(chunksTool, firstWhenToUse(chunksTool, 'получить релевантные фрагменты кода по смыслу'))}. ` +
    ' Начинай с summary, затем переходи к files или chunks/snippets, а уже потом к read_file, read_file_range, extract_symbols или lsp_inspect. Не начинай такие запросы с длинной линейной серии list_files/read_file, если retrieval уже может сузить область.'
  );
}

export function buildLspStrategyNote(): string {
  const toolName = 'lsp_inspect';
  return (
    `Если уже известны файл и точка в коде, предпочитай ${getToolUserFacingName(toolName).toLowerCase()}: ` +
    `${firstWhenToUse(toolName, 'нужно перейти к определению, найти ссылки, получить hover, реализацию или call hierarchy символа')}. ` +
    guidance(toolName, 'Лучший инструмент для точной навигации по символам.') +
    ' Если нужно понять, кто вызывает функцию или какие вызовы она делает, используй incoming_calls или outgoing_calls.'
  );
}

export function buildSymbolStudyStrategyNote(): string {
  const toolName = 'extract_symbols';
  return (
    `Если файл уже известен и нужно быстро понять его shape, используй ${getToolUserFacingName(toolName).toLowerCase()}: ` +
    `${guidance(toolName, firstWhenToUse(toolName, 'нужен обзор функций, классов и других символов файла'))}. ` +
    ' Для первого прохода бери summary, для группировки по типам — kinds, а к подробному symbols переходи, когда уже нужен конкретный участок.'
  );
}

export function buildDependencyStudyStrategyNote(): string {
  const toolName = 'dependencies';
  return (
    `Если нужно понять связи файла или манифеста, используй ${getToolUserFacingName(toolName).toLowerCase()}: ` +
    `${guidance(toolName, firstWhenToUse(toolName, 'нужно посмотреть package dependencies или import-связи'))}. ` +
    ' Обычно начинай с summary, затем переходи к manifests или files, и только потом к packages или graph для детального разбора.'
  );
}

export function buildWebStrategyNote(): string {
  const searchTool = 'web_search';
  const fetchTool = 'web_fetch';
  return (
    `Если нужна актуальная информация вне workspace, используй веб-утилиты осмысленно. ` +
    `${getToolUserFacingName(searchTool)}: ${guidance(searchTool, firstWhenToUse(searchTool, 'нужно сначала найти внешние источники по теме'))}. ` +
    `${getToolUserFacingName(fetchTool)}: ${guidance(fetchTool, firstWhenToUse(fetchTool, 'URL уже известен и нужно прочитать страницу или JSON'))}. ` +
    ' Обычно начинай с web_search summary, затем переходи к sources/results. Если нужен уже краткий grounded answer по найденным страницам, используй web_search с outputMode=answer и prompt. Когда URL уже выбран — переходи к web_fetch summary/content или к web_fetch с prompt для адресного извлечения ответа. Доверенные documentation/code hosts открываются сразу, а внешний неизвестный домен может потребовать подтверждение.'
  );
}

export function buildMcpStrategyNote(): string {
  const listResourceTool = 'list_mcp_resources';
  const readResourceTool = 'read_mcp_resource';
  const listToolsTool = 'list_mcp_tools';
  const callTool = 'mcp_tool';
  const authTool = 'mcp_auth';
  return (
    `Если данные или действия уже доступны через MCP-коннектор, используй MCP flow осмысленно. ` +
    `${getToolUserFacingName(listResourceTool)}: ${guidance(listResourceTool, firstWhenToUse(listResourceTool, 'сначала увидеть доступные URI ресурсов'))}. ` +
    `${getToolUserFacingName(readResourceTool)}: ${guidance(readResourceTool, firstWhenToUse(readResourceTool, 'конкретный server + uri уже известны'))}. ` +
    `${getToolUserFacingName(listToolsTool)}: ${guidance(listToolsTool, firstWhenToUse(listToolsTool, 'нужно узнать реальные remote tool names и schemas на сервере'))}. ` +
    `${getToolUserFacingName(callTool)}: ${guidance(callTool, firstWhenToUse(callTool, 'server + tool name уже известны и нужно выполнить remote MCP tool'))}. ` +
    `${getToolUserFacingName(authTool)}: ${guidance(authTool, firstWhenToUse(authTool, 'MCP сервер требует OAuth или generic MCP вызов упёрся в 401'))}. ` +
    ' Для ресурсов иди по маршруту list_mcp_resources -> read_mcp_resource. Для remote tools иди по маршруту list_mcp_tools -> mcp_tool, а при auth-блокировке сначала mcp_auth. Если inputSchema у remote tool содержит только command:string, передавай всю CLI-строку целиком в arguments.command и не разделяй её на command + args или prompt. Если MCP tool вернул schema/deserialize/invalid-argument ошибку, не повторяй вызов наугад: сначала исправь arguments по schema hint из результата.'
  );
}

export function buildWorktreeStrategyNote(): string {
  const enterTool = 'enter_worktree';
  const exitTool = 'exit_worktree';
  return (
    `Если предстоят рискованные правки, большой рефакторинг или нужен изолированный git-контекст, используй ${getToolUserFacingName(enterTool).toLowerCase()}: ` +
    `${guidance(enterTool, firstWhenToUse(enterTool, 'создать отдельное рабочее дерево и не смешивать изменения с основным root'))}. ` +
    `Когда работа в изоляции закончена, используй ${getToolUserFacingName(exitTool).toLowerCase()}: ` +
    `${guidance(exitTool, firstWhenToUse(exitTool, 'вернуться в исходный проект и при необходимости удалить временный worktree'))}.`
  );
}

export function buildPlanModeStrategyNote(): string {
  const enterTool = 'enter_plan_mode';
  const exitTool = 'exit_plan_mode';
  return (
    `Если задача требует сначала спроектировать подход или исследовать её без правок, используй ${getToolUserFacingName(enterTool).toLowerCase()}: ${firstWhenToUse(enterTool, 'сначала продумать подход без немедленной реализации')}. ` +
    'В режиме плана разрешены только read-only действия: чтение, поиск, анализ, retrieval и readonly-subagent. ' +
    `Когда план готов, используй ${getToolUserFacingName(exitTool).toLowerCase()}: ${firstWhenToUse(exitTool, 'показать готовый план пользователю на согласование')}. ` +
    (firstAvoidWhen(exitTool) ? `Не делай этого, если ${firstAvoidWhen(exitTool)}. ` : '')
  );
}

export function buildSubagentStrategyNote(): string {
  const toolName = 'subagent';
  return (
    `Работай как оркестратор: ${firstWhenToUse(toolName, 'если задача распадается на независимые ветки или широкий обзор лучше делать параллельно')}. ` +
    guidance(toolName, 'Используй batches для независимых подзадач.') +
    ' Для изучения кода по умолчанию ставь subagent_type=explore и readonly=true.'
  );
}

export function buildSubagentExecutionNotes(): string[] {
  return [
    'subagent — не обязательный инструмент. Вызывай его только если это реально ускорит задачу.',
    'Если вызываешь subagent для изучения кода, по умолчанию ставь subagent_type=explore и readonly=true.',
    'generalPurpose используй только когда действительно нужны мутации или широкие инструменты.',
    'Сам определяй: plan, subagent_type, readonly и формат результата, не меняя исходную цель пользователя.',
    'subagent можно использовать не только для подпроектов: применяй его для любых больших или параллелизуемых подзадач, если это ускоряет выполнение и сохраняет фокус на исходной цели пользователя.',
    'Допустимо несколько волн subagent: первая — для широкого покрытия, вторая — для закрытия обнаруженных пробелов.',
    'При широких запросах сначала наметь 3-8 подзадач и по возможности запускай их через subagent tasks[] с parallel:true, затем синтезируй единый вывод. Основной агент должен собирать и объединять результаты, а не вручную читать все файлы по очереди.',
  ];
}

export function buildTodoStrategyNote(): string {
  const toolName = 'todo_write';
  return (
    `Если задача нетривиальная и в ней 3+ осмысленных шага, используй ${getToolUserFacingName(toolName).toLowerCase()}: ${firstWhenToUse(toolName, 'нужна явная рабочая разбивка')}. ` +
    guidance(toolName, 'Поддерживай максимум одну задачу со статусом in_progress.')
  );
}

export function buildMutationStrategyNote(): string {
  const editTool = 'str_replace';
  const createTool = 'write_file';
  const deleteTool = 'delete_file';
  const diagnosticsTool = 'get_diagnostics';
  const verificationTool = 'verification_agent';
  const readTool = 'read_file';
  const rangeTool = 'read_file_range';

  return (
    'Если пользователь просит изменить код, ты обязан реально изменить workspace через edit-инструменты, а не только описать решение. ' +
    `Перед правкой сначала прочитай файл через ${getToolUserFacingName(readTool).toLowerCase()} или ${getToolUserFacingName(rangeTool).toLowerCase()}, чтобы не редактировать его вслепую. ` +
    `${getToolUserFacingName(editTool)} — ${guidance(editTool, 'предпочтительный инструмент для обычных правок кода')}. ` +
    `${getToolUserFacingName(createTool)} используй, когда ${firstWhenToUse(createTool, 'нужно создать новый файл или полностью перезаписать существующий')}. ` +
    `${getToolUserFacingName(deleteTool)} используй только когда ${firstWhenToUse(deleteTool, 'удаление действительно входит в задачу')}. ` +
    `После правки при необходимости проверь ${getToolUserFacingName(diagnosticsTool).toLowerCase()}. ` +
    `${getToolUserFacingName(verificationTool)} — ${guidance(verificationTool, 'отдельная фаза проверки после нетривиальных изменений')}.`
  );
}

export function buildShellStrategyNote(): string {
  const toolName = 'shell';
  return (
    `Если действительно нужен терминал, используй ${getToolUserFacingName(toolName).toLowerCase()} осмысленно: ` +
    `${guidance(toolName, firstWhenToUse(toolName, 'нужно запустить тесты, сборку, lint или короткую CLI-проверку'))}. ` +
    ' Для inspect/check-сценариев предпочитай короткие и точные команды по семействам: git status/diff/log/show для репозитория, npm test для проверок, npm run build или tsc --noEmit для сборки/typecheck, npm run lint для quality-check, rg для терминального поиска. ' +
    ' Если команда долгая или её удобно отслеживать отдельно, запускай её как background job через run_in_background=true и дальше работай через task_get/task_list/task_stop. ' +
    'Не подменяй shell’ом специализированные file/code утилиты, если задачу можно решить без терминала.'
  );
}

export function buildCompletionStrategyNote(): string {
  const toolName = 'final_answer';
  return (
    `Завершай цикл только когда выполнено условие для ${getToolUserFacingName(toolName).toLowerCase()}: ${firstWhenToUse(toolName, 'контекста уже достаточно для уверенного ответа')}. ` +
    (firstAvoidWhen(toolName) ? `Не завершайся, если ${firstAvoidWhen(toolName)}.` : '')
  );
}

export function buildAgentStrategyNotes(): string {
  const lines = [
    '## Стратегия',
    '',
    'Выбирай только те утилиты и глубину анализа, которые нужны для цели пользователя.',
    'Не делай обязательных ритуальных шагов, если они не добавляют фактов для текущей задачи.',
    buildToolSearchStrategyNote(),
    buildToolBatchStrategyNote(),
    buildAskUserStrategyNote(),
    buildSkillStrategyNote(),
    buildTaskStrategyNote(),
    buildProjectOverviewStrategyNote(),
    buildReadStudyStrategyNote(),
    buildGrepStudyStrategyNote(),
    buildFileSearchStrategyNote(),
    buildDirectoryStudyStrategyNote(),
    buildDeferredCapabilityNote(),
    buildInteractiveCapabilityNote(),
    buildPlanModeStrategyNote(),
    buildRetrievalStrategyNote(),
    buildLspStrategyNote(),
    buildSymbolStudyStrategyNote(),
    buildDependencyStudyStrategyNote(),
    buildMcpStrategyNote(),
    buildWorktreeStrategyNote(),
    buildWebStrategyNote(),
    buildSubagentStrategyNote(),
    buildTodoStrategyNote(),
    buildMutationStrategyNote(),
    buildShellStrategyNote(),
    'Не трать шаги на служебные/внутренние артефакты вроде .ai-assistant/traces, если пользователь явно не просил это анализировать.',
    buildCompletionStrategyNote(),
  ];

  return lines.join('\n');
}
