import type { McpToolDescriptor } from './types';

const STATEFUL_MCP_TOOL_RE =
  /(^|[_-])(set|update|create|delete|remove|apply|commit|submit|write|edit|patch|archive|unarchive|approve|reject|start|stop|restart|login|logout|enable|disable|toggle|assign|unassign|link|unlink|merge|move|rename|save|sync)([_-]|$)/i;

export interface McpToolExecutionPolicy {
  server: string;
  toolName: string;
  stateKey: string;
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean | undefined;
  changesState: boolean;
  concurrencySafe: boolean;
  requiresApproval: boolean;
  nameSuggestsStateChange: boolean;
}

function hasText(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function getMcpServerArg(args: any): string {
  return String(args?.server || '').trim();
}

export function getMcpToolNameArg(args: any): string {
  return String(args?.name || args?.toolName || args?.tool || '').trim();
}

export function getMcpArgumentsArg(args: any): Record<string, unknown> {
  return args?.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments)
    ? (args.arguments as Record<string, unknown>)
    : {};
}

export function buildMcpRemoteStateKey(server: string): string {
  return `mcp:${server}`;
}

export function buildMcpScopedCallKey(
  server: string,
  toolName: string,
  args: Record<string, unknown>,
  stateVersion: number,
): string {
  return `mcp_tool:${server}:${toolName}:v${stateVersion}:${JSON.stringify(args || {})}`;
}

export function classifyMcpToolExecutionPolicy(
  server: string,
  toolName: string,
  descriptor?: Pick<McpToolDescriptor, 'annotations'>,
): McpToolExecutionPolicy {
  const annotations = descriptor?.annotations;
  const readOnly = annotations?.readOnlyHint === true;
  const destructive = annotations?.destructiveHint === true;
  const idempotent = typeof annotations?.idempotentHint === 'boolean'
    ? annotations.idempotentHint
    : undefined;
  const nameSuggestsStateChange = STATEFUL_MCP_TOOL_RE.test(toolName);
  const requiresApproval = !readOnly;
  const changesState = requiresApproval || destructive || nameSuggestsStateChange;
  const concurrencySafe = readOnly && !destructive && idempotent !== false;

  return {
    server,
    toolName,
    stateKey: buildMcpRemoteStateKey(server),
    readOnly,
    destructive,
    idempotent,
    changesState,
    concurrencySafe,
    requiresApproval,
    nameSuggestsStateChange,
  };
}

export function hasMcpToolIdentity(args: any): boolean {
  return hasText(getMcpServerArg(args)) && hasText(getMcpToolNameArg(args));
}
