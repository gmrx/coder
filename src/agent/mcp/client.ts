import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as vscode from 'vscode';
import { truncate } from '../../core/utils';
import {
  getMcpAuthorizationHeader,
  McpAuthRequiredError,
  refreshMcpAccessToken,
} from './auth';
import {
  buildMcpConfigHelpText,
  loadMcpServerRegistry,
} from './config';
import type {
  McpCallToolResult,
  McpListToolsResult,
  McpResolvedHttpServerConfig,
  McpListResourcesResult,
  McpReadResourceContent,
  McpReadResourceResult,
  McpResolvedServerConfig,
  McpServerCapabilities,
  McpResolvedStdioServerConfig,
  McpResourceDescriptor,
  McpServerSupportNote,
  McpServerRegistry,
  McpToolCallContentPart,
  McpToolDescriptor,
} from './types';

const CLIENT_NAME = 'CursorCoderVSCode';
const CLIENT_VERSION = '0.0.178';
const MCP_PROTOCOL_VERSION = '2024-11-05';
const REQUEST_TIMEOUT_MS = 30_000;

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
};

type InitializeResult = {
  protocolVersion?: string;
  capabilities?: McpServerCapabilities;
  serverInfo?: {
    name?: string;
    version?: string;
  };
};

type McpClientTransport = {
  initialize(): Promise<InitializeResult>;
  request<TResult>(method: string, params?: unknown): Promise<TResult>;
  notify(method: string, params?: unknown): Promise<void>;
  getCapabilities(): McpServerCapabilities | undefined;
  dispose(): Promise<void>;
};

const CLIENT_CACHE = new Map<string, Promise<McpClientTransport>>();

function buildCacheKey(config: McpResolvedServerConfig): string {
  return `${config.name}:${config.sourceKind}:${config.sourceLabel}:${JSON.stringify(config)}`;
}

function buildTimeoutError(serverName: string, method: string): Error {
  return new Error(`MCP сервер "${serverName}" не ответил на ${method} за ${Math.round(REQUEST_TIMEOUT_MS / 1000)}с.`);
}

function normalizeRpcError(error: JsonRpcMessage['error']): Error {
  if (!error) return new Error('MCP сервер вернул неизвестную ошибку.');
  const code = typeof error.code === 'number' ? ` [${error.code}]` : '';
  return new Error(`${String(error.message || 'MCP error')}${code}`);
}

class McpSessionExpiredError extends Error {
  constructor(serverName: string) {
    super(`MCP сервер "${serverName}" сообщил, что HTTP-сессия устарела. Переподключаюсь.`);
    this.name = 'McpSessionExpiredError';
  }
}

function isSessionExpiredHttpResponse(status: number, body: string): boolean {
  if (status !== 404) return false;
  const value = String(body || '').toLowerCase();
  return value.includes('"code":-32001') || value.includes('"code": -32001') || value.includes('session not found');
}

function isServerNotInitializedResponse(status: number, body: string): boolean {
  if (status !== 400) return false;
  const value = String(body || '').toLowerCase();
  return value.includes('server not initialized');
}

function formatHttpErrorMessage(serverName: string, status: number, body: string): string {
  const suffix = String(body || '').trim();
  return suffix
    ? `HTTP ${status} при обращении к MCP серверу "${serverName}": ${truncate(suffix.replace(/\s+/g, ' '), 320)}`
    : `HTTP ${status} при обращении к MCP серверу "${serverName}"`;
}

function isRetryableMcpError(error: unknown): boolean {
  if (error instanceof McpSessionExpiredError) return true;
  const message = String((error as { message?: unknown })?.message || error || '').toLowerCase();
  return [
    'fetch failed',
    'econnrefused',
    'econnreset',
    'socket hang up',
    'timed out',
    'не ответил',
    'session expired',
    'session not found',
    'некорректный json-rpc ответ',
    'unexpected end of json input',
    'http 404',
    'http 502',
    'http 503',
    'http 504',
    'server not initialized',
  ].some((needle) => message.includes(needle));
}

async function withClientRecovery<T>(
  config: McpResolvedServerConfig,
  operation: (client: McpClientTransport) => Promise<T>,
): Promise<T> {
  try {
    return await operation(await getClient(config));
  } catch (error) {
    if (!isRetryableMcpError(error)) throw error;
    await clearMcpClientCache(config.name);
    return operation(await getClient(config));
  }
}

function withTimeout<T>(promise: Promise<T>, serverName: string, method: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(buildTimeoutError(serverName, method)), REQUEST_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function buildClientRequest(id: number, method: string, params?: unknown): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  };
}

function buildClientNotification(method: string, params?: unknown): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    method,
    ...(params !== undefined ? { params } : {}),
  };
}

function buildRootsListResult(): { roots: Array<{ uri: string; name: string }> } {
  const roots = (vscode.workspace.workspaceFolders || []).map((folder) => ({
    uri: folder.uri.toString(),
    name: folder.name,
  }));
  return { roots };
}

async function persistBinaryContent(
  serverName: string,
  uri: string,
  mimeType: string | undefined,
  blob: string,
): Promise<McpReadResourceContent> {
  const bytes = Buffer.from(blob, 'base64');
  const resourceDir = path.join(os.tmpdir(), 'cursorcoder-mcp-resources');
  await fs.mkdir(resourceDir, { recursive: true });

  const ext = guessExtensionFromMimeType(mimeType);
  const safeServer = serverName.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const safeUri = uri.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase().slice(0, 40) || 'resource';
  const filePath = path.join(
    resourceDir,
    `${safeServer}-${safeUri}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`,
  );
  await fs.writeFile(filePath, bytes);

  return {
    uri,
    ...(mimeType ? { mimeType } : {}),
    blobSavedTo: filePath,
    size: bytes.length,
    text: truncate(
      `Бинарный ресурс сохранён на диск: ${filePath}\nMIME: ${mimeType || 'unknown'}\nРазмер: ${formatBytes(bytes.length)}`,
      2000,
    ),
  };
}

function guessExtensionFromMimeType(mimeType?: string): string {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('json')) return '.json';
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  if (normalized.includes('svg')) return '.svg';
  if (normalized.includes('pdf')) return '.pdf';
  if (normalized.includes('html')) return '.html';
  if (normalized.includes('xml')) return '.xml';
  if (normalized.includes('markdown')) return '.md';
  if (normalized.includes('plain') || normalized.startsWith('text/')) return '.txt';
  return '.bin';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

class StdioMcpClient implements McpClientTransport {
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly serverName: string;
  private nextId = 1;
  private buffer = '';
  private disposed = false;
  private initialized = false;
  private initializePromise: Promise<InitializeResult> | null = null;
  private capabilities: McpServerCapabilities | undefined;

  constructor(private readonly config: McpResolvedStdioServerConfig) {
    this.serverName = config.name;
    this.process = spawn(config.command, config.args || [], {
      cwd: config.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env: { ...process.env, ...(config.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', () => {
      // stderr is intentionally ignored here; it remains visible in server logs if needed.
    });
    this.process.once('error', (error) => {
      this.rejectAll(new Error(`MCP сервер "${this.serverName}" не запустился: ${error.message}`));
    });
    this.process.once('exit', (code, signal) => {
      if (this.disposed) return;
      const suffix = code !== null ? `код ${code}` : `signal ${signal || 'unknown'}`;
      this.rejectAll(new Error(`MCP сервер "${this.serverName}" завершился (${suffix}).`));
    });
  }

  async initialize(): Promise<InitializeResult> {
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = (async () => {
      const response = await this.request<InitializeResult>('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          roots: {
            listChanged: false,
          },
        },
        clientInfo: {
          name: CLIENT_NAME,
          version: CLIENT_VERSION,
        },
      });
      await this.notify('notifications/initialized');
      this.initialized = true;
      this.capabilities = response?.capabilities;
      return response;
    })();
    return this.initializePromise;
  }

  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    if (this.disposed) throw new Error(`MCP сервер "${this.serverName}" уже закрыт.`);

    const id = this.nextId++;
    const request = buildClientRequest(id, method, params);
    const responsePromise = withTimeout(
      new Promise<TResult>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
      }),
      this.serverName,
      method,
    );

    this.writeMessage(request);
    return responsePromise;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.disposed) return;
    this.writeMessage(buildClientNotification(method, params));
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.rejectAll(new Error(`MCP сервер "${this.serverName}" закрыт.`));
    if (!this.process.killed) {
      this.process.kill();
    }
  }

  getCapabilities(): McpServerCapabilities | undefined {
    return this.capabilities;
  }

  private writeMessage(message: JsonRpcMessage): void {
    const payload = JSON.stringify(message);
    this.process.stdin.write(`${payload}\n`);
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const rawLine = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (rawLine) {
        this.handleMessage(rawLine);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleMessage(rawLine: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(rawLine);
    } catch {
      return;
    }

    if (message.id !== undefined && this.pending.has(Number(message.id))) {
      const pending = this.pending.get(Number(message.id));
      this.pending.delete(Number(message.id));
      if (!pending) return;
      if (message.error) {
        pending.reject(normalizeRpcError(message.error));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (message.method && message.id !== undefined) {
      this.respondToServerRequest(message).catch(() => {});
    }
  }

  private async respondToServerRequest(message: JsonRpcMessage): Promise<void> {
    const id = Number(message.id);
    if (message.method === 'ping') {
      this.writeMessage({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    if (message.method === 'roots/list') {
      this.writeMessage({ jsonrpc: '2.0', id, result: buildRootsListResult() });
      return;
    }
    this.writeMessage({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not supported by client: ${String(message.method)}`,
      },
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

class HttpMcpClient implements McpClientTransport {
  private nextId = 1;
  private initialized = false;
  private initializePromise: Promise<InitializeResult> | null = null;
  private sessionId = '';
  private negotiatedProtocolVersion = MCP_PROTOCOL_VERSION;
  private capabilities: McpServerCapabilities | undefined;

  constructor(private readonly config: McpResolvedHttpServerConfig) {}

  async initialize(): Promise<InitializeResult> {
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = (async () => {
      const response = await this.requestInternal<InitializeResult>('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          roots: {
            listChanged: false,
          },
        },
        clientInfo: {
          name: CLIENT_NAME,
          version: CLIENT_VERSION,
        },
      }, false);
      this.negotiatedProtocolVersion = String(response?.protocolVersion || MCP_PROTOCOL_VERSION);
      this.initialized = true;
      this.capabilities = response?.capabilities;
      await this.notify('notifications/initialized');
      return response;
    })();
    return this.initializePromise;
  }

  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    return this.requestInternal<TResult>(method, params, this.initialized);
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.requestInternal<void>(method, params, this.initialized, true);
  }

  async dispose(): Promise<void> {
    this.sessionId = '';
  }

  getCapabilities(): McpServerCapabilities | undefined {
    return this.capabilities;
  }

  private async requestInternal<TResult>(
    method: string,
    params: unknown,
    includeNegotiatedHeaders: boolean,
    isNotification = false,
    authRetryAttempted = false,
  ): Promise<TResult> {
    const id = this.nextId++;
    const payload = isNotification
      ? buildClientNotification(method, params)
      : buildClientRequest(id, method, params);
    const headers = new Headers({
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(this.config.headers || {}),
    });
    const authHeaders = await getMcpAuthorizationHeader(this.config);
    for (const [key, value] of Object.entries(authHeaders)) {
      headers.set(key, value);
    }
    if (includeNegotiatedHeaders) {
      headers.set('MCP-Protocol-Version', this.negotiatedProtocolVersion);
    }
    if (this.sessionId) {
      headers.set('Mcp-Session-Id', this.sessionId);
    }

    const response = await withTimeout(fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }), this.config.name, method);

    const sessionId = response.headers.get('Mcp-Session-Id');
    if (sessionId) this.sessionId = sessionId;
    if (response.status === 401 && this.config.oauth) {
      const refreshed = !authRetryAttempted
        ? await refreshMcpAccessToken(this.config).catch(() => false)
        : false;
      if (refreshed) {
        return this.requestInternal<TResult>(method, params, includeNegotiatedHeaders, isNotification, true);
      }
      throw new McpAuthRequiredError(
        this.config.name,
        'Вызов MCP сервера вернул 401. Сначала пройди mcp_auth для этого сервера.',
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (isSessionExpiredHttpResponse(response.status, body) || isServerNotInitializedResponse(response.status, body)) {
        this.sessionId = '';
        this.initialized = false;
        this.initializePromise = null;
        throw new McpSessionExpiredError(this.config.name);
      }
      throw new Error(formatHttpErrorMessage(this.config.name, response.status, body));
    }

    if (isNotification || response.status === 202 || response.status === 204) {
      return undefined as TResult;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      const rpc = parseSseJsonRpcResponse(text, id);
      if (rpc.error) throw normalizeRpcError(rpc.error);
      return rpc.result as TResult;
    }

    let rpc: JsonRpcMessage;
    try {
      rpc = await response.json() as JsonRpcMessage;
    } catch (error: any) {
      throw new Error(`MCP сервер "${this.config.name}" вернул некорректный JSON-RPC ответ: ${error?.message || error}`);
    }
    if (rpc.error) throw normalizeRpcError(rpc.error);
    return rpc.result as TResult;
  }
}

function parseSseJsonRpcResponse(streamText: string, requestId: number): JsonRpcMessage {
  const events = String(streamText || '').split(/\n\n+/);
  for (const eventBlock of events) {
    const dataLines = eventBlock
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s?/, ''))
      .join('\n')
      .trim();
    if (!dataLines) continue;
    try {
      const message = JSON.parse(dataLines) as JsonRpcMessage;
      if (Number(message.id) === requestId || (message.id === undefined && !message.method)) {
        return message;
      }
    } catch {
      continue;
    }
  }
  throw new Error('MCP сервер вернул некорректный JSON-RPC ответ в SSE-потоке.');
}

async function createTransport(config: McpResolvedServerConfig): Promise<McpClientTransport> {
  if (config.type === 'http') {
    const client = new HttpMcpClient(config);
    await client.initialize();
    return client;
  }
  const client = new StdioMcpClient(config);
  await client.initialize();
  return client;
}

async function getClient(config: McpResolvedServerConfig): Promise<McpClientTransport> {
  const cacheKey = buildCacheKey(config);
  const cached = CLIENT_CACHE.get(cacheKey);
  if (cached) {
    try {
      return await cached;
    } catch {
      CLIENT_CACHE.delete(cacheKey);
    }
  }

  const created = createTransport(config).catch((error) => {
    CLIENT_CACHE.delete(cacheKey);
    throw error;
  });
  CLIENT_CACHE.set(cacheKey, created);
  return created;
}

export async function clearMcpClientCache(serverName?: string): Promise<void> {
  const entries = [...CLIENT_CACHE.entries()];
  for (const [key, promise] of entries) {
    if (serverName && !key.startsWith(`${serverName}:`)) continue;
    CLIENT_CACHE.delete(key);
    try {
      const client = await promise;
      await client.dispose();
    } catch {
      // ignore broken cached transports
    }
  }
}

async function requestAllResources(config: McpResolvedServerConfig): Promise<McpResourceDescriptor[]> {
  const response = await withClientRecovery(config, async (client) => {
    if (!client.getCapabilities()?.resources) {
      const unsupported: McpServerSupportNote = {
        server: config.name,
        reason: `Сервер "${config.name}" не объявил capability resources в initialize.`,
      };
      return { resources: [] as McpResourceDescriptor[], unsupported };
    }

    const resources: McpResourceDescriptor[] = [];
    let cursor: string | undefined;

    while (true) {
      const result = await client.request<{ resources?: Array<Record<string, unknown>>; nextCursor?: string }>(
        'resources/list',
        cursor ? { cursor } : {},
      );
      const items = Array.isArray(result?.resources) ? result.resources : [];
      for (const item of items) {
        const uri = String(item.uri || '').trim();
        if (!uri) continue;
        resources.push({
          uri,
          name: String(item.name || item.title || uri),
          ...(item.title ? { title: String(item.title) } : {}),
          ...(item.mimeType ? { mimeType: String(item.mimeType) } : {}),
          ...(item.description ? { description: String(item.description) } : {}),
          ...(typeof item.size === 'number' ? { size: item.size } : {}),
          server: config.name,
        });
      }
      cursor = hasText(result?.nextCursor) ? String(result.nextCursor) : '';
      if (!cursor) break;
    }

    return { resources };
  });

  if (response.unsupported) {
    throw Object.assign(new Error(response.unsupported.reason), { unsupported: response.unsupported });
  }
  return response.resources;
}

function hasText(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export async function listMcpResources(targetServer?: string): Promise<McpListResourcesResult> {
  const registry = await loadMcpServerRegistry();
  const allServers = Object.values(registry.servers);
  if (allServers.length === 0) {
    return {
      resources: [],
      failures: [],
      unsupported: [],
      serverCount: 0,
      sources: registry.sources,
      configErrors: registry.errors,
    };
  }

  const servers = targetServer
    ? allServers.filter((server) => server.name === targetServer)
    : allServers;

  if (targetServer && servers.length === 0) {
    throw new Error(
      `MCP сервер "${targetServer}" не найден. Доступные серверы: ${allServers.map((server) => server.name).join(', ')}`,
    );
  }

  const results = await Promise.all(servers.map(async (server) => {
    try {
      return {
        server: server.name,
        resources: await requestAllResources(server),
      };
    } catch (error: any) {
      if (error?.unsupported) {
        return {
          server: server.name,
          resources: [] as McpResourceDescriptor[],
          unsupported: error.unsupported as McpServerSupportNote,
        };
      }
      return {
        server: server.name,
        resources: [] as McpResourceDescriptor[],
        error: error?.message || String(error),
      };
    }
  }));

  return {
    resources: results.flatMap((item) => item.resources),
    failures: results
      .filter((item) => item.error)
      .map((item) => ({ server: item.server, message: String(item.error) })),
    unsupported: results
      .filter((item) => item.unsupported)
      .map((item) => item.unsupported as McpServerSupportNote),
    serverCount: servers.length,
    sources: registry.sources,
    configErrors: registry.errors,
  };
}

async function requestAllTools(config: McpResolvedServerConfig): Promise<McpToolDescriptor[]> {
  return withClientRecovery(config, async (client) => {
    if (!client.getCapabilities()?.tools) {
      return [];
    }

    const tools: McpToolDescriptor[] = [];
    let cursor: string | undefined;

    while (true) {
      const result = await client.request<{ tools?: Array<Record<string, unknown>>; nextCursor?: string }>(
        'tools/list',
        cursor ? { cursor } : {},
      );
      const items = Array.isArray(result?.tools) ? result.tools : [];
      for (const item of items) {
        const name = String(item.name || '').trim();
        if (!name) continue;
        const annotations = item.annotations && typeof item.annotations === 'object' && !Array.isArray(item.annotations)
          ? (item.annotations as Record<string, unknown>)
          : undefined;
        const inputSchema = item.inputSchema && typeof item.inputSchema === 'object' && !Array.isArray(item.inputSchema)
          ? (item.inputSchema as Record<string, unknown>)
          : undefined;
        tools.push({
          name,
          ...(hasText(item.description) ? { description: String(item.description) } : {}),
          ...(hasText(item.title) ? { title: String(item.title) } : {}),
          ...(inputSchema ? { inputSchema } : {}),
          ...(annotations
            ? {
              annotations: {
                ...(hasText(annotations.title) ? { title: String(annotations.title) } : {}),
                ...(typeof annotations.readOnlyHint === 'boolean' ? { readOnlyHint: annotations.readOnlyHint } : {}),
                ...(typeof annotations.destructiveHint === 'boolean' ? { destructiveHint: annotations.destructiveHint } : {}),
                ...(typeof annotations.idempotentHint === 'boolean' ? { idempotentHint: annotations.idempotentHint } : {}),
                ...(typeof annotations.openWorldHint === 'boolean' ? { openWorldHint: annotations.openWorldHint } : {}),
              },
            }
            : {}),
          server: config.name,
        });
      }
      cursor = hasText(result?.nextCursor) ? String(result.nextCursor) : '';
      if (!cursor) break;
    }

    return tools;
  });
}

export async function listMcpTools(targetServer?: string): Promise<McpListToolsResult> {
  return listMcpToolsFromRegistry(await loadMcpServerRegistry(), targetServer);
}

export async function listMcpToolsFromRegistry(
  registry: McpServerRegistry,
  targetServer?: string,
): Promise<McpListToolsResult> {
  const allServers = Object.values(registry.servers);
  if (allServers.length === 0) {
    return {
      tools: [],
      failures: [],
      unsupported: [],
      serverCount: 0,
      sources: registry.sources,
      configErrors: registry.errors,
    };
  }

  const servers = targetServer
    ? allServers.filter((server) => server.name === targetServer)
    : allServers;

  if (targetServer && servers.length === 0) {
    throw new Error(
      `MCP сервер "${targetServer}" не найден. Доступные серверы: ${allServers.map((server) => server.name).join(', ')}`,
    );
  }

  const results = await Promise.all(servers.map(async (server) => {
    try {
      return {
        server: server.name,
        tools: await requestAllTools(server),
      };
    } catch (error: any) {
      return {
        server: server.name,
        tools: [] as McpToolDescriptor[],
        error: error?.message || String(error),
      };
    }
  }));

  return {
    tools: results.flatMap((item) => item.tools),
    failures: results
      .filter((item) => item.error)
      .map((item) => ({ server: item.server, message: String(item.error) })),
    unsupported: [],
    serverCount: servers.length,
    sources: registry.sources,
    configErrors: registry.errors,
  };
}

export async function readMcpResource(serverName: string, uri: string): Promise<McpReadResourceResult> {
  const registry = await loadMcpServerRegistry();
  const server = registry.servers[serverName];
  if (!server) {
    const available = Object.keys(registry.servers);
    throw new Error(
      available.length > 0
        ? `MCP сервер "${serverName}" не найден. Доступные серверы: ${available.join(', ')}`
        : `MCP сервер "${serverName}" не найден. ${buildMcpConfigHelpText()}`,
    );
  }

  const result = await withClientRecovery(server, async (client) => {
    if (!client.getCapabilities()?.resources) {
      throw new Error(`Сервер "${serverName}" не поддерживает MCP resources/read.`);
    }
    return client.request<{ contents?: Array<Record<string, unknown>> }>('resources/read', { uri });
  });
  const contents = Array.isArray(result?.contents) ? result.contents : [];
  const normalizedContents: McpReadResourceContent[] = [];

  for (const content of contents) {
    const contentUri = String(content.uri || uri);
    const mimeType = hasText(content.mimeType) ? String(content.mimeType) : undefined;
    if (hasText(content.text)) {
      normalizedContents.push({
        uri: contentUri,
        ...(mimeType ? { mimeType } : {}),
        text: truncate(String(content.text), 12_000),
        ...(typeof content.size === 'number' ? { size: content.size } : {}),
      });
      continue;
    }
    if (hasText(content.blob)) {
      normalizedContents.push(await persistBinaryContent(serverName, contentUri, mimeType, String(content.blob)));
      continue;
    }
    normalizedContents.push({
      uri: contentUri,
      ...(mimeType ? { mimeType } : {}),
      ...(typeof content.size === 'number' ? { size: content.size } : {}),
    });
  }

  return {
    server: serverName,
    uri,
    contents: normalizedContents,
    sourceLabel: server.sourceLabel,
  };
}

function normalizeMcpToolTextPart(item: Record<string, unknown>): McpToolCallContentPart | null {
  const text = String(item.text || '').trim();
  if (!text) return null;
  return {
    kind: 'text',
    title: 'Text',
    text: truncate(text, 12_000),
  };
}

async function normalizeMcpToolImagePart(
  serverName: string,
  toolName: string,
  item: Record<string, unknown>,
): Promise<McpToolCallContentPart | null> {
  const data = String(item.data || '').trim();
  if (!data) return null;
  const mimeType = hasText(item.mimeType) ? String(item.mimeType) : 'application/octet-stream';
  const content = await persistBinaryContent(serverName, `tool://${toolName}/image`, mimeType, data);
  return {
    kind: 'image',
    title: 'Image',
    ...(content.text ? { text: content.text } : {}),
    ...(content.blobSavedTo ? { savedTo: content.blobSavedTo } : {}),
    ...(content.mimeType ? { mimeType: content.mimeType } : {}),
  };
}

async function normalizeMcpToolResourcePart(
  serverName: string,
  item: Record<string, unknown>,
): Promise<McpToolCallContentPart | null> {
  const resource = item.resource && typeof item.resource === 'object' && !Array.isArray(item.resource)
    ? (item.resource as Record<string, unknown>)
    : item;
  const uri = String(resource.uri || '').trim();
  const mimeType = hasText(resource.mimeType) ? String(resource.mimeType) : undefined;
  if (hasText(resource.text)) {
    return {
      kind: 'resource',
      title: uri || 'Resource',
      uri,
      ...(mimeType ? { mimeType } : {}),
      text: truncate(String(resource.text), 12_000),
    };
  }
  if (hasText(resource.blob)) {
    const content = await persistBinaryContent(serverName, uri || 'tool-resource', mimeType, String(resource.blob));
    return {
      kind: 'resource',
      title: uri || 'Resource',
      uri,
      ...(content.mimeType ? { mimeType: content.mimeType } : {}),
      ...(content.blobSavedTo ? { savedTo: content.blobSavedTo } : {}),
      ...(content.text ? { text: content.text } : {}),
    };
  }
  if (!uri) return null;
  return {
    kind: 'resource',
    title: uri,
    uri,
    ...(mimeType ? { mimeType } : {}),
  };
}

export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallToolResult> {
  const registry = await loadMcpServerRegistry();
  const server = registry.servers[serverName];
  if (!server) {
    const available = Object.keys(registry.servers);
    throw new Error(
      available.length > 0
        ? `MCP сервер "${serverName}" не найден. Доступные серверы: ${available.join(', ')}`
        : `MCP сервер "${serverName}" не найден. ${buildMcpConfigHelpText()}`,
    );
  }

  const result = await withClientRecovery(server, async (client) => {
    if (!client.getCapabilities()?.tools) {
      throw new Error(`Сервер "${serverName}" не поддерживает MCP tools/call.`);
    }
    return client.request<{
      content?: Array<Record<string, unknown>>;
      structuredContent?: unknown;
      isError?: boolean;
    }>('tools/call', {
      name: toolName,
      arguments: args || {},
    });
  });

  const parts: McpToolCallContentPart[] = [];
  const contentItems = Array.isArray(result?.content) ? result.content : [];
  for (const item of contentItems) {
    const type = String(item?.type || '').trim().toLowerCase();
    if (type === 'text') {
      const part = normalizeMcpToolTextPart(item);
      if (part) parts.push(part);
      continue;
    }
    if (type === 'image') {
      const part = await normalizeMcpToolImagePart(serverName, toolName, item);
      if (part) parts.push(part);
      continue;
    }
    if (type === 'resource' || type === 'resource_link') {
      const part = await normalizeMcpToolResourcePart(serverName, item);
      if (part) parts.push(part);
      continue;
    }
  }

  if (!parts.length && result?.structuredContent !== undefined) {
    parts.push({
      kind: 'json',
      title: 'structuredContent',
      text: truncate(JSON.stringify(result.structuredContent, null, 2), 12_000),
    });
  }

  return {
    server: serverName,
    toolName,
    sourceLabel: server.sourceLabel,
    parts,
    isError: !!result?.isError,
    ...(result?.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
  };
}
