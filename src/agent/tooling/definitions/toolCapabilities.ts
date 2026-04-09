import type { AgentApprovalRequest } from '../../runtime/approvals';
import {
  type ToolApprovalDefinition,
  type ToolCapabilities,
  type ToolDefinition,
  type ToolInterruptBehavior,
} from './toolDefinitions';
import { getToolDefinition } from './toolPolicies';

function getDefinition(toolName: string): ToolDefinition | undefined {
  return getToolDefinition(toolName);
}

export function getToolCapabilities(toolName: string): ToolCapabilities {
  const definition = getDefinition(toolName);
  if (!definition) return {};
  return definition.capabilities || {};
}

export function getToolUserFacingName(toolName: string): string {
  const definition = getDefinition(toolName);
  if (!definition) return toolName;
  return definition.capabilities?.userFacingName || definition.name;
}

export function isToolReadOnly(toolName: string): boolean {
  const definition = getDefinition(toolName);
  if (!definition) return false;
  if (typeof definition.capabilities?.readOnly === 'boolean') {
    return definition.capabilities.readOnly;
  }
  return !definition.mutatesWorkspace && !definition.requiresShellAccess;
}

export function isToolDestructive(toolName: string): boolean {
  const definition = getDefinition(toolName);
  return !!definition?.capabilities?.destructive;
}

export function isToolConcurrencySafe(toolName: string): boolean {
  const definition = getDefinition(toolName);
  return !!definition?.capabilities?.concurrencySafe;
}

export function toolRequiresUserInteraction(toolName: string): boolean {
  const definition = getDefinition(toolName);
  return !!definition?.capabilities?.requiresUserInteraction;
}

export function shouldDeferTool(toolName: string): boolean {
  const definition = getDefinition(toolName);
  return !!definition?.capabilities?.shouldDefer;
}

export function getToolInterruptBehavior(toolName: string): ToolInterruptBehavior {
  const definition = getDefinition(toolName);
  return definition?.capabilities?.interruptBehavior || 'block';
}

export function requiresToolApproval(toolName: string): boolean {
  const definition = getDefinition(toolName);
  return !!definition?.capabilities?.approval;
}

export function getToolTraceMeta(toolName: string): {
  displayName: string;
  readOnly: boolean;
  destructive: boolean;
  requiresUserInteraction: boolean;
  deferred: boolean;
  interruptBehavior: ToolInterruptBehavior;
} {
  return {
    displayName: getToolUserFacingName(toolName),
    readOnly: isToolReadOnly(toolName),
    destructive: isToolDestructive(toolName),
    requiresUserInteraction: toolRequiresUserInteraction(toolName),
    deferred: shouldDeferTool(toolName),
    interruptBehavior: getToolInterruptBehavior(toolName),
  };
}

export function getToolCapabilityNotes(toolName: string): string[] {
  const meta = getToolTraceMeta(toolName);
  const notes: string[] = [];
  if (meta.readOnly) notes.push('только чтение');
  if (meta.requiresUserInteraction) notes.push('нужно взаимодействие пользователя');
  if (meta.deferred) notes.push('лучше не вызывать первым ходом');
  if (meta.destructive) notes.push('рискованное действие');
  return notes;
}

function buildShellApproval(
  definition: ToolDefinition,
  approval: ToolApprovalDefinition,
  meta: any,
): AgentApprovalRequest {
  return {
    kind: 'shell',
    confirmId: String(meta?.confirmId || ''),
    title: approval.title,
    description: approval.description,
    toolName: definition.name,
    command: String(meta?.command || ''),
    cwd: String(meta?.cwd || ''),
    canEditCommand: approval.editable !== false,
    destructive: !!meta?.destructive || !!definition.capabilities?.destructive,
    readOnly: !!meta?.readOnly,
    riskLabel: typeof meta?.riskLabel === 'string' ? meta.riskLabel : undefined,
    commandKind: typeof meta?.commandKind === 'string' ? meta.commandKind : undefined,
    summary: typeof meta?.summary === 'string' ? meta.summary : undefined,
    cwdLabel: typeof meta?.cwdLabel === 'string' ? meta.cwdLabel : undefined,
  };
}

function buildPlanApproval(
  definition: ToolDefinition,
  approval: ToolApprovalDefinition,
  meta: any,
): AgentApprovalRequest {
  const mutationQuery = !!meta?.mutationQuery;
  return {
    kind: 'plan',
    confirmId: String(meta?.confirmId || ''),
    title: mutationQuery ? 'Утвердите план перед реализацией' : approval.title,
    description: mutationQuery
      ? 'Можно поправить текст плана перед запуском реализации.'
      : approval.description,
    toolName: definition.name,
    plan: String(meta?.plan || ''),
    mutationQuery,
    feedbackPlaceholder: approval.feedbackPlaceholder,
  };
}

function buildFileApproval(
  definition: ToolDefinition,
  approval: ToolApprovalDefinition,
  meta: any,
): AgentApprovalRequest {
  return {
    kind: 'file',
    confirmId: String(meta?.confirmId || ''),
    title: String(meta?.title || approval.title),
    description: String(meta?.description || approval.description || ''),
    toolName: definition.name,
    filePath: String(meta?.filePath || meta?.path || ''),
    changeType: meta?.changeType,
    oldSnippet: typeof meta?.oldSnippet === 'string' ? meta.oldSnippet : '',
    newSnippet: typeof meta?.newSnippet === 'string' ? meta.newSnippet : '',
    cellIdx: typeof meta?.cellIdx === 'number' ? meta.cellIdx : undefined,
    language: typeof meta?.language === 'string' ? meta.language : undefined,
    summary: typeof meta?.summary === 'string' ? meta.summary : undefined,
    stats: meta?.stats && typeof meta.stats === 'object'
      ? {
        beforeLines: Number(meta.stats.beforeLines) || 0,
        afterLines: Number(meta.stats.afterLines) || 0,
        oldBytes: Number(meta.stats.oldBytes) || 0,
        newBytes: Number(meta.stats.newBytes) || 0,
        changedLines: Number(meta.stats.changedLines) || 0,
      }
      : undefined,
  };
}

function buildWorktreeApproval(
  definition: ToolDefinition,
  approval: ToolApprovalDefinition,
  meta: any,
): AgentApprovalRequest {
  return {
    kind: 'worktree',
    confirmId: String(meta?.confirmId || ''),
    title: String(meta?.title || approval.title),
    description: String(meta?.description || approval.description || ''),
    toolName: definition.name,
    action: meta?.action === 'remove' || meta?.action === 'keep' ? meta.action : 'enter',
    worktreePath: String(meta?.worktreePath || ''),
    worktreeBranch: typeof meta?.worktreeBranch === 'string' ? meta.worktreeBranch : undefined,
    originalRootPath: String(meta?.originalRootPath || ''),
    slug: typeof meta?.slug === 'string' ? meta.slug : undefined,
    destructive: !!meta?.destructive || !!definition.capabilities?.destructive,
    summary: typeof meta?.summary === 'string' ? meta.summary : undefined,
  };
}

function buildMcpApproval(
  definition: ToolDefinition,
  approval: ToolApprovalDefinition,
  meta: any,
): AgentApprovalRequest {
  return {
    kind: 'mcp',
    confirmId: String(meta?.confirmId || ''),
    title: String(meta?.title || approval.title),
    description: String(meta?.description || approval.description || ''),
    toolName: definition.name,
    server: String(meta?.server || ''),
    mcpToolName: String(meta?.mcpToolName || meta?.name || ''),
    argsJson: String(meta?.argsJson || '{}'),
    readOnlyHint: typeof meta?.readOnlyHint === 'boolean' ? meta.readOnlyHint : undefined,
    destructiveHint: typeof meta?.destructiveHint === 'boolean' ? meta.destructiveHint : undefined,
    summary: typeof meta?.summary === 'string' ? meta.summary : undefined,
  };
}

function buildWebApproval(
  definition: ToolDefinition,
  approval: ToolApprovalDefinition,
  meta: any,
): AgentApprovalRequest {
  return {
    kind: 'web',
    confirmId: String(meta?.confirmId || ''),
    title: String(meta?.title || approval.title),
    description: String(meta?.description || approval.description || ''),
    toolName: definition.name,
    url: String(meta?.url || ''),
    host: String(meta?.host || ''),
    prompt: typeof meta?.prompt === 'string' ? meta.prompt : undefined,
    trustKind: typeof meta?.trustKind === 'string' ? meta.trustKind : undefined,
    summary: typeof meta?.summary === 'string' ? meta.summary : undefined,
  };
}

export function buildToolApprovalRequest(toolName: string, meta: any): AgentApprovalRequest | undefined {
  const definition = getDefinition(toolName);
  const approval = definition?.capabilities?.approval;
  if (!definition || !approval) return undefined;

  if (approval.kind === 'shell') {
    return buildShellApproval(definition, approval, meta);
  }

  if (approval.kind === 'plan') {
    return buildPlanApproval(definition, approval, meta);
  }

  if (approval.kind === 'file') {
    return buildFileApproval(definition, approval, meta);
  }

  if (approval.kind === 'worktree') {
    return buildWorktreeApproval(definition, approval, meta);
  }

  if (approval.kind === 'mcp') {
    return buildMcpApproval(definition, approval, meta);
  }

  if (approval.kind === 'web') {
    return buildWebApproval(definition, approval, meta);
  }

  return undefined;
}
