import type { ProjectStructureOverview } from '../../core/types';
import type { StructuredPresentationSection } from './presentationItems';

export type StructureOutputMode = 'overview' | 'dirs' | 'important_files';
export type StackOutputMode = 'summary' | 'entrypoints' | 'infra';

export interface ProjectStudyPresentation {
  toolName: 'scan_structure' | 'detect_stack';
  outputMode: StructureOutputMode | StackOutputMode;
  resultCount: number;
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  sections?: StructuredPresentationSection[];
}

export type InfraEntry = {
  label: string;
  path: string;
};

export function normalizeStructureOutputMode(value: any): StructureOutputMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'dirs' || mode === 'directories') return 'dirs';
  if (mode === 'important_files' || mode === 'files' || mode === 'important') return 'important_files';
  return 'overview';
}

export function normalizeStackOutputMode(value: any): StackOutputMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'entrypoints' || mode === 'entries' || mode === 'entry_files') return 'entrypoints';
  if (mode === 'infra' || mode === 'infrastructure') return 'infra';
  return 'summary';
}

export function buildStructureScanOutput(
  overviews: ProjectStructureOverview[],
  options: {
    outputMode: StructureOutputMode;
    limit: number;
    offset: number;
  },
): string {
  if (overviews.length === 0) return '(workspace пуст)';

  if (options.outputMode === 'dirs') {
    return buildStructureDirectoriesOutput(overviews, options.limit, options.offset);
  }
  if (options.outputMode === 'important_files') {
    return buildImportantFilesOutput(overviews, options.limit, options.offset);
  }
  return buildStructureOverviewOutput(overviews);
}

export function buildStackDetectionOutput(
  info: {
    languageGuesses: string[];
    entryFiles: string[];
    infraEntries: InfraEntry[];
  },
  options: {
    outputMode: StackOutputMode;
    limit: number;
    offset: number;
  },
): string {
  if (options.outputMode === 'entrypoints') {
    return buildEntryPointsOutput(info.entryFiles, options.limit, options.offset);
  }
  if (options.outputMode === 'infra') {
    return buildInfraOutput(info.infraEntries, options.limit, options.offset);
  }
  return buildStackSummaryOutput(info);
}

export function buildStructureScanPresentation(
  overviews: ProjectStructureOverview[],
  options: {
    outputMode: StructureOutputMode;
    limit: number;
    offset: number;
    content?: string;
  },
): ProjectStudyPresentation {
  const topDirectoryCount = overviews.reduce((sum, overview) => sum + overview.topDirectories.length, 0);
  const importantFileCount = overviews.reduce((sum, overview) => sum + overview.importantFiles.length, 0);
  const firstDir = overviews.flatMap((overview) => overview.topDirectories.map((directory) => directory.name))[0];
  const summary = overviews.length === 0
    ? 'Структура проекта не найдена'
    : options.outputMode === 'dirs'
      ? 'Собрал список ключевых папок'
      : options.outputMode === 'important_files'
        ? 'Собрал важные файлы проекта'
        : 'Обновил обзор структуры проекта';
  const detail = [
    `${overviews.length} корней`,
    `${topDirectoryCount} папок`,
    `${importantFileCount} важных файлов`,
    options.offset > 0 ? `offset ${options.offset}` : '',
    options.outputMode,
  ].filter(Boolean).join(' • ');
  const preview = options.content && options.content.length <= 4000 ? options.content : undefined;
  const nextStep = firstDir
    ? `Открой дерево главной папки: ${buildToolCall('list_files', { path: firstDir, outputMode: 'tree', limit: 120 })}`
    : `Посмотри стек и точки входа: ${buildToolCall('detect_stack', { outputMode: 'summary' })}`;

  return {
    toolName: 'scan_structure',
    outputMode: options.outputMode,
    resultCount: options.outputMode === 'important_files' ? importantFileCount : topDirectoryCount || overviews.length,
    summary,
    detail,
    ...(preview ? { preview } : {}),
    nextStep,
    sections: buildStructureScanSections(overviews, options.outputMode, options.limit, options.offset),
  };
}

export function buildStackDetectionPresentation(
  info: {
    languageGuesses: string[];
    entryFiles: string[];
    infraEntries: InfraEntry[];
  },
  options: {
    outputMode: StackOutputMode;
    limit: number;
    offset: number;
    content?: string;
  },
): ProjectStudyPresentation {
  const summary = info.entryFiles.length === 0 && info.infraEntries.length === 0 && info.languageGuesses.length === 0
    ? 'Стек проекта не определён'
    : options.outputMode === 'entrypoints'
      ? 'Собрал точки входа проекта'
      : options.outputMode === 'infra'
        ? 'Собрал инфраструктурные файлы'
        : 'Определил стек проекта';
  const detail = [
    `${info.languageGuesses.length} языков`,
    `${info.entryFiles.length} entrypoints`,
    `${info.infraEntries.length} infra-файлов`,
    options.offset > 0 ? `offset ${options.offset}` : '',
    options.outputMode,
  ].filter(Boolean).join(' • ');
  const preview = options.content && options.content.length <= 4000 ? options.content : undefined;
  const nextStep = info.entryFiles[0]
    ? `Прочитай первый entrypoint: ${buildToolCall('read_file', { path: info.entryFiles[0], outputMode: 'outline' })}`
    : info.infraEntries[0]
      ? `Прочитай первый infra-файл: ${buildToolCall('read_file', { path: info.infraEntries[0].path, outputMode: 'outline' })}`
      : undefined;

  return {
    toolName: 'detect_stack',
    outputMode: options.outputMode,
    resultCount: options.outputMode === 'entrypoints'
      ? info.entryFiles.length
      : options.outputMode === 'infra'
        ? info.infraEntries.length
        : info.languageGuesses.length + info.entryFiles.length + info.infraEntries.length,
    summary,
    detail,
    ...(preview ? { preview } : {}),
    ...(nextStep ? { nextStep } : {}),
    sections: buildStackDetectionSections(info, options.outputMode, options.limit, options.offset),
  };
}

function buildStructureScanSections(
  overviews: ProjectStructureOverview[],
  outputMode: StructureOutputMode,
  limit: number,
  offset: number,
): StructuredPresentationSection[] {
  if (overviews.length === 0) return [];

  const dirs = overviews.flatMap((overview) =>
    overview.topDirectories.map((directory) => ({
      title: `${overview.rootName}/${directory.name}/`,
      subtitle: `~${directory.count} ${pluralizeRu(directory.count, 'файл', 'файла', 'файлов')}`,
    })),
  );
  const files = overviews.flatMap((overview) =>
    overview.importantFiles.map((file) => ({
      title: file,
      subtitle: overview.rootName,
    })),
  );

  if (outputMode === 'dirs') {
    return dirs.length > 0 ? [{ title: 'Топ-папки', items: dirs.slice(offset, offset + Math.min(limit, 6)) }] : [];
  }
  if (outputMode === 'important_files') {
    return files.length > 0 ? [{ title: 'Важные файлы', items: files.slice(offset, offset + Math.min(limit, 6)) }] : [];
  }

  const sections: StructuredPresentationSection[] = [];
  if (dirs.length > 0) {
    sections.push({ title: 'Топ-папки', items: dirs.slice(0, 6) });
  }
  if (files.length > 0) {
    sections.push({ title: 'Важные файлы', items: files.slice(0, 6) });
  }
  return sections;
}

function buildStackDetectionSections(
  info: {
    languageGuesses: string[];
    entryFiles: string[];
    infraEntries: InfraEntry[];
  },
  outputMode: StackOutputMode,
  limit: number,
  offset: number,
): StructuredPresentationSection[] {
  const entryItems = info.entryFiles.map((file) => ({ title: file }));
  const infraItems = info.infraEntries.map((entry) => ({
    title: entry.label,
    subtitle: entry.path,
  }));

  if (outputMode === 'entrypoints') {
    return entryItems.length > 0 ? [{ title: 'Точки входа', items: entryItems.slice(offset, offset + Math.min(limit, 6)) }] : [];
  }
  if (outputMode === 'infra') {
    return infraItems.length > 0 ? [{ title: 'Инфраструктура', items: infraItems.slice(offset, offset + Math.min(limit, 6)) }] : [];
  }

  const sections: StructuredPresentationSection[] = [];
  if (entryItems.length > 0) {
    sections.push({ title: 'Точки входа', items: entryItems.slice(0, 6) });
  }
  if (infraItems.length > 0) {
    sections.push({ title: 'Инфраструктура', items: infraItems.slice(0, 6) });
  }
  return sections;
}

function buildStructureOverviewOutput(overviews: ProjectStructureOverview[]): string {
  const lines: string[] = [];
  for (const overview of overviews) {
    lines.push(`Корень: ${overview.rootName}`);
    if (overview.topDirectories.length > 0) {
      lines.push(`- Топ-папки: ${overview.topDirectories.slice(0, 5).map((directory) => `${directory.name}/ (~${directory.count})`).join(', ')}`);
    } else {
      lines.push('- Топ-папки: не найдены');
    }
    if (overview.importantFiles.length > 0) {
      lines.push(`- Важные файлы: ${overview.importantFiles.slice(0, 6).join(', ')}`);
    }
    lines.push('');
  }

  lines.push('Удобные следующие шаги:');
  lines.push(`- подробный список топ-папок: ${buildToolCall('scan_structure', { outputMode: 'dirs', limit: 20, offset: 0 })}`);
  lines.push(`- важные файлы проекта: ${buildToolCall('scan_structure', { outputMode: 'important_files', limit: 30, offset: 0 })}`);
  lines.push(`- стек и точки входа: ${buildToolCall('detect_stack', { outputMode: 'summary' })}`);

  const firstDir = overviews.flatMap((overview) => overview.topDirectories.map((directory) => directory.name))[0];
  if (firstDir) {
    lines.push(`- открыть дерево главной папки: ${buildToolCall('list_files', { path: firstDir, outputMode: 'tree', limit: 120 })}`);
  }

  return trimTrailingBlankLines(lines).join('\n');
}

function buildStructureDirectoriesOutput(
  overviews: ProjectStructureOverview[],
  limit: number,
  offset: number,
): string {
  const items = overviews.flatMap((overview) =>
    overview.topDirectories.map((directory) => ({
      root: overview.rootName,
      name: directory.name,
      count: directory.count,
    })),
  );
  const page = paginate(items, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage('scan_structure', { outputMode: 'dirs', limit }, offset, limit);
  }

  const lines = [`Топ-папки: показаны ${page.start + 1}–${page.end} из ${items.length}.`, ''];
  for (const item of page.items) {
    lines.push(`- ${item.root}/${item.name}/ — ~${item.count} файлов`);
  }
  lines.push('');
  lines.push('Удобные следующие шаги:');
  const first = page.items[0];
  if (first) {
    lines.push(`- открыть дерево ${first.name}/: ${buildToolCall('list_files', { path: first.name, outputMode: 'tree', limit: 120 })}`);
  }
  appendPagination(lines, 'scan_structure', { outputMode: 'dirs', limit }, page, offset, limit);
  return trimTrailingBlankLines(lines).join('\n');
}

function buildImportantFilesOutput(
  overviews: ProjectStructureOverview[],
  limit: number,
  offset: number,
): string {
  const items = overviews.flatMap((overview) =>
    overview.importantFiles.map((file) => ({
      root: overview.rootName,
      file,
    })),
  );
  if (items.length === 0) return 'Важные файлы не найдены.';

  const page = paginate(items, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage('scan_structure', { outputMode: 'important_files', limit }, offset, limit);
  }

  const lines = [`Важные файлы: показаны ${page.start + 1}–${page.end} из ${items.length}.`, ''];
  for (const item of page.items) {
    lines.push(`- ${item.file}${item.root ? ` (${item.root})` : ''}`);
  }
  lines.push('');
  lines.push('Удобные следующие шаги:');
  const first = page.items[0];
  if (first) {
    lines.push(`- прочитать первый важный файл: ${buildToolCall('read_file', { path: first.file })}`);
  }
  appendPagination(lines, 'scan_structure', { outputMode: 'important_files', limit }, page, offset, limit);
  return trimTrailingBlankLines(lines).join('\n');
}

function buildStackSummaryOutput(info: {
  languageGuesses: string[];
  entryFiles: string[];
  infraEntries: InfraEntry[];
}): string {
  const lines: string[] = [];

  if (info.languageGuesses.length > 0) {
    lines.push(`Стек: ${info.languageGuesses.join(', ')}`);
  } else {
    lines.push('Стек: не определён');
  }

  if (info.entryFiles.length > 0) {
    lines.push(`Точки входа: ${info.entryFiles.slice(0, 5).join(', ')}`);
  } else {
    lines.push('Точки входа: не найдены');
  }

  if (info.infraEntries.length > 0) {
    lines.push(`Инфраструктура: ${info.infraEntries.slice(0, 6).map((entry) => `${entry.label} (${entry.path})`).join(', ')}`);
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  if (info.entryFiles[0]) {
    lines.push(`- прочитать первый entrypoint: ${buildToolCall('read_file', { path: info.entryFiles[0] })}`);
  }
  lines.push(`- все entrypoints: ${buildToolCall('detect_stack', { outputMode: 'entrypoints', limit: 20, offset: 0 })}`);
  if (info.infraEntries.length > 0) {
    lines.push(`- инфраструктурные файлы: ${buildToolCall('detect_stack', { outputMode: 'infra', limit: 20, offset: 0 })}`);
  }

  return trimTrailingBlankLines(lines).join('\n');
}

function buildEntryPointsOutput(
  entryFiles: string[],
  limit: number,
  offset: number,
): string {
  if (entryFiles.length === 0) return 'Точки входа не найдены.';
  const page = paginate(entryFiles, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage('detect_stack', { outputMode: 'entrypoints', limit }, offset, limit);
  }

  const lines = [`Точки входа: показаны ${page.start + 1}–${page.end} из ${entryFiles.length}.`, ''];
  for (const file of page.items) {
    lines.push(`- ${file}`);
  }
  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- прочитать первый entrypoint: ${buildToolCall('read_file', { path: page.items[0] })}`);
  appendPagination(lines, 'detect_stack', { outputMode: 'entrypoints', limit }, page, offset, limit);
  return trimTrailingBlankLines(lines).join('\n');
}

function buildInfraOutput(
  infraEntries: InfraEntry[],
  limit: number,
  offset: number,
): string {
  if (infraEntries.length === 0) return 'Инфраструктурные файлы не найдены.';
  const page = paginate(infraEntries, offset, limit);
  if (page.items.length === 0) {
    return buildEmptyPageMessage('detect_stack', { outputMode: 'infra', limit }, offset, limit);
  }

  const lines = [`Инфраструктурные файлы: показаны ${page.start + 1}–${page.end} из ${infraEntries.length}.`, ''];
  for (const entry of page.items) {
    lines.push(`- ${entry.label}: ${entry.path}`);
  }
  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- прочитать первый infra-файл: ${buildToolCall('read_file', { path: page.items[0].path })}`);
  appendPagination(lines, 'detect_stack', { outputMode: 'infra', limit }, page, offset, limit);
  return trimTrailingBlankLines(lines).join('\n');
}

function appendPagination<T>(
  lines: string[],
  toolName: string,
  baseArgs: Record<string, any>,
  page: { start: number; hasMore: boolean; items: T[] },
  offset: number,
  limit: number,
): void {
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
): string {
  return [
    `Страница с offset=${offset} пуста.`,
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

function buildToolCall(toolName: string, args: Record<string, any>): string {
  return JSON.stringify({ tool: toolName, args });
}

function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const result = [...lines];
  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
  return result;
}
