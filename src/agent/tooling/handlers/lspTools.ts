import * as vscode from 'vscode';
import { extractDocumentSymbols } from '../../../analysis/symbols';
import type { ToolHandlerMap } from '../types';
import {
  buildLspCallHierarchyPresentation,
  buildLspDocumentSymbolsPresentation,
  buildLspHoverPresentation,
  buildLspLocationPresentation,
  buildLspWorkspaceSymbolsPresentation,
  formatCallHierarchyResult,
  formatPagedDocumentSymbols,
  formatPagedLocationResult,
  formatPagedWorkspaceSymbols,
  normalizeLspPagination,
} from '../lspStudy';
import { createToolExecutionResult } from '../results';
import { resolveWorkspaceUri } from '../workspace';
import { isUriInAgentWorkspace, toAgentRelativePath } from '../../worktreeSession';

type LspOperation =
  | 'definition'
  | 'references'
  | 'hover'
  | 'implementation'
  | 'document_symbols'
  | 'workspace_symbols'
  | 'incoming_calls'
  | 'outgoing_calls';

export const lspToolHandlers: ToolHandlerMap = {
  async lsp_inspect(args) {
    const operation = normalizeOperation(args?.operation);
    if (!operation) {
      const content = 'Для "lsp_inspect" укажи args.operation: definition | references | hover | implementation | document_symbols | workspace_symbols | incoming_calls | outgoing_calls';
      return createToolExecutionResult('lsp_inspect', 'error', content, {
        presentation: {
          kind: 'lsp_inspect',
          data: {
            operation: 'unknown',
            resultCount: 0,
            summary: 'LSP-запрос завершился с ошибкой',
            detail: 'Операция не указана',
            preview: content,
          },
        },
      });
    }

    if (operation === 'workspace_symbols') {
      return runWorkspaceSymbols(args);
    }

    const filePath = String(args?.path || args?.file_path || '').trim();
    if (!filePath) {
      const content = `Для "lsp_inspect" с operation="${operation}" обязателен args.path`;
      return createToolExecutionResult('lsp_inspect', 'error', content, {
        presentation: {
          kind: 'lsp_inspect',
          data: {
            operation,
            resultCount: 0,
            summary: 'LSP-запрос завершился с ошибкой',
            detail: 'Путь не указан',
            preview: content,
          },
        },
      });
    }

    const uri = await resolveWorkspaceUri(filePath);
    if (!uri) {
      const content = `Файл "${filePath}" не найден.`;
      return createToolExecutionResult('lsp_inspect', 'error', content, {
        presentation: {
          kind: 'lsp_inspect',
          data: {
            operation,
            resultCount: 0,
            summary: 'LSP-запрос завершился с ошибкой',
            detail: `Файл ${filePath} не найден`,
            preview: content,
          },
        },
      });
    }

    if (operation === 'document_symbols') {
      const pagination = normalizeLspPagination(args);
      const outline = await extractDocumentSymbols(uri);
      const content = formatPagedDocumentSymbols(outline, pagination);
      return createToolExecutionResult('lsp_inspect', 'success', content, {
        presentation: {
          kind: 'lsp_inspect',
        data: buildLspDocumentSymbolsPresentation(outline, pagination, content),
        },
      });
    }

    const position = buildPosition(args);
    if (!position) {
      const content = `Для "lsp_inspect" с operation="${operation}" укажи args.line и args.character (1-based).`;
      return createToolExecutionResult('lsp_inspect', 'error', content, {
        presentation: {
          kind: 'lsp_inspect',
          data: {
            operation,
            resultCount: 0,
            summary: 'LSP-запрос завершился с ошибкой',
            detail: 'Позиция не указана',
            preview: content,
          },
        },
      });
    }

    switch (operation) {
      case 'definition':
        return runDefinition(uri, position);
      case 'references':
        return runReferences(uri, position, args);
      case 'hover':
        return runHover(uri, position);
      case 'implementation':
        return runImplementation(uri, position);
      case 'incoming_calls':
        return runCallHierarchy(uri, position, args, 'incoming_calls');
      case 'outgoing_calls':
        return runCallHierarchy(uri, position, args, 'outgoing_calls');
      default:
        return createToolExecutionResult('lsp_inspect', 'error', `Операция "${operation}" пока не поддерживается.`, {
          presentation: {
            kind: 'lsp_inspect',
            data: {
              operation,
              resultCount: 0,
              summary: 'LSP-запрос завершился с ошибкой',
              detail: `Операция ${operation} не поддерживается`,
              preview: `Операция "${operation}" пока не поддерживается.`,
            },
          },
        });
    }
  },
};

function normalizeOperation(raw: any): LspOperation | null {
  const value = String(raw || '').trim().toLowerCase();
  switch (value) {
    case 'definition':
    case 'go_to_definition':
    case 'goto_definition':
      return 'definition';
    case 'references':
    case 'find_references':
      return 'references';
    case 'hover':
      return 'hover';
    case 'implementation':
    case 'go_to_implementation':
    case 'goto_implementation':
      return 'implementation';
    case 'document_symbols':
    case 'document_symbol':
    case 'symbols':
      return 'document_symbols';
    case 'workspace_symbols':
    case 'workspace_symbol':
      return 'workspace_symbols';
    case 'incoming_calls':
    case 'incoming':
    case 'callers':
    case 'incoming_call_hierarchy':
      return 'incoming_calls';
    case 'outgoing_calls':
    case 'outgoing':
    case 'callees':
    case 'outgoing_call_hierarchy':
      return 'outgoing_calls';
    default:
      return null;
  }
}

function buildPosition(args: any): vscode.Position | null {
  const line = parseNumber(args?.line);
  const character = parseNumber(args?.character ?? args?.column ?? args?.char);
  if (line === null || character === null) return null;
  if (line < 1 || character < 1) return null;
  return new vscode.Position(line - 1, character - 1);
}

function parseNumber(value: any): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function runDefinition(uri: vscode.Uri, position: vscode.Position) {
  try {
    const result = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      uri,
      position,
    );
    const content = await formatPagedLocationResult(
      'Определения',
      result,
      { limit: 20, offset: 0 },
      {
        operation: 'definition',
        path: toAgentRelativePath(uri),
        line: position.line + 1,
        character: position.character + 1,
      },
    );
    const first = (result || [])[0];
    const nextStep = first
      ? `Открой участок вокруг первого результата: ${JSON.stringify({ tool: 'read_file_range', args: { path: toAgentRelativePath(getLocationUri(first)), startLine: Math.max(1, getLocationRange(first).start.line + 1 - 8), endLine: getLocationRange(first).start.line + 1 + 24 } })}`
      : undefined;
    return createToolExecutionResult('lsp_inspect', 'success', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: buildLspLocationPresentation({
          operation: 'definition',
          title: 'Определения',
          count: (result || []).length,
          pagination: { limit: 20, offset: 0 },
          content,
          nextStep,
          items: buildLocationPreviewItems(result || [], 0, 20),
        }),
      },
    });
  } catch {
    const content = 'Ошибка LSP при поиске определения.';
    return createToolExecutionResult('lsp_inspect', 'error', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: {
          operation: 'definition',
          resultCount: 0,
          summary: 'LSP-запрос завершился с ошибкой',
          detail: content,
          preview: content,
        },
      },
    });
  }
}

async function runImplementation(uri: vscode.Uri, position: vscode.Position) {
  try {
    const result = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeImplementationProvider',
      uri,
      position,
    );
    const content = await formatPagedLocationResult(
      'Реализации',
      result,
      { limit: 20, offset: 0 },
      {
        operation: 'implementation',
        path: toAgentRelativePath(uri),
        line: position.line + 1,
        character: position.character + 1,
      },
    );
    const first = (result || [])[0];
    const nextStep = first
      ? `Открой участок вокруг первого результата: ${JSON.stringify({ tool: 'read_file_range', args: { path: toAgentRelativePath(getLocationUri(first)), startLine: Math.max(1, getLocationRange(first).start.line + 1 - 8), endLine: getLocationRange(first).start.line + 1 + 24 } })}`
      : undefined;
    return createToolExecutionResult('lsp_inspect', 'success', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: buildLspLocationPresentation({
          operation: 'implementation',
          title: 'Реализации',
          count: (result || []).length,
          pagination: { limit: 20, offset: 0 },
          content,
          nextStep,
          items: buildLocationPreviewItems(result || [], 0, 20),
        }),
      },
    });
  } catch {
    const content = 'Ошибка LSP при поиске реализации.';
    return createToolExecutionResult('lsp_inspect', 'error', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: {
          operation: 'implementation',
          resultCount: 0,
          summary: 'LSP-запрос завершился с ошибкой',
          detail: content,
          preview: content,
        },
      },
    });
  }
}

async function runReferences(uri: vscode.Uri, position: vscode.Position, args: any) {
  try {
    const result = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      uri,
      position,
    );
    const includeDeclaration = args?.include_declaration === true || args?.includeDeclaration === true;
    const filtered = includeDeclaration
      ? result || []
      : (result || []).filter((location) => !(location.uri.toString() === uri.toString() && location.range.start.isEqual(position)));

    const pagination = normalizeLspPagination(args);
    const content = await formatPagedLocationResult(
      'Ссылки',
      filtered,
      pagination,
      {
        operation: 'references',
        path: toAgentRelativePath(uri),
        line: position.line + 1,
        character: position.character + 1,
        ...(includeDeclaration ? { include_declaration: true } : {}),
      },
    );
    const first = filtered[0];
    const nextStep = first
      ? `Открой участок вокруг первого результата: ${JSON.stringify({ tool: 'read_file_range', args: { path: toAgentRelativePath(getLocationUri(first)), startLine: Math.max(1, getLocationRange(first).start.line + 1 - 8), endLine: getLocationRange(first).start.line + 1 + 24 } })}`
      : undefined;
    return createToolExecutionResult('lsp_inspect', 'success', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: buildLspLocationPresentation({
          operation: 'references',
          title: 'Ссылки',
          count: filtered.length,
          pagination,
          content,
          nextStep,
          items: buildLocationPreviewItems(filtered, pagination.offset, pagination.limit),
        }),
      },
    });
  } catch {
    const content = 'Ошибка LSP при поиске ссылок.';
    return createToolExecutionResult('lsp_inspect', 'error', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: {
          operation: 'references',
          resultCount: 0,
          summary: 'LSP-запрос завершился с ошибкой',
          detail: content,
          preview: content,
        },
      },
    });
  }
}

async function runHover(uri: vscode.Uri, position: vscode.Position) {
  try {
    const result = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      uri,
      position,
    );
    if (!result?.length) {
      const content = 'Hover-информация не найдена.';
      return createToolExecutionResult('lsp_inspect', 'success', content, {
        presentation: {
          kind: 'lsp_inspect',
          data: buildLspHoverPresentation(0, content),
        },
      });
    }

    const chunks = result
      .flatMap((hover) => hover.contents.map(formatHoverContent))
      .map((item) => item.trim())
      .filter(Boolean);

    if (!chunks.length) {
      const content = 'Hover-информация не найдена.';
      return createToolExecutionResult('lsp_inspect', 'success', content, {
        presentation: {
          kind: 'lsp_inspect',
          data: buildLspHoverPresentation(0, content),
        },
      });
    }
    const content = `Hover:\n${chunks.slice(0, 6).join('\n\n---\n\n')}`;
    return createToolExecutionResult('lsp_inspect', 'success', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: buildLspHoverPresentation(chunks.length, content),
      },
    });
  } catch {
    const content = 'Ошибка LSP при получении hover.';
    return createToolExecutionResult('lsp_inspect', 'error', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: {
          operation: 'hover',
          resultCount: 0,
          summary: 'LSP-запрос завершился с ошибкой',
          detail: content,
          preview: content,
        },
      },
    });
  }
}

async function runWorkspaceSymbols(args: any) {
  const query = String(args?.query || args?.symbol || args?.name || '').trim();
  if (!query) {
    const content = 'Для "lsp_inspect" с operation="workspace_symbols" обязателен args.query';
    return createToolExecutionResult('lsp_inspect', 'error', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: {
          operation: 'workspace_symbols',
          resultCount: 0,
          summary: 'LSP-запрос завершился с ошибкой',
          detail: 'Запрос не указан',
          preview: content,
        },
      },
    });
  }

  try {
    const symbols = ((await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      query,
    )) || []).filter((symbol) => symbol?.location?.uri && isUriInAgentWorkspace(symbol.location.uri));
    const pagination = normalizeLspPagination(args);
    const content = formatPagedWorkspaceSymbols(query, symbols, pagination);
    const first = (symbols || [])[pagination.offset];
    const nextStep = first
      ? `Открой файл с первым символом: ${JSON.stringify({ tool: 'read_file', args: { path: toAgentRelativePath(first.location.uri), outputMode: 'outline' } })}`
      : undefined;
    return createToolExecutionResult('lsp_inspect', 'success', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: buildLspWorkspaceSymbolsPresentation(
          query,
          (symbols || []).length,
          pagination,
          content,
          nextStep,
          buildWorkspaceSymbolPreviewItems(symbols || [], pagination.offset, pagination.limit),
        ),
      },
    });
  } catch {
    const content = 'Ошибка LSP при поиске символов workspace.';
    return createToolExecutionResult('lsp_inspect', 'error', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: {
          operation: 'workspace_symbols',
          resultCount: 0,
          summary: 'LSP-запрос завершился с ошибкой',
          detail: content,
          preview: content,
        },
      },
    });
  }
}

async function runCallHierarchy(
  uri: vscode.Uri,
  position: vscode.Position,
  args: any,
  mode: 'incoming_calls' | 'outgoing_calls',
){
  try {
    const pagination = normalizeLspPagination(args);
    const prepared = await vscode.commands.executeCommand<vscode.CallHierarchyItem[] | vscode.CallHierarchyItem>(
      'vscode.prepareCallHierarchy',
      uri,
      position,
    );

    const item = Array.isArray(prepared) ? prepared[0] : prepared;
    if (!item) {
      const content = mode === 'incoming_calls'
        ? 'Входящие вызовы не найдены.'
        : 'Исходящие вызовы не найдены.';
      return createToolExecutionResult('lsp_inspect', 'success', content, {
        presentation: {
          kind: 'lsp_inspect',
          data: buildLspCallHierarchyPresentation({
            operation: mode,
            title: mode === 'incoming_calls' ? 'Входящие вызовы' : 'Исходящие вызовы',
            count: 0,
            pagination,
            content,
          }),
        },
      });
    }
    if (mode === 'incoming_calls') {
      const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
        'vscode.provideIncomingCalls',
        item,
      );
      const content = await formatCallHierarchyResult(
        'Входящие вызовы',
        calls,
        pagination,
        {
          operation: 'incoming_calls',
          path: toAgentRelativePath(uri),
          line: position.line + 1,
          character: position.character + 1,
        },
      );
      const first = (calls || [])[0];
      const target = first ? getCallHierarchyTarget(first) : null;
      const nextStep = target
        ? `Открой участок вокруг первого вызова: ${JSON.stringify({ tool: 'read_file_range', args: { path: toAgentRelativePath(target.uri), startLine: Math.max(1, target.selectionRange.start.line + 1 - 6), endLine: target.selectionRange.start.line + 1 + 24 } })}`
        : undefined;
      return createToolExecutionResult('lsp_inspect', 'success', content, {
        presentation: {
          kind: 'lsp_inspect',
          data: buildLspCallHierarchyPresentation({
            operation: 'incoming_calls',
            title: 'Входящие вызовы',
            count: (calls || []).length,
            pagination,
            content,
            nextStep,
            items: buildCallHierarchyPreviewItems(calls || [], pagination.offset, pagination.limit),
          }),
        },
      });
    }

    const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
      'vscode.provideOutgoingCalls',
      item,
    );
    const content = await formatCallHierarchyResult(
      'Исходящие вызовы',
      calls,
      pagination,
      {
        operation: 'outgoing_calls',
        path: toAgentRelativePath(uri),
        line: position.line + 1,
        character: position.character + 1,
      },
    );
    const first = (calls || [])[0];
    const target = first ? getCallHierarchyTarget(first) : null;
    const nextStep = target
      ? `Открой участок вокруг первого вызова: ${JSON.stringify({ tool: 'read_file_range', args: { path: toAgentRelativePath(target.uri), startLine: Math.max(1, target.selectionRange.start.line + 1 - 6), endLine: target.selectionRange.start.line + 1 + 24 } })}`
      : undefined;
    return createToolExecutionResult('lsp_inspect', 'success', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: buildLspCallHierarchyPresentation({
          operation: 'outgoing_calls',
          title: 'Исходящие вызовы',
          count: (calls || []).length,
          pagination,
          content,
          nextStep,
          items: buildCallHierarchyPreviewItems(calls || [], pagination.offset, pagination.limit),
        }),
      },
    });
  } catch {
    const content = mode === 'incoming_calls'
      ? 'Ошибка LSP при получении входящих вызовов.'
      : 'Ошибка LSP при получении исходящих вызовов.';
    return createToolExecutionResult('lsp_inspect', 'error', content, {
      presentation: {
        kind: 'lsp_inspect',
        data: {
          operation: mode,
          resultCount: 0,
          summary: 'LSP-запрос завершился с ошибкой',
          detail: content,
          preview: content,
        },
      },
    });
  }
}

function formatHoverContent(
  content: vscode.MarkdownString | vscode.MarkedString,
): string {
  if (typeof content === 'string') return content;
  if ('value' in content) return content.value;
  const marked = content as { language?: string; value?: string };
  return `${marked.language || ''}\n${marked.value || ''}`.trim();
}

function getLocationUri(location: vscode.Location | vscode.LocationLink): vscode.Uri {
  return 'targetUri' in location ? location.targetUri : location.uri;
}

function getLocationRange(location: vscode.Location | vscode.LocationLink): vscode.Range {
  return 'targetUri' in location
    ? (location.targetSelectionRange || location.targetRange)
    : location.range;
}

function getCallHierarchyTarget(
  call: vscode.CallHierarchyIncomingCall | vscode.CallHierarchyOutgoingCall,
): vscode.CallHierarchyItem {
  return 'from' in call ? call.from : call.to;
}

function buildLocationPreviewItems(
  locations: Array<vscode.Location | vscode.LocationLink>,
  offset: number,
  limit: number,
) {
  return locations.slice(offset, offset + Math.min(limit, 6)).map((location) => {
    const range = getLocationRange(location);
    return {
      path: toAgentRelativePath(getLocationUri(location)),
      line: range.start.line + 1,
      character: range.start.character + 1,
    };
  });
}

function buildWorkspaceSymbolPreviewItems(
  symbols: vscode.SymbolInformation[],
  offset: number,
  limit: number,
) {
  return symbols.slice(offset, offset + Math.min(limit, 6)).map((symbol) => ({
    name: symbol.name,
    kind: vscode.SymbolKind[symbol.kind] || 'Unknown',
    path: toAgentRelativePath(symbol.location.uri),
    line: symbol.location.range.start.line + 1,
    character: symbol.location.range.start.character + 1,
    ...(symbol.containerName ? { containerName: symbol.containerName } : {}),
  }));
}

function buildCallHierarchyPreviewItems(
  calls: Array<vscode.CallHierarchyIncomingCall | vscode.CallHierarchyOutgoingCall>,
  offset: number,
  limit: number,
) {
  return calls.slice(offset, offset + Math.min(limit, 6)).map((call) => {
    const item = getCallHierarchyTarget(call);
    return {
      name: item.name,
      path: toAgentRelativePath(item.uri),
      line: item.selectionRange.start.line + 1,
      character: item.selectionRange.start.character + 1,
      ...(item.detail ? { detail: item.detail } : {}),
    };
  });
}
