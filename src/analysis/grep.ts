import * as vscode from 'vscode';
import { GrepMatch } from '../core/types';
import { IGNORE_PATTERN, SEARCHABLE_EXTENSIONS, MAX_FILE_SIZE } from '../core/constants';
import { decoder, escapeRegExp } from '../core/utils';

export interface GrepOptions {
  maxResults?: number;
  contextLines?: number;
  linesAfter?: number;
  linesBefore?: number;
  fileGlob?: string;
  multiline?: boolean;
  offset?: number;
}

export async function grepWorkspace(pattern: string | RegExp, options: GrepOptions = {}): Promise<GrepMatch[]> {
  const { maxResults = 80, contextLines: ctxLines, linesAfter: la, linesBefore: lb, fileGlob, multiline = false, offset = 0 } = options;
  const contextBefore = lb ?? ctxLines ?? 2;
  const contextAfter = la ?? ctxLines ?? 2;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return [];

  const flags = pattern instanceof RegExp
    ? pattern.flags + (pattern.flags.includes('g') ? '' : 'g')
    : 'gi';
  const mFlags = multiline ? flags.replace('g', 'gms') : flags;
  let regex: RegExp;
  if (pattern instanceof RegExp) {
    regex = new RegExp(pattern.source, mFlags);
  } else {
    try { regex = new RegExp(pattern, mFlags); }
    catch { regex = new RegExp(escapeRegExp(pattern), mFlags); }
  }

  const results: GrepMatch[] = [];
  let skipped = 0;
  const needed = maxResults + offset;

  for (const folder of folders) {
    if (results.length >= maxResults) break;
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, fileGlob || SEARCHABLE_EXTENSIONS), IGNORE_PATTERN, 2000
    );
    for (const uri of files) {
      if (results.length >= maxResults) break;
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const text = decoder.decode(data);
        if (text.length > MAX_FILE_SIZE) continue;
        const rel = vscode.workspace.asRelativePath(uri, false);
        if (multiline) {
          let m: RegExpExecArray | null;
          regex.lastIndex = 0;
          while ((m = regex.exec(text)) !== null && skipped + results.length < needed) {
            const lineNum = text.slice(0, m.index).split('\n').length;
            const lines = text.split('\n');
            const startCtx = Math.max(0, lineNum - 1 - contextBefore);
            const endCtx = Math.min(lines.length - 1, lineNum - 1 + m[0].split('\n').length + contextAfter);
            if (skipped < offset) { skipped++; continue; }
            results.push({ file: rel, line: lineNum, matchedLine: m[0].split('\n')[0], context: lines.slice(startCtx, endCtx + 1).join('\n'), contextStartLine: startCtx + 1 });
            if (results.length >= maxResults) break;
          }
        } else {
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;
            regex.lastIndex = 0;
            if (!regex.test(lines[i])) continue;
            if (skipped < offset) { skipped++; continue; }
            const s = Math.max(0, i - contextBefore);
            const e = Math.min(lines.length - 1, i + contextAfter);
            results.push({ file: rel, line: i + 1, matchedLine: lines[i], context: lines.slice(s, e + 1).join('\n'), contextStartLine: s + 1 });
          }
        }
      } catch { /* skip */ }
    }
  }
  return results;
}
