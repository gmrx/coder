import { TextDecoder } from 'util';
import { ChatMessage } from './types';
import { MAX_TOOL_RESULT_CHARS, MAX_CONTEXT_CHARS } from './constants';

export const decoder = new TextDecoder('utf-8');

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function truncate(text: string, max = MAX_TOOL_RESULT_CHARS, suffix = '\n... (усечено)'): string {
  return text.length > max ? text.slice(0, max) + suffix : text;
}

export function isConfigValid(cfg: { apiBaseUrl: string; apiKey: string; model: string }): boolean {
  return !!(cfg.apiBaseUrl && cfg.apiKey && cfg.model);
}

export function smartReadFile(text: string, filePath: string, query?: string): string {
  const lines = text.split('\n');
  const totalLines = lines.length;

  if (text.length <= MAX_TOOL_RESULT_CHARS) {
    return `${filePath} (${totalLines} строк):\n\n${lines.map((l, i) => `${i + 1}| ${l}`).join('\n')}`;
  }

  const includedLines = new Set<number>();

  for (let i = 0; i < Math.min(totalLines, 50); i++) {
    const t = lines[i].trim();
    if (
      t === '' || t.startsWith('import ') || t.startsWith('from ') ||
      t.startsWith('require') || t.startsWith('using ') ||
      t.startsWith('package ') || t.startsWith('#!') ||
      t.startsWith('//') || t.startsWith('#') ||
      t.startsWith('/*') || t.startsWith('*') ||
      t.startsWith('"""') || t.startsWith("'''")
    ) {
      includedLines.add(i);
    } else {
      break;
    }
  }

  const sigRe = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|interface|type|enum|const|def |func |struct |pub fn |pub struct |@app\.|@router\.)\s*\w+/;
  const decoratorRe = /^\s*@\w+/;
  for (let i = 0; i < totalLines; i++) {
    const t = lines[i].trimStart();
    if (sigRe.test(t) || (decoratorRe.test(t) && i + 1 < totalLines && /def |class /.test(lines[i + 1]))) {
      for (let j = Math.max(0, i - 1); j <= Math.min(totalLines - 1, i + 2); j++) includedLines.add(j);
    }
  }

  if (query) {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3).slice(0, 6);
    if (terms.length > 0) {
      for (let i = 0; i < totalLines; i++) {
        const lower = lines[i].toLowerCase();
        if (terms.some(term => lower.includes(term))) {
          for (let j = Math.max(0, i - 1); j <= Math.min(totalLines - 1, i + 1); j++) includedLines.add(j);
        }
      }
    }
  }

  for (let i = Math.max(0, totalLines - 8); i < totalLines; i++) {
    if (lines[i].trim().length > 0) includedLines.add(i);
  }

  const sorted = Array.from(includedLines).sort((a, b) => a - b);
  const parts: string[] = [];
  let lastIdx = -2, outputLen = 0;
  const budget = 10000;

  for (const idx of sorted) {
    if (outputLen > budget) break;
    if (idx > lastIdx + 1) parts.push(`   ... (${idx - lastIdx - 1} строк пропущено) ...`);
    const line = `${idx + 1}| ${lines[idx]}`;
    parts.push(line);
    outputLen += line.length + 1;
    lastIdx = idx;
  }

  return `${filePath} (${totalLines} строк, показано ${sorted.length} ключевых с номерами):\n\n${parts.join('\n')}\n\n[Используй read_file_range для детального чтения конкретных строк]`;
}

export function buildFileTree(files: string[], maxLines = 300): string {
  const root: Record<string, any> = {};
  for (const file of files) {
    let node = root;
    for (const part of file.split(/[\\/]/)) {
      if (!node[part]) node[part] = {};
      node = node[part];
    }
  }
  const lines: string[] = [];
  let count = 0;
  function walk(node: Record<string, any>, prefix: string) {
    const entries = Object.keys(node).sort((a, b) => {
      const aDir = Object.keys(node[a]).length > 0;
      const bDir = Object.keys(node[b]).length > 0;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });
    for (let i = 0; i < entries.length; i++) {
      if (count >= maxLines) { lines.push(prefix + '... (усечено)'); return; }
      const name = entries[i];
      const isLast = i === entries.length - 1;
      const kids = Object.keys(node[name]);
      lines.push(prefix + (isLast ? '└── ' : '├── ') + name + (kids.length > 0 ? '/' : ''));
      count++;
      if (kids.length > 0) walk(node[name], prefix + (isLast ? '    ' : '│   '));
    }
  }
  walk(root, '');
  return lines.join('\n');
}

export function trimContext(messages: ChatMessage[]): void {
  let total = 0;
  for (const m of messages) total += m.content.length;
  if (total <= MAX_CONTEXT_CHARS) return;

  const target = MAX_CONTEXT_CHARS * 0.8;
  for (let i = 1; i < messages.length - 6 && total > target; i++) {
    const msg = messages[i];
    if (msg.role === 'user' && (msg.content.startsWith('[Результат') || msg.content.startsWith('[Авто-контекст'))) {
      if (msg.content.length > 400) {
        const oldLen = msg.content.length;
        const toolName = msg.content.match(/\[(?:Результат|Авто-контекст)\s*(\w+)/)?.[1] || '';
        messages[i] = { role: 'user', content: msg.content.slice(0, 300) + `\n... (результат ${toolName} усечён)` };
        total -= oldLen - messages[i].content.length;
      }
    }
  }
}
