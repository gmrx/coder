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
import type { ConversationSource, ConversationSummaryDto } from '../conversations';
import type { PersistedChatArtifact } from './artifacts';
import type { PersistedTraceRun } from './trace';

export interface ConversationStateMessage {
  type: 'conversationState';
  sessionId: string;
  title: string;
  source: ConversationSource;
  jiraContext?: JiraTaskContextViewState | null;
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

export interface JiraTaskContextViewState {
  issueKey: string;
  title: string;
  project: string;
  status: string;
  url: string;
  description: string;
  updatedAt: number;
  loading: boolean;
  error: string;
  meta: string[];
  sections: JiraTaskContextSectionView[];
  repositoriesChecked: number;
  commits: JiraTaskCommitView[];
}

export interface JiraTaskContextSectionView {
  title: string;
  items: string[];
}

export interface JiraTaskCommitView {
  repository: string;
  currentBranch: string;
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  subject: string;
  branches: string[];
  suggestion: string;
}

export interface ConversationSessionsMessage {
  type: 'conversationSessions';
  activeId: string;
  sessions: ConversationSummaryDto[];
  mode: 'free' | 'jira';
  jira: JiraConversationScopeState;
}

export interface JiraConversationScopeState {
  selectedProjectKey: string;
  selectedProjectName: string;
  authOk: boolean;
  authUser: string;
  error: string;
  projectsLoading: boolean;
  tasksLoading: boolean;
  tasksError: string;
  projects: JiraConversationProjectOption[];
}

export interface JiraConversationProjectOption {
  key: string;
  name: string;
  url: string;
}
