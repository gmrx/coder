const MCP_SUBAGENT_ALLOWED_TOOLS = new Set([
  'tool_search',
  'list_mcp_tools',
  'mcp_tool',
  'list_mcp_resources',
  'read_mcp_resource',
]);

export function isMcpFocusedSubagentTask(...parts: Array<string | undefined | null>): boolean {
  const text = parts
    .map((part) => String(part || '').trim().toLowerCase())
    .filter(Boolean)
    .join('\n');

  if (!text) return false;

  return /(hubthe|mcp\b|mcp_|mcp-|remote tool|remote action|list_projects|set_project|list_my_tasks|list_project_participants|search_tasks|whoami|projects|tasks|participants|участник|участники|исполнител|проекты|задачи|спринт|project guid|project_guid)/.test(text);
}

export function narrowAllowedToolsForMcpFocus(allowed: Set<string>): Set<string> {
  const narrowed = new Set<string>();
  for (const toolName of allowed) {
    if (MCP_SUBAGENT_ALLOWED_TOOLS.has(toolName)) {
      narrowed.add(toolName);
    }
  }
  return narrowed;
}
