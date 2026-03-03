import { ChatMessage } from '../core/types';
import { TOOLS_DESCRIPTION } from './tools';

export function buildSystemPrompt(chatHistory: ChatMessage[]): string {
  const historyNote = chatHistory.length > 2
    ? '\nВ истории есть предыдущие вопросы. Если контекст достаточен — можешь сразу вызвать final_answer.\n'
    : '';

  return (
    'Ты — AI-агент разработчика в VS Code. У тебя прямой доступ к файловой системе проекта через утилиты. Проект открыт в workspace. Отвечай по-русски.\n\n' +
    'ГЛАВНЫЙ ПРИНЦИП: цель и критерий результата задаёт пользователь. Не переопределяй и не расширяй задачу без явного запроса.\n' +
    'Если формулировка пользователя широкая — декомпозируй её на шаги, но держи тот же scope и намерение.\n\n' +
    'ВАЖНО: Используй утилиты для получения информации. Никогда не говори "пришлите файлы" — вызови нужную утилиту.\n\n' +
    TOOLS_DESCRIPTION + '\n\n' +
    '## Формат\n\n' +
    'Каждый ход — ровно один JSON-блок:\n' +
    '```json\n{ "tool": "имя", "args": { ... }, "reasoning": "Зачем" }\n```\n' +
    'Для завершения:\n```json\n{ "tool": "final_answer" }\n```\n' +
    'После final_answer НЕ пиши текст — ответ будет запрошен отдельно.\n' +
    'НИКОГДА не пиши обычный текст без JSON-блока.\n\n' +
    'Для shell-команд в JSON избегай неэкранированных двойных кавычек внутри command.\n' +
    'Используй одинарные кавычки в самой bash-команде, например: find . -name \'*.json\'.\n\n' +
    '## Стратегия\n\n' +
    'Выбирай только те утилиты и глубину анализа, которые нужны для цели пользователя.\n' +
    'Не делай обязательных "ритуальных" шагов, если они не добавляют фактов для текущей задачи.\n' +
    'Работай как оркестратор: если задача распадается на независимые ветки, делегируй их в subagent вместо длинной линейной серии действий основным агентом.\n' +
    'Не трать шаги на служебные/внутренние артефакты (например .ai-assistant/traces, временные логи), если пользователь явно не просил это анализировать.\n' +
    'Завершай анализ, когда собранных фактов достаточно для уверенного ответа по запросу пользователя.\n\n' +
    'subagent — НЕ обязательный инструмент. Вызывай его только если это реально ускорит задачу.\n' +
    'Если вызываешь subagent для изучения кода, по умолчанию ставь subagent_type=explore и readonly=true.\n' +
    'generalPurpose используй только когда действительно нужны мутации/широкие инструменты.\n' +
    'САМ определи: план, subagent_type, readonly и формат результата, не меняя исходную цель пользователя.\n\n' +
    'subagent можно использовать не только для подпроектов: применяй его для любых больших или параллелизуемых подзадач,\n' +
    'если это ускоряет выполнение и сохраняет фокус на исходной цели пользователя.\n\n' +
    'Допустимо несколько волн subagent: первая — для широкого покрытия, вторая — для закрытия обнаруженных пробелов.\n\n' +
    'При широких запросах (например "изучи проект подробно") сначала наметь 3-8 подзадач и по возможности запускай их через subagent tasks[] с parallel:true,\n' +
    'затем синтезируй единый вывод. Основной агент должен собирать и объединять результаты, а не вручную читать все файлы по очереди.\n\n' +
    'Если в ответе есть архитектура, взаимодействия сервисов, потоки данных или последовательности шагов — добавляй Mermaid-диаграммы.\n' +
    'Используй fenced-блоки вида ```mermaid ... ```, делай схемы компактными и читаемыми.\n\n' +
    '## Стратегия изменения кода\n\n' +
    'Для изменений используй str_replace (точечная замена) вместо перезаписи всего файла.\n' +
    '1. Прочитай файл: read_file → найди нужный фрагмент\n' +
    '2. Замени: str_replace с уникальным old_string\n' +
    '3. Проверь: get_diagnostics на изменённый файл\n' +
    'Для новых файлов: write_file.\n\n' +
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

function tryParseJson(raw: string): AgentAction | null {
  try {
    return JSON.parse(raw) as AgentAction;
  } catch {
    let fixed = raw.replace(/,\s*\}/g, '}');
    const open = (fixed.match(/\{/g) || []).length;
    const close = (fixed.match(/\}/g) || []).length;
    if (close > open) {
      for (let i = 0; i < close - open; i++) {
        const idx = fixed.lastIndexOf('}');
        if (idx > 0) fixed = fixed.slice(0, idx) + fixed.slice(idx + 1);
      }
    } else if (open > close) {
      fixed += '}'.repeat(open - close);
    }
    try { return JSON.parse(fixed) as AgentAction; } catch { return null; }
  }
}

function extractJsonWithTool(text: string): string | null {
  const idx = text.indexOf('"tool"');
  if (idx < 0) return null;
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    if (text[i] === '{') {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let depth = 0;
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
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseAgentAction(text: string): { action: AgentAction | null; afterText: string } {
  const blockRe = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/;
  const match = blockRe.exec(text);
  if (match) {
    const action = tryParseJson(match[1]);
    if (action?.tool) return { action, afterText: text.slice(match.index! + match[0].length).trim() };
  }
  const loose = extractJsonWithTool(text);
  if (loose) {
    const action = tryParseJson(loose);
    if (action?.tool) {
      const pos = text.indexOf(loose);
      return { action, afterText: pos >= 0 ? text.slice(pos + loose.length).trim() : '' };
    }
  }
  return { action: null, afterText: text };
}
