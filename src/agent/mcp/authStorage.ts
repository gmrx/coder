import { createHash } from 'crypto';
import * as vscode from 'vscode';
import type { McpResolvedHttpServerConfig } from './types';

export interface StoredMcpOAuthState {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
}

let secretStorage: vscode.SecretStorage | null = null;

export function initMcpAuthStorage(context: vscode.ExtensionContext): void {
  secretStorage = context.secrets;
}

function getWorkspaceScopeLabel(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
}

function buildServerSecretKey(config: McpResolvedHttpServerConfig): string {
  const scope = getWorkspaceScopeLabel();
  const hash = createHash('sha256')
    .update(`${scope}::${config.name}::${config.url}`)
    .digest('hex')
    .slice(0, 24);
  return `ai-assistant.mcp.oauth.${hash}`;
}

export async function getStoredMcpOAuthState(
  config: McpResolvedHttpServerConfig,
): Promise<StoredMcpOAuthState | null> {
  if (!secretStorage) return null;
  const raw = await secretStorage.get(buildServerSecretKey(config));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredMcpOAuthState;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function storeMcpOAuthState(
  config: McpResolvedHttpServerConfig,
  state: StoredMcpOAuthState,
): Promise<void> {
  if (!secretStorage) return;
  await secretStorage.store(buildServerSecretKey(config), JSON.stringify(state));
}

export async function clearStoredMcpOAuthState(config: McpResolvedHttpServerConfig): Promise<void> {
  if (!secretStorage) return;
  await secretStorage.delete(buildServerSecretKey(config));
}
