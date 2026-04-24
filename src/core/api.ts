import * as vscode from 'vscode';
import { AssistantAutoApprovalConfig, AssistantConfig, ChatMessage } from './types';
import { normalizeMcpDisabledTools, normalizeMcpTrustedTools } from './mcpToolAvailability';
import { fetchModels, type ChatCompletionOptions, type ModelRequestOptions, type RerankOptions, sendChatCompletion, sendEmbeddings, sendRerank } from './modelClient';

let _state: vscode.Memento | undefined;

const DEFAULT_AUTO_APPROVAL: AssistantAutoApprovalConfig = {
  fileCreate: true,
  fileEdit: true,
  fileDelete: true,
  webFetch: false,
  shell: false,
  worktree: false,
  mcp: false,
};

function normalizeHostList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const host = String(item || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '');
    if (!host || seen.has(host)) continue;
    seen.add(host);
    normalized.push(host);
  }
  return normalized;
}

function normalizeAutoApproval(value: unknown): AssistantAutoApprovalConfig {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AssistantAutoApprovalConfig>
    : {};
  return {
    fileCreate: source.fileCreate !== false,
    fileEdit: source.fileEdit !== false,
    fileDelete: source.fileDelete !== false,
    webFetch: source.webFetch === true,
    shell: source.shell === true,
    worktree: source.worktree === true,
    mcp: source.mcp === true,
  };
}

export function initConfigStorage(globalState: vscode.Memento) {
  _state = globalState;
}

export function readConfig(): AssistantConfig {
  const fallback = vscode.workspace.getConfiguration('aiAssistant');
  const storedAutoApproval = _state?.get<Partial<AssistantAutoApprovalConfig>>('autoApproval');
  const storedSystemPrompt = _state?.get<string>('systemPrompt');
  const storedMcpConfigPath = _state?.get<string>('mcpConfigPath');
  const storedMcpServers = _state?.get<Record<string, unknown>>('mcpServers');
  const configuredAutoApproval = fallback.get<Partial<AssistantAutoApprovalConfig>>('autoApproval');
  const storedTrustedHosts = _state?.get<unknown>('webTrustedHosts');
  const storedBlockedHosts = _state?.get<unknown>('webBlockedHosts');
  const storedDisabledMcpTools = _state?.get<unknown>('mcpDisabledTools');
  const storedTrustedMcpTools = _state?.get<unknown>('mcpTrustedTools');
  return {
    apiBaseUrl: _state?.get<string>('apiBaseUrl') || fallback.get<string>('apiBaseUrl') || '',
    apiKey: _state?.get<string>('apiKey') || fallback.get<string>('apiKey') || '',
    model: _state?.get<string>('model') || fallback.get<string>('model') || '',
    embeddingsModel: _state?.get<string>('embeddingsModel') || '',
    rerankModel: _state?.get<string>('rerankModel') || '',
    systemPrompt: storedSystemPrompt ?? fallback.get<string>('systemPrompt') ?? '',
    mcpConfigPath: storedMcpConfigPath ?? fallback.get<string>('mcpConfigPath') ?? '',
    mcpServers: storedMcpServers ?? fallback.get<Record<string, unknown>>('mcpServers') ?? {},
    mcpDisabledTools: normalizeMcpDisabledTools(storedDisabledMcpTools ?? fallback.get<unknown>('mcpDisabledTools') ?? []),
    mcpTrustedTools: normalizeMcpTrustedTools(storedTrustedMcpTools ?? fallback.get<unknown>('mcpTrustedTools') ?? []),
    webTrustedHosts: normalizeHostList(storedTrustedHosts ?? fallback.get<unknown>('webTrustedHosts') ?? []),
    webBlockedHosts: normalizeHostList(storedBlockedHosts ?? fallback.get<unknown>('webBlockedHosts') ?? []),
    jiraBaseUrl: _state?.get<string>('jiraBaseUrl') || fallback.get<string>('jiraBaseUrl') || '',
    jiraUsername: _state?.get<string>('jiraUsername') || fallback.get<string>('jiraUsername') || '',
    jiraPassword: _state?.get<string>('jiraPassword') || fallback.get<string>('jiraPassword') || '',
    tfsBaseUrl: _state?.get<string>('tfsBaseUrl') || fallback.get<string>('tfsBaseUrl') || '',
    tfsCollection: _state?.get<string>('tfsCollection') || fallback.get<string>('tfsCollection') || '',
    tfsUsername: _state?.get<string>('tfsUsername') || fallback.get<string>('tfsUsername') || '',
    tfsPassword: _state?.get<string>('tfsPassword') || fallback.get<string>('tfsPassword') || '',
    autoApproval: normalizeAutoApproval(storedAutoApproval ?? configuredAutoApproval ?? DEFAULT_AUTO_APPROVAL),
  };
}

export async function saveConfig(data: Partial<AssistantConfig>): Promise<void> {
  if (!_state) throw new Error('Config storage not initialized.');
  if (data.apiBaseUrl !== undefined) await _state.update('apiBaseUrl', data.apiBaseUrl || undefined);
  if (data.apiKey !== undefined) await _state.update('apiKey', data.apiKey || undefined);
  if (data.model !== undefined) await _state.update('model', data.model || undefined);
  if (data.embeddingsModel !== undefined) await _state.update('embeddingsModel', data.embeddingsModel || undefined);
  if (data.rerankModel !== undefined) await _state.update('rerankModel', data.rerankModel || undefined);
  if (data.jiraBaseUrl !== undefined) await _state.update('jiraBaseUrl', data.jiraBaseUrl || undefined);
  if (data.jiraUsername !== undefined) await _state.update('jiraUsername', data.jiraUsername || undefined);
  if (data.jiraPassword !== undefined) await _state.update('jiraPassword', data.jiraPassword || undefined);
  if (data.tfsBaseUrl !== undefined) await _state.update('tfsBaseUrl', data.tfsBaseUrl || undefined);
  if (data.tfsCollection !== undefined) await _state.update('tfsCollection', data.tfsCollection || undefined);
  if (data.tfsUsername !== undefined) await _state.update('tfsUsername', data.tfsUsername || undefined);
  if (data.tfsPassword !== undefined) await _state.update('tfsPassword', data.tfsPassword || undefined);
  if (data.systemPrompt !== undefined) await _state.update('systemPrompt', String(data.systemPrompt || '').trim());
  if (data.autoApproval !== undefined) {
    const normalizedAutoApproval = normalizeAutoApproval(data.autoApproval);
    await _state.update('autoApproval', normalizedAutoApproval);
  }
  if (data.webTrustedHosts !== undefined) {
    const normalizedTrustedHosts = normalizeHostList(data.webTrustedHosts);
    await _state.update('webTrustedHosts', normalizedTrustedHosts);
  }
  if (data.webBlockedHosts !== undefined) {
    const normalizedBlockedHosts = normalizeHostList(data.webBlockedHosts);
    await _state.update('webBlockedHosts', normalizedBlockedHosts);
  }
  if (data.mcpDisabledTools !== undefined) {
    const normalizedDisabledTools = normalizeMcpDisabledTools(data.mcpDisabledTools);
    await _state.update('mcpDisabledTools', normalizedDisabledTools);
  }
  if (data.mcpTrustedTools !== undefined) {
    const normalizedTrustedTools = normalizeMcpTrustedTools(data.mcpTrustedTools);
    await _state.update('mcpTrustedTools', normalizedTrustedTools);
  }
  if (data.mcpConfigPath !== undefined) await _state.update('mcpConfigPath', String(data.mcpConfigPath || '').trim());
  if (data.mcpServers !== undefined) {
    const normalizedServers = data.mcpServers && typeof data.mcpServers === 'object' && !Array.isArray(data.mcpServers)
      ? data.mcpServers
      : {};
    await _state.update('mcpServers', normalizedServers);
  }
}

export function getApiRootUrl(apiBaseUrl: string): string {
  let root = apiBaseUrl;
  const suffix = '/v1/chat/completions';
  if (root.endsWith(suffix)) root = root.slice(0, -suffix.length);
  return root.replace(/\/+$/, '');
}

export async function fetchModelsList(apiBaseUrl: string, apiKey: string): Promise<string[]> {
  return fetchModels(getApiRootUrl(apiBaseUrl), apiKey);
}

export async function sendChatRequest(
  apiBaseUrl: string, apiKey: string, model: string, messages: ChatMessage[],
  opts?: ChatCompletionOptions
): Promise<string> {
  return sendChatCompletion(apiBaseUrl, apiKey, model, messages, opts);
}

export async function sendEmbeddingsRequest(
  apiBaseUrl: string, apiKey: string, model: string, input: string[],
  opts?: AbortSignal | ModelRequestOptions
): Promise<number[][]> {
  const requestOptions = opts instanceof AbortSignal ? { signal: opts } : opts;
  return sendEmbeddings(`${getApiRootUrl(apiBaseUrl)}/v1/embeddings`, apiKey, model, input, requestOptions);
}

export async function sendRerankRequest(
  apiBaseUrl: string,
  apiKey: string,
  model: string,
  query: string,
  documents: string[],
  opts?: RerankOptions,
) {
  return sendRerank(`${getApiRootUrl(apiBaseUrl)}/v1/rerank`, apiKey, model, query, documents, opts);
}
