import { grepWorkspace } from '../../../analysis/grep';
import { escapeRegExp } from '../../../core/utils';
import type { ToolHandlerMap } from '../types';
import {
  formatSpecificFileGrep,
  formatWorkspaceGrepContent,
  formatWorkspaceGrepCount,
  formatWorkspaceGrepFilesOnly,
  buildGrepPresentation,
  resolveGrepOutputMode,
} from '../grepStudy';
import {
  buildBinaryReadOutput,
  buildExplicitReadOutput,
  buildHeadReadOutput,
  buildManifestReadOutput,
  buildReadMetadataOutput,
  buildReadPresentation,
  buildReadRangeOutput,
  buildSmartReadOutput,
  buildTailReadOutput,
  normalizeReadOutputMode,
} from '../readStudy';
import { createToolExecutionResult } from '../results';
import {
  isLikelyBinaryContent,
  readWorkspaceBytes,
  readWorkspaceText,
  resolveWorkspaceUri,
} from '../workspace';

const FILE_TYPE_MAP: Record<string, string> = {
  py: 'py',
  python: 'py',
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  js: 'js',
  javascript: 'js',
  jsx: 'jsx',
  go: 'go',
  rust: 'rs',
  rs: 'rs',
  java: 'java',
  cs: 'cs',
  csharp: 'cs',
  php: 'php',
  rb: 'rb',
  ruby: 'rb',
  c: 'c',
  cpp: 'cpp',
  h: 'h',
  hpp: 'hpp',
  swift: 'swift',
  kt: 'kt',
  kotlin: 'kt',
  dart: 'dart',
  lua: 'lua',
  sql: 'sql',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  yml: 'yml',
  toml: 'toml',
  xml: 'xml',
  md: 'md',
  sh: 'sh',
  bash: 'sh',
  vue: 'vue',
  svelte: 'svelte',
};

export const codeSearchToolHandlers: ToolHandlerMap = {
  async grep(args) {
    const pattern = args?.pattern || '';
    if (!pattern) {
      const content = '(пустой паттерн — укажи "pattern")';
      return createToolExecutionResult('grep', 'error', content, {
        presentation: {
          kind: 'grep',
          data: {
            summary: 'Поиск завершился с ошибкой',
            detail: 'Паттерн не указан',
            pattern: '',
            outputMode: 'files_with_matches',
            matchCount: 0,
            fileCount: 0,
          },
        },
      });
    }

    const filePaths = collectFilePaths(args);
    let fileType: string | undefined = args?.fileType || args?.file_type || args?.type;
    if (fileType && FILE_TYPE_MAP[fileType]) fileType = FILE_TYPE_MAP[fileType];

    const includePattern: string | undefined = args?.include || args?.glob || args?.fileGlob;
    if (!fileType && includePattern) {
      const match = includePattern.match(/\*\.(\w+)/);
      if (match) fileType = match[1];
    }

    const ignoreCase = args?.ignoreCase === true || args?.ignore_case === true || args?.i === true;
    const multiline = args?.multiline === true;

    const regex = buildRegex(pattern, ignoreCase);
    const contextBefore = args?.B ?? args?.['-B'] ?? args?.linesBefore ?? args?.before;
    const contextAfter = args?.A ?? args?.['-A'] ?? args?.linesAfter ?? args?.after;
    const contextAround = args?.C ?? args?.['-C'] ?? args?.context ?? args?.contextLines;
    const outputMode = resolveGrepOutputMode(args, {
      hasSpecificFiles: filePaths.length > 0,
      hasContextOptions: contextBefore !== undefined || contextAfter !== undefined || contextAround !== undefined,
    });
    const filesOnly = outputMode === 'files_with_matches' || args?.filesOnly === true;
    const countOnly = outputMode === 'count';
    const limit = args?.head_limit || args?.limit || args?.maxResults || (filesOnly ? 200 : countOnly ? 500 : 30);
    const offset = args?.offset || 0;

    if (filePaths.length > 0) {
      return grepSpecificFiles({
        filePaths,
        pattern,
        regex,
        limit,
        offset,
        outputMode,
        countOnly,
        contextBefore: contextBefore ?? contextAround ?? 2,
        contextAfter: contextAfter ?? contextAround ?? 2,
        fileType,
      });
    }

    const fileGlob = fileType ? `**/*.${fileType}` : undefined;
    const defaultContext = filesOnly || countOnly ? 0 : 2;
    const matches = await grepWorkspace(regex, {
      maxResults: limit,
      contextLines: contextBefore === undefined && contextAfter === undefined ? (contextAround ?? defaultContext) : undefined,
      linesBefore: contextBefore ?? (contextAround !== undefined ? contextAround : undefined),
      linesAfter: contextAfter ?? (contextAround !== undefined ? contextAround : undefined),
      fileGlob,
      multiline,
      offset,
    });

    if (matches.length === 0) {
      const content = `Совпадений по "${pattern}" не найдено${fileType ? ` (в *.${fileType})` : ''}.`;
      return createToolExecutionResult('grep', 'success', content, {
        presentation: {
          kind: 'grep',
          data: buildGrepPresentation({
            pattern,
            matches: [],
            outputMode,
            limit,
            offset,
            totalAvailable: 0,
            fileType,
          }),
        },
      });
    }

    let content: string;
    if (countOnly) {
      content = formatWorkspaceGrepCount({
        pattern,
        matches,
        limit,
        offset,
        fileType,
        totalAvailable: matches.length >= limit ? offset + matches.length + 1 : offset + matches.length,
      });
      return createToolExecutionResult('grep', 'success', content, {
        presentation: {
          kind: 'grep',
          data: buildGrepPresentation({
            pattern,
            matches,
            outputMode,
            limit,
            offset,
            totalAvailable: matches.length >= limit ? offset + matches.length + 1 : offset + matches.length,
            fileType,
            content,
          }),
        },
      });
    }

    if (filesOnly) {
      content = formatWorkspaceGrepFilesOnly({
        pattern,
        matches,
        limit,
        offset,
        fileType,
        totalAvailable: matches.length >= limit ? offset + matches.length + 1 : offset + matches.length,
      });
      return createToolExecutionResult('grep', 'success', content, {
        presentation: {
          kind: 'grep',
          data: buildGrepPresentation({
            pattern,
            matches,
            outputMode,
            limit,
            offset,
            totalAvailable: matches.length >= limit ? offset + matches.length + 1 : offset + matches.length,
            fileType,
            content,
          }),
        },
      });
    }

    content = formatWorkspaceGrepContent({
      pattern,
      matches,
      limit,
      offset,
      fileType,
      totalAvailable: matches.length >= limit ? offset + matches.length + 1 : offset + matches.length,
    });
    return createToolExecutionResult('grep', 'success', content, {
      presentation: {
        kind: 'grep',
        data: buildGrepPresentation({
          pattern,
          matches,
          outputMode,
          limit,
          offset,
          totalAvailable: matches.length >= limit ? offset + matches.length + 1 : offset + matches.length,
          fileType,
          content,
        }),
      },
    });
  },

  async read_file(args, context) {
    const filePath = args?.path || '';
    if (!filePath) {
      const content = '(путь не указан — укажи "path")';
      return createToolExecutionResult('read_file', 'error', content, {
        presentation: {
          kind: 'read',
          data: buildReadPresentation({
            toolName: 'read_file',
            path: '',
            mode: 'metadata',
            content,
            summary: 'Чтение файла завершилось с ошибкой',
            detail: 'Путь не указан',
          }),
        },
      });
    }

    if (args?.startLine || args?.endLine || args?.start || args?.end || args?.from || args?.to || args?.from_line || args?.to_line) {
      return this.read_file_range(args, context);
    }

    const uri = await resolveWorkspaceUri(filePath);
    if (!uri) {
      const content = `Файл "${filePath}" не найден. Используй glob/find_files.`;
      return createToolExecutionResult('read_file', 'error', content, {
        presentation: {
          kind: 'read',
          data: buildReadPresentation({
            toolName: 'read_file',
            path: filePath,
            mode: 'metadata',
            content,
            summary: 'Файл не найден',
            detail: 'Используй glob или find_files, чтобы найти точный путь.',
          }),
        },
      });
    }

    try {
      const bytes = await readWorkspaceBytes(uri);
      if (isLikelyBinaryContent(bytes)) {
        const content = buildBinaryReadOutput(filePath, bytes);
        return createToolExecutionResult('read_file', 'success', content, {
          presentation: {
            kind: 'read',
            data: buildReadPresentation({
              toolName: 'read_file',
              path: filePath,
              mode: 'binary',
              content,
              binary: true,
              detail: `Размер: ${bytes.byteLength} байт`,
            }),
          },
        });
      }

      const text = await readWorkspaceText(uri);
      const lines = text.split('\n');
      const offset = args?.offset;
      const limit = args?.limit;
      const outputMode = normalizeReadOutputMode(args?.outputMode || args?.mode || args?.view);
      if (offset !== undefined || (limit !== undefined && outputMode === 'auto')) {
        const start = typeof offset === 'number' ? offset : parseInt(String(offset || ''), 10);
        const requestedLimit = typeof limit === 'number' ? limit : parseInt(String(limit || ''), 10);
        const content = buildExplicitReadOutput(filePath, text, {
          offset: typeof offset === 'number' ? offset : parseInt(String(offset || ''), 10),
          limit: typeof limit === 'number' ? limit : parseInt(String(limit || ''), 10),
        });
        const startLine = Number.isFinite(start) ? (start < 0 ? Math.max(1, lines.length + start + 1) : Math.max(1, start || 1)) : 1;
        const displayedLines = Number.isFinite(requestedLimit) && requestedLimit > 0
          ? Math.min(lines.length - startLine + 1, requestedLimit)
          : Math.max(1, lines.length - startLine + 1);
        return createToolExecutionResult('read_file', 'success', content, {
          presentation: {
            kind: 'read',
            data: buildReadPresentation({
              toolName: 'read_file',
              path: filePath,
              mode: 'range',
              content,
              displayedLines,
              totalLines: lines.length,
              totalChars: text.length,
              startLine,
              endLine: Math.min(lines.length, startLine + displayedLines - 1),
            }),
          },
        });
      }

      if (outputMode === 'metadata') {
        const content = buildReadMetadataOutput(filePath, bytes, text);
        return createToolExecutionResult('read_file', 'success', content, {
          presentation: {
            kind: 'read',
            data: buildReadPresentation({
              toolName: 'read_file',
              path: filePath,
              mode: 'metadata',
              content,
              totalLines: lines.length,
              totalChars: text.length,
            }),
          },
        });
      }

      if (outputMode === 'manifest') {
        const content = buildManifestReadOutput(filePath, text, { fileSize: bytes.byteLength }) || buildReadMetadataOutput(filePath, bytes, text);
        return createToolExecutionResult('read_file', 'success', content, {
          presentation: {
            kind: 'read',
            data: buildReadPresentation({
              toolName: 'read_file',
              path: filePath,
              mode: content.startsWith('Метаданные файла:') ? 'metadata' : 'manifest',
              content,
              totalLines: lines.length,
              totalChars: text.length,
            }),
          },
        });
      }

      if (outputMode === 'head') {
        const headLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
          ? Math.floor(Number(limit))
          : undefined;
        const content = buildHeadReadOutput(filePath, text, headLimit);
        return createToolExecutionResult('read_file', 'success', content, {
          presentation: {
            kind: 'read',
            data: buildReadPresentation({
              toolName: 'read_file',
              path: filePath,
              mode: 'head',
              content,
              displayedLines: Math.min(lines.length, headLimit || 120),
              totalLines: lines.length,
              totalChars: text.length,
              startLine: 1,
              endLine: Math.min(lines.length, headLimit || 120),
            }),
          },
        });
      }

      if (outputMode === 'tail') {
        const tailLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
          ? Math.floor(Number(limit))
          : undefined;
        const normalizedTailLimit = tailLimit || 120;
        const startLine = Math.max(1, lines.length - normalizedTailLimit + 1);
        const content = buildTailReadOutput(filePath, text, tailLimit);
        return createToolExecutionResult('read_file', 'success', content, {
          presentation: {
            kind: 'read',
            data: buildReadPresentation({
              toolName: 'read_file',
              path: filePath,
              mode: 'tail',
              content,
              displayedLines: Math.min(lines.length, normalizedTailLimit),
              totalLines: lines.length,
              totalChars: text.length,
              startLine,
              endLine: lines.length,
            }),
          },
        });
      }

      if (outputMode === 'outline') {
        const content = buildSmartReadOutput(filePath, text, context.query, { fileSize: bytes.byteLength });
        return createToolExecutionResult('read_file', 'success', content, {
          presentation: {
            kind: 'read',
            data: buildReadPresentation({
              toolName: 'read_file',
              path: filePath,
              mode: content.startsWith(`${filePath} строки `) ? 'full' : 'outline',
              content,
              totalLines: lines.length,
              totalChars: text.length,
            }),
          },
        });
      }

      const content = buildSmartReadOutput(filePath, text, context.query, { fileSize: bytes.byteLength });
      return createToolExecutionResult('read_file', 'success', content, {
        presentation: {
          kind: 'read',
          data: buildReadPresentation({
            toolName: 'read_file',
            path: filePath,
            mode: content.startsWith(`${filePath} строки `) ? 'full' : 'outline',
            content,
            totalLines: lines.length,
            totalChars: text.length,
          }),
        },
      });
    } catch {
      const content = `Ошибка чтения "${filePath}"`;
      return createToolExecutionResult('read_file', 'error', content, {
        presentation: {
          kind: 'read',
          data: buildReadPresentation({
            toolName: 'read_file',
            path: filePath,
            mode: 'metadata',
            content,
            summary: 'Чтение файла завершилось с ошибкой',
          }),
        },
      });
    }
  },

  async read_file_range(args) {
    const filePath = args?.path || '';
    if (!filePath) {
      const content = '(путь не указан)';
      return createToolExecutionResult('read_file_range', 'error', content, {
        presentation: {
          kind: 'read',
          data: buildReadPresentation({
            toolName: 'read_file_range',
            path: '',
            mode: 'range',
            content,
            summary: 'Чтение диапазона завершилось с ошибкой',
            detail: 'Путь не указан',
          }),
        },
      });
    }

    let startLine = args?.startLine ?? args?.start_line ?? args?.from_line ?? args?.start ?? args?.from ?? 1;
    let endLine = args?.endLine ?? args?.end_line ?? args?.to_line ?? args?.end ?? args?.to ?? null;
    if (typeof startLine !== 'number') startLine = parseInt(startLine, 10) || 1;
    if (endLine !== null && typeof endLine !== 'number') endLine = parseInt(endLine, 10) || null;
    if (endLine === null) endLine = startLine + 80;

    const uri = await resolveWorkspaceUri(filePath);
    if (!uri) {
      const content = `Файл "${filePath}" не найден.`;
      return createToolExecutionResult('read_file_range', 'error', content, {
        presentation: {
          kind: 'read',
          data: buildReadPresentation({
            toolName: 'read_file_range',
            path: filePath,
            mode: 'range',
            content,
            summary: 'Файл не найден',
          }),
        },
      });
    }

    try {
      const bytes = await readWorkspaceBytes(uri);
      if (isLikelyBinaryContent(bytes)) {
        const content = `${buildBinaryReadOutput(filePath, bytes)}\n\nДиапазон строк доступен только для текстовых файлов.`;
        return createToolExecutionResult('read_file_range', 'blocked', content, {
          presentation: {
            kind: 'read',
            data: buildReadPresentation({
              toolName: 'read_file_range',
              path: filePath,
              mode: 'binary',
              content,
              binary: true,
              summary: 'Диапазон недоступен для нетекстового файла',
            }),
          },
        });
      }

      const text = await readWorkspaceText(uri);
      const lines = text.split('\n');
      const total = lines.length;
      if (startLine > total) {
        const averageLineLength = Math.max(1, text.length / total);
        startLine = Math.max(1, Math.floor(startLine / averageLineLength));
        endLine = Math.min(total, Math.floor(endLine / averageLineLength));
        if (endLine <= startLine) endLine = Math.min(total, startLine + 80);
      }

      const content = buildReadRangeOutput(filePath, text, { startLine, endLine });
      return createToolExecutionResult('read_file_range', 'success', content, {
        presentation: {
          kind: 'read',
          data: buildReadPresentation({
            toolName: 'read_file_range',
            path: filePath,
            mode: 'range',
            content,
            displayedLines: Math.max(1, endLine - startLine + 1),
            totalLines: total,
            totalChars: text.length,
            startLine,
            endLine,
          }),
        },
      });
    } catch {
      const content = `Ошибка чтения "${filePath}"`;
      return createToolExecutionResult('read_file_range', 'error', content, {
        presentation: {
          kind: 'read',
          data: buildReadPresentation({
            toolName: 'read_file_range',
            path: filePath,
            mode: 'range',
            content,
            summary: 'Чтение диапазона завершилось с ошибкой',
          }),
        },
      });
    }
  },
};

function collectFilePaths(args: any): string[] {
  if (args?.path) return [args.path];
  if (args?.file) return [args.file];
  if (Array.isArray(args?.paths)) return args.paths;
  if (Array.isArray(args?.files)) return args.files;
  return [];
}

function buildRegex(pattern: string, ignoreCase: boolean): RegExp {
  const flags = ignoreCase ? 'gi' : 'g';
  try {
    return new RegExp(pattern, flags);
  } catch {
    return new RegExp(escapeRegExp(pattern), flags);
  }
}

async function grepSpecificFiles(options: {
  filePaths: string[];
  pattern: string;
  regex: RegExp;
  limit: number;
  offset: number;
  outputMode: 'content' | 'files_with_matches' | 'count';
  countOnly: boolean;
  contextBefore: number;
  contextAfter: number;
  fileType?: string;
}) {
  const { filePaths, pattern, regex, limit, offset, outputMode, countOnly, contextBefore, contextAfter, fileType } = options;
  const matches: Array<{
    file: string;
    line: number;
    matchedLine: string;
    context: string;
    contextStartLine: number;
  }> = [];
  const counts = new Map<string, number>();
  let skipped = 0;
  let returned = 0;
  let totalMatches = 0;

  for (const filePath of filePaths.slice(0, 5)) {
    const uri = await resolveWorkspaceUri(filePath);
    if (!uri) {
      continue;
    }

    try {
      const text = await readWorkspaceText(uri);
      const lines = text.split('\n');
      let matchCount = 0;

      for (let index = 0; index < lines.length; index++) {
        regex.lastIndex = 0;
        if (!regex.test(lines[index])) continue;

        matchCount++;
        totalMatches++;
        if (countOnly) continue;
        if (skipped < offset) {
          skipped++;
          continue;
        }
        if (returned >= limit) break;

        const start = Math.max(0, index - contextBefore);
        const end = Math.min(lines.length - 1, index + contextAfter);
        matches.push({
          file: filePath,
          line: index + 1,
          matchedLine: lines[index],
          context: lines.slice(start, end + 1).join('\n'),
          contextStartLine: start + 1,
        });
        returned++;
      }

      counts.set(filePath, matchCount);
      if (!countOnly && returned >= limit) break;
    } catch {
      counts.set(filePath, 0);
    }
  }

  const content = formatSpecificFileGrep({
    pattern,
    matches,
    counts,
    limit,
    offset,
    outputMode,
    fileType,
    filePaths: filePaths.slice(0, 5),
    totalAvailable: totalMatches,
  });
  return createToolExecutionResult('grep', 'success', content, {
    presentation: {
      kind: 'grep',
      data: buildGrepPresentation({
        pattern,
        matches,
        counts,
        outputMode,
        limit,
        offset,
        fileType,
        filePaths: filePaths.slice(0, 5),
        totalAvailable: totalMatches,
        content,
      }),
    },
  });
}
