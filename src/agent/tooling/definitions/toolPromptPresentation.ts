import type { ToolDefinition, ToolPromptGroup, ToolPromptPresentation, ToolPromptStyle } from './toolDefinitions';

export function getToolPromptPresentation(definition: ToolDefinition): ToolPromptPresentation {
  return definition.prompt || {};
}

export function getToolPromptGroup(definition: ToolDefinition): ToolPromptGroup {
  return getToolPromptPresentation(definition).group || (definition.alwaysLoad ? 'primary' : 'specialized');
}

export function getToolPromptStyle(definition: ToolDefinition): ToolPromptStyle {
  return getToolPromptPresentation(definition).style || (getToolPromptGroup(definition) === 'primary' ? 'detailed' : 'presence');
}

export function getToolPromptWhenToUse(definition: ToolDefinition): string[] {
  const prompt = getToolPromptPresentation(definition);
  if (prompt.whenToUse && prompt.whenToUse.length > 0) return prompt.whenToUse;
  return definition.searchHints?.slice(0, 3) || [];
}

export function getToolPromptAvoidWhen(definition: ToolDefinition): string[] {
  return getToolPromptPresentation(definition).avoidWhen || [];
}

export function getToolPromptGuidance(definition: ToolDefinition): string | undefined {
  return getToolPromptPresentation(definition).guidance;
}

export function buildToolPromptFit(definition: ToolDefinition, maxItems = 2): string | null {
  const whenToUse = getToolPromptWhenToUse(definition).slice(0, maxItems);
  if (whenToUse.length === 0) return null;
  return whenToUse.join('; ');
}
