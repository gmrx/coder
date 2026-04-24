import * as path from 'path';
import type {
  ChatRunTelemetrySignal,
  TelemetryConversationContext,
  TelemetryEvent,
  TelemetryMessageInput,
  TelemetryTraceInput,
} from './types';

export function buildChatRunTelemetryEvents(
  context: TelemetryConversationContext,
  signal: ChatRunTelemetrySignal,
  nowMs = Date.now(),
): TelemetryEvent[] {
  if (signal.kind === 'run-started') {
    const event = createBaseEvent(context, 'run', 'started', nowMs);
    event.run_id = trimValue(signal.runId, 80);
    event.status = 'started';
    event.model = trimValue(signal.model, 160);
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      run_state: 'started',
    }));
    return [event];
  }

  if (signal.kind === 'run-finished') {
    const event = createBaseEvent(context, 'run', 'finished', nowMs);
    event.run_id = trimValue(signal.runId, 80);
    event.status = normalizeStatus(signal.state);
    event.model = trimValue(signal.model, 160);
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      run_state: normalizeStatus(signal.state),
      summary: trimValue(signal.summary, 160),
    }));
    return [event];
  }

  if (signal.kind === 'trace') {
    return buildTraceTelemetryEvents(context, signal.trace, nowMs);
  }

  return [
    buildApprovalRequestEvent(context, signal.request, signal.runId, nowMs, true),
    buildApprovalResolvedEvent(context, signal.result, signal.request, signal.runId, nowMs, true),
  ];
}

export function buildExtensionMessageTelemetryEvents(
  context: TelemetryConversationContext,
  message: TelemetryMessageInput,
  runId = '',
  nowMs = Date.now(),
): TelemetryEvent[] {
  if (message.type === 'assistant') {
    const event = createBaseEvent(context, 'message', 'assistant_response', nowMs);
    event.run_id = trimValue(runId, 80);
    event.status = 'sent';
    return [event];
  }

  if (message.type === 'fileChange') {
    const event = createBaseEvent(context, 'file', 'change', nowMs);
    event.run_id = trimValue(runId, 80);
    event.tool_name = trimValue(message.tool, 120);
    event.file_ext = getFileExt(message.filePath);
    event.added_lines = clampUInt(message.stats?.added);
    event.removed_lines = clampUInt(message.stats?.removed);
    event.destructive = isDestructiveFileChange(message.changeType) ? 1 : 0;
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      change_id: trimValue(message.changeId, 120),
      step: message.step !== undefined ? trimValue(String(message.step), 80) : '',
      change_type: trimValue(message.changeType, 80),
      before_lines: clampUInt(message.stats?.beforeLines),
      after_lines: clampUInt(message.stats?.afterLines),
      cell_idx: Number.isFinite(message.cellIdx) ? Math.max(0, Number(message.cellIdx)) : undefined,
    }));
    return [event];
  }

  if (message.type === 'changeMetrics') {
    const event = createBaseEvent(context, 'change', 'snapshot', nowMs);
    event.run_id = trimValue(runId, 80);
    event.status = Number(message.metrics?.pendingChanges || 0) > 0 || Number(message.metrics?.pendingFiles || 0) > 0
      ? 'active'
      : 'clean';
    event.pending_files = clampUInt(message.metrics?.pendingFiles);
    event.pending_changes = clampUInt(message.metrics?.pendingChanges);
    event.agent_lines = clampUInt(message.metrics?.agentLines);
    event.agent_modified_by_user_lines = clampUInt(message.metrics?.agentModifiedByUserLines);
    event.agent_removed_lines = clampUInt(message.metrics?.agentRemovedLines);
    event.agent_deleted_by_user_lines = clampUInt(message.metrics?.agentDeletedByUserLines);
    event.user_only_lines = clampUInt(message.metrics?.userOnlyLines);
    event.user_removed_lines = clampUInt(message.metrics?.userRemovedLines);
    event.unknown_files = clampUInt(message.metrics?.unknownFiles);
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source));
    return [event];
  }

  if (message.type === 'approvalRequest') {
    return [buildApprovalRequestEvent(context, message.request, runId, nowMs, false)];
  }

  if (message.type === 'approvalResolved') {
    return [buildApprovalResolvedEvent(context, message.result, undefined, runId, nowMs, false)];
  }

  if (message.type === 'questionRequest') {
    const event = createBaseEvent(context, 'question', 'request', nowMs);
    event.run_id = trimValue(runId, 80);
    event.status = 'requested';
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      confirm_id: trimValue(message.request.confirmId, 120),
      step: message.request.step !== undefined ? trimValue(String(message.request.step), 80) : '',
      question_count: Array.isArray(message.request.questions) ? message.request.questions.length : 0,
      multi_select_count: Array.isArray(message.request.questions)
        ? message.request.questions.filter((item) => item?.multiSelect).length
        : 0,
      tool_name: trimValue(message.request.toolName, 120),
    }));
    return [event];
  }

  if (message.type === 'questionResolved') {
    const event = createBaseEvent(context, 'question', 'resolved', nowMs);
    event.run_id = trimValue(runId, 80);
    event.status = message.result.cancelled
      ? 'cancelled'
      : message.result.answered
        ? 'answered'
        : 'unanswered';
    event.cancelled = message.result.cancelled ? 1 : 0;
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      confirm_id: trimValue(message.result.confirmId, 120),
      answered: !!message.result.answered,
      answer_count: Object.keys(message.result.answers || {}).length,
      reason: trimValue(message.result.reason, 120),
    }));
    return [event];
  }

  if (message.type === 'checkpoint') {
    const event = createBaseEvent(context, 'checkpoint', 'created', nowMs);
    event.run_id = trimValue(runId, 80);
    event.status = normalizeStatus(message.status);
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      checkpoint_id: trimValue(message.id, 120),
      checkpoint_index: clampUInt(message.index),
      user_message_index: clampUInt(message.userMessageIndex),
      changed_files: clampUInt(message.changedFiles),
    }));
    return [event];
  }

  if (message.type === 'checkpointUpdated') {
    const event = createBaseEvent(context, 'checkpoint', 'updated', nowMs);
    event.run_id = trimValue(runId, 80);
    event.status = normalizeStatus(message.status);
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      checkpoint_id: trimValue(message.id, 120),
      checkpoint_index: clampUInt(message.index),
      user_message_index: clampUInt(message.userMessageIndex),
      changed_files: clampUInt(message.changedFiles),
    }));
    return [event];
  }

  if (message.type === 'checkpointReverted') {
    const event = createBaseEvent(context, 'checkpoint', 'reverted', nowMs);
    event.run_id = trimValue(runId, 80);
    event.status = 'reverted';
    event.rewound_requests = clampUInt(message.rewoundRequests);
    event.restored_files = clampUInt(message.restoredFiles);
    event.error_count = Array.isArray(message.errors) ? clampUInt(message.errors.length) : 0;
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      checkpoint_id: trimValue(message.checkpointId, 120),
      checkpoint_index: clampUInt(message.index),
      rewound_checkpoint_count: Array.isArray(message.rewoundCheckpointIds) ? message.rewoundCheckpointIds.length : 0,
      restored_pending_count: Array.isArray(message.restoredPendingIds) ? message.restoredPendingIds.length : 0,
    }));
    return [event];
  }

  if (message.type === 'undoRevertDone') {
    const event = createBaseEvent(context, 'checkpoint', 'undo_revert', nowMs);
    event.run_id = trimValue(runId, 80);
    event.status = 'restored';
    event.error_count = Array.isArray(message.errors) ? clampUInt(message.errors.length) : 0;
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      checkpoint_id: trimValue(message.checkpointId, 120),
      restored_pending_count: Array.isArray(message.restoredPendingIds) ? message.restoredPendingIds.length : 0,
    }));
    return [event];
  }

  if (message.type === 'checkpointBranchCommitted') {
    const event = createBaseEvent(context, 'checkpoint', 'branch_committed', nowMs);
    event.run_id = trimValue(runId, 80);
    event.status = 'committed';
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      checkpoint_id: trimValue(message.checkpointId, 120),
      pruned_checkpoint_count: Array.isArray(message.prunedCheckpointIds) ? message.prunedCheckpointIds.length : 0,
    }));
    return [event];
  }

  return [];
}

export function buildUserMessageTelemetryEvent(
  context: TelemetryConversationContext,
  nowMs = Date.now(),
): TelemetryEvent {
  return createBaseEvent(context, 'message', 'user_request', nowMs);
}

export function buildTraceTelemetryEvents(
  context: TelemetryConversationContext,
  trace: TelemetryTraceInput,
  nowMs = Date.now(),
): TelemetryEvent[] {
  if (trace.phase === 'agent-model-usage') {
    const event = createBaseEvent(context, 'model', 'usage', nowMs);
    event.run_id = trimValue(trace.runId, 80);
    event.model = trimValue(trace.data?.model, 160);
    event.status = 'recorded';
    event.prompt_tokens = clampUInt(trace.data?.promptTokens ?? trace.data?.lastPromptTokens);
    event.completion_tokens = clampUInt(trace.data?.completionTokens ?? trace.data?.lastCompletionTokens);
    event.total_tokens = clampUInt(
      trace.data?.totalTokens
        ?? trace.data?.lastTotalTokens
        ?? (event.prompt_tokens + event.completion_tokens),
    );
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      trace_phase: trace.phase,
      estimated_input_tokens: clampUInt(trace.data?.estimatedInputTokens),
    }));
    return [event];
  }

  if (trace.phase === 'agent-tool' || trace.phase === 'tool-batch-child-start') {
    if (trace.data?.countsAsTool === false || !trace.data?.tool) return [];
    const event = createBaseEvent(context, 'tool', 'started', nowMs);
    event.run_id = trimValue(trace.runId, 80);
    event.status = 'started';
    event.tool_name = trimValue(trace.data.tool, 120);
    event.destructive = trace.data?.destructive ? 1 : 0;
    event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      trace_phase: trace.phase,
      step: trace.data?.step !== undefined ? trimValue(String(trace.data.step), 80) : '',
      parent_tool: trimValue(trace.data?.parentTool, 80),
      batch_index: clampUInt(trace.data?.index),
      batch_total: clampUInt(trace.data?.total),
    }));
    return [event];
  }

  if (trace.phase === 'agent-result' || trace.phase === 'tool-batch-child-result') {
    if (trace.data?.countsAsTool === false || !trace.data?.tool) return [];
    const finished = createBaseEvent(context, 'tool', 'finished', nowMs);
    finished.run_id = trimValue(trace.runId, 80);
    finished.status = normalizeStatus(trace.data?.status || 'success');
    finished.tool_name = trimValue(trace.data.tool, 120);
    finished.destructive = trace.data?.destructive ? 1 : 0;
    finished.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
      trace_phase: trace.phase,
      step: trace.data?.step !== undefined ? trimValue(String(trace.data.step), 80) : '',
      parent_tool: trimValue(trace.data?.parentTool, 80),
      batch_index: clampUInt(trace.data?.index),
      batch_total: clampUInt(trace.data?.total),
      result_phase: trimValue(trace.data?.phase, 80),
    }));
    if (!trace.data?.error && finished.status !== 'error' && finished.status !== 'blocked') {
      return [finished];
    }

    const error = {
      ...finished,
      event_name: 'error',
      error_count: 1,
    };
    return [finished, error];
  }

  return [];
}

function buildApprovalRequestEvent(
  context: TelemetryConversationContext,
  request: any,
  runId: string,
  nowMs: number,
  autoApproved: boolean,
): TelemetryEvent {
  const event = createBaseEvent(context, 'approval', 'request', nowMs);
  event.run_id = trimValue(runId, 80);
  event.status = 'requested';
  event.approval_kind = trimValue(request?.kind, 60);
  event.tool_name = trimValue(request?.toolName || request?.mcpToolName, 120);
  event.auto_approved = autoApproved ? 1 : 0;
  event.destructive = isApprovalRequestDestructive(request) ? 1 : 0;
  event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
    confirm_id: trimValue(request?.confirmId, 120),
    step: request?.step !== undefined ? trimValue(String(request.step), 80) : '',
    action: trimValue(request?.action, 60),
    change_type: trimValue(request?.changeType, 60),
    mcp_server: trimValue(request?.server, 120),
    mcp_tool_name: trimValue(request?.mcpToolName, 120),
    command_kind: trimValue(request?.commandKind, 80),
    trust_kind: trimValue(request?.trustKind, 80),
  }));
  return event;
}

function buildApprovalResolvedEvent(
  context: TelemetryConversationContext,
  result: any,
  request: any,
  runId: string,
  nowMs: number,
  autoApproved: boolean,
): TelemetryEvent {
  const event = createBaseEvent(context, 'approval', 'resolved', nowMs);
  event.run_id = trimValue(runId, 80);
  event.status = result?.cancelled
    ? 'cancelled'
    : result?.approved
      ? 'approved'
      : 'rejected';
  event.approval_kind = trimValue(result?.kind || request?.kind, 60);
  event.tool_name = trimValue(request?.toolName || request?.mcpToolName, 120);
  event.approved = result?.approved ? 1 : 0;
  event.cancelled = result?.cancelled ? 1 : 0;
  event.auto_approved = autoApproved || result?.reason === 'auto_approved' ? 1 : 0;
  event.destructive = isApprovalRequestDestructive(request) ? 1 : 0;
  event.attrs_json = buildAttrsJson(buildSourceAttrs(context.source, {
    confirm_id: trimValue(result?.confirmId || request?.confirmId, 120),
    reason: trimValue(result?.reason, 120),
    remember_tool: !!result?.rememberTool,
    remember_host: !!result?.rememberHost,
  }));
  return event;
}

function createBaseEvent(
  context: TelemetryConversationContext,
  family: string,
  name: string,
  nowMs: number,
): TelemetryEvent {
  return {
    event_time: formatClickHouseDateTime(nowMs),
    user_api_key: trimValue(context.userApiKey, 400),
    conversation_id: trimValue(context.conversationId, 120),
    run_id: '',
    source_type: getSourceType(context.source),
    source_project_key: getSourceProjectKey(context.source),
    source_task_key: getSourceTaskKey(context.source),
    event_family: trimValue(family, 60),
    event_name: trimValue(name, 80),
    status: '',
    model: '',
    tool_name: '',
    approval_kind: '',
    file_ext: '',
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    added_lines: 0,
    removed_lines: 0,
    pending_files: 0,
    pending_changes: 0,
    agent_lines: 0,
    agent_modified_by_user_lines: 0,
    agent_removed_lines: 0,
    agent_deleted_by_user_lines: 0,
    user_only_lines: 0,
    user_removed_lines: 0,
    unknown_files: 0,
    rewound_requests: 0,
    restored_files: 0,
    error_count: 0,
    approved: 0,
    cancelled: 0,
    auto_approved: 0,
    destructive: 0,
    attrs_json: buildAttrsJson(buildSourceAttrs(context.source)),
  };
}

function formatClickHouseDateTime(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hours = pad2(date.getUTCHours());
  const minutes = pad2(date.getUTCMinutes());
  const seconds = pad2(date.getUTCSeconds());
  const millis = pad3(date.getUTCMilliseconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

function buildSourceAttrs(source: TelemetryConversationContext['source'], extra: Record<string, any> = {}): Record<string, any> {
  const attrs: Record<string, any> = {
    conversation_source: getSourceType(source),
    ...extra,
  };
  if (source.type === 'jira') {
    attrs.jira_issue_key = trimValue(source.issueKey, 120);
  }
  if (source.type === 'tfs') {
    attrs.tfs_work_item_id = trimValue(source.workItemId, 120);
  }
  return attrs;
}

function getSourceType(source: TelemetryConversationContext['source']): string {
  return source.type === 'jira' || source.type === 'tfs' ? source.type : 'free';
}

function getSourceProjectKey(source: TelemetryConversationContext['source']): string {
  if (source.type === 'jira' || source.type === 'tfs') {
    return trimValue(source.projectKey, 120);
  }
  return '';
}

function getSourceTaskKey(source: TelemetryConversationContext['source']): string {
  if (source.type === 'jira') {
    return trimValue(source.issueKey, 120);
  }
  if (source.type === 'tfs') {
    return trimValue(source.workItemId, 120);
  }
  return '';
}

function buildAttrsJson(attrs: Record<string, any> = {}): string {
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(attrs).sort()) {
    const value = sanitizeAttrValue(attrs[key]);
    if (value === undefined || value === '' || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    sanitized[key] = value;
  }
  return JSON.stringify(sanitized);
}

function sanitizeAttrValue(value: any): any {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
  }
  if (typeof value === 'string') {
    const text = trimValue(value, 160);
    return text || undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeAttrValue(item))
      .filter((item) => item !== undefined);
  }
  return undefined;
}

function normalizeStatus(value: unknown): string {
  return trimValue(String(value || '').toLowerCase(), 40);
}

function trimValue(value: unknown, maxLength: number): string {
  return String(value || '').trim().slice(0, maxLength);
}

function clampUInt(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0, Math.min(0xffffffff, Math.floor(numeric)));
}

function isDestructiveFileChange(changeType: unknown): boolean {
  const normalized = trimValue(changeType, 40).toLowerCase();
  return normalized === 'delete' || normalized === 'overwrite';
}

function isApprovalRequestDestructive(request: any): boolean {
  if (!request || typeof request !== 'object') return false;
  if (request.destructive === true) return true;
  if (request.kind === 'file') {
    return isDestructiveFileChange(request.changeType);
  }
  return false;
}

function getFileExt(filePath: unknown): string {
  const ext = path.extname(String(filePath || '').trim()).toLowerCase();
  return ext.slice(0, 32);
}
