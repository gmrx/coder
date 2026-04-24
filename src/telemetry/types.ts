import type { AgentApprovalRequest, AgentApprovalResult } from '../agent/runtime/approvals';
import type { ConversationSource } from '../ui/conversations';
import type { ExtensionToWebviewMessage } from '../ui/protocol/messages';
import type { PersistedTraceRun } from '../ui/protocol/trace';

export interface TelemetryConversationContext {
  conversationId: string;
  source: ConversationSource;
  userApiKey: string;
}

export interface TelemetryEvent {
  event_time: string;
  install_id?: string;
  user_api_key: string;
  conversation_id: string;
  run_id: string;
  source_type: string;
  source_project_key: string;
  source_task_key: string;
  event_family: string;
  event_name: string;
  status: string;
  model: string;
  tool_name: string;
  approval_kind: string;
  file_ext: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  added_lines: number;
  removed_lines: number;
  pending_files: number;
  pending_changes: number;
  agent_lines: number;
  agent_modified_by_user_lines: number;
  agent_removed_lines: number;
  agent_deleted_by_user_lines: number;
  user_only_lines: number;
  user_removed_lines: number;
  unknown_files: number;
  rewound_requests: number;
  restored_files: number;
  error_count: number;
  approved: number;
  cancelled: number;
  auto_approved: number;
  destructive: number;
  attrs_json: string;
}

export interface TelemetryTraceInput {
  runId: string;
  phase: string;
  text: string;
  data: Record<string, any>;
}

export type ChatRunTelemetrySignal =
  | { kind: 'run-started'; runId: string; model: string }
  | { kind: 'run-finished'; runId: string; state: PersistedTraceRun['state']; summary: string; model: string }
  | { kind: 'trace'; trace: TelemetryTraceInput }
  | { kind: 'auto-approval'; runId: string; request: AgentApprovalRequest; result: AgentApprovalResult };

export interface MetricsOutboxBatchInfo {
  fileName: string;
  filePath: string;
  size: number;
  createdAt: number;
}

export interface ClickHouseMetricsConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  table: string;
  requestTimeoutMs: number;
  flushIntervalMs: number;
  retryIntervalMs: number;
  batchSize: number;
  outboxMaxFiles: number;
  outboxMaxBytes: number;
}

export interface ClickHouseMetricsLogger {
  warn(message: string, error?: unknown): void;
}

export interface ClickHouseMetricsServiceOptions {
  installId: string;
  storagePath: string;
  config: ClickHouseMetricsConfig;
  fetchImpl?: typeof fetch;
  logger?: ClickHouseMetricsLogger;
}

export type TelemetryMessageInput = ExtensionToWebviewMessage;
