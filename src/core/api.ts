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

export async function fetchModelsList(apiBaseUrl: string, apiKey: string): Promise<string[]> {
  const resp = await fetch(getApiRootUrl(apiBaseUrl) + '/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!resp.ok) return [];
  const data: any = await resp.json();
  const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return arr.map((m: any) => m.id || m.name || '').filter((x: string) => typeof x === 'string' && x.length > 0);
}

export async function sendChatRequest(
  apiBaseUrl: string, apiKey: string, model: string, messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<string> {
  const body: Record<string, any> = { model, messages };
  if (opts?.temperature !== undefined) body.temperature = opts.temperature;
  if (opts?.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  const maxAttempts = 2;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      const json = (await response.json()) as any;
      return json.choices?.[0]?.message?.content || json.choices?.[0]?.delta?.content || JSON.stringify(json, null, 2);
    } catch (err: any) {
      lastError = err;
      const isAbort = err?.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('aborted');
      if (!isAbort || attempt >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function sendEmbeddingsRequest(
  apiBaseUrl: string, apiKey: string, model: string, input: string[]
): Promise<number[][]> {
  const resp = await fetch(getApiRootUrl(apiBaseUrl) + '/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input })
  });
  if (!resp.ok) throw new Error(`Embeddings HTTP ${resp.status}`);
  const json: any = await resp.json();
  const data = json?.data || json;
  if (!Array.isArray(data)) throw new Error('Invalid embeddings response');
  return data.map((d: any) => d.embedding || d);
}
