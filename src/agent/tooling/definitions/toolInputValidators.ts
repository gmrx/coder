export interface ToolInputValidationContext {
  query?: string;
}

import { validateAskUserQuestions } from '../questionStudy';
import { getMcpToolNameArg } from '../../mcp/executionPolicy';

export type ToolInputValidator = (
  args: any,
  context: ToolInputValidationContext,
) => string | null;

function hasText(value: any): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function hasOwn(value: any, key: string): boolean {
  return !!value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
}

function hasAny(value: any, keys: string[]): boolean {
  return keys.some((key) => hasText(value?.[key]));
}

function hasNotebookTarget(value: any): boolean {
  return hasAny(value, ['target_notebook', 'path', 'notebook']);
}

function isPlainObject(value: any): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizedOperation(value: any): string {
  return String(value || '').trim().toLowerCase();
}

function validatePathTool(tool: string, args: any): string | null {
  return hasText(args?.path) ? null : `Для "${tool}" обязателен args.path`;
}

function validateLimitOffset(tool: string, args: any): string | null {
  if (args?.limit !== undefined) {
    const limit = Number(args.limit);
    if (!Number.isFinite(limit) || limit <= 0) {
      return `Для "${tool}" args.limit должен быть положительным числом`;
    }
  }
  if (args?.offset !== undefined) {
    const offset = Number(args.offset);
    if (!Number.isFinite(offset) || offset < 0) {
      return `Для "${tool}" args.offset должен быть неотрицательным числом`;
    }
  }
  return null;
}

function validateReadFileArgs(args: any): string | null {
  const pathError = validatePathTool('read_file', args);
  if (pathError) return pathError;

  if (args?.limit !== undefined) {
    const limit = Number(args.limit);
    if (!Number.isFinite(limit) || limit <= 0) {
      return 'Для "read_file" args.limit должен быть положительным числом';
    }
  }

  if (args?.offset !== undefined) {
    const offset = Number(args.offset);
    if (!Number.isFinite(offset)) {
      return 'Для "read_file" args.offset должен быть числом';
    }
  }

  if (!hasText(args?.outputMode) && !hasText(args?.mode) && !hasText(args?.view)) return null;
  const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
  return ['auto', 'outline', 'summary', 'head', 'tail', 'manifest', 'config', 'metadata', 'meta', 'info', 'start', 'top', 'end', 'bottom'].includes(outputMode)
    ? null
    : 'Для "read_file" args.outputMode должен быть auto, outline, head, tail, manifest или metadata';
}

function validateDiagnosticsArgs(tool: string, args: any): string | null {
  const paginationError = validateLimitOffset(tool, args);
  if (paginationError) return paginationError;

  if (args?.paths !== undefined) {
    if (!Array.isArray(args.paths)) {
      return `Для "${tool}" args.paths должен быть массивом путей`;
    }
    if (args.paths.some((item: unknown) => !hasText(item))) {
      return `Для "${tool}" args.paths должен содержать только непустые пути`;
    }
  }

  if (hasText(args?.outputMode) || hasText(args?.mode) || hasText(args?.view)) {
    const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
    if (outputMode !== 'summary' && outputMode !== 'files' && outputMode !== 'items') {
      return `Для "${tool}" args.outputMode должен быть summary, files или items`;
    }
  }

  if (hasText(args?.severity)) {
    const severity = String(args.severity).trim().toLowerCase();
    if (!['default', 'all', 'error', 'warning', 'info', 'hint'].includes(severity)) {
      return `Для "${tool}" args.severity должен быть default, all, error, warning, info или hint`;
    }
  }

  return null;
}

function validateOverviewMode(
  tool: string,
  args: any,
  allowedModes: string[],
): string | null {
  const paginationError = validateLimitOffset(tool, args);
  if (paginationError) return paginationError;
  if (!hasText(args?.outputMode) && !hasText(args?.mode) && !hasText(args?.view)) return null;
  const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
  return allowedModes.includes(outputMode)
    ? null
    : `Для "${tool}" args.outputMode должен быть одним из: ${allowedModes.join(', ')}`;
}

function validateTaskStatus(tool: string, value: unknown): string | null {
  if (!hasText(value)) return null;
  const status = String(value).trim().toLowerCase();
  return ['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'blocked'].includes(status)
    ? null
    : `Для "${tool}" args.status должен быть pending, in_progress, completed, failed, cancelled или blocked`;
}

function validateTaskKind(tool: string, value: unknown): string | null {
  if (!hasText(value)) return null;
  const kind = String(value).trim().toLowerCase();
  return kind === 'generic' || kind === 'shell'
    ? null
    : `Для "${tool}" args.kind должен быть generic или shell`;
}

export const TOOL_INPUT_VALIDATORS: Partial<Record<string, ToolInputValidator>> = {
  tool_search(args) {
    return hasAny(args, ['query', 'intent', 'task']) ? null : 'Для "tool_search" обязателен args.query';
  },
  skill(args) {
    return hasText(args?.name) || hasText(args?.skill) || hasText(args?.command)
      ? null
      : 'Для "skill" обязателен args.name';
  },
  ask_user(args) {
    return validateAskUserQuestions(args?.questions);
  },
  task_create(args) {
    if (!hasText(args?.subject)) return 'Для "task_create" обязателен args.subject';
    if (args?.metadata !== undefined && !isPlainObject(args.metadata)) {
      return 'Для "task_create" args.metadata должен быть объектом';
    }
    return null;
  },
  task_list(args) {
    const paginationError = validateLimitOffset('task_list', args);
    if (paginationError) return paginationError;
    return validateTaskStatus('task_list', args?.status) || validateTaskKind('task_list', args?.kind);
  },
  task_get(args) {
    return hasText(args?.id) ? null : 'Для "task_get" обязателен args.id';
  },
  task_update(args) {
    if (!hasText(args?.id)) return 'Для "task_update" обязателен args.id';
    if (args?.metadata !== undefined && !isPlainObject(args.metadata)) {
      return 'Для "task_update" args.metadata должен быть объектом';
    }
    return validateTaskStatus('task_update', args?.status);
  },
  task_stop(args) {
    if (!hasText(args?.id)) return 'Для "task_stop" обязателен args.id';
    if (args?.force !== undefined && typeof args.force !== 'boolean') {
      return 'Для "task_stop" args.force должен быть boolean';
    }
    return null;
  },
  jira_list_projects(args) {
    return validateLimitOffset('jira_list_projects', args);
  },
  jira_search_tasks(args) {
    const paginationError = validateLimitOffset('jira_search_tasks', {
      limit: args?.limit ?? args?.maxResults ?? args?.max_results,
      offset: args?.offset ?? args?.startAt ?? args?.start_at,
    });
    if (paginationError) return paginationError;
    if (args?.fields !== undefined && typeof args.fields !== 'string' && !Array.isArray(args.fields)) {
      return 'Для "jira_search_tasks" args.fields должен быть строкой или массивом';
    }
    return null;
  },
  jira_get_task(args) {
    if (!hasAny(args, ['key', 'issueKey', 'issue_key', 'id'])) {
      return 'Для "jira_get_task" обязателен args.key';
    }
    if (args?.fields !== undefined && typeof args.fields !== 'string' && !Array.isArray(args.fields)) {
      return 'Для "jira_get_task" args.fields должен быть строкой или массивом';
    }
    return null;
  },
  list_mcp_resources(args) {
    return args?.server === undefined || hasText(args?.server)
      ? null
      : 'Для "list_mcp_resources" args.server должен быть строкой';
  },
  list_mcp_tools(args) {
    return args?.server === undefined || hasText(args?.server)
      ? null
      : 'Для "list_mcp_tools" args.server должен быть строкой';
  },
  read_mcp_resource(args) {
    if (!hasText(args?.server)) return 'Для "read_mcp_resource" обязателен args.server';
    if (!hasText(args?.uri)) return 'Для "read_mcp_resource" обязателен args.uri';
    return null;
  },
  mcp_tool(args) {
    if (!hasText(args?.server)) return 'Для "mcp_tool" обязателен args.server';
    if (!hasText(getMcpToolNameArg(args))) return 'Для "mcp_tool" обязателен args.name';
    if (args?.arguments !== undefined && (!args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments))) {
      return 'Для "mcp_tool" args.arguments должен быть объектом';
    }
    return null;
  },
  mcp_auth(args) {
    if (!hasText(args?.server)) return 'Для "mcp_auth" обязателен args.server';
    if (args?.force !== undefined && typeof args.force !== 'boolean') {
      return 'Для "mcp_auth" args.force должен быть boolean';
    }
    return null;
  },
  enter_worktree(args) {
    if (args?.name === undefined || !String(args.name).trim()) return null;
    const name = String(args.name).trim();
    if (name.length > 64) {
      return 'Для "enter_worktree" args.name должен быть не длиннее 64 символов';
    }
    return /^[A-Za-z0-9._/-]+$/.test(name)
      ? null
      : 'Для "enter_worktree" args.name может содержать только буквы, цифры, точки, подчёркивания, дефисы и "/"';
  },
  exit_worktree(args) {
    const action = String(args?.action || '').trim().toLowerCase();
    if (action !== 'keep' && action !== 'remove') {
      return 'Для "exit_worktree" args.action должен быть keep или remove';
    }
    if (args?.discard_changes !== undefined && typeof args.discard_changes !== 'boolean') {
      return 'Для "exit_worktree" args.discard_changes должен быть boolean';
    }
    return null;
  },
  tool_batch(args) {
    const tools = args?.tools;
    if (!Array.isArray(tools)) {
      return 'Для "tool_batch" обязателен args.tools (массив вызовов { tool, args })';
    }
    if (tools.length < 1) {
      return 'Для "tool_batch" укажи хотя бы один независимый вызов';
    }

    for (let index = 0; index < tools.length; index++) {
      const item = tools[index];
      if (!isPlainObject(item)) {
        return `Элемент args.tools[${index}] должен быть объектом вида { tool, args }`;
      }
      if (!hasText(item.tool)) {
        return `Для args.tools[${index}] обязателен tool`;
      }
      if (String(item.tool).trim() === 'tool_batch') {
        return 'Вложенный "tool_batch" запрещён';
      }
      if (String(item.tool).trim() === 'final_answer') {
        return '"final_answer" нельзя вызывать внутри "tool_batch"';
      }
      if (item.args !== undefined && !isPlainObject(item.args)) {
        return `args.tools[${index}].args должен быть объектом`;
      }
    }

    return null;
  },
  read_file(args) {
    return validateReadFileArgs(args);
  },
  read_file_range(args) {
    return validatePathTool('read_file_range', args);
  },
  extract_symbols(args) {
    const pathError = validatePathTool('extract_symbols', args);
    if (pathError) return pathError;
    const paginationError = validateLimitOffset('extract_symbols', args);
    if (paginationError) return paginationError;
    if (!hasText(args?.outputMode) && !hasText(args?.mode) && !hasText(args?.view)) return null;
    const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
    return outputMode === 'summary' || outputMode === 'overview' || outputMode === 'symbols' || outputMode === 'list' || outputMode === 'items' || outputMode === 'kinds' || outputMode === 'types' || outputMode === 'by_kind' || outputMode === 'grouped'
      ? null
      : 'Для "extract_symbols" args.outputMode должен быть summary, symbols или kinds';
  },
  scan_structure(args) {
    return validateOverviewMode('scan_structure', args, ['overview', 'dirs', 'important_files', 'important', 'files', 'directories']);
  },
  list_files(args) {
    const paginationError = validateLimitOffset('list_files', args);
    if (paginationError) return paginationError;
    if (!hasText(args?.outputMode) && !hasText(args?.mode) && !hasText(args?.view)) return null;
    const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
    return outputMode === 'tree' || outputMode === 'flat' || outputMode === 'dirs' || outputMode === 'directories' || outputMode === 'folders' || outputMode === 'list' || outputMode === 'files'
      ? null
      : 'Для "list_files" args.outputMode должен быть tree, flat или dirs';
  },
  glob(args) {
    if (!hasAny(args, ['glob_pattern', 'pattern'])) {
      return 'Для "glob" обязателен args.glob_pattern';
    }
    const paginationError = validateLimitOffset('glob', args);
    if (paginationError) return paginationError;
    if (!hasText(args?.outputMode) && !hasText(args?.mode) && !hasText(args?.view)) return null;
    const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
    return outputMode === 'flat' || outputMode === 'grouped' || outputMode === 'dirs' || outputMode === 'directories'
      ? null
      : 'Для "glob" args.outputMode должен быть flat или grouped';
  },
  find_files(args) {
    if (!hasAny(args, ['pattern', 'glob_pattern'])) {
      return 'Для "find_files" обязателен args.pattern';
    }
    const paginationError = validateLimitOffset('find_files', args);
    if (paginationError) return paginationError;
    if (!hasText(args?.outputMode) && !hasText(args?.mode) && !hasText(args?.view)) return null;
    const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
    return outputMode === 'flat' || outputMode === 'grouped' || outputMode === 'dirs' || outputMode === 'directories'
      ? null
      : 'Для "find_files" args.outputMode должен быть flat или grouped';
  },
  detect_stack(args) {
    return validateOverviewMode('detect_stack', args, ['summary', 'entrypoints', 'entries', 'entry_files', 'infra', 'infrastructure']);
  },
  grep(args) {
    return hasText(args?.pattern) ? null : 'Для "grep" обязателен args.pattern';
  },
  workspace_symbols(args) {
    if (!hasAny(args, ['query', 'symbol', 'name'])) {
      return 'Для "workspace_symbols" обязателен args.query';
    }
    return validateLimitOffset('workspace_symbols', args);
  },
  lsp_inspect(args) {
    const operation = normalizedOperation(args?.operation);
    if (!operation) {
      return 'Для "lsp_inspect" обязателен args.operation';
    }

    const paginationError = validateLimitOffset('lsp_inspect', args);
    if (paginationError) return paginationError;

    if (operation === 'workspace_symbols' || operation === 'workspace_symbol') {
      return hasAny(args, ['query', 'symbol', 'name'])
        ? null
        : 'Для "lsp_inspect" с operation="workspace_symbols" обязателен args.query';
    }

    if (operation === 'document_symbols' || operation === 'document_symbol' || operation === 'symbols') {
      return validatePathTool('lsp_inspect', args);
    }

    const validOperations = new Set([
      'definition',
      'go_to_definition',
      'goto_definition',
      'references',
      'find_references',
      'hover',
      'implementation',
      'go_to_implementation',
      'goto_implementation',
      'document_symbols',
      'document_symbol',
      'symbols',
      'workspace_symbols',
      'workspace_symbol',
      'incoming_calls',
      'incoming',
      'callers',
      'incoming_call_hierarchy',
      'outgoing_calls',
      'outgoing',
      'callees',
      'outgoing_call_hierarchy',
    ]);
    if (!validOperations.has(operation)) {
      return 'Для "lsp_inspect" operation должен быть одним из: definition, references, hover, implementation, document_symbols, workspace_symbols, incoming_calls, outgoing_calls';
    }
    if (!hasText(args?.path)) {
      return `Для "lsp_inspect" с operation="${operation}" обязателен args.path`;
    }
    if (!hasText(args?.line) || !hasText(args?.character ?? args?.column ?? args?.char)) {
      return `Для "lsp_inspect" с operation="${operation}" обязательны args.line и args.character`;
    }
    return null;
  },
  dependencies(args) {
    const paths = Array.isArray(args?.paths) ? args.paths.filter((item: unknown) => hasText(item)) : [];
    if (!(paths.length > 0 || hasText(args?.path))) {
      return 'Для "dependencies" укажи args.paths (массив путей) или args.path';
    }
    const paginationError = validateLimitOffset('dependencies', args);
    if (paginationError) return paginationError;
    if (!hasText(args?.outputMode) && !hasText(args?.mode) && !hasText(args?.view)) return null;
    const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
    return outputMode === 'summary' || outputMode === 'packages' || outputMode === 'package' || outputMode === 'manifests' || outputMode === 'manifest' || outputMode === 'files' || outputMode === 'by_file' || outputMode === 'sources' || outputMode === 'graph' || outputMode === 'imports' || outputMode === 'import_graph'
      ? null
      : 'Для "dependencies" args.outputMode должен быть summary, manifests, packages, files или graph';
  },
  read_lints(args) {
    return validateDiagnosticsArgs('read_lints', args);
  },
  get_diagnostics(args) {
    return validateDiagnosticsArgs('get_diagnostics', args);
  },
  semantic_search(args) {
    if (!hasText(args?.query)) return 'Для "semantic_search" обязателен args.query';
    const paginationError = validateLimitOffset('semantic_search', args);
    if (paginationError) return paginationError;
    if (!hasText(args?.outputMode) && !hasText(args?.mode) && !hasText(args?.view)) return null;
    const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
    return outputMode === 'summary' || outputMode === 'files' || outputMode === 'chunks' || outputMode === 'chunk' || outputMode === 'content' || outputMode === 'snippets'
      ? null
      : 'Для "semantic_search" args.outputMode должен быть summary, files или chunks';
  },
  find_relevant_files(args) {
    if (!hasText(args?.query)) return 'Для "find_relevant_files" обязателен args.query';
    const paginationError = validateLimitOffset('find_relevant_files', args);
    if (paginationError) return paginationError;
    if (!hasText(args?.outputMode) && !hasText(args?.mode) && !hasText(args?.view)) return null;
    const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
    return outputMode === 'summary' || outputMode === 'files' || outputMode === 'snippets' || outputMode === 'chunks' || outputMode === 'content'
      ? null
      : 'Для "find_relevant_files" args.outputMode должен быть summary, files или snippets';
  },
  web_search(args) {
    if (!hasAny(args, ['query', 'search_term'])) {
      return 'Для "web_search" обязателен args.query';
    }
    if (args?.limit !== undefined) {
      const limit = Number(args.limit);
      if (!Number.isFinite(limit) || limit <= 0) {
        return 'Для "web_search" args.limit должен быть положительным числом';
      }
    }
    if (hasText(args?.outputMode) || hasText(args?.mode) || hasText(args?.view)) {
      const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
      if (!['summary', 'results', 'sources', 'links', 'urls', 'content', 'snippets', 'answer', 'grounded', 'synthesize'].includes(outputMode)) {
        return 'Для "web_search" args.outputMode должен быть summary, results, sources или answer';
      }
    }
    if (args?.prompt !== undefined && !hasText(args.prompt)) {
      return 'Для "web_search" args.prompt должен быть непустой строкой';
    }
    if (args?.answer_prompt !== undefined && !hasText(args.answer_prompt)) {
      return 'Для "web_search" args.answer_prompt должен быть непустой строкой';
    }
    if (args?.fetchTopResults !== undefined || args?.fetch_top_results !== undefined) {
      const value = Number(args?.fetchTopResults ?? args?.fetch_top_results);
      if (!Number.isFinite(value) || value <= 0) {
        return 'Для "web_search" args.fetchTopResults должен быть положительным числом';
      }
    }
    if (args?.allowed_domains !== undefined) {
      if (!Array.isArray(args.allowed_domains) || args.allowed_domains.some((item: unknown) => !hasText(item))) {
        return 'Для "web_search" args.allowed_domains должен быть массивом непустых доменов';
      }
    }
    if (args?.blocked_domains !== undefined) {
      if (!Array.isArray(args.blocked_domains) || args.blocked_domains.some((item: unknown) => !hasText(item))) {
        return 'Для "web_search" args.blocked_domains должен быть массивом непустых доменов';
      }
    }
    if (args?.allow_llm_fallback !== undefined && typeof args.allow_llm_fallback !== 'boolean') {
      return 'Для "web_search" args.allow_llm_fallback должен быть boolean';
    }
    return null;
  },
  web_fetch(args) {
    if (!hasText(args?.url)) return 'Для "web_fetch" обязателен args.url';
    if (!/^https?:\/\//i.test(String(args.url).trim())) {
      return 'Для "web_fetch" укажи полный URL с http:// или https://';
    }
    if (hasText(args?.outputMode) || hasText(args?.mode) || hasText(args?.view)) {
      const outputMode = String(args?.outputMode || args?.mode || args?.view || '').trim().toLowerCase();
      if (!['summary', 'content', 'metadata', 'meta', 'info', 'full', 'text'].includes(outputMode)) {
        return 'Для "web_fetch" args.outputMode должен быть summary, content или metadata';
      }
    }
    if (args?.prompt !== undefined && !hasText(args.prompt)) {
      return 'Для "web_fetch" args.prompt должен быть непустой строкой';
    }
    return null;
  },
  shell(args) {
    if (!hasAny(args, ['command', 'cmd'])) return 'Для "shell" обязателен args.command';
    if (/[\r\n]/.test(String(args?.command || args?.cmd || ''))) {
      return 'Для "shell" запрещены многострочные команды';
    }
    if (args?.run_in_background !== undefined && typeof args.run_in_background !== 'boolean') {
      return 'Для "shell" args.run_in_background должен быть boolean';
    }
    if (args?.background !== undefined && typeof args.background !== 'boolean') {
      return 'Для "shell" args.background должен быть boolean';
    }
    if (args?.task_subject !== undefined && !hasText(args.task_subject)) {
      return 'Для "shell" args.task_subject должен быть непустой строкой';
    }
    if (args?.task_description !== undefined && !hasText(args.task_description)) {
      return 'Для "shell" args.task_description должен быть непустой строкой';
    }
    return null;
  },
  str_replace(args) {
    if (!hasText(args?.path)) return 'Для "str_replace" обязателен args.path';
    if (!hasAny(args, ['old_string', 'old', 'search'])) return 'Для "str_replace" обязателен args.old_string';
    return null;
  },
  write_file(args) {
    if (!hasText(args?.path)) return 'Для "write_file" обязателен args.path';
    return hasOwn(args, 'contents') || hasOwn(args, 'content') || hasOwn(args, 'text')
      ? null
      : 'Для "write_file" обязателен args.contents';
  },
  delete_file(args) {
    return validatePathTool('delete_file', args);
  },
  edit_notebook(args) {
    if (!hasNotebookTarget(args)) {
      return 'Для "edit_notebook" обязателен args.target_notebook (или args.path)';
    }
    if (args?.cell_idx === undefined && args?.cell_index === undefined) {
      return 'Для "edit_notebook" обязателен args.cell_idx (индекс ячейки, 0-based)';
    }
    if (
      !hasOwn(args, 'new_string') &&
      !hasOwn(args, 'new') &&
      !hasOwn(args, 'content')
    ) {
      return 'Для "edit_notebook" обязателен args.new_string';
    }
    return null;
  },
  subagent(args) {
    const hasPrompt = hasAny(args, ['prompt', 'task', 'query', 'goal', 'instruction']);
    const hasTasks = Array.isArray(args?.tasks) && args.tasks.length > 0;
    return hasPrompt || hasTasks
      ? null
      : 'Для "subagent" укажи args.prompt либо непустой args.tasks';
  },
  verification_agent(args, context) {
    return hasAny(args, ['task', 'original_task']) || hasText(context.query)
      ? null
      : 'Для "verification_agent" укажи args.task или вызывай его в контексте пользовательского запроса';
  },
};

export function validateToolInput(
  toolName: string,
  args: any,
  context: ToolInputValidationContext = {},
): string | null {
  const validator = TOOL_INPUT_VALIDATORS[toolName];
  return validator ? validator(args || {}, context) : null;
}
