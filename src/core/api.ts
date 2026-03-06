import * as vscode from 'vscode';
import { AssistantConfig, ChatMessage } from './types';

let _state: vscode.Memento | undefined;

export function initConfigStorage(globalState: vscode.Memento) {
  _state = globalState;
}

export function readConfig(): AssistantConfig {
  const fallback = vscode.workspace.getConfiguration('aiAssistant');
  return {
    apiBaseUrl: _state?.get<string>('apiBaseUrl') || fallback.get<string>('apiBaseUrl') || '',
    apiKey: _state?.get<string>('apiKey') || fallback.get<string>('apiKey') || '',
    model: _state?.get<string>('model') || fallback.get<string>('model') || '',
    embeddingsModel: _state?.get<string>('embeddingsModel') || '',
    rerankModel: _state?.get<string>('rerankModel') || ''
  };
}

export async function saveConfig(data: Partial<AssistantConfig>): Promise<void> {
  if (!_state) throw new Error('Config storage not initialized.');
  if (data.apiBaseUrl !== undefined) await _state.update('apiBaseUrl', data.apiBaseUrl || undefined);
  if (data.apiKey !== undefined) await _state.update('apiKey', data.apiKey || undefined);
  if (data.model !== undefined) await _state.update('model', data.model || undefined);
  if (data.embeddingsModel !== undefined) await _state.update('embeddingsModel', data.embeddingsModel || undefined);
  if (data.rerankModel !== undefined) await _state.update('rerankModel', data.rerankModel || undefined);
}

export function getApiRootUrl(apiBaseUrl: string): string {
  let root = apiBaseUrl;
  const suffix = '/v1/chat/completions';
  if (root.endsWith(suffix)) root = root.slice(0, -suffix.length);
  return root.replace(/\/+$/, '');
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 30_000;

function isTransientError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err).toLowerCase();
  if (err.name === 'TypeError' && /fetch|network|failed/i.test(msg)) return true;
  if (/econnreset|econnrefused|enotfound|etimedout|epipe|socket hang up/i.test(msg)) return true;
  if (/network|connect|upstream|bad gateway|service unavailable|gateway timeout/i.test(msg)) return true;
  const statusMatch = msg.match(/\bhttp\s+(\d{3})\b/);
  if (statusMatch && RETRYABLE_STATUS.has(Number(statusMatch[1]))) return true;
  return false;
}

function isUserAbort(err: any, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (err?.name === 'AbortError') return false;
  return false;
}

function retryDelay(attempt: number, status?: number): number {
  if (status === 429) return Math.min(5_000 * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
  return Math.min(1_500 * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
}

async function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(false); }, { once: true });
  });
}

export async function fetchModelsList(apiBaseUrl: string, apiKey: string): Promise<string[]> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(getApiRootUrl(apiBaseUrl) + '/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20_000)
      });
      if (!resp.ok) {
        if (RETRYABLE_STATUS.has(resp.status) && attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, retryDelay(attempt, resp.status)));
          continue;
        }
        return [];
      }
      const data: any = await resp.json();
      const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      return arr.map((m: any) => m.id || m.name || '').filter((x: string) => typeof x === 'string' && x.length > 0);
    } catch (err: any) {
      if (attempt >= maxAttempts || !isTransientError(err)) return [];
      await new Promise(r => setTimeout(r, retryDelay(attempt)));
    }
  }
  return [];
}

export async function sendChatRequest(
  apiBaseUrl: string, apiKey: string, model: string, messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<string> {
  const body: Record<string, any> = { model, messages };
  if (opts?.temperature !== undefined) body.temperature = opts.temperature;
  if (opts?.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts?.signal?.aborted) throw new Error('⛔ Задача остановлена пользователем.');

    try {
      const timeoutSignal = AbortSignal.timeout(180_000);
      const signal = opts?.signal
        ? AbortSignal.any([opts.signal, timeoutSignal])
        : timeoutSignal;

      const response = await fetch(apiBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal
      });

      if (!response.ok) {
        const text = await response.text();
        const err = new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
        if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
          const delay = retryDelay(attempt, response.status);
          console.warn(`[AI-Assistant] API ${response.status}, retry ${attempt}/${maxAttempts} in ${delay}ms`);
          const ok = await sleepUnlessAborted(delay, opts?.signal);
          if (!ok) throw new Error('⛔ Задача остановлена пользователем.');
          lastError = err;
          continue;
        }
        throw err;
      }

      const json = (await response.json()) as any;
      return json.choices?.[0]?.message?.content || json.choices?.[0]?.delta?.content || JSON.stringify(json, null, 2);
    } catch (err: any) {
      lastError = err;

      if (isUserAbort(err, opts?.signal)) {
        throw new Error('⛔ Задача остановлена пользователем.');
      }

      if (isTransientError(err) && attempt < maxAttempts) {
        const delay = retryDelay(attempt);
        console.warn(`[AI-Assistant] Transient error, retry ${attempt}/${maxAttempts} in ${delay}ms: ${err?.message}`);
        const ok = await sleepUnlessAborted(delay, opts?.signal);
        if (!ok) throw new Error('⛔ Задача остановлена пользователем.');
        continue;
      }

      if (err?.name === 'AbortError' && !opts?.signal?.aborted && attempt < maxAttempts) {
        const delay = retryDelay(attempt);
        console.warn(`[AI-Assistant] Timeout, retry ${attempt}/${maxAttempts} in ${delay}ms`);
        const ok = await sleepUnlessAborted(delay, opts?.signal);
        if (!ok) throw new Error('⛔ Задача остановлена пользователем.');
        continue;
      }

      break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function sendEmbeddingsRequest(
  apiBaseUrl: string, apiKey: string, model: string, input: string[],
  signal?: AbortSignal
): Promise<number[][]> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('⛔ Задача остановлена пользователем.');

    try {
      const fetchSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000);

      const resp = await fetch(getApiRootUrl(apiBaseUrl) + '/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input }),
        signal: fetchSignal
      });

      if (!resp.ok) {
        const err = new Error(`Embeddings HTTP ${resp.status}`);
        if (RETRYABLE_STATUS.has(resp.status) && attempt < maxAttempts) {
          await sleepUnlessAborted(retryDelay(attempt, resp.status), signal);
          lastError = err;
          continue;
        }
        throw err;
      }

      const json: any = await resp.json();
      const data = json?.data || json;
      if (!Array.isArray(data)) throw new Error('Invalid embeddings response');
      return data.map((d: any) => d.embedding || d);
    } catch (err: any) {
      lastError = err;
      if (isUserAbort(err, signal)) throw new Error('⛔ Задача остановлена пользователем.');
      if (isTransientError(err) && attempt < maxAttempts) {
        await sleepUnlessAborted(retryDelay(attempt), signal);
        continue;
      }
      break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
