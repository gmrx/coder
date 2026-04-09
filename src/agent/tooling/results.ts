import type { DiagnosticsPresentation } from './diagnostics';
import type { RelevantFilesPresentation, SemanticSearchPresentation } from './retrievalStudy';
import type { EditResultPresentation } from './editStudy';
import type { FileCollectionPresentation } from './fileStudy';
import type { GrepPresentation } from './grepStudy';
import type { LspInspectPresentation } from './lspStudy';
import type {
  McpAuthPresentation,
  McpResourceReadPresentation,
  McpResourcesPresentation,
  McpToolCallPresentation,
  McpToolsPresentation,
} from './mcpStudy';
import type { ProjectStudyPresentation } from './projectStudy';
import type { AskUserResultPresentation } from './questionStudy';
import type { ReadPresentation } from './readStudy';
import type { SkillToolPresentation } from './skillStudy';
import type { ShellResultPresentation } from './shellStudy';
import type { SymbolStudyPresentation } from './symbolStudy';
import type { TaskPresentation } from './taskStudy';
import type { ToolSearchPresentation } from './definitions/toolSearch';
import type { WebFetchPresentation, WebSearchPresentation } from './webStudy';
import type { WorktreePresentation } from './worktreeStudy';

export type ToolExecutionStatus = 'success' | 'error' | 'degraded' | 'blocked';
export type ToolExecutionPhase = 'execution' | 'validation' | 'permission';
export type ToolExecutionRecoveryHintKind = 'adjust_args' | 'tool_search' | 'recommended_tool';

export interface ToolExecutionRecoveryHint {
  kind: ToolExecutionRecoveryHintKind;
  toolName?: string;
  nextStep?: string;
}

export type ToolExecutionPresentationData =
  | {
    kind: 'ask_user';
    data: AskUserResultPresentation;
  }
  | {
    kind: 'skill';
    data: SkillToolPresentation;
  }
  | {
    kind: 'edit';
    data: EditResultPresentation;
  }
  | {
    kind: 'shell';
    data: ShellResultPresentation;
  }
  | {
    kind: 'web_search';
    data: WebSearchPresentation;
  }
  | {
    kind: 'web_fetch';
    data: WebFetchPresentation;
  }
  | {
    kind: 'semantic_search';
    data: SemanticSearchPresentation;
  }
  | {
    kind: 'find_relevant_files';
    data: RelevantFilesPresentation;
  }
  | {
    kind: 'diagnostics';
    data: DiagnosticsPresentation;
  }
  | {
    kind: 'mcp_resources';
    data: McpResourcesPresentation;
  }
  | {
    kind: 'mcp_resource';
    data: McpResourceReadPresentation;
  }
  | {
    kind: 'mcp_tools';
    data: McpToolsPresentation;
  }
  | {
    kind: 'mcp_tool_call';
    data: McpToolCallPresentation;
  }
  | {
    kind: 'mcp_auth';
    data: McpAuthPresentation;
  }
  | {
    kind: 'task';
    data: TaskPresentation;
  }
  | {
    kind: 'read';
    data: ReadPresentation;
  }
  | {
    kind: 'grep';
    data: GrepPresentation;
  }
  | {
    kind: 'file_collection';
    data: FileCollectionPresentation;
  }
  | {
    kind: 'project_study';
    data: ProjectStudyPresentation;
  }
  | {
    kind: 'symbol_study';
    data: SymbolStudyPresentation;
  }
  | {
    kind: 'lsp_inspect';
    data: LspInspectPresentation;
  }
  | {
    kind: 'tool_search';
    data: ToolSearchPresentation;
  }
  | {
    kind: 'worktree';
    data: WorktreePresentation;
  };

export interface ToolExecutionMetaBase {
  phase?: ToolExecutionPhase;
  recoveryHint?: ToolExecutionRecoveryHint;
  followupPrompt?: string;
  presentation?: ToolExecutionPresentationData;
  autoApproved?: boolean;
}

export interface ToolBatchChildResult {
  toolName: string;
  args: any;
  status: ToolExecutionStatus;
  content: string;
  meta?: ToolExecutionMeta;
}

export interface ToolExecutionMeta extends ToolExecutionMetaBase {
  batchResults?: ToolBatchChildResult[];
}

export interface ToolExecutionResult {
  toolName: string;
  status: ToolExecutionStatus;
  content: string;
  meta?: ToolExecutionMeta;
}

export type ToolExecutionOutput =
  | string
  | ToolExecutionResult
  | {
    toolName?: string;
    status: ToolExecutionStatus;
    content: string;
    meta?: ToolExecutionMeta;
  };

export function createToolExecutionResult(
  toolName: string,
  status: ToolExecutionStatus,
  content: string,
  meta?: ToolExecutionMeta,
): ToolExecutionResult {
  return {
    toolName,
    status,
    content: String(content || ''),
    ...(meta ? { meta } : {}),
  };
}

export function classifyToolExecutionResult(toolName: string, content: string): ToolExecutionResult {
  const value = String(content || '').trim();

  if (toolName === 'web_search' && /\(provenance:\s*(llm-fallback|unavailable)\b/i.test(value)) {
    return createToolExecutionResult(toolName, 'degraded', content);
  }

  if (toolName === 'shell') {
    if (
      /^Команда заблокирована:/i.test(value) ||
      /^Команда отклонена пользователем:/i.test(value) ||
      /^Команда не выполнена:\s+(ожидание подтверждения прервано|подтверждение не получено)/i.test(value) ||
      /многострочные команды запрещены/i.test(value)
    ) {
      return createToolExecutionResult(toolName, 'blocked', content);
    }
    if (/^Команда выполнена с замечанием:/i.test(value)) {
      return createToolExecutionResult(toolName, 'degraded', content);
    }
    if (/^Команда выполнена:/i.test(value)) {
      return createToolExecutionResult(toolName, 'success', content);
    }
  }

  if (toolName === 'write_file' || toolName === 'delete_file' || toolName === 'edit_notebook') {
    if (
      /отклонен[ао]\s+пользователем/i.test(value) ||
      /не подтвержден/i.test(value) ||
      /не подтверждена/i.test(value) ||
      /не выполнен[ао]?:\s+ожидание подтверждения прервано/i.test(value)
    ) {
      return createToolExecutionResult(toolName, 'blocked', content);
    }
  }

  if (toolName === 'verification_agent') {
    if (/VERDICT:\s*FAIL\b/i.test(value)) {
      return createToolExecutionResult(toolName, 'error', content);
    }
    if (/VERDICT:\s*PARTIAL\b/i.test(value)) {
      return createToolExecutionResult(toolName, 'degraded', content);
    }
    if (/VERDICT:\s*PASS\b/i.test(value)) {
      return createToolExecutionResult(toolName, 'success', content);
    }
    return createToolExecutionResult(toolName, 'degraded', content);
  }

  if (/^Ошибка:/i.test(value) || /^Error:/i.test(value)) {
    return createToolExecutionResult(toolName, 'error', content);
  }

  if (toolName === 'subagent' && /^\(subagent\)/mi.test(value)) {
    return createToolExecutionResult(toolName, 'error', content);
  }

  return createToolExecutionResult(toolName, 'success', content);
}

export function normalizeToolExecutionOutput(
  toolName: string,
  output: ToolExecutionOutput,
): ToolExecutionResult {
  if (typeof output === 'string') {
    return classifyToolExecutionResult(toolName, output);
  }

  if (output && typeof output === 'object' && 'status' in output && 'content' in output) {
    return createToolExecutionResult(
      toolName,
      output.status,
      output.content,
      output.meta,
    );
  }

  return createToolExecutionResult(toolName, 'error', `Ошибка: некорректный результат инструмента "${toolName}"`);
}
