import * as vscode from 'vscode';
import { readConfig, sendChatRequest, sendEmbeddingsRequest, getApiRootUrl } from '../core/api';
import { IGNORE_PATTERN, SEARCHABLE_EXTENSIONS, SEARCHABLE_EXTENSIONS_BARE, MAX_FILE_SIZE, CODE_EXTENSIONS_RE, CODE_EXTENSIONS_WITH_DATA_RE, MAX_TOOL_RESULT_CHARS } from '../core/constants';
import { decoder, escapeRegExp, smartReadFile, buildFileTree, truncate } from '../core/utils';
import { scanWorkspaceStructure, listAllProjectFiles, detectStackAndEntrypoints } from '../analysis/scanner';
import { grepWorkspace } from '../analysis/grep';
import { extractDocumentSymbols, buildDependencyGraph, formatSymbolOutline } from '../analysis/symbols';
import { parseAgentAction, stripJsonBlocks } from './prompt';

type ToolEventCallback = (phase: string, message: string, meta?: any) => void | Promise<any>;
let SUBAGENT_SEQ = 0;

async function resolveWorkspaceUri(filePath: string): Promise<vscode.Uri | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length || !filePath) return null;

  // Prefer exact relative path from workspace root.
  const exact = vscode.Uri.joinPath(folders[0].uri, filePath);
  try {
    await vscode.workspace.fs.stat(exact);
    return exact;
  } catch { /* fallback to glob search */ }

  const found = await vscode.workspace.findFiles(`**/${filePath}`, IGNORE_PATTERN, 1);
  if (found.length) return found[0];

  // Heuristic fallback: when model misses nested segment (e.g. service/main.py vs service/app/main.py),
  // try locating basename inside the hinted parent directory.
  const normalized = filePath.replace(/^\.?\//, '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const baseName = parts[parts.length - 1];
    const parentHint = parts.slice(0, -1).join('/');
    const inParent = await vscode.workspace.findFiles(`**/${parentHint}/**/${baseName}`, IGNORE_PATTERN, 2);
    if (inParent.length === 1) return inParent[0];
  }

  // Last fallback: unique basename in workspace.
  if (parts.length) {
    const baseName = parts[parts.length - 1];
    const byName = await vscode.workspace.findFiles(`**/${baseName}`, IGNORE_PATTERN, 2);
    if (byName.length === 1) return byName[0];
  }
  return null;
}

function normalizeOutputMode(mode: string | undefined): 'content' | 'files_with_matches' | 'count' {
  const v = (mode || 'content').toLowerCase();
  if (v === 'files' || v === 'files_with_matches') return 'files_with_matches';
  if (v === 'count') return 'count';
  return 'content';
}

function extractFileHintsFromText(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const add = (v: string) => {
    const cleaned = v.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[),;:.]+$/g, '');
    if (!cleaned || cleaned.length < 3) return;
    if (cleaned.includes(' ') && !cleaned.includes('/')) return;
    if (/[а-яА-Я]/.test(cleaned)) return;
    if (cleaned.includes('/')) {
      // Avoid treating abstract tokens like "dev/prod" as file paths.
      if (!/\.[a-z0-9]{1,8}$/i.test(cleaned)) {
        const last = cleaned.split('/').filter(Boolean).pop() || '';
        if (last.length < 8) return;
      }
      seen.add(cleaned);
      return;
    }
    if (/^\./.test(cleaned) || /\.[a-z0-9]{2,5}$/i.test(cleaned)) {
      seen.add(cleaned);
    }
  };

  // Path-like tokens and dot-files.
  const tokenRe = /(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+|\.[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{2,5})/g;
  const matches = text.match(tokenRe) || [];
  for (const m of matches) add(m);

  return [...seen].slice(0, 8);
}

async function inferFilesForPrompt(prompt: string, parentQuery?: string, onEvent?: ToolEventCallback): Promise<string[]> {
  const direct = extractFileHintsFromText(prompt || '');
  if (direct.length > 0) return direct;

  const inferred = new Set<string>();
  try {
    const stack = await executeTool('detect_stack', {}, parentQuery, onEvent);
    for (const p of extractFileHintsFromText(stack)) inferred.add(p);
  } catch { /* ignore */ }
  try {
    const structure = await executeTool('scan_structure', {}, parentQuery, onEvent);
    for (const p of extractFileHintsFromText(structure)) inferred.add(p);
  } catch { /* ignore */ }
  return [...inferred].slice(0, 10);
}

function getSubagentAllowedTools(subagentType: string, readonly: boolean): Set<string> {
  const common = [
    'scan_structure', 'list_files', 'glob', 'find_files', 'detect_stack',
    'grep', 'read_file', 'read_file_range', 'extract_symbols', 'workspace_symbols',
    'dependencies', 'read_lints', 'get_diagnostics', 'semantic_search', 'web_search', 'web_fetch'
  ];
  const shellPlus = [...common, 'shell'];
  const full = [...shellPlus, 'str_replace', 'write_file', 'delete_file', 'edit_notebook'];

  let base: string[];
  switch (subagentType) {
    case 'explore':
      base = common;
      break;
    case 'shell':
      base = shellPlus;
      break;
    case 'generalPurpose':
    default:
      base = full;
      break;
  }

  const set = new Set(base);
  // In readonly mode disallow mutating operations and shell.
  if (readonly) {
    set.delete('str_replace');
    set.delete('write_file');
    set.delete('delete_file');
    set.delete('edit_notebook');
    set.delete('shell');
  }
  // Always block nested subagents and completion pseudo tool.
  set.delete('subagent');
  set.delete('final_answer');
  return set;
}

function validateSubagentToolArgs(tool: string, args: any): string | null {
  const a = args || {};
  const has = (k: string) => a[k] !== undefined && a[k] !== null && String(a[k]).trim() !== '';
  switch (tool) {
    case 'read_file':
    case 'read_file_range':
    case 'extract_symbols':
      return has('path') ? null : `Для "${tool}" обязателен args.path`;
    case 'glob':
    case 'find_files':
      return (has('pattern') || has('glob_pattern')) ? null : `Для "${tool}" обязателен args.pattern (или args.glob_pattern)`;
    case 'grep':
      return has('pattern') ? null : 'Для "grep" обязателен args.pattern';
    case 'workspace_symbols':
      return (has('query') || has('symbol') || has('name')) ? null : 'Для "workspace_symbols" обязателен args.query';
    case 'semantic_search':
      return has('query') ? null : 'Для "semantic_search" обязателен args.query';
    case 'dependencies': {
      const paths = Array.isArray(a.paths) ? a.paths : (has('path') ? [a.path] : []);
      return paths.length ? null : 'Для "dependencies" укажи args.paths (массив путей) или args.path';
    }
    case 'web_search':
      return (has('query') || has('search_term')) ? null : 'Для "web_search" обязателен args.query';
    case 'web_fetch':
      return has('url') ? null : 'Для "web_fetch" обязателен args.url';
    case 'shell':
      return (has('command') || has('cmd')) ? null : 'Для "shell" обязателен args.command';
    case 'edit_notebook':
      if (!has('target_notebook') && !has('path') && !has('notebook'))
        return 'Для "edit_notebook" обязателен args.target_notebook (путь к .ipynb)';
      if (a.cell_idx === undefined && a.cell_index === undefined)
        return 'Для "edit_notebook" обязателен args.cell_idx (индекс ячейки, 0-based)';
      return null;
    case 'str_replace':
      if (!has('path')) return 'Для "str_replace" обязателен args.path';
      if (!has('old_string') && !has('old') && !has('search'))
        return 'Для "str_replace" обязателен args.old_string';
      return null;
    case 'write_file':
      if (!has('path')) return 'Для "write_file" обязателен args.path';
      return null;
    case 'delete_file':
      return has('path') ? null : 'Для "delete_file" обязателен args.path';
    default:
      return null;
  }
}

async function runSubagentSingle(args: any, parentQuery?: string, onEvent?: ToolEventCallback): Promise<string> {
  const task = (args?.prompt || args?.task || args?.query || '').toString().trim();
  if (!task) return '(subagent) укажи "prompt" (или "task").';

  const subagentType = (args?.subagent_type || 'explore').toString();
  const readonly = args?.readonly !== false;
  const allowed = getSubagentAllowedTools(subagentType, readonly);
  const allowedList = [...allowed].sort().join(', ');
  const id = `sa-${++SUBAGENT_SEQ}`;
  onEvent?.('subagent-start', `🧩 [Subagent ${id}] старт: ${subagentType}${readonly ? ', readonly' : ''}`, {
    id, purpose: task, subagentType, readonly
  });

  const cfg = readConfig();
  if (!cfg.apiBaseUrl || !cfg.apiKey || !cfg.model) {
    return '(subagent) не настроены API-параметры (apiBaseUrl/apiKey/model).';
  }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    {
      role: 'system',
      content:
        'Ты — подагент (subagent) для анализа кода. ' +
        'Работай только через инструменты, каждый ход — ОДИН JSON-блок:\n' +
        '```json\n{ "tool": "имя", "args": { ... }, "reasoning": "кратко" }\n```\n' +
        'ВАЖНО: args не должны быть пустыми для инструментов, где нужны параметры.\n' +
        'Примеры корректных вызовов:\n' +
        '{"tool":"read_file","args":{"path":"README.md"},"reasoning":"..."}\n' +
        '{"tool":"glob","args":{"pattern":"**/*.ts"},"reasoning":"..."}\n' +
        '{"tool":"grep","args":{"pattern":"FastAPI","path":"app/main.py"},"reasoning":"..."}\n' +
        '{"tool":"workspace_symbols","args":{"query":"App"},"reasoning":"..."}\n' +
        'Для завершения: {"tool":"final_answer","args":{"text":"...итог..."}}.\n' +
        'Никогда не используй инструменты вне allowlist.\n' +
        'Итог делай максимально информативным: структура, ключевые факты, риски, рекомендации, что проверить дальше.\n' +
        'Опирайся на результаты инструментов, упоминай конкретные файлы/сервисы.\n' +
        `Тип подагента: ${subagentType}. Readonly: ${readonly ? 'true' : 'false'}.\n` +
        `Разрешенные утилиты: ${allowedList}`
    },
    {
      role: 'user',
      content:
        `Задача: ${task}\n` +
        (parentQuery ? `Контекст родительского запроса: ${parentQuery}\n` : '') +
        'Сначала получи факты инструментами, затем дай final_answer.'
    }
  ];

  let step = 0;
  let noActionCount = 0;
  let disallowedCount = 0;
  let consecutiveDupes = 0;
  const usedCalls = new Set<string>();
  while (true) {
    step++;
    onEvent?.('subagent-step', `🧠 [Subagent ${id}] Шаг ${step}`, { id, step });
    let llm: string;
    try {
      llm = await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, messages, { temperature: 0.15 });
    } catch (e: any) {
      onEvent?.('subagent-error', `✗ [Subagent ${id}] Ошибка API: ${e?.message || e}`, { id, error: e?.message || String(e) });
      return `(subagent) Ошибка API: ${e?.message || e}`;
    }

    const { action } = parseAgentAction(llm);
    if (!action) {
      noActionCount++;
      if (noActionCount >= 5) {
        onEvent?.('subagent-error', `✗ [Subagent ${id}] Не удалось получить валидный JSON-вызов`, { id, error: 'invalid-json' });
        return '(subagent) не удалось получить валидный JSON-вызов после нескольких попыток.';
      }
      messages.push({ role: 'assistant', content: llm });
      messages.push({
        role: 'user',
        content:
          'Ответ не в JSON-формате. Верни ОДИН JSON-блок вызова инструмента либо final_answer.'
      });
      continue;
    }
    noActionCount = 0;

    if (action.tool === 'final_answer') {
      const ready = action.args?.text || action.args?.answer || '';
      if (ready && typeof ready === 'string') {
        onEvent?.('subagent-done', `✓ [Subagent ${id}] Завершён`, { id, summary: stripJsonBlocks(ready) });
        return stripJsonBlocks(ready);
      }

      messages.push({ role: 'assistant', content: llm });
      messages.push({
        role: 'user',
        content: 'Сформируй финальный ответ в markdown (без JSON), кратко и по фактам.'
      });
      try {
        const done = stripJsonBlocks(await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, messages, { temperature: 0.4 }));
        onEvent?.('subagent-done', `✓ [Subagent ${id}] Завершён`, { id, summary: done });
        return done;
      } catch (e: any) {
        onEvent?.('subagent-error', `✗ [Subagent ${id}] Ошибка API: ${e?.message || e}`, { id, error: e?.message || String(e) });
        return `(subagent) Ошибка API: ${e?.message || e}`;
      }
    }

    if (!allowed.has(action.tool)) {
      disallowedCount++;
      if (disallowedCount >= 5) {
        onEvent?.('subagent-error', `✗ [Subagent ${id}] Слишком много запрещённых вызовов`, { id, error: 'disallowed-tools' });
        return '(subagent) остановлен: модель многократно вызывает запрещённые инструменты.';
      }
      messages.push({ role: 'assistant', content: llm });
      messages.push({
        role: 'user',
        content: `Инструмент "${action.tool}" запрещён для этого subagent. Используй allowlist: ${allowedList}`
      });
      continue;
    }
    disallowedCount = 0;

    const argsError = validateSubagentToolArgs(action.tool, action.args);
    if (argsError) {
      messages.push({ role: 'assistant', content: llm });
      messages.push({
        role: 'user',
        content:
          `${argsError}. Верни СРАЗУ новый JSON-вызов с корректными args.\n` +
          'Не повторяй пустые args и не вызывай инструменты без обязательных полей.'
      });
      continue;
    }

    const callKey = `${action.tool}:${JSON.stringify(action.args || {})}`;
    if (usedCalls.has(callKey)) {
      consecutiveDupes++;
      if (consecutiveDupes >= 3) {
        onEvent?.('subagent-error', `✗ [Subagent ${id}] Зацикливание на одинаковых вызовах`, { id, error: 'duplicate-calls' });
        return '(subagent) остановлен: зацикливание на одинаковых вызовах.';
      }
      messages.push({ role: 'assistant', content: llm });
      messages.push({ role: 'user', content: `Вызов ${action.tool} с такими аргументами уже был. Используй другой шаг.` });
      continue;
    }
    usedCalls.add(callKey);
    consecutiveDupes = 0;

    let toolResult: string;
    onEvent?.('subagent-tool', `🔧 [Subagent ${id}] ${action.tool}`, {
      id, tool: action.tool, args: action.args || {}, reasoning: action.reasoning || ''
    });
    try {
      toolResult = await executeTool(action.tool, action.args || {}, task, onEvent);
    } catch (e: any) {
      toolResult = `Ошибка инструмента ${action.tool}: ${e?.message || e}`;
    }
    onEvent?.('subagent-result', `✓ [Subagent ${id}] ${action.tool} → ${toolResult.split('\n').length} строк`, {
      id, tool: action.tool, resultPreview: truncate(toolResult, 400)
    });
    messages.push({ role: 'assistant', content: llm });
    messages.push({ role: 'user', content: `[Результат ${action.tool}]\n${truncate(toolResult, 6000)}` });
  }

}

async function runSubagent(args: any, parentQuery?: string, onEvent?: ToolEventCallback): Promise<string> {
  interface NormalizedTask {
    prompt?: string;
    action?: string;
    actionArgs?: any;
    files?: string[];
    subagent_type: string;
    readonly: boolean;
    label: string;
  }

  const tasks = Array.isArray(args?.tasks) ? args.tasks : [];
  const runParallel = args?.parallel === true;

  // Single subagent mode (backward compatible).
  if (!tasks.length) return runSubagentSingle(args, parentQuery, onEvent);

  const normalized: NormalizedTask[] = tasks
    .map((t: any, idx: number) => {
      if (typeof t === 'string') {
        const text = t.trim();
        if (!text) return null;
        const hintedFiles = extractFileHintsFromText(text);
        // Shortcut syntax: "toolName arg1 arg2..." (e.g. "read_file path/to/file")
        const m = text.match(/^([a-z_]+)\s+(.+)$/i);
        if (m) {
          const tool = m[1];
          const rest = m[2].trim();
          if (tool === 'read_file') {
            return {
              action: 'read_file',
              actionArgs: { path: rest },
              files: hintedFiles,
              subagent_type: args?.subagent_type || 'explore',
              readonly: args?.readonly !== false,
              label: `task-${idx + 1}`
            } as NormalizedTask;
          }
          if (tool === 'grep') {
            return {
              action: 'grep',
              actionArgs: { pattern: rest },
              files: hintedFiles,
              subagent_type: args?.subagent_type || 'explore',
              readonly: args?.readonly !== false,
              label: `task-${idx + 1}`
            } as NormalizedTask;
          }
        }
        return {
          prompt: text,
          files: hintedFiles,
          subagent_type: args?.subagent_type || 'explore',
          readonly: args?.readonly !== false,
          label: `task-${idx + 1}`
        } as NormalizedTask;
      }
      if (!t) return null;
      if (t.action || t.tool) {
        return {
          action: t.action || t.tool,
          actionArgs: t.args || {},
          files: Array.isArray(t.files) ? t.files.filter((f: any) => typeof f === 'string' && f.trim()) : undefined,
          subagent_type: t.subagent_type || t.type || args?.subagent_type || 'explore',
          readonly: (t.readonly !== undefined) ? (t.readonly !== false) : (args?.readonly !== false),
          label: t.label || t.title || t.name || `task-${idx + 1}`
        } as NormalizedTask;
      }
      const derivedPrompt = [t.prompt, t.task, t.query, t.goal, t.instruction, t.focus]
        .map((v: any) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean)
        .join('\n\n');
      if (!derivedPrompt) return null;
      return {
        prompt: derivedPrompt,
        files: (Array.isArray(t.files) ? t.files.filter((f: any) => typeof f === 'string' && f.trim()) : undefined)
          || extractFileHintsFromText(derivedPrompt),
        subagent_type: t.subagent_type || t.type || args?.subagent_type || 'explore',
        readonly: (t.readonly !== undefined) ? (t.readonly !== false) : (args?.readonly !== false),
        label: t.label || t.title || t.name || `task-${idx + 1}`
      } as NormalizedTask;
    })
    .filter((t: NormalizedTask | null): t is NormalizedTask => t !== null);

  if (!normalized.length) {
    return '(subagent) "tasks" передан, но задачи пустые. Используй массив строк или объектов с prompt/task/query/goal/instruction.';
  }

  onEvent?.('subagent-batch', `🧩 [Subagent] Запуск батча: ${normalized.length} задач (${runParallel ? 'parallel' : 'sequential'})`, {
    count: normalized.length,
    parallel: runParallel,
    tasks: normalized.map(t => ({ label: t.label, subagentType: t.subagent_type, readonly: t.readonly }))
  });

  // Shared cache within a batch: avoids re-reading the same files
  // when multiple guided subtasks overlap.
  const guidedReadCache = new Map<string, Promise<string>>();

  const runOne = async (t: NormalizedTask) => {
    if (t.action) {
      onEvent?.('subagent-step', `🧠 [Subagent ${t.label}] direct action`, {
        id: t.label, step: 1
      });
      onEvent?.('subagent-tool', `🔧 [Subagent ${t.label}] ${t.action}`, {
        id: t.label, tool: t.action, args: t.actionArgs || {}
      });
      const result = await executeTool(t.action, t.actionArgs || {}, parentQuery, onEvent);
      onEvent?.('subagent-result', `✓ [Subagent ${t.label}] ${t.action} → ${result.split('\n').length} строк`, {
        id: t.label, tool: t.action, resultPreview: truncate(result, 400)
      });
      onEvent?.('subagent-done', `✓ [Subagent ${t.label}] Завершён`, { id: t.label, summary: result });
      return { label: t.label, result };
    }

    const inferredFiles = (!t.files || t.files.length === 0) && t.prompt
      ? await inferFilesForPrompt(t.prompt, parentQuery, onEvent)
      : [];
    const guidedFiles = (t.files && t.files.length > 0) ? t.files : inferredFiles;

    // Guided mode: when task explicitly provides files (or we infer them), read them directly and ask LLM for synthesis.
    // This avoids fragile "JSON tool-call only" loops for straightforward file-scoped subtasks.
    if (guidedFiles && guidedFiles.length > 0) {
      const cfg = readConfig();
      onEvent?.('subagent-start', `🧩 [Subagent ${t.label}] guided-mode: ${guidedFiles.length} файлов`, {
        id: t.label, purpose: t.prompt || '', files: guidedFiles
      });
      const snippets: string[] = [];
      for (let i = 0; i < guidedFiles.length; i++) {
        const fp = guidedFiles[i];
        onEvent?.('subagent-step', `🧠 [Subagent ${t.label}] Шаг ${i + 1}`, { id: t.label, step: i + 1 });
        onEvent?.('subagent-tool', `🔧 [Subagent ${t.label}] read_file`, {
          id: t.label, tool: 'read_file', args: { path: fp }
        });
        let readPromise = guidedReadCache.get(fp);
        if (!readPromise) {
          readPromise = executeTool('read_file', { path: fp }, parentQuery, onEvent);
          guidedReadCache.set(fp, readPromise);
        }
        const r = await readPromise;
        onEvent?.('subagent-result', `✓ [Subagent ${t.label}] read_file → ${r.split('\n').length} строк`, {
          id: t.label, tool: 'read_file', resultPreview: truncate(r, 400)
        });
        snippets.push(`### ${fp}\n${truncate(r, 4500)}`);
      }

      if (!cfg.apiBaseUrl || !cfg.apiKey || !cfg.model) {
        const fallback = `Guided subagent (${t.label})\n\n` + snippets.join('\n\n');
        onEvent?.('subagent-done', `✓ [Subagent ${t.label}] Завершён`, { id: t.label, summary: truncate(fallback, 400) });
        return { label: t.label, result: fallback };
      }
      try {
        const summary = await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, [
          {
            role: 'system',
            content:
              'Ты подагент-аналитик. Дай краткий, но фактический markdown-отчёт только по предоставленным фрагментам. ' +
              'Не выдумывай данные, отмечай неопределённость явно.'
          },
          {
            role: 'user',
            content:
              `Задача:\n${t.prompt || 'Проанализируй материалы'}\n\n` +
              `Материалы:\n${snippets.join('\n\n')}\n\n` +
              'Сформируй структурированный итог (ключевые факты, выводы, риски, что проверить).'
          }
        ], { temperature: 0.2 });
        const done = stripJsonBlocks(summary);
        onEvent?.('subagent-done', `✓ [Subagent ${t.label}] Завершён`, { id: t.label, summary: truncate(done, 400) });
        return { label: t.label, result: done };
      } catch (e: any) {
        const fallback = `Guided subagent (${t.label})\n\n` + snippets.join('\n\n');
        onEvent?.('subagent-error', `✗ [Subagent ${t.label}] Ошибка API: ${e?.message || e}`, { id: t.label, error: e?.message || String(e) });
        onEvent?.('subagent-done', `✓ [Subagent ${t.label}] Завершён (fallback)`, { id: t.label, summary: truncate(fallback, 400) });
        return { label: t.label, result: fallback };
      }
    }

    const result = await runSubagentSingle({
      prompt: t.prompt,
      subagent_type: t.subagent_type,
      readonly: t.readonly
    }, parentQuery, onEvent);
    return { label: t.label, result };
  };

  const outputs = runParallel
    ? await Promise.all(normalized.map(runOne))
    : await (async () => {
      const acc: { label: string; result: string }[] = [];
      for (const t of normalized) acc.push(await runOne(t));
      return acc;
    })();

  const lines = [
    `Subagent batch: ${outputs.length} задач (${runParallel ? 'parallel' : 'sequential'})`,
    ''
  ];
  for (const out of outputs) {
    lines.push(`### ${out.label}`);
    lines.push(out.result || '(пустой результат)');
    lines.push('');
  }
  return lines.join('\n').trim();
}

export async function executeTool(toolName: string, args: any, query?: string, onEvent?: ToolEventCallback): Promise<string> {
  switch (toolName) {
    case 'scan_structure': {
      const overviews = await scanWorkspaceStructure();
      const lines: string[] = [];
      for (const o of overviews) {
        lines.push(`Корень: ${o.rootName}`);
        for (const d of o.topDirectories) lines.push(`  ${d.name}/ — ~${d.count} файлов`);
        if (o.importantFiles.length) lines.push('  Важные файлы: ' + o.importantFiles.join(', '));
      }
      return lines.join('\n') || '(workspace пуст)';
    }

    case 'list_files': {
      const allFiles = await listAllProjectFiles();
      const allPaths: string[] = [];
      for (const group of allFiles) allPaths.push(...group.files);
      const rawTarget = (args?.path || args?.dir || args?.target_directory || '').toString().trim();
      if (!rawTarget || rawTarget === '.' || rawTarget === './') {
      return `Всего файлов: ${allPaths.length}\n\n${buildFileTree(allPaths)}`;
      }
      const target = rawTarget.replace(/^\.?\//, '').replace(/\/+$/, '');
      const filtered = allPaths.filter((p) => p === target || p.startsWith(target + '/'));
      if (!filtered.length) {
        return `Файлы в "${rawTarget}" не найдены.`;
      }
      return `Всего файлов в "${rawTarget}": ${filtered.length}\n\n${buildFileTree(filtered)}`;
    }

    case 'glob':
    case 'find_files': {
      const pattern = (args?.glob_pattern || args?.pattern || '').toString().trim();
      if (!pattern) return '(паттерн не указан — укажи "pattern")';
      const targetDir: string | undefined = args?.target_directory || args?.directory || args?.dir;
      const folders = vscode.workspace.workspaceFolders;
      let searchPattern: vscode.GlobPattern = pattern;
      if (targetDir && folders?.length) {
        searchPattern = new vscode.RelativePattern(vscode.Uri.joinPath(folders[0].uri, targetDir), pattern.replace(/^\*\*\//, ''));
      }
      let uris = await vscode.workspace.findFiles(searchPattern, IGNORE_PATTERN, 100);
      if (uris.length === 0) {
        const hasGlobMeta = /[*?[\]{}]/.test(pattern);
        if (!hasGlobMeta) {
          const fallbackPatterns = [
            `**/*${pattern}*`,
            `**/${pattern}/**/*`
          ];
          for (const fp of fallbackPatterns) {
            uris = await vscode.workspace.findFiles(fp, IGNORE_PATTERN, 100);
            if (uris.length > 0) break;
          }
        }
      }
      if (uris.length === 0) return `Файлы по "${pattern}"${targetDir ? ` в ${targetDir}` : ''} не найдены.`;
      const withStats = await Promise.all(uris.map(async u => {
        try { return { uri: u, mtime: (await vscode.workspace.fs.stat(u)).mtime }; }
        catch { return { uri: u, mtime: 0 }; }
      }));
      withStats.sort((a, b) => b.mtime - a.mtime);
      const paths = withStats.map(s => vscode.workspace.asRelativePath(s.uri, false));
      return `Найдено ${paths.length} файлов по "${pattern}"${targetDir ? ` в ${targetDir}` : ''} (новые первыми):\n${paths.join('\n')}`;
    }

    case 'detect_stack': {
      const info = await detectStackAndEntrypoints();
      const lines: string[] = [];
      if (info.languageGuesses.length) lines.push('Стек: ' + info.languageGuesses.join(', '));
      if (info.entryFiles.length) { lines.push('Точки входа:'); for (const f of info.entryFiles) lines.push('  ' + f); }
      const infraChecks: [string, string][] = [
        ['**/docker-compose*.{yml,yaml}', 'Docker Compose'], ['**/Dockerfile*', 'Docker'],
        ['**/.github/workflows/*.{yml,yaml}', 'GitHub Actions'], ['**/.gitlab-ci.yml', 'GitLab CI'],
        ['**/Jenkinsfile', 'Jenkins'], ['**/k8s/**/*.{yml,yaml}', 'Kubernetes'],
        ['**/terraform/**/*.tf', 'Terraform'], ['**/nginx*.conf', 'Nginx'],
        ['**/pom.xml', 'Java/Maven'], ['**/build.gradle*', 'Java/Gradle'],
        ['**/*.csproj', 'C#/.NET'], ['**/composer.json', 'PHP/Composer'],
        ['**/Gemfile', 'Ruby'], ['**/pubspec.yaml', 'Dart/Flutter'],
        ['**/Package.swift', 'Swift'], ['**/mix.exs', 'Elixir'],
      ];
      const infra: string[] = [];
      for (const [glob, label] of infraChecks) {
        if ((await vscode.workspace.findFiles(glob, IGNORE_PATTERN, 1)).length > 0) infra.push(label);
      }
      if (infra.length) lines.push('Инфраструктура: ' + infra.join(', '));
      return lines.join('\n') || '(стек не определён)';
    }

    case 'grep': {
      const pattern = args?.pattern || '';
      if (!pattern) return '(пустой паттерн — укажи "pattern")';
      let filePaths: string[] = [];
      if (args?.path) filePaths = [args.path];
      else if (args?.file) filePaths = [args.file];
      else if (Array.isArray(args?.paths)) filePaths = args.paths;
      else if (Array.isArray(args?.files)) filePaths = args.files;

      const TYPE_MAP: Record<string, string> = {
        py: 'py', python: 'py', ts: 'ts', typescript: 'ts', tsx: 'tsx',
        js: 'js', javascript: 'js', jsx: 'jsx', go: 'go', rust: 'rs', rs: 'rs',
        java: 'java', cs: 'cs', csharp: 'cs', php: 'php', rb: 'rb', ruby: 'rb',
        c: 'c', cpp: 'cpp', h: 'h', hpp: 'hpp', swift: 'swift', kt: 'kt', kotlin: 'kt',
        dart: 'dart', lua: 'lua', sql: 'sql', html: 'html', css: 'css', scss: 'scss',
        json: 'json', yaml: 'yaml', yml: 'yml', toml: 'toml', xml: 'xml', md: 'md',
        sh: 'sh', bash: 'sh', vue: 'vue', svelte: 'svelte'
      };
      let fileType: string | undefined = args?.fileType || args?.file_type || args?.type;
      if (fileType && TYPE_MAP[fileType]) fileType = TYPE_MAP[fileType];
      const ignoreCase = args?.ignoreCase === true || args?.ignore_case === true || args?.i === true;
      const multiline = args?.multiline === true;
      const outputMode = normalizeOutputMode(args?.outputMode || args?.output_mode);
      const filesOnly = outputMode === 'files_with_matches' || args?.filesOnly === true;
      const countOnly = outputMode === 'count';
      const limit: number = args?.head_limit || args?.limit || args?.maxResults || (filesOnly ? 200 : countOnly ? 500 : 30);
      const offsetVal: number = args?.offset || 0;

      if (!fileType) {
        const inc: string | undefined = args?.include || args?.glob || args?.fileGlob;
        if (inc) { const m = inc.match(/\*\.(\w+)/); if (m) fileType = m[1]; }
      }

      function buildRegex(p: string, ic: boolean): RegExp {
        const f = ic ? 'gi' : 'g';
        try { return new RegExp(p, f); } catch { return new RegExp(escapeRegExp(p), f); }
      }

      if (filePaths.length > 0) {
        const ctxB: number = args?.B ?? args?.['-B'] ?? args?.linesBefore ?? args?.before ?? args?.C ?? args?.['-C'] ?? args?.context ?? 2;
        const ctxA: number = args?.A ?? args?.['-A'] ?? args?.linesAfter ?? args?.after ?? args?.C ?? args?.['-C'] ?? args?.context ?? 2;
        const res: string[] = [];
        for (const fp of filePaths.slice(0, 5)) {
          const uri = await resolveWorkspaceUri(fp);
          if (!uri) { res.push(`Файл "${fp}" не найден.`); continue; }
          try {
            const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
            const fileLines = text.split('\n');
            const re = buildRegex(pattern, ignoreCase);
            let mc = 0;
            for (let i = 0; i < fileLines.length && mc < limit; i++) {
              re.lastIndex = 0;
              if (!re.test(fileLines[i])) continue;
              mc++;
              const s = Math.max(0, i - ctxB), e = Math.min(fileLines.length - 1, i + ctxA);
              res.push(`--- ${fp}:${i + 1} ---`);
              for (let j = s; j <= e; j++) res.push(`${j === i ? '>' : ' '} ${j + 1}| ${fileLines[j]}`);
              res.push('');
            }
            if (countOnly) return `${fp}: ${mc} совпадений по "${pattern}"`;
          } catch { res.push(`Ошибка чтения "${fp}"`); }
        }
        return res.length ? `Совпадения по "${pattern}":\n\n${res.join('\n')}` : `Совпадений по "${pattern}" не найдено.`;
      }

      const fileGlob = fileType ? `**/*.${fileType}` : undefined;
      const regex = buildRegex(pattern, ignoreCase);
      const ctxB: number | undefined = args?.B ?? args?.['-B'] ?? args?.linesBefore ?? args?.before;
      const ctxA: number | undefined = args?.A ?? args?.['-A'] ?? args?.linesAfter ?? args?.after;
      const ctxC: number | undefined = args?.C ?? args?.['-C'] ?? args?.context ?? args?.contextLines;
      const defCtx = (filesOnly || countOnly) ? 0 : 2;
      const matches = await grepWorkspace(regex, {
        maxResults: limit,
        contextLines: (ctxB === undefined && ctxA === undefined) ? (ctxC ?? defCtx) : undefined,
        linesBefore: ctxB ?? (ctxC !== undefined ? ctxC : undefined),
        linesAfter: ctxA ?? (ctxC !== undefined ? ctxC : undefined),
        fileGlob, multiline, offset: offsetVal
      });

      if (!matches.length) return `Совпадений по "${pattern}" не найдено${fileType ? ` (в *.${fileType})` : ''}.`;
      if (countOnly) {
        const fc = new Map<string, number>();
        for (const m of matches) fc.set(m.file, (fc.get(m.file) || 0) + 1);
        const lines = [`Всего: ${matches.length} совпадений в ${fc.size} файлах:`];
        for (const [f, c] of [...fc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50)) lines.push(`  ${f}: ${c}`);
        return lines.join('\n');
      }
      if (filesOnly) return `Найдено в ${[...new Set(matches.map(m => m.file))].length} файлах:\n${[...new Set(matches.map(m => m.file))].sort().join('\n')}`;
      const lines = [`Найдено ${matches.length} совпадений по "${pattern}"${fileType ? ` в *.${fileType}` : ''}${offsetVal ? ` (offset: ${offsetVal})` : ''}:`];
      for (const m of matches) { lines.push(`\n--- ${m.file}:${m.line} ---`); lines.push(m.context); }
      return lines.join('\n');
    }

    case 'read_file': {
      const filePath = args?.path || '';
      if (!filePath) return '(путь не указан — укажи "path")';
      if (args?.startLine || args?.endLine || args?.start || args?.end || args?.from || args?.to || args?.from_line || args?.to_line) {
        return await executeTool('read_file_range', args, query);
      }
      const uri = await resolveWorkspaceUri(filePath);
      if (!uri) return `Файл "${filePath}" не найден. Используй glob/find_files.`;
      try {
        const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
        const off = args?.offset, lim = args?.limit;
        if (off !== undefined || lim !== undefined) {
          const all = text.split('\n'), total = all.length;
          let s = typeof off === 'number' ? (off < 0 ? Math.max(0, total + off) : Math.max(0, off - 1)) : 0;
          const cnt = (typeof lim === 'number' && lim > 0) ? lim : (total - s);
          const e = Math.min(total, s + cnt);
          return `${filePath} строки ${s + 1}–${e} из ${total}:\n\n${all.slice(s, e).map((l, i) => `${s + i + 1}| ${l}`).join('\n')}`;
        }
        return smartReadFile(text, filePath, query);
      } catch { return `Ошибка чтения "${filePath}"`; }
    }

    case 'read_file_range': {
      const filePath = args?.path || '';
      let sl = args?.startLine ?? args?.start_line ?? args?.from_line ?? args?.start ?? args?.from ?? 1;
      let el = args?.endLine ?? args?.end_line ?? args?.to_line ?? args?.end ?? args?.to ?? null;
      if (typeof sl !== 'number') sl = parseInt(sl, 10) || 1;
      if (el !== null && typeof el !== 'number') el = parseInt(el, 10) || null;
      if (el === null) el = sl + 80;
      if (!filePath) return '(путь не указан)';
      const uri = await resolveWorkspaceUri(filePath);
      if (!uri) return `Файл "${filePath}" не найден.`;
      try {
        const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
        const lines = text.split('\n'), total = lines.length;
        if (sl > total) {
          const avg = Math.max(1, text.length / total);
          sl = Math.max(1, Math.floor(sl / avg));
          el = Math.min(total, Math.floor(el / avg));
          if (el <= sl) el = Math.min(total, sl + 80);
        }
        const s = Math.max(0, sl - 1), e = Math.min(total, el);
        return `${filePath} строки ${s + 1}–${e} из ${total}:\n\n${lines.slice(s, e).map((l, i) => `${s + i + 1}| ${l}`).join('\n')}`;
      } catch { return `Ошибка чтения "${filePath}"`; }
    }

    case 'extract_symbols': {
      const filePath = args?.path || '';
      if (!filePath) return '(путь не указан)';
      if (!CODE_EXTENSIONS_RE.test(filePath)) {
        return `extract_symbols работает только для кода. "${filePath}" — конфиг. Используй read_file.`;
      }
      const uri = await resolveWorkspaceUri(filePath);
      if (!uri) return `Файл "${filePath}" не найден.`;
      return formatSymbolOutline(await extractDocumentSymbols(uri));
    }

    case 'workspace_symbols': {
      const q = args?.query || args?.symbol || args?.name || '';
      if (!q) return '(запрос не указан — укажи "query")';
      try {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', q);
        if (!symbols?.length) return `Символы по "${q}" не найдены. Попробуй grep.`;
        const lines = [`Найдено ${Math.min(symbols.length, 30)} символов по "${q}":`];
        for (const sym of symbols.slice(0, 30)) {
          const rel = vscode.workspace.asRelativePath(sym.location.uri, false);
          const container = sym.containerName ? ` (в ${sym.containerName})` : '';
          lines.push(`  [${vscode.SymbolKind[sym.kind] || 'Unknown'}] ${sym.name}${container} — ${rel}:${sym.location.range.start.line + 1}`);
        }
        return lines.join('\n');
      } catch { return 'Ошибка поиска символов.'; }
    }

    case 'dependencies': {
      const paths: string[] = args?.paths || (args?.path ? [args.path] : []);
      if (!paths.length) return '(нет файлов — укажи "paths": ["file1.py", "file2.py"])';
      const configFiles = paths.filter(p => /\.(json|txt|toml|cfg|ini|yaml|yml|lock)$/.test(p));
      const codeFiles = paths.filter(p => !configFiles.includes(p));
      const lines: string[] = [];
      for (const cf of configFiles) {
        const uri = await resolveWorkspaceUri(cf);
        if (!uri) continue;
        try {
          const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
          if (cf.endsWith('.json')) {
            const pkg = JSON.parse(text);
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (Object.keys(deps).length > 0) {
              lines.push(`\n${cf} (${Object.keys(deps).length} зависимостей):`);
              for (const [name, ver] of Object.entries(deps).slice(0, 30)) lines.push(`  ${name}: ${ver}`);
            }
          } else if (cf.endsWith('.txt')) {
            const pkgs = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
            if (pkgs.length) { lines.push(`\n${cf} (${pkgs.length} пакетов):`); for (const p of pkgs.slice(0, 30)) lines.push(`  ${p}`); }
          }
        } catch { /* skip */ }
      }
      if (codeFiles.length) {
        const uris: vscode.Uri[] = [];
        for (const p of codeFiles) {
          const uri = await resolveWorkspaceUri(p);
          if (uri) uris.push(uri);
        }
        if (uris.length) {
          const edges = await buildDependencyGraph(uris);
          if (edges.length) { lines.push('\nГраф импортов:'); for (const e of edges) lines.push(`  ${e.from} → ${e.to}`); }
          else if (!configFiles.length) lines.push('Прямых зависимостей (импортов) не найдено.');
        }
      }
      return lines.length ? lines.join('\n').trim() : 'Зависимостей не найдено. dependencies работает с кодовыми файлами (import/require). Для package.json/requirements.txt используй read_file.';
    }

    case 'read_lints': {
      const paths: string[] = Array.isArray(args?.paths)
        ? args.paths
        : (typeof args?.path === 'string' ? [args.path] : []);
      const results: string[] = [];
      for (const [uri, diags] of vscode.languages.getDiagnostics()) {
        if (!diags.length) continue;
        const rel = vscode.workspace.asRelativePath(uri, false);
        if (rel.startsWith('/')) continue;
        if (paths.length > 0 && !paths.some(p => rel === p || rel.startsWith(p + '/'))) continue;
        const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
        const warnings = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);
        if (!errors.length && !warnings.length) continue;
        results.push(`\n--- ${rel} (${errors.length} ошибок, ${warnings.length} предупреждений) ---`);
        for (const d of [...errors, ...warnings].slice(0, 20)) {
          results.push(`  L${d.range.start.line + 1} ${d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARN'}${d.source ? ` [${d.source}]` : ''}: ${d.message}`);
        }
      }
      return results.length ? results.join('\n') : 'Нет диагностик в указанной области.';
    }

    case 'subagent': {
      return await runSubagent(args || {}, query, onEvent);
    }

    case 'get_diagnostics': {
      const filePath: string | undefined = args?.path;
      const results: string[] = [];
      for (const [uri, diags] of vscode.languages.getDiagnostics()) {
        if (!diags.length) continue;
        const rel = vscode.workspace.asRelativePath(uri, false);
        if (filePath && rel !== filePath) continue;
        if (rel.startsWith('/')) continue;
        const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
        const warnings = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);
        if (!errors.length && !warnings.length) continue;
        results.push(`\n--- ${rel} (${errors.length} ошибок, ${warnings.length} предупреждений) ---`);
        for (const d of [...errors, ...warnings].slice(0, 10)) {
          results.push(`  L${d.range.start.line + 1} ${d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARN'}${d.source ? ` [${d.source}]` : ''}: ${d.message}`);
        }
      }
      return results.length ? results.join('\n') : (filePath ? `Нет ошибок в "${filePath}".` : 'Нет ошибок в проекте.');
    }

    case 'semantic_search': {
      const sq = args?.query || '';
      if (!sq) return '(укажи "query")';
      const cfg = readConfig();
      if (!cfg.embeddingsModel) return 'Модель эмбеддингов не настроена.';
      const lim = args?.limit || 10;
      const targetDir: string | undefined = args?.target_directory || args?.directory || args?.dir;
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) return '(workspace пуст)';
      let glob: vscode.GlobPattern = SEARCHABLE_EXTENSIONS;
      if (targetDir) glob = new vscode.RelativePattern(vscode.Uri.joinPath(folders[0].uri, targetDir), SEARCHABLE_EXTENSIONS_BARE);
      const allUris = await vscode.workspace.findFiles(glob, IGNORE_PATTERN, 500);
      const codeUris = allUris.filter(u => CODE_EXTENSIONS_WITH_DATA_RE.test(u.fsPath));
      if (!codeUris.length) return 'Файлы с кодом не найдены.';

      const chunks: { path: string; text: string; startLine: number }[] = [];
      for (const uri of codeUris.slice(0, 200)) {
        try {
          const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
          if (text.length > MAX_FILE_SIZE) continue;
          const rel = vscode.workspace.asRelativePath(uri, false);
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i += 30) {
            const chunk = lines.slice(i, i + 40).join('\n');
            if (chunk.trim().length < 20) continue;
            chunks.push({ path: rel, text: chunk.slice(0, 800), startLine: i + 1 });
          }
        } catch { /* skip */ }
      }
      if (!chunks.length) return 'Нет фрагментов для поиска.';

      let qEmb: number[];
      try { [qEmb] = await sendEmbeddingsRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.embeddingsModel, [sq]); }
      catch (e: any) { return `Ошибка embeddings: ${e?.message || e}`; }

      const allEmb: number[][] = [];
      const chunkTexts = chunks.map(c => `${c.path}:${c.startLine}\n${c.text}`);
      for (let b = 0; b < chunkTexts.length; b += 50) {
        try { allEmb.push(...await sendEmbeddingsRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.embeddingsModel, chunkTexts.slice(b, b + 50))); }
        catch { for (let i = 0; i < Math.min(50, chunkTexts.length - b); i++) allEmb.push([]); }
      }

      function cos(a: number[], b: number[]): number {
        if (!a.length || !b.length || a.length !== b.length) return 0;
        let d = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
        const dn = Math.sqrt(na) * Math.sqrt(nb);
        return dn === 0 ? 0 : d / dn;
      }

      let candidates = chunks.map((c, i) => ({ ...c, score: cos(qEmb, allEmb[i] || []) })).sort((a, b) => b.score - a.score);
      if (!candidates.length || candidates[0].score < 0.1) return `Ничего не найдено для "${sq}".`;

      const rerankTopK = Math.min(lim * 3, candidates.length, 30);
      candidates = candidates.slice(0, rerankTopK);

      if (cfg.rerankModel) {
        try {
          const rerankUrl = getApiRootUrl(cfg.apiBaseUrl) + '/v1/rerank';
          const rerankResp = await fetch(rerankUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({ model: cfg.rerankModel, query: sq, documents: candidates.map(c => `${c.path}:${c.startLine}\n${c.text}`), top_n: lim }),
            signal: AbortSignal.timeout(30_000)
          });
          if (rerankResp.ok) {
            const rr: any = await rerankResp.json();
            const results = rr?.results || rr?.data || rr;
            if (Array.isArray(results) && results.length > 0) {
              candidates = results
                .sort((a: any, b: any) => (b.relevance_score ?? b.score ?? 0) - (a.relevance_score ?? a.score ?? 0))
                .slice(0, lim)
                .map((r: any) => ({ ...candidates[r.index], score: r.relevance_score ?? r.score ?? candidates[r.index].score }));
            }
          }
        } catch { /* reranker unavailable, use embedding scores */ }
      }

      const top = candidates.slice(0, lim);
      const lines = [`Семантический поиск по "${sq}" (топ-${top.length}${cfg.rerankModel ? ', reranked' : ''}):`];
      for (const r of top) { lines.push(`\n--- ${r.path}:${r.startLine} (score: ${r.score.toFixed(3)}) ---`); lines.push(r.text); }
      return lines.join('\n');
    }

    case 'str_replace': {
      const filePath = args?.path || '';
      const oldStr: string = args?.old_string ?? args?.old ?? args?.search ?? '';
      const newStr: string = args?.new_string ?? args?.new ?? args?.replace ?? '';
      const replaceAll: boolean = args?.replace_all === true || args?.replaceAll === true;
      if (!filePath) return '(укажи "path" — путь к файлу)';
      if (oldStr === '') return '(укажи "old_string" — текст для замены; пустая строка не допускается)';
      if (oldStr === newStr) return '(old_string и new_string идентичны — замена не имеет смысла)';
      const uri = await resolveWorkspaceUri(filePath);
      if (!uri) return `Файл "${filePath}" не найден в workspace. Проверь путь или используй glob/find_files для поиска.`;
      try {
        const raw = await vscode.workspace.fs.readFile(uri);
        const text = decoder.decode(raw);

        const occurrences: number[] = [];
        let searchPos = 0;
        while (true) {
          const idx = text.indexOf(oldStr, searchPos);
          if (idx === -1) break;
          occurrences.push(idx);
          searchPos = idx + 1;
        }

        if (occurrences.length === 0) {
          const lines = text.split('\n');
          const trimmedOld = oldStr.trim();
          const fuzzyMatches: string[] = [];
          if (trimmedOld.length >= 3) {
            const probe = trimmedOld.slice(0, Math.min(40, trimmedOld.length));
            for (let i = 0; i < lines.length && fuzzyMatches.length < 5; i++) {
              if (lines[i].includes(probe)) {
                fuzzyMatches.push(`  L${i + 1}: ${lines[i].trimEnd().slice(0, 120)}`);
              }
            }
          }
          return (
            `Текст не найден в "${filePath}" (old_string: ${oldStr.length} символов).\n` +
            (fuzzyMatches.length
              ? `Похожие строки (по началу old_string):\n${fuzzyMatches.join('\n')}\n`
              : '') +
            'Убедись, что old_string точно совпадает с содержимым файла (включая пробелы, отступы, переносы строк).'
          );
        }

        if (occurrences.length > 1 && !replaceAll) {
          const lines = text.split('\n');
          const lineNums: number[] = occurrences.map(pos => text.slice(0, pos).split('\n').length);
          const preview = lineNums.slice(0, 6).map(ln => {
            const line = lines[ln - 1] || '';
            return `  L${ln}: ${line.trimEnd().slice(0, 120)}`;
          }).join('\n');
          return (
            `"old_string" найдена ${occurrences.length} раз в "${filePath}" (строки: ${lineNums.join(', ')}).\n` +
            `Вхождения:\n${preview}\n` +
            'Добавь больше окружающего контекста в old_string для уникальности, либо используй "replace_all": true для замены ВСЕХ вхождений.'
          );
        }

        const result = replaceAll ? text.split(oldStr).join(newStr) : text.replace(oldStr, newStr);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(result, 'utf-8'));

        const replaced = replaceAll ? occurrences.length : 1;
        const oldPreview = oldStr.length > 50 ? oldStr.slice(0, 50) + '…' : oldStr;
        const newPreview = newStr.length > 50 ? newStr.slice(0, 50) + '…' : newStr;

        const relPath = vscode.workspace.asRelativePath(uri, false);
        onEvent?.('file-change', `📝 ${relPath}`, {
          changeId: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filePath: relPath,
          changeType: 'edit',
          tool: 'str_replace',
          oldSnippet: truncate(oldStr, 800),
          newSnippet: truncate(newStr, 800),
          fullOldText: text,
          fullNewText: result
        });

        return (
          `✓ ${filePath}: заменено ${replaced} вхождение(й).` +
          (newStr
            ? ` "${oldPreview}" → "${newPreview}"`
            : ` Удалено "${oldPreview}"`) +
          (replaced > 1 ? ' (replace_all)' : '')
        );
      } catch (e: any) {
        return `Ошибка при редактировании "${filePath}": ${e?.message || e}`;
      }
    }

    case 'write_file': {
      const filePath = args?.path || '';
      const contents: string = args?.contents ?? args?.content ?? args?.text ?? '';
      if (!filePath) return '(укажи "path" — путь к файлу)';
      if (contents === undefined || contents === null) return '(укажи "contents" — содержимое файла)';
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) return '(workspace пуст — открой папку проекта)';
      const targetUri = vscode.Uri.joinPath(folders[0].uri, filePath);
      try {
        const parentUri = vscode.Uri.joinPath(targetUri, '..');
        try {
          await vscode.workspace.fs.stat(parentUri);
        } catch {
          await vscode.workspace.fs.createDirectory(parentUri);
        }

        let existed = false;
        let oldSize = 0;
        let oldText = '';
        try {
          const stat = await vscode.workspace.fs.stat(targetUri);
          existed = true;
          oldSize = stat.size;
          oldText = decoder.decode(await vscode.workspace.fs.readFile(targetUri));
        } catch { /* new file */ }

        const buf = Buffer.from(contents, 'utf-8');
        await vscode.workspace.fs.writeFile(targetUri, buf);

        const lineCount = contents.split('\n').length;
        const size = buf.length;

        onEvent?.('file-change', `📝 ${filePath}`, {
          changeId: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filePath,
          changeType: existed ? 'overwrite' : 'create',
          tool: 'write_file',
          oldSnippet: existed ? truncate(oldText, 600) : '',
          newSnippet: truncate(contents, 600),
          fullOldText: oldText,
          fullNewText: contents
        });

        if (existed) {
          return `✓ ${filePath}: перезаписан (${lineCount} строк, ${size} байт; было ${oldSize} байт)`;
        }
        return `✓ ${filePath}: создан (${lineCount} строк, ${size} байт)`;
      } catch (e: any) {
        return `Ошибка записи "${filePath}": ${e?.message || e}`;
      }
    }

    case 'delete_file': {
      const filePath = args?.path || '';
      if (!filePath) return '(укажи "path" — путь к файлу)';
      const uri = await resolveWorkspaceUri(filePath);
      if (!uri) return `Файл "${filePath}" не найден — возможно, уже удалён или путь неверный.`;
      try {
        let stat: vscode.FileStat;
        try {
          stat = await vscode.workspace.fs.stat(uri);
        } catch {
          return `Файл "${filePath}" не существует — удаление не требуется.`;
        }

        if (stat.type === vscode.FileType.Directory) {
          return `"${filePath}" — это директория, а не файл. Для удаления директорий используй shell.`;
        }

        let oldText = '';
        try { oldText = decoder.decode(await vscode.workspace.fs.readFile(uri)); } catch { /* binary or unreadable */ }

        await vscode.workspace.fs.delete(uri);

        const relPath = vscode.workspace.asRelativePath(uri, false);
        onEvent?.('file-change', `🗑 ${relPath}`, {
          changeId: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filePath: relPath,
          changeType: 'delete',
          tool: 'delete_file',
          oldSnippet: truncate(oldText, 600),
          newSnippet: '',
          fullOldText: oldText,
          fullNewText: ''
        });

        return `✓ ${filePath}: удалён (был ${stat.size} байт)`;
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (/permission|access|denied/i.test(msg)) {
          return `Ошибка: нет прав на удаление "${filePath}". Проверь разрешения файловой системы.`;
        }
        if (/security|reject/i.test(msg)) {
          return `Операция удаления "${filePath}" отклонена по соображениям безопасности.`;
        }
        return `Ошибка удаления "${filePath}": ${msg}`;
      }
    }

    case 'edit_notebook': {
      const notebookPath = args?.target_notebook || args?.path || args?.notebook || '';
      const cellIdx = typeof args?.cell_idx === 'number'
        ? args.cell_idx
        : (typeof args?.cell_index === 'number' ? args.cell_index : -1);
      const isNewCell = args?.is_new_cell === true || args?.new_cell === true;
      const cellLang: string = args?.cell_language || args?.language || args?.lang || 'python';
      const oldStr: string = args?.old_string ?? args?.old ?? '';
      const newStr: string = args?.new_string ?? args?.new ?? args?.content ?? '';

      if (!notebookPath) return '(укажи "target_notebook" — путь к .ipynb файлу)';
      if (cellIdx < 0) return '(укажи "cell_idx" — индекс ячейки, 0-based)';
      if (!isNewCell && oldStr === '') return '(для редактирования существующей ячейки укажи "old_string" — текст для замены)';
      if (newStr === undefined || newStr === null) return '(укажи "new_string" — новое содержимое или текст замены)';

      const VALID_LANGS = ['python', 'markdown', 'javascript', 'typescript', 'r', 'sql', 'shell', 'raw', 'other'];
      const normalizedLang = cellLang.toLowerCase();
      if (!VALID_LANGS.includes(normalizedLang)) {
        return `Некорректный cell_language: "${cellLang}". Допустимые: ${VALID_LANGS.join(', ')}`;
      }

      const uri = await resolveWorkspaceUri(notebookPath);
      if (!uri) return `Ноутбук "${notebookPath}" не найден в workspace.`;

      try {
        const raw = decoder.decode(await vscode.workspace.fs.readFile(uri));
        let notebook: any;
        try {
          notebook = JSON.parse(raw);
        } catch {
          return `"${notebookPath}" не является валидным JSON (ipynb). Проверь формат файла.`;
        }

        if (!notebook.cells || !Array.isArray(notebook.cells)) {
          return `"${notebookPath}" не содержит массив cells — невалидный формат ноутбука.`;
        }

        let cellType: string;
        switch (normalizedLang) {
          case 'markdown': cellType = 'markdown'; break;
          case 'raw': cellType = 'raw'; break;
          default: cellType = 'code'; break;
        }

        const toSourceLines = (s: string): string[] => {
          if (!s) return [''];
          const lines = s.split('\n');
          return lines.map((line: string, i: number) =>
            i < lines.length - 1 ? line + '\n' : line
          );
        };

        if (isNewCell) {
          const insertIdx = Math.min(cellIdx, notebook.cells.length);
          const newCell: any = {
            cell_type: cellType,
            metadata: {},
            source: toSourceLines(newStr)
          };

          if (cellType === 'code') {
            newCell.execution_count = null;
            newCell.outputs = [];
          }

          notebook.cells.splice(insertIdx, 0, newCell);

          const indent = notebook.cells.length > 1 ? 1 : 2;
          const newNotebookText = JSON.stringify(notebook, null, indent);
          await vscode.workspace.fs.writeFile(uri, Buffer.from(newNotebookText, 'utf-8'));

          const relNbPath = vscode.workspace.asRelativePath(uri, false);
          onEvent?.('file-change', `📝 ${relNbPath} [cell ${insertIdx}]`, {
            changeId: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            filePath: relNbPath,
            changeType: 'notebook-new-cell',
            tool: 'edit_notebook',
            cellIdx: insertIdx,
            oldSnippet: '',
            newSnippet: truncate(newStr, 800),
            fullOldText: raw,
            fullNewText: newNotebookText
          });

          const lineCount = newStr.split('\n').length;
          return `✓ ${notebookPath}: создана новая ${cellType}-ячейка [${normalizedLang}] на позиции ${insertIdx} (${lineCount} строк). Всего ячеек: ${notebook.cells.length}`;
        }

        if (cellIdx >= notebook.cells.length) {
          return (
            `Ячейка ${cellIdx} не существует в "${notebookPath}" — ` +
            `в ноутбуке ${notebook.cells.length} ячеек (индексы: 0–${notebook.cells.length - 1}).`
          );
        }

        const cell = notebook.cells[cellIdx];
        const cellSource = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');

        if (oldStr === '' && newStr === '') {
          cell.source = [''];
          const indent = notebook.cells.length > 1 ? 1 : 2;
          const newNotebookText = JSON.stringify(notebook, null, indent);
          await vscode.workspace.fs.writeFile(uri, Buffer.from(newNotebookText, 'utf-8'));
          const relNbPath = vscode.workspace.asRelativePath(uri, false);
          onEvent?.('file-change', `📝 ${relNbPath} [cell ${cellIdx}]`, {
            changeId: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            filePath: relNbPath,
            changeType: 'notebook-edit-cell',
            tool: 'edit_notebook',
            cellIdx,
            oldSnippet: truncate(cellSource, 600),
            newSnippet: '',
            fullOldText: raw,
            fullNewText: newNotebookText
          });
          return `✓ ${notebookPath}: ячейка ${cellIdx} очищена.`;
        }

        const count = cellSource.split(oldStr).length - 1;

        if (count === 0) {
          const preview = cellSource.slice(0, 300);
          const totalLines = cellSource.split('\n').length;
          return (
            `"old_string" не найдена в ячейке ${cellIdx} (${cell.cell_type}, ${totalLines} строк).\n` +
            `Содержимое ячейки (начало):\n${preview}${cellSource.length > 300 ? '…' : ''}\n\n` +
            'Убедись, что old_string точно совпадает с текстом ячейки (включая пробелы, отступы). ' +
            'Включай 3-5 строк контекста до и после точки замены.'
          );
        }

        if (count > 1) {
          const cellLines = cellSource.split('\n');
          const lineNums: number[] = [];
          let sp = 0;
          for (let occ = 0; occ < count; occ++) {
            const idx = cellSource.indexOf(oldStr, sp);
            if (idx === -1) break;
            lineNums.push(cellSource.slice(0, idx).split('\n').length);
            sp = idx + 1;
          }
          const preview = lineNums.slice(0, 5).map(ln => {
            const line = cellLines[ln - 1] || '';
            return `  строка ${ln}: ${line.trimEnd().slice(0, 120)}`;
          }).join('\n');
          return (
            `"old_string" найдена ${count} раз в ячейке ${cellIdx} (строки в ячейке: ${lineNums.join(', ')}).\n` +
            `Вхождения:\n${preview}\n` +
            'Одна замена за вызов. Добавь 3-5 строк контекста до и после для уникальной идентификации конкретного вхождения.'
          );
        }

        const newSource = cellSource.replace(oldStr, newStr);
        cell.source = toSourceLines(newSource);

        const indent = notebook.cells.length > 1 ? 1 : 2;
        const newNotebookText = JSON.stringify(notebook, null, indent);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(newNotebookText, 'utf-8'));

        const relNbPath = vscode.workspace.asRelativePath(uri, false);
        onEvent?.('file-change', `📝 ${relNbPath} [cell ${cellIdx}]`, {
          changeId: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filePath: relNbPath,
          changeType: 'notebook-edit-cell',
          tool: 'edit_notebook',
          cellIdx,
          oldSnippet: truncate(oldStr, 800),
          newSnippet: truncate(newStr, 800),
          fullOldText: raw,
          fullNewText: newNotebookText
        });

        const oldPreview = oldStr.length > 60 ? oldStr.slice(0, 60) + '…' : oldStr;
        const newPreview = newStr.length > 60 ? newStr.slice(0, 60) + '…' : newStr;
        return (
          `✓ ${notebookPath}: ячейка ${cellIdx} [${cell.cell_type}] отредактирована.` +
          (newStr ? ` "${oldPreview}" → "${newPreview}"` : ` Удалено "${oldPreview}"`)
        );
      } catch (e: any) {
        return `Ошибка редактирования ноутбука "${notebookPath}": ${e?.message || e}`;
      }
    }

    case 'web_search': {
      const sq = args?.query || args?.search_term || '';
      if (!sq) return '(укажи "query")';
      try {
        const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(sq)}`;
        const resp = await fetch(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VSCode-AI-Assistant/1.0)' },
          signal: AbortSignal.timeout(10_000)
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const html = await resp.text();
        const results: string[] = [];
        const linkRe = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRe = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
        const links: { url: string; title: string }[] = [];
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(html)) !== null) {
          links.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').trim() });
        }
        const snippets: string[] = [];
        while ((m = snippetRe.exec(html)) !== null) {
          snippets.push(m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim());
        }
        for (let i = 0; i < Math.min(links.length, 8); i++) {
          results.push(`${i + 1}. **${links[i].title}**\n   ${links[i].url}${snippets[i] ? `\n   ${snippets[i]}` : ''}`);
        }
        if (results.length === 0) {
          const cfg = readConfig();
          if (cfg.apiBaseUrl && cfg.apiKey && cfg.model) {
            const r = await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, [
              { role: 'system', content: 'Кратко ответь на вопрос. Markdown.' }, { role: 'user', content: sq }
            ], { temperature: 0.3 });
            return `web_search "${sq}" (через LLM):\n\n${r}`;
          }
          return `Нет результатов по "${sq}".`;
        }
        return `web_search "${sq}" (${results.length} результатов):\n\n${results.join('\n\n')}`;
      } catch (e: any) {
        const cfg = readConfig();
        if (cfg.apiBaseUrl && cfg.apiKey && cfg.model) {
          try {
            const r = await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, [
              { role: 'system', content: 'Кратко ответь на вопрос. Markdown.' }, { role: 'user', content: sq }
            ], { temperature: 0.3 });
            return `web_search "${sq}" (через LLM, DuckDuckGo недоступен):\n\n${r}`;
          } catch { /* fall through */ }
        }
        return `Ошибка поиска: ${e?.message || e}`;
      }
    }

    case 'web_fetch': {
      const url = args?.url || '';
      if (!url) return '(укажи "url")';
      if (!/^https?:\/\//i.test(url)) return `Некорректный URL: "${url}"`;
      try {
        const resp = await fetch(url, { headers: { 'User-Agent': 'VSCode-AI-Assistant/1.0' }, signal: AbortSignal.timeout(15000) });
        if (!resp.ok) return `HTTP ${resp.status} — "${url}"`;
        if ((resp.headers.get('content-type') || '').includes('json')) return truncate(JSON.stringify(await resp.json(), null, 2));
        const text = (await resp.text()).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '').replace(/<[^>]+>/g, '\n')
          .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
          .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
        return truncate(text);
      } catch (e: any) { return `Ошибка: ${e?.message || e}`; }
    }

    case 'shell': {
      const cmd = args?.command || args?.cmd || '';
      if (!cmd) return '(укажи "command")';
      if (/[\r\n]/.test(cmd)) return 'Команда отклонена: многострочные команды запрещены.';
      const BLOCKED = [
        /\brm\s+-rf\s+[\/~]/i,
        /\bdd\s+if=/i,
        /\bmkfs\b/i,
        /\bsudo\b/i,
        /\bchmod\s+777/i,
        /\bcurl\b.*\|\s*(ba)?sh/i,
        /\bgit\s+push\b.*--force(?:-with-lease)?\b/i,
        /\bshutdown\b/i,
        /\breboot\b/i,
        /:\(\)\s*\{\s*:\|\:&\s*\};:/ // fork bomb
      ];
      if (BLOCKED.some(p => p.test(cmd))) return `Команда заблокирована: "${cmd}"`;
      const cwd = args?.cwd || args?.working_directory || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      let finalCmd = cmd;
      if (onEvent) {
        const confirmId = `sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const result = await onEvent('shell-confirm', `🔒 Подтвердите: ${cmd}`, { confirmId, command: cmd, cwd });
        if (!result || (typeof result === 'object' && !result.approved)) return `Команда отклонена пользователем: "${cmd}"`;
        if (typeof result === 'object' && result.command) finalCmd = result.command;
        if (BLOCKED.some(p => p.test(finalCmd))) return `Команда заблокирована: "${finalCmd}"`;
      }

      try {
        const { exec } = require('child_process');
        const r: string = await new Promise((res, rej) => {
          const p = exec(finalCmd, { cwd, timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, LANG: 'en_US.UTF-8' } },
            (e: any, out: string, err: string) => { if (e && !out && !err) rej(new Error(e.message)); else res((out || '') + (err ? `\n[stderr]:\n${err}` : '') || '(пусто)'); });
          p.on('error', (e: any) => rej(e));
        });
        return `$ ${finalCmd}\n\n${truncate(r)}`;
      } catch (e: any) { return `Ошибка: ${e?.message || e}`; }
    }

    // Aliases
    case 'list_directory': case 'list_dir': case 'ls':
      return executeTool('list_files', args, query, onEvent);
    case 'search_symbol': case 'search_symbols': case 'find_symbol': case 'find_symbols':
      return executeTool('workspace_symbols', { query: args?.symbol || args?.query || args?.name || '' }, query, onEvent);
    case 'search': case 'search_files': case 'find':
      return executeTool(args?.pattern && !args?.path ? 'find_files' : 'grep', args, query, onEvent);
    case 'glob_search':
      return executeTool('glob', args, query, onEvent);
    case 'read': case 'cat': case 'open_file': case 'view_file':
      return executeTool('read_file', args, query, onEvent);
    case 'search_code': case 'semantic': case 'embeddings_search':
      return executeTool('semantic_search', args, query, onEvent);
    case 'lints': case 'lint': case 'diagnostics':
      return executeTool('read_lints', args, query, onEvent);
    case 'delegate': case 'delegate_agent': case 'mini_agent':
      return executeTool('subagent', args, query, onEvent);
    case 'run': case 'exec': case 'execute': case 'bash': case 'terminal': case 'cmd':
      return executeTool('shell', args, query, onEvent);
    case 'fetch': case 'fetch_url': case 'download': case 'curl':
      return executeTool('web_fetch', args, query, onEvent);
    case 'edit': case 'replace': case 'edit_file': case 'patch':
      return executeTool('str_replace', args, query, onEvent);
    case 'create_file': case 'write': case 'save_file':
      return executeTool('write_file', args, query, onEvent);
    case 'remove': case 'rm': case 'unlink':
      return executeTool('delete_file', args, query, onEvent);
    case 'notebook_edit': case 'edit_cell': case 'notebook_cell': case 'edit_ipynb':
      return executeTool('edit_notebook', args, query, onEvent);
    case 'google': case 'search_web': case 'bing': case 'duckduckgo':
      return executeTool('web_search', args, query, onEvent);

    default:
      return `Неизвестная утилита "${toolName}". Доступные: scan_structure, list_files, glob, find_files, detect_stack, grep, read_file, read_file_range, extract_symbols, workspace_symbols, dependencies, read_lints, get_diagnostics, semantic_search, web_search, web_fetch, shell, str_replace, write_file, delete_file, edit_notebook, subagent, final_answer.`;
  }
}
