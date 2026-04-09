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

function getSubagentCount(usedCalls: Set<string>): number {
  let n = 0;
  for (const key of usedCalls) {
    if (key.startsWith('subagent:')) n++;
  }
  return n;
}

function getReadRangeMaxPerFile(usedCalls: Set<string>): number {
  const counts = new Map<string, number>();
  for (const key of usedCalls) {
    if (!key.startsWith('read_file_range:')) continue;
    try {
      const raw = key.slice('read_file_range:'.length);
      const a = JSON.parse(raw);
      const p = typeof a?.path === 'string' ? a.path : '';
      if (!p) continue;
      counts.set(p, (counts.get(p) || 0) + 1);
    } catch { /* skip */ }
  }
  let max = 0;
  for (const v of counts.values()) max = Math.max(max, v);
  return max;
}

export function checkMonotony(usedCalls: Set<string>, modelUsedTools?: Set<string>): string | null {
  const toolCounts = new Map<string, number>();
  for (const key of usedCalls) {
    const tool = key.split(':')[0];
    toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
  }
  const modelTools = modelUsedTools || new Set(toolCounts.keys());
  const readCount = (toolCounts.get('read_file') || 0) + (toolCounts.get('read_file_range') || 0);
  const topDirs = getReadTopDirs(usedCalls);
  const totalCalls = usedCalls.size;
  const subagentCalls = getSubagentCount(usedCalls);
  const maxRangeReadsOnOneFile = getReadRangeMaxPerFile(usedCalls);

  if (readCount >= 10 && topDirs.length <= 1) {
    return '[Система] Похоже, анализ ушёл слишком глубоко в один участок. Проверь, добавляет ли следующий шаг новые факты для цели пользователя.';
  }
  if (!modelTools.has('subagent') && topDirs.length >= 2 && readCount >= 8) {
    return '[Система] Видно несколько независимых областей. Оркестрируй анализ через subagent tasks[] и parallel:true, затем синтезируй общий вывод.';
  }
  if (!modelTools.has('subagent') && totalCalls >= 20) {
    return '[Система] Основной агент делает слишком длинную линейную серию действий. Разбей оставшуюся работу на подзадачи и делегируй в subagent (tasks[]).';
  }
  if (subagentCalls === 1 && totalCalls >= 24 && topDirs.length >= 3) {
    return '[Система] Был только один запуск subagent. Если есть пробелы по архитектуре/безопасности/инфраструктуре, запусти вторую волну subagent (tasks[] + parallel:true) для закрытия пробелов, затем синтезируй итог.';
  }
  if (subagentCalls >= 2 && totalCalls >= 14) {
    return '[Система] Уже выполнено несколько волн subagent. Новые subagent запускай только при действительно критичных пробелах; иначе переходи к синтезу и final_answer.';
  }
  if (subagentCalls >= 1 && maxRangeReadsOnOneFile >= 5) {
    return '[Система] Ты многократно читаешь диапазоны одного и того же файла. Проверь, есть ли ещё критичные пробелы; если нет — переходи к синтезу и final_answer.';
  }
  if (modelTools.has('subagent') && totalCalls >= 30 && readCount >= 18 && topDirs.length >= 2) {
    return '[Система] После subagent не запускай новый полный обход файлов. Синтезируй результаты, добери только критические пробелы и переходи к final_answer.';
  }
  return null;
}
