import { USER_ABORT_MESSAGE } from '../../core/modelClient';
import type { ChatMessage } from '../../core/types';
import { truncate } from '../../core/utils';
import {
  createAgentMemory,
  hasFreshMcpContext,
  hasEnoughContext,
  isMcpCatalogQuery,
  type AgentMemory,
} from '../runnerMemory';
import { cleanupFinalAnswer } from '../runnerOutput';
import {
  buildRetryMessage,
  FINAL_ANSWER_TEMPERATURE,
} from './loopPolicy';
import {
  buildFinalAnswerPromptContract,
  buildJsonFailureFinalPromptContract,
  buildPlanModeFinalPromptContract,
  buildPlanModeRejectedPromptContract,
  buildToolApprovalRequest,
} from '../tooling/catalog';
import { extractToolSearchRecommendation } from '../tooling/definitions/toolSearch';
import type { ToolExecutionResult, ToolExecutionStatus } from '../tooling/results';
import type { AgentPlanApprovalDecision, AgentPlanApprovalResult } from './approvals';
import { AgentTraceEmitter } from './traceEmitter';
import { applyTodoWriteUpdate, type TodoWriteResult } from './todos';
import type {
  AgentRequestOptions,
  AgentSessionInitParams,
  AgentTodoItem,
  AgentRuntimeMode,
  AgentToolSearchRecommendation,
} from './types';
import type { AgentWorktreeSession } from '../worktreeSession';

export type AgentSessionInitResult =
  | { ok: true; session: AgentSession }
  | { ok: false; error: string };

export class AgentSession {
  readonly messages: ChatMessage[];
  readonly usedCalls = new Set<string>();
  readonly modelUsedTools = new Set<string>();
  readonly memory: AgentMemory;
  readonly lastQuestion: string;
  readonly mutationQuery: boolean;
  readonly needMermaid: boolean;
  readonly retrievalAutoContext: boolean;
  readonly carryoverContext: string;
  readonly embeddingsModel: string;
  readonly trace: AgentTraceEmitter;
  readonly runtime: AgentSessionInitParams['runtime'];
  readonly control: AgentSessionInitParams['control'];
  readonly freshMcpRequired: boolean;
  private readonly callHistory = new Map<string, {
    toolName: string;
    status: ToolExecutionStatus;
    attempts: number;
    lastContent: string;
    recommendation?: AgentToolSearchRecommendation | null;
  }>();
  private lastToolSearchRecommendation: AgentToolSearchRecommendation | null = null;

  private constructor(
    messages: ChatMessage[],
    prepared: AgentSessionInitParams['prepared'],
    runtime: AgentSessionInitParams['runtime'],
    control: AgentSessionInitParams['control'],
    onStep?: AgentSessionInitParams['onStep'],
    readonly signal?: AbortSignal,
  ) {
    this.messages = messages;
    this.lastQuestion = prepared.lastQuestion;
    this.runtime = runtime;
    this.control = control;
    this.embeddingsModel = runtime.config.embeddingsModel;
    this.retrievalAutoContext = prepared.retrievalAutoContext;
    this.needMermaid = prepared.needMermaid;
    this.carryoverContext = prepared.carryoverContext;
    this.freshMcpRequired = prepared.freshMcpRequired;
    this.memory = createAgentMemory();
    this.mutationQuery = prepared.mutationQuery;
    this.trace = new AgentTraceEmitter(onStep);
  }

  static async create({
    onStep,
    signal,
    runtime,
    control,
    prepared,
  }: AgentSessionInitParams): Promise<AgentSessionInitResult> {
    const session = new AgentSession(
      [...prepared.messages],
      prepared,
      runtime,
      control,
      onStep,
      signal,
    );

    return { ok: true, session };
  }

  requestModel = async (
    requestMessages: ChatMessage[],
    options: AgentRequestOptions,
  ): Promise<string> => {
    return this.runtime.requestChat(
      requestMessages,
      options,
      notice => {
        const retryMessage = buildRetryMessage(options.step, options.retryPrefix, notice);
        this.trace.think(retryMessage.text, retryMessage.meta);
      },
    );
  };

  async finalizeAnswer(
    content: string,
    step: number,
    progressLabel = 'Формирую ответ...',
  ): Promise<string> {
    this.trace.answer(progressLabel, { step });
    const requestMessages = this.buildFinalAnswerMessages(content);
    try {
      const answer = await this.requestModel(requestMessages, {
        temperature: FINAL_ANSWER_TEMPERATURE,
        step,
        retryPrefix: 'Ошибка при формировании ответа,',
        retryUntilSuccess: true,
      });
      return cleanupFinalAnswer(answer, this.needMermaid);
    } catch (error: any) {
      const message = error?.message || String(error);
      if (String(message).startsWith(USER_ABORT_MESSAGE)) return String(message);
      return `Ошибка API: ${message}`;
    }
  }

  pushAssistant(content: string): void {
    this.messages.push({ role: 'assistant', content });
  }

  pushUser(content: string): void {
    this.messages.push({ role: 'user', content });
  }

  buildFallbackFinalPrompt(): string {
    return buildJsonFailureFinalPromptContract(this.lastQuestion, this.needMermaid);
  }

  buildStandardFinalPrompt(): string {
    return buildFinalAnswerPromptContract(this.lastQuestion, this.needMermaid);
  }

  buildPlanModeFinalPrompt(): string {
    return buildPlanModeFinalPromptContract(this.lastQuestion);
  }

  shouldBlockFinalAnswerWithoutMutation(): boolean {
    return !this.isPlanMode() && this.mutationQuery && this.memory.workspaceMutations === 0;
  }

  hasSufficientContext(): boolean {
    return hasEnoughContext(this.lastQuestion, this.memory, {
      freshMcpRequired: this.freshMcpRequired,
    });
  }

  requiresFreshMcpFacts(): boolean {
    return this.freshMcpRequired;
  }

  hasFreshMcpContextForCurrentRun(): boolean {
    return hasFreshMcpContext(this.lastQuestion, this.memory);
  }

  buildFreshMcpWorkflowPrompt(): string {
    if (isMcpCatalogQuery(this.lastQuestion)) {
      return (
        'Это вопрос про доступные MCP серверы/утилиты. Не переходи к final_answer, пока в текущем запуске не получишь свежий результат list_mcp_tools или другого MCP read-only шага. ' +
        'Память прошлых запросов используй только как подсказку, но не как источник истины.'
      );
    }

    return (
      'Это вопрос про живые данные внешней системы через MCP. Не переходи к final_answer, пока в текущем запуске не получишь свежий результат mcp_tool по нужной сущности. ' +
      'Старую память используй только как подсказку маршрута. Если пользователь спорит с предыдущим ответом, считай старый факт устаревшим и перепроверь через MCP заново.'
    );
  }

  getMode(): AgentRuntimeMode {
    return this.control.getMode();
  }

  isPlanMode(): boolean {
    return this.getMode() === 'plan';
  }

  enterPlanMode(): void {
    if (this.isPlanMode()) return;
    this.control.setMode('plan');
    this.control.notifyRuntimeChanged?.();
    this.trace.mode('Вошёл в режим плана.', 'plan');
  }

  exitPlanMode(): void {
    if (!this.isPlanMode()) return;
    this.control.setMode('normal');
    this.control.notifyRuntimeChanged?.();
    this.trace.mode('Вышел из режима плана.', 'normal');
  }

  isAwaitingPlanApproval(): boolean {
    return this.control.getAwaitingPlanApproval();
  }

  async requestPlanApproval(
    plan: string,
    step: number,
  ): Promise<AgentPlanApprovalDecision> {
    const confirmId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.control.setAwaitingPlanApproval(true);
    this.control.notifyRuntimeChanged?.();
    this.trace.planApproval('План готов и ожидает подтверждения.', 'requested', {
      step,
      confirmId,
    });

    try {
      const request = buildToolApprovalRequest('exit_plan_mode', {
        confirmId,
        plan,
        mutationQuery: this.mutationQuery,
        step,
        toolName: 'exit_plan_mode',
      });
      if (!request || request.kind !== 'plan') {
        return { approved: true, plan, feedback: '' };
      }
      const decision = await this.trace.requestApproval(request) as AgentPlanApprovalResult;
      return {
        approved: !!decision?.approved,
        cancelled: !!decision?.cancelled,
        reason: typeof decision?.reason === 'string' ? decision.reason : '',
        plan: typeof decision?.plan === 'string' ? decision.plan : plan,
        feedback: typeof decision?.feedback === 'string' ? decision.feedback.trim() : '',
      };
    } finally {
      this.control.setAwaitingPlanApproval(false);
      this.control.notifyRuntimeChanged?.();
    }
  }

  buildPlanRevisionPrompt(feedback?: string, revisedPlan?: string): string {
    return buildPlanModeRejectedPromptContract(feedback, revisedPlan);
  }

  getTodos(): AgentTodoItem[] {
    return this.control.getTodos();
  }

  getWorktreeSession(): AgentWorktreeSession | null {
    return this.control.getWorktreeSession();
  }

  setWorktreeSession(session: AgentWorktreeSession | null): void {
    this.control.setWorktreeSession(session);
    this.control.notifyRuntimeChanged?.();
  }

  private buildFinalAnswerMessages(finalPrompt: string): ChatMessage[] {
    const context = this.buildFinalAnswerContext();
    const sessionTranscript = this.buildFinalAnswerSessionTranscript();
    return [
      {
        role: 'system',
        content:
          'Ты готовишь итоговый ответ пользователю в VS Code.\n' +
          'Отвечай строго и только на последний запрос пользователя.\n' +
          'Используй факты из текущего запуска ниже и, если запрос выглядит как продолжение темы, опирайся на накопленный контекст прошлых запросов.\n' +
          'Если последний запрос короткий и ссылается на уже найденный факт, назови этот факт прямо, без лишнего общего обзора.\n' +
          'Если в контексте уже есть MCP-факты вроде server/name/email/guid/projects/tasks, отвечай ими напрямую простым человеческим текстом.\n' +
          (this.freshMcpRequired
            ? 'Если вопрос связан с MCP или внешней системой, источник истины — только свежие MCP результаты текущего запуска. Накопленный контекст прошлых запросов используй только как подсказку маршрута.\n'
            : '') +
          'Не превращай ответ в общий обзор проекта, если пользователь этого прямо не просил.\n' +
          'Если в старом диалоге есть другая тема, игнорируй её.\n' +
          'Не выводи JSON. Пиши по-русски.',
      },
      {
        role: 'user',
        content:
          `[Последний запрос пользователя]\n${truncate(this.lastQuestion, 1_500, '…')}\n\n` +
          (this.freshMcpRequired
            ? '[Правило свежести]\nЭто вопрос про внешние данные через MCP. Не отвечай только по памяти прошлых запросов. Опирайся на свежие MCP результаты ТЕКУЩЕГО запуска.\n\n'
            : '') +
          (this.carryoverContext
            ? `[Накопленный контекст прошлых запросов]\n${truncate(this.carryoverContext, 14_000, '…')}\n\n`
            : '') +
          (sessionTranscript
            ? `[История текущей сессии и результаты инструментов]\n${sessionTranscript}\n\n`
            : '') +
          '[Контекст текущего запуска]\n' +
          `${context}`,
      },
      {
        role: 'user',
        content: finalPrompt,
      },
    ];
  }

  private buildFinalAnswerContext(): string {
    const sections: string[] = [];
    const readFiles = [...this.memory.readFiles].slice(0, 12);
    const topDirs = [...this.memory.topDirs].slice(0, 8);
    const keyFacts = this.memory.keyFacts.slice(0, 12);
    const traceContext = this.trace.snapshotFinalAnswerContext();

    sections.push(
      '- Это факты только текущего запуска агента, а не всего старого диалога.',
      `- tool calls: ${this.memory.toolCalls}`,
      `- workspace mutations: ${this.memory.workspaceMutations}`,
      `- top dirs: ${topDirs.length ? topDirs.join(', ') : '(нет)'}`,
      `- read files: ${readFiles.length ? readFiles.join(', ') : '(нет)'}`,
      `- свежие MCP catalog/tool calls: ${this.memory.freshMcpCatalogReads}/${this.memory.freshMcpToolCalls}`,
    );

    if (keyFacts.length) {
      sections.push('', '[Ключевые факты]', ...keyFacts.map((fact) => `- ${truncate(fact, 300, '…')}`));
    }

    if (this.memory.freshMcpFacts.length) {
      sections.push('', '[Свежие MCP факты текущего запуска]', ...this.memory.freshMcpFacts.map((fact) => `- ${truncate(fact, 300, '…')}`));
    }

    if (traceContext.toolSummary) {
      sections.push(
        '',
        '[Сводка действий текущего запуска]',
        `- ${traceContext.toolSummary.summary}`,
        traceContext.toolSummary.detail ? `- детали: ${truncate(traceContext.toolSummary.detail, 500, '…')}` : '',
      );
    }

    if (traceContext.flowSummary) {
      sections.push(
        '',
        '[Служебные переходы текущего запуска]',
        `- ${traceContext.flowSummary.summary}`,
        traceContext.flowSummary.detail ? `- детали: ${truncate(traceContext.flowSummary.detail, 500, '…')}` : '',
      );
    }

    return sections.filter(Boolean).join('\n');
  }

  private buildFinalAnswerSessionTranscript(): string {
    const MAX_TOTAL_CHARS = 42_000;
    const MAX_MESSAGE_CHARS = 3_200;
    const messages = this.messages.filter((message) => {
      if (message.role === 'system') return false;
      const content = String(message.content || '');
      if (content.includes('[Пример формата]')) return false;
      if (content.includes('[Система] Пример завершён.')) return false;
      return true;
    });
    if (messages.length === 0) return '';

    const selected: ChatMessage[] = [];
    let total = 0;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      const normalized = String(message.content || '');
      const size = normalized.length;
      if (selected.length > 0 && total + size > MAX_TOTAL_CHARS) break;
      selected.unshift(message);
      total += size;
    }

    return selected
      .map((message) => {
        const role = message.role === 'assistant' ? 'Агент' : 'Пользователь';
        return `${role}: ${truncate(String(message.content || ''), MAX_MESSAGE_CHARS, '…')}`;
      })
      .join('\n\n');
  }

  applyTodoWrite(input: any): TodoWriteResult {
    const result = applyTodoWriteUpdate(this.control.getTodos(), input, {
      mutationQuery: this.mutationQuery,
      verificationAlreadyUsed: this.modelUsedTools.has('verification_agent'),
    });
    this.control.setTodos(result.todos);
    this.control.notifyRuntimeChanged?.();
    this.trace.todos('Обновил список задач.', result.todos, {
      changed: result.changed,
      clearedCompleted: result.clearedCompleted,
    });
    return result;
  }

  getToolCallRecord(callKey: string): {
    toolName: string;
    status: ToolExecutionStatus;
    attempts: number;
    lastContent: string;
    recommendation?: AgentToolSearchRecommendation | null;
  } | undefined {
    return this.callHistory.get(callKey);
  }

  getToolSearchRecommendation(): AgentToolSearchRecommendation | null {
    return this.lastToolSearchRecommendation;
  }

  recordToolCallResult(callKey: string, execution: ToolExecutionResult): void {
    const structured = execution.meta?.presentation;
    const recommendation = execution.toolName === 'tool_search'
      ? (
        structured?.kind === 'tool_search'
          ? structured.data.recommendation || null
          : extractToolSearchRecommendation(execution.content)
      )
      : undefined;
    const previous = this.callHistory.get(callKey);
    this.callHistory.set(callKey, {
      toolName: execution.toolName,
      status: execution.status,
      attempts: (previous?.attempts || 0) + 1,
      lastContent: execution.content,
      ...(recommendation !== undefined ? { recommendation } : {}),
    });

    if (execution.toolName === 'tool_search') {
      if (execution.status === 'success') {
        this.lastToolSearchRecommendation = recommendation || null;
      } else {
        this.lastToolSearchRecommendation = null;
      }
      return;
    }

    if (
      this.lastToolSearchRecommendation &&
      execution.toolName === this.lastToolSearchRecommendation.toolName &&
      execution.status !== 'blocked'
    ) {
      this.lastToolSearchRecommendation = null;
    }
  }
}
