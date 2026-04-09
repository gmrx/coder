import type { GrepMatch } from '../../core/types';
import type { StructuredPresentationSection } from './presentationItems';
import { normalizeOutputMode } from './workspace';

export type GrepOutputMode = 'content' | 'files_with_matches' | 'count';

export interface GrepPresentation {
  pattern: string;
  outputMode: GrepOutputMode;
  matchCount: number;
  fileCount: number;
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  sections?: StructuredPresentationSection[];
}

export function resolveGrepOutputMode(
  args: any,
  options: {
    hasSpecificFiles: boolean;
    hasContextOptions: boolean;
  },
): GrepOutputMode {
  const explicit = args?.outputMode || args?.output_mode;
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    return normalizeOutputMode(explicit);
  }

  if (args?.filesOnly === true) return 'files_with_matches';
  if (options.hasSpecificFiles || options.hasContextOptions) return 'content';
  return 'files_with_matches';
}

export function buildGrepPresentation(options: {
  pattern: string;
  outputMode: GrepOutputMode;
  matches: GrepMatch[];
  counts?: Map<string, number>;
  fileType?: string;
  limit: number;
  offset: number;
  totalAvailable: number;
  filePaths?: string[];
  content?: string;
}): GrepPresentation {
  const counts = options.counts || countMatchesByFile(options.matches);
  const fileCount = options.outputMode === 'count'
    ? [...counts.entries()].filter((entry) => entry[1] > 0).length
    : new Set(options.matches.map((match) => match.file)).size || [...counts.entries()].filter((entry) => entry[1] > 0).length;
  const summary = options.totalAvailable === 0
    ? 'Совпадения не найдены'
    : options.outputMode === 'files_with_matches'
      ? 'Собрал список файлов с совпадениями'
      : options.outputMode === 'count'
        ? 'Собрал частоты совпадений'
        : 'Нашёл совпадения';
  const detailParts = [
    `"${options.pattern}"`,
    `${options.totalAvailable} совпадений`,
    `${fileCount} файлов`,
    options.fileType ? `*.${options.fileType}` : '',
    options.offset > 0 ? `offset ${options.offset}` : '',
  ].filter(Boolean);

  let nextStep: string | undefined;
  const firstMatch = options.matches[0];
  if (firstMatch) {
    nextStep = `Открой первый фрагмент: ${buildToolCall('read_file_range', {
      path: firstMatch.file,
      startLine: Math.max(1, firstMatch.line - 8),
      endLine: firstMatch.line + 24,
    })}`;
  } else {
    const firstCountHit = [...counts.entries()].find((entry) => entry[1] > 0)?.[0];
    if (firstCountHit) {
      nextStep = `Открой первый совпавший файл: ${buildToolCall('read_file', { path: firstCountHit, outputMode: 'outline' })}`;
    }
  }

  const preview = options.content && options.content.length <= 4000
    ? options.content
    : undefined;

  return {
    pattern: options.pattern,
    outputMode: options.outputMode,
    matchCount: options.totalAvailable,
    fileCount,
    summary,
    detail: detailParts.join(' • '),
    ...(preview ? { preview } : {}),
    ...(nextStep ? { nextStep } : {}),
    sections: buildGrepSections(options, counts),
  };
}

function buildGrepSections(
  options: {
    pattern: string;
    outputMode: GrepOutputMode;
    matches: GrepMatch[];
    counts?: Map<string, number>;
    fileType?: string;
    limit: number;
    offset: number;
    totalAvailable: number;
    filePaths?: string[];
    content?: string;
  },
  counts: Map<string, number>,
): StructuredPresentationSection[] {
  if (options.totalAvailable === 0) return [];

  if (options.outputMode === 'content') {
    const items = options.matches.slice(0, 6).map((match) => ({
      title: `${match.file}:L${match.line}`,
      subtitle: extractMatchSnippet(match),
      meta: `контекст с L${match.contextStartLine}`,
    }));
    return items.length > 0 ? [{ title: 'Совпадения', items }] : [];
  }

  const entries = [...counts.entries()]
    .filter((entry) => entry[1] > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const items = entries.slice(0, 6).map(([file, count]) => {
    const firstMatch = options.matches.find((match) => match.file === file);
    return {
      title: file,
      subtitle: `${count} ${pluralizeRu(count, 'совпадение', 'совпадения', 'совпадений')}`,
      meta: firstMatch ? extractMatchSnippet(firstMatch) : '',
    };
  });

  return items.length > 0
    ? [{
      title: options.outputMode === 'count' ? 'Частоты по файлам' : 'Файлы с совпадениями',
      items,
    }]
    : [];
}

export function formatWorkspaceGrepContent(options: {
  pattern: string;
  matches: GrepMatch[];
  limit: number;
  offset: number;
  fileType?: string;
  totalAvailable: number;
  filePaths?: string[];
}): string {
  const { pattern, matches, limit, offset, fileType, totalAvailable, filePaths } = options;
  const grouped = groupMatchesByFile(matches);
  const lines = [
    `Найдено ${matches.length} совпадений по "${pattern}"${fileType ? ` в *.${fileType}` : ''}${offset ? ` (offset: ${offset})` : ''}${totalAvailable > matches.length ? `, показаны первые ${matches.length}` : ''}:`,
  ];

  for (const group of grouped) {
    lines.push('');
    lines.push(`=== ${group.file} (${group.matches.length}) ===`);
    for (const match of group.matches) {
      lines.push(...renderMatch(match));
      lines.push('');
    }
  }

  appendGrepNextSteps(lines, {
    pattern,
    matches,
    limit,
    offset,
    totalAvailable,
    fileType,
    currentMode: 'content',
    filePaths,
  });

  return lines.join('\n').trim();
}

export function formatWorkspaceGrepFilesOnly(options: {
  pattern: string;
  matches: GrepMatch[];
  limit: number;
  offset: number;
  fileType?: string;
  totalAvailable: number;
}): string {
  const { pattern, matches, limit, offset, fileType, totalAvailable } = options;
  const files = [...new Set(matches.map((match) => match.file))].sort();
  const lines = [
    `Найдено в ${files.length} файлах${fileType ? ` (*.${fileType})` : ''}${offset ? ` (offset: ${offset})` : ''}${totalAvailable > matches.length ? `, показаны первые ${files.length}` : ''}:`,
    ...files,
  ];

  appendGrepNextSteps(lines, {
    pattern,
    matches,
    limit,
    offset,
    totalAvailable,
    fileType,
    currentMode: 'files_with_matches',
  });

  return lines.join('\n').trim();
}

export function formatWorkspaceGrepCount(options: {
  pattern: string;
  matches: GrepMatch[];
  limit: number;
  offset: number;
  fileType?: string;
  totalAvailable: number;
}): string {
  const { pattern, matches, limit, offset, fileType, totalAvailable } = options;
  const counts = countMatchesByFile(matches);
  const entries = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const lines = [
    `Совпадения по "${pattern}"${fileType ? ` в *.${fileType}` : ''}: ${matches.length} на этой странице, ${counts.size} файлов${offset ? ` (offset: ${offset})` : ''}${totalAvailable > matches.length ? ', показана часть выдачи' : ''}.`,
  ];

  for (const [file, count] of entries) {
    lines.push(`  ${file}: ${count}`);
  }

  appendGrepNextSteps(lines, {
    pattern,
    matches,
    limit,
    offset,
    totalAvailable,
    fileType,
    currentMode: 'count',
  });

  return lines.join('\n').trim();
}

export function formatSpecificFileGrep(options: {
  pattern: string;
  matches: GrepMatch[];
  counts: Map<string, number>;
  limit: number;
  offset: number;
  outputMode: GrepOutputMode;
  fileType?: string;
  filePaths: string[];
  totalAvailable: number;
}): string {
  const { outputMode } = options;
  if (options.matches.length === 0 && options.counts.size === 0) {
    return `Совпадений по "${options.pattern}" не найдено.`;
  }

  if (outputMode === 'count') {
    const lines = [`Совпадения по "${options.pattern}" в указанных файлах:`];
    for (const [filePath, matchCount] of options.counts.entries()) {
      lines.push(`  ${filePath}: ${matchCount}`);
    }
    appendGrepNextSteps(lines, {
      pattern: options.pattern,
      matches: options.matches,
      limit: options.limit,
      offset: options.offset,
      totalAvailable: options.totalAvailable,
      fileType: options.fileType,
      currentMode: 'count',
      filePaths: options.filePaths,
    });
    return lines.join('\n').trim();
  }

  if (outputMode === 'files_with_matches') {
    const files = [...options.counts.entries()]
      .filter((entry) => entry[1] > 0)
      .map((entry) => entry[0]);
    const lines = [
      `Совпадения по "${options.pattern}" найдены в ${files.length} указанных файлах${options.offset ? ` (offset: ${options.offset})` : ''}:`,
      ...files,
    ];
    appendGrepNextSteps(lines, {
      pattern: options.pattern,
      matches: options.matches,
      limit: options.limit,
      offset: options.offset,
      totalAvailable: options.totalAvailable,
      fileType: options.fileType,
      currentMode: 'files_with_matches',
      filePaths: options.filePaths,
    });
    return lines.join('\n').trim();
  }

  return formatWorkspaceGrepContent({
    pattern: options.pattern,
    matches: options.matches,
    limit: options.limit,
    offset: options.offset,
    fileType: options.fileType,
    totalAvailable: options.totalAvailable,
    filePaths: options.filePaths,
  });
}

function appendGrepNextSteps(
  lines: string[],
  options: {
    pattern: string;
    matches: GrepMatch[];
    limit: number;
    offset: number;
    totalAvailable: number;
    fileType?: string;
    currentMode: GrepOutputMode;
    filePaths?: string[];
  },
): void {
  const {
    pattern,
    matches,
    limit,
    offset,
    totalAvailable,
    fileType,
    currentMode,
    filePaths,
  } = options;

  const steps: string[] = [];
  const first = matches[0];

  if (first) {
    steps.push(
      `- открыть участок вокруг первого совпадения: ${buildToolCall('read_file_range', {
        path: first.file,
        startLine: Math.max(1, first.line - 8),
        endLine: first.line + 24,
      })}`,
    );
  }

  if (currentMode !== 'files_with_matches') {
    steps.push(
      `- переключиться на список файлов: ${buildToolCall('grep', buildGrepArgs({
        pattern,
        fileType,
        filePaths,
        outputMode: 'files_with_matches',
        limit,
        offset: 0,
      }))}`,
    );
  }

  if (currentMode !== 'count') {
    steps.push(
      `- посмотреть частоты по файлам: ${buildToolCall('grep', buildGrepArgs({
        pattern,
        fileType,
        filePaths,
        outputMode: 'count',
        limit: Math.max(limit, 50),
        offset: 0,
      }))}`,
    );
  }

  if (totalAvailable > matches.length) {
    steps.push(
      `- продолжить grep: ${buildToolCall('grep', buildGrepArgs({
        pattern,
        fileType,
        filePaths,
        outputMode: currentMode,
        limit,
        offset: offset + limit,
      }))}`,
    );
  }

  if (steps.length === 0) return;
  lines.push('');
  lines.push('Следующие удобные шаги:');
  lines.push(...steps.slice(0, 4));
}

function buildGrepArgs(options: {
  pattern: string;
  fileType?: string;
  filePaths?: string[];
  outputMode: GrepOutputMode;
  limit: number;
  offset: number;
}): Record<string, unknown> {
  return {
    pattern: options.pattern,
    ...(options.fileType ? { type: options.fileType } : {}),
    ...(options.filePaths && options.filePaths.length > 0 ? { paths: options.filePaths } : {}),
    outputMode: options.outputMode,
    limit: options.limit,
    offset: options.offset,
  };
}

function groupMatchesByFile(matches: GrepMatch[]): Array<{ file: string; matches: GrepMatch[] }> {
  const groups = new Map<string, GrepMatch[]>();
  for (const match of matches) {
    const current = groups.get(match.file) || [];
    current.push(match);
    groups.set(match.file, current);
  }
  return [...groups.entries()].map(([file, groupedMatches]) => ({ file, matches: groupedMatches }));
}

function countMatchesByFile(matches: GrepMatch[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of matches) {
    counts.set(match.file, (counts.get(match.file) || 0) + 1);
  }
  return counts;
}

function renderMatch(match: GrepMatch): string[] {
  const lines = match.context.split('\n');
  return lines.map((line, index) => {
    const lineNumber = match.contextStartLine + index;
    const prefix = lineNumber === match.line ? '>' : ' ';
    return `${prefix} ${lineNumber}| ${line}`;
  });
}

function extractMatchSnippet(match: GrepMatch): string {
  const lines = match.context.split('\n');
  const index = Math.max(0, match.line - match.contextStartLine);
  const raw = lines[index] || lines.find((line) => line.trim()) || '';
  return compactText(raw.trim(), 120);
}

function compactText(text: string, maxLength = 120): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function buildToolCall(tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({ tool, args });
}
