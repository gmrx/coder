import * as vscode from 'vscode';
import { buildDependencyGraph, extractDocumentSymbols } from '../../../analysis/symbols';
import {
  CODE_EXTENSIONS_RE,
} from '../../../core/constants';
import type { ToolHandlerMap } from '../types';
import { collectDiagnosticsResult } from '../diagnostics';
import {
  prepareSemanticRetrieval,
  rerankChunkMatches,
  rerankFileMatches,
  selectChunkPool,
  selectFilePool,
} from '../retrieval';
import {
  buildRelevantFilesPresentation,
  buildSemanticSearchPresentation,
  formatRelevantFilesOutput,
  formatSemanticSearchOutput,
  normalizeRelevantFilesOutputMode,
  normalizeSemanticSearchOutputMode,
} from '../retrievalStudy';
import { readWorkspaceText, resolveWorkspaceUri } from '../workspace';
import { normalizeSearchPagination } from '../fileStudy';
import { extractManifestDependencies } from '../manifestDependencies';
import {
  buildDependenciesOutput,
  buildDependenciesPresentation,
  buildSymbolOutlineOutput,
  buildSymbolOutlinePresentation,
  buildWorkspaceSymbolsPresentation,
  normalizeSymbolOutputMode,
  normalizeDependencyOutputMode,
} from '../symbolStudy';
import { createToolExecutionResult } from '../results';
import { isUriInAgentWorkspace, toAgentRelativePath } from '../../worktreeSession';

export const codeAnalysisToolHandlers: ToolHandlerMap = {
  async extract_symbols(args) {
    const filePath = args?.path || '';
    if (!filePath) {
      const content = '(путь не указан)';
      return createToolExecutionResult('extract_symbols', 'error', content, {
        presentation: {
          kind: 'symbol_study',
          data: {
            toolName: 'extract_symbols',
            outputMode: 'summary',
            resultCount: 0,
            summary: 'Список символов не получен',
            detail: 'Путь не указан',
          },
        },
      });
    }
    if (!CODE_EXTENSIONS_RE.test(filePath)) {
      const content = `extract_symbols работает только для кода. "${filePath}" — конфиг. Используй read_file.`;
      return createToolExecutionResult('extract_symbols', 'blocked', content, {
        presentation: {
          kind: 'symbol_study',
          data: {
            toolName: 'extract_symbols',
            outputMode: 'summary',
            resultCount: 0,
            summary: 'Список символов не получен',
            detail: `${filePath} не выглядит как кодовый файл`,
            preview: content,
            nextStep: `Открой файл через read_file: ${JSON.stringify({ tool: 'read_file', args: { path: filePath, outputMode: 'outline' } })}`,
          },
        },
      });
    }

    const uri = await resolveWorkspaceUri(filePath);
    if (!uri) {
      const content = `Файл "${filePath}" не найден.`;
      return createToolExecutionResult('extract_symbols', 'error', content, {
        presentation: {
          kind: 'symbol_study',
          data: {
            toolName: 'extract_symbols',
            outputMode: 'summary',
            resultCount: 0,
            summary: 'Список символов не получен',
            detail: `Файл ${filePath} не найден`,
          },
        },
      });
    }
    const { limit, offset } = normalizeSearchPagination(args);
    const outputMode = normalizeSymbolOutputMode(args?.outputMode || args?.mode || args?.view);
    const outline = await extractDocumentSymbols(uri);
    const content = buildSymbolOutlineOutput(outline, { outputMode, limit, offset });
    return createToolExecutionResult('extract_symbols', 'success', content, {
      presentation: {
        kind: 'symbol_study',
        data: buildSymbolOutlinePresentation(outline, { outputMode, limit, offset, content }),
      },
    });
  },

  async workspace_symbols(args) {
    const query = args?.query || args?.symbol || args?.name || '';
    if (!query) {
      const content = '(запрос не указан — укажи "query")';
      return createToolExecutionResult('workspace_symbols', 'error', content, {
        presentation: {
          kind: 'symbol_study',
          data: {
            toolName: 'workspace_symbols',
            outputMode: 'workspace_symbols',
            resultCount: 0,
            summary: 'Символы не найдены',
            detail: 'Запрос не указан',
          },
        },
      });
    }

    try {
      const symbols = (await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeWorkspaceSymbolProvider', query) || [])
        .filter((symbol) => symbol?.location?.uri && isUriInAgentWorkspace(symbol.location.uri));
      if (!symbols.length) {
        const content = `Символы по "${query}" не найдены. Попробуй grep.`;
        return createToolExecutionResult('workspace_symbols', 'success', content, {
          presentation: {
            kind: 'symbol_study',
            data: buildWorkspaceSymbolsPresentation(query, [], {
              limit: 0,
              offset: 0,
              total: 0,
              content,
            }),
          },
        });
      }

      const { limit, offset } = normalizeSearchPagination(args);
      const page = symbols.slice(offset, offset + limit);
      if (page.length === 0) {
        const content = [
          `Символы по "${query}" есть, но страница с offset=${offset} пуста.`,
          '',
          `Попробуй меньший offset: ${JSON.stringify({ tool: 'workspace_symbols', args: { query, limit, offset: Math.max(0, offset - limit) } })}`,
        ].join('\n');
        return createToolExecutionResult('workspace_symbols', 'success', content, {
          presentation: {
            kind: 'symbol_study',
            data: buildWorkspaceSymbolsPresentation(query, [], {
              limit,
              offset,
              total: symbols.length,
              content,
            }),
          },
        });
      }

      const lines = [`Символы по "${query}": показаны ${offset + 1}–${offset + page.length} из ${symbols.length}.`];
      for (const symbol of page) {
        const relativePath = toAgentRelativePath(symbol.location.uri);
        const container = symbol.containerName ? ` (в ${symbol.containerName})` : '';
        lines.push(`  [${vscode.SymbolKind[symbol.kind] || 'Unknown'}] ${symbol.name}${container} — ${relativePath}:${symbol.location.range.start.line + 1}`);
      }
      const nextOffset = offset + page.length;
      if (offset > 0 || nextOffset < symbols.length) {
        lines.push('');
        lines.push('Удобные следующие шаги:');
        if (offset > 0) {
          lines.push(`- предыдущая страница: ${JSON.stringify({ tool: 'workspace_symbols', args: { query, limit, offset: Math.max(0, offset - limit) } })}`);
        }
        if (nextOffset < symbols.length) {
          lines.push(`- следующая страница: ${JSON.stringify({ tool: 'workspace_symbols', args: { query, limit, offset: nextOffset } })}`);
        }
      }
      const content = lines.join('\n');
      const normalizedPage = page.map((symbol) => ({
        name: symbol.name,
        kind: vscode.SymbolKind[symbol.kind] || 'Unknown',
        path: toAgentRelativePath(symbol.location.uri),
        line: symbol.location.range.start.line + 1,
        character: symbol.location.range.start.character + 1,
        ...(symbol.containerName ? { containerName: symbol.containerName } : {}),
      }));
      return createToolExecutionResult('workspace_symbols', 'success', content, {
        presentation: {
          kind: 'symbol_study',
          data: buildWorkspaceSymbolsPresentation(query, normalizedPage, {
            limit,
            offset,
            total: symbols.length,
            content,
          }),
        },
      });
    } catch {
      const content = 'Ошибка поиска символов.';
      return createToolExecutionResult('workspace_symbols', 'error', content, {
        presentation: {
          kind: 'symbol_study',
          data: {
            toolName: 'workspace_symbols',
            outputMode: 'workspace_symbols',
            resultCount: 0,
            summary: 'Поиск символов завершился с ошибкой',
            detail: content,
            preview: content,
          },
        },
      });
    }
  },

  async dependencies(args) {
    const paths: string[] = args?.paths || (args?.path ? [args.path] : []);
    if (paths.length === 0) {
      const content = '(нет файлов — укажи "paths": ["file1.py", "file2.py"])';
      return createToolExecutionResult('dependencies', 'error', content, {
        presentation: {
          kind: 'symbol_study',
          data: {
            toolName: 'dependencies',
            outputMode: 'summary',
            resultCount: 0,
            summary: 'Сводка зависимостей не получена',
            detail: 'Пути не указаны',
          },
        },
      });
    }

    const { limit, offset } = normalizeSearchPagination(args);
    const outputMode = normalizeDependencyOutputMode(args?.outputMode || args?.mode || args?.view);
    const configFiles = paths.filter((value) => /\.(json|txt|toml|cfg|ini|yaml|yml|lock)$/.test(value));
    const codeFiles = paths.filter((value) => !configFiles.includes(value));
    const manifestGroups: Array<{ file: string; entries: Array<{ name: string; version: string }> }> = [];
    let codeUris: vscode.Uri[] = [];

    for (const configFile of configFiles) {
      const uri = await resolveWorkspaceUri(configFile);
      if (!uri) continue;

      try {
        const text = await readWorkspaceText(uri);
        const entries = extractManifestDependencies(configFile, text);
        if (entries.length > 0) manifestGroups.push({ file: configFile, entries });
      } catch {
        // Skip unreadable config files but keep the rest of the summary.
      }
    }

    if (codeFiles.length > 0) {
      const uris: vscode.Uri[] = [];
      for (const codeFile of codeFiles) {
        const uri = await resolveWorkspaceUri(codeFile);
        if (uri) uris.push(uri);
      }

      if (uris.length > 0) {
        codeUris = uris;
      }
    }
    const graphEdges = codeUris.length > 0 ? await buildDependencyGraph(codeUris) : [];
    if (manifestGroups.length === 0 && graphEdges.length === 0) {
      const content = 'Зависимостей не найдено. dependencies работает с кодовыми файлами (import/require) и манифестами зависимостей. Для точного чтения манифеста используй read_file.';
      return createToolExecutionResult('dependencies', 'success', content, {
        presentation: {
          kind: 'symbol_study',
          data: buildDependenciesPresentation({
            requestedPaths: paths,
            manifestGroups,
            edges: graphEdges,
            outputMode,
            limit,
            offset,
            content,
          }),
        },
      });
    }

    const content = buildDependenciesOutput({
      requestedPaths: paths,
      manifestGroups,
      edges: graphEdges,
      outputMode,
      limit,
      offset,
    });
    return createToolExecutionResult('dependencies', 'success', content, {
      presentation: {
        kind: 'symbol_study',
        data: buildDependenciesPresentation({
          requestedPaths: paths,
          manifestGroups,
          edges: graphEdges,
          outputMode,
          limit,
          offset,
          content,
        }),
      },
    });
  },

  async read_lints(args) {
    const result = collectDiagnosticsResult({
      path: typeof args?.path === 'string' ? args.path : undefined,
      paths: Array.isArray(args?.paths) ? args.paths : undefined,
      limit: typeof args?.limit === 'number' ? args.limit : parseInt(String(args?.limit || ''), 10) || 20,
      offset: typeof args?.offset === 'number' ? args.offset : parseInt(String(args?.offset || ''), 10) || 0,
      outputMode: args?.outputMode || args?.mode || args?.view,
      severity: args?.severity,
      toolName: 'read_lints',
    });
    return createToolExecutionResult('read_lints', 'success', result.content, {
      presentation: {
        kind: 'diagnostics',
        data: result.presentation,
      },
    });
  },

  async get_diagnostics(args) {
    const result = collectDiagnosticsResult({
      path: typeof args?.path === 'string' ? args.path : undefined,
      paths: Array.isArray(args?.paths) ? args.paths : undefined,
      limit: typeof args?.limit === 'number' ? args.limit : parseInt(String(args?.limit || ''), 10) || 10,
      offset: typeof args?.offset === 'number' ? args.offset : parseInt(String(args?.offset || ''), 10) || 0,
      outputMode: args?.outputMode || args?.mode || args?.view,
      severity: args?.severity,
      toolName: 'get_diagnostics',
    });
    return createToolExecutionResult('get_diagnostics', 'success', result.content, {
      presentation: {
        kind: 'diagnostics',
        data: result.presentation,
      },
    });
  },

  async semantic_search(args, context) {
    const query = args?.query || '';
    if (!query) {
      return createToolExecutionResult('semantic_search', 'error', '(укажи "query")', {
        presentation: {
          kind: 'semantic_search',
          data: buildSemanticSearchPresentation('', [], {
            outputMode: 'summary',
            limit: 10,
            offset: 0,
            reranked: false,
          }),
        },
      });
    }

    const { limit, offset } = normalizeSearchPagination(args, 10, 1, 12);
    const outputMode = normalizeSemanticSearchOutputMode(args?.outputMode || args?.mode || args?.view);
    const targetDirectory: string | undefined = args?.target_directory || args?.directory || args?.dir;
    try {
      const prepared = await prepareSemanticRetrieval(query, {
        targetDirectory,
        signal: context.signal,
      });
      if (!prepared.rankedChunks.length || prepared.rankedChunks[0].score < 0.08) {
        const content = `Ничего не найдено для "${query}".`;
        return createToolExecutionResult('semantic_search', 'success', content, {
          presentation: {
            kind: 'semantic_search',
            data: buildSemanticSearchPresentation(query, [], {
              outputMode,
              limit,
              offset,
              reranked: false,
              targetDirectory,
            }),
          },
        });
      }

      const pageWindow = offset + limit;
      const chunkPool = selectChunkPool(prepared.rankedChunks, pageWindow);
      const rerankedChunks = await rerankChunkMatches(
        query,
        chunkPool,
        prepared.config,
        pageWindow,
        context.signal,
      );

      const options = {
        outputMode,
        limit,
        offset,
        reranked: rerankedChunks.reranked,
        targetDirectory,
      };
      return createToolExecutionResult(
        'semantic_search',
        'success',
        formatSemanticSearchOutput(query, rerankedChunks.matches, options),
        {
          presentation: {
            kind: 'semantic_search',
            data: buildSemanticSearchPresentation(query, rerankedChunks.matches, options),
          },
        },
      );
    } catch (error: any) {
      const message = error?.message || String(error);
      return createToolExecutionResult('semantic_search', 'error', message, {
        presentation: {
          kind: 'semantic_search',
          data: {
            ...buildSemanticSearchPresentation(query, [], {
              outputMode,
              limit,
              offset,
              reranked: false,
              targetDirectory,
            }),
            summary: 'Смысловой поиск завершился с ошибкой',
            detail: message,
            preview: message,
          },
        },
      });
    }
  },

  async find_relevant_files(args, context) {
    const query = args?.query || args?.goal || context.query || '';
    if (!query) {
      return createToolExecutionResult('find_relevant_files', 'error', '(укажи "query")', {
        presentation: {
          kind: 'find_relevant_files',
          data: buildRelevantFilesPresentation('', [], {
            outputMode: 'summary',
            limit: 8,
            offset: 0,
            reranked: false,
          }),
        },
      });
    }

    const { limit, offset } = normalizeSearchPagination(args, 8, 1, 12);
    const outputMode = normalizeRelevantFilesOutputMode(args?.outputMode || args?.mode || args?.view);
    const targetDirectory: string | undefined = args?.target_directory || args?.directory || args?.dir;
    try {
      const prepared = await prepareSemanticRetrieval(query, {
        targetDirectory,
        signal: context.signal,
      });
      const pageWindow = offset + limit;
      const filePool = selectFilePool(prepared.fileMatches, pageWindow);
      const rerankedFiles = await rerankFileMatches(
        query,
        filePool,
        prepared.config,
        pageWindow,
        context.signal,
      );
      const top = rerankedFiles.matches;

      if (!top.length || top[0].score < 0.08) {
        const content = `Не удалось выделить релевантные файлы для "${query}".`;
        return createToolExecutionResult('find_relevant_files', 'success', content, {
          presentation: {
            kind: 'find_relevant_files',
            data: buildRelevantFilesPresentation(query, [], {
              outputMode,
              limit,
              offset,
              reranked: false,
              targetDirectory,
            }),
          },
        });
      }

      const options = {
        outputMode,
        limit,
        offset,
        reranked: rerankedFiles.reranked,
        targetDirectory,
      };
      return createToolExecutionResult(
        'find_relevant_files',
        'success',
        formatRelevantFilesOutput(query, top, options),
        {
          presentation: {
            kind: 'find_relevant_files',
            data: buildRelevantFilesPresentation(query, top, options),
          },
        },
      );
    } catch (error: any) {
      const message = error?.message || String(error);
      return createToolExecutionResult('find_relevant_files', 'error', message, {
        presentation: {
          kind: 'find_relevant_files',
          data: {
            ...buildRelevantFilesPresentation(query, [], {
              outputMode,
              limit,
              offset,
              reranked: false,
              targetDirectory,
            }),
            summary: 'Не удалось отобрать релевантные файлы',
            detail: message,
            preview: message,
          },
        },
      });
    }
  },
};
