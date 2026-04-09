import type {
  AgentPendingApprovalSnapshot,
  AgentPendingQuestionSnapshot,
  AgentProgressSnapshot,
  AgentRuntimeMode,
  AgentSessionMemorySnapshot,
  AgentTodoItem,
} from '../../agent/runtime/types';
import type { AssistantAutoApprovalConfig, ChatMessage } from '../../core/types';
import type { FollowupState, FollowupSuggestion } from '../followups';
import type { ConversationSummaryDto } from '../conversations';
import type { PersistedChatArtifact } from './artifacts';
import type { PersistedTraceRun } from './trace';

export interface ConversationStateMessage {
  type: 'conversationState';
  sessionId: string;
  title: string;
  replace?: boolean;
  messages: Array<Pick<ChatMessage, 'role' | 'content'>>;
  suggestions: FollowupSuggestion[];
  suggestionsState: FollowupState;
  suggestionsSummary: string;
  traceRuns: PersistedTraceRun[];
  artifactEvents: PersistedChatArtifact[];
  agentMode: AgentRuntimeMode;
  awaitingPlanApproval: boolean;
  pendingApproval: AgentPendingApprovalSnapshot | null;
  pendingQuestion: AgentPendingQuestionSnapshot | null;
  todos: AgentTodoItem[];
  progress: AgentProgressSnapshot;
  sessionMemory: AgentSessionMemorySnapshot;
  autoApproval: AssistantAutoApprovalConfig;
  pendingChangeIds?: string[];
}

export interface ConversationSessionsMessage {
  type: 'conversationSessions';
  activeId: string;
  sessions: ConversationSummaryDto[];
}
