import type { ChatMessage } from './types';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 30_000;
export const USER_ABORT_MESSAGE = 'Задача остановлена пользователем.';

export interface RetryNotice {
  attempt: number;
  maxAttempts?: number;
  retryUntilSuccess?: boolean;
  delayMs: number;
  reason: 'transient' | 'timeout' | 'http';
  error: string;
  status?: number;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ModelRequestOptions {
  signal?: AbortSignal;
  onRetry?: (notice: RetryNotice) => void;
  retryUntilSuccess?: boolean;
  onUsage?: (usage: ChatUsage) => void;
}

export interface ChatCompletionOptions extends ModelRequestOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface RerankOptions extends ModelRequestOptions {
  topN?: number;
}

export interface RerankResult {
  index: number;
  relevanceScore?: number;
  score?: number;
}

function parseUsageValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractChatUsage(payload: any): ChatUsage | null {
  const usage = payload?.usage;
  if (!usage || typeof usage !== 'object') return null;

  const promptTokens =
    parseUsageValue(usage.prompt_tokens) ??
    parseUsageValue(usage.input_tokens) ??
    parseUsageValue(usage.promptTokens) ??
    parseUsageValue(usage.inputTokens);
  const completionTokens =
    parseUsageValue(usage.completion_tokens) ??
    parseUsageValue(usage.output_tokens) ??
    parseUsageValue(usage.completionTokens) ??
    parseUsageValue(usage.outputTokens);
  const totalTokens =
    parseUsageValue(usage.total_tokens) ??
    parseUsageValue(usage.totalTokens) ??
    (
      promptTokens !== undefined || completionTokens !== undefined
        ? (promptTokens || 0) + (completionTokens || 0)
        : undefined
    );

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return null;
  }

  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function createAbortMessage(): Error {
  return new Error(USER_ABORT_MESSAGE);
}

function getErrorStatus(err: any): number | undefined {
  if (typeof err?.status === 'number') return err.status;
  const match = String(err?.message || err || '').match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : undefined;
}

function createHttpError(status: number, body: string): Error {
  const err = new Error(`HTTP ${status}: ${body.slice(0, 500)}`) as Error & { status?: number };
  err.status = status;
  return err;
}

function isTransientError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err).toLowerCase();
  if (err.name === 'TypeError' && /fetch|network|failed/i.test(msg)) return true;
  if (/econnreset|econnrefused|enotfound|etimedout|epipe|socket hang up/i.test(msg)) return true;
  if (/network|connect|upstream|bad gateway|service unavailable|gateway timeout/i.test(msg)) return true;
  const status = getErrorStatus(err);
  return status !== undefined && RETRYABLE_STATUS.has(status);
}

function isTimeoutError(err: any, signal?: AbortSignal): boolean {
  return err?.name === 'AbortError' && !signal?.aborted;
}

function retryDelay(attempt: number, status?: number): number {
  if (status === 429) return Math.min(5_000 * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
  return Math.min(1_500 * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
}

async function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve(false);
    }, { once: true });
  });
}

async function withRetry<T>(
  maxAttempts: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onRetry: ((notice: RetryNotice) => void) | undefined,
  retryUntilSuccess: boolean | undefined,
  run: (requestSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw createAbortMessage();

    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      return await run(requestSignal);
    } catch (error: any) {
      lastError = error;
      if (signal?.aborted) throw createAbortMessage();

      const status = getErrorStatus(error);
      const timeout = isTimeoutError(error, signal);
      const retryable = timeout || isTransientError(error) || (status !== undefined && RETRYABLE_STATUS.has(status));
      if (!retryable || (!retryUntilSuccess && attempt >= maxAttempts)) break;

      const delayMs = retryDelay(attempt, status);
      onRetry?.({
        attempt,
        maxAttempts: retryUntilSuccess ? undefined : maxAttempts,
        retryUntilSuccess: !!retryUntilSuccess,
        delayMs,
        reason: timeout ? 'timeout' : status !== undefined ? 'http' : 'transient',
        error: error?.message || String(error),
        status,
      });

      const ok = await sleepUnlessAborted(delayMs, signal);
      if (!ok) throw createAbortMessage();
    }
  }

  if (signal?.aborted) throw createAbortMessage();
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function sendChatCompletion(
  apiBaseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts?: ChatCompletionOptions,
): Promise<string> {
  const body: Record<string, any> = { model, messages };
  if (opts?.temperature !== undefined) body.temperature = opts.temperature;
  if (opts?.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  return withRetry(5, 180_000, opts?.signal, opts?.onRetry, opts?.retryUntilSuccess, async (requestSignal) => {
    const response = await fetch(apiBaseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: requestSignal,
    });

    if (!response.ok) {
      throw createHttpError(response.status, await response.text());
    }

    const json = (await response.json()) as any;
    const usage = extractChatUsage(json);
    if (usage) {
      opts?.onUsage?.(usage);
    }
    return json.choices?.[0]?.message?.content || json.choices?.[0]?.delta?.content || JSON.stringify(json, null, 2);
  });
}

export async function sendEmbeddings(
  embeddingsUrl: string,
  apiKey: string,
  model: string,
  input: string[],
  opts?: ModelRequestOptions,
): Promise<number[][]> {
  return withRetry(3, 60_000, opts?.signal, opts?.onRetry, opts?.retryUntilSuccess, async (requestSignal) => {
    const response = await fetch(embeddingsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input }),
      signal: requestSignal,
    });

    if (!response.ok) {
      throw createHttpError(response.status, await response.text());
    }

    const json: any = await response.json();
    const data = json?.data || json;
    if (!Array.isArray(data)) throw new Error('Invalid embeddings response');
    return data.map((item: any) => item.embedding || item);
  });
}

export async function sendRerank(
  rerankUrl: string,
  apiKey: string,
  model: string,
  query: string,
  documents: string[],
  opts?: RerankOptions,
): Promise<RerankResult[]> {
  return withRetry(3, 60_000, opts?.signal, opts?.onRetry, opts?.retryUntilSuccess, async (requestSignal) => {
    const response = await fetch(rerankUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        query,
        documents,
        top_n: opts?.topN ?? documents.length,
      }),
      signal: requestSignal,
    });

    if (!response.ok) {
      throw createHttpError(response.status, await response.text());
    }

    const json: any = await response.json();
    const results = json?.results || json?.data || json;
    if (!Array.isArray(results)) throw new Error('Invalid rerank response');

    return results.map((item: any) => ({
      index: Number(item?.index ?? 0),
      relevanceScore: typeof item?.relevance_score === 'number' ? item.relevance_score : undefined,
      score: typeof item?.score === 'number' ? item.score : undefined,
    }));
  });
}

export async function fetchModels(
  apiBaseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const response = await withRetry(3, 20_000, signal, undefined, false, (requestSignal) => fetch(`${apiBaseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: requestSignal,
    }));

    if (!response.ok) return [];

    const data: any = await response.json();
    const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return list
      .map((item: any) => item.id || item.name || '')
      .filter((value: string) => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}
