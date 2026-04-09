import { buildMcpToolKey, normalizeMcpDisabledTools } from '../core/mcpToolAvailability';
import { buildMcpServerRegistryFromMap } from '../agent/mcp/config';
import { clearMcpClientCache, listMcpToolsFromRegistry } from '../agent/mcp/client';
import type { McpToolDescriptor } from '../agent/mcp/types';

export interface McpInspectionToolItem {
  key: string;
  server: string;
  name: string;
  title: string;
  description: string;
  schemaSummary: string;
  readOnly: boolean;
  destructive: boolean;
  enabled: boolean;
}

export interface McpInspectionServerItem {
  name: string;
  type: 'stdio' | 'http';
  sourceLabel: string;
  status: 'ok' | 'error';
  toolCount: number;
  enabledToolCount: number;
  failure: string;
  tools: McpInspectionToolItem[];
}

export interface McpInspectionSnapshot {
  ok: boolean;
  summary: string;
  servers: McpInspectionServerItem[];
  configErrors: string[];
  failures: Array<{ server: string; message: string }>;
}

function summarizeSchema(schema: Record<string, unknown> | undefined): string {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return 'без inputSchema';
  }
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? Object.keys(schema.properties as Record<string, unknown>)
    : [];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];
  if (properties.length === 0 && required.length === 0) {
    return 'схема без полей';
  }
  const requiredPart = required.length > 0 ? `обязательных: ${required.slice(0, 4).join(', ')}` : '';
  const propertyPart = properties.length > 0 ? `поля: ${properties.slice(0, 6).join(', ')}` : '';
  return [requiredPart, propertyPart].filter(Boolean).join(' • ');
}

function toInspectionToolItem(tool: McpToolDescriptor, disabledSet: Set<string>): McpInspectionToolItem {
  return {
    key: buildMcpToolKey(tool.server, tool.name),
    server: tool.server,
    name: tool.name,
    title: String(tool.title || tool.name),
    description: String(tool.description || ''),
    schemaSummary: summarizeSchema(tool.inputSchema),
    readOnly: tool.annotations?.readOnlyHint === true,
    destructive: tool.annotations?.destructiveHint === true,
    enabled: !disabledSet.has(buildMcpToolKey(tool.server, tool.name)),
  };
}

export async function inspectMcpDraft(input: {
  mcpServers: Record<string, unknown>;
  mcpDisabledTools?: string[];
}): Promise<McpInspectionSnapshot> {
  const disabledSet = new Set(normalizeMcpDisabledTools(input.mcpDisabledTools || []));
  const registry = buildMcpServerRegistryFromMap(input.mcpServers || {}, {
    sourceLabel: 'draft: MCP settings',
    sourceKind: 'settings',
  });
  await Promise.all(
    Object.keys(registry.servers).map((serverName) => clearMcpClientCache(serverName).catch(() => undefined)),
  );
  const listResult = await listMcpToolsFromRegistry(registry);

  const serversByName = new Map<string, McpInspectionServerItem>();
  for (const server of Object.values(registry.servers)) {
    const failure = listResult.failures.find((item) => item.server === server.name)?.message || '';
    serversByName.set(server.name, {
      name: server.name,
      type: server.type,
      sourceLabel: server.sourceLabel,
      status: failure ? 'error' : 'ok',
      toolCount: 0,
      enabledToolCount: 0,
      failure,
      tools: [],
    });
  }

  listResult.tools.forEach((tool) => {
    const server = serversByName.get(tool.server);
    if (!server) return;
    const item = toInspectionToolItem(tool, disabledSet);
    server.tools.push(item);
    server.toolCount += 1;
    if (item.enabled) {
      server.enabledToolCount += 1;
    }
  });

  const servers = [...serversByName.values()].sort((left, right) => left.name.localeCompare(right.name));
  const okServerCount = servers.filter((server) => server.status === 'ok').length;
  const enabledToolCount = servers.reduce((sum, server) => sum + server.enabledToolCount, 0);
  const toolCount = servers.reduce((sum, server) => sum + server.toolCount, 0);
  const summary = servers.length === 0
    ? 'MCP серверы ещё не добавлены.'
    : `Серверов: ${servers.length} • доступно tools: ${enabledToolCount}/${toolCount} • успешно проверено: ${okServerCount}/${servers.length}`;

  return {
    ok: servers.length > 0 && listResult.failures.length === 0 && registry.errors.length === 0,
    summary,
    servers,
    configErrors: registry.errors,
    failures: listResult.failures,
  };
}
