import { buildFileTree } from '../../core/utils';
import type { StructuredPresentationSection } from './presentationItems';

const DEFAULT_LIST_LIMIT = 120;
const DEFAULT_SEARCH_LIMIT = 100;
const MAX_LIST_LIMIT = 240;
const MAX_SEARCH_LIMIT = 200;

export type FileListOutputMode = 'tree' | 'flat' | 'dirs';
export type FileSearchOutputMode = 'flat' | 'grouped';

export interface FileCollectionPresentation {
  toolName: 'list_files' | 'glob' | 'find_files';
  outputMode: FileListOutputMode | FileSearchOutputMode;
  resultCount: number;
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  path?: string;
  pattern?: string;
  sections?: StructuredPresentationSection[];
}

export function normalizeFileListOutputMode(value: any): FileListOutputMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'dirs' || mode === 'directories' || mode === 'folders' || mode === 'grouped') return 'dirs';
  if (mode === 'list' || mode === 'files' || mode === 'flat') return 'flat';
  return 'tree';
}

export function normalizeListPagination(args: any): { limit: number; offset: number } {
  return normalizePagination(args, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
}

export function normalizeSearchPagination(
  args: any,
  defaultLimit = DEFAULT_SEARCH_LIMIT,
  minLimit = 1,
  maxLimit = MAX_SEARCH_LIMIT,
): { limit: number; offset: number } {
  const normalized = normalizePagination(args, defaultLimit, maxLimit);
  return {
    limit: Math.max(minLimit, normalized.limit),
    offset: normalized.offset,
  };
}

export function normalizeFileSearchOutputMode(value: any): FileSearchOutputMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'grouped' || mode === 'dirs' || mode === 'directories' || mode === 'folders') return 'grouped';
  return 'flat';
}

export function buildListFilesPresentation(options: {
  paths: string[];
  rawTarget?: string;
  outputMode: FileListOutputMode;
  limit: number;
  offset: number;
  content?: string;
}): FileCollectionPresentation {
  const label = options.rawTarget || 'workspace';
  const summary = options.paths.length === 0
    ? 'Файлы не найдены'
    : options.outputMode === 'dirs'
      ? 'Собрал обзор директорий'
      : options.outputMode === 'flat'
        ? 'Подготовил список файлов'
        : 'Обновил дерево файлов';
  const detailParts = [
    `${options.paths.length} файлов`,
    `область: ${label}`,
    options.offset > 0 ? `offset ${options.offset}` : '',
    options.outputMode === 'tree' ? 'tree-view' : options.outputMode,
  ].filter(Boolean);
  const firstPath = options.paths[0];

  return {
    toolName: 'list_files',
    outputMode: options.outputMode,
    resultCount: options.paths.length,
    summary,
    detail: detailParts.join(' • '),
    ...(options.content && options.content.length <= 4000 ? { preview: options.content } : {}),
    ...(firstPath ? { nextStep: `Открой первый файл обзорно: ${buildToolCall('read_file', { path: firstPath, outputMode: 'outline' })}` } : {}),
    ...(options.rawTarget ? { path: options.rawTarget } : {}),
    sections: buildListFilesSections(options.paths, options.rawTarget, options.outputMode, options.limit, options.offset),
  };
}

export function buildFileSearchPresentation(options: {
  toolName: 'glob' | 'find_files';
  paths: string[];
  pattern: string;
  rawTarget?: string;
  outputMode: FileSearchOutputMode;
  limit: number;
  offset: number;
  maybeMore?: boolean;
  content?: string;
}): FileCollectionPresentation {
  const summary = options.paths.length === 0
    ? 'Файлы не найдены'
    : options.outputMode === 'grouped'
      ? 'Сгруппировал файлы по директориям'
      : options.toolName === 'glob'
        ? 'Нашёл файлы по маске'
        : 'Нашёл подходящие файлы';
  const detailParts = [
    `"${options.pattern}"`,
    `${options.paths.length} файлов`,
    options.rawTarget ? `область: ${options.rawTarget}` : '',
    options.maybeMore ? 'выдача может быть неполной' : '',
    options.offset > 0 ? `offset ${options.offset}` : '',
    options.outputMode,
  ].filter(Boolean);
  const firstPath = options.paths[0];

  return {
    toolName: options.toolName,
    outputMode: options.outputMode,
    resultCount: options.paths.length,
    summary,
    detail: detailParts.join(' • '),
    ...(options.content && options.content.length <= 4000 ? { preview: options.content } : {}),
    ...(firstPath ? { nextStep: `Открой первый файл обзорно: ${buildToolCall('read_file', { path: firstPath, outputMode: 'outline' })}` } : {}),
    pattern: options.pattern,
    ...(options.rawTarget ? { path: options.rawTarget } : {}),
    sections: buildFileSearchSections(options.paths, options.outputMode, options.limit, options.offset),
  };
}

function buildListFilesSections(
  paths: string[],
  rawTarget: string | undefined,
  outputMode: FileListOutputMode,
  limit: number,
  offset: number,
): StructuredPresentationSection[] {
  if (paths.length === 0) return [];

  if (outputMode === 'dirs') {
    const groups = buildImmediateChildGroups(paths, rawTarget).slice(offset, offset + Math.min(limit, 6));
    if (groups.length === 0) return [];
    return [{
      title: 'Элементы',
      items: groups.map((group) => ({
        title: `${group.kind === 'dir' ? '[dir]' : '[file]'} ${group.name}`,
        subtitle: group.kind === 'dir'
          ? `${group.count} ${pluralizeRu(group.count, 'файл', 'файла', 'файлов')}`
          : group.path,
        meta: group.samples.length > 0 ? group.samples.join(', ') : '',
      })),
    }];
  }

  const page = slicePaths(paths, offset, Math.min(limit, 6)).items;
  if (page.length === 0) return [];
  return [{
    title: 'Файлы',
    items: page.map((filePath) => ({
      title: filePath,
      subtitle: normalizeParentDir(filePath) || 'workspace',
    })),
  }];
}

function buildFileSearchSections(
  paths: string[],
  outputMode: FileSearchOutputMode,
  limit: number,
  offset: number,
): StructuredPresentationSection[] {
  if (paths.length === 0) return [];

  if (outputMode === 'grouped') {
    const groups = buildDirectoryGroups(paths).slice(offset, offset + Math.min(limit, 6));
    if (groups.length === 0) return [];
    return [{
      title: 'Директории',
      items: groups.map((group) => ({
        title: group.dir,
        subtitle: `${group.count} ${pluralizeRu(group.count, 'файл', 'файла', 'файлов')}`,
        meta: group.samples.join(', '),
      })),
    }];
  }

  const page = slicePaths(paths, offset, Math.min(limit, 6)).items;
  if (page.length === 0) return [];
  return [{
    title: 'Файлы',
    items: page.map((filePath) => ({
      title: filePath,
      subtitle: normalizeParentDir(filePath) || 'workspace',
    })),
  }];
}

export function buildListFilesOutput(
  paths: string[],
  options: {
    rawTarget?: string;
    outputMode?: FileListOutputMode;
    limit: number;
    offset: number;
  },
): string {
  const sorted = [...paths].sort((left, right) => left.localeCompare(right));
  const requestedMode = options.outputMode || 'tree';
  const effectiveMode = requestedMode === 'tree' && options.offset <= 0 ? 'tree' : 'flat';
  const label = options.rawTarget ? `"${options.rawTarget}"` : 'workspace';

  if (sorted.length === 0) {
    return options.rawTarget
      ? `Файлы в ${label} не найдены.`
      : 'Файлы в workspace не найдены.';
  }

  if (effectiveMode === 'tree') {
    const page = slicePaths(sorted, 0, options.limit);
    const tree = buildFileTree(page.items, Math.min(700, Math.max(160, page.items.length * 4)));
    const lines = [
      `Файлы в ${label}: ${sorted.length} всего${page.hasMore ? `, дерево построено по первым ${page.items.length}` : ''}.`,
      '',
      tree,
    ];

    if (page.hasMore) {
      lines.push('');
      lines.push('Удобные следующие шаги:');
      lines.push(`- следующая страница списком: ${buildToolCall('list_files', { ...pathArg(options.rawTarget), outputMode: 'flat', limit: options.limit, offset: options.limit })}`);
      lines.push(`- увеличить лимит дерева: ${buildToolCall('list_files', { ...pathArg(options.rawTarget), outputMode: 'tree', limit: Math.min(MAX_LIST_LIMIT, options.limit + 80) })}`);
    }

    return lines.join('\n');
  }

  if (requestedMode === 'dirs') {
    return buildDirectoryOverviewOutput(sorted, options);
  }

  const flatPrefix = requestedMode === 'tree' && options.offset > 0
    ? 'Tree-режим с offset неудобен, поэтому показан плоский список.'
    : '';

  return buildPaginatedPathOutput(sorted, {
    toolName: 'list_files',
    title: `Файлы в ${label}`,
    intro: flatPrefix,
    baseArgs: {
      ...pathArg(options.rawTarget),
      outputMode: 'flat',
      limit: options.limit,
    },
    offset: options.offset,
    limit: options.limit,
  });
}

function buildDirectoryOverviewOutput(
  paths: string[],
  options: {
    rawTarget?: string;
    outputMode?: FileListOutputMode;
    limit: number;
    offset: number;
  },
): string {
  const groups = buildImmediateChildGroups(paths, options.rawTarget);
  const page = sliceGroups(groups, options.offset, options.limit);
  const label = options.rawTarget ? `"${options.rawTarget}"` : 'workspace';
  const lines = [
    `Содержимое ${label}: показаны элементы ${page.start + 1}–${page.end}${!page.hasMore ? ` из ${groups.length}` : ''}.`,
    '',
    'Директории и файлы первого уровня:',
  ];

  for (const group of page.items) {
    if (group.kind === 'dir') {
      lines.push(`- [dir] ${group.name} — ${group.count} файлов`);
      if (group.samples.length > 0) {
        lines.push(`  примеры: ${group.samples.join(', ')}`);
      }
    } else {
      lines.push(`- [file] ${group.name}`);
    }
  }

  const firstDir = page.items.find((item) => item.kind === 'dir');
  const firstFile = page.items.find((item) => item.kind === 'file');
  if (firstDir || firstFile) {
    lines.push('');
    lines.push('Удобные следующие шаги:');
    if (firstDir) {
      lines.push(`- открыть первую директорию списком: ${buildToolCall('list_files', { ...pathArg(firstDir.path), outputMode: 'flat', limit: 60 })}`);
      lines.push(`- построить дерево первой директории: ${buildToolCall('list_files', { ...pathArg(firstDir.path), outputMode: 'tree', limit: 120 })}`);
    }
    if (firstFile) {
      lines.push(`- открыть первый файл обзорно: ${buildToolCall('read_file', { path: firstFile.path, outputMode: 'outline' })}`);
    }
  }

  const nav: string[] = [];
  if (page.start > 0) {
    nav.push(`- предыдущая страница: ${buildToolCall('list_files', { ...pathArg(options.rawTarget), outputMode: 'dirs', limit: options.limit, offset: Math.max(0, page.start - options.limit) })}`);
  }
  if (page.hasMore) {
    nav.push(`- следующая страница: ${buildToolCall('list_files', { ...pathArg(options.rawTarget), outputMode: 'dirs', limit: options.limit, offset: page.start + page.items.length })}`);
  }
  if (nav.length > 0) {
    lines.push(...nav);
  }

  lines.push(`- переключиться на плоский список: ${buildToolCall('list_files', { ...pathArg(options.rawTarget), outputMode: 'flat', limit: options.limit, offset: 0 })}`);
  return lines.join('\n');
}

export function buildFileSearchOutput(
  toolName: 'glob' | 'find_files',
  paths: string[],
  options: {
    pattern: string;
    rawTarget?: string;
    outputMode?: FileSearchOutputMode;
    limit: number;
    offset: number;
    maybeMore?: boolean;
  },
): string {
  const label = options.rawTarget
    ? `"${options.pattern}" в ${JSON.stringify(options.rawTarget)}`
    : `"${options.pattern}"`;
  const knownTotal = paths.length;
  const title = `Файлы по ${label}${options.maybeMore ? ` (найдено не менее ${knownTotal})` : ` (${knownTotal})`}`;

  if (knownTotal === 0) {
    return `Файлы по "${options.pattern}"${options.rawTarget ? ` в ${options.rawTarget}` : ''} не найдены.`;
  }

  if ((options.outputMode || 'flat') === 'grouped') {
    return buildGroupedFileSearchOutput(toolName, paths, options);
  }

  return buildPaginatedPathOutput(paths, {
    toolName,
    title,
    intro: 'Новые файлы показаны первыми.',
    baseArgs: {
      ...(toolName === 'glob'
        ? { glob_pattern: options.pattern }
        : { pattern: options.pattern }),
      ...targetDirArg(options.rawTarget),
      limit: options.limit,
    },
    offset: options.offset,
    limit: options.limit,
    maybeMore: options.maybeMore,
  });
}

function buildGroupedFileSearchOutput(
  toolName: 'glob' | 'find_files',
  paths: string[],
  options: {
    pattern: string;
    rawTarget?: string;
    outputMode?: FileSearchOutputMode;
    limit: number;
    offset: number;
    maybeMore?: boolean;
  },
): string {
  const groups = buildDirectoryGroups(paths);
  const page = sliceGroups(groups, options.offset, options.limit);
  const label = options.rawTarget
    ? `"${options.pattern}" в ${JSON.stringify(options.rawTarget)}`
    : `"${options.pattern}"`;
  const lines = [
    `Результаты по ${label}: показаны директории ${page.start + 1}–${page.end}${!options.maybeMore && !page.hasMore ? ` из ${groups.length}` : ''}.`,
    '',
    'Топ-директории по совпадениям:',
  ];

  for (const group of page.items) {
    lines.push(`- ${group.dir} — ${group.count} файлов`);
    lines.push(`  примеры: ${group.samples.join(', ')}`);
  }

  const first = page.items[0];
  if (first) {
    lines.push('');
    lines.push('Удобные следующие шаги:');
    lines.push(`- посмотреть файлы в первой директории: ${buildToolCall('list_files', { path: first.dir === '.' ? '' : first.dir, outputMode: 'flat', limit: 60 })}`);
    lines.push(`- переключиться на плоский список: ${buildToolCall(toolName, { ...(toolName === 'glob' ? { glob_pattern: options.pattern } : { pattern: options.pattern }), ...targetDirArg(options.rawTarget), outputMode: 'flat', limit: options.limit, offset: 0 })}`);
  }

  if (page.start > 0 || page.hasMore || options.maybeMore) {
    const nav: string[] = [];
    if (page.start > 0) {
      nav.push(`- предыдущая страница директорий: ${buildToolCall(toolName, { ...(toolName === 'glob' ? { glob_pattern: options.pattern } : { pattern: options.pattern }), ...targetDirArg(options.rawTarget), outputMode: 'grouped', limit: options.limit, offset: Math.max(0, page.start - options.limit) })}`);
    }
    if (page.hasMore || options.maybeMore) {
      nav.push(`- следующая страница директорий: ${buildToolCall(toolName, { ...(toolName === 'glob' ? { glob_pattern: options.pattern } : { pattern: options.pattern }), ...targetDirArg(options.rawTarget), outputMode: 'grouped', limit: options.limit, offset: page.start + page.items.length })}`);
    }
    if (nav.length > 0) {
      lines.push(...nav);
    }
  }

  return lines.join('\n');
}

function buildPaginatedPathOutput(
  paths: string[],
  options: {
    toolName: 'list_files' | 'glob' | 'find_files';
    title: string;
    intro?: string;
    baseArgs: Record<string, any>;
    offset: number;
    limit: number;
    maybeMore?: boolean;
  },
): string {
  const page = slicePaths(paths, options.offset, options.limit);
  if (page.items.length === 0) {
    const lines = [`${options.title}: страница пуста.`];
    if (options.offset > 0) {
      lines.push('');
      lines.push(`Попробуй меньший offset: ${buildToolCall(options.toolName, { ...options.baseArgs, offset: Math.max(0, options.offset - options.limit) })}`);
    }
    return lines.join('\n');
  }

  const rangeLabel = `${page.start + 1}–${page.end}`;
  const header = `${options.title}: показаны ${rangeLabel}${!options.maybeMore && !page.hasMore ? ` из ${paths.length}` : ''}.`;
  const lines = [header];
  if (options.intro) {
    lines.push('');
    lines.push(options.intro);
  }
  lines.push('');
  lines.push(page.items.join('\n'));

  const nextOffset = page.start + page.items.length;
  const previousOffset = Math.max(0, page.start - options.limit);
  const nav: string[] = [];
  if (page.start > 0) {
    nav.push(`- предыдущая страница: ${buildToolCall(options.toolName, { ...options.baseArgs, offset: previousOffset })}`);
  }
  if (page.hasMore || options.maybeMore) {
    nav.push(`- следующая страница: ${buildToolCall(options.toolName, { ...options.baseArgs, offset: nextOffset })}`);
  }

  if (nav.length > 0) {
    lines.push('');
    lines.push('Удобные следующие шаги:');
    lines.push(...nav);
  }

  const firstPath = page.items[0];
  if (firstPath) {
    const parentDir = normalizeParentDir(firstPath);
    lines.push('');
    lines.push('Полезные следующие шаги:');
    lines.push(`- открыть первый файл обзорно: ${buildToolCall('read_file', { path: firstPath, outputMode: 'outline' })}`);
    if (parentDir) {
      lines.push(`- посмотреть соседние файлы: ${buildToolCall('list_files', { path: parentDir, outputMode: 'flat', limit: 60 })}`);
    }
  }

  return lines.join('\n');
}

function buildDirectoryGroups(paths: string[]): Array<{ dir: string; count: number; samples: string[] }> {
  const groups = new Map<string, { count: number; samples: string[] }>();
  for (const filePath of paths) {
    const dir = normalizeParentDir(filePath) || '.';
    const entry = groups.get(dir) || { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 3) {
      entry.samples.push(filePath.split('/').pop() || filePath);
    }
    groups.set(dir, entry);
  }

  return [...groups.entries()]
    .map(([dir, info]) => ({ dir, count: info.count, samples: info.samples }))
    .sort((left, right) => right.count - left.count || left.dir.localeCompare(right.dir));
}

function buildImmediateChildGroups(
  paths: string[],
  rawTarget?: string,
): Array<{ kind: 'dir' | 'file'; name: string; path: string; count: number; samples: string[] }> {
  const normalizedTarget = normalizeTarget(rawTarget);
  const groups = new Map<string, { kind: 'dir' | 'file'; name: string; path: string; count: number; samples: string[] }>();

  for (const fullPath of paths) {
    const relative = normalizedTarget && fullPath.startsWith(`${normalizedTarget}/`)
      ? fullPath.slice(normalizedTarget.length + 1)
      : normalizedTarget === fullPath
        ? ''
        : fullPath;
    if (!relative) continue;

    const parts = relative.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    const name = parts[0];
    const isDir = parts.length > 1;
    const key = `${isDir ? 'dir' : 'file'}:${name}`;
    const existing = groups.get(key) || {
      kind: isDir ? 'dir' : 'file',
      name,
      path: normalizedTarget ? `${normalizedTarget}/${name}` : name,
      count: 0,
      samples: [],
    };

    if (isDir) {
      existing.count++;
      if (existing.samples.length < 3) {
        existing.samples.push(parts.slice(1).join('/'));
      }
    } else {
      existing.count = 1;
    }

    groups.set(key, existing);
  }

  return [...groups.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
    if (right.count !== left.count) return right.count - left.count;
    return left.name.localeCompare(right.name);
  });
}

function sliceGroups<T>(items: T[], offset: number, limit: number): { items: T[]; start: number; end: number; hasMore: boolean } {
  const start = Math.max(0, offset);
  const page = items.slice(start, start + limit);
  return {
    items: page,
    start,
    end: start + page.length,
    hasMore: start + page.length < items.length,
  };
}

function normalizePagination(
  args: any,
  defaultLimit: number,
  maxLimit: number,
): { limit: number; offset: number } {
  const limit = clampPositiveInt(
    args?.head_limit ?? args?.limit ?? args?.maxResults,
    defaultLimit,
    maxLimit,
  );
  const offset = Math.max(0, toInt(args?.offset, 0));
  return { limit, offset };
}

function slicePaths(
  paths: string[],
  offset: number,
  limit: number,
): { items: string[]; start: number; end: number; hasMore: boolean } {
  const start = Math.max(0, offset);
  const items = paths.slice(start, start + limit);
  return {
    items,
    start,
    end: start + items.length,
    hasMore: start + items.length < paths.length,
  };
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

function pathArg(rawTarget: string | undefined): Record<string, any> {
  return rawTarget ? { path: rawTarget } : {};
}

function targetDirArg(rawTarget: string | undefined): Record<string, any> {
  return rawTarget ? { target_directory: rawTarget } : {};
}

function normalizeParentDir(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function normalizeTarget(value: string | undefined): string {
  return String(value || '').replace(/^\.?\//, '').replace(/\/+$/, '');
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
