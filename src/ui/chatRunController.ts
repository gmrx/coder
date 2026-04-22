import * as vscode from 'vscode';
import { AgentQueryEngine } from '../agent';
import { readConfig } from '../core/api';
import { EXTENSION_NAME } from '../core/constants';
import { USER_ABORT_MESSAGE } from '../core/modelClient';
import { isMcpToolTrusted } from '../core/mcpToolAvailability';
import type { AssistantConfig, ChatMessage } from '../core/types';
import { isConfigValid } from '../core/utils';
import { WorkspaceChangeController } from './changeController';
import { CheckpointController } from './checkpoints';
import type { ConversationSnapshot } from './conversations';
import { generateFollowupSuggestions, type FollowupState, type FollowupSuggestion } from './followups';
import type { AgentApprovalRequest, AgentApprovalResult } from '../agent/runtime/approvals';
import type { AgentQuestionRequest, AgentQuestionResult } from '../agent/runtime/questions';
import {
  buildChatModelIssueAnswer,
  detectChatModelIssueFromText,
  type SettingsModelIssue,
  type SettingsPanelRequest,
} from './modelSelectionIssue';
import type { WebviewMessageSink } from './protocol/messages';
import type { PersistedTraceRun, TraceEventPayload } from './protocol/trace';

interface ChatRunControllerOptions {
  chatHistory: ChatMessage[];
  getAgentEngine: () => AgentQueryEngine;
  checkpointController: CheckpointController;
  changeController: WorkspaceChangeController;
  getActiveFileContext: () => { path: string; language: string; content: string } | null;
  getConversationContext?: () => string | Promise<string>;
  post: WebviewMessageSink;
  requestApproval: (request: AgentApprovalRequest, signal?: AbortSignal) => Promise<AgentApprovalResult>;
  cancelApproval: (confirmId: string, reason?: string) => void;
  requestQuestion: (request: AgentQuestionRequest, signal?: AbortSignal) => Promise<AgentQuestionResult>;
  cancelQuestion: (confirmId: string, reason?: string) => void;
  persistConversation: () => void | Promise<void>;
  openSettingsPanel: (request?: SettingsPanelRequest) => void;
}

type ActiveRunAction = {
  toolName: string;
  displayName: string;
  interruptBehavior: 'block' | 'cancel';
  requiresUserInteraction: boolean;
};

export class ChatRunController {
  private runningAbort: AbortController | null = null;
  private activeAction: ActiveRunAction | null = null;
  private activeApprovalConfirmId: string | null = null;
  private activeQuestionConfirmId: string | null = null;
  private stopRequested = false;
  private suggestionsEpoch = 0;
  private followupSuggestions: FollowupSuggestion[] = [];
  private followupState: FollowupState = 'starters';
  private followupSummary = 'Быстрые действия для старта работы с проектом.';
  private traceRuns: PersistedTraceRun[] = [];
  private activeTraceRun: PersistedTraceRun | null = null;
  private tracePersistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ChatRunControllerOptions) {}

  public isRunning(): boolean {
    return !!this.runningAbort;
  }

  public stop(): void {
    if (!this.runningAbort) return;
    if (
      this.activeAction &&
      this.activeAction.interruptBehavior === 'block' &&
      !this.activeAction.requiresUserInteraction
    ) {
      this.stopRequested = true;
      this.options.post({
        type: 'status',
        text: `Остановлю запуск после завершения текущего шага: ${this.activeAction.displayName}.`,
      });
      return;
    }

    this.options.post({
      type: 'status',
      text: this.activeAction?.requiresUserInteraction
        ? `Останавливаю запуск во время шага, который ждёт ответа пользователя: ${this.activeAction.displayName}.`
        : 'Останавливаю текущий запуск.',
    });

    if (this.activeAction?.requiresUserInteraction && this.activeApprovalConfirmId) {
      this.options.getAgentEngine().setPendingApproval(null);
      this.options.cancelApproval(this.activeApprovalConfirmId, 'Запуск остановлен пользователем.');
      this.activeApprovalConfirmId = null;
    }
    if (this.activeAction?.requiresUserInteraction && this.activeQuestionConfirmId) {
      this.options.getAgentEngine().setPendingQuestion(null);
      this.options.cancelQuestion(this.activeQuestionConfirmId, 'Запуск остановлен пользователем.');
      this.activeQuestionConfirmId = null;
    }
    this.runningAbort.abort('user_stop');
  }

  public async handleUserMessage(text: string): Promise<void> {
    const suggestionsEpoch = ++this.suggestionsEpoch;
    this.stopRequested = false;
    this.activeAction = null;
    this.activeApprovalConfirmId = null;
    this.activeQuestionConfirmId = null;
    this.options.getAgentEngine().setPendingApproval(null);
    this.options.getAgentEngine().setPendingQuestion(null);

    this.options.chatHistory.push({ role: 'user', content: text });
    void this.options.persistConversation();
    this.setFollowupState('waiting', 'Сначала отвечаю на запрос. Затем подберу следующие шаги.');
    this.startTraceRun();
    this.options.post({ type: 'traceReset' });

    const config = readConfig();
    if (!isConfigValid(config)) {
      this.options.openSettingsPanel({ section: 'models' });
      this.setFollowupState(
        this.followupSuggestions.length > 0 ? 'ready' : 'error',
        'Настройте подключение и chat model, чтобы получать следующие шаги.',
      );
      this.options.post({ type: 'error', text: 'Настройте API и модель во вкладке «Настройки».' });
      this.options.post({ type: 'agentDone' });
      return;
    }
    this.options.post({
      type: 'traceEvent',
      phase: 'agent-model',
      text: config.model ? `Модель: ${config.model}` : '',
      data: { model: config.model },
    });
    this.recordTraceEvent('agent-model', config.model ? `Модель: ${config.model}` : '', { model: config.model });

    const checkpoint = await this.options.checkpointController.createCheckpoint(text);
    this.options.post({
      type: 'checkpoint',
      id: checkpoint.id,
      index: checkpoint.index,
      timestamp: checkpoint.timestamp,
      userMessage: text.slice(0, 80),
      userMessageIndex: checkpoint.userMessageIndex,
      status: checkpoint.status,
      changedFiles: checkpoint.requestChanges.size,
    });

    const abortController = new AbortController();
    this.runningAbort = abortController;

    const loading = vscode.window.setStatusBarMessage(`${EXTENSION_NAME}: агент работает...`);
    let checkpointStatus: 'completed' | 'failed' | 'stopped' = 'completed';
    let suggestionsHistory: ChatMessage[] | null = null;

    try {
      let answer = await this.options.getAgentEngine().submitMessage(
        {
          question: text,
          activeFile: this.options.getActiveFileContext(),
          externalContext: await this.options.getConversationContext?.() || '',
        },
        {
          onStep: (phase, message, meta): void | Promise<any> => {
            if (abortController.signal.aborted) return;

            if (phase === 'approval-request' && meta?.confirmId && meta?.kind) {
              const approvalRequest = meta as AgentApprovalRequest;
              if (shouldAutoApproveRequest(readConfig(), approvalRequest)) {
                this.activeAction = {
                  toolName: approvalRequest.toolName || approvalRequest.kind,
                  displayName: approvalRequest.title || approvalRequest.toolName || 'Автодействие',
                  interruptBehavior: 'block',
                  requiresUserInteraction: false,
                };
                this.options.post({
                  type: 'traceEvent',
                  phase,
                  text: message,
                  data: {
                    ...meta,
                    summary: buildAutoApprovalSummary(approvalRequest),
                    detail: buildAutoApprovalDetail(approvalRequest),
                    autoApproved: true,
                  },
                });
                this.recordTraceEvent(phase, message, {
                  ...meta,
                  summary: buildAutoApprovalSummary(approvalRequest),
                  detail: buildAutoApprovalDetail(approvalRequest),
                  autoApproved: true,
                });
                return Promise.resolve(buildAutoApprovedResult(approvalRequest));
              }

              this.activeAction = {
                toolName: meta.toolName || meta.kind,
                displayName: meta.title || meta.toolName || 'Подтверждение',
                interruptBehavior: 'cancel',
                requiresUserInteraction: true,
              };
              this.options.post({ type: 'traceEvent', phase, text: message, data: meta || {} });
              this.recordTraceEvent(phase, message, meta || {});
              this.options.getAgentEngine().setPendingApproval(meta as AgentApprovalRequest);
              this.activeApprovalConfirmId = meta.confirmId;
              return this.options.requestApproval(meta as AgentApprovalRequest).finally(() => {
                this.options.getAgentEngine().setPendingApproval(null);
                if (this.activeApprovalConfirmId === meta.confirmId) {
                  this.activeApprovalConfirmId = null;
                }
              });
            }

            if (phase === 'question-request' && meta?.confirmId && Array.isArray(meta?.questions)) {
              this.activeAction = {
                toolName: meta.toolName || 'ask_user',
                displayName: meta.title || 'Вопрос пользователю',
                interruptBehavior: 'cancel',
                requiresUserInteraction: true,
              };
              this.options.post({ type: 'traceEvent', phase, text: message, data: meta || {} });
              this.recordTraceEvent(phase, message, meta || {});
              this.options.getAgentEngine().setPendingQuestion(meta as AgentQuestionRequest);
              this.activeQuestionConfirmId = meta.confirmId;
              return this.options.requestQuestion(meta as AgentQuestionRequest).finally(() => {
                this.options.getAgentEngine().setPendingQuestion(null);
                if (this.activeQuestionConfirmId === meta.confirmId) {
                  this.activeQuestionConfirmId = null;
                }
              });
            }

            if (phase === 'file-change') {
              this.options.checkpointController.recordFileChange(meta || {});
              const change = this.options.changeController.recordFileChange(meta || {});
              if (!change) return;
              this.options.post({ type: 'fileChange', ...change });
              return;
            }

            if (phase === 'agent-tool' && meta?.tool) {
              this.activeAction = {
                toolName: meta.tool,
                displayName: meta.displayName || meta.tool,
                interruptBehavior: meta.interruptBehavior === 'cancel' ? 'cancel' : 'block',
                requiresUserInteraction: !!meta.requiresUserInteraction,
              };
            } else if (phase === 'agent-result') {
              this.activeAction = null;
              if (this.stopRequested && !abortController.signal.aborted) {
                this.options.post({
                  type: 'status',
                  text: 'Текущий шаг завершён. Останавливаю запуск.',
                });
                abortController.abort('deferred_stop');
              }
            } else if (phase === 'agent-answer' || phase === 'agent-loop') {
              this.activeAction = null;
            }

            this.options.post({ type: 'traceEvent', phase, text: message, data: meta || {} });
            this.recordTraceEvent(phase, message, meta || {});
          },
          signal: abortController.signal,
        },
      );

      this.options.chatHistory.push({ role: 'assistant', content: answer });
      void this.options.persistConversation();
      const modelIssue = this.handleModelSelectionIssue(answer, config);
      if (modelIssue) {
        answer = buildChatModelIssueAnswer(modelIssue);
      }
      this.options.chatHistory[this.options.chatHistory.length - 1] = { role: 'assistant', content: answer };
      void this.options.persistConversation();
      const finalTraceState =
        abortController.signal.aborted || answer.startsWith(USER_ABORT_MESSAGE)
          ? 'stopped'
          : modelIssue || answer.startsWith('Ошибка API:')
            ? 'error'
            : 'done';
      if (finalTraceState === 'error') {
        checkpointStatus = 'failed';
      } else if (finalTraceState === 'stopped') {
        checkpointStatus = 'stopped';
      }
      this.finishTraceRun(
        finalTraceState,
        finalTraceState === 'done'
          ? 'Готово.'
          : finalTraceState === 'error'
            ? 'Во время выполнения возникла ошибка.'
            : 'Остановлено.',
      );
      this.options.post({ type: 'assistant', text: answer });

      if (!abortController.signal.aborted && finalTraceState === 'done') {
        suggestionsHistory = this.options.chatHistory
          .slice(-6)
          .map((message) => ({ role: message.role, content: message.content }));
      }
    } catch (error: any) {
      checkpointStatus = abortController.signal.aborted ? 'stopped' : 'failed';
      this.finishTraceRun(abortController.signal.aborted ? 'stopped' : 'error', abortController.signal.aborted ? 'Остановлено.' : 'Во время выполнения возникла ошибка.');
      if (!abortController.signal.aborted) {
        const issue = this.handleModelSelectionIssue(error?.message || String(error), config);
        if (issue) {
          const answer = buildChatModelIssueAnswer(issue);
          this.options.chatHistory.push({ role: 'assistant', content: answer });
          void this.options.persistConversation();
          this.options.post({ type: 'assistant', text: answer });
        } else {
          this.options.post({ type: 'error', text: error?.message || String(error) });
        }
      }
    } finally {
      if (abortController.signal.aborted) {
        checkpointStatus = 'stopped';
      }

      this.activeAction = null;
      this.activeApprovalConfirmId = null;
      this.activeQuestionConfirmId = null;
      this.stopRequested = false;
      const finishedCheckpoint = this.options.checkpointController.completeActiveCheckpoint(checkpointStatus);
      if (finishedCheckpoint) {
        this.options.post({
          type: 'checkpointUpdated',
          id: finishedCheckpoint.id,
          index: finishedCheckpoint.index,
          timestamp: finishedCheckpoint.timestamp,
          userMessage: finishedCheckpoint.userMessage.slice(0, 80),
          userMessageIndex: finishedCheckpoint.userMessageIndex,
          status: finishedCheckpoint.status,
          changedFiles: finishedCheckpoint.requestChanges.size,
        });
      }

      this.runningAbort = null;
      loading.dispose();
      this.options.post({ type: 'agentDone' });

      if (checkpointStatus === 'completed' && suggestionsHistory) {
        this.setFollowupState('loading', 'Подбираю следующие шаги по последнему ответу...');
        void this.generateSuggestions(config, suggestionsHistory, suggestionsEpoch);
      } else if (checkpointStatus !== 'completed') {
        this.setFollowupState(
          this.followupSuggestions.length > 0 ? 'ready' : 'error',
          checkpointStatus === 'stopped'
            ? 'Подбор следующих шагов остановлен вместе с запуском.'
            : 'Следующие шаги не обновлены из-за ошибки в запросе.',
        );
      }
    }
  }

  public async handleRefreshSuggestions(): Promise<void> {
    if (this.runningAbort) {
      this.options.post({ type: 'error', text: 'Сначала дождитесь завершения текущего запуска агента.' });
      return;
    }

    const config = readConfig();
    if (!isConfigValid(config)) {
      this.setFollowupState('error', 'Сначала настройте подключение и chat model.');
      return;
    }

    const recentHistory = this.options.chatHistory
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-6)
      .map((message) => ({ role: message.role, content: message.content }));

    if (recentHistory.length < 2 || !recentHistory.some((message) => message.role === 'assistant')) {
      this.setFollowupState('error', 'Сначала получите хотя бы один ответ в чате.');
      return;
    }

    const requestEpoch = ++this.suggestionsEpoch;
    this.setFollowupState('loading', 'Обновляю следующие шаги по текущему диалогу...');
    void this.generateSuggestions(config, recentHistory, requestEpoch);
  }

  public sendConversationState(): void {
    const runtime = this.options.getAgentEngine().snapshotRuntime();
    const config = readConfig();
    this.options.post({
      type: 'conversationState',
      sessionId: '',
      title: '',
      source: { type: 'free' },
      ...this.snapshotConversationState(),
      agentMode: runtime.mode,
      awaitingPlanApproval: runtime.awaitingPlanApproval,
      pendingApproval: runtime.pendingApproval,
      pendingQuestion: runtime.pendingQuestion,
      todos: runtime.todos,
      progress: runtime.progress,
      sessionMemory: runtime.sessionMemory,
      autoApproval: config.autoApproval,
    });
  }

  public snapshotConversationState(): ConversationSnapshot {
    return {
      messages: this.options.chatHistory
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({ role: message.role, content: message.content })),
      suggestions: this.followupSuggestions.map((item) => ({ ...item })),
      suggestionsState: this.followupState,
      suggestionsSummary: this.followupSummary,
      traceRuns: cloneTraceRuns(this.traceRuns),
      artifactEvents: [],
    };
  }

  public restoreConversationState(snapshot: ConversationSnapshot): void {
    this.followupSuggestions = Array.isArray(snapshot.suggestions)
      ? snapshot.suggestions.map((item) => ({ ...item }))
      : [];
    this.followupState = snapshot.suggestionsState || 'starters';
    this.followupSummary = snapshot.suggestionsSummary || 'Быстрые действия для старта работы с проектом.';
    this.traceRuns = cloneTraceRuns(Array.isArray(snapshot.traceRuns) ? snapshot.traceRuns : []);
    this.activeTraceRun = null;
  }

  public getActiveTraceRunId(): string | null {
    return this.activeTraceRun?.id || null;
  }

  private async generateSuggestions(
    config: AssistantConfig,
    recentHistory: ChatMessage[],
    requestEpoch: number,
  ): Promise<void> {
    try {
      if (recentHistory.length === 0) return;
      const suggestions = await generateFollowupSuggestions(config, recentHistory);
      if (requestEpoch !== this.suggestionsEpoch) return;

      if (suggestions.length > 0) {
        this.followupSuggestions = suggestions;
        this.followupState = 'ready';
        this.followupSummary = 'Следующие шаги по последнему ответу.';
        void this.options.persistConversation();
        this.options.post({
          type: 'updateSuggestions',
          suggestions,
          state: this.followupState,
          summary: this.followupSummary,
        });
        return;
      }

      this.setFollowupState(
        this.followupSuggestions.length > 0 ? 'ready' : 'error',
        this.followupSuggestions.length > 0
          ? 'Автоподсказки не обновились. Оставил предыдущие действия.'
          : 'Не удалось подобрать следующие шаги автоматически.',
      );
    } catch (error: any) {
      if (requestEpoch !== this.suggestionsEpoch) return;
      this.setFollowupState(
        this.followupSuggestions.length > 0 ? 'ready' : 'error',
        this.followupSuggestions.length > 0
          ? 'Автоподсказки не обновились. Оставил предыдущие действия.'
          : 'Не удалось получить следующие шаги от chat-модели.',
      );
      console.error('[AI-Assistant] generateSuggestions error:', error?.message || error);
    }
  }

  private handleModelSelectionIssue(text: string, config: AssistantConfig): SettingsModelIssue | null {
    const issue = detectChatModelIssueFromText(text, config);
    if (!issue) {
      return null;
    }
    this.options.openSettingsPanel({
      section: 'models',
      modelSelectionIssue: issue,
      highlightModelSelectionIssue: true,
    });
    this.options.post({
      type: 'status',
      text: 'Открыл настройки в разделе «Модели». Выберите chat-модель из списка и повторите запрос.',
    });
    return issue;
  }

  private setFollowupState(state: FollowupState, summary: string): void {
    this.followupState = state;
    this.followupSummary = summary;
    void this.options.persistConversation();
    this.options.post({
      type: 'suggestionsState',
      state,
      summary,
    });
  }

  private startTraceRun(): void {
    this.activeTraceRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      state: 'stopped',
      summary: '',
      events: [],
    };
    this.traceRuns.push(this.activeTraceRun);
    if (this.traceRuns.length > 24) {
      this.traceRuns = this.traceRuns.slice(-24);
    }
    this.schedulePersistConversation();
  }

  private recordTraceEvent(phase: string, text: string, data: Record<string, any>): void {
    if (!this.activeTraceRun) return;
    const event: TraceEventPayload = {
      phase: String(phase || '').slice(0, 80),
      text: String(text || '').slice(0, 4000),
      data: cloneTraceEventData(data),
    };
    this.activeTraceRun.events.push(event);
    if (this.activeTraceRun.events.length > 240) {
      this.activeTraceRun.events = this.activeTraceRun.events.slice(-240);
    }
    this.schedulePersistConversation();
  }

  private finishTraceRun(state: PersistedTraceRun['state'], summary: string): void {
    if (!this.activeTraceRun) return;
    this.activeTraceRun.state = state;
    this.activeTraceRun.summary = summary;
    this.activeTraceRun = null;
    this.schedulePersistConversation();
  }

  private schedulePersistConversation(): void {
    if (this.tracePersistTimer) return;
    this.tracePersistTimer = setTimeout(() => {
      this.tracePersistTimer = null;
      void this.options.persistConversation();
    }, 250);
  }
}

function cloneTraceEventData(value: any): Record<string, any> {
  return sanitizeTraceEventObject(value, 0);
}

function cloneTraceRuns(runs: PersistedTraceRun[]): PersistedTraceRun[] {
  return (Array.isArray(runs) ? runs : [])
    .map((run, index): PersistedTraceRun => ({
      id: typeof run.id === 'string' && run.id.trim() ? run.id.trim().slice(0, 80) : `run-restored-${index + 1}`,
      state: run.state === 'error' || run.state === 'stopped' ? run.state : 'done',
      summary: typeof run.summary === 'string' ? run.summary : '',
      events: Array.isArray(run.events)
        ? run.events
          .map((event): TraceEventPayload | null => {
            if (!event || typeof event.phase !== 'string' || typeof event.text !== 'string') return null;
            return {
              phase: event.phase,
              text: event.text,
              data: cloneTraceEventData(event.data),
            };
          })
          .filter((event): event is TraceEventPayload => !!event)
        : [],
    }))
    .filter((run) => run.events.length > 0);
}

function sanitizeTraceEventObject(value: any, depth: number): Record<string, any> {
  if (!value || typeof value !== 'object' || depth >= 4) return {};
  const output: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 40)) {
    output[key] = sanitizeTraceEventValue(entry, depth + 1);
  }
  return output;
}

function sanitizeTraceEventValue(value: any, depth: number): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.slice(0, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth >= 4) return [];
    return value.slice(0, 24).map((item) => sanitizeTraceEventValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return sanitizeTraceEventObject(value, depth);
  }
  return String(value).slice(0, 400);
}

function shouldAutoApproveRequest(config: AssistantConfig, request: AgentApprovalRequest): boolean {
  const auto = config.autoApproval;
  if (!auto) return false;

  if (request.kind === 'web') return !!auto.webFetch;
  if (request.kind === 'shell') return !!auto.shell;
  if (request.kind === 'worktree') return !!auto.worktree;
  if (request.kind === 'mcp') {
    return !!auto.mcp || isMcpToolTrusted(config.mcpTrustedTools, request.server, request.mcpToolName);
  }
  if (request.kind !== 'file') return false;

  switch (request.changeType) {
    case 'edit':
      return !!auto.fileEdit;
    case 'create':
      return !!auto.fileCreate;
    case 'delete':
      return !!auto.fileDelete;
    case 'overwrite':
    case 'notebook-edit-cell':
    case 'notebook-new-cell':
      return !!auto.fileEdit;
    default:
      return false;
  }
}

function buildAutoApprovalSummary(request: AgentApprovalRequest): string {
  switch (request.kind) {
    case 'web':
      return 'Авторазрешено: URL загружается без отдельного подтверждения.';
    case 'shell':
      return 'Авторазрешено: shell-команда запускается без ожидания подтверждения.';
    case 'file':
      if (request.changeType === 'create') return 'Авторазрешено: создание файла.';
      if (request.changeType === 'delete') return 'Авторазрешено: удаление файла.';
      return 'Авторазрешено: изменение файла.';
    case 'worktree':
      return 'Авторазрешено: действие с worktree.';
    case 'mcp':
      return 'Авторазрешено: MCP-вызов.';
    default:
      return 'Авторазрешено.';
  }
}

function buildAutoApprovalDetail(request: AgentApprovalRequest): string {
  if (request.kind === 'web') {
    return 'Подтверждение URL пропущено по настройке под полем ввода.';
  }
  if (request.kind === 'file') {
    return 'Подтверждение пропущено по настройке под полем ввода. Карточку изменения всё равно можно отклонить после применения.';
  }
  return 'Подтверждение пропущено по настройке под полем ввода.';
}

function buildAutoApprovedResult(request: AgentApprovalRequest): AgentApprovalResult {
  if (request.kind === 'shell') {
    return {
      kind: 'shell',
      confirmId: request.confirmId,
      approved: true,
      command: request.command,
      reason: 'auto_approved',
    };
  }

  if (request.kind === 'plan') {
    return {
      kind: 'plan',
      confirmId: request.confirmId,
      approved: true,
      reason: 'auto_approved',
      plan: request.plan,
    };
  }

  if (request.kind === 'file') {
    return {
      kind: 'file',
      confirmId: request.confirmId,
      approved: true,
      reason: 'auto_approved',
    };
  }

  if (request.kind === 'worktree') {
    return {
      kind: 'worktree',
      confirmId: request.confirmId,
      approved: true,
      reason: 'auto_approved',
    };
  }

  if (request.kind === 'web') {
    return {
      kind: 'web',
      confirmId: request.confirmId,
      approved: true,
      reason: 'auto_approved',
    };
  }

  return {
    kind: 'mcp',
    confirmId: request.confirmId,
    approved: true,
    reason: 'auto_approved',
  };
}
