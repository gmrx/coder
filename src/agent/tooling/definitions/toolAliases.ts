import { TOOL_DEFINITIONS } from './toolDefinitions';

const TOOL_ALIAS_MAP = new Map<string, string>();

for (const definition of TOOL_DEFINITIONS) {
  TOOL_ALIAS_MAP.set(definition.name, definition.name);
  for (const alias of definition.aliases || []) {
    TOOL_ALIAS_MAP.set(alias, definition.name);
  }
}

export function resolveCanonicalToolName(toolName: string): string {
  return TOOL_ALIAS_MAP.get(toolName) || toolName;
}

export function listKnownToolNames(): string[] {
  return TOOL_DEFINITIONS.map((definition) => definition.name);
}
