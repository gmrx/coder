import { resolveCanonicalToolName } from './catalog';

export function resolveToolAlias(toolName: string, args: any): { toolName: string; args: any } {
  switch (toolName) {
    case 'search':
    case 'search_files':
    case 'find':
      return { toolName: args?.pattern && !args?.path ? 'find_files' : 'grep', args };
    default:
      return { toolName: resolveCanonicalToolName(toolName), args };
  }
}
