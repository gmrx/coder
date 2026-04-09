import type { AssistantAutoApprovalConfig, ChatMessage } from '../../core/types';
import type { AgentApprovalResult } from '../../agent/runtime/approvals';
import type {
  AgentPendingApprovalSnapshot,
  AgentPendingQuestionSnapshot,
  AgentProgressSnapshot,
  AgentSessionMemorySnapshot,
  AgentTodoItem,
} from '../../agent/runtime/types';
import type { AgentQuestionResult } from '../../agent/runtime/questions';
import type { DiffLine } from '../diff';
import type { FollowupState, FollowupSuggestion } from '../followups';
import type { SettingsRequestPayload } from './settings';
import type { ConversationSessionsMessage, ConversationStateMessage } from './conversations';
import type { ApprovalRequestMessage, ApprovalResolvedMessage } from './approvals';
import type { QuestionRequestMessage, QuestionResolvedMessage } from './questions';
import type {
  CheckpointBranchCommittedMessage,
  CheckpointMessage,
  CheckpointsListMessage,
  CheckpointRevertedMessage,
  CheckpointUpdatedMessage,
  UndoRevertDoneMessage,
} from './checkpoints';
import type { ConnectionResultMessage, McpInspectionResultMessage, ModelTestsResultMessage, SettingsDataMessage, SettingsSavedMessage } from './settings';
import type { TasksStateMessage } from './tasks';
import type { TraceEventMessage, TraceResetMessage } from './trace';

export interface AssistantMessage {
  type: 'assistant';
  text: string;
}

export interface ErrorMessage {
  type: 'error';
  text: string;
}

export interface StatusMessage {
  type: 'status';
  text: string;
}

export interface AgentDoneMessage {
  type: 'agentDone';
}

export interface RuntimeStateMessage {
  type: 'runtimeState';
  mode: 'normal' | 'plan';
  awaitingPlanApproval: boolean;
  pendingApproval: AgentPendingApprovalSnapshot | null;
  pendingQuestion: AgentPendingQuestionSnapshot | null;
  todos: AgentTodoItem[];
  progress: AgentProgressSnapshot;
  sessionMemory: AgentSessionMemorySnapshot;
  autoApproval: AssistantAutoApprovalConfig;
}

export interface ComposerPermissionsStateMessage {
  type: 'composerPermissionsState';
  autoApproval: AssistantAutoApprovalConfig;
}

export interface ChangeStatusMessage {
  type: 'changeAccepted' | 'changeRejected';
  changeId: string;
  error?: string;
}

export interface FileChangeMessagePayload {
  changeId: string;
  step?: string;
  filePath: string;
  changeType: string;
  tool: string;
  summary?: string;
  stats?: {
    added: number;
    removed: number;
    beforeLines: number;
    afterLines: number;
  };
  oldSnippet: string;
  newSnippet: string;
  cellIdx: number | undefined;
  diffLines: DiffLine[];
}

export interface FileChangeMessage extends FileChangeMessagePayload {
  type: 'fileChange';
}

export interface UpdateSuggestionsMessage {
  type: 'updateSuggestions';
  suggestions: FollowupSuggestion[];
  state: FollowupState;
  summary: string;
}

export interface SuggestionsStateMessage {
  type: 'suggestionsState';
  state: FollowupState;
  summary: string;
}

export type ExtensionToWebviewMessage =
  | AssistantMessage
  | ErrorMessage
  | StatusMessage
  | AgentDoneMessage
  | ApprovalRequestMessage
  | ApprovalResolvedMessage
  | QuestionRequestMessage
  | QuestionResolvedMessage
  | RuntimeStateMessage
  | ComposerPermissionsStateMessage
  | ChangeStatusMessage
  | FileChangeMessage
  | ConversationStateMessage
  | ConversationSessionsMessage
  | UpdateSuggestionsMessage
  | SuggestionsStateMessage
  | SettingsDataMessage
  | SettingsSavedMessage
  | ConnectionResultMessage
  | ModelTestsResultMessage
  | McpInspectionResultMessage
  | TasksStateMessage
  | TraceResetMessage
  | TraceEventMessage
  | CheckpointMessage
  | CheckpointUpdatedMessage
  | CheckpointsListMessage
  | CheckpointRevertedMessage
  | UndoRevertDoneMessage
  | CheckpointBranchCommittedMessage;

export type WebviewMessageSink = (message: ExtensionToWebviewMessage) => void;

export type WebviewToExtensionMessage =
  | { type: 'send'; text: string }
  | { type: 'stop' }
  | { type: 'openSettingsPanel' }
  | { type: 'closeSettingsPanel' }
  | { type: 'getSettings' }
  | { type: 'getConversationState' }
  | { type: 'saveComposerPermissions'; autoApproval: AssistantAutoApprovalConfig }
  | { type: 'getConversationSessions' }
  | { type: 'getTasksState' }
  | { type: 'createConversation' }
  | { type: 'switchConversation'; conversationId: string }
  | { type: 'deleteConversation'; conversationId: string }
  | { type: 'clearConversation' }
  | { type: 'saveSettings'; data?: SettingsRequestPayload }
  | { type: 'testConnection'; data?: SettingsRequestPayload }
  | { type: 'testModels'; data?: SettingsRequestPayload }
  | { type: 'inspectMcp'; data?: SettingsRequestPayload }
  | { type: 'refreshSuggestions' }
  | { type: 'acceptChange'; changeId: string }
  | { type: 'rejectChange'; changeId: string }
  | { type: 'acceptAll' }
  | { type: 'rejectAll' }
  | { type: 'openChangedFile'; filePath: string }
  | { type: 'showDiff'; changeId: string }
  | { type: 'openTaskFile'; filePath: string }
  | { type: 'openSessionMemory'; filePath: string }
  | { type: 'stopTask'; taskId: string; force?: boolean }
  | { type: 'revertToCheckpoint'; checkpointId: string }
  | { type: 'undoRevert' }
  | { type: 'getCheckpoints' }
  | { type: 'approvalResult'; result: AgentApprovalResult }
  | { type: 'questionResult'; result: AgentQuestionResult }
  | { type: 'fileConfirmResult'; confirmId: string; approved?: boolean }
  | { type: 'shellConfirmResult'; confirmId: string; approved?: boolean; command?: string }
  | { type: 'planConfirmResult'; confirmId: string; approved?: boolean; plan?: string; feedback?: string };
