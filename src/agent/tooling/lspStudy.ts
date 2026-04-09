import * as vscode from 'vscode';
import { formatSymbolOutline } from '../../analysis/symbols';
import type { FileSymbolOutline } from '../../core/types';
import type { StructuredPresentationSection } from './presentationItems';

type LspLocation = vscode.Location | vscode.LocationLink;

export type LspPagination = {
  limit: number;
  offset: number;
};

export interface LspInspectPresentation {
  operation: string;
  resultCount: number;
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  sections?: StructuredPresentationSection[];
}

type LspLocationPreviewItem = {
  path: string;
  line: number;
  character: number;
  snippet?: string;
};

type LspSymbolPreviewItem = {
  name: string;
  kind?: string;
  path?: string;
  line?: number;
  character?: number;
  containerName?: string;
  detail?: string;
};

type LspCallPreviewItem = {
  name: string;
  path: string;
  line: number;
  character: number;
  detail?: string;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 80;

export function normalizeLspPagination(args: any): LspPagination {
  const limit = parsePositiveInt(args?.limit, DEFAULT_LIMIT);
  const offset = parseNonNegativeInt(args?.offset, 0);
  return {
    limit: Math.min(MAX_LIMIT, limit),
    offset,
  };
}

export async function formatPagedLocationResult(
  title: string,
  locations: readonly LspLocation[] | undefined,
  pagination: LspPagination,
  nextCallArgs: Record<string, unknown>,
): Promise<string> {
  const items = locations || [];
  if (items.length === 0) {
    return `${title} не найдены.`;
  }

  const page = paginate(items, pagination);
  const lines = [
    `${title}: показаны ${page.items.length} из ${items.length}${pagination.offset ? ` (offset: ${pagination.offset})` : ''}`,
  ];

  for (const location of page.items) {
    const uri = getLocationUri(location);
    const range = getLocationRange(location);
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const snippet = await readLineSnippet(uri, range.start.line);
    lines.push(`  ${relativePath}:${range.start.line + 1}:${range.start.character + 1}${snippet ? ` — ${snippet}` : ''}`);
  }

  const first = page.items[0];
  if (first) {
    const uri = getLocationUri(first);
    const range = getLocationRange(first);
    lines.push('');
    lines.push('Следующие удобные шаги:');
    lines.push(
      `- открыть участок вокруг первого результата: ${buildToolCall('read_file_range', {
        path: vscode.workspace.asRelativePath(uri, false),
        startLine: Math.max(1, range.start.line + 1 - 8),
        endLine: range.start.line + 1 + 24,
      })}`,
    );
  }

  if (page.hasMore) {
    lines.push(
      `- продолжить LSP-выдачу: ${buildToolCall('lsp_inspect', {
        ...nextCallArgs,
        offset: pagination.offset + pagination.limit,
        limit: pagination.limit,
      })}`,
    );
  }

  return lines.join('\n');
}

export function buildLspLocationPresentation(options: {
  operation: 'definition' | 'references' | 'implementation';
  title: string;
  count: number;
  pagination: LspPagination;
  content?: string;
  nextStep?: string;
  items?: LspLocationPreviewItem[];
}): LspInspectPresentation {
  return {
    operation: options.operation,
    resultCount: options.count,
    summary: options.count === 0
      ? `${options.title} не найдены`
      : options.operation === 'definition'
        ? 'Нашёл определение'
        : options.operation === 'implementation'
          ? 'Нашёл реализации'
          : 'Нашёл ссылки на символ',
    detail: [
      `${options.count} результатов`,
      options.pagination.offset > 0 ? `offset ${options.pagination.offset}` : '',
      options.operation,
    ].filter(Boolean).join(' • '),
    ...(options.content && options.content.length <= 4000 ? { preview: options.content } : {}),
    ...(options.nextStep ? { nextStep: options.nextStep } : {}),
    ...(options.items && options.items.length > 0
      ? {
        sections: [{
          title: options.title,
          items: options.items.slice(0, 6).map((item) => ({
            title: `${item.path}:L${item.line}:${item.character}`,
            subtitle: item.snippet || '',
          })),
        }],
      }
      : {}),
  };
}

export function buildLspDocumentSymbolsPresentation(
  outline: FileSymbolOutline,
  pagination: LspPagination,
  content?: string,
): LspInspectPresentation {
  const first = outline.symbols[0];
  const page = outline.symbols.slice(pagination.offset, pagination.offset + Math.min(pagination.limit, 6));
  return {
    operation: 'document_symbols',
    resultCount: outline.symbols.length,
    summary: outline.symbols.length === 0 ? 'Символы не найдены' : 'Подготовил список символов через LSP',
    detail: [
      outline.file,
      `${outline.symbols.length} символов`,
      pagination.offset > 0 ? `offset ${pagination.offset}` : '',
      'document_symbols',
    ].filter(Boolean).join(' • '),
    ...(content && content.length <= 4000 ? { preview: content } : {}),
    ...(first
      ? { nextStep: `Открой участок вокруг первого символа: ${buildToolCall('read_file_range', { path: outline.file, startLine: Math.max(1, first.line - 6), endLine: first.line + 24 })}` }
      : {}),
    ...(page.length > 0
      ? {
        sections: [{
          title: 'Символы',
          items: page.map((symbol) => ({
            title: symbol.name,
            subtitle: `${symbol.kind} • L${symbol.line}`,
            meta: symbol.detail || '',
          })),
        }],
      }
      : {}),
  };
}

export function buildLspWorkspaceSymbolsPresentation(
  query: string,
  count: number,
  pagination: LspPagination,
  content?: string,
  nextStep?: string,
  items?: LspSymbolPreviewItem[],
): LspInspectPresentation {
  return {
    operation: 'workspace_symbols',
    resultCount: count,
    summary: count === 0 ? 'Символы не найдены' : 'Нашёл символы через LSP',
    detail: [
      `"${query}"`,
      `${count} символов`,
      pagination.offset > 0 ? `offset ${pagination.offset}` : '',
      'workspace_symbols',
    ].filter(Boolean).join(' • '),
    ...(content && content.length <= 4000 ? { preview: content } : {}),
    ...(nextStep ? { nextStep } : {}),
    ...(items && items.length > 0
      ? {
        sections: [{
          title: 'Символы',
          items: items.slice(0, 6).map((item) => ({
            title: item.name,
            subtitle: `${item.kind || 'symbol'} • ${item.path || ''}${item.line ? `:L${item.line}` : ''}`,
            meta: [item.containerName, item.detail].filter(Boolean).join(' • '),
          })),
        }],
      }
      : {}),
  };
}

export function buildLspHoverPresentation(
  count: number,
  content?: string,
): LspInspectPresentation {
  return {
    operation: 'hover',
    resultCount: count,
    summary: count === 0 ? 'Hover-информация не найдена' : 'Получил hover-информацию',
    detail: `${count} блоков hover`,
    ...(content && content.length <= 4000 ? { preview: content } : {}),
  };
}

export function buildLspCallHierarchyPresentation(options: {
  operation: 'incoming_calls' | 'outgoing_calls';
  title: string;
  count: number;
  pagination: LspPagination;
  content?: string;
  nextStep?: string;
  items?: LspCallPreviewItem[];
}): LspInspectPresentation {
  return {
    operation: options.operation,
    resultCount: options.count,
    summary: options.count === 0
      ? `${options.title} не найдены`
      : options.operation === 'incoming_calls'
        ? 'Собрал входящие вызовы'
        : 'Собрал исходящие вызовы',
    detail: [
      `${options.count} вызовов`,
      options.pagination.offset > 0 ? `offset ${options.pagination.offset}` : '',
      options.operation,
    ].filter(Boolean).join(' • '),
    ...(options.content && options.content.length <= 4000 ? { preview: options.content } : {}),
    ...(options.nextStep ? { nextStep: options.nextStep } : {}),
    ...(options.items && options.items.length > 0
      ? {
        sections: [{
          title: options.title,
          items: options.items.slice(0, 6).map((item) => ({
            title: item.name,
            subtitle: `${item.path}:L${item.line}:${item.character}`,
            meta: item.detail || '',
          })),
        }],
      }
      : {}),
  };
}

export function formatPagedDocumentSymbols(
  outline: FileSymbolOutline,
  pagination: LspPagination,
): string {
  if (outline.symbols.length === 0) {
    return `${outline.file}: (символы не найдены)`;
  }

  const page = paginate<FileSymbolOutline['symbols'][number]>(outline.symbols, pagination);
  const lines = [
    `${outline.file}: показаны символы ${pagination.offset + 1}–${pagination.offset + page.items.length} из ${outline.symbols.length}`,
  ];

  for (const sym of page.items) {
    lines.push(`  L${sym.line} [${sym.kind}] ${sym.name}${sym.detail ? ` — ${sym.detail}` : ''}`);
  }

  if (page.items[0]) {
    lines.push('');
    lines.push('Следующие удобные шаги:');
    lines.push(
      `- открыть участок вокруг первого символа: ${buildToolCall('read_file_range', {
        path: outline.file,
        startLine: Math.max(1, page.items[0].line - 6),
        endLine: page.items[0].line + 24,
      })}`,
    );
  }

  if (page.hasMore) {
    lines.push(
      `- продолжить список символов: ${buildToolCall('lsp_inspect', {
        operation: 'document_symbols',
        path: outline.file,
        offset: pagination.offset + pagination.limit,
        limit: pagination.limit,
      })}`,
    );
  }

  return lines.join('\n');
}

export function formatPagedWorkspaceSymbols(
  query: string,
  symbols: vscode.SymbolInformation[] | undefined,
  pagination: LspPagination,
): string {
  const items = symbols || [];
  if (items.length === 0) {
    return `Символы по "${query}" не найдены.`;
  }

  const page = paginate<vscode.SymbolInformation>(items, pagination);
  const lines = [
    `Символы по "${query}": показаны ${page.items.length} из ${items.length}${pagination.offset ? ` (offset: ${pagination.offset})` : ''}`,
  ];

  for (const symbol of page.items) {
    const relativePath = vscode.workspace.asRelativePath(symbol.location.uri, false);
    const container = symbol.containerName ? ` (в ${symbol.containerName})` : '';
    lines.push(
      `  [${vscode.SymbolKind[symbol.kind] || 'Unknown'}] ${symbol.name}${container} — ${relativePath}:${symbol.location.range.start.line + 1}:${symbol.location.range.start.character + 1}`,
    );
  }

  const first = page.items[0];
  if (first) {
    lines.push('');
    lines.push('Следующие удобные шаги:');
    lines.push(`- открыть файл с первым символом: ${buildToolCall('read_file', { path: vscode.workspace.asRelativePath(first.location.uri, false), outputMode: 'outline' })}`);
    lines.push(
      `- перейти к определению по точке символа: ${buildToolCall('lsp_inspect', {
        operation: 'definition',
        path: vscode.workspace.asRelativePath(first.location.uri, false),
        line: first.location.range.start.line + 1,
        character: first.location.range.start.character + 1,
      })}`,
    );
  }

  if (page.hasMore) {
    lines.push(
      `- продолжить workspace symbols: ${buildToolCall('lsp_inspect', {
        operation: 'workspace_symbols',
        query,
        offset: pagination.offset + pagination.limit,
        limit: pagination.limit,
      })}`,
    );
  }

  return lines.join('\n');
}

export async function formatCallHierarchyResult(
  title: string,
  calls: readonly (vscode.CallHierarchyIncomingCall | vscode.CallHierarchyOutgoingCall)[] | undefined,
  pagination: LspPagination,
  nextCallArgs: Record<string, unknown>,
): Promise<string> {
  const items = calls || [];
  if (items.length === 0) {
    return `${title} не найдены.`;
  }

  const page = paginate(items, pagination);
  const lines = [
    `${title}: показаны ${page.items.length} из ${items.length}${pagination.offset ? ` (offset: ${pagination.offset})` : ''}`,
  ];

  for (const call of page.items) {
    const item = getCallHierarchyTarget(call);
    const relativePath = vscode.workspace.asRelativePath(item.uri, false);
    const line = item.selectionRange.start.line + 1;
    const character = item.selectionRange.start.character + 1;
    const detail = item.detail ? ` — ${compactText(item.detail, 80)}` : '';
    lines.push(`  ${item.name} — ${relativePath}:${line}:${character}${detail}`);
  }

  const first = page.items[0];
  if (first) {
    const item = getCallHierarchyTarget(first);
    lines.push('');
    lines.push('Следующие удобные шаги:');
    lines.push(
      `- открыть участок вокруг первого вызова: ${buildToolCall('read_file_range', {
        path: vscode.workspace.asRelativePath(item.uri, false),
        startLine: Math.max(1, item.selectionRange.start.line + 1 - 6),
        endLine: item.selectionRange.start.line + 1 + 24,
      })}`,
    );
  }

  if (page.hasMore) {
    lines.push(
      `- продолжить call hierarchy: ${buildToolCall('lsp_inspect', {
        ...nextCallArgs,
        offset: pagination.offset + pagination.limit,
        limit: pagination.limit,
      })}`,
    );
  }

  return lines.join('\n');
}

export function formatOutlineFallback(outline: FileSymbolOutline): string {
  return formatSymbolOutline(outline);
}

function getLocationUri(location: LspLocation): vscode.Uri {
  return isLocationLink(location) ? location.targetUri : location.uri;
}

function getLocationRange(location: LspLocation): vscode.Range {
  return isLocationLink(location)
    ? (location.targetSelectionRange || location.targetRange)
    : location.range;
}

function isLocationLink(location: LspLocation): location is vscode.LocationLink {
  return 'targetUri' in location;
}

function getCallHierarchyTarget(
  call: vscode.CallHierarchyIncomingCall | vscode.CallHierarchyOutgoingCall,
): vscode.CallHierarchyItem {
  return 'from' in call ? call.from : call.to;
}

function paginate<T>(items: readonly T[], pagination: LspPagination): { items: T[]; hasMore: boolean } {
  const page = items.slice(pagination.offset, pagination.offset + pagination.limit);
  return {
    items: page,
    hasMore: pagination.offset + pagination.limit < items.length,
  };
}

async function readLineSnippet(uri: vscode.Uri, lineIndex: number): Promise<string> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (lineIndex < 0 || lineIndex >= doc.lineCount) return '';
    return compactText(doc.lineAt(lineIndex).text.trim(), 100);
  } catch {
    return '';
  }
}

function parsePositiveInt(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value: any, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function compactText(text: string, maxLength = 120): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildToolCall(tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({ tool, args });
}
