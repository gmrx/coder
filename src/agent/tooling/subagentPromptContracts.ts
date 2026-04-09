import { getToolDefinition } from './catalog';
import {
  buildRetrievalStrategyNote,
  buildToolSearchStrategyNote,
} from './definitions/toolStrategyNotes';
import { buildVerificationSubagentPrompt } from './verificationPromptContracts';

function getToolExample(toolName: string, fallback: string): string {
  return getToolDefinition(toolName)?.examples?.[0] || fallback;
}

function buildSubagentToolExamples(useMcpExamples: boolean): string[] {
  const examples = [
    getToolExample(
      'tool_search',
      '{"tool":"tool_search","args":{"query":"какой инструмент лучше подойдёт для поиска релевантных файлов по смыслу"},"reasoning":"Если не уверен в специализированном tool, сначала уточню каталог"}',
    ),
    getToolExample(
      'read_file',
      '{"tool":"read_file","args":{"path":"README.md"},"reasoning":"Изучу конкретный файл"}',
    ),
    getToolExample(
      'find_relevant_files',
      '{"tool":"find_relevant_files","args":{"query":"где настраивается webview и обработка сообщений"},"reasoning":"Сначала быстро найду самые релевантные файлы"}',
    ),
    getToolExample(
      'semantic_search',
      '{"tool":"semantic_search","args":{"query":"обработка ошибок авторизации"},"reasoning":"Нужны релевантные фрагменты кода по смыслу"}',
    ),
    getToolExample(
      'glob',
      '{"tool":"glob","args":{"glob_pattern":"**/*.ts"},"reasoning":"Найду файлы по известной маске"}',
    ),
    getToolExample(
      'grep',
      '{"tool":"grep","args":{"pattern":"FastAPI","path":"app/main.py"},"reasoning":"Проверю конкретный текстовый сигнал"}',
    ),
    getToolExample(
      'workspace_symbols',
      '{"tool":"workspace_symbols","args":{"query":"App"},"reasoning":"Найду символ по имени"}',
    ),
  ];

  if (!useMcpExamples) {
    return examples;
  }

  return [
    getToolExample(
      'list_mcp_tools',
      '{"tool":"list_mcp_tools","args":{"server":"hubthe"},"reasoning":"Сначала посмотрю доступные MCP tools и их schema"}',
    ),
    getToolExample(
      'mcp_tool',
      '{"tool":"mcp_tool","args":{"server":"hubthe","name":"hubthe_whoami","arguments":{}},"reasoning":"Получаю свежий факт напрямую из MCP, а не из файлов workspace"}',
    ),
    ...examples,
  ];
}

export function buildSubagentNoActionPrompt(): string {
  return 'Ответ не в JSON-формате. Верни ОДИН JSON-блок вызова инструмента либо final_answer.';
}

export function buildSubagentFinalMarkdownPrompt(): string {
  return 'Сформируй финальный ответ в markdown (без JSON), кратко и по фактам.';
}

export function buildSubagentDisallowedToolPrompt(toolName: string, allowedList: string): string {
  return `Инструмент "${toolName}" запрещён для этого subagent. Используй allowlist: ${allowedList}`;
}

export function buildSubagentInvalidArgsPrompt(argsError: string): string {
  return (
    `${argsError}. Верни СРАЗУ новый JSON-вызов с корректными args.\n` +
    'Не повторяй пустые args и не вызывай инструменты без обязательных полей.'
  );
}

export function buildSubagentDuplicatePrompt(toolName: string): string {
  return `Вызов ${toolName} с такими аргументами уже был. Используй другой шаг.`;
}

export function buildSubagentSystemPrompt(options: {
  subagentType: string;
  readonly: boolean;
  allowedList: string;
  mcpFocused?: boolean;
}): string {
  const useMcpExamples = !!options.mcpFocused || /\blist_mcp_tools\b|\bmcp_tool\b/.test(options.allowedList);
  const base =
    (useMcpExamples
      ? 'Ты — подагент (subagent) для исследования через доступные инструменты. Если задача про код — анализируй код. Если задача про MCP, HubThe или другую внешнюю систему — основной источник истины это MCP-инструменты, а не файлы workspace.\n'
      : 'Ты — подагент (subagent) для анализа кода.\n') +
    'Работай только через инструменты, каждый ход — ОДИН JSON-блок:\n' +
    '```json\n{ "tool": "имя", "args": { ... }, "reasoning": "кратко" }\n```\n' +
    'ВАЖНО: args не должны быть пустыми для инструментов, где нужны параметры.\n' +
    'Примеры корректных вызовов:\n' +
    buildSubagentToolExamples(useMcpExamples).join('\n') + '\n' +
    'Для завершения: {"tool":"final_answer","args":{"text":"...итог..."}}.\n' +
    'Никогда не используй инструменты вне allowlist.\n' +
    buildToolSearchStrategyNote() + '\n' +
    buildRetrievalStrategyNote() + '\n' +
    'Опирайся на результаты инструментов, упоминай конкретные файлы/сервисы.\n' +
    (useMcpExamples
      ? 'Если в задаче явно упомянуты MCP/HubThe/remote tools, не подменяй её анализом файлов проекта. Память и файлы можно использовать только как подсказку маршрута, но финальный вывод делай по свежим MCP-результатам текущего запуска.\n'
      : '');

  if (options.subagentType === 'verification') {
    return base + buildVerificationSubagentPrompt({
      allowedList: options.allowedList,
      readonly: options.readonly,
    });
  }

  return (
    base +
    'Итог делай максимально информативным: структура, ключевые факты, риски, рекомендации, что проверить дальше.\n' +
    `Тип подагента: ${options.subagentType}. Readonly: ${options.readonly ? 'true' : 'false'}.\n` +
    `Разрешенные утилиты: ${options.allowedList}`
  );
}
