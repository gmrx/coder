import * as vscode from 'vscode';
import type { StructuredPresentationSection } from './presentationItems';
import { isUriInAgentWorkspace, toAgentRelativePath } from '../worktreeSession';

export type DiagnosticsOutputMode = 'summary' | 'files' | 'items';
export type DiagnosticsSeverityFilter = 'default' | 'all' | 'error' | 'warning' | 'info' | 'hint';
type DiagnosticsSeverityLevel = 'error' | 'warning' | 'info' | 'hint';

interface DiagnosticsSummaryOptions {
  path?: string;
  paths?: string[];
  limit?: number;
  offset?: number;
  outputMode?: DiagnosticsOutputMode;
  severity?: DiagnosticsSeverityFilter;
  toolName?: 'read_lints' | 'get_diagnostics';
}

type NormalizedDiagnostic = {
  file: string;
  line: number;
  column: number;
  severity: DiagnosticsSeverityLevel;
  source: string;
  code: string;
  message: string;
};

type FileDiagnosticGroup = {
  file: string;
  diagnostics: NormalizedDiagnostic[];
  counts: Record<'error' | 'warning' | 'info' | 'hint', number>;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface DiagnosticsPresentation {
  toolName: 'read_lints' | 'get_diagnostics';
  outputMode: DiagnosticsOutputMode;
  severity: DiagnosticsSeverityFilter;
  resultCount: number;
  fileCount: number;
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  sections?: StructuredPresentationSection[];
}

export function collectDiagnosticsSummary(options: DiagnosticsSummaryOptions = {}): string {
  return collectDiagnosticsResult(options).content;
}

export function collectDiagnosticsResult(options: DiagnosticsSummaryOptions = {}): {
  content: string;
  presentation: DiagnosticsPresentation;
} {
  const normalized = normalizeOptions(options);
  const diagnostics = collectDiagnostics(normalized.filterPaths, normalized.severity);
  const groups = groupByFile(diagnostics);

  if (diagnostics.length === 0) {
    return {
      content: buildNoDiagnosticsMessage(normalized),
      presentation: buildNoDiagnosticsPresentation(normalized),
    };
  }

  const content = normalized.outputMode === 'files'
    ? buildFilesOutput(diagnostics, normalized)
    : normalized.outputMode === 'items'
      ? buildItemsOutput(diagnostics, normalized)
      : buildSummaryOutput(diagnostics, normalized);

  return {
    content,
    presentation: buildDiagnosticsPresentation(normalized, diagnostics, groups),
  };
}

export function collectDiagnosticsSummaryLegacy(options: DiagnosticsSummaryOptions = {}): string {
  const normalized = normalizeOptions(options);
  const diagnostics = collectDiagnostics(normalized.filterPaths, normalized.severity);

  if (diagnostics.length === 0) {
    return buildNoDiagnosticsMessage(normalized);
  }

  if (normalized.outputMode === 'files') {
    return buildFilesOutput(diagnostics, normalized);
  }
  if (normalized.outputMode === 'items') {
    return buildItemsOutput(diagnostics, normalized);
  }
  return buildSummaryOutput(diagnostics, normalized);
}

function buildDiagnosticsPresentation(
  options: ReturnType<typeof normalizeOptions>,
  diagnostics: NormalizedDiagnostic[],
  groups: FileDiagnosticGroup[],
): DiagnosticsPresentation {
  const topGroup = groups[0];
  const topDiagnostic = diagnostics[0];
  const summary = options.outputMode === 'files'
    ? 'Собрал проблемные файлы'
    : options.outputMode === 'items'
      ? 'Получил список проблем'
      : 'Диагностика получена';
  const detailParts = [
    `${diagnostics.length} ${pluralizeRu(diagnostics.length, 'проблема', 'проблемы', 'проблем')}`,
    `${groups.length} ${pluralizeRu(groups.length, 'файл', 'файла', 'файлов')}`,
    options.severity !== 'default' ? `severity: ${options.severity}` : '',
    options.filterPaths.length === 1 ? `область: ${options.filterPaths[0]}` : '',
    options.filterPaths.length > 1 ? 'по нескольким путям' : '',
  ].filter(Boolean);

  let preview = '';
  if (options.outputMode === 'files') {
    preview = groups.slice(0, 5).map((group) => `- ${group.file} — ${formatCounts(group.counts)}`).join('\n');
  } else if (options.outputMode === 'items') {
    preview = diagnostics
      .slice(0, 5)
      .map((diagnostic) => `- ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${renderSeverity(diagnostic.severity)} ${renderDiagnosticMessage(diagnostic)}`)
      .join('\n');
  } else {
    preview = groups
      .slice(0, 4)
      .map((group) => {
        const first = group.diagnostics[0];
        return first
          ? `- ${group.file} — ${formatCounts(group.counts)}; L${first.line}:${first.column} ${renderDiagnosticMessage(first)}`
          : `- ${group.file} — ${formatCounts(group.counts)}`;
      })
      .join('\n');
  }

  const nextStep = topDiagnostic
    ? `Открой первый проблемный участок: ${buildToolCall('read_file_range', { path: topDiagnostic.file, startLine: Math.max(1, topDiagnostic.line - 8), endLine: topDiagnostic.line + 20 })}`
    : topGroup
      ? `Открой первый проблемный файл: ${buildToolCall('read_file', { path: topGroup.file, outputMode: 'outline' })}`
      : undefined;

  return {
    toolName: options.toolName,
    outputMode: options.outputMode,
    severity: options.severity,
    resultCount: diagnostics.length,
    fileCount: groups.length,
    summary,
    detail: detailParts.join(' • '),
    ...(preview ? { preview } : {}),
    ...(nextStep ? { nextStep } : {}),
    sections: buildDiagnosticsSections(options.outputMode, diagnostics, groups),
  };
}

function buildNoDiagnosticsPresentation(
  options: ReturnType<typeof normalizeOptions>,
): DiagnosticsPresentation {
  return {
    toolName: options.toolName,
    outputMode: options.outputMode,
    severity: options.severity,
    resultCount: 0,
    fileCount: 0,
    summary: 'Ошибок не найдено',
    detail: options.filterPaths.length > 0
      ? `Диагностика не найдена в ${options.filterPaths.length === 1 ? options.filterPaths[0] : 'указанной области'}.`
      : 'Диагностика не найдена в проекте.',
    nextStep: 'Если ожидались проблемы, расширь область поиска или снизь фильтр severity.',
  };
}

function buildDiagnosticsSections(
  outputMode: DiagnosticsOutputMode,
  diagnostics: NormalizedDiagnostic[],
  groups: FileDiagnosticGroup[],
): StructuredPresentationSection[] {
  if (diagnostics.length === 0) return [];

  if (outputMode === 'items') {
    const items = diagnostics.slice(0, 6).map((diagnostic) => ({
      title: `${diagnostic.file}:L${diagnostic.line}:${diagnostic.column}`,
      subtitle: `${renderSeverity(diagnostic.severity)} • ${renderDiagnosticMessage(diagnostic)}`,
      meta: [diagnostic.code, diagnostic.source].filter(Boolean).join(' • '),
    }));
    return [{ title: 'Проблемы', items }];
  }

  const items = groups.slice(0, 6).map((group) => {
    const first = group.diagnostics[0];
    return {
      title: group.file,
      subtitle: formatCounts(group.counts),
      meta: first ? `L${first.line}:${first.column} ${renderDiagnosticMessage(first)}` : '',
    };
  });
  return [{ title: 'Проблемные файлы', items }];
}

function normalizeOptions(options: DiagnosticsSummaryOptions) {
  const filterPaths = Array.isArray(options.paths)
    ? options.paths.filter(isNonEmptyText)
    : (typeof options.path === 'string' && options.path.trim() ? [options.path.trim()] : []);

  return {
    filterPaths,
    limit: clampPositiveInt(options.limit, DEFAULT_LIMIT, MAX_LIMIT),
    offset: Math.max(0, toInt(options.offset, 0)),
    outputMode: normalizeOutputMode(options.outputMode),
    severity: normalizeSeverity(options.severity),
    toolName: options.toolName || 'read_lints',
  };
}

function collectDiagnostics(
  filterPaths: string[],
  severityFilter: DiagnosticsSeverityFilter,
): NormalizedDiagnostic[] {
  const results: NormalizedDiagnostic[] = [];

  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (!diagnostics.length) continue;
    if (!isUriInAgentWorkspace(uri)) continue;

    const relativePath = toAgentRelativePath(uri);
    if (!relativePath || relativePath.startsWith('/')) continue;
    if (filterPaths.length > 0 && !filterPaths.some((value) => matchesPathFilter(relativePath, value))) {
      continue;
    }

    for (const diagnostic of diagnostics) {
      const severity = normalizeDiagnosticSeverity(diagnostic.severity);
      if (!matchesSeverityFilter(severity, severityFilter)) continue;

      results.push({
        file: relativePath,
        line: diagnostic.range.start.line + 1,
        column: diagnostic.range.start.character + 1,
        severity,
        source: diagnostic.source || '',
        code: typeof diagnostic.code === 'string' || typeof diagnostic.code === 'number'
          ? String(diagnostic.code)
          : '',
        message: compactMessage(diagnostic.message),
      });
    }
  }

  results.sort((left, right) => {
    const fileCompare = left.file.localeCompare(right.file);
    if (fileCompare !== 0) return fileCompare;
    const lineCompare = left.line - right.line;
    if (lineCompare !== 0) return lineCompare;
    const columnCompare = left.column - right.column;
    if (columnCompare !== 0) return columnCompare;
    return severityRank(left.severity) - severityRank(right.severity);
  });

  return results;
}

function buildSummaryOutput(
  diagnostics: NormalizedDiagnostic[],
  options: ReturnType<typeof normalizeOptions>,
): string {
  const groups = groupByFile(diagnostics);
  const page = paginate(groups, options.offset, options.limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage(options, 'summary');
  }

  const lines = [
    `Диагностика: ${diagnostics.length} проблем в ${groups.length} файлах. Показаны файлы ${page.start + 1}–${page.end}.`,
    '',
  ];

  for (const group of page.items) {
    lines.push(`${group.file} — ${formatCounts(group.counts)}`);
    for (const diagnostic of group.diagnostics.slice(0, 3)) {
      lines.push(`  ${renderSeverity(diagnostic.severity)} [L${diagnostic.line}:${diagnostic.column}] ${renderDiagnosticMessage(diagnostic)}`);
    }
    if (group.diagnostics.length > 3) {
      lines.push(`  ... ещё ${group.diagnostics.length - 3}`);
    }
    lines.push('');
  }

  lines.push('Удобные следующие шаги:');
  lines.push(`- полный список проблем: ${buildToolCall(options.toolName, buildBaseArgs(options, { outputMode: 'items', offset: 0 }))}`);
  appendPagination(lines, options, page, 'summary');

  const first = page.items[0]?.diagnostics[0];
  if (first) {
    lines.push(`- открыть участок с первой проблемой: ${buildToolCall('read_file_range', { path: first.file, startLine: Math.max(1, first.line - 8), endLine: first.line + 20 })}`);
  }

  return trimTrailingBlankLines(lines).join('\n');
}

function buildFilesOutput(
  diagnostics: NormalizedDiagnostic[],
  options: ReturnType<typeof normalizeOptions>,
): string {
  const groups = groupByFile(diagnostics);
  const page = paginate(groups, options.offset, options.limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage(options, 'files');
  }

  const lines = [`Файлы с диагностикой: показаны ${page.start + 1}–${page.end} из ${groups.length}.`, ''];
  for (const group of page.items) {
    lines.push(`- ${group.file} — ${formatCounts(group.counts)}`);
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- summary по этим же данным: ${buildToolCall(options.toolName, buildBaseArgs(options, { outputMode: 'summary', offset: 0 }))}`);
  lines.push(`- список отдельных проблем: ${buildToolCall(options.toolName, buildBaseArgs(options, { outputMode: 'items', offset: 0 }))}`);
  appendPagination(lines, options, page, 'files');
  return trimTrailingBlankLines(lines).join('\n');
}

function buildItemsOutput(
  diagnostics: NormalizedDiagnostic[],
  options: ReturnType<typeof normalizeOptions>,
): string {
  const page = paginate(diagnostics, options.offset, options.limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage(options, 'items');
  }

  const lines = [`Проблемы IDE: показаны ${page.start + 1}–${page.end} из ${diagnostics.length}.`, ''];
  for (const diagnostic of page.items) {
    lines.push(`- ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${renderSeverity(diagnostic.severity)} ${renderDiagnosticMessage(diagnostic)}`);
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  const first = page.items[0];
  if (first) {
    lines.push(`- открыть участок с первой проблемой: ${buildToolCall('read_file_range', { path: first.file, startLine: Math.max(1, first.line - 8), endLine: first.line + 20 })}`);
  }
  lines.push(`- сгруппировать по файлам: ${buildToolCall(options.toolName, buildBaseArgs(options, { outputMode: 'summary', offset: 0 }))}`);
  appendPagination(lines, options, page, 'items');
  return trimTrailingBlankLines(lines).join('\n');
}

function buildNoDiagnosticsMessage(
  options: ReturnType<typeof normalizeOptions>,
): string {
  if (options.filterPaths.length > 0) {
    const label = options.filterPaths.length === 1
      ? `"${options.filterPaths[0]}"`
      : 'указанной области';
    return `Диагностика не найдена в ${label}.`;
  }
  return 'Диагностика не найдена в проекте.';
}

function buildEmptyPageMessage(
  options: ReturnType<typeof normalizeOptions>,
  outputMode: DiagnosticsOutputMode,
): string {
  return [
    `Диагностика: страница с offset=${options.offset} пуста.`,
    '',
    `Попробуй меньший offset: ${buildToolCall(options.toolName, buildBaseArgs(options, { outputMode, offset: Math.max(0, options.offset - options.limit) }))}`,
  ].join('\n');
}

function appendPagination<T>(
  lines: string[],
  options: ReturnType<typeof normalizeOptions>,
  page: { start: number; hasMore: boolean; items: T[] },
  outputMode: DiagnosticsOutputMode,
): void {
  if (!(page.start > 0 || page.hasMore)) return;
  if (lines[lines.length - 1] !== 'Удобные следующие шаги:') {
    lines.push('Удобные следующие шаги:');
  }
  if (page.start > 0) {
    lines.push(`- предыдущая страница: ${buildToolCall(options.toolName, buildBaseArgs(options, { outputMode, offset: Math.max(0, options.offset - options.limit) }))}`);
  }
  if (page.hasMore) {
    lines.push(`- следующая страница: ${buildToolCall(options.toolName, buildBaseArgs(options, { outputMode, offset: options.offset + page.items.length }))}`);
  }
}

function groupByFile(diagnostics: NormalizedDiagnostic[]): FileDiagnosticGroup[] {
  const map = new Map<string, FileDiagnosticGroup>();

  for (const diagnostic of diagnostics) {
    const existing = map.get(diagnostic.file) || {
      file: diagnostic.file,
      diagnostics: [],
      counts: { error: 0, warning: 0, info: 0, hint: 0 },
    };
    existing.diagnostics.push(diagnostic);
    existing.counts[diagnostic.severity]++;
    map.set(diagnostic.file, existing);
  }

  return [...map.values()].sort((left, right) => {
    const diff = totalCount(right.counts) - totalCount(left.counts);
    return diff !== 0 ? diff : left.file.localeCompare(right.file);
  });
}

function buildBaseArgs(
  options: ReturnType<typeof normalizeOptions>,
  overrides: Partial<Record<'outputMode' | 'offset' | 'limit' | 'severity', any>>,
): Record<string, any> {
  const base: Record<string, any> = {
    limit: options.limit,
    offset: options.offset,
  };

  if (options.filterPaths.length === 1) {
    base.path = options.filterPaths[0];
  } else if (options.filterPaths.length > 1) {
    base.paths = options.filterPaths;
  }

  if (options.severity !== 'default') {
    base.severity = options.severity;
  }

  const merged = { ...base, ...overrides };
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined && value !== ''),
  );
}

function renderDiagnosticMessage(diagnostic: NormalizedDiagnostic): string {
  const suffix = [
    diagnostic.code ? `[${diagnostic.code}]` : '',
    diagnostic.source ? `(${diagnostic.source})` : '',
  ].filter(Boolean).join(' ');
  return suffix ? `${diagnostic.message} ${suffix}` : diagnostic.message;
}

function renderSeverity(severity: DiagnosticsSeverityFilter): string {
  switch (severity) {
    case 'error':
      return 'ERROR';
    case 'warning':
      return 'WARN';
    case 'info':
      return 'INFO';
    case 'hint':
      return 'HINT';
    default:
      return 'WARN';
  }
}

function formatCounts(counts: FileDiagnosticGroup['counts']): string {
  const parts: string[] = [];
  if (counts.error) parts.push(`${counts.error} error`);
  if (counts.warning) parts.push(`${counts.warning} warning`);
  if (counts.info) parts.push(`${counts.info} info`);
  if (counts.hint) parts.push(`${counts.hint} hint`);
  return parts.join(', ') || '0 проблем';
}

function totalCount(counts: FileDiagnosticGroup['counts']): number {
  return counts.error + counts.warning + counts.info + counts.hint;
}

function normalizeOutputMode(value: DiagnosticsOutputMode | undefined): DiagnosticsOutputMode {
  const mode = String(value || 'summary').trim().toLowerCase();
  if (mode === 'files' || mode === 'items') return mode;
  return 'summary';
}

function normalizeSeverity(value: DiagnosticsSeverityFilter | undefined): DiagnosticsSeverityFilter {
  const severity = String(value || 'default').trim().toLowerCase();
  if (severity === 'all' || severity === 'error' || severity === 'warning' || severity === 'info' || severity === 'hint') {
    return severity;
  }
  return 'default';
}

function normalizeDiagnosticSeverity(severity: vscode.DiagnosticSeverity): DiagnosticsSeverityLevel {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'info';
    case vscode.DiagnosticSeverity.Hint:
      return 'hint';
    default:
      return 'warning';
  }
}

function matchesSeverityFilter(
  severity: DiagnosticsSeverityFilter,
  filter: DiagnosticsSeverityFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'default') return severity === 'error' || severity === 'warning';
  return severity === filter;
}

function matchesPathFilter(relativePath: string, filterPath: string): boolean {
  const normalizedFilter = String(filterPath || '').trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (!normalizedFilter) return true;
  return relativePath === normalizedFilter || relativePath.startsWith(normalizedFilter + '/');
}

function compactMessage(message: string): string {
  return String(message || '').replace(/\s+/g, ' ').trim();
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function severityRank(severity: DiagnosticsSeverityFilter): number {
  switch (severity) {
    case 'error':
      return 0;
    case 'warning':
      return 1;
    case 'info':
      return 2;
    case 'hint':
      return 3;
    default:
      return 4;
  }
}

function paginate<T>(
  items: T[],
  offset: number,
  limit: number,
): { items: T[]; start: number; end: number; hasMore: boolean } {
  const start = Math.max(0, offset);
  const pageItems = items.slice(start, start + limit);
  return {
    items: pageItems,
    start,
    end: start + pageItems.length,
    hasMore: start + pageItems.length < items.length,
  };
}

function buildToolCall(toolName: string, args: Record<string, any>): string {
  return JSON.stringify({ tool: toolName, args });
}

function clampPositiveInt(value: any, fallback: number, max: number): number {
  const normalized = toInt(value, fallback);
  if (!Number.isFinite(normalized) || normalized <= 0) return fallback;
  return Math.min(max, normalized);
}

function toInt(value: any, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const result = [...lines];
  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
  return result;
}

function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
