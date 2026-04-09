import type { DependencyEdge, FileSymbolOutline } from '../../core/types';
import type { StructuredPresentationSection } from './presentationItems';

export type SymbolOutputMode = 'summary' | 'symbols' | 'kinds';
export type DependencyOutputMode = 'summary' | 'packages' | 'manifests' | 'graph' | 'files';

export interface SymbolStudyPresentation {
  toolName: 'extract_symbols' | 'dependencies' | 'workspace_symbols';
  outputMode: SymbolOutputMode | DependencyOutputMode | 'workspace_symbols';
  resultCount: number;
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  sections?: StructuredPresentationSection[];
}

type OutlineSymbol = FileSymbolOutline['symbols'][number];

type DependencyFileGroup = {
  from: string;
  targets: string[];
};

export type ManifestDependencyGroup = {
  file: string;
  entries: Array<{ name: string; version: string }>;
};

export function normalizeSymbolOutputMode(value: any): SymbolOutputMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'symbols' || mode === 'list' || mode === 'items' || mode === 'detail') return 'symbols';
  if (mode === 'kinds' || mode === 'types' || mode === 'by_kind' || mode === 'grouped') return 'kinds';
  return 'summary';
}

export function normalizeDependencyOutputMode(value: any): DependencyOutputMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'packages' || mode === 'package') return 'packages';
  if (mode === 'manifests' || mode === 'manifest' || mode === 'files_with_packages') return 'manifests';
  if (mode === 'files' || mode === 'by_file' || mode === 'sources') return 'files';
  if (mode === 'graph' || mode === 'imports' || mode === 'import_graph') return 'graph';
  return 'summary';
}

export function buildSymbolOutlineOutput(
  outline: FileSymbolOutline,
  options: {
    outputMode: SymbolOutputMode;
    limit: number;
    offset: number;
  },
): string {
  const symbols = outline.symbols || [];
  if (symbols.length === 0) return `${outline.file}: символы не найдены.`;

  if (options.outputMode === 'kinds') {
    return buildSymbolKindsOutput(outline, options.limit, options.offset);
  }
  if (options.outputMode === 'symbols') {
    return buildSymbolListOutput(outline, options.limit, options.offset);
  }
  return buildSymbolSummaryOutput(outline, options.limit, options.offset);
}

export function buildDependenciesOutput(
  options: {
    requestedPaths: string[];
    manifestGroups: ManifestDependencyGroup[];
    edges: DependencyEdge[];
    outputMode: DependencyOutputMode;
    limit: number;
    offset: number;
  },
): string {
  const mode = options.outputMode;
  if (mode === 'packages') {
    return buildPackagesOutput(options.manifestGroups, options.requestedPaths, options.limit, options.offset);
  }
  if (mode === 'manifests') {
    return buildManifestGroupsOutput(options.manifestGroups, options.requestedPaths, options.limit, options.offset);
  }
  if (mode === 'graph') {
    return buildGraphOutput(options.edges, options.requestedPaths, options.limit, options.offset);
  }
  if (mode === 'files') {
    return buildDependencyFilesOutput(options.edges, options.requestedPaths, options.limit, options.offset);
  }
  return buildDependencySummaryOutput(options);
}

export function buildSymbolOutlinePresentation(
  outline: FileSymbolOutline,
  options: {
    outputMode: SymbolOutputMode;
    limit: number;
    offset: number;
    content?: string;
  },
): SymbolStudyPresentation {
  const symbols = outline.symbols || [];
  const kindCount = buildKindCounts(symbols).length;
  const first = symbols[0];
  const summary = symbols.length === 0
    ? 'Символы не найдены'
    : options.outputMode === 'kinds'
      ? 'Сгруппировал символы по видам'
      : options.outputMode === 'symbols'
        ? 'Подготовил список символов файла'
        : 'Подготовил обзор символов файла';
  const detail = [
    outline.file,
    `${symbols.length} символов`,
    `${kindCount} видов`,
    options.offset > 0 ? `offset ${options.offset}` : '',
    options.outputMode,
  ].filter(Boolean).join(' • ');

  return {
    toolName: 'extract_symbols',
    outputMode: options.outputMode,
    resultCount: symbols.length,
    summary,
    detail,
    ...(options.content && options.content.length <= 4000 ? { preview: options.content } : {}),
    ...(first
      ? { nextStep: `Открой участок вокруг первого символа: ${buildToolCall('read_file_range', { path: outline.file, startLine: Math.max(1, first.line - 6), endLine: first.line + 24 })}` }
      : {}),
    sections: buildSymbolOutlineSections(outline, options.outputMode, options.limit, options.offset),
  };
}

export function buildDependenciesPresentation(
  options: {
    requestedPaths: string[];
    manifestGroups: ManifestDependencyGroup[];
    edges: DependencyEdge[];
    outputMode: DependencyOutputMode;
    limit: number;
    offset: number;
    content?: string;
  },
): SymbolStudyPresentation {
  const packageCount = options.manifestGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const fileGroups = buildDependencyFileGroups(options.edges);
  const summary = options.manifestGroups.length === 0 && options.edges.length === 0
    ? 'Зависимости не найдены'
    : options.outputMode === 'packages'
      ? 'Собрал пакетные зависимости'
      : options.outputMode === 'manifests'
        ? 'Подготовил обзор манифестов зависимостей'
        : options.outputMode === 'graph'
          ? 'Собрал граф импортов'
          : options.outputMode === 'files'
            ? 'Сгруппировал зависимости по файлам'
            : 'Подготовил обзор зависимостей';
  const detail = [
    `${options.requestedPaths.length} путей`,
    `${options.manifestGroups.length} манифестов`,
    `${packageCount} пакетов`,
    `${options.edges.length} связей`,
    `${fileGroups.length} файлов-источников`,
    options.offset > 0 ? `offset ${options.offset}` : '',
    options.outputMode,
  ].filter(Boolean).join(' • ');
  const firstManifest = options.manifestGroups[0];
  const firstEdge = options.edges[0];
  const nextStep = firstManifest
    ? `Открой первый манифест: ${buildToolCall('read_file', { path: firstManifest.file, outputMode: 'manifest' })}`
    : firstEdge
      ? `Открой исходный файл: ${buildToolCall('read_file', { path: firstEdge.from, outputMode: 'outline' })}`
      : undefined;

  return {
    toolName: 'dependencies',
    outputMode: options.outputMode,
    resultCount: options.outputMode === 'packages'
      ? packageCount
      : options.outputMode === 'graph'
        ? options.edges.length
        : options.outputMode === 'files'
          ? fileGroups.length
          : options.manifestGroups.length + options.edges.length,
    summary,
    detail,
    ...(options.content && options.content.length <= 4000 ? { preview: options.content } : {}),
    ...(nextStep ? { nextStep } : {}),
    sections: buildDependenciesSections(options),
  };
}

export function buildWorkspaceSymbolsPresentation(
  query: string,
  symbols: Array<{
    name: string;
    kind: string;
    path: string;
    line: number;
    character: number;
    containerName?: string;
  }>,
  options: {
    limit: number;
    offset: number;
    total: number;
    content?: string;
  },
): SymbolStudyPresentation {
  const first = symbols[0];
  return {
    toolName: 'workspace_symbols',
    outputMode: 'workspace_symbols',
    resultCount: options.total,
    summary: options.total === 0 ? 'Символы не найдены' : 'Нашёл символы',
    detail: [
      `"${query}"`,
      `${options.total} символов`,
      `${symbols.length} на странице`,
      options.offset > 0 ? `offset ${options.offset}` : '',
    ].filter(Boolean).join(' • '),
    ...(options.content && options.content.length <= 4000 ? { preview: options.content } : {}),
    ...(first
      ? { nextStep: `Открой файл с первым символом: ${buildToolCall('read_file', { path: first.path, outputMode: 'outline' })}` }
      : {}),
    sections: symbols.length > 0
      ? [{
        title: 'Символы',
        items: symbols.slice(0, 6).map((symbol) => ({
          title: symbol.name,
          subtitle: `${symbol.kind} • ${symbol.path}:L${symbol.line}`,
          meta: symbol.containerName || '',
        })),
      }]
      : [],
  };
}

function buildSymbolOutlineSections(
  outline: FileSymbolOutline,
  outputMode: SymbolOutputMode,
  limit: number,
  offset: number,
): StructuredPresentationSection[] {
  const symbols = outline.symbols || [];
  if (symbols.length === 0) return [];

  if (outputMode === 'kinds') {
    const kinds = buildKindGroups(symbols).slice(offset, offset + Math.min(limit, 6));
    return [{
      title: 'Виды символов',
      items: kinds.map((group) => ({
        title: group.kind,
        subtitle: `${group.count} ${pluralizeRu(group.count, 'символ', 'символа', 'символов')}`,
        meta: group.preview.join(', '),
      })),
    }];
  }

  const page = symbols.slice(offset, offset + Math.min(limit, 6));
  return [{
    title: 'Символы',
    items: page.map((symbol) => ({
      title: symbol.name,
      subtitle: `${symbol.kind} • L${symbol.line}`,
      meta: symbol.detail || '',
    })),
  }];
}

function buildDependenciesSections(options: {
  requestedPaths: string[];
  manifestGroups: ManifestDependencyGroup[];
  edges: DependencyEdge[];
  outputMode: DependencyOutputMode;
  limit: number;
  offset: number;
  content?: string;
}): StructuredPresentationSection[] {
  const fileGroups = buildDependencyFileGroups(options.edges);
  const sections: StructuredPresentationSection[] = [];

  if (options.outputMode === 'summary') {
    if (options.manifestGroups.length > 0) {
      sections.push({
        title: 'Манифесты',
        items: options.manifestGroups.slice(0, 4).map((group) => ({
          title: group.file,
          subtitle: `${group.entries.length} ${pluralizeRu(group.entries.length, 'пакет', 'пакета', 'пакетов')}`,
          meta: group.entries.slice(0, 4).map((entry) => `${entry.name}@${entry.version}`).join(', '),
        })),
      });
    }
    if (fileGroups.length > 0) {
      sections.push({
        title: 'Файлы с импортами',
        items: fileGroups.slice(0, 4).map((group) => ({
          title: group.from,
          subtitle: `${group.targets.length} ${pluralizeRu(group.targets.length, 'связь', 'связи', 'связей')}`,
          meta: group.targets.slice(0, 4).join(', '),
        })),
      });
    }
    return sections;
  }

  if (options.outputMode === 'manifests') {
    return [{
      title: 'Манифесты',
      items: options.manifestGroups.slice(options.offset, options.offset + Math.min(options.limit, 6)).map((group) => ({
        title: group.file,
        subtitle: `${group.entries.length} ${pluralizeRu(group.entries.length, 'пакет', 'пакета', 'пакетов')}`,
        meta: group.entries.slice(0, 5).map((entry) => `${entry.name}@${entry.version}`).join(', '),
      })),
    }];
  }

  if (options.outputMode === 'packages') {
    const packages = options.manifestGroups.flatMap((group) =>
      group.entries.map((entry) => ({
        title: `${entry.name}@${entry.version}`,
        subtitle: group.file,
      })),
    );
    return packages.length > 0
      ? [{ title: 'Пакеты', items: packages.slice(options.offset, options.offset + Math.min(options.limit, 6)) }]
      : [];
  }

  if (options.outputMode === 'files') {
    return fileGroups.length > 0
      ? [{
        title: 'Файлы',
        items: fileGroups.slice(options.offset, options.offset + Math.min(options.limit, 6)).map((group) => ({
          title: group.from,
          subtitle: `${group.targets.length} ${pluralizeRu(group.targets.length, 'зависимость', 'зависимости', 'зависимостей')}`,
          meta: group.targets.slice(0, 5).join(', '),
        })),
      }]
      : [];
  }

  if (options.outputMode === 'graph') {
    return options.edges.length > 0
      ? [{
        title: 'Связи',
        items: options.edges.slice(options.offset, options.offset + Math.min(options.limit, 6)).map((edge) => ({
          title: edge.from,
          subtitle: edge.to,
        })),
      }]
      : [];
  }

  return sections;
}

function buildSymbolSummaryOutput(
  outline: FileSymbolOutline,
  limit: number,
  offset: number,
): string {
  const symbols = outline.symbols;
  const page = paginate(symbols, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage(
      'extract_symbols',
      { path: outline.file, outputMode: 'summary', limit },
      offset,
      limit,
      `${outline.file}: обзор символов`,
    );
  }

  const kindCounts = buildKindCounts(symbols);
  const lines = [
    `${outline.file}: найдено ${symbols.length} символов.`,
    `По видам: ${kindCounts.slice(0, 6).map((item) => `${item.kind} ${item.count}`).join(', ')}${kindCounts.length > 6 ? ', …' : ''}`,
    '',
    `Быстрый обзор: показаны символы ${page.start + 1}–${page.end} из ${symbols.length}.`,
  ];

  for (const symbol of page.items.slice(0, Math.min(8, page.items.length))) {
    lines.push(`- L${symbol.line} [${symbol.kind}] ${symbol.name}${symbol.detail ? ` — ${symbol.detail}` : ''}`);
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- полный список символов: ${buildToolCall('extract_symbols', { path: outline.file, outputMode: 'symbols', limit })}`);
  lines.push(`- сгруппировать по видам: ${buildToolCall('extract_symbols', { path: outline.file, outputMode: 'kinds', limit: Math.min(12, limit) })}`);
  lines.push(`- richer symbol-навигация через LSP: ${buildToolCall('lsp_inspect', { operation: 'document_symbols', path: outline.file, limit })}`);
  if (page.items[0]) {
    lines.push(`- детально читать участок: ${buildToolCall('read_file_range', { path: outline.file, startLine: nearestStartLine(page.items), endLine: nearestEndLine(page.items) })}`);
  }
  appendPagination(lines, 'extract_symbols', { path: outline.file, outputMode: 'summary', limit }, page, offset, limit);
  return lines.join('\n');
}

function buildSymbolListOutput(
  outline: FileSymbolOutline,
  limit: number,
  offset: number,
): string {
  const symbols = outline.symbols || [];
  const page = paginate(symbols, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage('extract_symbols', { path: outline.file, outputMode: 'symbols', limit }, offset, limit, `${outline.file}: символы`);
  }

  const lines = [
    `${outline.file}: показаны символы ${page.start + 1}–${page.end} из ${symbols.length}.`,
    '',
  ];

  for (const symbol of page.items) {
    lines.push(`  L${symbol.line} [${symbol.kind}] ${symbol.name}${symbol.detail ? ` — ${symbol.detail}` : ''}`);
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- обзор файла через символы: ${buildToolCall('extract_symbols', { path: outline.file, outputMode: 'summary', limit })}`);
  lines.push(`- сгруппировать по видам: ${buildToolCall('extract_symbols', { path: outline.file, outputMode: 'kinds', limit: Math.min(12, limit) })}`);
  lines.push(`- richer symbol-навигация через LSP: ${buildToolCall('lsp_inspect', { operation: 'document_symbols', path: outline.file, limit })}`);
  lines.push(`- детально читать участок: ${buildToolCall('read_file_range', { path: outline.file, startLine: nearestStartLine(page.items), endLine: nearestEndLine(page.items) })}`);
  appendPagination(lines, 'extract_symbols', { path: outline.file, outputMode: 'symbols', limit }, page, offset, limit);

  return lines.join('\n');
}

function buildSymbolKindsOutput(
  outline: FileSymbolOutline,
  limit: number,
  offset: number,
): string {
  const groups = buildKindGroups(outline.symbols);
  const page = paginate(groups, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage('extract_symbols', { path: outline.file, outputMode: 'kinds', limit }, offset, limit, `${outline.file}: виды символов`);
  }

  const lines = [
    `${outline.file}: виды символов ${page.start + 1}–${page.end} из ${groups.length}.`,
    '',
  ];

  for (const group of page.items) {
    lines.push(`- ${group.kind}: ${group.count} (${group.preview.join(', ')}${group.count > group.preview.length ? ', …' : ''})`);
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- полный список символов: ${buildToolCall('extract_symbols', { path: outline.file, outputMode: 'symbols', limit: Math.max(20, limit) })}`);
  lines.push(`- общий обзор файла: ${buildToolCall('extract_symbols', { path: outline.file, outputMode: 'summary', limit: Math.max(12, limit) })}`);
  if (page.items[0]) {
    lines.push(`- читать участок вокруг первого вида: ${buildToolCall('read_file_range', { path: outline.file, startLine: Math.max(1, page.items[0].firstLine - 8), endLine: page.items[0].firstLine + 24 })}`);
  }
  appendPagination(lines, 'extract_symbols', { path: outline.file, outputMode: 'kinds', limit }, page, offset, limit);
  return lines.join('\n');
}

function buildDependencySummaryOutput(options: {
  requestedPaths: string[];
  manifestGroups: ManifestDependencyGroup[];
  edges: DependencyEdge[];
  limit: number;
  offset: number;
}): string {
  const lines: string[] = [];
  const requestedLabel = options.requestedPaths.length > 0
    ? options.requestedPaths.join(', ')
    : 'указанных путей';
  const packageCount = options.manifestGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const fileGroups = buildDependencyFileGroups(options.edges);
  const uniqueTargets = new Set(options.edges.map((edge) => edge.to)).size;

  lines.push(`Зависимости для ${requestedLabel}:`);
  lines.push('');
  lines.push(`- манифесты с пакетами: ${options.manifestGroups.length}${options.manifestGroups.length > 0 ? ` (всего ${packageCount} записей)` : ''}`);
  lines.push(`- файловые связи: ${options.edges.length}${options.edges.length > 0 ? ` между ${fileGroups.length} файлами-источниками и ${uniqueTargets} целями` : ''}`);
  lines.push('');

  if (options.manifestGroups.length > 0) {
    lines.push('Манифесты:');
    for (const group of options.manifestGroups.slice(0, 3)) {
      const preview = group.entries.slice(0, 4).map((entry) => `${entry.name}@${entry.version}`).join(', ');
      lines.push(`- ${group.file}: ${group.entries.length} (${preview}${group.entries.length > 4 ? ', …' : ''})`);
    }
    lines.push(`- обзор манифестов: ${buildToolCall('dependencies', { paths: options.requestedPaths, outputMode: 'manifests', limit: options.limit })}`);
    lines.push(`- полный список пакетов: ${buildToolCall('dependencies', { paths: options.requestedPaths, outputMode: 'packages', limit: options.limit })}`);
    lines.push('');
  }

  if (fileGroups.length > 0) {
    lines.push('Файлы с импортами:');
    for (const group of fileGroups.slice(0, 3)) {
      lines.push(`- ${group.from}: ${group.targets.length} (${group.targets.slice(0, 4).join(', ')}${group.targets.length > 4 ? ', …' : ''})`);
    }
    lines.push(`- сгруппировать по файлам: ${buildToolCall('dependencies', { paths: options.requestedPaths, outputMode: 'files', limit: options.limit })}`);
    lines.push(`- плоский граф связей: ${buildToolCall('dependencies', { paths: options.requestedPaths, outputMode: 'graph', limit: options.limit })}`);
    if (fileGroups[0]) {
      lines.push(`- открыть первый файл обзорно: ${buildToolCall('read_file', { path: fileGroups[0].from, outputMode: 'outline' })}`);
    }
  } else {
    lines.push('Связи импортов не найдены.');
  }

  return lines.join('\n');
}

function buildManifestGroupsOutput(
  groups: ManifestDependencyGroup[],
  requestedPaths: string[],
  limit: number,
  offset: number,
): string {
  if (groups.length === 0) {
    return 'Манифесты зависимостей не найдены.';
  }

  const page = paginate(groups, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage('dependencies', { paths: requestedPaths, outputMode: 'manifests', limit }, offset, limit, 'Манифесты зависимостей');
  }

  const lines = [`Манифесты зависимостей: показаны ${page.start + 1}–${page.end} из ${groups.length}.`, ''];
  for (const group of page.items) {
    const preview = group.entries.slice(0, 5).map((entry) => `${entry.name}@${entry.version}`).join(', ');
    lines.push(`- ${group.file}: ${group.entries.length} (${preview}${group.entries.length > 5 ? ', …' : ''})`);
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- плоский список пакетов: ${buildToolCall('dependencies', { paths: requestedPaths, outputMode: 'packages', limit })}`);
  if (page.items[0]) {
    lines.push(`- открыть первый манифест: ${buildToolCall('read_file', { path: page.items[0].file, outputMode: 'manifest' })}`);
  }
  appendPagination(lines, 'dependencies', { paths: requestedPaths, outputMode: 'manifests', limit }, page, offset, limit);
  return lines.join('\n');
}

function buildPackagesOutput(
  groups: ManifestDependencyGroup[],
  requestedPaths: string[],
  limit: number,
  offset: number,
): string {
  const entries = groups.flatMap((group) =>
    group.entries.map((entry) => ({
      file: group.file,
      name: entry.name,
      version: entry.version,
    })),
  );

  if (entries.length === 0) {
    return 'Пакетные зависимости не найдены.';
  }

  const page = paginate(entries, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage('dependencies', { paths: requestedPaths, outputMode: 'packages', limit }, offset, limit, 'Пакетные зависимости');
  }

  const lines = [`Пакетные зависимости: показаны ${page.start + 1}–${page.end} из ${entries.length}.`, ''];
  for (const entry of page.items) {
    lines.push(`- ${entry.name}@${entry.version} — ${entry.file}`);
  }
  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- вернуться к обзору манифестов: ${buildToolCall('dependencies', { paths: requestedPaths, outputMode: 'manifests', limit })}`);
  if (page.items[0]) {
    lines.push(`- открыть первый манифест: ${buildToolCall('read_file', { path: page.items[0].file, outputMode: 'manifest' })}`);
  }
  appendPagination(lines, 'dependencies', { paths: requestedPaths, outputMode: 'packages', limit }, page, offset, limit);
  return lines.join('\n');
}

function buildDependencyFilesOutput(
  edges: DependencyEdge[],
  requestedPaths: string[],
  limit: number,
  offset: number,
): string {
  const groups = buildDependencyFileGroups(edges);
  if (groups.length === 0) {
    return 'Зависимости по файлам не найдены.';
  }

  const page = paginate(groups, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage('dependencies', { paths: requestedPaths, outputMode: 'files', limit }, offset, limit, 'Зависимости по файлам');
  }

  const lines = [`Зависимости по файлам: показаны ${page.start + 1}–${page.end} из ${groups.length}.`, ''];
  for (const group of page.items) {
    lines.push(`- ${group.from}: ${group.targets.length} (${group.targets.slice(0, 5).join(', ')}${group.targets.length > 5 ? ', …' : ''})`);
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- плоский граф связей: ${buildToolCall('dependencies', { paths: requestedPaths, outputMode: 'graph', limit })}`);
  if (page.items[0]) {
    lines.push(`- открыть первый файл обзорно: ${buildToolCall('read_file', { path: page.items[0].from, outputMode: 'outline' })}`);
    lines.push(`- посмотреть символы первого файла: ${buildToolCall('extract_symbols', { path: page.items[0].from, outputMode: 'summary', limit: 20 })}`);
  }
  appendPagination(lines, 'dependencies', { paths: requestedPaths, outputMode: 'files', limit }, page, offset, limit);
  return lines.join('\n');
}

function buildGraphOutput(
  edges: DependencyEdge[],
  requestedPaths: string[],
  limit: number,
  offset: number,
): string {
  if (edges.length === 0) {
    return 'Связи импортов не найдены.';
  }

  const page = paginate(edges, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage('dependencies', { paths: requestedPaths, outputMode: 'graph', limit }, offset, limit, 'Связи импортов');
  }

  const lines = [`Связи импортов: показаны ${page.start + 1}–${page.end} из ${edges.length}.`, ''];
  for (const edge of page.items) {
    lines.push(`- ${edge.from} → ${edge.to}`);
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- сгруппировать по файлам-источникам: ${buildToolCall('dependencies', { paths: requestedPaths, outputMode: 'files', limit })}`);
  if (page.items[0]) {
    lines.push(`- открыть исходный файл: ${buildToolCall('read_file', { path: page.items[0].from, outputMode: 'outline' })}`);
    lines.push(`- открыть целевой файл: ${buildToolCall('read_file', { path: page.items[0].to, outputMode: 'outline' })}`);
  }
  appendPagination(lines, 'dependencies', { paths: requestedPaths, outputMode: 'graph', limit }, page, offset, limit);
  return lines.join('\n');
}

function buildKindCounts(symbols: OutlineSymbol[]): Array<{ kind: string; count: number }> {
  const counts = new Map<string, number>();
  for (const symbol of symbols) {
    counts.set(symbol.kind, (counts.get(symbol.kind) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}

function buildKindGroups(symbols: OutlineSymbol[]): Array<{ kind: string; count: number; preview: string[]; firstLine: number }> {
  const grouped = new Map<string, OutlineSymbol[]>();
  for (const symbol of symbols) {
    const items = grouped.get(symbol.kind) || [];
    items.push(symbol);
    grouped.set(symbol.kind, items);
  }
  return [...grouped.entries()]
    .map(([kind, items]) => ({
      kind,
      count: items.length,
      preview: items.slice(0, 4).map((item) => item.name),
      firstLine: Math.min(...items.map((item) => item.line)),
    }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
}

function buildDependencyFileGroups(edges: DependencyEdge[]): DependencyFileGroup[] {
  const grouped = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!grouped.has(edge.from)) {
      grouped.set(edge.from, new Set<string>());
    }
    grouped.get(edge.from)!.add(edge.to);
  }
  return [...grouped.entries()]
    .map(([from, targets]) => ({
      from,
      targets: [...targets].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => right.targets.length - left.targets.length || left.from.localeCompare(right.from));
}

function appendPagination(
  lines: string[],
  toolName: string,
  baseArgs: Record<string, any>,
  page: { start: number; end: number; hasMore: boolean; items: unknown[] },
  offset: number,
  limit: number,
): void {
  if (!(page.start > 0 || page.hasMore)) return;
  if (lines[lines.length - 1] !== 'Удобные следующие шаги:') {
    lines.push('');
    lines.push('Удобные следующие шаги:');
  }
  if (page.start > 0) {
    lines.push(`- предыдущая страница: ${buildToolCall(toolName, { ...baseArgs, offset: Math.max(0, offset - limit) })}`);
  }
  if (page.hasMore) {
    lines.push(`- следующая страница: ${buildToolCall(toolName, { ...baseArgs, offset: offset + page.items.length })}`);
  }
}

function buildEmptyPageMessage(
  toolName: string,
  baseArgs: Record<string, any>,
  offset: number,
  limit: number,
  label: string,
): string {
  return [
    `${label}: страница с offset=${offset} пуста.`,
    '',
    `Попробуй меньший offset: ${buildToolCall(toolName, { ...baseArgs, offset: Math.max(0, offset - limit) })}`,
  ].join('\n');
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

function nearestStartLine(items: Array<{ line: number }>): number {
  return Math.max(1, Math.min(...items.map((item) => item.line)) - 8);
}

function nearestEndLine(items: Array<{ line: number }>): number {
  return Math.max(...items.map((item) => item.line)) + 20;
}

function buildToolCall(toolName: string, args: Record<string, any>): string {
  return JSON.stringify({ tool: toolName, args: compactArgs(args) });
}

function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function compactArgs(args: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined && value !== ''),
  );
}
