import { ALL_SUBAGENT_MODES, NO_SUBAGENT_MODES, TOOL_DEFINITIONS, type ToolDefinition } from './toolDefinitions';

export function getToolDefinition(toolName: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((definition) => definition.name === toolName);
}

export function listExecutableToolNames(): string[] {
  return TOOL_DEFINITIONS.filter((definition) => !definition.virtual).map((definition) => definition.name);
}

export function getSubagentAllowedTools(subagentType: string, readonly: boolean): Set<string> {
  const normalizedType =
    subagentType === 'shell' ||
    subagentType === 'generalPurpose' ||
    subagentType === 'verification'
      ? subagentType
      : 'explore';
  const allowed = new Set<string>();

  for (const definition of TOOL_DEFINITIONS) {
    if (definition.virtual) continue;
    const modes = definition.subagentModes || NO_SUBAGENT_MODES;
    if (!modes.includes(normalizedType)) continue;
    if (readonly && (definition.mutatesWorkspace || definition.requiresShellAccess)) continue;
    allowed.add(definition.name);
  }

  allowed.delete('subagent');
  allowed.delete('final_answer');
  return allowed;
}
