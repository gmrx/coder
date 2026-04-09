import * as vscode from 'vscode';
import type { ChatMessage } from '../core/types';
import type { AgentRuntimeSnapshot } from '../agent/runtime/types';
import type { FollowupState, FollowupSuggestion } from './followups';
import type { PersistedTraceRun, TraceEventPayload } from './protocol/trace';
import type { PersistedChatArtifact } from './protocol/artifacts';

const STORAGE_KEY = 'aiAssistant.conversations.v1';
const MAX_CONVERSATIONS = 24;
const MAX_MESSAGES_PER_CONVERSATION = 120;

export interface StoredConversationSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  agentRuntime: AgentRuntimeSnapshot | null;
  suggestions: FollowupSuggestion[];
  suggestionsState: FollowupState;
  suggestionsSummary: string;
  traceRuns: PersistedTraceRun[];
  artifactEvents: PersistedChatArtifact[];
}

export interface ConversationSummaryDto {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  preview: string;
}

interface PersistedConversationState {
  activeId: string;
  conversations: StoredConversationSession[];
}

export interface ConversationSnapshot {
  messages: ChatMessage[];
  agentRuntime?: AgentRuntimeSnapshot | null;
  suggestions: FollowupSuggestion[];
  suggestionsState: FollowupState;
  suggestionsSummary: string;
  traceRuns: PersistedTraceRun[];
  artifactEvents: PersistedChatArtifact[];
}

export class ConversationStore {
  private state: PersistedConversationState;

  constructor(private readonly storage: vscode.Memento) {
    this.state = this.load();
  }

  getActiveConversation(): StoredConversationSession {
    const active = this.state.conversations.find((item) => item.id === this.state.activeId);
    if (active) return cloneConversation(active);

    const created = createEmptyConversation();
    this.state = {
      activeId: created.id,
      conversations: [created],
    };
    void this.persist();
    return cloneConversation(created);
  }

  listSummaries(): ConversationSummaryDto[] {
    return this.state.conversations
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        preview: buildPreview(conversation.messages),
      }));
  }

  getActiveId(): string {
    return this.state.activeId;
  }

  async updateActiveConversation(snapshot: ConversationSnapshot): Promise<StoredConversationSession> {
    const active = this.ensureActiveConversation();
    active.messages = normalizeMessages(snapshot.messages);
    active.agentRuntime = normalizeRuntimeSnapshot(snapshot.agentRuntime);
    active.suggestions = normalizeSuggestions(snapshot.suggestions);
    active.suggestionsState = snapshot.suggestionsState || 'starters';
    active.suggestionsSummary = snapshot.suggestionsSummary || defaultSuggestionsSummary(active.messages.length > 0);
    active.traceRuns = normalizeTraceRuns(snapshot.traceRuns);
    active.artifactEvents = normalizeArtifactEvents(snapshot.artifactEvents);
    active.updatedAt = Date.now();
    active.title = buildTitle(active.messages);
    this.trim();
    await this.persist();
    return cloneConversation(active);
  }

  async updateConversationRuntime(id: string, runtime: AgentRuntimeSnapshot | null | undefined): Promise<void> {
    const conversation = this.state.conversations.find((item) => item.id === id);
    if (!conversation) return;
    conversation.agentRuntime = normalizeRuntimeSnapshot(runtime);
    conversation.updatedAt = Date.now();
    this.trim();
    await this.persist();
  }

  async createConversation(): Promise<StoredConversationSession> {
    const created = createEmptyConversation();
    this.state.activeId = created.id;
    this.state.conversations.unshift(created);
    this.trim();
    await this.persist();
    return cloneConversation(created);
  }

  async switchConversation(id: string): Promise<StoredConversationSession | null> {
    const next = this.state.conversations.find((item) => item.id === id);
    if (!next) return null;
    this.state.activeId = next.id;
    next.updatedAt = Date.now();
    this.trim();
    await this.persist();
    return cloneConversation(next);
  }

  async clearActiveConversation(): Promise<StoredConversationSession> {
    const active = this.ensureActiveConversation();
    active.messages = [];
    active.agentRuntime = null;
    active.suggestions = [];
    active.suggestionsState = 'starters';
    active.suggestionsSummary = defaultSuggestionsSummary(false);
    active.traceRuns = [];
    active.artifactEvents = [];
    active.title = 'Новый чат';
    active.updatedAt = Date.now();
    await this.persist();
    return cloneConversation(active);
  }

  async deleteConversation(id: string): Promise<StoredConversationSession | null> {
    const target = this.state.conversations.find((item) => item.id === id);
    if (!target) return null;

    this.state.conversations = this.state.conversations.filter((item) => item.id !== id);

    if (this.state.conversations.length === 0) {
      const created = createEmptyConversation();
      this.state.conversations = [created];
      this.state.activeId = created.id;
      await this.persist();
      return cloneConversation(created);
    }

    if (this.state.activeId === id) {
      this.state.conversations.sort((left, right) => right.updatedAt - left.updatedAt);
      this.state.activeId = this.state.conversations[0].id;
    }

    this.trim();
    await this.persist();
    return this.getActiveConversation();
  }

  private load(): PersistedConversationState {
    const raw = this.storage.get<PersistedConversationState | undefined>(STORAGE_KEY);
    const conversations = Array.isArray(raw?.conversations)
      ? raw!.conversations.map(normalizeConversation).filter(Boolean) as StoredConversationSession[]
      : [];

    if (conversations.length === 0) {
      const created = createEmptyConversation();
      return {
        activeId: created.id,
        conversations: [created],
      };
    }

    const activeId = conversations.some((item) => item.id === raw?.activeId)
      ? String(raw?.activeId)
      : conversations[0].id;

    return {
      activeId,
      conversations,
    };
  }

  private ensureActiveConversation(): StoredConversationSession {
    const active = this.state.conversations.find((item) => item.id === this.state.activeId);
    if (active) return active;

    const created = createEmptyConversation();
    this.state.activeId = created.id;
    this.state.conversations.unshift(created);
    return created;
  }

  private trim() {
    const seen = new Set<string>();
    this.state.conversations = this.state.conversations
      .filter((item) => {
        if (!item?.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_CONVERSATIONS);

    if (!this.state.conversations.some((item) => item.id === this.state.activeId)) {
      this.state.activeId = this.state.conversations[0]?.id || createEmptyConversation().id;
    }
  }

  private async persist(): Promise<void> {
    await this.storage.update(STORAGE_KEY, this.state);
  }
}

function createEmptyConversation(): StoredConversationSession {
  const now = Date.now();
  return {
    id: `chat-${now}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'Новый чат',
    createdAt: now,
    updatedAt: now,
    messages: [],
    agentRuntime: null,
    suggestions: [],
    suggestionsState: 'starters',
    suggestionsSummary: defaultSuggestionsSummary(false),
    traceRuns: [],
    artifactEvents: [],
  };
}

function normalizeConversation(value: any): StoredConversationSession | null {
  if (!value || typeof value !== 'object') return null;
  const messages = normalizeMessages(Array.isArray(value.messages) ? value.messages : []);
  const suggestions = normalizeSuggestions(Array.isArray(value.suggestions) ? value.suggestions : []);
  const createdAt = Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now();
  const updatedAt = Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : createdAt;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `chat-${updatedAt}`,
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 80) : buildTitle(messages),
    createdAt,
    updatedAt,
    messages,
    agentRuntime: normalizeRuntimeSnapshot(value.agentRuntime),
    suggestions,
    suggestionsState: isFollowupState(value.suggestionsState) ? value.suggestionsState : 'starters',
    suggestionsSummary: typeof value.suggestionsSummary === 'string'
      ? value.suggestionsSummary.slice(0, 200)
      : defaultSuggestionsSummary(messages.length > 0),
    traceRuns: normalizeTraceRuns(value.traceRuns),
    artifactEvents: normalizeArtifactEvents(value.artifactEvents),
  };
}

function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .slice(-MAX_MESSAGES_PER_CONVERSATION)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function normalizeSuggestions(suggestions: FollowupSuggestion[]): FollowupSuggestion[] {
  return (Array.isArray(suggestions) ? suggestions : [])
    .filter((item) => item && typeof item.label === 'string' && typeof item.query === 'string')
    .slice(0, 4)
    .map((item) => ({
      label: item.label.slice(0, 36),
      query: item.query.slice(0, 240),
      hint: typeof item.hint === 'string' ? item.hint.slice(0, 72) : '',
    }));
}

function normalizeRuntimeSnapshot(snapshot: any): AgentRuntimeSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    sessionMemory: {
      scopeId: typeof snapshot.sessionMemory?.scopeId === 'string' ? snapshot.sessionMemory.scopeId.slice(0, 80) : '',
      summary: typeof snapshot.sessionMemory?.summary === 'string' ? snapshot.sessionMemory.summary.slice(0, 1200) : '',
      title: typeof snapshot.sessionMemory?.title === 'string' ? snapshot.sessionMemory.title.slice(0, 120) : '',
      currentState: typeof snapshot.sessionMemory?.currentState === 'string'
        ? snapshot.sessionMemory.currentState.slice(0, 220)
        : '',
      memoryPath: typeof snapshot.sessionMemory?.memoryPath === 'string' ? snapshot.sessionMemory.memoryPath : '',
      lastUpdatedAt: Number.isFinite(snapshot.sessionMemory?.lastUpdatedAt)
        ? Number(snapshot.sessionMemory.lastUpdatedAt)
        : 0,
      lastSummarizedMessageCount: Number.isFinite(snapshot.sessionMemory?.lastSummarizedMessageCount)
        ? Number(snapshot.sessionMemory.lastSummarizedMessageCount)
        : 0,
      lastSummarizedChars: Number.isFinite(snapshot.sessionMemory?.lastSummarizedChars)
        ? Number(snapshot.sessionMemory.lastSummarizedChars)
        : 0,
      failedUpdates: Number.isFinite(snapshot.sessionMemory?.failedUpdates)
        ? Number(snapshot.sessionMemory.failedUpdates)
        : 0,
    },
    mode: snapshot.mode === 'plan' ? 'plan' : 'normal',
    awaitingPlanApproval: false,
    pendingApproval: null,
    pendingQuestion: null,
    worktreeSession: snapshot.worktreeSession && typeof snapshot.worktreeSession === 'object'
      ? {
        slug: typeof snapshot.worktreeSession.slug === 'string' ? snapshot.worktreeSession.slug.slice(0, 80) : '',
        worktreePath: typeof snapshot.worktreeSession.worktreePath === 'string' ? snapshot.worktreeSession.worktreePath : '',
        worktreeBranch: typeof snapshot.worktreeSession.worktreeBranch === 'string' ? snapshot.worktreeSession.worktreeBranch.slice(0, 160) : undefined,
        worktreeFolderName: typeof snapshot.worktreeSession.worktreeFolderName === 'string' ? snapshot.worktreeSession.worktreeFolderName.slice(0, 120) : 'Worktree',
        canonicalRootPath: typeof snapshot.worktreeSession.canonicalRootPath === 'string' ? snapshot.worktreeSession.canonicalRootPath : '',
        originalWorkspaceRootPath: typeof snapshot.worktreeSession.originalWorkspaceRootPath === 'string' ? snapshot.worktreeSession.originalWorkspaceRootPath : '',
        originalWorkspaceFolderName: typeof snapshot.worktreeSession.originalWorkspaceFolderName === 'string'
          ? snapshot.worktreeSession.originalWorkspaceFolderName.slice(0, 120)
          : undefined,
        originalHeadCommit: typeof snapshot.worktreeSession.originalHeadCommit === 'string'
          ? snapshot.worktreeSession.originalHeadCommit.slice(0, 80)
          : undefined,
        createdAt: Number.isFinite(snapshot.worktreeSession.createdAt) ? Number(snapshot.worktreeSession.createdAt) : Date.now(),
      }
      : null,
    todos: normalizeTodos(snapshot.todos),
    progress: normalizeProgress(snapshot.progress),
    compaction: {
      compactCount: Number.isFinite(snapshot.compaction?.compactCount)
        ? Number(snapshot.compaction.compactCount)
        : 0,
      consecutiveFailures: Number.isFinite(snapshot.compaction?.consecutiveFailures)
        ? Number(snapshot.compaction.consecutiveFailures)
        : 0,
      lastCompactedMessageCount: Number.isFinite(snapshot.compaction?.lastCompactedMessageCount)
        ? Number(snapshot.compaction.lastCompactedMessageCount)
        : 0,
    },
  };
}

function defaultSuggestionsSummary(hasConversation: boolean): string {
  return hasConversation
    ? 'Следующие шаги по последнему ответу.'
    : 'Быстрые действия для старта работы с проектом.';
}

function buildTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim());
  if (!firstUser) return 'Новый чат';
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Новый чат';
}

function buildPreview(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((message) => message.content.trim());
  if (!last) return 'Пустой чат';
  return last.content.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function cloneConversation(conversation: StoredConversationSession): StoredConversationSession {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
    agentRuntime: conversation.agentRuntime ? {
      mode: conversation.agentRuntime.mode,
      awaitingPlanApproval: conversation.agentRuntime.awaitingPlanApproval,
      pendingApproval: conversation.agentRuntime.pendingApproval ? { ...conversation.agentRuntime.pendingApproval } : null,
      pendingQuestion: conversation.agentRuntime.pendingQuestion ? { ...conversation.agentRuntime.pendingQuestion } : null,
      worktreeSession: conversation.agentRuntime.worktreeSession ? { ...conversation.agentRuntime.worktreeSession } : null,
      todos: conversation.agentRuntime.todos.map((todo) => ({ ...todo })),
      progress: {
        ...conversation.agentRuntime.progress,
        context: { ...conversation.agentRuntime.progress.context },
      },
      sessionMemory: { ...conversation.agentRuntime.sessionMemory },
      compaction: { ...conversation.agentRuntime.compaction },
    } : null,
    suggestions: conversation.suggestions.map((item) => ({ ...item })),
    traceRuns: conversation.traceRuns.map((run) => ({
      id: run.id,
      state: run.state,
      summary: run.summary,
      events: run.events.map((event) => ({
        phase: event.phase,
        text: event.text,
        data: cloneTraceData(event.data),
      })),
    })),
    artifactEvents: conversation.artifactEvents.map((artifact) => cloneArtifactEvent(artifact)),
  };
}

function normalizeTraceRuns(value: any): PersistedTraceRun[] {
  const runs = Array.isArray(value) ? value : [];
  return runs
    .filter((run) => run && typeof run === 'object')
    .slice(-24)
    .map((run, index) => ({
      id: typeof run.id === 'string' && run.id.trim() ? run.id.trim().slice(0, 80) : `run-${index + 1}`,
      state: run.state === 'error' || run.state === 'stopped' ? run.state : 'done',
      summary: typeof run.summary === 'string' ? run.summary.slice(0, 240) : '',
      events: normalizeTraceEvents(run.events),
    }))
    .filter((run) => run.events.length > 0);
}

function normalizeTraceEvents(value: any): TraceEventPayload[] {
  const events = Array.isArray(value) ? value : [];
  return events
    .filter((event) => event && typeof event.phase === 'string' && typeof event.text === 'string')
    .slice(-240)
    .map((event) => ({
      phase: event.phase.slice(0, 80),
      text: event.text.slice(0, 4000),
      data: sanitizeTraceData(event.data, 0),
    }));
}

function sanitizeTraceData(value: any, depth: number): Record<string, any> {
  if (!value || typeof value !== 'object' || depth >= 4) return {};
  const output: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 40)) {
    output[key] = sanitizeTraceValue(entry, depth + 1);
  }
  return output;
}

function sanitizeTraceValue(value: any, depth: number): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.slice(0, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= 4) return [];
    return value.slice(0, 24).map((item) => sanitizeTraceValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return sanitizeTraceData(value, depth);
  }
  return String(value).slice(0, 400);
}

function cloneTraceData(value: Record<string, any>): Record<string, any> {
  return sanitizeTraceData(value, 0);
}

function normalizeArtifactEvents(value: any): PersistedChatArtifact[] {
  const items = Array.isArray(value) ? value : [];
  return items
    .filter((artifact) => artifact && typeof artifact.kind === 'string' && artifact.payload && typeof artifact.payload === 'object')
    .slice(-240)
    .map((artifact) => cloneArtifactEvent(artifact as PersistedChatArtifact));
}

function cloneArtifactEvent(artifact: PersistedChatArtifact): PersistedChatArtifact {
  return {
    kind: artifact.kind,
    ...(typeof artifact.runId === 'string' && artifact.runId.trim() ? { runId: artifact.runId.trim().slice(0, 80) } : {}),
    payload: sanitizeArtifactPayloadValue((artifact as any).payload, 0),
  } as PersistedChatArtifact;
}

function sanitizeArtifactPayloadValue(value: any, depth: number): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.slice(0, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= 4) return [];
    return value.slice(0, 80).map((item) => sanitizeArtifactPayloadValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 4) return {};
    const output: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 80)) {
      output[key] = sanitizeArtifactPayloadValue(entry, depth + 1);
    }
    return output;
  }
  return String(value).slice(0, 400);
}

function isFollowupState(value: any): value is FollowupState {
  return value === 'starters' || value === 'waiting' || value === 'loading' || value === 'ready' || value === 'error';
}

function normalizeTodos(value: any): AgentRuntimeSnapshot['todos'] {
  const items = Array.isArray(value) ? value : [];
  return items
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 40) : `todo-${index + 1}`,
      content: typeof item.content === 'string' ? item.content.trim().slice(0, 160) : '',
      activeForm: typeof item.activeForm === 'string' ? item.activeForm.trim().slice(0, 160) : '',
      status: item.status === 'completed' || item.status === 'in_progress' ? item.status : 'pending',
    }))
    .filter((item) => item.content && item.activeForm)
    .slice(0, 8);
}

function normalizeProgress(value: any): AgentRuntimeSnapshot['progress'] {
  const rawState = value?.state;
  const isTransient = rawState === 'running' || rawState === 'waiting';
  return {
    state:
      rawState === 'done' || rawState === 'error' || rawState === 'stopped' || rawState === 'idle'
        ? (isTransient ? 'idle' : rawState)
        : 'idle',
    summary: isTransient ? '' : (typeof value?.summary === 'string' ? value.summary.slice(0, 120) : ''),
    detail: isTransient ? '' : (typeof value?.detail === 'string' ? value.detail.slice(0, 220) : ''),
    activitySummary: isTransient ? '' : (typeof value?.activitySummary === 'string' ? value.activitySummary.slice(0, 120) : ''),
    activityUpdatedAt: Number.isFinite(value?.activityUpdatedAt) ? Number(value.activityUpdatedAt) : 0,
    backgroundSummary: isTransient ? '' : (typeof value?.backgroundSummary === 'string' ? value.backgroundSummary.slice(0, 180) : ''),
    backgroundUpdatedAt: Number.isFinite(value?.backgroundUpdatedAt) ? Number(value.backgroundUpdatedAt) : 0,
    connectionState: 'idle',
    connectionSummary: '',
    connectionDetail: '',
    connectionRetryAttempt: 0,
    connectionDelayMs: 0,
    connectionUpdatedAt: 0,
    updatedAt: Number.isFinite(value?.updatedAt) ? Number(value.updatedAt) : 0,
    lastCompletedSummary: typeof value?.lastCompletedSummary === 'string' ? value.lastCompletedSummary.slice(0, 120) : '',
    lastCompletedDetail: typeof value?.lastCompletedDetail === 'string' ? value.lastCompletedDetail.slice(0, 220) : '',
    lastCompletedAt: Number.isFinite(value?.lastCompletedAt) ? Number(value.lastCompletedAt) : 0,
    context: {
      messageCount: Number.isFinite(value?.context?.messageCount) ? Number(value.context.messageCount) : 0,
      messageChars: Number.isFinite(value?.context?.messageChars) ? Number(value.context.messageChars) : 0,
      maxContextChars: Number.isFinite(value?.context?.maxContextChars) ? Number(value.context.maxContextChars) : 100_000,
      estimatedInputTokens: Number.isFinite(value?.context?.estimatedInputTokens) ? Number(value.context.estimatedInputTokens) : 0,
      lastPromptTokens: Number.isFinite(value?.context?.lastPromptTokens) ? Number(value.context.lastPromptTokens) : 0,
      lastCompletionTokens: Number.isFinite(value?.context?.lastCompletionTokens) ? Number(value.context.lastCompletionTokens) : 0,
      lastTotalTokens: Number.isFinite(value?.context?.lastTotalTokens) ? Number(value.context.lastTotalTokens) : 0,
      model: typeof value?.context?.model === 'string' ? value.context.model.slice(0, 160) : '',
      updatedAt: Number.isFinite(value?.context?.updatedAt) ? Number(value.context.updatedAt) : 0,
    },
  };
}
