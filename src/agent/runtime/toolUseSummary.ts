import { getToolDefinition } from '../tooling/catalog';
import { classifyShellCommand } from '../tooling/shellStudy';
import type { ToolExecutionResult } from '../tooling/results';

export type ToolUseSummaryEntry = {
  toolName: string;
  args: any;
  execution: ToolExecutionResult;
  displayName: string;
  resultSummary: string;
  countsAsTool: boolean;
};

export type ToolUseSummaryPresentation = {
  summary: string;
  detail: string;
  activitySummary: string;
  count: number;
  tools: string[];
};

type ToolGroupFlags = {
  hasMutation: boolean;
  hasSuccessfulMutation: boolean;
  hasVerification: boolean;
  hasRetrieval: boolean;
  hasReadStudy: boolean;
  hasSubagent: boolean;
  hasShellCheck: boolean;
  hasProblem: boolean;
};

const READ_STUDY_TOOLS = new Set([
  'scan_structure',
  'list_files',
  'find_files',
  'glob',
  'grep',
  'read_file',
  'read_file_range',
  'detect_stack',
  'workspace_symbols',
  'lsp_inspect',
  'extract_symbols',
  'dependencies',
]);

const VERIFICATION_TOOLS = new Set([
  'verification_agent',
  'get_diagnostics',
  'read_lints',
]);

function compactText(text: string | undefined, maxLength = 180): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function isMutationTool(toolName: string): boolean {
  return !!getToolDefinition(toolName)?.mutatesWorkspace;
}

function isRetrievalTool(toolName: string): boolean {
  return !!getToolDefinition(toolName)?.workflowRoles?.includes('retrieval');
}

function isReadStudyTool(toolName: string): boolean {
  return READ_STUDY_TOOLS.has(toolName);
}

function isVerificationTool(toolName: string, args: any): boolean {
  if (VERIFICATION_TOOLS.has(toolName)) return true;
  if (toolName !== 'shell') return false;
  const descriptor = classifyShellCommand(String(args?.command || args?.cmd || ''));
  return descriptor.risk === 'check';
}

function isShellReadStudyTool(toolName: string, args: any): boolean {
  if (toolName !== 'shell') return false;
  const descriptor = classifyShellCommand(String(args?.command || args?.cmd || ''));
  return descriptor.risk === 'inspect';
}

function isSuccessfulToolResult(execution: ToolExecutionResult): boolean {
  return execution.status === 'success' || execution.status === 'degraded';
}

function classifyEntries(entries: ToolUseSummaryEntry[]): ToolGroupFlags {
  const flags: ToolGroupFlags = {
    hasMutation: false,
    hasSuccessfulMutation: false,
    hasVerification: false,
    hasRetrieval: false,
    hasReadStudy: false,
    hasSubagent: false,
    hasShellCheck: false,
    hasProblem: false,
  };

  for (const entry of entries) {
    if (isMutationTool(entry.toolName)) {
      flags.hasMutation = true;
      if (isSuccessfulToolResult(entry.execution)) flags.hasSuccessfulMutation = true;
    }
    if (isVerificationTool(entry.toolName, entry.args)) {
      flags.hasVerification = true;
      if (entry.toolName === 'shell') flags.hasShellCheck = true;
    }
    if (isRetrievalTool(entry.toolName)) flags.hasRetrieval = true;
    if (isReadStudyTool(entry.toolName) || isShellReadStudyTool(entry.toolName, entry.args)) {
      flags.hasReadStudy = true;
    }
    if (entry.toolName === 'subagent') flags.hasSubagent = true;
    if (entry.execution.status === 'error' || entry.execution.status === 'blocked') {
      flags.hasProblem = true;
    }
  }

  return flags;
}

function buildSummary(flags: ToolGroupFlags): string {
  if (flags.hasMutation && flags.hasVerification) {
    if (!flags.hasSuccessfulMutation || flags.hasProblem) return 'Подготовил правки и проверил ограничения';
    return 'Внёс правки и проверил их';
  }

  if (flags.hasMutation && (flags.hasRetrieval || flags.hasReadStudy)) {
    return flags.hasSuccessfulMutation
      ? 'Изучил код и подготовил правки'
      : 'Изучил код и попытался внести правки';
  }

  if (flags.hasMutation) {
    return flags.hasSuccessfulMutation ? 'Применил правки в проекте' : 'Попытался применить правки';
  }

  if (flags.hasVerification && (flags.hasRetrieval || flags.hasReadStudy)) {
    return flags.hasShellCheck
      ? 'Собрал контекст и запустил проверки'
      : 'Собрал контекст и проверил выводы';
  }

  if (flags.hasVerification) {
    return flags.hasShellCheck ? 'Запустил проверки проекта' : 'Проверил текущую реализацию';
  }

  if (flags.hasSubagent && (flags.hasRetrieval || flags.hasReadStudy)) {
    return 'Собрал контекст и подключил подагентов';
  }

  if (flags.hasSubagent) {
    return 'Собрал результаты от подагентов';
  }

  if (flags.hasRetrieval && flags.hasReadStudy) {
    return 'Сузил область и собрал контекст';
  }

  if (flags.hasRetrieval) {
    return 'Сузил область поиска';
  }

  if (flags.hasReadStudy) {
    return 'Собрал контекст по коду';
  }

  return 'Завершил серию действий';
}

function buildActivitySummary(flags: ToolGroupFlags): string {
  if (flags.hasMutation && flags.hasVerification) {
    return flags.hasSuccessfulMutation && !flags.hasProblem
      ? 'Проверяю внесённые правки'
      : 'Проверяю ограничения после правок';
  }

  if (flags.hasMutation && (flags.hasRetrieval || flags.hasReadStudy)) {
    return 'Готовлю правки по коду';
  }

  if (flags.hasMutation) {
    return 'Вношу правки в проект';
  }

  if (flags.hasVerification && (flags.hasRetrieval || flags.hasReadStudy)) {
    return 'Проверяю гипотезы по коду';
  }

  if (flags.hasVerification) {
    return flags.hasShellCheck ? 'Запускаю проверки проекта' : 'Проверяю реализацию';
  }

  if (flags.hasSubagent) {
    return 'Собираю результаты от подагентов';
  }

  if (flags.hasRetrieval && flags.hasReadStudy) {
    return 'Сужаю область и изучаю код';
  }

  if (flags.hasRetrieval) {
    return 'Сужаю область поиска';
  }

  if (flags.hasReadStudy) {
    return 'Изучаю кодовую базу';
  }

  return 'Продвигаю выполнение';
}

function buildDetail(entries: ToolUseSummaryEntry[]): string {
  const parts = Array.from(
    new Set(
      entries
        .map((entry) => compactText(entry.resultSummary || '', 72))
        .filter(Boolean),
    ),
  ).slice(0, 3);

  const extra = entries.length - parts.length;
  if (parts.length === 0) return entries.length > 0 ? `шагов: ${entries.length}` : '';
  return parts.join(' • ') + (extra > 0 ? ` +${extra}` : '');
}

export function buildToolUseSummary(
  entries: ToolUseSummaryEntry[],
): ToolUseSummaryPresentation | null {
  const meaningfulEntries = entries.filter((entry) => entry.countsAsTool);
  if (meaningfulEntries.length < 2) return null;

  const flags = classifyEntries(meaningfulEntries);
  return {
    summary: buildSummary(flags),
    detail: buildDetail(meaningfulEntries),
    activitySummary: buildActivitySummary(flags),
    count: meaningfulEntries.length,
    tools: meaningfulEntries.map((entry) => entry.toolName),
  };
}
