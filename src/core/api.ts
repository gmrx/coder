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
    systemPrompt: _state?.get<string>('systemPrompt') || fallback.get<string>('systemPrompt') || '',
    mcpConfigPath: fallback.get<string>('mcpConfigPath') || '',
    mcpServers: fallback.get<Record<string, unknown>>('mcpServers') || {},
    mcpDisabledTools: normalizeMcpDisabledTools(fallback.get<unknown>('mcpDisabledTools') || storedDisabledMcpTools || []),
    mcpTrustedTools: normalizeMcpTrustedTools(fallback.get<unknown>('mcpTrustedTools') || storedTrustedMcpTools || []),
    webTrustedHosts: normalizeHostList(fallback.get<unknown>('webTrustedHosts') || storedTrustedHosts || []),
    webBlockedHosts: normalizeHostList(fallback.get<unknown>('webBlockedHosts') || storedBlockedHosts || []),
    jiraBaseUrl: _state?.get<string>('jiraBaseUrl') || fallback.get<string>('jiraBaseUrl') || '',
    jiraUsername: _state?.get<string>('jiraUsername') || fallback.get<string>('jiraUsername') || '',
    jiraPassword: _state?.get<string>('jiraPassword') || fallback.get<string>('jiraPassword') || '',
    autoApproval: normalizeAutoApproval(configuredAutoApproval || storedAutoApproval || DEFAULT_AUTO_APPROVAL),
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
  if (data.systemPrompt !== undefined) {
    const config = vscode.workspace.getConfiguration('aiAssistant');
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    const normalizedSystemPrompt = String(data.systemPrompt || '').trim();
    try {
      await config.update('systemPrompt', normalizedSystemPrompt || undefined, target);
      await _state.update('systemPrompt', undefined);
    } catch {
      await _state.update('systemPrompt', normalizedSystemPrompt || undefined);
    }
  }
  if (data.autoApproval !== undefined) {
    const config = vscode.workspace.getConfiguration('aiAssistant');
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    const normalizedAutoApproval = normalizeAutoApproval(data.autoApproval);
    try {
      await config.update('autoApproval', normalizedAutoApproval, target);
      await _state.update('autoApproval', undefined);
    } catch {
      await _state.update('autoApproval', normalizedAutoApproval);
    }
  }
  if (data.webTrustedHosts !== undefined) {
    const config = vscode.workspace.getConfiguration('aiAssistant');
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    const normalizedTrustedHosts = normalizeHostList(data.webTrustedHosts);
    try {
      await config.update('webTrustedHosts', normalizedTrustedHosts, target);
      await _state.update('webTrustedHosts', undefined);
    } catch {
      await _state.update('webTrustedHosts', normalizedTrustedHosts);
    }
  }
  if (data.webBlockedHosts !== undefined) {
    const config = vscode.workspace.getConfiguration('aiAssistant');
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    const normalizedBlockedHosts = normalizeHostList(data.webBlockedHosts);
    try {
      await config.update('webBlockedHosts', normalizedBlockedHosts, target);
      await _state.update('webBlockedHosts', undefined);
    } catch {
      await _state.update('webBlockedHosts', normalizedBlockedHosts);
    }
  }
  if (data.mcpDisabledTools !== undefined) {
    const config = vscode.workspace.getConfiguration('aiAssistant');
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    const normalizedDisabledTools = normalizeMcpDisabledTools(data.mcpDisabledTools);
    try {
      await config.update('mcpDisabledTools', normalizedDisabledTools, target);
      await _state.update('mcpDisabledTools', undefined);
    } catch {
      await _state.update('mcpDisabledTools', normalizedDisabledTools);
    }
  }
  if (data.mcpTrustedTools !== undefined) {
    const config = vscode.workspace.getConfiguration('aiAssistant');
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    const normalizedTrustedTools = normalizeMcpTrustedTools(data.mcpTrustedTools);
    try {
      await config.update('mcpTrustedTools', normalizedTrustedTools, target);
      await _state.update('mcpTrustedTools', undefined);
    } catch {
      await _state.update('mcpTrustedTools', normalizedTrustedTools);
    }
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
