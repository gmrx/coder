export type SubagentMode = 'explore' | 'shell' | 'generalPurpose' | 'verification';
export type ToolInterruptBehavior = 'block' | 'cancel';
export type ToolApprovalKind = 'shell' | 'plan' | 'file' | 'worktree' | 'mcp' | 'web';
export type ToolPromptGroup = 'primary' | 'specialized';
export type ToolPromptStyle = 'detailed' | 'compact' | 'presence';
export type ToolWorkflowRole =
  | 'meta_operation'
  | 'recommendation_redirect_source'
  | 'tool_search_suggestion_source'
  | 'retrieval_nudge_source'
  | 'linear_study_source'
  | 'mutation_read_source'
  | 'retrieval';

export interface ToolArgumentDefinition {
  name: string;
  description: string;
  required?: boolean;
}

export interface ToolApprovalDefinition {
  kind: ToolApprovalKind;
  title: string;
  description?: string;
  editable?: boolean;
  feedbackPlaceholder?: string;
}

export interface ToolCapabilities {
  userFacingName?: string;
  readOnly?: boolean;
  concurrencySafe?: boolean;
  destructive?: boolean;
  requiresUserInteraction?: boolean;
  shouldDefer?: boolean;
  interruptBehavior?: ToolInterruptBehavior;
  approval?: ToolApprovalDefinition;
}

export interface ToolPromptPresentation {
  group?: ToolPromptGroup;
  style?: ToolPromptStyle;
  whenToUse?: string[];
  avoidWhen?: string[];
  guidance?: string;
}

export interface ToolDefinition {
  name: string;
  summary: string;
  details?: string[];
  args?: ToolArgumentDefinition[];
  examples?: string[];
  aliases?: string[];
  searchHints?: string[];
  alwaysLoad?: boolean;
  subagentModes?: SubagentMode[];
  mutatesWorkspace?: boolean;
  requiresShellAccess?: boolean;
  virtual?: boolean;
  capabilities?: ToolCapabilities;
  prompt?: ToolPromptPresentation;
  workflowRoles?: ToolWorkflowRole[];
}

export const ALL_SUBAGENT_MODES: SubagentMode[] = ['explore', 'shell', 'generalPurpose', 'verification'];
export const NO_SUBAGENT_MODES: SubagentMode[] = [];

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'tool_search',
    summary: 'Подбирает подходящий инструмент по задаче, ключевым словам и типу работы.',
    details: [
      'Поддерживает query вида select:tool_name для прямого выбора по имени.',
      'Поддерживает обязательные термины через +слово, если в запросе есть критичный must-match сигнал.',
      'После tool_search обычно нужно сразу вызывать найденный инструмент, а не делать ещё один поисковый ход.',
    ],
    args: [
      { name: 'query', description: 'какую capability или действие ты ищешь', required: true },
      { name: 'limit', description: 'сколько инструментов показать' },
    ],
    examples: [
      '{ "tool": "tool_search", "args": { "query": "как лучше найти релевантные файлы по смыслу" } }',
      '{ "tool": "tool_search", "args": { "query": "select:verification_agent" } }',
      '{ "tool": "tool_search", "args": { "query": "+mermaid визуализация диаграмм" } }',
    ],
    aliases: ['find_tool', 'search_tool', 'tool_lookup', 'tool_help'],
    searchHints: ['какой инструмент выбрать', 'найти подходящий tool', 'поиск capability'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['meta_operation'],
    capabilities: {
      userFacingName: 'Поиск инструмента',
      readOnly: true,
    },
    prompt: {
      group: 'primary',
      style: 'detailed',
      whenToUse: ['неясно, какой специализированный инструмент выбрать', 'нужно быстро найти capability по намерению, а не по имени'],
      guidance: 'Используй короткий intent-запрос, а потом сразу вызывай найденный инструмент; при жёстком выборе можно использовать select:tool_name.',
    },
  },
  {
    name: 'tool_batch',
    summary: 'Выполняет несколько независимых read-only утилит одним ходом и собирает их результаты.',
    details: [
      'Подходит только для безопасных concurrency-safe инструментов без мутаций workspace и без подтверждений пользователя.',
      'Не используй для shell, правок файлов, subagent, verification_agent, final_answer, tool_search и вложенного tool_batch.',
    ],
    args: [
      { name: 'tools', description: 'массив вызовов вида { tool, args }', required: true },
    ],
    examples: [
      '{ "tool": "tool_batch", "args": { "tools": [{ "tool": "read_file", "args": { "path": "src/agent/runtime/queryEngine.ts" } }, { "tool": "read_file", "args": { "path": "src/agent/runtime/turnLoop.ts" } }] } }',
      '{ "tool": "tool_batch", "args": { "tools": [{ "tool": "grep", "args": { "pattern": "tool_batch", "path": "src" } }, { "tool": "find_relevant_files", "args": { "query": "где выполняются утилиты и как устроен executor", "limit": 5 } }] } }',
    ],
    aliases: ['batch_tools', 'parallel_tools', 'multi_tool', 'parallel_read'],
    searchHints: ['параллельно выполнить несколько read-only утилит', 'одним ходом прочитать несколько файлов', 'батч независимых инструментов'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['meta_operation'],
    capabilities: {
      userFacingName: 'Пакет утилит',
      readOnly: true,
    },
    prompt: {
      group: 'primary',
      style: 'detailed',
      whenToUse: ['нужно одним ходом выполнить несколько независимых read-only вызовов без взаимодействия с пользователем'],
      avoidWhen: ['вызовы зависят друг от друга, меняют файлы, требуют подтверждения или их результаты нужны последовательно'],
      guidance: 'Хорош для параллельного чтения и поиска; не вкладывай tool_batch внутрь tool_batch.',
    },
  },
  {
    name: 'ask_user',
    summary: 'Задаёт пользователю 1-4 вопроса с вариантами ответа и ждёт явного выбора в интерфейсе.',
    details: [
      'Используй для уточнения неоднозначных требований, выбора варианта реализации или подтверждения предпочтения пользователя.',
      'Не используй вместо exit_plan_mode для согласования готового плана и не задавай открытые вопросы, если можно предложить 2-4 чётких варианта.',
    ],
    args: [
      { name: 'questions', description: 'массив вопросов вида { question, header, options, multiSelect? }', required: true },
    ],
    examples: [
      '{ "tool": "ask_user", "args": { "questions": [{ "question": "Какой вариант реализации выбрать?", "header": "Подход", "options": [{ "label": "Минимальный", "description": "Только точечный фикс без рефакторинга" }, { "label": "Полный", "description": "Чище архитектурно, но больше изменений" }] }] } }',
      '{ "tool": "ask_user", "args": { "questions": [{ "question": "Какие проверки запустить?", "header": "Проверки", "multiSelect": true, "options": [{ "label": "Lint", "description": "Проверить стиль и линтер" }, { "label": "Build", "description": "Собрать проект" }, { "label": "Tests", "description": "Запустить тесты" }] }] } }',
    ],
    aliases: ['ask_user_question', 'ask_question', 'AskUserQuestionTool'],
    searchHints: ['уточнить у пользователя', 'задать вопрос пользователю', 'выбрать вариант реализации', 'уточнить предпочтения', 'собрать ответы пользователя'],
    alwaysLoad: true,
    subagentModes: NO_SUBAGENT_MODES,
    workflowRoles: ['meta_operation'],
    capabilities: {
      userFacingName: 'Вопрос пользователю',
      readOnly: true,
      concurrencySafe: true,
      requiresUserInteraction: true,
      shouldDefer: true,
      interruptBehavior: 'cancel',
    },
    prompt: {
      group: 'primary',
      style: 'detailed',
      whenToUse: ['нужно уточнить неоднозначность, выбрать один из вариантов или спросить предпочтение пользователя прямо во время выполнения'],
      avoidWhen: ['план уже готов и нужен именно approval плана через exit_plan_mode', 'можно сделать разумное предположение без риска и без потери цели пользователя'],
      guidance: 'Формулируй короткие конкретные вопросы с 2-4 вариантами. Для независимых флажков можно использовать multiSelect=true.',
    },
  },
  {
    name: 'skill',
    summary: 'Загружает reusable skill из workspace или пользовательских skill directories и возвращает его инструкции в текущий цикл агента.',
    details: [
      'Ищет SKILL.md в .codex/skills, .cursor/skills, .cursorcoder/skills, .claude/skills внутри workspace и в пользовательских skill roots.',
      'Подходит, когда пользователь явно назвал навык, slash-команду или нужен повторно используемый workflow вместо импровизации с нуля.',
      'После загрузки навыка не пересказывай его пользователю — применяй его инструкции в следующих tool-вызовах.',
    ],
    args: [
      { name: 'name', description: 'имя навыка, slug или путь вида openai-docs / review-pr / .system/openai-docs', required: true },
      { name: 'task', description: 'необязательный контекст: что именно нужно сделать этим навыком' },
    ],
    examples: [
      '{ "tool": "skill", "args": { "name": "openai-docs", "task": "Подобрать актуальную модель и официальный reference flow" } }',
      '{ "tool": "skill", "args": { "name": "review-pr", "task": "Провести ревью изменений перед финальным ответом" } }',
    ],
    aliases: ['SkillTool', 'use_skill', 'load_skill', 'slash_command', 'invoke_skill'],
    searchHints: ['использовать навык', 'загрузить skill', 'slash command skill', 'reusable workflow', 'подтянуть инструкцию навыка', 'вызвать skill по имени'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['meta_operation'],
    capabilities: {
      userFacingName: 'Навык',
      readOnly: true,
      concurrencySafe: true,
      shouldDefer: true,
    },
    prompt: {
      group: 'primary',
      style: 'detailed',
      whenToUse: ['пользователь явно назвал навык, slash-команду или нужен готовый reusable workflow вместо импровизации'],
      avoidWhen: ['достаточно обычных code/file/web инструментов и нет явного сигнала, что нужен именно навык'],
      guidance: 'Используй skill, когда название навыка уже известно или хорошо угадывается. После загрузки сразу следуй инструкциям навыка в текущем цикле.',
    },
  },
  {
    name: 'list_mcp_resources',
    summary: 'Показывает ресурсы, которые доступны на настроенных MCP серверах.',
    details: [
      'Читает MCP конфиг из .mcp.json, .cursor/mcp.json или settings aiAssistant.mcpServers.',
      'Используй перед чтением URI, когда нужно сначала понять, какие ресурсы вообще доступны у подключённого сервера.',
    ],
    args: [
      { name: 'server', description: 'необязательное имя MCP сервера, чтобы сузить список' },
    ],
    examples: [
      '{ "tool": "list_mcp_resources" }',
      '{ "tool": "list_mcp_resources", "args": { "server": "linear" } }',
    ],
    aliases: ['ListMcpResourcesTool', 'mcp_resources', 'mcp_list_resources', 'list_resources'],
    searchHints: ['mcp ресурсы', 'список ресурсов mcp', 'какие uri доступны у mcp сервера', 'resource uri из коннектора', 'показать ресурсы подключённого сервера'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source', 'tool_search_suggestion_source'],
    capabilities: {
      userFacingName: 'Ресурсы MCP',
      readOnly: true,
      concurrencySafe: true,
      shouldDefer: true,
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['нужно увидеть доступные URI и ресурсы уже настроенного MCP сервера'],
      avoidWhen: ['конкретный server + uri уже известны и можно сразу читать ресурс'],
      guidance: 'Обычно сначала перечисляй ресурсы, затем переходи к read_mcp_resource по выбранному server + uri.',
    },
  },
  {
    name: 'read_mcp_resource',
    summary: 'Читает конкретный MCP ресурс по server + uri.',
    details: [
      'Для бинарных ресурсов сохраняет содержимое на диск и возвращает путь.',
      'Если URI ещё неизвестен, сначала используй list_mcp_resources.',
    ],
    args: [
      { name: 'server', description: 'имя MCP сервера', required: true },
      { name: 'uri', description: 'URI ресурса на MCP сервере', required: true },
    ],
    examples: [
      '{ "tool": "read_mcp_resource", "args": { "server": "linear", "uri": "resource://issue/ABC-123" } }',
    ],
    aliases: ['ReadMcpResourceTool', 'mcp_read_resource', 'read_resource'],
    searchHints: ['прочитать mcp ресурс', 'read mcp resource', 'получить содержимое uri ресурса', 'read resource from connector'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source', 'tool_search_suggestion_source'],
    capabilities: {
      userFacingName: 'Чтение MCP ресурса',
      readOnly: true,
      concurrencySafe: true,
      shouldDefer: true,
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['есть конкретный server + uri и нужно прочитать содержимое MCP ресурса'],
      avoidWhen: ['ещё неизвестно, какие URI доступны на сервере'],
      guidance: 'Перед чтением обычно сначала перечисли ресурсы через list_mcp_resources.',
    },
  },
  {
    name: 'list_mcp_tools',
    summary: 'Показывает MCP tools, которые доступны на настроенных MCP серверах.',
    details: [
      'Используй перед generic MCP вызовом, когда нужно понять реальные remote tool names и их inputSchema.',
      'Если сервер требует OAuth, список может подсказать сначала пройти mcp_auth.',
    ],
    args: [
      { name: 'server', description: 'необязательное имя MCP сервера, чтобы сузить список' },
    ],
    examples: [
      '{ "tool": "list_mcp_tools" }',
      '{ "tool": "list_mcp_tools", "args": { "server": "linear" } }',
    ],
    aliases: ['ListMcpToolsTool', 'mcp_list_tools', 'list_connector_tools', 'list_remote_tools'],
    searchHints: ['список mcp tools', 'какие tools есть у mcp сервера', 'connector tools', 'remote tools у mcp', 'tool schema у mcp'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source', 'tool_search_suggestion_source'],
    capabilities: {
      userFacingName: 'Список MCP tools',
      readOnly: true,
      concurrencySafe: true,
      shouldDefer: true,
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['нужно понять, какие MCP tools доступны на сервере и как они называются'],
      avoidWhen: ['известны конкретный server + tool name и можно сразу вызывать mcp_tool'],
      guidance: 'Обычно сначала перечисляй MCP tools, затем вызывай mcp_tool с server + name + arguments. Обязательно смотри inputSchema: если у tool только поле command:string, передавай весь вызов целиком в arguments.command.',
    },
  },
  {
    name: 'mcp_tool',
    summary: 'Вызывает generic MCP tool на выбранном сервере с произвольными arguments.',
    details: [
      'Подходит для remote tool calls после list_mcp_tools.',
      'Для non-read-only MCP tools по умолчанию запрашивает явное подтверждение пользователя.',
    ],
    args: [
      { name: 'server', description: 'имя MCP сервера', required: true },
      { name: 'name', description: 'имя MCP tool на сервере', required: true },
      { name: 'arguments', description: 'объект аргументов для remote MCP tool' },
    ],
    examples: [
      '{ "tool": "mcp_tool", "args": { "server": "linear", "name": "get_issue", "arguments": { "id": "ABC-123" } } }',
    ],
    aliases: ['MCPTool', 'call_mcp_tool', 'mcp_call', 'remote_tool'],
    searchHints: ['вызвать mcp tool', 'generic mcp tool call', 'запустить connector tool', 'remote tool call через mcp'],
    subagentModes: ALL_SUBAGENT_MODES,
    capabilities: {
      userFacingName: 'Вызов MCP tool',
      shouldDefer: true,
      requiresUserInteraction: true,
      interruptBehavior: 'cancel',
      approval: {
        kind: 'mcp',
        title: 'Подтвердите вызов MCP tool',
        description: 'Remote MCP tool может читать или менять внешнюю систему.',
      },
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['нужно выполнить remote MCP tool с уже известными server + tool name'],
      avoidWhen: ['ещё неизвестно, какие MCP tools доступны на сервере', 'нужно читать именно MCP resource по URI'],
      guidance: 'Обычно сначала перечисляй tools через list_mcp_tools, затем вызывай mcp_tool. Строго следуй inputSchema remote tool. Если schema содержит только command:string, вся CLI-строка должна лежать в arguments.command. При auth-потребности используй mcp_auth.',
    },
  },
  {
    name: 'mcp_auth',
    summary: 'Запускает OAuth-аутентификацию для HTTP MCP сервера и ждёт завершения browser callback.',
    details: [
      'Используй, когда MCP сервер отвечает 401 или явно требует OAuth.',
      'Работает для http MCP серверов с oauth-конфигом; после успеха список tools станет доступен без ручного shell.',
    ],
    args: [
      { name: 'server', description: 'имя MCP сервера', required: true },
      { name: 'force', description: 'очистить прошлые токены и пройти re-auth заново' },
    ],
    examples: [
      '{ "tool": "mcp_auth", "args": { "server": "linear" } }',
      '{ "tool": "mcp_auth", "args": { "server": "linear", "force": true } }',
    ],
    aliases: ['McpAuthTool', 'authenticate_mcp', 'reauth_mcp', 'mcp_oauth'],
    searchHints: ['аутентифицировать mcp сервер', 'oauth для mcp', '401 у mcp сервера', 'mcp auth', 'connector auth'],
    subagentModes: NO_SUBAGENT_MODES,
    capabilities: {
      userFacingName: 'MCP OAuth',
      shouldDefer: true,
      requiresUserInteraction: true,
      interruptBehavior: 'cancel',
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['MCP сервер требует OAuth-аутентификацию или generic MCP вызов упёрся в 401'],
      avoidWhen: ['сервер уже доступен и MCP tools/list работают без ошибок'],
      guidance: 'После успешного mcp_auth обычно сразу проверь доступные tools через list_mcp_tools.',
    },
  },
  {
    name: 'enter_worktree',
    summary: 'Создаёт изолированный git worktree для текущего проекта и переключает сессию агента в него.',
    details: [
      'Используй перед рискованными правками, большими рефакторами или когда нужно изолировать изменения от основного дерева.',
      'После входа агент читает, редактирует и запускает проверки уже внутри worktree.',
    ],
    args: [
      { name: 'name', description: 'необязательное имя/slug worktree; если не задано, будет сгенерировано автоматически' },
    ],
    examples: [
      '{ "tool": "enter_worktree" }',
      '{ "tool": "enter_worktree", "args": { "name": "refactor-runtime" } }',
    ],
    aliases: ['EnterWorktreeTool', 'enter_git_worktree', 'create_worktree', 'switch_to_worktree'],
    searchHints: ['создать worktree', 'изолированная git ветка для правок', 'работать в отдельном дереве', 'безопасный рефакторинг в worktree', 'переключить агента в worktree'],
    subagentModes: NO_SUBAGENT_MODES,
    mutatesWorkspace: true,
    capabilities: {
      userFacingName: 'Вход в worktree',
      shouldDefer: true,
      requiresUserInteraction: true,
      interruptBehavior: 'cancel',
      approval: {
        kind: 'worktree',
        title: 'Подтвердите создание worktree',
        description: 'Будет создана отдельная git worktree-ветка и сессия агента переключится в неё.',
      },
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['нужна изоляция изменений перед рискованной правкой или отдельной веткой работы'],
      avoidWhen: ['задача маленькая и не требует отдельного git-контекста', 'агент уже находится в активной worktree-сессии'],
      guidance: 'После enter_worktree дальнейшие file/shell действия происходят уже внутри worktree.',
    },
  },
  {
    name: 'exit_worktree',
    summary: 'Выходит из активной worktree-сессии и либо сохраняет, либо удаляет её.',
    details: [
      'action="keep" возвращает агента в исходный root, но оставляет worktree и ветку на диске.',
      'action="remove" удаляет worktree и связанную ветку; для грязного worktree нужен discard_changes=true.',
    ],
    args: [
      { name: 'action', description: 'keep | remove', required: true },
      { name: 'discard_changes', description: 'true, если при remove нужно отбросить незакоммиченные изменения и лишние коммиты' },
    ],
    examples: [
      '{ "tool": "exit_worktree", "args": { "action": "keep" } }',
      '{ "tool": "exit_worktree", "args": { "action": "remove", "discard_changes": true } }',
    ],
    aliases: ['ExitWorktreeTool', 'leave_worktree', 'remove_worktree', 'close_worktree'],
    searchHints: ['выйти из worktree', 'удалить worktree', 'вернуться в основной root проекта', 'закрыть изолированную ветку работы'],
    subagentModes: NO_SUBAGENT_MODES,
    mutatesWorkspace: true,
    capabilities: {
      userFacingName: 'Выход из worktree',
      destructive: true,
      shouldDefer: true,
      requiresUserInteraction: true,
      interruptBehavior: 'cancel',
      approval: {
        kind: 'worktree',
        title: 'Подтвердите выход из worktree',
        description: 'Агент вернётся к исходному root проекта. При remove worktree и ветка будут удалены.',
      },
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['нужно закончить работу в worktree и вернуться в исходный root', 'нужно удалить временную worktree после завершения задачи'],
      avoidWhen: ['агент не находится в worktree-сессии'],
      guidance: 'Для чистого возврата без удаления используй action="keep". Для удаления грязной worktree сначала явно разреши discard_changes=true.',
    },
  },
  {
    name: 'scan_structure',
    summary: 'Сканирует корневые папки workspace и показывает обзор структуры проекта.',
    args: [
      { name: 'outputMode', description: 'overview | dirs | important_files' },
      { name: 'limit', description: 'сколько элементов показать за страницу' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "scan_structure" }',
      '{ "tool": "scan_structure", "args": { "outputMode": "dirs", "limit": 20 } }',
      '{ "tool": "scan_structure", "args": { "outputMode": "important_files", "limit": 30 } }',
    ],
    searchHints: ['обзор структуры проекта', 'какие папки в проекте', 'быстро понять layout репозитория'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source', 'tool_search_suggestion_source'],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['нужен быстрый обзор корня workspace перед более точным поиском'],
      avoidWhen: ['нужно изучить конкретный файл или точную функциональность'],
      guidance: 'overview хорош для первого обзора, dirs — для навигации по папкам, important_files — для входа через ключевые файлы проекта.',
    },
  },
  {
    name: 'list_files',
    summary: 'Строит дерево, плоский список или обзор директорий первого уровня.',
    args: [
      { name: 'path', description: 'директория для локального дерева' },
      { name: 'dir', description: 'синоним path' },
      { name: 'target_directory', description: 'синоним path' },
      { name: 'outputMode', description: 'tree | flat | dirs' },
      { name: 'limit', description: 'сколько файлов или элементов показать' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "list_files" }',
      '{ "tool": "list_files", "args": { "path": "src", "outputMode": "dirs", "limit": 40 } }',
      '{ "tool": "list_files", "args": { "path": "src", "outputMode": "tree", "limit": 120 } }',
      '{ "tool": "list_files", "args": { "path": "src", "outputMode": "flat", "offset": 120, "limit": 120 } }',
    ],
    aliases: ['list_directory', 'list_dir', 'ls'],
    searchHints: ['показать дерево файлов', 'список файлов в директории', 'посмотреть структуру папки', 'пагинировать список файлов', 'обзор директорий первого уровня'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: [
      'recommendation_redirect_source',
      'tool_search_suggestion_source',
      'retrieval_nudge_source',
      'linear_study_source',
      'mutation_read_source',
    ],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['нужно увидеть дерево конкретной директории или состав файлов'],
      avoidWhen: ['вопрос сформулирован по смыслу и retrieval уже может сузить область'],
      guidance: 'Для быстрого входа в большую директорию используй dirs, для обзора layout — tree, а для длинной навигации переключайся на flat с offset/limit.',
    },
  },
  {
    name: 'glob',
    summary: 'Ищет файлы по glob-паттерну.',
    args: [
      { name: 'glob_pattern', description: 'glob-шаблон', required: true },
      { name: 'target_directory', description: 'ограничить поиск директорией' },
      { name: 'outputMode', description: 'flat | grouped' },
      { name: 'limit', description: 'сколько результатов показать за страницу' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "glob", "args": { "glob_pattern": "**/*.ts", "limit": 100 } }',
      '{ "tool": "glob", "args": { "glob_pattern": "**/*.ts", "outputMode": "grouped", "limit": 40 } }',
      '{ "tool": "glob", "args": { "glob_pattern": "**/*.ts", "target_directory": "src", "offset": 100, "limit": 100 } }',
    ],
    aliases: ['glob_search'],
    searchHints: ['найти файлы по glob маске', 'поиск файлов по расширению', 'шаблон файлов', 'следующая страница glob'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: [
      'recommendation_redirect_source',
      'tool_search_suggestion_source',
      'retrieval_nudge_source',
      'mutation_read_source',
    ],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['ты уже знаешь файловую маску или расширение'],
      avoidWhen: ['неизвестно, какие именно файлы релевантны по смыслу'],
      guidance: 'Для широких выдач используй outputMode=grouped, чтобы сначала понять, в каких директориях лежат совпадения. Потом переходи к list_files, read_file или lsp_inspect.',
    },
  },
  {
    name: 'find_files',
    summary: 'Ищет файлы по паттерну и сортирует новые файлы первыми.',
    args: [
      { name: 'pattern', description: 'glob-паттерн', required: true },
      { name: 'target_directory', description: 'ограничить поиск директорией' },
      { name: 'outputMode', description: 'flat | grouped' },
      { name: 'limit', description: 'сколько результатов показать за страницу' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "find_files", "args": { "pattern": "**/*.py", "limit": 100 } }',
      '{ "tool": "find_files", "args": { "pattern": "router", "outputMode": "grouped", "limit": 40 } }',
      '{ "tool": "find_files", "args": { "pattern": "router", "offset": 100, "limit": 100 } }',
    ],
    searchHints: ['найти файлы по паттерну', 'поиск конкретных файлов', 'поиск по имени файла', 'следующая страница поиска файлов'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: [
      'recommendation_redirect_source',
      'tool_search_suggestion_source',
      'retrieval_nudge_source',
      'mutation_read_source',
    ],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['нужно найти файлы по имени или известному паттерну'],
      avoidWhen: ['задача про архитектуру или смысловой поиск по коду'],
      guidance: 'Для широкого имени файла полезно начать с outputMode=grouped, чтобы увидеть, в каких директориях лежат совпадения. Для точного чтения потом переходи к read_file или lsp_inspect.',
    },
  },
  {
    name: 'detect_stack',
    summary: 'Определяет языки, фреймворки, инфраструктуру и точки входа проекта.',
    args: [
      { name: 'outputMode', description: 'summary | entrypoints | infra' },
      { name: 'limit', description: 'сколько элементов показать за страницу' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "detect_stack" }',
      '{ "tool": "detect_stack", "args": { "outputMode": "entrypoints", "limit": 20 } }',
      '{ "tool": "detect_stack", "args": { "outputMode": "infra", "limit": 20 } }',
    ],
    searchHints: ['какой стек у проекта', 'определить framework и языки', 'точки входа проекта'],
    subagentModes: ALL_SUBAGENT_MODES,
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['нужно быстро понять стек, фреймворки и точки входа проекта'],
      guidance: 'summary даёт общий вход, entrypoints помогает выбрать, что читать первым, infra показывает важные инфраструктурные файлы.',
    },
  },
  {
    name: 'grep',
    summary: 'Ищет строку или regex, умеет content/files/count и даёт навигацию к следующему шагу.',
    args: [
      { name: 'pattern', description: 'строка или regex', required: true },
      { name: 'path', description: 'один файл для поиска' },
      { name: 'paths', description: 'массив путей' },
      { name: 'type', description: 'тип файлов/расширение' },
      { name: 'ignoreCase', description: 'регистронезависимый поиск' },
      { name: 'multiline', description: 'поиск через несколько строк' },
      { name: 'outputMode', description: 'content | files_with_matches | count' },
      { name: 'limit', description: 'максимум результатов' },
      { name: 'offset', description: 'смещение для пагинации' },
    ],
    examples: [
      '{ "tool": "grep", "args": { "pattern": "class Router" } }',
      '{ "tool": "grep", "args": { "pattern": "useAgentSession", "outputMode": "files_with_matches" } }',
      '{ "tool": "grep", "args": { "pattern": "TODO", "outputMode": "count", "type": "ts" } }',
    ],
    searchHints: ['поиск строки или regex', 'найти текст по коду', 'grep по проекту', 'список файлов с совпадениями', 'частоты совпадений по файлам'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: [
      'recommendation_redirect_source',
      'tool_search_suggestion_source',
      'retrieval_nudge_source',
      'linear_study_source',
      'mutation_read_source',
    ],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['известна строка, символ, фрагмент текста или regex'],
      avoidWhen: ['вопрос сформулирован естественным языком без конкретных токенов'],
      guidance: 'Для широкого поиска по проекту по умолчанию полезнее files_with_matches; для обзора плотности совпадений используй count, а для детального чтения после совпадений переходи к read_file_range.',
    },
  },
  {
    name: 'read_file',
    summary: 'Читает файл, даёт обзор больших файлов и поддерживает режимы head/tail/manifest/metadata.',
    args: [
      { name: 'path', description: 'относительный путь к файлу', required: true },
      { name: 'offset', description: 'номер строки, 1-based; отрицательные значения считаются с конца' },
      { name: 'limit', description: 'количество строк' },
      { name: 'outputMode', description: 'auto | outline | head | tail | manifest | metadata' },
    ],
    examples: [
      '{ "tool": "read_file", "args": { "path": "src/main.ts" } }',
      '{ "tool": "read_file", "args": { "path": "package.json", "outputMode": "manifest" } }',
      '{ "tool": "read_file", "args": { "path": "README.md", "outputMode": "tail", "limit": 80 } }',
      '{ "tool": "read_file", "args": { "path": "dist/bundle.js", "outputMode": "metadata" } }',
    ],
    aliases: ['read', 'cat', 'open_file', 'view_file'],
    searchHints: ['прочитать файл', 'открыть содержимое файла', 'посмотреть код файла', 'обзор package.json', 'метаданные файла'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: [
      'recommendation_redirect_source',
      'tool_search_suggestion_source',
      'retrieval_nudge_source',
      'linear_study_source',
      'mutation_read_source',
    ],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['нужно изучить конкретный файл целиком или крупный фрагмент'],
      avoidWhen: ['ещё неясно, какой файл действительно релевантен'],
      guidance: 'Для больших файлов сначала читай overview. Для config/manifest используй outputMode=manifest, для нетекстовых или подозрительных артефактов — outputMode=metadata.',
    },
  },
  {
    name: 'read_file_range',
    summary: 'Читает диапазон строк из файла.',
    args: [
      { name: 'path', description: 'относительный путь к файлу', required: true },
      { name: 'startLine', description: 'начальная строка' },
      { name: 'endLine', description: 'конечная строка' },
    ],
    examples: ['{ "tool": "read_file_range", "args": { "path": "src/main.ts", "startLine": 10, "endLine": 80 } }'],
    searchHints: ['прочитать диапазон строк', 'посмотреть кусок файла', 'фрагмент файла по строкам'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: [
      'recommendation_redirect_source',
      'tool_search_suggestion_source',
      'retrieval_nudge_source',
      'linear_study_source',
      'mutation_read_source',
    ],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['нужен конкретный диапазон строк без чтения всего файла'],
      guidance: 'Лучший инструмент для последовательной навигации по большим файлам после обзора или grep.',
    },
  },
  {
    name: 'extract_symbols',
    summary: 'Извлекает символы файла и умеет overview, grouped-by-kind и подробный список.',
    args: [
      { name: 'path', description: 'путь к файлу', required: true },
      { name: 'outputMode', description: 'summary | symbols | kinds' },
      { name: 'limit', description: 'сколько символов показать за страницу' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "extract_symbols", "args": { "path": "src/api/router.ts", "outputMode": "summary", "limit": 20 } }',
      '{ "tool": "extract_symbols", "args": { "path": "src/api/router.ts", "outputMode": "kinds" } }',
      '{ "tool": "extract_symbols", "args": { "path": "src/api/router.ts", "outputMode": "symbols", "offset": 30, "limit": 30 } }',
    ],
    searchHints: ['какие символы есть в файле', 'функции и классы файла', 'извлечь symbols', 'сгруппировать символы по типам', 'обзор symbols файла'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source', 'tool_search_suggestion_source'],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['нужно быстро получить список функций, классов и экспортов файла'],
      guidance: 'Для первого прохода полезен outputMode=summary, kinds даёт группировку по типам символов, symbols — подробный постраничный список. Для точной навигации по конкретному символу переходи к lsp_inspect.',
    },
  },
  {
    name: 'workspace_symbols',
    summary: 'Ищет символы по имени во всём проекте.',
    args: [
      { name: 'query', description: 'имя или часть имени символа', required: true },
      { name: 'limit', description: 'сколько символов показать за страницу' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "workspace_symbols", "args": { "query": "Router", "limit": 30 } }',
      '{ "tool": "workspace_symbols", "args": { "query": "Router", "offset": 30, "limit": 30 } }',
    ],
    aliases: ['search_symbol', 'search_symbols', 'find_symbol', 'find_symbols'],
    searchHints: ['поиск класса по имени', 'найти функцию по имени', 'workspace symbols'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source', 'tool_search_suggestion_source'],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['известно имя или часть имени класса, функции, типа или символа'],
      guidance: 'Если совпадений много, продолжай через offset/limit, а затем переходи к read_file, extract_symbols или lsp_inspect.',
    },
  },
  {
    name: 'lsp_inspect',
    summary: 'Code intelligence через LSP: definition, references, hover, implementation, symbol-навигация и call hierarchy.',
    args: [
      { name: 'operation', description: 'definition | references | hover | implementation | document_symbols | workspace_symbols | incoming_calls | outgoing_calls', required: true },
      { name: 'path', description: 'путь к файлу для path-based операций' },
      { name: 'line', description: 'номер строки, 1-based, для definition/references/hover/implementation' },
      { name: 'character', description: 'номер символа, 1-based, для definition/references/hover/implementation' },
      { name: 'query', description: 'запрос для workspace_symbols' },
      { name: 'include_declaration', description: 'включать ли declaration в references' },
      { name: 'limit', description: 'сколько результатов показывать за страницу для references/workspace_symbols/call hierarchy' },
      { name: 'offset', description: 'смещение для следующей страницы результатов' },
    ],
    examples: [
      '{ "tool": "lsp_inspect", "args": { "operation": "definition", "path": "src/agent/runtime/turnLoop.ts", "line": 42, "character": 14 } }',
      '{ "tool": "lsp_inspect", "args": { "operation": "references", "path": "src/ui/provider.ts", "line": 120, "character": 8 } }',
      '{ "tool": "lsp_inspect", "args": { "operation": "workspace_symbols", "query": "AgentSession" } }',
      '{ "tool": "lsp_inspect", "args": { "operation": "incoming_calls", "path": "src/agent/runtime/queryEngine.ts", "line": 30, "character": 12, "limit": 20 } }',
    ],
    aliases: ['lsp', 'code_intel', 'code_nav', 'go_to_definition', 'find_references', 'hover_info', 'find_callers', 'find_callees'],
    searchHints: ['перейти к определению', 'найти ссылки на символ', 'hover по символу', 'lsp code intelligence', 'найти кто вызывает функцию', 'найти какие вызовы делает функция'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source', 'tool_search_suggestion_source'],
    capabilities: {
      userFacingName: 'LSP-инспекция',
      readOnly: true,
      concurrencySafe: true,
      shouldDefer: true,
    },
    prompt: {
      whenToUse: ['известна точка в файле и нужно перейти к определению, найти ссылки, получить hover, реализацию или call hierarchy'],
      avoidWhen: ['вопрос пока слишком широкий и сначала нужно сузить область через retrieval, grep или чтение файлов'],
      guidance: 'Лучший инструмент для точной навигации по символам и вызовам, когда уже известны файл и позиция. Для больших lists используй limit/offset.',
    },
  },
  {
    name: 'dependencies',
    summary: 'Показывает зависимости в манифестах и по коду: overview, manifests, packages, files, graph.',
    args: [
      { name: 'paths', description: 'массив путей к файлам', required: true },
      { name: 'path', description: 'один путь как сокращение' },
      { name: 'outputMode', description: 'summary | manifests | packages | files | graph' },
      { name: 'limit', description: 'сколько элементов показать за страницу' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "dependencies", "args": { "paths": ["package.json", "src/main.ts"], "outputMode": "summary" } }',
      '{ "tool": "dependencies", "args": { "paths": ["package.json"], "outputMode": "manifests", "limit": 20 } }',
      '{ "tool": "dependencies", "args": { "paths": ["package.json"], "outputMode": "packages", "limit": 40 } }',
      '{ "tool": "dependencies", "args": { "paths": ["src/main.ts"], "outputMode": "files", "limit": 20 } }',
      '{ "tool": "dependencies", "args": { "paths": ["src/main.ts"], "outputMode": "graph", "limit": 50 } }',
    ],
    searchHints: ['какие зависимости использует файл', 'imports и package dependencies', 'зависимости модуля', 'обзор манифестов зависимостей', 'сгруппировать imports по файлам'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source', 'tool_search_suggestion_source'],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['нужно понять imports, package dependencies или связи модуля'],
      guidance: 'summary хорош для обзора, manifests — для списка файлов-манифестов, packages — для плоского списка пакетов, files — для группировки импортов по исходным файлам, graph — для плоских связей.',
    },
  },
  {
    name: 'read_lints',
    summary: 'Читает ошибки и предупреждения IDE по файлам или директориям.',
    args: [
      { name: 'paths', description: 'массив файлов или директорий' },
      { name: 'path', description: 'один файл или директория' },
      { name: 'outputMode', description: 'summary | files | items' },
      { name: 'severity', description: 'default | all | error | warning | info | hint' },
      { name: 'limit', description: 'сколько элементов или файлов показать за страницу' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "read_lints", "args": { "path": "src", "outputMode": "summary" } }',
      '{ "tool": "read_lints", "args": { "path": "src", "outputMode": "files", "limit": 20 } }',
      '{ "tool": "read_lints", "args": { "path": "src", "outputMode": "items", "severity": "error", "limit": 30 } }',
    ],
    aliases: ['lints', 'lint', 'diagnostics'],
    searchHints: ['ошибки и предупреждения IDE', 'lint diagnostics', 'прочитать lints'],
    subagentModes: ALL_SUBAGENT_MODES,
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['нужно прочитать ошибки и предупреждения IDE по нескольким файлам или каталогу'],
      guidance: 'summary — для обзора, files — для списка проблемных файлов, items — для постраничного разбора отдельных diagnostics.',
    },
  },
  {
    name: 'get_diagnostics',
    summary: 'Показывает diagnostics IDE для одного файла или всего проекта.',
    args: [
      { name: 'path', description: 'файл или директория для точечной проверки' },
      { name: 'paths', description: 'массив файлов или директорий' },
      { name: 'outputMode', description: 'summary | files | items' },
      { name: 'severity', description: 'default | all | error | warning | info | hint' },
      { name: 'limit', description: 'сколько элементов или файлов показать за страницу' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "get_diagnostics", "args": { "path": "src/main.ts", "outputMode": "items" } }',
      '{ "tool": "get_diagnostics", "args": { "path": "src", "outputMode": "summary", "severity": "error" } }',
    ],
    searchHints: ['проверить ошибки в файле', 'IDE diagnostics', 'ошибки после правки'],
    alwaysLoad: true,
    subagentModes: ALL_SUBAGENT_MODES,
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['после правки нужно быстро проверить ошибки в конкретном файле'],
      guidance: 'Для одного файла обычно полезен items, для директории или проекта — summary.',
    },
  },
  {
    name: 'semantic_search',
    summary: 'Семантический retrieval по коду с режимами overview, file-view и chunk-view.',
    args: [
      { name: 'query', description: 'вопрос на естественном языке', required: true },
      { name: 'target_directory', description: 'ограничить поиск директорией' },
      { name: 'outputMode', description: 'summary | files | chunks' },
      { name: 'limit', description: 'максимум результатов' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "semantic_search", "args": { "query": "обработка ошибок авторизации", "outputMode": "summary" } }',
      '{ "tool": "semantic_search", "args": { "query": "обработка ошибок авторизации", "outputMode": "files", "limit": 8 } }',
      '{ "tool": "semantic_search", "args": { "query": "обработка ошибок авторизации", "outputMode": "chunks", "limit": 6 } }',
    ],
    aliases: ['search_code', 'semantic', 'embeddings_search'],
    searchHints: ['смысловой поиск по коду', 'natural language query по проекту', 'найти релевантные фрагменты кода', 'chunk retrieval по смыслу', 'релевантные файлы по смыслу'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source', 'mutation_read_source', 'retrieval'],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['вопрос дан естественным языком про логику, архитектуру, поток данных или обработку ошибок'],
      avoidWhen: ['уже известны точные файлы или строки для чтения'],
      guidance: 'summary хорош для первого прохода, files — чтобы выбрать, что читать дальше, chunks — когда уже нужен постраничный просмотр релевантных фрагментов.',
    },
  },
  {
    name: 'find_relevant_files',
    summary: 'Подбирает релевантные файлы по смыслу с режимами overview, file-view и snippet-view.',
    args: [
      { name: 'query', description: 'вопрос на естественном языке', required: true },
      { name: 'target_directory', description: 'ограничить поиск директорией' },
      { name: 'outputMode', description: 'summary | files | snippets' },
      { name: 'limit', description: 'максимум файлов' },
      { name: 'offset', description: 'смещение для следующей страницы' },
    ],
    examples: [
      '{ "tool": "find_relevant_files", "args": { "query": "где инициализируется webview и обработка сообщений", "outputMode": "summary" } }',
      '{ "tool": "find_relevant_files", "args": { "query": "где инициализируется webview и обработка сообщений", "outputMode": "files", "limit": 8 } }',
      '{ "tool": "find_relevant_files", "args": { "query": "где инициализируется webview и обработка сообщений", "outputMode": "snippets", "limit": 8 } }',
    ],
    aliases: ['relevant_files', 'rank_files', 'semantic_files', 'retrieve_files'],
    searchHints: ['какие файлы читать для вопроса', 'подобрать релевантные файлы', 'retrieval по файлам', 'shortlist файлов по смыслу', 'snippet view по релевантным файлам'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source', 'mutation_read_source', 'retrieval'],
    capabilities: {
      concurrencySafe: true,
    },
    prompt: {
      whenToUse: ['нужно быстро выбрать, какие файлы читать по смыслу вопроса'],
      avoidWhen: ['ты уже знаешь точный файл или набор файлов'],
      guidance: 'summary хорош для первого прохода, files — для shortlist файлов, snippets — для просмотра лучших фрагментов по каждому файлу перед чтением.',
    },
  },
  {
    name: 'web_search',
    summary: 'Реальный веб-поиск с режимами summary, results, sources и grounded answer.',
    details: [
      'Используй, когда нужна актуальная информация вне workspace, но ещё нет точного URL.',
      'summary хорош для first pass, results — для snippets, sources — когда нужны только ссылки.',
      'answer собирает grounded answer по верхним источникам и подходит, когда нужен уже не просто список ссылок, а краткий ответ по найденным страницам.',
    ],
    args: [
      { name: 'query', description: 'поисковый запрос', required: true },
      { name: 'outputMode', description: 'summary | results | sources | answer' },
      { name: 'limit', description: 'сколько результатов показать' },
      { name: 'allowed_domains', description: 'список разрешённых доменов' },
      { name: 'blocked_domains', description: 'список запрещённых доменов' },
      { name: 'prompt', description: 'какой grounded answer собрать по найденным источникам' },
      { name: 'fetchTopResults', description: 'сколько верхних URL дочитать для grounded answer' },
      { name: 'allow_llm_fallback', description: 'разрешить fallback без подтверждённых веб-источников' },
    ],
    examples: [
      '{ "tool": "web_search", "args": { "query": "FastAPI middleware CORS", "outputMode": "summary" } }',
      '{ "tool": "web_search", "args": { "query": "FastAPI middleware CORS", "outputMode": "sources", "allowed_domains": ["fastapi.tiangolo.com"] } }',
      '{ "tool": "web_search", "args": { "query": "FastAPI middleware CORS", "outputMode": "answer", "prompt": "Коротко объясни, как правильно включить CORS и какие параметры обычно нужны", "fetchTopResults": 3, "allowed_domains": ["fastapi.tiangolo.com", "starlette.io"] } }',
    ],
    aliases: ['google', 'search_web', 'bing', 'duckduckgo'],
    searchHints: ['поиск в интернете', 'найти актуальную информацию', 'веб поиск', 'список источников по запросу', 'поиск по доменам', 'найти свежие статьи', 'собрать ответ по источникам из интернета', 'grounded answer из веба'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source'],
    capabilities: {
      userFacingName: 'Веб-поиск',
      readOnly: true,
      concurrencySafe: true,
      shouldDefer: true,
    },
    prompt: {
      whenToUse: ['нужна актуальная информация вне workspace'],
      avoidWhen: ['ответ можно получить из локального проекта'],
      guidance: 'Начинай с summary, при необходимости переходи к sources или results. Если нужен уже короткий ответ по найденным источникам, используй outputMode=answer с prompt. Если уже есть точный URL, вместо этого используй web_fetch.',
    },
  },
  {
    name: 'web_fetch',
    summary: 'Загружает конкретный URL с режимами summary, content и metadata, а также умеет извлекать ответ по prompt.',
    details: [
      'Подходит, когда URL уже известен и нужно получить обзор страницы, метаданные или полный текст/JSON.',
      'Для нетекстовых ресурсов metadata обычно полезнее, чем полный content.',
      'Если передать prompt, инструмент попробует извлечь ответ именно на этот вопрос из содержимого страницы или JSON.',
    ],
    args: [
      { name: 'url', description: 'полный URL', required: true },
      { name: 'outputMode', description: 'summary | content | metadata' },
      { name: 'prompt', description: 'какой ответ извлечь из страницы или JSON' },
    ],
    examples: [
      '{ "tool": "web_fetch", "args": { "url": "https://example.com", "outputMode": "summary" } }',
      '{ "tool": "web_fetch", "args": { "url": "https://example.com/api", "outputMode": "content" } }',
      '{ "tool": "web_fetch", "args": { "url": "https://example.com/docs", "outputMode": "summary", "prompt": "Коротко вытащи шаги установки и ограничения" } }',
    ],
    aliases: ['fetch', 'fetch_url', 'download', 'curl'],
    searchHints: ['прочитать страницу по URL', 'загрузить URL', 'fetch веб-страницы', 'получить summary страницы', 'прочитать JSON по URL', 'метаданные URL', 'вытащить ответ из страницы', 'извлечь шаги из документации по URL'],
    subagentModes: ALL_SUBAGENT_MODES,
    workflowRoles: ['recommendation_redirect_source'],
    capabilities: {
      userFacingName: 'Загрузка URL',
      readOnly: true,
      concurrencySafe: true,
      shouldDefer: true,
      approval: {
        kind: 'web',
        title: 'Подтвердите загрузку URL',
        description: 'Для внешнего домена, который не входит в список доверенных documentation/code hosts, нужно подтверждение.',
      },
    },
    prompt: {
      whenToUse: ['есть конкретный URL, который нужно прочитать или разобрать'],
      avoidWhen: ['нужен только общий поиск по теме, а URL ещё нет'],
      guidance: 'summary хорош для первого прохода, content — для полного текста или JSON, metadata — для бинарных и подозрительных ресурсов. Если нужно вытащить конкретный ответ из страницы, добавляй prompt. Доверенные documentation/code hosts открываются сразу, внешний неизвестный домен может потребовать подтверждение.',
    },
  },
  {
    name: 'shell',
    summary: 'Выполняет shell-команду в пределах workspace после подтверждения пользователем.',
    args: [
      { name: 'command', description: 'shell-команда', required: true },
      { name: 'cwd', description: 'рабочая директория' },
      { name: 'run_in_background', description: 'запустить длинную команду как background task' },
      { name: 'task_subject', description: 'короткий заголовок для background task' },
      { name: 'task_description', description: 'описание background task' },
    ],
    details: [
      'Многострочные и опасные команды блокируются до выполнения.',
      'Подходит и для inspect/check-сценариев: git status, тесты, build, lint и другие проектные проверки.',
      'Для длинных команд вроде dev server, watch, большой package/build или долгих тестов используй run_in_background=true и потом отслеживай задачу через task_get / task_list / task_stop.',
    ],
    examples: [
      '{ "tool": "shell", "args": { "command": "npm test" } }',
      '{ "tool": "shell", "args": { "command": "npm run package", "run_in_background": true, "task_subject": "Собрать VSIX" } }',
    ],
    aliases: ['run', 'exec', 'execute', 'bash', 'terminal', 'cmd'],
    searchHints: ['запустить тесты или сборку', 'выполнить команду в терминале', 'shell проверка', 'git status', 'git diff', 'git log', 'lint или typecheck', 'прочитать состояние репозитория через shell', 'короткая проверка проекта через терминал', 'ripgrep или терминальный поиск', 'долгая команда в фоне', 'запустить build в фоне', 'background shell job', 'watch процесс или dev server'],
    subagentModes: ['shell', 'generalPurpose', 'verification'],
    requiresShellAccess: true,
    workflowRoles: ['recommendation_redirect_source'],
    capabilities: {
      userFacingName: 'Shell-команда',
      readOnly: false,
      requiresUserInteraction: true,
      interruptBehavior: 'block',
      approval: {
        kind: 'shell',
        title: 'Подтвердите shell-команду',
        description: 'При необходимости команду можно отредактировать перед выполнением.',
        editable: true,
      },
    },
    prompt: {
      whenToUse: ['нужно запустить сборку, тесты, CLI-команду или проверку в терминале'],
      avoidWhen: ['задача сводится к чтению, поиску или правке файлов через специализированные инструменты'],
      guidance: 'Не используй shell для файловых операций, если есть специализированный инструмент. Для inspect/check-сценариев формулируй короткую и точную команду: git status/diff/log, npm test, npm run build, npm run lint, rg и похожие. Если команда длинная и не нужна синхронно, ставь run_in_background=true.',
    },
  },
  {
    name: 'str_replace',
    summary: 'Точная замена текста в существующем файле.',
    args: [
      { name: 'path', description: 'путь к файлу', required: true },
      { name: 'old_string', description: 'текст для замены', required: true },
      { name: 'new_string', description: 'новый текст', required: true },
      { name: 'replace_all', description: 'заменить все вхождения' },
    ],
    details: [
      'Используй для точечных правок вместо полной перезаписи файла.',
      'Перед правкой сначала прочитай файл через read_file или read_file_range хотя бы один раз в этой сессии.',
    ],
    examples: ['{ "tool": "str_replace", "args": { "path": "src/main.ts", "old_string": "old", "new_string": "new" } }'],
    aliases: ['edit', 'replace', 'edit_file', 'patch'],
    searchHints: ['точечно отредактировать код', 'заменить текст в файле', 'не переписывать весь файл', 'минимальная правка существующего файла', 'rename через replace_all'],
    alwaysLoad: true,
    subagentModes: ['generalPurpose'],
    mutatesWorkspace: true,
    capabilities: {
      userFacingName: 'Точная правка файла',
      readOnly: false,
      requiresUserInteraction: true,
      approval: {
        kind: 'file',
        title: 'Подтвердите точечную правку файла',
        description: 'Проверьте заменяемый и новый фрагмент перед применением правки.',
      },
    },
    prompt: {
      whenToUse: ['нужно точечно изменить существующий файл без полной перезаписи'],
      avoidWhen: ['создаёшь новый файл или полностью заменяешь содержимое'],
      guidance: 'Предпочтительный инструмент для обычных правок кода. Сначала читай файл, потом правь минимально уникальный фрагмент.',
    },
  },
  {
    name: 'write_file',
    summary: 'Создаёт новый файл или полностью перезаписывает существующий.',
    args: [
      { name: 'path', description: 'путь к файлу', required: true },
      { name: 'contents', description: 'полное содержимое файла', required: true },
    ],
    details: [
      'Для редактирования существующих файлов обычно предпочитай str_replace.',
      'Если файл уже существует, сначала прочитай его в этой сессии, а уже потом делай полную перезапись.',
    ],
    examples: ['{ "tool": "write_file", "args": { "path": "src/new.ts", "contents": "export const x = 1;" } }'],
    aliases: ['create_file', 'write', 'save_file'],
    searchHints: ['создать новый файл', 'полностью записать файл', 'перезаписать содержимое файла', 'полная перезапись существующего файла'],
    alwaysLoad: true,
    subagentModes: ['generalPurpose'],
    mutatesWorkspace: true,
    capabilities: {
      userFacingName: 'Запись файла',
      readOnly: false,
      requiresUserInteraction: true,
      approval: {
        kind: 'file',
        title: 'Подтвердите запись файла',
        description: 'Проверьте путь и содержимое перед записью в workspace.',
      },
    },
    prompt: {
      whenToUse: ['нужно создать новый файл или полностью перезаписать существующий'],
      avoidWhen: ['достаточно точечной правки существующего файла'],
      guidance: 'Новый файл можно создавать сразу, но существующий файл сначала лучше прочитать и только потом целиком перезаписывать.',
    },
  },
  {
    name: 'delete_file',
    summary: 'Удаляет файл из workspace.',
    args: [{ name: 'path', description: 'путь к файлу', required: true }],
    examples: ['{ "tool": "delete_file", "args": { "path": "src/old.ts" } }'],
    aliases: ['remove', 'rm', 'unlink'],
    searchHints: ['удалить файл', 'remove file from workspace', 'unlink file', 'удалить ненужный файл из проекта'],
    alwaysLoad: true,
    subagentModes: ['generalPurpose'],
    mutatesWorkspace: true,
    capabilities: {
      userFacingName: 'Удаление файла',
      readOnly: false,
      destructive: true,
      requiresUserInteraction: true,
      approval: {
        kind: 'file',
        title: 'Подтвердите удаление файла',
        description: 'Это действие удалит файл из workspace.',
      },
    },
    prompt: {
      whenToUse: ['нужно удалить файл из проекта'],
      avoidWhen: ['можно обойтись точечной правкой или пользователь не просил удаление явно'],
    },
  },
  {
    name: 'edit_notebook',
    summary: 'Редактирует или добавляет ячейку в Jupyter notebook.',
    args: [
      { name: 'target_notebook', description: 'путь к .ipynb', required: true },
      { name: 'cell_idx', description: 'индекс ячейки, 0-based', required: true },
      { name: 'is_new_cell', description: 'создать новую ячейку' },
      { name: 'cell_language', description: 'язык ячейки' },
      { name: 'old_string', description: 'текст для замены в существующей ячейке' },
      { name: 'new_string', description: 'новый текст ячейки', required: true },
    ],
    details: ['Перед изменением notebook сначала прочитай сам .ipynb в этой сессии, чтобы не править его вслепую.'],
    examples: ['{ "tool": "edit_notebook", "args": { "target_notebook": "analysis.ipynb", "cell_idx": 1, "is_new_cell": true, "cell_language": "python", "new_string": "print(1)" } }'],
    aliases: ['notebook_edit', 'edit_cell', 'notebook_cell', 'edit_ipynb'],
    searchHints: ['правка jupyter notebook', 'изменить ipynb', 'редактировать ячейку ноутбука', 'добавить новую ячейку notebook'],
    subagentModes: ['generalPurpose'],
    mutatesWorkspace: true,
    capabilities: {
      userFacingName: 'Правка ноутбука',
      readOnly: false,
      requiresUserInteraction: true,
      approval: {
        kind: 'file',
        title: 'Подтвердите правку ноутбука',
        description: 'Проверьте изменения ячейки перед записью ноутбука.',
      },
    },
    prompt: {
      whenToUse: ['нужно изменить ячейку Jupyter notebook или добавить новую'],
      guidance: 'Сначала прочитай notebook, затем точечно меняй нужную ячейку или добавляй новую.',
    },
  },
  {
    name: 'task_create',
    summary: 'Создаёт задачу в локальном task stack для фоновой или отложенной работы.',
    args: [
      { name: 'subject', description: 'короткий заголовок задачи', required: true },
      { name: 'description', description: 'подробности задачи' },
      { name: 'activeForm', description: 'форма в процессе, например "Собираю VSIX"' },
      { name: 'metadata', description: 'произвольные дополнительные поля' },
    ],
    details: [
      'Полезно, когда нужно зафиксировать отдельную задачу в task stack, даже если она не является shell-командой.',
      'Для фоновых shell jobs чаще удобнее сначала вызвать shell с run_in_background=true, а не создавать task вручную.',
    ],
    examples: [
      '{ "tool": "task_create", "args": { "subject": "Проверить новый onboarding flow", "description": "После рефакторинга вручную пройти ключевой сценарий", "activeForm": "Проверяю onboarding flow" } }',
    ],
    aliases: ['TaskCreateTool', 'create_task', 'new_task'],
    searchHints: ['создать фоновую задачу', 'создать task для долгой работы', 'manual task entry', 'создать запись в task stack'],
    subagentModes: ALL_SUBAGENT_MODES,
    capabilities: {
      userFacingName: 'Создание задачи',
      readOnly: true,
      shouldDefer: true,
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['нужно явно создать запись в task stack для фоновой или отложенной работы'],
      avoidWhen: ['достаточно сразу запустить shell с run_in_background=true'],
      guidance: 'Для длинных shell-команд чаще начинай с shell run_in_background=true, а task_create используй для ручных или несинхронных задач.',
    },
  },
  {
    name: 'task_list',
    summary: 'Показывает задачи из локального task stack с фильтрами по status и kind.',
    args: [
      { name: 'status', description: 'pending | in_progress | completed | failed | cancelled | blocked' },
      { name: 'kind', description: 'generic | shell' },
      { name: 'limit', description: 'сколько задач вернуть' },
      { name: 'offset', description: 'смещение для пагинации' },
    ],
    details: [
      'Подходит, когда нужно быстро увидеть активные, завершённые или упавшие background jobs.',
      'После списка обычно переходят к task_get по конкретной задаче.',
    ],
    examples: [
      '{ "tool": "task_list", "args": { "status": "in_progress", "limit": 10 } }',
      '{ "tool": "task_list", "args": { "kind": "shell", "limit": 20 } }',
    ],
    aliases: ['TaskListTool', 'list_tasks', 'tasks_overview'],
    searchHints: ['показать задачи', 'список background jobs', 'какие задачи выполняются', 'task stack overview', 'активные shell jobs'],
    subagentModes: ALL_SUBAGENT_MODES,
    capabilities: {
      userFacingName: 'Список задач stack',
      readOnly: true,
      concurrencySafe: true,
      shouldDefer: true,
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['нужно увидеть текущие background jobs или задачи task stack'],
      avoidWhen: ['нужна уже конкретная задача по id и можно сразу вызвать task_get'],
      guidance: 'Чаще всего фильтруй по status=in_progress или kind=shell, а затем переходи к task_get.',
    },
  },
  {
    name: 'task_get',
    summary: 'Показывает статус, метаданные и preview stdout/stderr конкретной задачи.',
    args: [
      { name: 'id', description: 'идентификатор задачи', required: true },
    ],
    details: [
      'Для shell background jobs показывает текущий статус и компактный preview stdout/stderr.',
      'Если нужен полный вывод, потом можно открыть stdout/stderr файлы через read_file.',
    ],
    examples: [
      '{ "tool": "task_get", "args": { "id": "task-1712345678901-ab12cd" } }',
    ],
    aliases: ['TaskGetTool', 'get_task', 'task_status'],
    searchHints: ['статус background job', 'посмотреть конкретную задачу', 'task status by id', 'stdout stderr задачи'],
    subagentModes: ALL_SUBAGENT_MODES,
    capabilities: {
      userFacingName: 'Статус задачи',
      readOnly: true,
      concurrencySafe: true,
      shouldDefer: true,
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['id задачи уже известен и нужно узнать её статус или посмотреть вывод'],
      avoidWhen: ['сначала нужно найти подходящую задачу среди нескольких — тогда начни с task_list'],
      guidance: 'После длинной shell-команды в фоне обычно следующий ход — task_get по id задачи.',
    },
  },
  {
    name: 'task_update',
    summary: 'Обновляет subject, description, status или metadata существующей задачи.',
    args: [
      { name: 'id', description: 'идентификатор задачи', required: true },
      { name: 'subject', description: 'новый заголовок задачи' },
      { name: 'description', description: 'новое описание задачи' },
      { name: 'activeForm', description: 'новая форма в процессе' },
      { name: 'status', description: 'pending | in_progress | completed | failed | cancelled | blocked' },
      { name: 'metadata', description: 'дополнительные поля для merge' },
    ],
    details: [
      'Используй, если нужно явно поправить запись в task stack, а не просто прочитать её.',
    ],
    examples: [
      '{ "tool": "task_update", "args": { "id": "task-1712345678901-ab12cd", "status": "completed", "description": "Проверка завершена" } }',
    ],
    aliases: ['TaskUpdateTool', 'update_task'],
    searchHints: ['обновить задачу', 'поменять статус background job', 'изменить task stack entry'],
    subagentModes: ALL_SUBAGENT_MODES,
    capabilities: {
      userFacingName: 'Обновление задачи',
      readOnly: true,
      shouldDefer: true,
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['нужно явно обновить status, description или metadata задачи'],
      guidance: 'Если нужен только просмотр, используй task_get. task_update нужен именно для изменения записи.',
    },
  },
  {
    name: 'task_stop',
    summary: 'Останавливает background task, обычно shell job, через SIGTERM или SIGKILL.',
    args: [
      { name: 'id', description: 'идентификатор задачи', required: true },
      { name: 'force', description: 'использовать принудительную остановку' },
    ],
    details: [
      'Обычный путь — мягкая остановка. force=true используй только если задача не реагирует на обычный stop.',
    ],
    examples: [
      '{ "tool": "task_stop", "args": { "id": "task-1712345678901-ab12cd" } }',
      '{ "tool": "task_stop", "args": { "id": "task-1712345678901-ab12cd", "force": true } }',
    ],
    aliases: ['TaskStopTool', 'stop_task', 'cancel_task', 'kill_task'],
    searchHints: ['остановить background job', 'stop long running task', 'cancel shell task', 'остановить dev server или watch'],
    subagentModes: ALL_SUBAGENT_MODES,
    capabilities: {
      userFacingName: 'Остановка задачи',
      readOnly: true,
      shouldDefer: true,
    },
    prompt: {
      group: 'specialized',
      style: 'presence',
      whenToUse: ['нужно остановить фоновую shell-задачу или другой background task'],
      guidance: 'Сначала попробуй мягкую остановку, а force=true используй только когда обычный stop не помог.',
    },
  },
  {
    name: 'subagent',
    summary: 'Запускает подагента для параллельного или автономного анализа.',
    args: [
      { name: 'prompt', description: 'задача для подагента' },
      { name: 'tasks', description: 'батч подзадач: строки или объекты с description/prompt/task/query/goal/instruction и optional label/name' },
      { name: 'parallel', description: 'выполнять tasks параллельно' },
      { name: 'subagent_type', description: 'explore | shell | generalPurpose | verification' },
      { name: 'readonly', description: 'ограничить мутации workspace' },
    ],
    examples: ['{ "tool": "subagent", "args": { "parallel": true, "tasks": [{ "name": "frontend", "description": "Изучи frontend" }, { "name": "backend", "description": "Изучи backend" }], "subagent_type": "explore", "readonly": true } }'],
    aliases: ['delegate', 'delegate_agent', 'mini_agent'],
    searchHints: ['параллельный анализ', 'делегировать подзадачи', 'разделить задачу на подагентов'],
    alwaysLoad: true,
    subagentModes: NO_SUBAGENT_MODES,
    virtual: true,
    prompt: {
      whenToUse: ['задача распадается на независимые ветки или широкий обзор лучше делать параллельно'],
      avoidWhen: ['достаточно одного локального шага чтения или правки'],
      guidance: 'Используй batches для независимых подзадач, а не для дублирования своей же работы.',
    },
  },
  {
    name: 'verification_agent',
    summary: 'Запускает подагента-верификатора: он пытается сломать реализацию, запускает проверки и заканчивает VERDICT: PASS/FAIL/PARTIAL.',
    args: [
      { name: 'task', description: 'исходная задача пользователя' },
      { name: 'changed_files', description: 'изменённые файлы или области' },
      { name: 'approach', description: 'краткое описание того, что уже было сделано' },
      { name: 'focus', description: 'особые риски или сценарии для проверки' },
    ],
    examples: ['{ "tool": "verification_agent", "args": { "task": "исправить обработку checkpoint", "changed_files": ["src/ui/checkpoints.ts", "src/ui/provider.ts"], "approach": "переработал timeline и откат", "focus": "revert/undo revert и восстановление истории" } }'],
    aliases: ['verify_changes', 'verify_agent', 'verifier', 'qa_agent'],
    searchHints: ['независимая проверка изменений', 'проверить регрессии', 'верификация нетривиальной правки'],
    alwaysLoad: true,
    subagentModes: NO_SUBAGENT_MODES,
    requiresShellAccess: true,
    virtual: true,
    capabilities: {
      userFacingName: 'Верификация изменений',
      readOnly: true,
      shouldDefer: true,
    },
    prompt: {
      group: 'primary',
      whenToUse: ['после нетривиальных изменений перед финальным ответом'],
      avoidWhen: ['правка была совсем точечной и риск регрессии минимален'],
      guidance: 'Это отдельная фаза проверки, а не первый инструмент хода.',
    },
  },
  {
    name: 'todo_write',
    summary: 'Обновляет список задач текущей сессии: pending / in_progress / completed.',
    args: [
      { name: 'todos', description: 'массив задач: { content, activeForm, status }', required: true },
    ],
    examples: ['{ "tool": "todo_write", "args": { "todos": [{ "content": "Обновить provider", "activeForm": "Обновляю provider", "status": "in_progress" }, { "content": "Проверить сборку", "activeForm": "Проверяю сборку", "status": "pending" }] } }'],
    aliases: ['todo', 'tasks', 'update_todos'],
    searchHints: ['вести список задач', 'todo list для работы агента', 'разбить работу на шаги'],
    alwaysLoad: true,
    subagentModes: NO_SUBAGENT_MODES,
    virtual: true,
    capabilities: {
      userFacingName: 'Список задач',
      readOnly: true,
      shouldDefer: true,
    },
    prompt: {
      whenToUse: ['в задаче три и более осмысленных шага или нужна явная рабочая разбивка'],
      guidance: 'Поддерживай максимум одну задачу со статусом in_progress.',
    },
  },
  {
    name: 'enter_plan_mode',
    summary: 'Переводит разговор в режим плана: только read-only исследование и проектирование подхода без правок файлов.',
    examples: ['{ "tool": "enter_plan_mode" }'],
    aliases: ['plan_mode', 'start_plan_mode', 'planning_mode'],
    searchHints: ['сначала составить план', 'read-only planning before edits', 'спроектировать подход без правок'],
    alwaysLoad: true,
    subagentModes: NO_SUBAGENT_MODES,
    virtual: true,
    capabilities: {
      userFacingName: 'Вход в режим плана',
      readOnly: true,
      shouldDefer: true,
    },
    prompt: {
      whenToUse: ['нужно сначала продумать подход, собрать план или исследовать задачу без правок'],
      avoidWhen: ['пользователь прямо просит сразу изменить код и путь уже ясен'],
    },
  },
  {
    name: 'exit_plan_mode',
    summary: 'Выходит из режима плана и просит оформить итоговый план для пользователя.',
    examples: ['{ "tool": "exit_plan_mode" }'],
    aliases: ['finish_plan_mode', 'leave_plan_mode'],
    searchHints: ['завершить режим плана', 'утвердить итоговый план', 'exit planning mode'],
    alwaysLoad: true,
    subagentModes: NO_SUBAGENT_MODES,
    virtual: true,
    capabilities: {
      userFacingName: 'Согласование плана',
      readOnly: true,
      shouldDefer: true,
      requiresUserInteraction: true,
      approval: {
        kind: 'plan',
        title: 'Утвердите итоговый план',
        description: 'Можно поправить текст плана перед публикацией ответа.',
        feedbackPlaceholder: 'Комментарий для доработки плана (необязательно)',
      },
    },
    prompt: {
      whenToUse: ['план уже готов и его нужно показать пользователю на согласование'],
      avoidWhen: ['в режиме плана ещё есть существенные пробелы в анализе'],
    },
  },
  {
    name: 'final_answer',
    summary: 'Завершает цикл анализа; итоговый ответ будет запрошен отдельным сообщением.',
    examples: ['{ "tool": "final_answer" }'],
    searchHints: ['закончить выполнение', 'перейти к итоговому ответу', 'finish run'],
    alwaysLoad: true,
    subagentModes: NO_SUBAGENT_MODES,
    virtual: true,
    prompt: {
      whenToUse: ['контекста, правок и проверок уже достаточно для уверенного ответа'],
      avoidWhen: ['ещё не сделана обязательная правка, не собран план или не завершена нужная проверка'],
    },
  },
];
