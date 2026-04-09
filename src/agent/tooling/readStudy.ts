import * as path from 'path';
import { MAX_TOOL_RESULT_CHARS } from '../../core/constants';

const DEFAULT_RANGE_SIZE = 120;
const DEFAULT_EDGE_READ_LINES = 120;
const MAX_FULL_READ_LINES = 220;
const MANIFEST_SUMMARY_LINE_THRESHOLD = 90;
const MANIFEST_SUMMARY_CHAR_THRESHOLD = 2500;

export type ReadOutputMode =
  | 'auto'
  | 'outline'
  | 'head'
  | 'tail'
  | 'manifest'
  | 'metadata';

export type ReadPresentationMode =
  | 'full'
  | 'outline'
  | 'head'
  | 'tail'
  | 'manifest'
  | 'metadata'
  | 'binary'
  | 'range';

export interface ReadPresentation {
  toolName: 'read_file' | 'read_file_range';
  path: string;
  mode: ReadPresentationMode;
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  displayedLines?: number;
  totalLines?: number;
  totalChars?: number;
  startLine?: number;
  endLine?: number;
  binary?: boolean;
}

export function normalizeReadOutputMode(value: any): ReadOutputMode {
  const normalized = String(value || 'auto').trim().toLowerCase();
  if (normalized === 'summary' || normalized === 'outline') return 'outline';
  if (normalized === 'head' || normalized === 'start' || normalized === 'top') return 'head';
  if (normalized === 'tail' || normalized === 'end' || normalized === 'bottom') return 'tail';
  if (normalized === 'manifest' || normalized === 'config') return 'manifest';
  if (normalized === 'metadata' || normalized === 'meta' || normalized === 'info') return 'metadata';
  return 'auto';
}

export function buildReadPresentation(input: {
  toolName: 'read_file' | 'read_file_range';
  path: string;
  mode: ReadPresentationMode;
  content: string;
  displayedLines?: number;
  totalLines?: number;
  totalChars?: number;
  startLine?: number;
  endLine?: number;
  binary?: boolean;
  nextStep?: string;
  summary?: string;
  detail?: string;
}): ReadPresentation {
  const summary = input.summary || describeReadSummary(input.mode, input.displayedLines);
  const detailParts = [
    input.path,
    describeReadMode(input.mode),
    Number.isFinite(input.displayedLines) ? `${input.displayedLines} строк` : '',
    Number.isFinite(input.totalLines) ? `всего ${input.totalLines} строк` : '',
    Number.isFinite(input.startLine) && Number.isFinite(input.endLine)
      ? `строки ${input.startLine}-${input.endLine}`
      : '',
    Number.isFinite(input.totalChars) ? `${input.totalChars} символов` : '',
    input.binary ? 'нетекстовый файл' : '',
  ].filter(Boolean);

  return {
    toolName: input.toolName,
    path: input.path,
    mode: input.mode,
    summary,
    detail: [detailParts.join(' • '), input.detail].filter(Boolean).join('\n'),
    ...(input.content && input.content.length <= 4000 ? { preview: input.content } : {}),
    ...(input.nextStep ? { nextStep: input.nextStep } : {}),
    ...(Number.isFinite(input.displayedLines) ? { displayedLines: input.displayedLines } : {}),
    ...(Number.isFinite(input.totalLines) ? { totalLines: input.totalLines } : {}),
    ...(Number.isFinite(input.totalChars) ? { totalChars: input.totalChars } : {}),
    ...(Number.isFinite(input.startLine) ? { startLine: input.startLine } : {}),
    ...(Number.isFinite(input.endLine) ? { endLine: input.endLine } : {}),
    ...(input.binary ? { binary: true } : {}),
  };
}

export function buildSmartReadOutput(
  filePath: string,
  text: string,
  query?: string,
  options: {
    fileSize?: number;
  } = {},
): string {
  const manifestSummary = buildManifestReadOutput(filePath, text, {
    fileSize: options.fileSize,
    autoMode: true,
  });
  if (manifestSummary && shouldPreferManifestSummary(filePath, text)) {
    return manifestSummary;
  }

  const lines = text.split('\n');
  const totalLines = lines.length;
  const totalChars = text.length;

  if (text.length <= MAX_TOOL_RESULT_CHARS && totalLines <= MAX_FULL_READ_LINES) {
    return formatReadWindow(filePath, lines, 1, totalLines, {
      totalChars,
      totalLines,
    });
  }

  const overview = buildOverview(lines, query);
  const suggestedRanges = buildSuggestedRanges(totalLines, query, lines);

  return [
    `${filePath} (${totalLines} строк, ${totalChars} символов)`,
    '',
    'Файл слишком большой для полного чтения за один ход. Ниже — обзор ключевых участков с номерами строк.',
    '',
    overview,
    '',
    buildRangeSuggestionBlock(filePath, suggestedRanges),
  ].join('\n');
}

export function buildExplicitReadOutput(
  filePath: string,
  text: string,
  params: {
    offset?: number;
    limit?: number;
  },
): string {
  const lines = text.split('\n');
  const totalLines = lines.length;
  const totalChars = text.length;
  const offset = Number.isFinite(params.offset) ? Number(params.offset) : undefined;
  const limit = Number.isFinite(params.limit) ? Number(params.limit) : undefined;
  const start = offset !== undefined
    ? (offset < 0 ? Math.max(1, totalLines + offset + 1) : Math.max(1, offset))
    : 1;
  const requestedCount = limit !== undefined && limit > 0
    ? limit
    : totalLines;
  const end = Math.min(totalLines, start + requestedCount - 1);

  return formatReadWindow(filePath, lines, start, end, {
    totalChars,
    totalLines,
    includeNavigation: true,
  });
}

export function buildReadRangeOutput(
  filePath: string,
  text: string,
  params: {
    startLine: number;
    endLine: number;
  },
): string {
  const lines = text.split('\n');
  const totalLines = lines.length;
  const totalChars = text.length;
  const normalized = normalizeRange(totalLines, params.startLine, params.endLine);

  return formatReadWindow(filePath, lines, normalized.startLine, normalized.endLine, {
    totalChars,
    totalLines,
    includeNavigation: true,
  });
}

export function buildHeadReadOutput(
  filePath: string,
  text: string,
  limit = DEFAULT_EDGE_READ_LINES,
): string {
  const lines = text.split('\n');
  return formatReadWindow(filePath, lines, 1, Math.min(lines.length, limit), {
    totalChars: text.length,
    totalLines: lines.length,
    includeNavigation: true,
  });
}

export function buildTailReadOutput(
  filePath: string,
  text: string,
  limit = DEFAULT_EDGE_READ_LINES,
): string {
  const lines = text.split('\n');
  const totalLines = lines.length;
  const normalizedLimit = Math.max(1, Math.floor(limit));
  return formatReadWindow(filePath, lines, Math.max(1, totalLines - normalizedLimit + 1), totalLines, {
    totalChars: text.length,
    totalLines,
    includeNavigation: true,
  });
}

export function buildReadMetadataOutput(
  filePath: string,
  bytes: Uint8Array,
  text?: string,
): string {
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath) || 'без расширения';
  const dirPath = normalizeDirPath(filePath);
  const lines: string[] = [
    `Метаданные файла: ${filePath}`,
    '',
    `Имя: ${fileName}`,
    `Расширение: ${extension}`,
    `Размер: ${formatBytes(bytes.length)}`,
  ];

  if (text !== undefined) {
    const split = text.split('\n');
    lines.push(`Строк: ${split.length}`);
    lines.push(`Символов: ${text.length}`);
    lines.push(`Формат: ${classifyTextFlavor(filePath, text)}`);
  } else {
    lines.push('Формат: вероятно нетекстовый файл');
  }

  lines.push('');
  lines.push('Следующие удобные шаги:');
  if (text !== undefined) {
    lines.push(`- обзор файла: ${buildToolCall('read_file', { path: filePath, outputMode: 'outline' })}`);
    if (looksManifestLike(filePath)) {
      lines.push(`- обзор конфигурации: ${buildToolCall('read_file', { path: filePath, outputMode: 'manifest' })}`);
    }
  } else if (dirPath) {
    lines.push(`- посмотреть соседние файлы: ${buildToolCall('list_files', { path: dirPath, outputMode: 'flat', limit: 40 })}`);
  }

  return lines.join('\n');
}

export function buildBinaryReadOutput(filePath: string, bytes: Uint8Array): string {
  const dirPath = normalizeDirPath(filePath);
  const lines = [
    `Файл похож на нетекстовый: ${filePath}`,
    '',
    `Размер: ${formatBytes(bytes.length)}`,
    `Расширение: ${path.extname(filePath) || 'без расширения'}`,
    'Такой файл неудобно читать построчно. Лучше искать соседние текстовые файлы, manifest/config или исходники рядом.',
    '',
    'Следующие удобные шаги:',
  ];

  if (dirPath) {
    lines.push(`- посмотреть соседние файлы: ${buildToolCall('list_files', { path: dirPath, outputMode: 'flat', limit: 40 })}`);
    lines.push(`- поискать связанные исходники: ${buildToolCall('find_files', { pattern: path.basename(filePath).replace(path.extname(filePath), ''), limit: 20 })}`);
  }

  return lines.join('\n');
}

export function buildManifestReadOutput(
  filePath: string,
  text: string,
  options: {
    fileSize?: number;
    autoMode?: boolean;
  } = {},
): string | null {
  const fileName = path.basename(filePath).toLowerCase();

  if (fileName === 'package.json') {
    return buildPackageJsonSummary(filePath, text);
  }
  if (fileName === 'package-lock.json') {
    return buildPackageLockSummary(filePath, text);
  }
  if (fileName === 'tsconfig.json' || fileName === 'jsconfig.json') {
    return buildTsConfigSummary(filePath, text);
  }
  if (fileName === 'pyproject.toml') {
    return buildPyprojectSummary(filePath, text);
  }
  if (fileName === 'cargo.toml') {
    return buildCargoTomlSummary(filePath, text);
  }
  if (fileName === 'go.mod') {
    return buildGoModSummary(filePath, text);
  }
  if (fileName === 'requirements.txt') {
    return buildRequirementsSummary(filePath, text);
  }

  if (options.autoMode && looksManifestLike(filePath)) {
    return buildGenericConfigSummary(filePath, text, options.fileSize);
  }

  return null;
}

function describeReadSummary(mode: ReadPresentationMode, displayedLines?: number): string {
  switch (mode) {
    case 'binary':
      return 'Собрал метаданные нетекстового файла';
    case 'metadata':
      return 'Собрал метаданные файла';
    case 'manifest':
      return 'Собрал обзор конфигурации';
    case 'outline':
      return 'Собрал обзор файла';
    case 'head':
      return `Прочитал начало файла${displayedLines ? ` (${displayedLines} строк)` : ''}`;
    case 'tail':
      return `Прочитал конец файла${displayedLines ? ` (${displayedLines} строк)` : ''}`;
    case 'range':
      return `Прочитал диапазон файла${displayedLines ? ` (${displayedLines} строк)` : ''}`;
    case 'full':
    default:
      return `Прочитал файл${displayedLines ? ` (${displayedLines} строк)` : ''}`;
  }
}

function describeReadMode(mode: ReadPresentationMode): string {
  switch (mode) {
    case 'binary':
      return 'метаданные бинарного файла';
    case 'metadata':
      return 'метаданные файла';
    case 'manifest':
      return 'обзор manifest/config';
    case 'outline':
      return 'обзор файла';
    case 'head':
      return 'начало файла';
    case 'tail':
      return 'конец файла';
    case 'range':
      return 'диапазон строк';
    case 'full':
    default:
      return 'чтение файла';
  }
}

function buildOverview(lines: string[], query?: string): string {
  const totalLines = lines.length;
  const included = new Set<number>();

  for (let i = 0; i < Math.min(totalLines, 40); i++) {
    const value = lines[i].trim();
    if (
      value === '' ||
      value.startsWith('import ') ||
      value.startsWith('from ') ||
      value.startsWith('require') ||
      value.startsWith('using ') ||
      value.startsWith('package ') ||
      value.startsWith('#!') ||
      value.startsWith('//') ||
      value.startsWith('#') ||
      value.startsWith('/*') ||
      value.startsWith('*')
    ) {
      included.add(i);
    } else {
      break;
    }
  }

  const signatureRe =
    /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|interface|type|enum|const|def |func |struct |pub fn |pub struct |impl |trait )\s*\w+/;
  const decoratorRe = /^\s*@\w+/;
  for (let i = 0; i < totalLines; i++) {
    const trimmed = lines[i].trimStart();
    if (signatureRe.test(trimmed) || (decoratorRe.test(trimmed) && i + 1 < totalLines && signatureRe.test(lines[i + 1].trimStart()))) {
      includeWindow(included, totalLines, i, 1, 2);
    }
  }

  const terms = extractQueryTerms(query);
  if (terms.length > 0) {
    for (let i = 0; i < totalLines; i++) {
      const lower = lines[i].toLowerCase();
      if (terms.some((term) => lower.includes(term))) {
        includeWindow(included, totalLines, i, 1, 1);
      }
    }
  }

  for (let i = Math.max(0, totalLines - 8); i < totalLines; i++) {
    if (lines[i].trim()) included.add(i);
  }

  const sorted = [...included].sort((a, b) => a - b);
  const parts: string[] = [];
  let last = -2;
  let usedChars = 0;
  const budget = 10_500;

  for (const index of sorted) {
    if (usedChars > budget) break;
    if (index > last + 1) {
      parts.push(`   ... (${index - last - 1} строк пропущено) ...`);
    }
    const line = `${index + 1}| ${lines[index]}`;
    parts.push(line);
    usedChars += line.length + 1;
    last = index;
  }

  return parts.join('\n');
}

function formatReadWindow(
  filePath: string,
  lines: string[],
  startLine: number,
  endLine: number,
  options: {
    totalLines: number;
    totalChars: number;
    includeNavigation?: boolean;
  },
): string {
  const normalized = normalizeRange(options.totalLines, startLine, endLine);
  const slice = lines.slice(normalized.startLine - 1, normalized.endLine);
  const body = slice.map((line, index) => `${normalized.startLine + index}| ${line}`).join('\n');

  const parts = [
    `${filePath} строки ${normalized.startLine}–${normalized.endLine} из ${options.totalLines} (${options.totalChars} символов)`,
    '',
    body,
  ];

  if (options.includeNavigation) {
    const navigation = buildWindowNavigation(filePath, options.totalLines, normalized.startLine, normalized.endLine);
    if (navigation) {
      parts.push('');
      parts.push(navigation);
    }
  }

  return parts.join('\n');
}

function buildWindowNavigation(
  filePath: string,
  totalLines: number,
  startLine: number,
  endLine: number,
): string {
  const suggestions: string[] = [];
  const size = Math.max(DEFAULT_RANGE_SIZE, endLine - startLine + 1);
  const previousStart = Math.max(1, startLine - size);
  const previousEnd = Math.max(previousStart, startLine - 1);
  const nextStart = Math.min(totalLines, endLine + 1);
  const nextEnd = Math.min(totalLines, endLine + size);

  if (startLine > 1) {
    suggestions.push(
      `- предыдущий фрагмент: ${buildToolCall('read_file_range', { path: filePath, startLine: previousStart, endLine: previousEnd })}`,
    );
  }
  if (endLine < totalLines) {
    suggestions.push(
      `- следующий фрагмент: ${buildToolCall('read_file_range', { path: filePath, startLine: nextStart, endLine: nextEnd })}`,
    );
  }

  if (suggestions.length === 0) return '';
  return ['Следующие удобные шаги для навигации:', ...suggestions].join('\n');
}

function buildRangeSuggestionBlock(
  filePath: string,
  ranges: Array<{ startLine: number; endLine: number; label: string }>,
): string {
  const lines = ['Удобные следующие диапазоны:'];
  for (const range of ranges) {
    lines.push(
      `- ${range.label}: ${buildToolCall('read_file_range', { path: filePath, startLine: range.startLine, endLine: range.endLine })}`,
    );
  }
  return lines.join('\n');
}

function buildSuggestedRanges(
  totalLines: number,
  query: string | undefined,
  lines: string[],
): Array<{ startLine: number; endLine: number; label: string }> {
  const ranges: Array<{ startLine: number; endLine: number; label: string }> = [];
  const add = (startLine: number, endLine: number, label: string) => {
    const normalized = normalizeRange(totalLines, startLine, endLine);
    if (ranges.some((item) => Math.abs(item.startLine - normalized.startLine) <= 15 && Math.abs(item.endLine - normalized.endLine) <= 15)) {
      return;
    }
    ranges.push({ ...normalized, label });
  };

  add(1, Math.min(totalLines, DEFAULT_RANGE_SIZE), 'начало файла');

  const terms = extractQueryTerms(query);
  let hitCount = 0;
  if (terms.length > 0) {
    for (let i = 0; i < lines.length && hitCount < 3; i++) {
      const lower = lines[i].toLowerCase();
      if (!terms.some((term) => lower.includes(term))) continue;
      add(i + 1 - 20, i + 1 + 35, `участок вокруг "${terms.find((term) => lower.includes(term))}"`);
      hitCount++;
    }
  }

  if (totalLines > DEFAULT_RANGE_SIZE * 2) {
    const center = Math.floor(totalLines / 2);
    add(center - 40, center + 40, 'середина файла');
  }
  if (totalLines > DEFAULT_RANGE_SIZE) {
    add(totalLines - DEFAULT_RANGE_SIZE + 1, totalLines, 'конец файла');
  }

  return ranges.slice(0, 4);
}

function buildPackageJsonSummary(filePath: string, text: string): string | null {
  const parsed = safeParseJson(text);
  if (!parsed || typeof parsed !== 'object') return null;

  const scripts = objectKeys(parsed.scripts);
  const dependencies = objectKeys(parsed.dependencies);
  const devDependencies = objectKeys(parsed.devDependencies);
  const peerDependencies = objectKeys(parsed.peerDependencies);
  const workspaces = Array.isArray(parsed.workspaces)
    ? parsed.workspaces.map((item: unknown) => String(item))
    : objectKeys(parsed.workspaces?.packages);

  const lines = [
    `Обзор package.json: ${filePath}`,
    '',
    `name: ${String(parsed.name || '—')}`,
    `version: ${String(parsed.version || '—')}`,
    `private: ${parsed.private === true ? 'true' : 'false'}`,
  ];

  if (parsed.type) lines.push(`type: ${String(parsed.type)}`);
  if (workspaces.length > 0) lines.push(`workspaces: ${workspaces.length}`);
  lines.push(`scripts: ${scripts.length}`);
  lines.push(`dependencies: ${dependencies.length}`);
  lines.push(`devDependencies: ${devDependencies.length}`);
  if (peerDependencies.length > 0) lines.push(`peerDependencies: ${peerDependencies.length}`);

  if (scripts.length > 0) {
    lines.push('');
    lines.push(`Скрипты: ${scripts.slice(0, 8).join(', ')}${scripts.length > 8 ? ` +${scripts.length - 8}` : ''}`);
  }
  const dependencyPreview = dependencies.slice(0, 8);
  if (dependencyPreview.length > 0) {
    lines.push(`Основные зависимости: ${dependencyPreview.join(', ')}${dependencies.length > 8 ? ` +${dependencies.length - 8}` : ''}`);
  }

  lines.push('');
  lines.push('Следующие удобные шаги:');
  lines.push(`- изучить зависимости: ${buildToolCall('dependencies', { paths: [filePath], outputMode: 'packages', limit: 40 })}`);
  lines.push(`- открыть обзор файла: ${buildToolCall('read_file', { path: filePath, outputMode: 'outline' })}`);
  return lines.join('\n');
}

function buildPackageLockSummary(filePath: string, text: string): string | null {
  const parsed = safeParseJson(text);
  if (!parsed || typeof parsed !== 'object') return null;

  const packageCount = parsed.packages && typeof parsed.packages === 'object'
    ? Object.keys(parsed.packages).length
    : 0;
  const dependencyCount = parsed.dependencies && typeof parsed.dependencies === 'object'
    ? Object.keys(parsed.dependencies).length
    : 0;

  return [
    `Обзор package-lock.json: ${filePath}`,
    '',
    `name: ${String(parsed.name || '—')}`,
    `lockfileVersion: ${String(parsed.lockfileVersion || '—')}`,
    `packages: ${packageCount}`,
    `dependencies: ${dependencyCount}`,
    '',
    'Следующие удобные шаги:',
    `- посмотреть список пакетов: ${buildToolCall('dependencies', { paths: [filePath], outputMode: 'packages', limit: 40 })}`,
    `- открыть обзор файла: ${buildToolCall('read_file', { path: filePath, outputMode: 'outline' })}`,
  ].join('\n');
}

function buildTsConfigSummary(filePath: string, text: string): string | null {
  const parsed = safeParseJson(stripJsonComments(text));
  if (!parsed || typeof parsed !== 'object') return null;

  const compilerOptions = parsed.compilerOptions && typeof parsed.compilerOptions === 'object'
    ? parsed.compilerOptions
    : {};
  const include = Array.isArray(parsed.include) ? parsed.include : [];
  const exclude = Array.isArray(parsed.exclude) ? parsed.exclude : [];
  const pathAliases = compilerOptions.paths && typeof compilerOptions.paths === 'object'
    ? Object.keys(compilerOptions.paths)
    : [];

  const lines = [
    `Обзор ${path.basename(filePath)}: ${filePath}`,
    '',
    `extends: ${String(parsed.extends || '—')}`,
    `target: ${String(compilerOptions.target || '—')}`,
    `module: ${String(compilerOptions.module || '—')}`,
    `moduleResolution: ${String(compilerOptions.moduleResolution || '—')}`,
    `jsx: ${String(compilerOptions.jsx || '—')}`,
    `baseUrl: ${String(compilerOptions.baseUrl || '—')}`,
    `include: ${include.length}`,
    `exclude: ${exclude.length}`,
    `paths: ${pathAliases.length}`,
  ];

  if (pathAliases.length > 0) {
    lines.push('');
    lines.push(`Алиасы: ${pathAliases.slice(0, 8).join(', ')}${pathAliases.length > 8 ? ` +${pathAliases.length - 8}` : ''}`);
  }

  lines.push('');
  lines.push('Следующие удобные шаги:');
  lines.push(`- открыть обзор файла: ${buildToolCall('read_file', { path: filePath, outputMode: 'outline' })}`);
  return lines.join('\n');
}

function buildPyprojectSummary(filePath: string, text: string): string {
  const sections = extractTomlSections(text);
  const projectName = matchValue(text, /^\s*name\s*=\s*["']([^"']+)["']/m);
  const version = matchValue(text, /^\s*version\s*=\s*["']([^"']+)["']/m);
  const buildBackend = matchValue(text, /^\s*build-backend\s*=\s*["']([^"']+)["']/m);
  const dependencyCount = countTomlArrayItems(text, 'dependencies') + countPoetryStyleDependencies(text);

  return [
    `Обзор pyproject.toml: ${filePath}`,
    '',
    `name: ${projectName || '—'}`,
    `version: ${version || '—'}`,
    `build-backend: ${buildBackend || '—'}`,
    `sections: ${sections.length}`,
    `dependencies: ${dependencyCount}`,
    '',
    `Секции: ${sections.slice(0, 10).join(', ')}${sections.length > 10 ? ` +${sections.length - 10}` : ''}`,
    '',
    'Следующие удобные шаги:',
    `- открыть обзор файла: ${buildToolCall('read_file', { path: filePath, outputMode: 'outline' })}`,
  ].join('\n');
}

function buildCargoTomlSummary(filePath: string, text: string): string {
  const sections = extractTomlSections(text);
  const name = matchValue(text, /^\s*name\s*=\s*["']([^"']+)["']/m);
  const version = matchValue(text, /^\s*version\s*=\s*["']([^"']+)["']/m);
  const dependencyCount =
    countTomlSectionAssignments(text, 'dependencies') +
    countTomlSectionAssignments(text, 'dev-dependencies') +
    countTomlSectionAssignments(text, 'workspace.dependencies');

  return [
    `Обзор Cargo.toml: ${filePath}`,
    '',
    `name: ${name || '—'}`,
    `version: ${version || '—'}`,
    `sections: ${sections.length}`,
    `dependencies: ${dependencyCount}`,
    '',
    `Секции: ${sections.slice(0, 10).join(', ')}${sections.length > 10 ? ` +${sections.length - 10}` : ''}`,
    '',
    'Следующие удобные шаги:',
    `- открыть обзор файла: ${buildToolCall('read_file', { path: filePath, outputMode: 'outline' })}`,
  ].join('\n');
}

function buildGoModSummary(filePath: string, text: string): string {
  const moduleName = matchValue(text, /^\s*module\s+(.+)$/m);
  const goVersion = matchValue(text, /^\s*go\s+(.+)$/m);
  const dependencyCount = countGoModRequires(text);

  return [
    `Обзор go.mod: ${filePath}`,
    '',
    `module: ${moduleName || '—'}`,
    `go: ${goVersion || '—'}`,
    `dependencies: ${dependencyCount}`,
    '',
    'Следующие удобные шаги:',
    `- открыть обзор файла: ${buildToolCall('read_file', { path: filePath, outputMode: 'outline' })}`,
  ].join('\n');
}

function buildRequirementsSummary(filePath: string, text: string): string {
  const entries = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  return [
    `Обзор requirements.txt: ${filePath}`,
    '',
    `dependencies: ${entries.length}`,
    entries.length > 0
      ? `Первые зависимости: ${entries.slice(0, 10).join(', ')}${entries.length > 10 ? ` +${entries.length - 10}` : ''}`
      : 'Зависимости не найдены',
    '',
    'Следующие удобные шаги:',
    `- открыть файл целиком: ${buildToolCall('read_file', { path: filePath, outputMode: 'head', limit: 160 })}`,
  ].join('\n');
}

function buildGenericConfigSummary(filePath: string, text: string, fileSize?: number): string {
  const lines = text.split('\n');
  const nonEmpty = lines.filter((line) => line.trim()).length;
  const headings = lines
    .map((line) => line.trim())
    .filter((line) => /^(\[.+\]|[A-Za-z0-9_.-]+\s*[:=])/.test(line))
    .slice(0, 12);

  return [
    `Обзор конфигурационного файла: ${filePath}`,
    '',
    `Размер: ${formatBytes(fileSize ?? text.length)}`,
    `Строк: ${lines.length}`,
    `Непустых строк: ${nonEmpty}`,
    headings.length > 0 ? `Ключевые секции/ключи: ${headings.join(', ')}` : 'Ключевые секции не выделены автоматически',
    '',
    'Следующие удобные шаги:',
    `- открыть обзор файла: ${buildToolCall('read_file', { path: filePath, outputMode: 'outline' })}`,
  ].join('\n');
}

function shouldPreferManifestSummary(filePath: string, text: string): boolean {
  const fileName = path.basename(filePath).toLowerCase();
  if (fileName === 'package-lock.json') return true;
  const lines = text.split('\n').length;
  return lines >= MANIFEST_SUMMARY_LINE_THRESHOLD || text.length >= MANIFEST_SUMMARY_CHAR_THRESHOLD;
}

function looksManifestLike(filePath: string): boolean {
  const fileName = path.basename(filePath).toLowerCase();
  return new Set([
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'jsconfig.json',
    'pyproject.toml',
    'cargo.toml',
    'go.mod',
    'requirements.txt',
    '.env',
    '.env.example',
    '.npmrc',
    '.eslintrc',
    '.prettierrc',
    'vite.config.ts',
    'vite.config.js',
    'webpack.config.js',
  ]).has(fileName);
}

function classifyTextFlavor(filePath: string, text: string): string {
  if (looksManifestLike(filePath)) return 'конфиг / manifest';
  if (looksMinifiedText(text)) return 'похоже на minified или однострочный артефакт';
  const extension = path.extname(filePath).toLowerCase();
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|cs|php|rb|kt|swift|dart|c|cpp|h|hpp|lua|zig|vue|svelte)$/.test(extension)) {
    return 'исходный код';
  }
  if (/\.(json|yml|yaml|toml|ini|cfg|conf|env)$/.test(extension)) {
    return 'конфигурация';
  }
  if (/\.(md|txt|rst)$/.test(extension)) {
    return 'текст / документация';
  }
  return 'текстовый файл';
}

function looksMinifiedText(text: string): boolean {
  const lines = text.split('\n');
  if (lines.length <= 3 && text.length > 3000) return true;
  const average = lines.length > 0 ? text.length / lines.length : text.length;
  return average > 260 && lines.length > 0;
}

function safeParseJson(text: string): any {
  try {
    return JSON.parse(stripJsonComments(text));
  } catch {
    return null;
  }
}

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
}

function extractTomlSections(text: string): string[] {
  return Array.from(
    new Set(
      [...text.matchAll(/^\s*\[([^\]]+)\]\s*$/gm)]
        .map((match) => match[1].trim())
        .filter(Boolean),
    ),
  );
}

function countTomlArrayItems(text: string, key: string): number {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*\\[(.*?)\\]`, 'gms');
  const match = pattern.exec(text);
  if (!match) return 0;
  return match[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function countPoetryStyleDependencies(text: string): number {
  const sectionMatch = text.match(/^\s*\[tool\.poetry\.dependencies\]\s*$([\s\S]*?)(?=^\s*\[[^\]]+\]\s*$|\s*$)/m);
  if (!sectionMatch) return 0;
  return sectionMatch[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('python')).length;
}

function countTomlSectionAssignments(text: string, sectionName: string): number {
  const sectionPattern = new RegExp(`^\\s*\\[${escapeRegExp(sectionName)}\\]\\s*$([\\s\\S]*?)(?=^\\s*\\[[^\\]]+\\]\\s*$|\\s*$)`, 'm');
  const match = text.match(sectionPattern);
  if (!match) return 0;
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('=')).length;
}

function countGoModRequires(text: string): number {
  let count = 0;
  const blockMatch = text.match(/^\s*require\s*\(([\s\S]*?)^\s*\)/m);
  if (blockMatch) {
    count += blockMatch[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//')).length;
  }

  const inlineMatches = text.match(/^\s*require\s+[^\s]+\s+[^\s]+/gm) || [];
  count += inlineMatches.length;
  return count;
}

function objectKeys(value: any): string[] {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

function matchValue(text: string, pattern: RegExp): string {
  return text.match(pattern)?.[1]?.trim() || '';
}

function buildToolCall(tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({ tool, args });
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeDirPath(filePath: string): string {
  const dirPath = path.posix.dirname(filePath.replace(/\\/g, '/'));
  return dirPath === '.' ? '' : dirPath;
}

function extractQueryTerms(query?: string): string[] {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
    .slice(0, 6);
}

function normalizeRange(totalLines: number, startLine: number, endLine: number): { startLine: number; endLine: number } {
  if (totalLines <= 0) {
    return { startLine: 1, endLine: 1 };
  }

  let start = Number.isFinite(startLine) ? Math.max(1, Math.floor(startLine)) : 1;
  let end = Number.isFinite(endLine) ? Math.max(1, Math.floor(endLine)) : Math.min(totalLines, start + DEFAULT_RANGE_SIZE - 1);

  if (start > totalLines) {
    start = Math.max(1, totalLines - DEFAULT_RANGE_SIZE + 1);
  }
  if (end > totalLines) {
    end = totalLines;
  }
  if (end < start) {
    const nextEnd = start;
    start = Math.max(1, nextEnd - DEFAULT_RANGE_SIZE + 1);
    end = nextEnd;
  }

  return { startLine: start, endLine: end };
}

function includeWindow(set: Set<number>, totalLines: number, center: number, before: number, after: number): void {
  for (let index = Math.max(0, center - before); index <= Math.min(totalLines - 1, center + after); index++) {
    set.add(index);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
