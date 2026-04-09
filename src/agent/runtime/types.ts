import type { AssistantConfig, ChatMessage } from '../../core/types';
import type { RetryNotice } from '../../core/modelClient';
export type { AgentPlanApprovalDecision } from './approvals';
import type { AgentApprovalKind } from './approvals';
import type { AgentWorktreeSession } from '../worktreeSession';

export type AgentStepCallback = (
  phase: string,
  message: string,
  meta?: any,
) => void | Promise<any>;

export type AgentRequestOptions = {
  temperature: number;
  maxTokens?: number;
  step: number;
  retryPrefix: string;
  retryUntilSuccess?: boolean;
};

export type ActiveFileContext = {
  path: string;
  language: string;
  content: string;
} | null;

export type AgentTurnInput = {
  question: string;
  activeFile: ActiveFileContext;
};

export type AgentTurnPreparationInput = AgentTurnInput & {
  chatHistory: ChatMessage[];
  systemPrompt?: string;
  sessionMemory?: {
    title: string;
    currentState: string;
    summary: string;
  } | null;
};

export type PreparedAgentTurn = {
  lastQuestion: string;
  messages: ChatMessage[];
  carryoverContext: string;
  freshMcpRequired: boolean;
  isFirstMessage: boolean;
  mutationQuery: boolean;
  needMermaid: boolean;
  retrievalAutoContext: boolean;
};

export type AgentRuntimeConfig = Readonly<Pick<
  AssistantConfig,
  'apiBaseUrl' | 'apiKey' | 'model' | 'embeddingsModel' | 'rerankModel'
>>;

export type AgentChatRequest = (
  messages: ChatMessage[],
  options: AgentRequestOptions,
  onRetry?: (notice: RetryNotice) => void,
) => Promise<string>;

export type AgentRuntimeContext = {
  config: AgentRuntimeConfig;
  requestChat: AgentChatRequest;
};

export type AgentRuntimeMode = 'normal' | 'plan';
export type AgentProgressState = 'idle' | 'running' | 'waiting' | 'done' | 'error' | 'stopped';

export type AgentContextWindowSnapshot = {
  messageCount: number;
  messageChars: number;
  maxContextChars: number;
  estimatedInputTokens: number;
  lastPromptTokens: number;
  lastCompletionTokens: number;
  lastTotalTokens: number;
  model: string;
  updatedAt: number;
};

export type AgentProgressSnapshot = {
  state: AgentProgressState;
  summary: string;
  detail: string;
  activitySummary: string;
  activityUpdatedAt: number;
  backgroundSummary: string;
  backgroundUpdatedAt: number;
  connectionState: 'idle' | 'reconnecting';
  connectionSummary: string;
  connectionDetail: string;
  connectionRetryAttempt: number;
  connectionDelayMs: number;
  connectionUpdatedAt: number;
  updatedAt: number;
  lastCompletedSummary: string;
  lastCompletedDetail: string;
  lastCompletedAt: number;
  context: AgentContextWindowSnapshot;
};

export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed';

export type AgentTodoItem = {
  id: string;
  content: string;
  activeForm: string;
  status: AgentTodoStatus;
};

export type AgentToolSearchRecommendation = {
  toolName: string;
  nextStep?: string;
};

export type AgentPendingApprovalSnapshot = {
  kind: AgentApprovalKind;
  confirmId: string;
  title: string;
  summary: string;
  detail: string;
  toolName?: string;
};

export type AgentPendingQuestionSnapshot = {
  confirmId: string;
  title: string;
  summary: string;
  detail: string;
  toolName?: string;
};

export type AgentSessionMemorySnapshot = {
  scopeId: string;
  summary: string;
  title: string;
  currentState: string;
  memoryPath: string;
  lastUpdatedAt: number;
  lastSummarizedMessageCount: number;
  lastSummarizedChars: number;
  failedUpdates: number;
};

export type AgentCompactionSnapshot = {
  compactCount: number;
  consecutiveFailures: number;
  lastCompactedMessageCount: number;
};

export type AgentRuntimeSnapshot = {
  mode: AgentRuntimeMode;
  awaitingPlanApproval: boolean;
  pendingApproval: AgentPendingApprovalSnapshot | null;
  pendingQuestion: AgentPendingQuestionSnapshot | null;
  worktreeSession: AgentWorktreeSession | null;
  todos: AgentTodoItem[];
  progress: AgentProgressSnapshot;
  sessionMemory: AgentSessionMemorySnapshot;
  compaction: AgentCompactionSnapshot;
};

export type AgentRuntimeChangeKind = 'runtime' | 'progress';

export type AgentSessionControl = {
  getMode: () => AgentRuntimeMode;
  setMode: (mode: AgentRuntimeMode) => void;
  getAwaitingPlanApproval: () => boolean;
  setAwaitingPlanApproval: (value: boolean) => void;
  getWorktreeSession: () => AgentWorktreeSession | null;
  setWorktreeSession: (session: AgentWorktreeSession | null) => void;
  getTodos: () => AgentTodoItem[];
  setTodos: (todos: AgentTodoItem[]) => void;
  notifyRuntimeChanged?: (kind?: AgentRuntimeChangeKind) => void;
};

export type AgentQueryEngineInitParams = {
  initialMessages?: ChatMessage[];
};

export type AgentTurnExecutionParams = {
  onStep?: AgentStepCallback;
  signal?: AbortSignal;
};

export type AgentSessionInitParams = AgentTurnExecutionParams & {
  control: AgentSessionControl;
  prepared: PreparedAgentTurn;
  runtime: AgentRuntimeContext;
};
