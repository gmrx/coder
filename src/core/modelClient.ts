import type { ChatMessage } from './types';

// Внутренние gateway-сервисы могут жить за корпоративными CA.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const CONNECT_TIMEOUT_MS = 30_000;

let undiciModule: any = null;
function loadUndici(): any {
  if (undiciModule) return undiciModule;
  try {
    undiciModule = require('undici');
  } catch {
    undiciModule = null;
  }
  return undiciModule;
}

function readVscodeProxy(): string {
  try {
    const vscode = require('vscode');
    const value = vscode?.workspace?.getConfiguration('http')?.get('proxy');
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function readEnvProxy(): string {
  const candidates = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
  ];
  for (const value of candidates) {
    const trimmed = (value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function buildModelDispatcher(): unknown | undefined {
  const undici = loadUndici();
  if (!undici) return undefined;

  const tlsOptions = { rejectUnauthorized: false };
  const connectOptions = {
    timeout: CONNECT_TIMEOUT_MS,
    rejectUnauthorized: false,
  };

  const envProxy = readEnvProxy();
  if (envProxy && undici.EnvHttpProxyAgent) {
    // EnvHttpProxyAgent сам учитывает NO_PROXY и выбирает HTTP/HTTPS_PROXY.
    return new undici.EnvHttpProxyAgent({
      requestTls: tlsOptions,
      proxyTls: tlsOptions,
      connect: connectOptions,
    });
  }

  const explicitProxy = envProxy || readVscodeProxy();
  if (explicitProxy && undici.ProxyAgent) {
    return new undici.ProxyAgent({
      uri: explicitProxy,
      requestTls: tlsOptions,
      proxyTls: tlsOptions,
      connect: connectOptions,
    });
  }

  if (undici.Agent) {
    return new undici.Agent({ connect: connectOptions });
  }

  return undefined;
}

let cachedDispatcher: unknown | undefined;
let cachedDispatcherSignature = '';
function getCachedDispatcher(): unknown | undefined {
  // Пересоздаём dispatcher, если поменялись настройки прокси: дёшево, но
  // позволяет переключаться без перезапуска расширения.
  const signature = `${readEnvProxy()}|${readVscodeProxy()}`;
  if (signature !== cachedDispatcherSignature) {
    cachedDispatcherSignature = signature;
    cachedDispatcher = buildModelDispatcher();
  }
  return cachedDispatcher;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 30_000;
const RETRY_UNTIL_SUCCESS_DELAY_MS = 3_000;
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

interface ModelHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
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

function extractCauseCode(error: any): string {
  const cause = error?.cause;
  return String(error?.code || cause?.code || cause?.cause?.code || '').toUpperCase();
}

function describeTransport(): string {
  const env = readEnvProxy();
  const vsc = readVscodeProxy();
  if (env) return `через прокси HTTPS_PROXY=${env}`;
  if (vsc) return `через прокси VS Code http.proxy=${vsc}`;
  return 'напрямую (прокси не настроен)';
}

function normalizeTransportError(error: unknown): Error {
  const value = error as any;
  if (!(value instanceof Error)) return new Error(String(error));

  const code = extractCauseCode(value);
  const cause = (value as any).cause;
  const baseMessage = String(value.message || '').trim();
  const causeMessage = String(cause?.message || cause?.cause?.message || '').trim();
  const detail = causeMessage && causeMessage !== baseMessage
    ? `${baseMessage}: ${causeMessage}`
    : baseMessage;

  let prefix = '';
  let withTransport = false;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') prefix = 'DNS не нашёл хост';
  else if (code === 'ECONNREFUSED') prefix = 'Сервер отказал в подключении';
  else if (code === 'ECONNRESET' || code === 'EPIPE') prefix = 'Соединение разорвано сервером';
  else if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    prefix = 'Таймаут соединения';
    withTransport = true;
  } else if (
    code === 'CERT_HAS_EXPIRED' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
  ) prefix = 'Проблема с TLS-сертификатом';
  else if (value.name === 'AbortError' || value.name === 'TimeoutError') {
    prefix = 'Запрос прерван по таймауту';
    withTransport = true;
  } else if (baseMessage === 'fetch failed') {
    return new Error(causeMessage ? `Сетевая ошибка: ${causeMessage}${code ? ` (${code})` : ''} | соединение ${describeTransport()}` : 'Сетевая ошибка: fetch failed');
  }

  if (prefix) {
    const tail = code && !detail.includes(code) ? ` (${code})` : '';
    const transport = withTransport ? ` | соединение ${describeTransport()}` : '';
    return new Error(`${prefix}: ${detail || code || 'нет деталей'}${tail}${transport}`);
  }
  return value;
}

async function requestModelApi(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    signal: AbortSignal;
  },
): Promise<ModelHttpResponse> {
  // Используем глобальный fetch (undici) — он живёт отдельным сетевым стеком и
  // не задевается патчем https.globalAgent, который VS Code расставляет через
  // vscode-proxy-agent. Поэтому запросы в extension host не зависают на TCP.
  if (typeof fetch !== 'function') {
    throw new Error('Глобальный fetch недоступен в этом рантайме (нужен Node 18+).');
  }

  const headers: Record<string, string> = { ...(init.headers || {}) };
  if (headers['Accept'] === undefined && headers['accept'] === undefined) {
    headers['Accept'] = 'application/json';
  }

  const dispatcher = getCachedDispatcher();
  const response = await fetch(url, {
    method: init.method || 'GET',
    headers,
    body: init.body as any,
    signal: init.signal,
    // Кастомный undici-dispatcher: подхватывает HTTPS_PROXY / VS Code http.proxy,
    // увеличивает connect timeout с дефолтных 10с до 30с и отключает строгую
    // TLS-валидацию для самоподписанных корпоративных сертификатов.
    ...(dispatcher ? { dispatcher } : {}),
  } as RequestInit);

  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
    json: () => response.json(),
  };
}

function isTransientError(err: any): boolean {
  if (!err) return false;
  const code = extractCauseCode(err);
  if (code && (code.startsWith('UND_ERR_') || ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE'].includes(code))) {
    return true;
  }
  const msg = String(err.message || err).toLowerCase();
  if (err.name === 'TypeError' && /fetch|network|failed/i.test(msg)) return true;
  if (/socket hang up|network|connect|upstream|bad gateway|service unavailable|gateway timeout/i.test(msg)) return true;
  const status = getErrorStatus(err);
  return status !== undefined && RETRYABLE_STATUS.has(status);
}

function isTimeoutError(err: any, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  return err?.name === 'AbortError' || err?.name === 'TimeoutError';
}

function retryDelay(attempt: number, status?: number, retryUntilSuccess?: boolean): number {
  if (status === 429) return Math.min(5_000 * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
  if (retryUntilSuccess) return RETRY_UNTIL_SUCCESS_DELAY_MS;
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

function buildRequestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return typeof (AbortSignal as any).any === 'function'
    ? (AbortSignal as any).any([signal, timeout])
    : timeout;
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
      const requestSignal = buildRequestSignal(signal, timeoutMs);
      return await run(requestSignal);
    } catch (error: any) {
      lastError = error;
      if (signal?.aborted) throw createAbortMessage();

      const status = getErrorStatus(error);
      const timeout = isTimeoutError(error, signal);
      const retryable = timeout || isTransientError(error) || (status !== undefined && RETRYABLE_STATUS.has(status));
      if (!retryable || (!retryUntilSuccess && attempt >= maxAttempts)) break;

      const delayMs = retryDelay(attempt, status, retryUntilSuccess);
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
  throw normalizeTransportError(lastError);
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
    const response = await requestModelApi(apiBaseUrl, {
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
    const response = await requestModelApi(embeddingsUrl, {
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
    const response = await requestModelApi(rerankUrl, {
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
  // Test Connection: одна попытка, 15 секунд, никаких длинных ретраев.
  try {
    const requestSignal = buildRequestSignal(signal, 15_000);
    const response = await requestModelApi(`${apiBaseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: requestSignal,
    });

    if (!response.ok) {
      throw createHttpError(response.status, await response.text());
    }

    const data: any = await response.json();
    const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return list
      .map((item: any) => item.id || item.name || '')
      .filter((value: string) => typeof value === 'string' && value.length > 0);
  } catch (error: any) {
    if (signal?.aborted) throw createAbortMessage();
    throw normalizeTransportError(error);
  }
}
