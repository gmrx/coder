import { ChatMessage } from '../core/types';
import { readConfig, sendChatRequest } from '../core/api';
import { trimContext, truncate, isConfigValid } from '../core/utils';
import { buildSystemPrompt, buildFewShotMessages, parseAgentAction, stripJsonBlocks } from './prompt';
import { executeTool } from './executor';
import { checkToolDiversity, checkMonotony, MIN_TOOL_TYPES_BEFORE_ANSWER } from './checks';

export type AgentStepCallback = (phase: string, message: string, meta?: any) => void | Promise<any>;

const MAX_CONSECUTIVE_DUPES = 3;
const MAX_DIVERSITY_NUDGES = 10;
const TOOL_CALL_TEMPERATURE = 0.15;
const FINAL_ANSWER_TEMPERATURE = 0.5;

type AgentMemory = {
  topDirs: Set<string>;
  readFiles: Set<string>;
  toolCalls: number;
  subagentBatches: number;
  subagentTasks: number;
  subagentErrorBatches: number;
  keyFacts: string[];
};

function getReadTopDirs(usedCalls: Set<string>): string[] {
  const dirs = new Set<string>();
  for (const key of usedCalls) {
    if (!key.startsWith('read_file:') && !key.startsWith('read_file_range:')) continue;
    try {
      const raw = key.slice(key.indexOf(':') + 1);
      const a = JSON.parse(raw);
      const p: string | undefined = a.path;
      if (!p || typeof p !== 'string') continue;
      const parts = p.split(/[\\/]/).filter(Boolean);
      if (parts.length >= 2) dirs.add(parts[0]);
    } catch { /* skip */ }
  }
  return [...dirs];
}

function isBroadStudyQuery(q: string): boolean {
  const s = (q || '').toLowerCase();
  return /изучи|обзор|обследуй|проанализируй|рассмотри|comprehensive|deep|analy[sz]e|review|explore|audit|архитектур|рефакторинг|refactor|оптимиз|optimi[sz]|риски|уязвимост|vulnerabilit|реализуй|implement|создай|добавь|сделай.*полн/.test(s);
}

function requiresMermaidDiagram(q: string): boolean {
  const s = (q || '').toLowerCase();
  return /схем|diagram|mermaid|нарис|service map|architecture diagram|flow/.test(s);
}

function cleanupFinalAnswer(text: string, needMermaid: boolean): string {
  let out = stripJsonBlocks(text || '').trim();

  // Remove leaked JSON-like tails from model responses.
  out = out
    .replace(/\n[“"]?(format|reasoning|tool|args)[”"]?\s*:\s*[\s\S]*$/i, '')
    .replace(/\n\}\s*$/g, '')
    .trim();

  if (needMermaid) {
    // Fix common malformed Mermaid start: "mermaid" without opening fence.
    if (!/```mermaid/i.test(out) && /\nmermaid\s*\n/i.test(out)) {
      out = out.replace(/\nmermaid\s*\n/i, '\n```mermaid\n');
      const after = out.split(/```mermaid/i)[1] || '';
      if (!/```/.test(after)) out += '\n```';
    }
    // If diagram keywords exist without fences, wrap from first diagram keyword.
    if (!/```mermaid/i.test(out) && /(sequenceDiagram|flowchart|graph\s+[A-Z]|classDiagram|erDiagram|stateDiagram|journey|gantt|pie|mindmap|timeline)/i.test(out)) {
      const lines = out.split('\n');
      const idx = lines.findIndex((l) => /(sequenceDiagram|flowchart|graph\s+[A-Z]|classDiagram|erDiagram|stateDiagram|journey|gantt|pie|mindmap|timeline)/i.test(l));
      if (idx >= 0) {
        const head = lines.slice(0, idx).join('\n').trimEnd();
        const body = lines.slice(idx).join('\n').trim();
        out = `${head}\n\n\`\`\`mermaid\n${body}\n\`\`\``.trim();
      }
    }
  }

  return out;
}

function collectPathsFromArgs(args: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    if (typeof v !== 'string') return;
    const s = v.trim();
    if (!s) return;
    out.push(s);
  };
  push(args?.path);
  push(args?.file);
  if (Array.isArray(args?.paths)) for (const p of args.paths) push(p);
  if (Array.isArray(args?.files)) for (const p of args.files) push(p);
  return out;
}

function addFact(memory: AgentMemory, fact: string): void {
  const s = fact.trim();
  if (!s) return;
  if (memory.keyFacts.some((f) => f === s)) return;
  memory.keyFacts.push(s);
  if (memory.keyFacts.length > 24) memory.keyFacts = memory.keyFacts.slice(-24);
}

function updateMemory(memory: AgentMemory, tool: string, args: any, result: string): void {
  memory.toolCalls++;
  for (const p of collectPathsFromArgs(args)) {
    memory.readFiles.add(p);
    const parts = p.split(/[\\/]/).filter(Boolean);
    if (parts.length >= 2) memory.topDirs.add(parts[0]);
  }

  if (tool === 'subagent') {
    memory.subagentBatches++;
    const m = result.match(/Subagent batch:\s*(\d+)\s+задач/i);
    if (m) memory.subagentTasks += Number(m[1]) || 0;
    if (/\bошиб|invalid-json|timeout|aborted|fallback/i.test(result)) {
      memory.subagentErrorBatches++;
    }
  }

  if (tool === 'detect_stack') addFact(memory, `Стек/инфра: ${truncate(result, 220)}`);
  if (tool === 'scan_structure') addFact(memory, `Структура проекта: ${truncate(result, 220)}`);
  if (tool === 'list_files') addFact(memory, `Файловый обзор: ${truncate(result, 220)}`);
  if (tool === 'subagent') addFact(memory, `Итог subagent: ${truncate(result, 260)}`);
}

function buildMemorySnapshot(memory: AgentMemory): string {
  const facts = memory.keyFacts.length ? memory.keyFacts.map((f) => `- ${f}`).join('\n') : '- (пока нет зафиксированных фактов)';
  return (
    '[Снимок контекста и прогресса]\n' +
    `- toolCalls: ${memory.toolCalls}\n` +
    `- покрытие топ-директорий: ${[...memory.topDirs].slice(0, 8).join(', ') || '(нет)'}\n` +
    `- прочитано файлов (уник.): ${memory.readFiles.size}\n` +
    `- subagent batches/tasks/errors: ${memory.subagentBatches}/${memory.subagentTasks}/${memory.subagentErrorBatches}\n` +
    '- ключевые факты:\n' +
    `${facts}\n` +
    'Используй этот снимок как накопленную память и учитывай его при решении: продолжать сбор фактов или переходить к final_answer.'
  );
}

function hasEnoughContext(question: string, memory: AgentMemory): boolean {
  if (memory.toolCalls >= 3 && memory.keyFacts.length >= 2) return true;
  const broad = isBroadStudyQuery(question);
  const subagentQualityOk = memory.subagentBatches === 0 || memory.subagentErrorBatches <= 1;
  if (broad) {
    return (
      memory.topDirs.size >= 3 &&
      memory.readFiles.size >= 5 &&
      (memory.subagentTasks >= 2 || memory.toolCalls >= 10) &&
      subagentQualityOk
    );
  }
  return memory.readFiles.size >= 2 || memory.toolCalls >= 4;
}

function buildThinkMessage(
  iteration: number,
  question: string,
  memory: AgentMemory,
  lastTool: string | null,
  lastReasoning: string | null
): string {
  const enough = hasEnoughContext(question, memory);
  const coverage = `${memory.topDirs.size} dirs, ${memory.readFiles.size} files`;
  const prev = lastTool ? `${lastTool}${lastReasoning ? ` — ${lastReasoning}` : ''}` : 'начальная оценка контекста';
  const decision = enough
    ? 'контекста похоже достаточно, проверяю можно ли переходить к final_answer'
    : 'контекста пока мало, выбираю следующий самый информативный шаг';
  return `🧠 [Агент] Шаг ${iteration}: ${decision} (покрытие: ${coverage}; предыдущий шаг: ${prev})`;
}

export async function runAgent(
  question: string,
  chatHistory: ChatMessage[],
  activeFile: { path: string; language: string; content: string } | null,
  onStep?: AgentStepCallback,
  signal?: AbortSignal
): Promise<string> {
  const cfg = readConfig();
  if (!isConfigValid(cfg)) {
    return 'Ошибка: не настроены API-параметры (URL, ключ, модель). Откройте вкладку Settings.';
  }

  const messages: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(chatHistory) }];
  messages.push(...buildFewShotMessages());

  for (const msg of chatHistory.slice(-8).slice(0, -1)) messages.push(msg);

  if (activeFile) {
    messages.push({
      role: 'user',
      content: `[Контекст] Открыт файл: ${activeFile.path} (${activeFile.language})\n\`\`\`\n${truncate(activeFile.content, 3000)}\n\`\`\``
    });
  }

  const usedCalls = new Set<string>();
  const modelUsedTools = new Set<string>();
  const lastQuestion = chatHistory[chatHistory.length - 1]?.content || question;
  const needMermaid = requiresMermaidDiagram(lastQuestion);
  const memory: AgentMemory = {
    topDirs: new Set<string>(),
    readFiles: new Set<string>(),
    toolCalls: 0,
    subagentBatches: 0,
    subagentTasks: 0,
    subagentErrorBatches: 0,
    keyFacts: []
  };

  const isFirstMessage = chatHistory.length <= 1;
  if (isFirstMessage) {
    for (const toolName of ['scan_structure', 'list_files', 'detect_stack']) {
      onStep?.('agent-auto', `📋 [Авто] ${toolName}...`, { tool: toolName, stage: 'start' });
      try {
        const result = await executeTool(toolName, {}, lastQuestion, onStep);
        messages.push({ role: 'user', content: `[Авто-контекст: ${toolName}]:\n${truncate(result)}` });
        usedCalls.add(`${toolName}:{}`);
        updateMemory(memory, toolName, {}, result);
        modelUsedTools.add(toolName);
        onStep?.('agent-auto-done', `✓ [Авто] ${toolName} → ${result.split('\n').length} строк`, {
          tool: toolName,
          stage: 'done',
          lines: result.split('\n').length
        });
      } catch { /* skip */ }
    }
  }

  messages.push({
    role: 'user',
    content: `[Запрос пользователя]: ${lastQuestion}\n\n` +
      (isFirstMessage
        ? 'Выше — контекст проекта. Следуй исходной цели пользователя и собери только релевантные факты.'
        : 'Вызови утилиту или final_answer, если контекста достаточно для цели пользователя.')
  });

  let iteration = 0, consecutiveDupes = 0, noActionRetryCount = 0, diversityNudges = 0, lastMonotonyCheck = 0;
  let subagentUsed = false;
  let subagentRecoveryNudgeSent = false;
  let subagentProactiveNudges = 0;
  let enoughContextNudgeSent = false;
  let lastToolUsed: string | null = null;
  let lastToolReasoning: string | null = null;

  while (true) {
    if (signal?.aborted) return '⛔ Задача остановлена пользователем.';
    iteration++;
    onStep?.(
      'agent-think',
      buildThinkMessage(iteration, lastQuestion, memory, lastToolUsed, lastToolReasoning),
      {
        step: iteration,
        enoughContext: hasEnoughContext(lastQuestion, memory),
        readFiles: memory.readFiles.size,
        topDirs: memory.topDirs.size,
        subagentBatches: memory.subagentBatches,
        lastTool: lastToolUsed || '',
        lastReasoning: lastToolReasoning || ''
      }
    );

    if (consecutiveDupes >= MAX_CONSECUTIVE_DUPES) { onStep?.('agent-loop', `⚠️ Зацикливание. Завершаю.`); break; }

    if (iteration - lastMonotonyCheck >= 3) {
      const hint = checkMonotony(usedCalls, modelUsedTools);
      if (hint) { messages.push({ role: 'user', content: hint }); lastMonotonyCheck = iteration; }
    }
    if (iteration % 4 === 0 && memory.toolCalls > 0) {
      messages.push({ role: 'user', content: buildMemorySnapshot(memory) });
    }
    if (!enoughContextNudgeSent && iteration >= 8 && hasEnoughContext(lastQuestion, memory)) {
      enoughContextNudgeSent = true;
      messages.push({
        role: 'user',
        content:
          buildMemorySnapshot(memory) +
          '\n\n[Система] Контекста уже достаточно для цели пользователя. ' +
          'Не делай лишних шагов: если нет критичных пробелов, переходи к final_answer.'
      });
    }

    trimContext(messages);

    let response: string;
    try {
      response = await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, messages, { temperature: TOOL_CALL_TEMPERATURE, signal });
    } catch (err: any) {
      if (signal?.aborted) return '⛔ Задача остановлена пользователем.';
      return `Ошибка API: ${err?.message || err}`;
    }

    const { action } = parseAgentAction(response);

    if (!action) {
      const topDirs = getReadTopDirs(usedCalls);
      const shouldForceSubagentRecovery =
        !subagentUsed &&
        !subagentRecoveryNudgeSent &&
        isBroadStudyQuery(lastQuestion) &&
        usedCalls.size >= 3 &&
        topDirs.length >= 1;

      if (shouldForceSubagentRecovery) {
        subagentRecoveryNudgeSent = true;
        messages.push({ role: 'assistant', content: response });
        messages.push({
          role: 'user',
          content:
            'Перед дальнейшим линейным анализом сделай orchestration через subagent.\n' +
            'Верни JSON-вызов subagent c tasks[] и parallel:true (3-6 задач по независимым областям, исходя из уже прочитанных частей проекта).\n' +
            'Формат:\n' +
            '```json\n' +
            '{\n' +
            '  "tool": "subagent",\n' +
            '  "args": {\n' +
            '    "parallel": true,\n' +
            '    "tasks": [\n' +
            '      { "task": "..." },\n' +
            '      { "task": "..." }\n' +
            '    ]\n' +
            '  },\n' +
            '  "reasoning": "..."\n' +
            '}\n' +
            '```'
        });
        noActionRetryCount = 0;
        continue;
      }

      if (noActionRetryCount < 3) {
        noActionRetryCount++;
        messages.push({ role: 'assistant', content: response });
        messages.push({
          role: 'user',
          content:
            'Ты не вызвал утилиту. Верни ровно один JSON-вызов инструмента или final_answer.\n' +
            'Если данных достаточно (авто-контекст уже собран) — верни {"tool":"final_answer"}.\n' +
            'Если запрос широкий и есть независимые области, предпочти subagent с tasks[] и parallel:true.'
        });
        continue;
      }
      if (usedCalls.size >= 2) {
        onStep?.('agent-answer', '📝 Не удалось получить JSON, формирую итог из собранных фактов...', { step: iteration });
        messages.push({ role: 'assistant', content: response });
        messages.push({
          role: 'user',
          content:
            `JSON-вызов не получился, но фактов уже достаточно. Сформируй полный итоговый ответ СТРОГО на последний запрос пользователя:\n«${truncate(lastQuestion, 500)}»\n\n` +
            'Отвечай ТОЛЬКО на этот запрос. Не смешивай с предыдущими сообщениями.\n' +
            (needMermaid
              ? 'Обязательно добавь хотя бы одну Mermaid-диаграмму в блоке ```mermaid``` (без ASCII-псевдографики).\n'
              : 'Если есть архитектурные связи/потоки, добавь Mermaid-диаграммы в блоках ```mermaid```.\n') +
            'НЕ выводи JSON, только структурированный markdown по-русски.'
        });
        try {
          if (signal?.aborted) return '⛔ Задача остановлена пользователем.';
          return cleanupFinalAnswer(
            await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, messages, { temperature: FINAL_ANSWER_TEMPERATURE, signal }),
            needMermaid
          );
        } catch (err: any) {
          if (signal?.aborted) return '⛔ Задача остановлена пользователем.';
          return `Ошибка API: ${err?.message || err}`;
        }
      }
      return 'Не удалось распарсить корректный JSON-вызов утилиты после нескольких попыток. Сформулируй запрос иначе или сузь задачу.';
    }

    if (action.tool === 'none' || action.tool === 'noop') {
      messages.push({ role: 'assistant', content: response });
      messages.push({
        role: 'user',
        content:
          'Ты вернул служебный tool ("none/noop"), значит данных достаточно. ' +
          'Сразу переходи к final_answer и затем дай итоговый markdown-ответ без JSON.'
      });
      continue;
    }

    if (action.tool === 'final_answer') {
      const tooFew = modelUsedTools.size < MIN_TOOL_TYPES_BEFORE_ANSWER;
      if (tooFew && diversityNudges < MAX_DIVERSITY_NUDGES) {
        const missing = checkToolDiversity(usedCalls);
        if (missing) {
          diversityNudges++;
          messages.push({ role: 'assistant', content: response });
          messages.push({ role: 'user', content: missing });
          onStep?.('agent-nudge', `⚠️ ${modelUsedTools.size}/${MIN_TOOL_TYPES_BEFORE_ANSWER} типов утилит — продолжаю`, {
            usedToolTypes: modelUsedTools.size,
            requiredToolTypes: MIN_TOOL_TYPES_BEFORE_ANSWER
          });
          continue;
        }
      }

      messages.push({ role: 'assistant', content: response });
      messages.push({
        role: 'user',
        content:
          `Напиши подробный итоговый ответ СТРОГО на последний запрос пользователя:\n«${truncate(lastQuestion, 500)}»\n\n` +
          'Отвечай ТОЛЬКО на этот запрос. Если он не связан с предыдущими сообщениями — игнорируй предыдущий контекст.\n' +
          'Формат: структурированный markdown с заголовками, таблицами, списками.\n' +
          (needMermaid
            ? 'Обязательно добавь хотя бы одну Mermaid-диаграмму в блоке ```mermaid``` (без ASCII-псевдографики).\n'
            : 'Если описываешь архитектуру/взаимодействия/потоки — добавь Mermaid-диаграммы в блоках ```mermaid```.\n') +
          'НЕ выводи JSON. По-русски.'
      });
      onStep?.('agent-answer', '📝 Формирую ответ...', { step: iteration });
      try {
        if (signal?.aborted) return '⛔ Задача остановлена пользователем.';
        return cleanupFinalAnswer(
          await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, messages, { temperature: FINAL_ANSWER_TEMPERATURE, signal }),
          needMermaid
        );
      } catch (err: any) {
        if (signal?.aborted) return '⛔ Задача остановлена пользователем.';
        return `Ошибка API: ${err?.message || err}`;
      }
    }

    if (
      !subagentUsed &&
      subagentProactiveNudges < 2 &&
      isBroadStudyQuery(lastQuestion) &&
      iteration >= 3 &&
      action.tool !== 'subagent' &&
      action.tool !== 'final_answer' &&
      !modelUsedTools.has('subagent') &&
      ['read_file', 'read_file_range', 'list_files', 'grep'].includes(action.tool)
    ) {
      subagentProactiveNudges++;
      messages.push({ role: 'assistant', content: response });
      messages.push({
        role: 'user',
        content:
          'Ты тратишь шаги на линейное чтение файлов. Эта задача подходит для параллельного анализа.\n' +
          'Используй subagent с tasks[] и parallel:true — распредели подзадачи по направлениям.\n' +
          'Это обязательный шаг перед дальнейшим анализом.\n' +
          'Формат:\n```json\n{"tool":"subagent","args":{"parallel":true,"tasks":[{"prompt":"..."},{"prompt":"..."}],"subagent_type":"explore","readonly":true},"reasoning":"..."}\n```'
      });
      continue;
    }

    const callKey = `${action.tool}:${JSON.stringify(action.args || {})}`;
    if (usedCalls.has(callKey)) {
      consecutiveDupes++;
      messages.push({ role: 'assistant', content: response });
      messages.push({ role: 'user', content: `${action.tool} с этими аргументами уже вызывалась. Используй другую.` });
      continue;
    }
    usedCalls.add(callKey);
    modelUsedTools.add(action.tool);
    consecutiveDupes = 0;
    noActionRetryCount = 0;

    const argsStr = action.args ? ` ${JSON.stringify(action.args)}` : '';
    onStep?.('agent-tool', `🔧 [${action.tool}]${argsStr}${action.reasoning ? ` — ${action.reasoning}` : ''}`, {
      step: iteration,
      tool: action.tool,
      args: action.args || {},
      reasoning: action.reasoning || ''
    });
    lastToolUsed = action.tool;
    lastToolReasoning = action.reasoning || null;

    let result: string;
    try { result = await executeTool(action.tool, action.args || {}, lastQuestion, onStep); }
    catch (err: any) { result = `Ошибка: ${err?.message || err}`; }

    onStep?.('agent-result', `✓ [${action.tool}] → ${result.split('\n').length} строк`, {
      step: iteration,
      tool: action.tool,
      lines: result.split('\n').length,
      resultPreview: truncate(result, 400)
    });
    updateMemory(memory, action.tool, action.args || {}, result);
    messages.push({ role: 'assistant', content: response });
    messages.push({ role: 'user', content: `[Результат ${action.tool}]:\n${truncate(result)}` });

    if (action.tool === 'subagent') {
      subagentUsed = true;
      const hasSubErrors = /\(subagent\).*ошиб|не удалось получить валидный JSON|timeout|aborted/i.test(result);
      if (hasSubErrors) {
        messages.push({
          role: 'user',
          content:
            'Часть subagent-задач завершилась с ошибками. Сначала сделай вторую волну subagent:\n' +
            '- только по проваленным направлениям\n' +
            '- с более конкретными задачами (goal/task + files при наличии)\n' +
            '- parallel:true\n' +
            'После этого добери только критические пробелы и переходи к final_answer.'
        });
      } else {
        messages.push({
          role: 'user',
          content:
            'Subagent-результаты получены. Теперь работай как оркестратор: синтезируй вывод, добери только критические пробелы и переходи к final_answer.'
        });
      }
    } else if (subagentUsed && action.tool === 'read_file' && String(action.args?.path || '').startsWith('.ai-assistant/traces/')) {
      messages.push({
        role: 'user',
        content:
          'Не анализируй служебные trace-файлы для ответа пользователю, если это не было явно запрошено. Сфокусируйся на исходном коде и конфигурации проекта.'
      });
    }
  }

  if (signal?.aborted) return '⛔ Задача остановлена пользователем.';
  onStep?.('agent-answer', '📝 Формирую ответ...', { step: iteration });
  messages.push({
    role: 'user',
    content:
      `Анализ завершён. Напиши итоговый ответ СТРОГО на последний запрос пользователя:\n«${truncate(lastQuestion, 500)}»\n\n` +
      'Отвечай ТОЛЬКО на этот запрос. Не включай информацию из предыдущих сообщений, если она не относится к нему.\n' +
      'НЕ JSON. Markdown. По-русски.'
  });
  try {
    return cleanupFinalAnswer(
      await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, messages, { temperature: FINAL_ANSWER_TEMPERATURE, signal }),
      needMermaid
    );
  } catch (err: any) {
    if (signal?.aborted) return '⛔ Задача остановлена пользователем.';
    return `Ошибка API: ${err?.message || err}`;
  }
}
