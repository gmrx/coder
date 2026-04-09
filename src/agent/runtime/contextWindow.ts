import { MAX_CONTEXT_CHARS } from '../../core/constants';
import type { ChatMessage } from '../../core/types';
import type { ChatUsage } from '../../core/modelClient';
import type { AgentContextWindowSnapshot } from './types';

function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.max(1, Math.round(chars / 4));
}

function countMessageChars(messages: ChatMessage[]): number {
  return (Array.isArray(messages) ? messages : []).reduce((total, message) => {
    return total + String(message?.content || '').length;
  }, 0);
}

export function createAgentContextWindowState(): AgentContextWindowSnapshot {
  return {
    messageCount: 0,
    messageChars: 0,
    maxContextChars: MAX_CONTEXT_CHARS,
    estimatedInputTokens: 0,
    lastPromptTokens: 0,
    lastCompletionTokens: 0,
    lastTotalTokens: 0,
    model: '',
    updatedAt: 0,
  };
}

export function hydrateAgentContextWindow(
  target: AgentContextWindowSnapshot,
  snapshot?: Partial<AgentContextWindowSnapshot> | null,
): void {
  target.messageCount = Number.isFinite(snapshot?.messageCount) ? Number(snapshot!.messageCount) : 0;
  target.messageChars = Number.isFinite(snapshot?.messageChars) ? Number(snapshot!.messageChars) : 0;
  target.maxContextChars = Number.isFinite(snapshot?.maxContextChars) ? Number(snapshot!.maxContextChars) : MAX_CONTEXT_CHARS;
  target.estimatedInputTokens = Number.isFinite(snapshot?.estimatedInputTokens) ? Number(snapshot!.estimatedInputTokens) : estimateTokens(target.messageChars);
  target.lastPromptTokens = Number.isFinite(snapshot?.lastPromptTokens) ? Number(snapshot!.lastPromptTokens) : 0;
  target.lastCompletionTokens = Number.isFinite(snapshot?.lastCompletionTokens) ? Number(snapshot!.lastCompletionTokens) : 0;
  target.lastTotalTokens = Number.isFinite(snapshot?.lastTotalTokens) ? Number(snapshot!.lastTotalTokens) : 0;
  target.model = typeof snapshot?.model === 'string' ? snapshot.model.slice(0, 160) : '';
  target.updatedAt = Number.isFinite(snapshot?.updatedAt) ? Number(snapshot!.updatedAt) : 0;
}

export function updateAgentContextWindowRequest(
  target: AgentContextWindowSnapshot,
  messages: ChatMessage[],
  model: string,
): boolean {
  const messageCount = Array.isArray(messages) ? messages.length : 0;
  const messageChars = countMessageChars(messages);
  const estimatedInputTokens = estimateTokens(messageChars);
  const nextModel = String(model || '').slice(0, 160);

  if (
    target.messageCount === messageCount &&
    target.messageChars === messageChars &&
    target.estimatedInputTokens === estimatedInputTokens &&
    target.model === nextModel &&
    target.lastPromptTokens === 0 &&
    target.lastCompletionTokens === 0 &&
    target.lastTotalTokens === 0
  ) {
    return false;
  }

  target.messageCount = messageCount;
  target.messageChars = messageChars;
  target.maxContextChars = MAX_CONTEXT_CHARS;
  target.estimatedInputTokens = estimatedInputTokens;
  target.lastPromptTokens = 0;
  target.lastCompletionTokens = 0;
  target.lastTotalTokens = 0;
  target.model = nextModel;
  target.updatedAt = Date.now();
  return true;
}

export function applyAgentContextWindowUsage(
  target: AgentContextWindowSnapshot,
  usage: ChatUsage | undefined,
): boolean {
  if (!usage) return false;

  const nextPrompt = Number.isFinite(usage.promptTokens) ? Number(usage.promptTokens) : target.lastPromptTokens;
  const nextCompletion = Number.isFinite(usage.completionTokens) ? Number(usage.completionTokens) : target.lastCompletionTokens;
  const nextTotal = Number.isFinite(usage.totalTokens)
    ? Number(usage.totalTokens)
    : (nextPrompt || nextCompletion ? nextPrompt + nextCompletion : target.lastTotalTokens);

  if (
    target.lastPromptTokens === nextPrompt &&
    target.lastCompletionTokens === nextCompletion &&
    target.lastTotalTokens === nextTotal
  ) {
    return false;
  }

  target.lastPromptTokens = nextPrompt;
  target.lastCompletionTokens = nextCompletion;
  target.lastTotalTokens = nextTotal;
  target.updatedAt = Date.now();
  return true;
}
