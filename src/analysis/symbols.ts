import * as vscode from 'vscode';
import { FileSymbolOutline, ImportInfo, DependencyEdge } from '../core/types';
import { decoder } from '../core/utils';

const MAX_SYMBOLS_PER_FILE = 60;

export async function extractDocumentSymbols(uri: vscode.Uri): Promise<FileSymbolOutline> {
  const rel = vscode.workspace.asRelativePath(uri, false);
  try {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri);
    if (symbols && symbols.length > 0) {
      return { file: rel, symbols: flattenSymbols(symbols, undefined, 0).slice(0, MAX_SYMBOLS_PER_FILE) };
    }
  } catch { /* provider not available */ }
  return { file: rel, symbols: await extractSymbolsWithRegex(uri) };
}

function flattenSymbols(
  symbols: vscode.DocumentSymbol[], parentName: string | undefined, depth: number
): { name: string; kind: string; line: number; detail?: string }[] {
  if (depth > 2) return [];
  const importantKinds = new Set([
    vscode.SymbolKind.Class, vscode.SymbolKind.Interface, vscode.SymbolKind.Function,
    vscode.SymbolKind.Method, vscode.SymbolKind.Enum, vscode.SymbolKind.Struct,
    vscode.SymbolKind.TypeParameter, vscode.SymbolKind.Constructor,
    vscode.SymbolKind.Module, vscode.SymbolKind.Namespace,
  ]);
  const result: { name: string; kind: string; line: number; detail?: string }[] = [];
  for (const sym of symbols) {
    if (depth > 0 && !importantKinds.has(sym.kind)) continue;
    if (depth === 0 && sym.kind === vscode.SymbolKind.Variable) continue;
    const prefix = parentName ? `${parentName}.` : '';
    result.push({ name: prefix + sym.name, kind: vscode.SymbolKind[sym.kind] || 'Unknown', line: sym.range.start.line + 1, detail: sym.detail || undefined });
    if (sym.children?.length && depth < 2) result.push(...flattenSymbols(sym.children, prefix + sym.name, depth + 1));
  }
  return result;
}

async function extractSymbolsWithRegex(uri: vscode.Uri): Promise<{ name: string; kind: string; line: number; detail?: string }[]> {
  const results: { name: string; kind: string; line: number; detail?: string }[] = [];
  try {
    const lines = decoder.decode(await vscode.workspace.fs.readFile(uri)).split('\n');
    const patterns: { re: RegExp; kind: string }[] = [
      { re: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: 'Class' },
      { re: /^(?:export\s+)?interface\s+(\w+)/, kind: 'Interface' },
      { re: /^(?:export\s+)?type\s+(\w+)\s*[=<]/, kind: 'TypeAlias' },
      { re: /^(?:export\s+)?enum\s+(\w+)/, kind: 'Enum' },
      { re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: 'Function' },
      { re: /^(?:export\s+)(?:const|let)\s+(\w+)\s*=/, kind: 'Variable' },
      { re: /^def\s+(\w+)\s*\(/, kind: 'Function' },
      { re: /^class\s+(\w+)/, kind: 'Class' },
      { re: /^func\s+(\w+)/, kind: 'Function' },
      { re: /^type\s+(\w+)\s+struct/, kind: 'Struct' },
      { re: /^\s{2,4}(?:async\s+)?def\s+(\w+)\s*\(/, kind: 'Method' },
    ];
    for (let i = 0; i < lines.length; i++) {
      for (const { re, kind } of patterns) {
        const m = re.exec(lines[i]);
        if (m && m[1] !== '_' && !m[1].startsWith('__')) { results.push({ name: m[1], kind, line: i + 1 }); break; }
      }
    }
  } catch { /* skip */ }
  return results.slice(0, MAX_SYMBOLS_PER_FILE);
}

async function extractImports(uri: vscode.Uri): Promise<ImportInfo[]> {
  const results: ImportInfo[] = [];
  try {
    const lines = decoder.decode(await vscode.workspace.fs.readFile(uri)).split('\n');
    const rel = vscode.workspace.asRelativePath(uri, false);
    const patterns: { re: RegExp; getTarget: (m: RegExpExecArray) => string; checkRelative?: (t: string) => boolean }[] = [
      { re: /import\s+.*?\s+from\s+['"]([^'"]+)['"]/, getTarget: m => m[1] },
      { re: /import\s+['"]([^'"]+)['"]/, getTarget: m => m[1] },
      { re: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/, getTarget: m => m[1] },
      { re: /^from\s+(\.[\w.]*)\s+import/, getTarget: m => m[1], checkRelative: () => true },
      { re: /^from\s+([\w.]+)\s+import/, getTarget: m => m[1], checkRelative: t => !t.includes('.') || t.split('.').length <= 2 },
      { re: /^import\s+([\w.]+)/, getTarget: m => m[1] },
    ];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
      for (const { re, getTarget, checkRelative } of patterns) {
        const m = re.exec(trimmed);
        if (m) { results.push({ source: rel, target: getTarget(m), isRelative: checkRelative ? checkRelative(getTarget(m)) : (getTarget(m).startsWith('.') || getTarget(m).startsWith('/')) }); break; }
      }
    }
  } catch { /* skip */ }
  return results;
}

export async function buildDependencyGraph(fileUris: vscode.Uri[]): Promise<DependencyEdge[]> {
  const edges: DependencyEdge[] = [];
  const projectFiles = new Set(fileUris.map(u => vscode.workspace.asRelativePath(u, false)));
  const basenameToPath = new Map<string, string>();
  for (const f of projectFiles) {
    const parts = f.split(/[\\/]/);
    basenameToPath.set(parts[parts.length - 1].replace(/\.[^.]+$/, ''), f);
    if (parts.length >= 2) basenameToPath.set(parts[parts.length - 2] + '/' + parts[parts.length - 1].replace(/\.[^.]+$/, ''), f);
  }
  const seen = new Set<string>();
  for (const uri of fileUris) {
    const imports = await extractImports(uri);
    const source = vscode.workspace.asRelativePath(uri, false);
    for (const imp of imports) {
      let resolved: string | null = null;
      if (imp.target.startsWith('.') || imp.target.startsWith('/')) {
        resolved = resolveRelativeImport(source, imp.target, projectFiles);
      } else {
        resolved = basenameToPath.get(imp.target.split('.')[0]) || null;
      }
      if (resolved && resolved !== source) {
        const key = `${source}→${resolved}`;
        if (!seen.has(key)) { seen.add(key); edges.push({ from: source, to: resolved }); }
      }
    }
  }
  return edges;
}

function resolveRelativeImport(fromFile: string, target: string, projectFiles: Set<string>): string | null {
  const dir = fromFile.replace(/[/\\][^/\\]+$/, '');
  const resolved: string[] = [];
  for (const p of (dir + '/' + target).split('/')) {
    if (p === '.' || p === '') continue;
    if (p === '..') resolved.pop(); else resolved.push(p);
  }
  const base = resolved.join('/');
  if (projectFiles.has(base)) return base;
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']) { if (projectFiles.has(base + ext)) return base + ext; }
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) { if (projectFiles.has(base + '/index' + ext)) return base + '/index' + ext; }
  if (projectFiles.has(base + '/__init__.py')) return base + '/__init__.py';
  return null;
}

export function formatSymbolOutline(outline: FileSymbolOutline): string {
  if (outline.symbols.length === 0) return `${outline.file}: (символы не найдены)`;
  const lines = [`${outline.file}:`];
  for (const sym of outline.symbols) lines.push(`  L${sym.line} [${sym.kind}] ${sym.name}${sym.detail ? ` — ${sym.detail}` : ''}`);
  return lines.join('\n');
}
