import * as path from 'path';
import * as vscode from 'vscode';
import type {
  McpHttpServerConfig,
  McpOAuthConfig,
  McpResolvedServerConfig,
  McpServerConfig,
  McpServerRegistry,
  McpStdioServerConfig,
} from './types';

const DEFAULT_CONFIG_CANDIDATES = ['.mcp.json', '.cursor/mcp.json'];

function hasText(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function normalizeConfigPath(rootPath: string, rawPath: string): string {
  const expanded = expandTemplate(rawPath, rootPath);
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(rootPath, expanded);
}

function expandTemplate(value: string, workspacePath: string): string {
  return String(value || '').replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    if (name === 'workspaceFolder') return workspacePath;
    if (name === 'workspaceRoot') return workspacePath;
    if (name === 'workspaceFolderBasename') return path.basename(workspacePath);
    if (name.startsWith('env:')) return process.env[name.slice(4)] || '';
    return '';
  });
}

function readWorkspaceRoot(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

export function getMcpWorkspacePath(): string {
  const root = readWorkspaceRoot();
  return root?.uri.fsPath || process.cwd();
}

function normalizeStringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const normalized: string[] = [];
  for (const item of value) {
    if (!hasText(item)) return null;
    normalized.push(String(item));
  }
  return normalized;
}

function normalizeStringMap(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!hasText(entry)) return null;
    normalized[key] = String(entry);
  }
  return normalized;
}

function normalizeOauthConfig(
  value: unknown,
  options: {
    serverName: string;
    sourceLabel: string;
  },
): { config?: McpOAuthConfig; error?: string } {
  if (value === undefined) return { config: undefined };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      error: `Сервер "${options.serverName}" в ${options.sourceLabel}: oauth должен быть объектом.`,
    };
  }
  const raw = value as Record<string, unknown>;
  const scopes = normalizeStringArray(raw.scopes);
  if (!scopes) {
    return {
      error: `Сервер "${options.serverName}" в ${options.sourceLabel}: oauth.scopes должен быть массивом строк.`,
    };
  }
  const callbackPort = raw.callbackPort === undefined ? undefined : Number(raw.callbackPort);
  if (
    raw.callbackPort !== undefined &&
    (typeof callbackPort !== 'number' || !Number.isInteger(callbackPort) || callbackPort <= 0)
  ) {
    return {
      error: `Сервер "${options.serverName}" в ${options.sourceLabel}: oauth.callbackPort должен быть положительным integer.`,
    };
  }

  const authServerMetadataUrl = hasText(raw.authServerMetadataUrl) ? String(raw.authServerMetadataUrl).trim() : '';
  if (authServerMetadataUrl && !/^https:\/\//i.test(authServerMetadataUrl)) {
    return {
      error:
        `Сервер "${options.serverName}" в ${options.sourceLabel}: ` +
        'oauth.authServerMetadataUrl должен использовать https://',
    };
  }

  const config: McpOAuthConfig = {
    ...(hasText(raw.clientId) ? { clientId: String(raw.clientId).trim() } : {}),
    ...(callbackPort !== undefined ? { callbackPort } : {}),
    ...(authServerMetadataUrl ? { authServerMetadataUrl } : {}),
    ...(hasText(raw.authorizationEndpoint) ? { authorizationEndpoint: String(raw.authorizationEndpoint).trim() } : {}),
    ...(hasText(raw.tokenEndpoint) ? { tokenEndpoint: String(raw.tokenEndpoint).trim() } : {}),
    ...(hasText(raw.registrationEndpoint) ? { registrationEndpoint: String(raw.registrationEndpoint).trim() } : {}),
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
    ...(hasText(raw.resource) ? { resource: String(raw.resource).trim() } : {}),
  };

  return { config };
}

function normalizeServerConfig(
  serverName: string,
  rawConfig: unknown,
  options: {
    workspacePath: string;
    sourceLabel: string;
    sourceKind: 'workspace-file' | 'settings';
  },
): { config?: McpResolvedServerConfig; error?: string } {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return { error: `Сервер "${serverName}" в ${options.sourceLabel}: конфиг должен быть объектом.` };
  }

  const value = rawConfig as Record<string, unknown>;
  const rawType = String(value.type || 'stdio').trim().toLowerCase();

  if (rawType === 'stdio' || rawType === '') {
    if (!hasText(value.command)) {
      return { error: `Сервер "${serverName}" в ${options.sourceLabel}: для stdio обязателен command.` };
    }
    const args = normalizeStringArray(value.args);
    if (!args) {
      return { error: `Сервер "${serverName}" в ${options.sourceLabel}: args должен быть массивом строк.` };
    }
    const env = normalizeStringMap(value.env);
    if (!env) {
      return { error: `Сервер "${serverName}" в ${options.sourceLabel}: env должен быть объектом строк.` };
    }

    const commandExpanded = expandTemplate(String(value.command), options.workspacePath);
    const resolvedCommand = /[\\/]/.test(commandExpanded) && !path.isAbsolute(commandExpanded)
      ? path.resolve(options.workspacePath, commandExpanded)
      : commandExpanded;
    const resolvedArgs = args.map((arg) => expandTemplate(arg, options.workspacePath));
    const resolvedEnv: Record<string, string> = {};
    for (const [key, entry] of Object.entries(env)) {
      resolvedEnv[key] = expandTemplate(entry, options.workspacePath);
    }

    const config: McpStdioServerConfig = {
      type: 'stdio',
      command: resolvedCommand,
      ...(resolvedArgs.length > 0 ? { args: resolvedArgs } : {}),
      ...(Object.keys(resolvedEnv).length > 0 ? { env: resolvedEnv } : {}),
      ...(hasText(value.cwd) ? { cwd: normalizeConfigPath(options.workspacePath, String(value.cwd)) } : {}),
    };

    return {
      config: {
        ...config,
        type: 'stdio',
        name: serverName,
        sourceLabel: options.sourceLabel,
        sourceKind: options.sourceKind,
      },
    };
  }

  if (rawType === 'http') {
    if (!hasText(value.url)) {
      return { error: `Сервер "${serverName}" в ${options.sourceLabel}: для http обязателен url.` };
    }
    const headers = normalizeStringMap(value.headers);
    if (!headers) {
      return { error: `Сервер "${serverName}" в ${options.sourceLabel}: headers должен быть объектом строк.` };
    }
    const oauth = normalizeOauthConfig(value.oauth, {
      serverName,
      sourceLabel: options.sourceLabel,
    });
    if (oauth.error) {
      return { error: oauth.error };
    }
    const config: McpHttpServerConfig = {
      type: 'http',
      url: expandTemplate(String(value.url), options.workspacePath),
      ...(Object.keys(headers).length > 0
        ? {
          headers: Object.fromEntries(
            Object.entries(headers).map(([key, entry]) => [key, expandTemplate(entry, options.workspacePath)]),
          ),
        }
        : {}),
      ...(oauth.config && Object.keys(oauth.config).length > 0 ? { oauth: oauth.config } : {}),
    };

    return {
      config: {
        ...config,
        name: serverName,
        sourceLabel: options.sourceLabel,
        sourceKind: options.sourceKind,
      },
    };
  }

  return {
    error:
      `Сервер "${serverName}" в ${options.sourceLabel}: тип "${rawType}" пока не поддержан. ` +
      'Сейчас доступны stdio и http (с optional oauth для http).',
  };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

async function loadWorkspaceFileServers(
  workspacePath: string,
  filePath: string,
  registry: McpServerRegistry,
): Promise<void> {
  try {
    const raw = await readJsonFile(filePath);
    const value = raw as { mcpServers?: Record<string, unknown> };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      registry.errors.push(`Файл ${path.basename(filePath)} должен содержать JSON-объект.`);
      return;
    }
    const rawServers = value.mcpServers;
    if (!rawServers || typeof rawServers !== 'object' || Array.isArray(rawServers)) {
      registry.errors.push(`Файл ${path.basename(filePath)} должен содержать объект "mcpServers".`);
      return;
    }

    registry.sources.push(path.relative(workspacePath, filePath) || path.basename(filePath));
    for (const [serverName, rawConfig] of Object.entries(rawServers)) {
      const normalized = normalizeServerConfig(serverName, rawConfig, {
        workspacePath,
        sourceLabel: path.relative(workspacePath, filePath) || path.basename(filePath),
        sourceKind: 'workspace-file',
      });
      if (normalized.error) {
        registry.errors.push(normalized.error);
        continue;
      }
      if (normalized.config) {
        registry.servers[serverName] = normalized.config;
      }
    }
  } catch (error: any) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'FileNotFound') {
      return;
    }
    registry.errors.push(`Не удалось прочитать ${path.basename(filePath)}: ${error?.message || error}`);
  }
}

export async function loadMcpServerRegistry(): Promise<McpServerRegistry> {
  const registry: McpServerRegistry = {
    servers: {},
    sources: [],
    errors: [],
  };

  const workspacePath = getMcpWorkspacePath();
  const configuration = vscode.workspace.getConfiguration('aiAssistant');
  const customConfigPath = String(configuration.get<string>('mcpConfigPath') || '').trim();
  const candidatePaths = customConfigPath
    ? [normalizeConfigPath(workspacePath, customConfigPath)]
    : DEFAULT_CONFIG_CANDIDATES.map((relativePath) => path.resolve(workspacePath, relativePath));

  for (const candidate of [...new Set(candidatePaths)]) {
    await loadWorkspaceFileServers(workspacePath, candidate, registry);
  }

  const rawSettingsServers = configuration.get<Record<string, unknown>>('mcpServers') || {};
  if (rawSettingsServers && typeof rawSettingsServers === 'object' && !Array.isArray(rawSettingsServers)) {
    const entries = Object.entries(rawSettingsServers);
    if (entries.length > 0) {
      registry.sources.push('settings: aiAssistant.mcpServers');
    }
    for (const [serverName, rawConfig] of entries) {
      const normalized = normalizeServerConfig(serverName, rawConfig, {
        workspacePath,
        sourceLabel: 'settings: aiAssistant.mcpServers',
        sourceKind: 'settings',
      });
      if (normalized.error) {
        registry.errors.push(normalized.error);
        continue;
      }
      if (normalized.config) {
        registry.servers[serverName] = normalized.config;
      }
    }
  }

  return registry;
}

export function buildMcpServerRegistryFromMap(
  rawServers: Record<string, unknown>,
  options?: {
    workspacePath?: string;
    sourceLabel?: string;
    sourceKind?: 'workspace-file' | 'settings';
  },
): McpServerRegistry {
  const workspacePath = options?.workspacePath || getMcpWorkspacePath();
  const sourceLabel = options?.sourceLabel || 'draft: MCP settings';
  const sourceKind = options?.sourceKind || 'settings';
  const registry: McpServerRegistry = {
    servers: {},
    sources: [],
    errors: [],
  };

  const entries = rawServers && typeof rawServers === 'object' && !Array.isArray(rawServers)
    ? Object.entries(rawServers)
    : [];
  if (entries.length > 0) {
    registry.sources.push(sourceLabel);
  }

  for (const [serverName, rawConfig] of entries) {
    const normalized = normalizeServerConfig(serverName, rawConfig, {
      workspacePath,
      sourceLabel,
      sourceKind,
    });
    if (normalized.error) {
      registry.errors.push(normalized.error);
      continue;
    }
    if (normalized.config) {
      registry.servers[serverName] = normalized.config;
    }
  }

  return registry;
}

export function buildMcpConfigHelpText(): string {
  return (
    'Настрой MCP через .mcp.json в корне workspace, .cursor/mcp.json или settings aiAssistant.mcpServers. ' +
    'Сейчас поддерживаются stdio и http-конфиги; для http можно дополнительно указать oauth.'
  );
}
