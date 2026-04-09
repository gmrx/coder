import { truncate } from '../../../core/utils';
import type { ToolExecutionResult } from '../../tooling/results';

export class RetrievalMemory {
  toolCalls = 0;
  subagentBatches = 0;
  subagentTasks = 0;
  keyFacts: string[] = [];
  freshMcpCatalogReads = 0;
  freshMcpToolCalls = 0;
  freshMcpFacts: string[] = [];

  noteToolCall(): void {
    this.toolCalls++;
  }

  noteSubagentBatch(content: string): void {
    this.subagentBatches++;
    const taskMatch = content.match(/Subagent batch:\s*(\d+)\s+задач/i);
    if (taskMatch) this.subagentTasks += Number(taskMatch[1]) || 0;
  }

  addFact(fact: string): void {
    const normalized = fact.trim();
    if (!normalized) return;
    if (this.keyFacts.includes(normalized)) return;
    this.keyFacts.push(normalized);
    if (this.keyFacts.length > 24) {
      this.keyFacts = this.keyFacts.slice(-24);
    }
  }

  addFreshMcpFact(fact: string): void {
    const normalized = fact.trim();
    if (!normalized) return;
    if (this.freshMcpFacts.includes(normalized)) return;
    this.freshMcpFacts.push(normalized);
    if (this.freshMcpFacts.length > 12) {
      this.freshMcpFacts = this.freshMcpFacts.slice(-12);
    }
  }

  addToolFact(tool: string, content: string, result?: string | ToolExecutionResult): void {
    if (tool === 'detect_stack') this.addFact(`Стек/инфра: ${truncate(content, 220)}`);
    if (tool === 'scan_structure') this.addFact(`Структура проекта: ${truncate(content, 220)}`);
    if (tool === 'list_files') this.addFact(`Файловый обзор: ${truncate(content, 220)}`);
    if (tool === 'find_relevant_files') this.addFact(`Релевантные файлы: ${truncate(content, 260)}`);
    if (tool === 'semantic_search') this.addFact(`Семантические совпадения: ${truncate(content, 260)}`);
    if (tool === 'subagent') this.addFact(`Итог subagent: ${truncate(content, 260)}`);
    const status = result && typeof result !== 'string' ? result.status : 'success';
    const isSuccessful = status === 'success' || status === 'degraded';

    if (tool === 'list_mcp_tools' && isSuccessful) {
      const summary = getStructuredSummary(result);
      const preview = getStructuredPreview(result);
      const catalogFact = extractMcpCatalogFact(result, content);
      const fact = `MCP tools: ${truncate(catalogFact || summary || preview || content, 260)}`;
      this.addFact(fact);
      this.addFreshMcpFact(fact);
      this.freshMcpCatalogReads++;
      const serverFact = extractMcpServerFact(result);
      if (serverFact) {
        const fact = `MCP серверы: ${truncate(serverFact, 220)}`;
        this.addFact(fact);
        this.addFreshMcpFact(fact);
      }
    }
    if (tool === 'mcp_tool' && isSuccessful) {
      const structured = result && typeof result !== 'string' ? result.meta?.presentation : null;
      const toolName = structured?.kind === 'mcp_tool_call' ? structured.data.toolName : '';
      const serverName = structured?.kind === 'mcp_tool_call' ? structured.data.server : '';
      const preview = getStructuredPreview(result);
      const summary = getStructuredSummary(result);
      const fact = extractMcpFact(preview || content);
      const title = [serverName, toolName].filter(Boolean).join('/') || toolName || 'MCP вызов';
      const memoryFact = `${title}: ${truncate(fact || summary || preview || content, 260)}`;
      this.addFact(memoryFact);
      this.addFreshMcpFact(memoryFact);
      this.freshMcpToolCalls++;
    }
  }
}

function extractMcpServerFact(result?: string | ToolExecutionResult): string {
  if (!result || typeof result === 'string') return '';
  const presentation = result.meta?.presentation;
  if (presentation?.kind !== 'mcp_tools') return '';
  const sections = presentation.data.sections || [];
  const toolSection = sections.find((section) => section.title === 'MCP tools');
  const servers = new Set<string>();
  for (const item of toolSection?.items || []) {
    const value = String(item.subtitle || '').trim();
    const server = value.split(' • ')[0]?.trim();
    if (server) servers.add(server);
  }
  if (presentation.data.server) {
    servers.add(String(presentation.data.server));
  }
  return [...servers].join(', ');
}

function extractMcpCatalogFact(result?: string | ToolExecutionResult, fallback = ''): string {
  if (!result || typeof result === 'string') return fallback;
  const presentation = result.meta?.presentation;
  if (presentation?.kind !== 'mcp_tools') return fallback;
  const sections = presentation.data.sections || [];
  const toolSection = sections.find((section) => section.title === 'MCP tools');
  const toolNames = (toolSection?.items || [])
    .slice(0, 5)
    .map((item) => item.title || item.subtitle)
    .filter(Boolean)
    .join(', ');
  const server = presentation.data.server || '';
  const count = presentation.data.toolCount;
  return [
    server ? `server=${server}` : '',
    typeof count === 'number' ? `tools=${count}` : '',
    toolNames ? `examples=${toolNames}` : '',
  ].filter(Boolean).join('; ');
}

function getStructuredSummary(result?: string | ToolExecutionResult): string {
  if (!result || typeof result === 'string') return '';
  const presentation = result.meta?.presentation;
  if (!presentation) return '';
  switch (presentation.kind) {
    case 'mcp_tool_call':
      return presentation.data.detail || presentation.data.summary || '';
    case 'mcp_tools':
      return presentation.data.detail || presentation.data.summary || '';
    default:
      return '';
  }
}

function getStructuredPreview(result?: string | ToolExecutionResult): string {
  if (!result || typeof result === 'string') return '';
  const presentation = result.meta?.presentation;
  if (!presentation) return '';
  switch (presentation.kind) {
    case 'mcp_tool_call':
      return presentation.data.preview || '';
    case 'mcp_tools':
      return presentation.data.preview || '';
    default:
      return '';
  }
}

function extractMcpFact(text: string): string {
  const source = String(text || '');
  const pairs: string[] = [];
  for (const key of ['name', 'email', 'guid', 'status', 'current_project', 'count']) {
    const match = source.match(new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|\\d+|true|false|null)`));
    if (!match) continue;
    const raw = match[1];
    const value = raw.startsWith('"')
      ? raw.slice(1, -1).replace(/\\"/g, '"')
      : raw;
    if (!value || value === 'null') continue;
    pairs.push(`${key}=${value}`);
  }
  if (pairs.length > 0) return pairs.join('; ');

  const firstJsonLine = source
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('{') || line.startsWith('"'));
  if (firstJsonLine) return firstJsonLine;

  return source.replace(/\s+/g, ' ').trim();
}
