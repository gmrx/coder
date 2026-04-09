import { createHash, randomBytes } from 'crypto';
import { createServer, type Server } from 'http';
import * as vscode from 'vscode';
import {
  clearStoredMcpOAuthState,
  getStoredMcpOAuthState,
  storeMcpOAuthState,
  type StoredMcpOAuthState,
} from './authStorage';
import type { McpOAuthConfig, McpResolvedHttpServerConfig } from './types';

const AUTH_REQUEST_TIMEOUT_MS = 30_000;
const AUTH_FLOW_TIMEOUT_MS = 5 * 60 * 1000;
const CLIENT_NAME = 'CursorCoderVSCode';

type OAuthServerMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
};

export class McpAuthRequiredError extends Error {
  readonly code = 'mcp_auth_required';

  constructor(
    public readonly serverName: string,
    public readonly details?: string,
  ) {
    super(
      details
        ? `MCP сервер "${serverName}" требует OAuth: ${details}`
        : `MCP сервер "${serverName}" требует OAuth-аутентификацию.`,
    );
  }
}

export class McpAuthCancelledError extends Error {
  readonly code = 'mcp_auth_cancelled';

  constructor(message = 'MCP OAuth flow cancelled.') {
    super(message);
  }
}

function hasText(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} не завершился за ${Math.round(AUTH_REQUEST_TIMEOUT_MS / 1000)}с.`)), AUTH_REQUEST_TIMEOUT_MS);
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

function buildPkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function buildPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function buildStateToken(): string {
  return randomBytes(24).toString('hex');
}

function buildDefaultMetadataCandidates(serverUrl: string): string[] {
  const base = new URL(serverUrl);
  const origin = `${base.protocol}//${base.host}`;
  return [
    `${origin}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/openid-configuration`,
  ];
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
  const response = await withTimeout(fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(headers || {}),
    },
  }), `OAuth metadata ${url}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} при чтении ${url}`);
  }
  return response.json();
}

function extractMetadataFromDocument(document: any): OAuthServerMetadata | null {
  const authorizationEndpoint = String(
    document?.authorization_endpoint ||
    document?.authorizationEndpoint ||
    '',
  ).trim();
  const tokenEndpoint = String(
    document?.token_endpoint ||
    document?.tokenEndpoint ||
    '',
  ).trim();
  if (!authorizationEndpoint || !tokenEndpoint) return null;
  const registrationEndpoint = String(
    document?.registration_endpoint ||
    document?.registrationEndpoint ||
    '',
  ).trim();
  return {
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    ...(registrationEndpoint ? { registration_endpoint: registrationEndpoint } : {}),
  };
}

async function discoverOAuthMetadata(config: McpResolvedHttpServerConfig): Promise<OAuthServerMetadata> {
  const oauth = config.oauth;
  if (!oauth) {
    throw new Error(`У сервера "${config.name}" не настроен oauth-конфиг.`);
  }

  if (hasText(oauth.authorizationEndpoint) && hasText(oauth.tokenEndpoint)) {
    return {
      authorization_endpoint: String(oauth.authorizationEndpoint).trim(),
      token_endpoint: String(oauth.tokenEndpoint).trim(),
      ...(hasText(oauth.registrationEndpoint)
        ? { registration_endpoint: String(oauth.registrationEndpoint).trim() }
        : {}),
    };
  }

  const candidates = [
    ...(hasText(oauth.authServerMetadataUrl) ? [String(oauth.authServerMetadataUrl).trim()] : []),
    ...buildDefaultMetadataCandidates(config.url),
  ];

  let lastError = '';
  for (const candidate of candidates) {
    try {
      const data = await fetchJson(candidate);
      const direct = extractMetadataFromDocument(data);
      if (direct) return direct;

      const authServers = Array.isArray(data?.authorization_servers) ? data.authorization_servers : [];
      if (authServers.length > 0 && hasText(authServers[0])) {
        const authServerUrl = String(authServers[0]).trim();
        const resolvedCandidate = /\/\.well-known\//.test(authServerUrl)
          ? authServerUrl
          : `${authServerUrl.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`;
        const discovered = extractMetadataFromDocument(await fetchJson(resolvedCandidate));
        if (discovered) return discovered;
      }
    } catch (error: any) {
      lastError = error?.message || String(error);
    }
  }

  throw new Error(
    lastError
      ? `Не удалось получить OAuth metadata: ${lastError}`
      : 'Не удалось определить authorization_endpoint и token_endpoint.',
  );
}

async function registerOAuthClient(
  config: McpResolvedHttpServerConfig,
  metadata: OAuthServerMetadata,
  redirectUri: string,
): Promise<{ clientId: string; clientSecret?: string }> {
  const oauth = config.oauth || {};
  const stored = await getStoredMcpOAuthState(config);
  const configuredClientId = String(oauth.clientId || '').trim();
  const storedClientId = String(stored?.clientId || '').trim();
  const storedClientSecret = String(stored?.clientSecret || '').trim();

  if (configuredClientId) {
    return {
      clientId: configuredClientId,
      ...(storedClientSecret ? { clientSecret: storedClientSecret } : {}),
    };
  }
  if (storedClientId) {
    return {
      clientId: storedClientId,
      ...(storedClientSecret ? { clientSecret: storedClientSecret } : {}),
    };
  }
  if (!hasText(metadata.registration_endpoint)) {
    throw new Error(
      `Для OAuth сервера "${config.name}" нужен oauth.clientId или registration_endpoint в metadata.`,
    );
  }

  const response = await withTimeout(fetch(String(metadata.registration_endpoint), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  }), `OAuth client registration for ${config.name}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} при dynamic client registration.`);
  }

  const data = await response.json() as Record<string, unknown>;
  const clientId = String(data.client_id || '').trim();
  const clientSecret = String(data.client_secret || '').trim();
  if (!clientId) {
    throw new Error('registration_endpoint не вернул client_id.');
  }

  const nextState: StoredMcpOAuthState = {
    ...(stored || {}),
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
  };
  await storeMcpOAuthState(config, nextState);
  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
  };
}

function buildAuthorizeUrl(
  config: McpResolvedHttpServerConfig,
  metadata: OAuthServerMetadata,
  redirectUri: string,
  clientId: string,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  const scopes = Array.isArray(config.oauth?.scopes) ? config.oauth?.scopes || [] : [];
  if (scopes.length > 0) {
    url.searchParams.set('scope', scopes.join(' '));
  }
  if (hasText(config.oauth?.resource)) {
    url.searchParams.set('resource', String(config.oauth?.resource).trim());
  }
  return url.toString();
}

async function exchangeAuthorizationCode(
  config: McpResolvedHttpServerConfig,
  metadata: OAuthServerMetadata,
  redirectUri: string,
  code: string,
  clientId: string,
  clientSecret: string | undefined,
  codeVerifier: string,
): Promise<StoredMcpOAuthState> {
  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', code);
  params.set('redirect_uri', redirectUri);
  params.set('client_id', clientId);
  params.set('code_verifier', codeVerifier);
  if (clientSecret) {
    params.set('client_secret', clientSecret);
  }

  const response = await withTimeout(fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  }), `OAuth token exchange for ${config.name}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} при обмене authorization code на token.`);
  }

  const data = await response.json() as Record<string, unknown>;
  const accessToken = String(data.access_token || '').trim();
  if (!accessToken) {
    throw new Error('OAuth token endpoint не вернул access_token.');
  }
  const refreshToken = String(data.refresh_token || '').trim();
  const tokenType = String(data.token_type || 'Bearer').trim() || 'Bearer';
  const scope = String(data.scope || '').trim();
  const expiresIn = Number(data.expires_in);

  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(tokenType ? { tokenType } : {}),
    ...(scope ? { scope } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
  };
}

function buildCallbackResponseHtml(status: 'ok' | 'error', message: string): string {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>MCP OAuth</title>',
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:32px;line-height:1.5;}',
    '.ok{color:#1f7a1f}.err{color:#a1260d}</style></head><body>',
    `<h2 class="${status === 'ok' ? 'ok' : 'err'}">${status === 'ok' ? 'Авторизация завершена' : 'Ошибка авторизации'}</h2>`,
    `<p>${message}</p>`,
    '<p>Можно вернуться в VS Code.</p>',
    '</body></html>',
  ].join('');
}

async function createAuthorizationCodeListener(
  serverName: string,
  requestedPort: number | undefined,
  expectedState: string,
  signal?: AbortSignal,
): Promise<{
  port: number;
  redirectUri: string;
  waitForCode: Promise<{ code: string; port: number; redirectUri: string }>;
}> {
  const host = '127.0.0.1';
  const server = createServer();
  let listener: Server | null = server;

  const closeServer = async (): Promise<void> => {
    if (!listener) return;
    await new Promise<void>((resolve) => listener?.close(() => resolve()));
    listener = null;
  };

  const waitForCode = new Promise<{ code: string; port: number; redirectUri: string }>((resolve, reject) => {
    let settled = false;
    const finish = async (
      status: 'resolve' | 'reject',
      payload: { code: string; port: number; redirectUri: string } | Error,
    ): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      await closeServer();
      if (status === 'resolve') {
        resolve(payload as { code: string; port: number; redirectUri: string });
      } else {
        reject(payload);
      }
    };

    const onAbort = () => {
      void finish('reject', new McpAuthCancelledError(`OAuth flow for "${serverName}" cancelled.`));
    };
    signal?.addEventListener('abort', onAbort);

    const timeout = setTimeout(() => {
      void finish('reject', new Error(`OAuth flow для "${serverName}" не завершён за ${Math.round(AUTH_FLOW_TIMEOUT_MS / 1000)}с.`));
    }, AUTH_FLOW_TIMEOUT_MS);

    server.on('request', (request, response) => {
      const requestUrl = new URL(request.url || '/', `http://${host}`);
      const state = String(requestUrl.searchParams.get('state') || '');
      const code = String(requestUrl.searchParams.get('code') || '');
      const error = String(requestUrl.searchParams.get('error') || '');

      if (error) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(buildCallbackResponseHtml('error', `OAuth provider вернул ошибку: ${error}.`));
        void finish('reject', new Error(`OAuth provider returned "${error}"`));
        return;
      }
      if (!code) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(buildCallbackResponseHtml('error', 'Не найден параметр code в callback URL.'));
        void finish('reject', new Error('OAuth callback не содержит code.'));
        return;
      }
      if (state !== expectedState) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(buildCallbackResponseHtml('error', 'Параметр state не совпал. Авторизация отменена.'));
        void finish('reject', new Error('OAuth callback state mismatch.'));
        return;
      }

      const address = listener?.address();
      const port = typeof address === 'object' && address ? address.port : requestedPort || 0;
      const redirectUri = `http://${host}:${port}/mcp-auth/callback`;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(buildCallbackResponseHtml('ok', 'Разрешение получено. Возвращаю управление расширению.'));
      void finish('resolve', { code, port, redirectUri });
    });

    server.once('error', (error: any) => {
      void finish('reject', new Error(`Не удалось открыть локальный callback port: ${error?.message || error}`));
    });

    server.listen(requestedPort || 0, host);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', (error) => reject(error));
  });

  const address = listener?.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort || 0;
  const redirectUri = `http://${host}:${port}/mcp-auth/callback`;
  return {
    port,
    redirectUri,
    waitForCode,
  };
}

export async function getMcpAuthorizationHeader(
  config: McpResolvedHttpServerConfig,
): Promise<Record<string, string>> {
  if (!config.oauth) return {};
  const stored = await getStoredMcpOAuthState(config);
  const accessToken = String(stored?.accessToken || '').trim();
  if (!accessToken) return {};
  const tokenType = String(stored?.tokenType || 'Bearer').trim() || 'Bearer';
  return {
    Authorization: `${tokenType} ${accessToken}`,
  };
}

export async function refreshMcpAccessToken(
  config: McpResolvedHttpServerConfig,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!config.oauth) return false;
  const stored = await getStoredMcpOAuthState(config);
  const refreshToken = String(stored?.refreshToken || '').trim();
  const clientId = String(config.oauth.clientId || stored?.clientId || '').trim();
  if (!refreshToken || !clientId) return false;

  const metadata = await discoverOAuthMetadata(config);
  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', refreshToken);
  params.set('client_id', clientId);
  if (stored?.clientSecret) {
    params.set('client_secret', stored.clientSecret);
  }

  const response = await withTimeout(fetch(metadata.token_endpoint, {
    method: 'POST',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  }), `OAuth token refresh for ${config.name}`);

  if (!response.ok) {
    return false;
  }

  const data = await response.json() as Record<string, unknown>;
  const accessToken = String(data.access_token || '').trim();
  if (!accessToken) return false;
  const nextState: StoredMcpOAuthState = {
    ...(stored || {}),
    accessToken,
    tokenType: String(data.token_type || stored?.tokenType || 'Bearer').trim() || 'Bearer',
    scope: String(data.scope || stored?.scope || '').trim() || stored?.scope,
    refreshToken: String(data.refresh_token || refreshToken).trim() || refreshToken,
    clientId,
    ...(stored?.clientSecret ? { clientSecret: stored.clientSecret } : {}),
  };
  const expiresIn = Number(data.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    nextState.expiresAt = Date.now() + expiresIn * 1000;
  }
  await storeMcpOAuthState(config, nextState);
  return true;
}

export async function clearMcpOAuthState(config: McpResolvedHttpServerConfig): Promise<void> {
  await clearStoredMcpOAuthState(config);
}

export async function performMcpOAuthFlow(
  config: McpResolvedHttpServerConfig,
  options?: {
    signal?: AbortSignal;
    force?: boolean;
    onStatus?: (status: { stage: string; message: string; authUrl?: string }) => void;
  },
): Promise<{
  authUrl: string;
  browserOpened: boolean;
  callbackPort: number;
  clientId: string;
  expiresAt?: number;
  scope?: string;
}> {
  if (!config.oauth) {
    throw new Error(`У сервера "${config.name}" нет oauth-конфига.`);
  }

  if (options?.force) {
    await clearStoredMcpOAuthState(config);
  }

  const state = buildStateToken();
  const callback = await createAuthorizationCodeListener(
    config.name,
    config.oauth.callbackPort,
    state,
    options?.signal,
  );

  const metadata = await discoverOAuthMetadata(config);
  const registration = await registerOAuthClient(config, metadata, callback.redirectUri);
  const verifier = buildPkceVerifier();
  const challenge = buildPkceChallenge(verifier);
  const authUrl = buildAuthorizeUrl(
    config,
    metadata,
    callback.redirectUri,
    registration.clientId,
    state,
    challenge,
  );

  options?.onStatus?.({
    stage: 'authorization_url',
    message: `Открываю OAuth авторизацию для ${config.name}`,
    authUrl,
  });

  const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
  options?.onStatus?.({
    stage: 'browser_opened',
    message: opened
      ? `Браузер открыт для OAuth авторизации ${config.name}`
      : `Не удалось автоматически открыть браузер. Открой URL вручную: ${authUrl}`,
    authUrl,
  });

  const callbackResult = await callback.waitForCode;
  const tokenState = await exchangeAuthorizationCode(
    config,
    metadata,
    callbackResult.redirectUri,
    callbackResult.code,
    registration.clientId,
    registration.clientSecret,
    verifier,
  );
  await storeMcpOAuthState(config, tokenState);

  return {
    authUrl,
    browserOpened: opened,
    callbackPort: callback.port,
    clientId: registration.clientId,
    ...(typeof tokenState.expiresAt === 'number' ? { expiresAt: tokenState.expiresAt } : {}),
    ...(tokenState.scope ? { scope: tokenState.scope } : {}),
  };
}
