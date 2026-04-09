import { truncate } from '../../core/utils';
import type { AgentApprovalRequest, AgentApprovalResult } from './approvals';
import type { AgentQuestionRequest, AgentQuestionResult } from './questions';
import type { ToolExecutionResult } from '../tooling/results';
import {
  getToolPresentationMeta,
  getToolResultDetail,
  getToolResultPreview,
  getToolResultSummary,
  getToolStartSummary,
  getToolTraceMeta,
} from '../tooling/catalog';
import {
  summarizeApprovalRequest,
  summarizeModeChange,
  summarizePlanApprovalStatus,
  summarizeQuestionRequest,
  summarizeSubagentBatch,
  summarizeTodoUpdate,
} from './runtimeEventPresentation';
import { buildRuntimeFlowSummary, type RuntimeFlowSummaryEntry } from './runtimeFlowSummary';
import { buildToolUseSummary, type ToolUseSummaryEntry } from './toolUseSummary';
import type { AgentStepCallback } from './types';

export class AgentTraceEmitter {
  private pendingToolSummaryEntries: ToolUseSummaryEntry[] = [];
  private pendingFlowSummaryEntries: RuntimeFlowSummaryEntry[] = [];
  private readonly toolArgsByStep = new Map<string, any>();
  private lastToolSummary: ToolUseSummaryEntry[] = [];
  private lastFlowSummary: RuntimeFlowSummaryEntry[] = [];

  constructor(private readonly onStep?: AgentStepCallback) {}

  emit = (phase: string, message: string, meta?: any): void => {
    this.onStep?.(phase, message, meta);
  };

  event = <T = any>(phase: string, message: string, meta?: any): void | Promise<T> => {
    if (phase === 'approval-request' && meta?.confirmId && meta?.kind) {
      return this.requestApproval(meta as AgentApprovalRequest) as Promise<T>;
    }
    if (phase === 'question-request' && meta?.confirmId && Array.isArray(meta?.questions)) {
      return this.requestQuestion(meta as AgentQuestionRequest) as Promise<T>;
    }
    this.emit(phase, message, meta);
  };

  request<T = any>(phase: string, message: string, meta?: any): Promise<T> {
    return Promise.resolve(this.onStep?.(phase, message, meta) as T);
  }

  requestApproval(request: AgentApprovalRequest): Promise<AgentApprovalResult> {
    this.flushPendingFlowSummary(true);
    this.flushPendingToolSummary(true);
    const presentation = summarizeApprovalRequest(request);
    return this.request<AgentApprovalResult>('approval-request', request.title, {
      ...request,
      summary: presentation.summary,
      detail: presentation.detail,
    });
  }

  requestQuestion(request: AgentQuestionRequest): Promise<AgentQuestionResult> {
    this.flushPendingFlowSummary(true);
    this.flushPendingToolSummary(true);
    const presentation = summarizeQuestionRequest(request);
    return this.request<AgentQuestionResult>('question-request', request.title, {
      ...request,
      summary: presentation.summary,
      detail: presentation.detail,
    });
  }

  think(message: string, meta?: any): void {
    this.flushPendingFlowSummary(false);
    this.flushPendingToolSummary(false);
    this.emit('agent-think', message, meta);
  }

  answer(message: string, meta?: any): void {
    this.flushPendingFlowSummary(true);
    this.flushPendingToolSummary(true);
    this.emit('agent-answer', message, meta);
  }

  loop(message: string, meta?: any): void {
    this.flushPendingFlowSummary(true);
    this.flushPendingToolSummary(true);
    this.emit('agent-loop', message, meta);
  }

  recovery(message: string, meta?: any): void {
    this.pendingFlowSummaryEntries.push({
      kind: 'recovery',
      summary: String(meta?.summary || message || '').trim(),
      detail: String(meta?.detail || '').trim(),
      recoveryKind: meta?.kind || undefined,
    });
    this.flushPendingToolSummary(true);
    this.emit('agent-recovery', message, {
      ...(meta || {}),
      summary: meta?.summary || message,
      detail: meta?.detail || '',
    });
  }

  transition(message: string, meta?: any): void {
    this.pendingFlowSummaryEntries.push({
      kind: 'transition',
      summary: String(meta?.summary || message || '').trim(),
      detail: String(meta?.detail || '').trim(),
      transitionReason: meta?.reason || undefined,
    });
    this.flushPendingToolSummary(true);
    this.emit('agent-transition', message, {
      ...(meta || {}),
      summary: meta?.summary || message,
      detail: meta?.detail || '',
    });
  }

  private buildToolMeta(tool: string, extra?: Record<string, any>): Record<string, any> {
    return {
      tool,
      ...getToolTraceMeta(tool),
      ...getToolPresentationMeta(tool),
      ...(extra || {}),
    };
  }

  private formatStepKey(step: number | string): string {
    return String(step);
  }

  tool(step: number | string, tool: string, args: any, reasoning?: string): void {
    this.flushPendingFlowSummary(true);
    this.toolArgsByStep.set(this.formatStepKey(step), args || {});
    const meta = this.buildToolMeta(tool, {
      step,
      args: args || {},
      reasoning: reasoning || '',
      startSummary: getToolStartSummary(tool),
    });
    const argsText = args ? ` ${JSON.stringify(args)}` : '';
    this.emit(
      'agent-tool',
      `[${meta.displayName}]${argsText}${reasoning ? ` — ${reasoning}` : ''}`,
      meta,
    );
  }

  result(step: number | string, tool: string, execution: ToolExecutionResult): void {
    const content = execution.content || '';
    const key = this.formatStepKey(step);
    const args = this.toolArgsByStep.get(key) || {};
    this.toolArgsByStep.delete(key);
    const meta = this.buildToolMeta(tool, {
      step,
      args,
      lines: content.split('\n').length,
      resultPresentation: execution.meta?.presentation || null,
      resultDetail: getToolResultDetail(tool, execution),
      resultPreview: truncate(getToolResultPreview(tool, execution), tool === 'shell' ? 6_000 : 400),
      resultSummary: getToolResultSummary(tool, execution),
      status: execution.status,
      autoApproved: execution.meta?.autoApproved === true,
      phase: execution.meta?.phase || 'execution',
      recoveryHint: execution.meta?.recoveryHint?.kind || '',
      error: execution.status === 'error' || execution.status === 'blocked',
    });
    this.emit('agent-result', `[${meta.displayName}] → ${content.split('\n').length} строк`, meta);
    const batchResults = execution.meta?.batchResults;
    if (tool === 'tool_batch' && batchResults?.length) {
      for (const child of batchResults) {
        const childMeta = this.buildToolMeta(child.toolName, {
          resultSummary: getToolResultSummary(
            child.toolName,
            {
              toolName: child.toolName,
              status: child.status,
              content: child.content,
              ...(child.meta ? { meta: child.meta } : {}),
            },
          ),
        });
        this.pendingToolSummaryEntries.push({
          toolName: child.toolName,
          args: child.args || {},
          execution: {
            toolName: child.toolName,
            status: child.status,
            content: child.content,
            ...(child.meta ? { meta: child.meta } : {}),
          },
          displayName: childMeta.displayName,
          resultSummary: childMeta.resultSummary,
          countsAsTool: childMeta.countsAsTool !== false,
        });
      }
      return;
    }

    this.pendingToolSummaryEntries.push({
      toolName: tool,
      args,
      execution,
      displayName: meta.displayName,
      resultSummary: meta.resultSummary,
      countsAsTool: meta.countsAsTool !== false,
    });
  }

  autoStart(tool: string, args: any): void {
    this.flushPendingFlowSummary(true);
    this.flushPendingToolSummary(true);
    const meta = this.buildToolMeta(tool, {
      stage: 'start',
      args,
      summary: 'Собираю стартовый контекст',
      detail: getToolStartSummary(tool),
    });
    this.emit('agent-auto', `[Автоконтекст] ${meta.displayName}...`, meta);
  }

  autoDone(tool: string, args: any, content: string, status: string): void {
    this.flushPendingFlowSummary(true);
    this.flushPendingToolSummary(true);
    const meta = this.buildToolMeta(tool, {
      stage: 'done',
      args,
      lines: content.split('\n').length,
      status,
      summary: 'Стартовый контекст обновлён',
      detail: getToolStartSummary(tool),
    });
    this.emit('agent-auto-done', `[Автоконтекст] ${meta.displayName} → ${content.split('\n').length} строк`, meta);
  }

  mode(message: string, mode: 'plan' | 'normal'): void {
    this.flushPendingFlowSummary(true);
    this.flushPendingToolSummary(true);
    const presentation = summarizeModeChange(mode, message);
    this.emit('agent-mode', message, {
      mode,
      summary: presentation.summary,
      detail: presentation.detail,
    });
  }

  planApproval(
    message: string,
    status: 'requested' | 'approved' | 'rejected' | 'cancelled',
    meta?: Record<string, any>,
  ): void {
    this.flushPendingFlowSummary(true);
    this.flushPendingToolSummary(true);
    const presentation = summarizePlanApprovalStatus(status, message);
    this.emit('agent-plan-approval', message, {
      ...(meta || {}),
      status,
      summary: presentation.summary,
      detail: presentation.detail,
    });
  }

  todos(message: string, todos: any[], extra?: Record<string, any>): void {
    this.flushPendingFlowSummary(true);
    this.flushPendingToolSummary(true);
    const presentation = summarizeTodoUpdate(todos as any);
    this.emit('agent-todos', message, {
      ...(extra || {}),
      todos,
      summary: presentation.summary,
      detail: presentation.detail,
    });
  }

  subagentBatch(message: string, tasks: any[], extra?: Record<string, any>): void {
    this.flushPendingFlowSummary(true);
    this.flushPendingToolSummary(true);
    const presentation = summarizeSubagentBatch(tasks as any);
    this.emit('subagent-batch', message, {
      ...(extra || {}),
      tasks,
      summary: presentation.summary,
      detail: presentation.detail,
    });
  }

  flushPendingToolSummary(force = true): void {
    if (!force && this.pendingToolSummaryEntries.filter((entry) => entry.countsAsTool).length < 3) {
      return;
    }
    this.lastToolSummary = this.pendingToolSummaryEntries.map((entry) => ({
      ...entry,
      args: entry.args ? { ...entry.args } : {},
      execution: {
        ...entry.execution,
        meta: entry.execution.meta ? { ...entry.execution.meta } : entry.execution.meta,
      },
    }));
    const summary = buildToolUseSummary(this.pendingToolSummaryEntries);
    this.pendingToolSummaryEntries = [];
    if (!summary) return;

    this.emit('agent-tool-summary', summary.summary, {
      summary: summary.summary,
      detail: summary.detail,
      activitySummary: summary.activitySummary,
      count: summary.count,
      tools: summary.tools,
    });
  }

  flushPendingFlowSummary(force = true): void {
    if (!force && this.pendingFlowSummaryEntries.length < 3) {
      return;
    }
    this.lastFlowSummary = this.pendingFlowSummaryEntries.map((entry) => ({ ...entry }));
    const summary = buildRuntimeFlowSummary(this.pendingFlowSummaryEntries);
    this.pendingFlowSummaryEntries = [];
    if (!summary) return;

    this.emit('agent-flow-summary', summary.summary, {
      summary: summary.summary,
      detail: summary.detail,
      activitySummary: summary.activitySummary,
      count: summary.count,
    });
  }

  snapshotFinalAnswerContext(): {
    toolSummary: ReturnType<typeof buildToolUseSummary> | null;
    flowSummary: ReturnType<typeof buildRuntimeFlowSummary> | null;
  } {
    return {
      toolSummary: buildToolUseSummary(this.lastToolSummary),
      flowSummary: buildRuntimeFlowSummary(this.lastFlowSummary),
    };
  }
}
