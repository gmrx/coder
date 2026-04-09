import { fetchModelsList, sendEmbeddingsRequest, sendRerankRequest } from '../core/api';
import { normalizeMcpDisabledTools, normalizeMcpTrustedTools } from '../core/mcpToolAvailability';
import type { AssistantAutoApprovalConfig, AssistantConfig } from '../core/types';
import { sendChatProbe } from './chatPrompt';

export interface SettingsPayload extends Partial<AssistantConfig> {}

export type ModelTestKind = 'chat' | 'embeddings' | 'rerank';
export type ModelTestState = 'idle' | 'pending' | 'passed' | 'failed' | 'skipped';

export interface ModelTestResult {
  kind: ModelTestKind;
  label: string;
  model: string;
  state: ModelTestState;
  request: string;
  response: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  error: string;
  models: string[];
  modelsCount: number;
}

export async function loadAvailableModels(data: SettingsPayload): Promise<string[]> {
  if (!data.apiBaseUrl || !data.apiKey) {
    return [];
  }

  try {
    return await fetchModelsList(data.apiBaseUrl, data.apiKey);
  } catch {
    return [];
  }
}

export async function testSettingsConnection(data: SettingsPayload): Promise<ConnectionTestResult> {
  if (!data.apiBaseUrl || !data.apiKey) {
    return {
      ok: false,
      error: 'Укажите URL и ключ API',
      models: [],
      modelsCount: 0,
    };
  }

  try {
    const models = await fetchModelsList(data.apiBaseUrl, data.apiKey);
    const ok = models.length > 0;
    return {
      ok,
      error: ok ? '' : 'Не удалось загрузить список моделей.',
      models,
      modelsCount: models.length,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message || String(error),
      models: [],
      modelsCount: 0,
    };
  }
}

export async function runSelectedModelTests(data: SettingsPayload): Promise<ModelTestResult[]> {
  return [
    await runChatModelTest(data),
    await runRerankModelTest(data),
    await runEmbeddingsModelTest(data),
  ];
}

export function buildSkippedModelTests(data: SettingsPayload, reason: string): ModelTestResult[] {
  return [
    createSkippedTest('chat', 'Чат', 'Скажи привет.', reason, (data.model || '').trim()),
    createSkippedTest('rerank', 'Rerank', 'query="test ranking" + 2 sample documents', reason, (data.rerankModel || '').trim()),
    createSkippedTest('embeddings', 'Эмбеддинги', 'input: ["test embedding probe"]', reason, (data.embeddingsModel || '').trim()),
  ];
}

export function normalizeSettingsPayload(data: SettingsPayload): AssistantConfig {
  return {
    apiBaseUrl: data.apiBaseUrl || '',
    apiKey: data.apiKey || '',
    model: data.model || '',
    embeddingsModel: data.embeddingsModel || '',
    rerankModel: data.rerankModel || '',
    systemPrompt: String(data.systemPrompt || '').trim(),
    mcpConfigPath: (data.mcpConfigPath || '').trim(),
    mcpServers: normalizeMcpServers(data.mcpServers),
    mcpDisabledTools: normalizeMcpDisabledTools(data.mcpDisabledTools),
    mcpTrustedTools: normalizeMcpTrustedTools(data.mcpTrustedTools),
    webTrustedHosts: normalizeHostList(data.webTrustedHosts),
    webBlockedHosts: normalizeHostList(data.webBlockedHosts),
    autoApproval: normalizeAutoApproval(data.autoApproval),
  };
}

function normalizeMcpServers(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
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

async function runChatModelTest(data: SettingsPayload): Promise<ModelTestResult> {
  const model = (data.model || '').trim();
  const request = 'Скажи привет.';
  if (!model) {
    return createSkippedTest('chat', 'Чат', request, 'Чат-модель не выбрана.');
  }

  try {
    const response = await sendChatProbe(data.apiBaseUrl || '', data.apiKey || '', model, request);
    return {
      kind: 'chat',
      label: 'Чат',
      model,
      state: 'passed',
      request,
      response: (response || '').trim() || 'Пустой ответ без текста.',
    };
  } catch (error: any) {
    return createFailedTest('chat', 'Чат', model, request, error);
  }
}

async function runEmbeddingsModelTest(data: SettingsPayload): Promise<ModelTestResult> {
  const model = (data.embeddingsModel || '').trim();
  const request = 'input: ["test embedding probe"]';
  if (!model) {
    return createSkippedTest('embeddings', 'Эмбеддинги', request, 'Модель эмбеддингов не выбрана.');
  }

  try {
    const vectors = await sendEmbeddingsRequest(
      data.apiBaseUrl || '',
      data.apiKey || '',
      model,
      ['test embedding probe'],
    );
    const dimension = Array.isArray(vectors[0]) ? vectors[0].length : 0;

    return {
      kind: 'embeddings',
      label: 'Эмбеддинги',
      model,
      state: 'passed',
      request,
      response: `Получен embedding: ${vectors.length} вектор(ов), размерность=${dimension}.`,
    };
  } catch (error: any) {
    return createFailedTest('embeddings', 'Эмбеддинги', model, request, error);
  }
}

async function runRerankModelTest(data: SettingsPayload): Promise<ModelTestResult> {
  const model = (data.rerankModel || '').trim();
  const request = 'query="test ranking" + 2 sample documents';
  if (!model) {
    return createSkippedTest('rerank', 'Rerank', request, 'Rerank-модель не выбрана.');
  }

  try {
    const results = await sendRerankRequest(
      data.apiBaseUrl || '',
      data.apiKey || '',
      model,
      'test ranking',
      [
        'Document A: test ranking phrase appears here.',
        'Document B: unrelated example text.',
      ],
      { topN: 2 },
    );

    const details = results.length
      ? results
        .slice(0, 2)
        .map((result) => `#${result.index} score=${(result.relevanceScore ?? result.score ?? 0).toFixed(3)}`)
        .join(', ')
      : 'Сервис ответил, но не вернул результатов.';

    return {
      kind: 'rerank',
      label: 'Rerank',
      model,
      state: 'passed',
      request,
      response: details,
    };
  } catch (error: any) {
    return createFailedTest('rerank', 'Rerank', model, request, error);
  }
}

function createSkippedTest(
  kind: ModelTestKind,
  label: string,
  request: string,
  response: string,
  model = '',
): ModelTestResult {
  return {
    kind,
    label,
    model,
    state: 'skipped',
    request,
    response,
  };
}

function createFailedTest(
  kind: ModelTestKind,
  label: string,
  model: string,
  request: string,
  error: any,
): ModelTestResult {
  return {
    kind,
    label,
    model,
    state: 'failed',
    request,
    response: error?.message || String(error),
  };
}
