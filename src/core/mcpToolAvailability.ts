import type { McpToolDescriptor } from '../agent/mcp/types';

export function buildMcpToolKey(server: string, toolName: string): string {
  return `${String(server || '').trim()}::${String(toolName || '').trim()}`;
}

function normalizeMcpToolKeyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const key = String(item || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

export function normalizeMcpDisabledTools(value: unknown): string[] {
  return normalizeMcpToolKeyList(value);
}

export function normalizeMcpTrustedTools(value: unknown): string[] {
  return normalizeMcpToolKeyList(value);
}

export function isMcpToolDisabled(
  disabledTools: Iterable<string> | unknown,
  server: string,
  toolName: string,
): boolean {
  const key = buildMcpToolKey(server, toolName);
  if (disabledTools && typeof (disabledTools as Set<string>).has === 'function') {
    return (disabledTools as Set<string>).has(key);
  }
  const normalized = normalizeMcpDisabledTools(disabledTools);
  return normalized.includes(key);
}

export function isMcpToolTrusted(
  trustedTools: Iterable<string> | unknown,
  server: string,
  toolName: string,
): boolean {
  const key = buildMcpToolKey(server, toolName);
  if (trustedTools && typeof (trustedTools as Set<string>).has === 'function') {
    return (trustedTools as Set<string>).has(key);
  }
  const normalized = normalizeMcpTrustedTools(trustedTools);
  return normalized.includes(key);
}

export function filterDisabledMcpTools(
  tools: McpToolDescriptor[],
  disabledTools: Iterable<string> | unknown,
): McpToolDescriptor[] {
  const disabledSet = disabledTools && typeof (disabledTools as Set<string>).has === 'function'
    ? disabledTools as Set<string>
    : new Set(normalizeMcpDisabledTools(disabledTools));
  return tools.filter((tool) => !disabledSet.has(buildMcpToolKey(tool.server, tool.name)));
}
