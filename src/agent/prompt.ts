import { ChatMessage } from '../core/types';
import { TOOLS_DESCRIPTION } from './tools';
import { buildAgentStrategyNotes, buildSubagentExecutionNotes } from './tooling/definitions/toolStrategyNotes';

export function buildSystemPrompt(chatHistory: ChatMessage[], customSystemPrompt = ''): string {
  const historyNote = chatHistory.length > 2
    ? '\nВ истории есть предыдущие вопросы. Если контекст достаточен — можешь сразу вызвать final_answer.\n'
    : '';
  const extraInstructions = String(customSystemPrompt || '').trim();
  const extraBlock = extraInstructions
    ? '\n\n## Дополнительные инструкции пользователя\n' +
      extraInstructions +
      '\n\nЭтим инструкциям нужно следовать, если они не противоречат безопасности, доступным инструментам и текущему запросу пользователя.\n'
    : '';

  return (
    'Ты — AI-агент разработчика в VS Code. У тебя прямой доступ к файловой системе проекта через утилиты. Проект открыт в workspace. Отвечай по-русски.\n\n' +
    'ГЛАВНЫЙ ПРИНЦИП: цель и критерий результата задаёт пользователь. Не переопределяй и не расширяй задачу без явного запроса.\n' +
    'Если формулировка пользователя широкая — декомпозируй её на шаги, но держи тот же scope и намерение.\n\n' +
    'ВАЖНО: Используй утилиты для получения информации. Никогда не говори "пришлите файлы" — вызови нужную утилиту.\n\n' +
    TOOLS_DESCRIPTION + '\n\n' +
    '## Формат\n\n' +
    'Каждый ход — ровно один JSON-блок. Это может быть одиночный объект или JSON-массив действий.\n' +
    'Одиночный вызов:\n' +
    '```json\n{ "tool": "имя", "args": { ... }, "reasoning": "Зачем" }\n```\n' +
    'Небольшая последовательность шагов одним ходом:\n' +
    '```json\n[\n  { "tool": "read_file", "args": { "path": "src/a.ts" }, "reasoning": "Сначала читаю файл" },\n  { "tool": "grep", "args": { "pattern": "Router", "path": "src" }, "reasoning": "Параллельно ищу связанные места" }\n]\n```\n' +
    'Массив допустим только для реальных tool-вызовов. Не клади внутрь final_answer, enter_plan_mode или exit_plan_mode.\n' +
    'Если подряд идут независимые безопасные read-only шаги, рантайм сам выполнит их более эффективно.\n' +
    'Для завершения:\n```json\n{ "tool": "final_answer" }\n```\n' +
    'После final_answer НЕ пиши текст — ответ будет запрошен отдельно.\n' +
    'НИКОГДА не пиши обычный текст без JSON-блока.\n\n' +
    'Для списка задач используй:\n```json\n{ "tool": "todo_write", "args": { "todos": [{ "content": "...", "activeForm": "...", "status": "pending|in_progress|completed" }] } }\n```\n\n' +
    'Для небольшого пакета независимых read-only шагов используй:\n```json\n{ "tool": "tool_batch", "args": { "tools": [{ "tool": "read_file", "args": { "path": "src/a.ts" } }, { "tool": "grep", "args": { "pattern": "Router", "path": "src" } }] } }\n```\n' +
    'Внутри tool_batch допустимы только безопасные независимые утилиты без мутаций, shell и подтверждений.\n\n' +
    'Если без решения пользователя нельзя безопасно продолжать, используй ask_user с 1-4 короткими вопросами и вариантами ответа.\n\n' +
    'Если пользователь явно назвал навык, slash-команду или reusable workflow, сначала используй skill и только потом продолжай обычными утилитами.\n\n' +
    'Если shell-команда может идти долго и не требует синхронного ожидания, используй shell с run_in_background=true, а потом отслеживай её через task_get / task_list / task_stop.\n\n' +
    'Для shell-команд в JSON избегай неэкранированных двойных кавычек внутри command.\n' +
    'Используй одинарные кавычки в самой bash-команде, например: find . -name \'*.json\'.\n\n' +
    'Для mcp_tool всегда сначала смотри inputSchema из list_mcp_tools. Если у remote tool schema содержит только поле command:string, передавай всю команду целиком в arguments.command и не разделяй её на command + args, prompt или другие поля. Если MCP-вызов вернул schema/deserialize/invalid-argument ошибку, не гадай повторно наугад: опирайся на schema hint из результата и исправляй arguments по нему.\n' +
    'Для обычной проверки MCP сервера или запроса "кто я / какие projects / какие tasks" не вызывай list_mcp_resources без явного запроса про resources, URI или content. В таких случаях начинай с list_mcp_tools и затем вызывай нужный mcp_tool.\n' +
    'Если запрос связан с MCP, HubThe или другой внешней системой, не отвечай только по памяти прошлых запросов. Память используй как подсказку маршрута, но перед final_answer сначала получи свежий MCP-результат в текущем запуске.\n' +
    'Если пользователь оспаривает прошлый ответ по MCP/внешней системе, считай старый факт потенциально устаревшим и перепроверь его заново через MCP.\n' +
    'Если mcp_tool уже вернул конкретный факт, например name/email/guid/status, в final_answer назови его прямо, а не уходи в общий технический отчёт.\n\n' +
    buildAgentStrategyNotes() + '\n\n' +
    buildSubagentExecutionNotes().join('\n') + '\n\n' +
    'Если в ответе есть архитектура, взаимодействия сервисов, потоки данных или последовательности шагов — добавляй Mermaid-диаграммы.\n' +
    'Используй fenced-блоки вида ```mermaid ... ```, делай схемы компактными и читаемыми.\n\n' +
    '## Стратегия изменения кода\n\n' +
    'Не переходи к final_answer, пока не попробуешь внести правку или пока не упрёшься в явный блокер, который нужно сообщить пользователю.\n' +
    '1. Прочитай файл: read_file → найди нужный фрагмент\n' +
    '2. Замени: str_replace с уникальным old_string\n' +
    '3. Проверь: get_diagnostics на изменённый файл\n' +
    'Для новых файлов: write_file.\n' +
    'Для полной перезаписи существующего файла: сначала read_file, потом write_file.\n' +
    'Для тестов, build, lint и git-проверок используй shell короткими и точными командами.\n' +
    'Для длинных watch/package/dev/build сценариев можно запускать shell в фоне и потом читать task stack.\n\n' +
    '## Правила\n\n' +
    '- ВСЕГДА отвечай строго на ПОСЛЕДНЕЕ сообщение пользователя. Предыдущие сообщения — только контекст.\n' +
    '- Если последнее сообщение — самостоятельный вопрос/задача, не связанный с предыдущими, отвечай ТОЛЬКО на него.\n' +
    '- Не смешивай в ответе информацию из предыдущих запросов, если она не относится к текущему.\n' +
    '- Не подменяй цель пользователя своей "более правильной" целью.\n' +
    '- Избегай лишних действий, которые не влияют на ответ.\n' +
    '- Если появляются независимые подзадачи, предпочитай subagent tasks[] + parallel:true.\n' +
    '- Не вызывай утилиту дважды с одинаковыми аргументами.\n' +
    '- Опирайся ТОЛЬКО на данные из утилит.\n' +
    '- Будь лаконичным и структурированным.' +
    extraBlock +
    historyNote
  );
}

export function buildFewShotMessages(): ChatMessage[] {
  return [
    { role: 'user', content: '[Пример формата]\nПользователь: расскажи о проекте' },
    { role: 'assistant', content: '```json\n{ "tool": "read_file", "args": { "path": "README.md" }, "reasoning": "Начну с документации" }\n```' },
    { role: 'user', content: '[Результат read_file]:\nREADME.md (5 строк):\n\n1| # My App\n2| Simple demo.\n3|\n4| ## Install\n5| npm install\n\n[Система] Пример завершён. Далее — реальный диалог. Используй тот же формат.' }
  ];
}

// ── Response parsing ──

export interface AgentAction {
  tool: string;
  args?: any;
  reasoning?: string;
}

function isAgentAction(value: any): value is AgentAction {
  return !!value && typeof value === 'object' && typeof value.tool === 'string';
}

function normalizeAgentActions(value: any): AgentAction[] {
  if (Array.isArray(value)) {
    return value.filter(isAgentAction);
  }
  if (isAgentAction(value)) {
    return [value];
  }
  if (value && typeof value === 'object' && Array.isArray(value.actions)) {
    return value.actions.filter(isAgentAction);
  }
  return [];
}

export function stripJsonBlocks(text: string): string {
  let cleaned = text.replace(/```json[\s\S]*?```/g, '').trim();
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.text) return parsed.text;
      if (parsed.args?.text) return parsed.args.text;
    } catch { /* not JSON */ }
  }
  return cleaned || text;
}

function balanceJsonDelimiters(raw: string): string {
  let fixed = raw.replace(/,\s*([}\]])/g, '$1');
  let braceDelta = 0;
  let bracketDelta = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < fixed.length; index++) {
    const ch = fixed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') braceDelta++;
    else if (ch === '}') braceDelta--;
    else if (ch === '[') bracketDelta++;
    else if (ch === ']') bracketDelta--;
  }

  while (braceDelta < 0) {
    const idx = fixed.lastIndexOf('}');
    if (idx < 0) break;
    fixed = fixed.slice(0, idx) + fixed.slice(idx + 1);
    braceDelta++;
  }

  while (bracketDelta < 0) {
    const idx = fixed.lastIndexOf(']');
    if (idx < 0) break;
    fixed = fixed.slice(0, idx) + fixed.slice(idx + 1);
    bracketDelta++;
  }

  if (braceDelta > 0) fixed += '}'.repeat(braceDelta);
  if (bracketDelta > 0) fixed += ']'.repeat(bracketDelta);
  return fixed;
}

function tryParseJsonActions(raw: string): AgentAction[] | null {
  try {
    const actions = normalizeAgentActions(JSON.parse(raw));
    return actions.length ? actions : null;
  } catch {
    try {
      const actions = normalizeAgentActions(JSON.parse(balanceJsonDelimiters(raw)));
      return actions.length ? actions : null;
    } catch {
      return null;
    }
  }
}

function extractJsonWithActions(text: string): string | null {
  const toolIdx = text.indexOf('"tool"');
  const actionsIdx = text.indexOf('"actions"');
  const markers = [toolIdx, actionsIdx].filter(idx => idx >= 0);
  if (!markers.length) return null;
  const idx = Math.min(...markers);
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    if (text[i] === '{' || text[i] === '[') {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }
    if (ch === '}' || ch === ']') {
      const last = stack[stack.length - 1];
      if (
        (ch === '}' && last === '{') ||
        (ch === ']' && last === '[')
      ) {
        stack.pop();
      }
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseAgentAction(text: string): { action: AgentAction | null; actions: AgentAction[]; afterText: string } {
  const blockRe = /```(?:json)?\s*([\s\S]*?)\s*```/;
  const match = blockRe.exec(text);
  if (match) {
    const actions = tryParseJsonActions(match[1]);
    if (actions?.length) {
      return {
        action: actions[0] || null,
        actions,
        afterText: text.slice(match.index! + match[0].length).trim(),
      };
    }
  }
  const loose = extractJsonWithActions(text);
  if (loose) {
    const actions = tryParseJsonActions(loose);
    if (actions?.length) {
      const pos = text.indexOf(loose);
      return {
        action: actions[0] || null,
        actions,
        afterText: pos >= 0 ? text.slice(pos + loose.length).trim() : '',
      };
    }
  }
  return { action: null, actions: [], afterText: text };
}
