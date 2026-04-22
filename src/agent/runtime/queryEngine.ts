import { USER_ABORT_MESSAGE } from '../../core/modelClient';
import { readConfig } from '../../core/api';
import type { ChatMessage } from '../../core/types';
import { AgentSession } from './agentSession';
import { applyAgentContextWindowUsage, updateAgentContextWindowRequest } from './contextWindow';
import {
  createBackgroundProgressState,
  maybeRefreshBackgroundProgressSummary,
  recordBackgroundProgressEvent,
  resetBackgroundProgressState,
  type BackgroundProgressState,
} from './backgroundProgressSummary';
import {
  createCompactionState,
  maybeCompactConversationWithModel,
  resetCompactionState,
  type AgentCompactionState,
} from './compaction';
import { createAgentRuntime } from './modelGateway';
import { createAgentProgressState, finishAgentProgress, hydrateAgentProgress, startAgentProgress, updateAgentProgressFromStep } from './progressSummary';
import { summarizeApprovalRequest } from './runtimeEventPresentation';
import type { AgentRuntimeChangeKind, AgentRuntimeMode } from './types';
import {
  createSessionMemoryState,
  deleteSessionMemoryFile,
  primeSessionMemoryFromRun,
  refreshSessionMemory,
  resetSessionMemoryState,
  type AgentSessionMemoryState,
} from './sessionMemory';
import type { AgentPendingApprovalSnapshot, AgentPendingQuestionSnapshot, AgentTodoItem } from './types';
import { prepareAgentTurnInput, primePreparedTurn } from './turnPreparation';
import { runAgentTurnLoop } from './turnLoop';
import type { AgentApprovalRequest } from './approvals';
import type { AgentQuestionRequest } from './questions';
import type { AgentWorktreeSession } from '../worktreeSession';
import type {
  AgentQueryEngineInitParams,
  AgentRuntimeContext,
  AgentRuntimeSnapshot,
  AgentTurnInput,
  AgentTurnExecutionParams,
} from './types';

export type AgentQueryEngineInitResult =
  | { ok: true; engine: AgentQueryEngine }
  | { ok: false; error: string };

export class AgentQueryEngine {
  private rawMessages: ChatMessage[];
  private mode: AgentRuntimeMode = 'normal';
  private awaitingPlanApproval = false;
  private pendingApproval: AgentPendingApprovalSnapshot | null = null;
  private pendingQuestion: AgentPendingQuestionSnapshot | null = null;
  private worktreeSession: AgentWorktreeSession | null = null;
  private todos: AgentTodoItem[] = [];
  private readonly sessionMemory: AgentSessionMemoryState;
  private readonly compaction: AgentCompactionState;
  private readonly progress = createAgentProgressState();
  private readonly backgroundProgress: BackgroundProgressState;
  private maintenanceTask: Promise<void> | null = null;
  private backgroundSummaryTimer: ReturnType<typeof setInterval> | null = null;
  private stateChangeListener?: (kind: AgentRuntimeChangeKind) => void;

  private constructor(initialMessages: ChatMessage[]) {
    this.rawMessages = initialMessages.map((message) => ({ ...message }));
    this.backgroundProgress = createBackgroundProgressState();
    this.sessionMemory = createSessionMemoryState();
    this.compaction = createCompactionState();
  }

  static create(
    params: AgentQueryEngineInitParams = {},
  ): AgentQueryEngineInitResult {
    return {
      ok: true,
      engine: new AgentQueryEngine(params.initialMessages || []),
    };
  }

  hydrateConversation(messages: ChatMessage[]): void {
    this.rawMessages = messages.map((message) => ({ ...message }));
    if (messages.length === 0) {
      void deleteSessionMemoryFile(this.sessionMemory.memoryPath);
      resetSessionMemoryState(this.sessionMemory);
      resetCompactionState(this.compaction);
    }
  }

  hydrateRuntime(snapshot?: AgentRuntimeSnapshot | null): void {
    if (!snapshot) {
      this.mode = 'normal';
      this.awaitingPlanApproval = false;
      this.pendingApproval = null;
      this.pendingQuestion = null;
      this.worktreeSession = null;
      this.todos = [];
      hydrateAgentProgress(this.progress, null);
      resetBackgroundProgressState(this.backgroundProgress);
      resetSessionMemoryState(this.sessionMemory);
      resetCompactionState(this.compaction);
      return;
    }

    this.sessionMemory.summary = snapshot.sessionMemory?.summary || '';
    this.sessionMemory.scopeId = snapshot.sessionMemory?.scopeId || this.sessionMemory.scopeId;
    this.sessionMemory.title = snapshot.sessionMemory?.title || '';
    this.sessionMemory.currentState = snapshot.sessionMemory?.currentState || '';
    this.sessionMemory.memoryPath = snapshot.sessionMemory?.memoryPath || '';
    this.sessionMemory.lastUpdatedAt = Number(snapshot.sessionMemory?.lastUpdatedAt || 0);
    this.sessionMemory.lastSummarizedMessageCount = Number(snapshot.sessionMemory?.lastSummarizedMessageCount || 0);
    this.sessionMemory.lastSummarizedChars = Number(snapshot.sessionMemory?.lastSummarizedChars || 0);
    this.sessionMemory.failedUpdates = Number(snapshot.sessionMemory?.failedUpdates || 0);
    this.sessionMemory.updateInFlight = false;

    this.compaction.compactCount = Number(snapshot.compaction?.compactCount || 0);
    this.compaction.consecutiveFailures = Number(snapshot.compaction?.consecutiveFailures || 0);
    this.compaction.lastCompactedMessageCount = Number(snapshot.compaction?.lastCompactedMessageCount || 0);
    this.mode = snapshot.mode === 'plan' ? 'plan' : 'normal';
    this.awaitingPlanApproval = !!snapshot.awaitingPlanApproval;
    this.pendingApproval = null;
    this.pendingQuestion = null;
    this.worktreeSession = snapshot.worktreeSession ? { ...snapshot.worktreeSession } : null;
    this.todos = Array.isArray(snapshot.todos) ? snapshot.todos.map((todo) => ({ ...todo })) : [];
    hydrateAgentProgress(this.progress, snapshot.progress);
  }

  snapshotConversation(): ChatMessage[] {
    return this.rawMessages.map((message) => ({ ...message }));
  }

  snapshotRuntime(): AgentRuntimeSnapshot {
    return {
      mode: this.mode,
      awaitingPlanApproval: this.awaitingPlanApproval,
      pendingApproval: this.pendingApproval ? { ...this.pendingApproval } : null,
      pendingQuestion: this.pendingQuestion ? { ...this.pendingQuestion } : null,
      worktreeSession: this.worktreeSession ? { ...this.worktreeSession } : null,
      todos: this.todos.map((todo) => ({ ...todo })),
      progress: {
        ...this.progress,
        context: { ...this.progress.context },
      },
      sessionMemory: {
        scopeId: this.sessionMemory.scopeId,
        summary: this.sessionMemory.summary,
        title: this.sessionMemory.title,
        currentState: this.sessionMemory.currentState,
        memoryPath: this.sessionMemory.memoryPath,
        lastUpdatedAt: this.sessionMemory.lastUpdatedAt,
        lastSummarizedMessageCount: this.sessionMemory.lastSummarizedMessageCount,
        lastSummarizedChars: this.sessionMemory.lastSummarizedChars,
        failedUpdates: this.sessionMemory.failedUpdates,
      },
      compaction: {
        compactCount: this.compaction.compactCount,
        consecutiveFailures: this.compaction.consecutiveFailures,
        lastCompactedMessageCount: this.compaction.lastCompactedMessageCount,
      },
    };
  }

  setStateChangeListener(listener?: (kind: AgentRuntimeChangeKind) => void): void {
    this.stateChangeListener = listener;
  }

  setPendingApproval(request: AgentApprovalRequest | null): void {
    const next = request ? buildPendingApprovalSnapshot(request) : null;
    if (
      this.pendingApproval?.confirmId === next?.confirmId &&
      this.pendingApproval?.summary === next?.summary &&
      this.pendingApproval?.detail === next?.detail
    ) {
      return;
    }
    this.pendingApproval = next;
    this.stateChangeListener?.('runtime');
  }

  setPendingQuestion(request: AgentQuestionRequest | null): void {
    const next = request ? buildPendingQuestionSnapshot(request) : null;
    if (
      this.pendingQuestion?.confirmId === next?.confirmId &&
      this.pendingQuestion?.summary === next?.summary &&
      this.pendingQuestion?.detail === next?.detail
    ) {
      return;
    }
    this.pendingQuestion = next;
    this.stateChangeListener?.('runtime');
  }

  setWorktreeSession(session: AgentWorktreeSession | null): void {
    const next = session ? { ...session } : null;
    if (
      this.worktreeSession?.worktreePath === next?.worktreePath &&
      this.worktreeSession?.originalWorkspaceRootPath === next?.originalWorkspaceRootPath &&
      this.worktreeSession?.worktreeBranch === next?.worktreeBranch
    ) {
      return;
    }
    this.worktreeSession = next;
    this.stateChangeListener?.('runtime');
  }

  async submitMessage(
    input: AgentTurnInput,
    params: AgentTurnExecutionParams = {},
  ): Promise<string> {
    if (this.todos.length > 0 && this.todos.every((todo) => todo.status === 'completed')) {
      this.todos = [];
      this.stateChangeListener?.('runtime');
    }
    this.emitProgressChange(startAgentProgress(this.progress, input.question));

    const runtime = createAgentRuntime({
      signal: params.signal,
      onContextRequest: (messages, model) => {
        this.emitProgressChange(updateAgentContextWindowRequest(this.progress.context, messages, model));
      },
      onContextUsage: (messages, model, usage) => {
        const requestChanged = updateAgentContextWindowRequest(this.progress.context, messages, model);
        const usageChanged = applyAgentContextWindowUsage(this.progress.context, usage);
        void params.onStep?.('agent-model-usage', 'Использование модели обновлено.', {
          model,
          promptTokens: usage.promptTokens || 0,
          completionTokens: usage.completionTokens || 0,
          totalTokens: usage.totalTokens || 0,
        });
        this.emitProgressChange(requestChanged || usageChanged);
      },
    });
    if (!runtime.ok) {
      this.emitProgressChange(finishAgentProgress(this.progress, 'error', runtime.error));
      return runtime.error;
    }

    const nextHistory = [
      ...this.rawMessages,
      { role: 'user' as const, content: input.question },
    ];
    const effectiveHistory = await this.getEffectiveHistory(nextHistory, params, runtime.runtime);

    const prepared = prepareAgentTurnInput({
      ...input,
      chatHistory: effectiveHistory,
      systemPrompt: readConfig().systemPrompt,
      sessionMemory: {
        title: this.sessionMemory.title,
        currentState: this.sessionMemory.currentState,
        summary: this.sessionMemory.summary,
      },
    }, runtime.runtime.config.embeddingsModel);

    const onStep = (phase: string, message: string, meta?: any): void | Promise<any> => {
      const progressChanged = updateAgentProgressFromStep(this.progress, phase, message, meta);
      recordBackgroundProgressEvent(this.backgroundProgress, phase, message, meta);
      const backgroundChanged = maybeRefreshBackgroundProgressSummary(this.progress, this.backgroundProgress);
      this.emitProgressChange(progressChanged || backgroundChanged);
      return params.onStep?.(phase, message, meta);
    };

    const init = await AgentSession.create({
      onStep,
      signal: params.signal,
      control: {
        getMode: () => this.mode,
        setMode: (mode) => {
          this.mode = mode;
        },
        getAwaitingPlanApproval: () => this.awaitingPlanApproval,
        setAwaitingPlanApproval: (value) => {
          this.awaitingPlanApproval = !!value;
        },
        getWorktreeSession: () => this.worktreeSession ? { ...this.worktreeSession } : null,
        setWorktreeSession: (session) => {
          this.worktreeSession = session ? { ...session } : null;
        },
        getTodos: () => this.todos.map((todo) => ({ ...todo })),
        setTodos: (todos) => {
          this.todos = todos.map((todo) => ({ ...todo }));
        },
        notifyRuntimeChanged: (kind) => {
          this.stateChangeListener?.(kind || 'runtime');
        },
      },
      prepared,
      runtime: runtime.runtime,
    });

    if (!init.ok) {
      this.emitProgressChange(finishAgentProgress(this.progress, 'error', init.error));
      return init.error;
    }

    this.rawMessages = nextHistory;
    resetBackgroundProgressState(this.backgroundProgress);
    this.startBackgroundSummaryTimer();
    try {
      await primePreparedTurn(init.session, prepared);
      const answer = await runAgentTurnLoop(init.session);
      init.session.trace.flushPendingFlowSummary(true);
      init.session.trace.flushPendingToolSummary();
      this.emitProgressChange(maybeRefreshBackgroundProgressSummary(this.progress, this.backgroundProgress, Date.now(), true));
      this.rawMessages = [
        ...this.rawMessages,
        { role: 'assistant', content: answer },
      ];

      if (params.signal?.aborted || answer.startsWith(USER_ABORT_MESSAGE)) {
        this.emitProgressChange(finishAgentProgress(this.progress, 'stopped', 'Запуск остановлен пользователем.'));
      } else if (answer.startsWith('Ошибка API:')) {
        this.emitProgressChange(finishAgentProgress(this.progress, 'error', answer));
      } else {
        const traceContext = init.session.trace.snapshotFinalAnswerContext();
        const sessionMemoryPrimed = primeSessionMemoryFromRun(this.sessionMemory, {
          question: init.session.lastQuestion,
          answer,
          readFiles: [...init.session.memory.readFiles].slice(0, 12),
          topDirs: [...init.session.memory.topDirs].slice(0, 8),
          keyFacts: init.session.memory.keyFacts.slice(0, 12),
          toolSummary: traceContext.toolSummary
            ? {
                summary: traceContext.toolSummary.summary,
                detail: traceContext.toolSummary.detail,
              }
            : null,
          flowSummary: traceContext.flowSummary
            ? {
                summary: traceContext.flowSummary.summary,
                detail: traceContext.flowSummary.detail,
              }
            : null,
        });
        if (sessionMemoryPrimed) {
          this.stateChangeListener?.('runtime');
        }
        const finalizedTodos = finalizeLingeringTodos(this.todos);
        if (finalizedTodos) {
          this.todos = finalizedTodos;
          init.session.trace.todos('Завершил оставшиеся задачи перед итоговым ответом.', finalizedTodos, {
            changed: true,
            autoCompleted: true,
            finalAnswerCleanup: true,
          });
          this.stateChangeListener?.('runtime');
        }
        this.emitProgressChange(finishAgentProgress(this.progress, 'done', 'Ответ готов.'));
      }

      this.scheduleMaintenance();
      return answer;
    } catch (error: any) {
      init.session.trace.flushPendingFlowSummary(true);
      init.session.trace.flushPendingToolSummary();
      this.emitProgressChange(maybeRefreshBackgroundProgressSummary(this.progress, this.backgroundProgress, Date.now(), true));
      this.emitProgressChange(finishAgentProgress(this.progress, 'error', error?.message || String(error)));
      throw error;
    } finally {
      this.setPendingApproval(null);
      this.setPendingQuestion(null);
      this.stopBackgroundSummaryTimer();
    }
  }

  private async getEffectiveHistory(
    nextHistory: ChatMessage[],
    params: AgentTurnExecutionParams,
    runtime: AgentRuntimeContext,
  ): Promise<ChatMessage[]> {
    const compacted = await maybeCompactConversationWithModel(nextHistory, this.sessionMemory.summary, this.compaction, runtime);
    if (compacted.compacted) {
      params.onStep?.('agent-memory', compacted.kind === 'model'
        ? 'Сжимаю раннюю историю диалога модельной автосводкой.'
        : 'Сжимаю раннюю историю диалога эвристической сводкой.',
      {
        compactCount: this.compaction.compactCount,
        keptMessages: compacted.messages.length,
        kind: compacted.kind || 'unknown',
        error: compacted.error || '',
      });
    }
    return compacted.messages;
  }

  private scheduleMaintenance(): void {
    if (this.maintenanceTask) return;
    this.maintenanceTask = (async () => {
      const before = JSON.stringify(this.snapshotRuntime());
      try {
        await refreshSessionMemory(this.rawMessages, this.sessionMemory);
        const after = JSON.stringify(this.snapshotRuntime());
        if (after !== before) {
          this.stateChangeListener?.('runtime');
        }
      } finally {
        this.maintenanceTask = null;
      }
    })();
  }

  private emitProgressChange(changed: boolean): void {
    if (!changed) return;
    this.stateChangeListener?.('progress');
  }

  private startBackgroundSummaryTimer(): void {
    this.stopBackgroundSummaryTimer();
    this.backgroundSummaryTimer = setInterval(() => {
      this.emitProgressChange(
        maybeRefreshBackgroundProgressSummary(this.progress, this.backgroundProgress),
      );
    }, 15_000);
  }

  private stopBackgroundSummaryTimer(): void {
    if (!this.backgroundSummaryTimer) return;
    clearInterval(this.backgroundSummaryTimer);
    this.backgroundSummaryTimer = null;
  }
}

function finalizeLingeringTodos(todos: AgentTodoItem[]): AgentTodoItem[] | null {
  const items = Array.isArray(todos) ? todos : [];
  if (items.length === 0) return null;
  const hasIncomplete = items.some((todo) => todo && todo.status !== 'completed');
  if (!hasIncomplete) return null;
  return items.map((todo) => ({
    ...todo,
    status: 'completed',
  }));
}

function buildPendingApprovalSnapshot(request: AgentApprovalRequest): AgentPendingApprovalSnapshot {
  const presentation = summarizeApprovalRequest(request);
  return {
    kind: request.kind,
    confirmId: request.confirmId,
    title: request.title,
    summary: presentation.summary,
    detail: presentation.detail,
    ...(request.toolName ? { toolName: request.toolName } : {}),
  };
}

function buildPendingQuestionSnapshot(request: AgentQuestionRequest): AgentPendingQuestionSnapshot {
  const firstQuestion = request.questions[0];
  const detail = firstQuestion
    ? `${firstQuestion.header}: ${firstQuestion.question}`
    : (request.description || '');
  return {
    confirmId: request.confirmId,
    title: request.title,
    summary: 'Жду ответа пользователя',
    detail,
    toolName: request.toolName,
  };
}
