import { listKnownToolNames } from './toolAliases';
import { getToolCapabilityNotes } from './toolCapabilities';
import { listPrimaryToolDefinitions, listSpecializedToolDefinitions } from './toolSearch';
import type { ToolDefinition } from './toolDefinitions';
import {
  getToolPromptAvoidWhen,
  getToolPromptGuidance,
  getToolPromptStyle,
  getToolPromptWhenToUse,
} from './toolPromptPresentation';

export function getUnknownToolMessage(toolName: string): string {
  return `Неизвестная утилита "${toolName}". Доступные: ${listKnownToolNames().join(', ')}.`;
}

export function buildToolsDescription(): string {
  const sections: string[] = [
    '## Каталог утилит',
    '',
    'Ниже подробно описаны основные утилиты, которые должны покрывать большинство ходов.',
    'Если нужен более специализированный инструмент или ты не уверен, какой capability подходит лучше, сначала вызови tool_search.',
    '',
    'Пример:',
    '```json',
    '{ "tool": "tool_search", "args": { "query": "как лучше проверить нетривиальные изменения перед финальным ответом" } }',
    '```',
    '',
    '## Основные утилиты',
    '',
  ];

  for (const definition of listPrimaryToolDefinitions()) {
    if (getToolPromptStyle(definition) === 'compact') {
      sections.push(buildCompactToolLine(definition));
      sections.push('');
      continue;
    }
    sections.push(...buildDetailedToolSection(definition));
  }

  sections.push('## Специализированные утилиты');
  sections.push('');
  sections.push('Эти утилиты обычно нужны только в конкретных сценариях, поэтому здесь показаны кратко.');
  sections.push('Если задача звучит неочевидно, используй tool_search: он подскажет подходящий инструмент и даст шаблон вызова.');
  sections.push('');

  for (const definition of listSpecializedToolDefinitions()) {
    if (getToolPromptStyle(definition) === 'detailed') {
      sections.push(...buildDetailedToolSection(definition));
      continue;
    }
    if (getToolPromptStyle(definition) === 'compact') {
      sections.push(buildCompactToolLine(definition));
      continue;
    }
    sections.push(buildPresenceToolLine(definition));
  }

  return sections.join('\n').trim();
}

function buildDetailedToolSection(definition: ToolDefinition): string[] {
  const lines = [`### ${definition.name}`, definition.summary];
  const capabilityLines: string[] = [];

  if (definition.capabilities?.userFacingName) {
    capabilityLines.push(`Отображаемое имя: ${definition.capabilities.userFacingName}`);
  }
  if (definition.capabilities?.readOnly) {
    capabilityLines.push('Только чтение.');
  }
  if (definition.capabilities?.concurrencySafe) {
    capabilityLines.push('Можно безопасно комбинировать в tool_batch.');
  }
  if (definition.capabilities?.approval) {
    capabilityLines.push('Требует подтверждения пользователя.');
  }
  if (definition.capabilities?.requiresUserInteraction) {
    capabilityLines.push('Требует явного взаимодействия пользователя.');
  }
  if (definition.capabilities?.destructive) {
    capabilityLines.push('Потенциально опасное действие.');
  }
  if (definition.capabilities?.shouldDefer) {
    capabilityLines.push('Лучше вызывать только когда это действительно нужно, а не первым ходом без причины.');
  }
  const whenToUse = getToolPromptWhenToUse(definition);
  if (whenToUse.length > 0) {
    capabilityLines.push(`Когда применять: ${whenToUse.join('; ')}.`);
  }
  const avoidWhen = getToolPromptAvoidWhen(definition);
  if (avoidWhen.length > 0) {
    capabilityLines.push(`Когда не применять: ${avoidWhen.join('; ')}.`);
  }
  const guidance = getToolPromptGuidance(definition);
  if (guidance) {
    capabilityLines.push(`Подсказка: ${guidance}`);
  }
  if (capabilityLines.length > 0) {
    lines.push(...capabilityLines);
  }

  if (definition.details && definition.details.length > 0) {
    lines.push(...definition.details);
  }

  if (definition.args && definition.args.length > 0) {
    lines.push('Аргументы:');
    for (const arg of definition.args) {
      lines.push(`  - ${arg.name}${arg.required ? ' (обязательно)' : ''}: ${arg.description}`);
    }
  } else {
    lines.push('Аргументы: нет');
  }

  if (definition.examples && definition.examples.length > 0) {
    lines.push('Примеры:');
    lines.push(...definition.examples.map((example) => `  ${example}`));
  }

  lines.push('');
  return lines;
}

function buildCompactToolLine(definition: ToolDefinition): string {
  const pieces = [`- ${definition.name} — ${definition.summary}`];

  const fit = getToolPromptWhenToUse(definition);
  if (fit.length > 0) {
    pieces.push(`Когда применять: ${fit.slice(0, 2).join('; ')}.`);
  }
  const guidance = getToolPromptGuidance(definition);
  if (guidance) {
    pieces.push(`Подсказка: ${guidance}`);
  }

  return pieces.join(' ');
}

function buildPresenceToolLine(definition: ToolDefinition): string {
  const fit = getToolPromptWhenToUse(definition);
  const guidance = getToolPromptGuidance(definition);
  const capabilityNotes = getToolCapabilityNotes(definition.name)
    .filter((note) => note !== 'только чтение')
    .slice(0, 2);
  const parts = ['- ' + definition.name];

  if (fit.length > 0) {
    parts.push('когда нужен: ' + fit.slice(0, 1).join('; '));
  } else {
    parts.push(definition.summary);
  }

  if (guidance) {
    parts.push(guidance);
  }
  if (capabilityNotes.length > 0) {
    parts.push('свойства: ' + capabilityNotes.join('; '));
  }

  return parts.join(' — ');
}
