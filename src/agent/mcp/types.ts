export type McpTransportType = 'stdio' | 'http';

export interface McpOAuthConfig {
  clientId?: string;
  callbackPort?: number;
  authServerMetadataUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;
  scopes?: string[];
  resource?: string;
}

export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpResolvedServerConfigBase {
  type: McpTransportType;
  name: string;
  sourceLabel: string;
  sourceKind: 'settings';
}

export type McpResolvedStdioServerConfig = McpStdioServerConfig & McpResolvedServerConfigBase & {
  type: 'stdio';
};

export type McpResolvedHttpServerConfig = McpHttpServerConfig & McpResolvedServerConfigBase & {
  type: 'http';
};

export type McpResolvedServerConfig = McpResolvedStdioServerConfig | McpResolvedHttpServerConfig;

export interface McpServerCapabilities {
  tools?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
  resources?: Record<string, unknown>;
}

export interface McpServerSupportNote {
  server: string;
  reason: string;
}

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  title?: string;
  mimeType?: string;
  description?: string;
  size?: number;
  server: string;
}

export interface McpReadResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blobSavedTo?: string;
  size?: number;
}

export interface McpListResourcesResult {
  resources: McpResourceDescriptor[];
  failures: Array<{ server: string; message: string }>;
  unsupported: McpServerSupportNote[];
  serverCount: number;
  sources: string[];
  configErrors: string[];
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  title?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  server: string;
}

export interface McpListToolsResult {
  tools: McpToolDescriptor[];
  failures: Array<{ server: string; message: string }>;
  unsupported: McpServerSupportNote[];
  serverCount: number;
  sources: string[];
  configErrors: string[];
}

export interface McpReadResourceResult {
  server: string;
  uri: string;
  contents: McpReadResourceContent[];
  sourceLabel: string;
}

export interface McpToolCallContentPart {
  kind: 'text' | 'image' | 'resource' | 'json';
  title: string;
  text?: string;
  mimeType?: string;
  uri?: string;
  savedTo?: string;
}

export interface McpCallToolResult {
  server: string;
  toolName: string;
  sourceLabel: string;
  parts: McpToolCallContentPart[];
  isError: boolean;
  structuredContent?: unknown;
}

export interface McpAuthResult {
  server: string;
  sourceLabel: string;
  authUrl?: string;
  browserOpened?: boolean;
  callbackPort?: number;
  clientId?: string;
  expiresAt?: number;
  scope?: string;
  verifiedTools?: number;
}

export interface McpServerRegistry {
  servers: Record<string, McpResolvedServerConfig>;
  sources: string[];
  errors: string[];
}
