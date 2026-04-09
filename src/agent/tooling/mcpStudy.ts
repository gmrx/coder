import { truncate } from '../../core/utils';
import type { StructuredPresentationSection } from './presentationItems';
import type {
  McpAuthResult,
  McpCallToolResult,
  McpListResourcesResult,
  McpListToolsResult,
  McpReadResourceContent,
  McpReadResourceResult,
  McpResourceDescriptor,
  McpToolCallContentPart,
  McpToolDescriptor,
} from '../mcp/types';

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function hasText(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function truncateLine(text: string, maxLength = 180): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function buildReadTemplate(resource: McpResourceDescriptor): string {
  return JSON.stringify({
    tool: 'read_mcp_resource',
    args: {
      server: resource.server,
      uri: resource.uri,
    },
  });
}

function buildListResourcesTemplate(server?: string): string {
  return JSON.stringify({
    tool: 'list_mcp_resources',
    args: server ? { server } : {},
  });
}

function buildListToolsTemplate(server?: string): string {
  return JSON.stringify({
    tool: 'list_mcp_tools',
    args: server ? { server } : {},
  });
}

export function buildMcpToolTemplate(server: string, toolName: string, inputSchema?: Record<string, unknown>): string {
  if (isCommandWrapperInputSchema(inputSchema)) {
    return JSON.stringify({
      tool: 'mcp_tool',
      args: {
        server,
        name: toolName,
        arguments: {
          command: '<полная команда согласно описанию MCP tool>',
        },
      },
    });
  }
  const properties =
    inputSchema && typeof inputSchema.properties === 'object' && inputSchema.properties && !Array.isArray(inputSchema.properties)
      ? inputSchema.properties as Record<string, unknown>
      : {};
  const exampleArgs = Object.keys(properties)
    .slice(0, 4)
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = '<value>';
      return acc;
    }, {});
  return JSON.stringify({
    tool: 'mcp_tool',
    args: {
      server,
      name: toolName,
      arguments: exampleArgs,
    },
  });
}

function isStringSchema(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  if (type === 'string') return true;
  return Array.isArray(type) && type.includes('string');
}

export function isCommandWrapperInputSchema(inputSchema?: Record<string, unknown>): boolean {
  if (!inputSchema || typeof inputSchema !== 'object') return false;
  const properties =
    inputSchema.properties && typeof inputSchema.properties === 'object' && !Array.isArray(inputSchema.properties)
      ? inputSchema.properties as Record<string, unknown>
      : {};
  const keys = Object.keys(properties);
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((value): value is string => typeof value === 'string')
    : [];
  return keys.length === 1 && keys[0] === 'command' && required.includes('command') && isStringSchema(properties.command);
}

function getSchemaProperties(inputSchema?: Record<string, unknown>): Record<string, unknown> {
  if (!inputSchema || typeof inputSchema !== 'object') return {};
  return inputSchema.properties && typeof inputSchema.properties === 'object' && !Array.isArray(inputSchema.properties)
    ? inputSchema.properties as Record<string, unknown>
    : {};
}

function getSchemaRequired(inputSchema?: Record<string, unknown>): string[] {
  if (!inputSchema || typeof inputSchema !== 'object' || !Array.isArray(inputSchema.required)) return [];
  return inputSchema.required.filter((value): value is string => typeof value === 'string');
}

function describeSchemaType(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'any';
  const schema = value as {
    type?: unknown;
    enum?: unknown[];
    anyOf?: unknown[];
    oneOf?: unknown[];
    properties?: Record<string, unknown>;
  };
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return `enum(${schema.enum.slice(0, 4).map((item) => JSON.stringify(item)).join(', ')})`;
  }
  if (schema.type === 'array') {
    return 'array';
  }
  if (schema.type === 'object' || (schema.properties && typeof schema.properties === 'object')) {
    return 'object';
  }
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type) && schema.type.length > 0) {
    return schema.type.filter((item): item is string => typeof item === 'string').join('|') || 'any';
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) return 'anyOf';
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return 'oneOf';
  return 'any';
}

export function describeMcpInputSchema(inputSchema?: Record<string, unknown>): string {
  if (!inputSchema || typeof inputSchema !== 'object') return 'schema не указана';
  if (isCommandWrapperInputSchema(inputSchema)) {
    return 'только command:string (вся CLI-строка целиком)';
  }

  const properties = getSchemaProperties(inputSchema);
  const required = new Set(getSchemaRequired(inputSchema));
  const keys = Object.keys(properties);
  if (keys.length === 0) {
    return 'объект аргументов произвольной формы';
  }

  const requiredKeys = keys.filter((key) => required.has(key)).slice(0, 4);
  const optionalKeys = keys.filter((key) => !required.has(key)).slice(0, 4);
  const typeSample = keys
    .slice(0, 4)
    .map((key) => `${key}:${describeSchemaType(properties[key])}`)
    .join(', ');

  return [
    requiredKeys.length > 0 ? `обязательные: ${requiredKeys.join(', ')}` : '',
    optionalKeys.length > 0 ? `опциональные: ${optionalKeys.join(', ')}` : '',
    typeSample ? `поля: ${typeSample}` : '',
  ].filter(Boolean).join(' • ') || 'объект аргументов';
}

function formatFailureLines(failures: Array<{ server: string; message: string }>): string[] {
  if (failures.length === 0) return [];
  return [
    'Проблемы подключения:',
    ...failures.map((failure) => `- ${failure.server}: ${truncateLine(failure.message, 220)}`),
    '',
  ];
}

function formatConfigErrorLines(errors: string[]): string[] {
  if (errors.length === 0) return [];
  return [
    'Проблемы конфигурации:',
    ...errors.map((error) => `- ${truncateLine(error, 220)}`),
    '',
  ];
}

export interface McpResourcesPresentation {
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  server?: string;
  serverCount: number;
  resourceCount: number;
  failures: number;
  unsupported: number;
  sources: string[];
  sections?: StructuredPresentationSection[];
}

export interface McpResourceReadPresentation {
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  server: string;
  uri: string;
  contentCount: number;
  binaryCount: number;
  sourceLabel?: string;
  sections?: StructuredPresentationSection[];
}

export interface McpToolsPresentation {
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  server?: string;
  serverCount: number;
  toolCount: number;
  failures: number;
  unsupported: number;
  sections?: StructuredPresentationSection[];
}

export interface McpToolCallPresentation {
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  server: string;
  toolName: string;
  isError: boolean;
  partCount: number;
  sections?: StructuredPresentationSection[];
}

export interface McpAuthPresentation {
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  server: string;
  browserOpened?: boolean;
  callbackPort?: number;
  verifiedTools?: number;
  sections?: StructuredPresentationSection[];
}

export function buildListMcpResourcesPresentation(
  input: McpListResourcesResult & { server?: string },
): McpResourcesPresentation {
  const top = input.resources[0];
  const preview = input.resources.length > 0
    ? input.resources
      .slice(0, 6)
      .map((resource) => {
        const meta = [resource.server, resource.mimeType, formatBytes(resource.size)].filter(Boolean).join(' • ');
        return `- ${resource.name} — ${resource.uri}${meta ? ` (${meta})` : ''}`;
      })
      .join('\n')
    : [
      input.failures.length > 0
        ? 'MCP серверы найдены, но список ресурсов получить не удалось.'
        : input.unsupported.length > 0
          ? 'У подключённых серверов нет MCP resources API.'
          : 'MCP ресурсы не найдены.',
      ...input.configErrors.slice(0, 2).map((error) => `- ${truncateLine(error, 180)}`),
    ].filter(Boolean).join('\n');

  return {
    summary: input.resources.length === 0
      ? input.unsupported.length > 0 && input.failures.length === 0
        ? 'MCP resources не поддерживаются'
        : 'Ресурсы MCP не найдены'
      : `Нашёл ${input.resources.length} ${pluralize(input.resources.length, 'ресурс', 'ресурса', 'ресурсов')} MCP`,
    detail: [
      `${input.serverCount} ${pluralize(input.serverCount, 'сервер', 'сервера', 'серверов')}`,
      `${input.resources.length} ${pluralize(input.resources.length, 'ресурс', 'ресурса', 'ресурсов')}`,
      input.failures.length > 0 ? `ошибок: ${input.failures.length}` : '',
      input.unsupported.length > 0 ? `без resources API: ${input.unsupported.length}` : '',
      input.server ? `server: ${input.server}` : '',
    ].filter(Boolean).join(' • '),
    ...(preview ? { preview } : {}),
    ...(top ? { nextStep: `Прочитай лучший ресурс: ${buildReadTemplate(top)}` } : {}),
    ...(input.server ? { server: input.server } : {}),
    serverCount: input.serverCount,
    resourceCount: input.resources.length,
    failures: input.failures.length,
    unsupported: input.unsupported.length,
    sources: input.sources,
    sections: [
      ...(input.resources.length > 0
        ? [{
          title: 'Ресурсы',
          items: input.resources.slice(0, 8).map((resource) => ({
            title: resource.title || resource.name,
            subtitle: `${resource.server} • ${resource.uri}`,
            meta: [resource.mimeType, formatBytes(resource.size), truncateLine(resource.description || '', 120)]
              .filter(Boolean)
              .join(' • '),
          })),
        }]
        : []),
      ...(input.failures.length > 0
        ? [{
          title: 'Ошибки подключения',
          items: input.failures.slice(0, 6).map((failure) => ({
            title: failure.server,
            subtitle: truncateLine(failure.message, 180),
          })),
        }]
        : []),
      ...(input.unsupported.length > 0
        ? [{
          title: 'Без resources API',
          items: input.unsupported.slice(0, 6).map((item) => ({
            title: item.server,
            subtitle: truncateLine(item.reason, 180),
          })),
        }]
        : []),
      ...(input.configErrors.length > 0
        ? [{
          title: 'Проблемы конфигурации',
          items: input.configErrors.slice(0, 6).map((error) => ({
            title: truncateLine(error, 160),
          })),
        }]
        : []),
    ],
  };
}

export function formatListMcpResourcesResult(
  result: McpListResourcesResult,
  options: { server?: string } = {},
): string {
  const lines = [
    options.server
      ? `list_mcp_resources server="${options.server}"`
      : 'list_mcp_resources',
    '',
  ];

  if (result.resources.length === 0) {
    lines.push(
      result.unsupported.length > 0 && result.failures.length === 0
        ? 'У подключённых серверов нет MCP resources API.'
        : 'MCP ресурсы не найдены.',
    );
    lines.push('');
    if (result.unsupported.length > 0) {
      lines.push('Серверы без resources API:');
      lines.push(...result.unsupported.map((item) => `- ${item.server}: ${truncateLine(item.reason, 220)}`));
      lines.push('');
    }
    lines.push(...formatFailureLines(result.failures));
    lines.push(...formatConfigErrorLines(result.configErrors));
    if (result.sources.length > 0) {
      lines.push(`Источники конфигурации: ${result.sources.join(', ')}`);
      lines.push('');
    }
    lines.push('Следующий удобный шаг: проверь конфиг MCP или укажи конкретный server.');
    return lines.join('\n').trim();
  }

  lines.push(
    `Найдено ${result.resources.length} ${pluralize(result.resources.length, 'ресурс', 'ресурса', 'ресурсов')} ` +
    `на ${result.serverCount} ${pluralize(result.serverCount, 'сервере', 'серверах', 'серверах')}.`,
  );
  if (result.sources.length > 0) {
    lines.push(`Источники конфигурации: ${result.sources.join(', ')}`);
  }
  lines.push('');
  lines.push(...formatFailureLines(result.failures));
  lines.push(...formatConfigErrorLines(result.configErrors));

  for (const [index, resource] of result.resources.entries()) {
    lines.push(`${index + 1}. ${resource.title || resource.name}`);
    lines.push(`   ${resource.server} • ${resource.uri}`);
    if (resource.mimeType) lines.push(`   mime: ${resource.mimeType}`);
    if (resource.size) lines.push(`   size: ${formatBytes(resource.size)}`);
    if (resource.description) lines.push(`   ${truncateLine(resource.description, 220)}`);
  }
  lines.push('');
  lines.push(`Следующий удобный шаг: ${buildReadTemplate(result.resources[0])}`);
  return truncate(lines.join('\n').trim(), 16_000);
}

function buildReadContentPreview(content: McpReadResourceContent): string {
  if (content.text) return truncate(content.text, 2_400);
  if (content.blobSavedTo) {
    const meta = [content.mimeType, formatBytes(content.size)].filter(Boolean).join(' • ');
    return `Бинарный ресурс сохранён: ${content.blobSavedTo}${meta ? `\n${meta}` : ''}`;
  }
  return [content.uri, content.mimeType].filter(Boolean).join(' • ');
}

export function buildReadMcpResourcePresentation(result: McpReadResourceResult): McpResourceReadPresentation {
  const binaryCount = result.contents.filter((content) => !!content.blobSavedTo).length;
  const first = result.contents[0];
  return {
    summary: result.contents.length === 0
      ? 'Ресурс MCP не вернул содержимое'
      : binaryCount > 0 && binaryCount === result.contents.length
        ? 'Прочитал бинарный ресурс MCP'
        : 'Прочитал ресурс MCP',
    detail: [
      result.server,
      `${result.contents.length} ${pluralize(result.contents.length, 'часть', 'части', 'частей')} содержимого`,
      binaryCount > 0 ? `бинарных: ${binaryCount}` : '',
      result.sourceLabel ? `источник: ${result.sourceLabel}` : '',
    ].filter(Boolean).join(' • '),
    ...(first ? { preview: buildReadContentPreview(first) } : {}),
    nextStep: result.contents.length > 0
      ? `Если нужен другой URI этого сервера, вернись к списку: ${buildListResourcesTemplate(result.server)}`
      : `Проверь URI или сначала перечитай список ресурсов: ${buildListResourcesTemplate(result.server)}`,
    server: result.server,
    uri: result.uri,
    contentCount: result.contents.length,
    binaryCount,
    ...(result.sourceLabel ? { sourceLabel: result.sourceLabel } : {}),
    sections: result.contents.length > 0
      ? [{
        title: 'Содержимое',
        items: result.contents.slice(0, 6).map((content) => ({
          title: content.uri,
          subtitle: [content.mimeType, content.blobSavedTo ? 'binary' : 'text', formatBytes(content.size)].filter(Boolean).join(' • '),
          meta: truncateLine(content.blobSavedTo || content.text || '', 160),
        })),
      }]
      : [],
  };
}

export function formatReadMcpResourceResult(result: McpReadResourceResult): string {
  const lines = [
    `read_mcp_resource ${result.server} ${result.uri}`,
    '',
    `Сервер: ${result.server}`,
    `URI: ${result.uri}`,
    result.sourceLabel ? `Источник конфигурации: ${result.sourceLabel}` : '',
    '',
  ].filter(Boolean);

  if (result.contents.length === 0) {
    lines.push('Сервер вернул пустой contents[].');
    lines.push('');
    lines.push(`Следующий удобный шаг: ${buildListResourcesTemplate(result.server)}`);
    return lines.join('\n').trim();
  }

  result.contents.forEach((content, index) => {
    lines.push(`=== [${index + 1}/${result.contents.length}] ${content.uri} ===`);
    if (content.mimeType) lines.push(`mime: ${content.mimeType}`);
    if (content.size) lines.push(`size: ${formatBytes(content.size)}`);
    if (content.blobSavedTo) {
      lines.push(`saved_to: ${content.blobSavedTo}`);
      if (content.text) lines.push(content.text);
    } else if (content.text) {
      lines.push(content.text);
    }
    lines.push('');
  });

  lines.push(`Следующий удобный шаг: ${buildListResourcesTemplate(result.server)}`);
  return truncate(lines.join('\n').trim(), 18_000);
}

function buildToolMetaLine(tool: McpToolDescriptor): string {
  return [
    tool.server,
    isCommandWrapperInputSchema(tool.inputSchema) ? 'command-wrapper' : '',
    describeMcpInputSchema(tool.inputSchema),
    tool.annotations?.readOnlyHint ? 'read-only' : '',
    tool.annotations?.destructiveHint ? 'destructive' : '',
    tool.annotations?.openWorldHint ? 'open-world' : '',
  ].filter(Boolean).join(' • ');
}

function buildMcpToolPreview(tool: McpToolDescriptor): string {
  const schema = tool.inputSchema ? truncate(JSON.stringify(tool.inputSchema, null, 2), 1_400) : '';
  const commandWrapperNote = isCommandWrapperInputSchema(tool.inputSchema)
    ? 'Этот MCP tool принимает всю команду целиком в arguments.command. Не дели вызов на command + args или prompt.'
    : '';
  const schemaSummary = describeMcpInputSchema(tool.inputSchema);
  return [
    commandWrapperNote,
    tool.description || tool.title || tool.name,
    schemaSummary ? `schema: ${schemaSummary}` : '',
    schema ? `inputSchema:\n${schema}` : '',
  ].filter(Boolean).join('\n\n');
}

export function buildListMcpToolsPresentation(
  input: McpListToolsResult & { server?: string },
): McpToolsPresentation {
  const first = input.tools[0];
  return {
    summary: input.tools.length === 0
      ? 'MCP tools не найдены'
      : `Нашёл ${input.tools.length} ${pluralize(input.tools.length, 'MCP tool', 'MCP tool-а', 'MCP tool-ов')}`,
    detail: [
      `${input.serverCount} ${pluralize(input.serverCount, 'сервер', 'сервера', 'серверов')}`,
      `${input.tools.length} ${pluralize(input.tools.length, 'tool', 'tool-а', 'tool-ов')}`,
      input.failures.length > 0 ? `ошибок: ${input.failures.length}` : '',
      input.unsupported.length > 0 ? `без tools API: ${input.unsupported.length}` : '',
      input.server ? `server: ${input.server}` : '',
    ].filter(Boolean).join(' • '),
    ...(first ? { preview: buildMcpToolPreview(first) } : {}),
    ...(first ? { nextStep: `Вызови лучший MCP tool: ${buildMcpToolTemplate(first.server, first.name, first.inputSchema)}` } : {}),
    ...(input.server ? { server: input.server } : {}),
    serverCount: input.serverCount,
    toolCount: input.tools.length,
    failures: input.failures.length,
    unsupported: input.unsupported.length,
    sections: [
      ...(input.tools.length > 0
        ? [{
          title: 'MCP tools',
          items: input.tools.slice(0, 8).map((tool) => ({
            title: tool.title || tool.name,
            subtitle: `${tool.server} • ${tool.name}`,
            meta: [buildToolMetaLine(tool), truncateLine(tool.description || '', 120)].filter(Boolean).join(' • '),
          })),
        }]
        : []),
      ...(input.failures.length > 0
        ? [{
          title: 'Ошибки подключения',
          items: input.failures.slice(0, 6).map((failure) => ({
            title: failure.server,
            subtitle: truncateLine(failure.message, 180),
          })),
        }]
        : []),
      ...(input.unsupported.length > 0
        ? [{
          title: 'Без tools API',
          items: input.unsupported.slice(0, 6).map((item) => ({
            title: item.server,
            subtitle: truncateLine(item.reason, 180),
          })),
        }]
        : []),
      ...(input.configErrors.length > 0
        ? [{
          title: 'Проблемы конфигурации',
          items: input.configErrors.slice(0, 6).map((error) => ({
            title: truncateLine(error, 160),
          })),
        }]
        : []),
    ],
  };
}

export function formatListMcpToolsResult(
  result: McpListToolsResult,
  options: { server?: string } = {},
): string {
  const lines = [
    options.server ? `list_mcp_tools server="${options.server}"` : 'list_mcp_tools',
    '',
  ];

  if (result.tools.length === 0) {
    lines.push('MCP tools не найдены.');
    lines.push('');
    if (result.unsupported.length > 0) {
      lines.push('Серверы без tools API:');
      lines.push(...result.unsupported.map((item) => `- ${item.server}: ${truncateLine(item.reason, 220)}`));
      lines.push('');
    }
    lines.push(...formatFailureLines(result.failures));
    lines.push(...formatConfigErrorLines(result.configErrors));
    lines.push(`Следующий удобный шаг: ${options.server ? buildListToolsTemplate(options.server) : 'проверь MCP конфиг и аутентификацию.'}`);
    return lines.join('\n').trim();
  }

  lines.push(
    `Найдено ${result.tools.length} ${pluralize(result.tools.length, 'tool', 'tool-а', 'tool-ов')} ` +
    `на ${result.serverCount} ${pluralize(result.serverCount, 'сервере', 'серверах', 'серверах')}.`,
  );
  if (result.sources.length > 0) lines.push(`Источники конфигурации: ${result.sources.join(', ')}`);
  lines.push('');
  lines.push(...formatFailureLines(result.failures));
  lines.push(...formatConfigErrorLines(result.configErrors));
  for (const [index, tool] of result.tools.entries()) {
    lines.push(`${index + 1}. ${tool.title || tool.name}`);
    lines.push(`   ${tool.server} • ${tool.name}`);
    if (tool.description) lines.push(`   ${truncateLine(tool.description, 220)}`);
    lines.push(`   schema: ${describeMcpInputSchema(tool.inputSchema)}`);
    if (isCommandWrapperInputSchema(tool.inputSchema)) {
      lines.push('   command-wrapper: передавай всю CLI-строку целиком в arguments.command');
    }
    if (tool.annotations?.readOnlyHint) lines.push('   readOnlyHint: true');
    if (tool.annotations?.destructiveHint) lines.push('   destructiveHint: true');
  }
  lines.push('');
  lines.push(`Следующий удобный шаг: ${buildMcpToolTemplate(result.tools[0].server, result.tools[0].name, result.tools[0].inputSchema)}`);
  return truncate(lines.join('\n').trim(), 18_000);
}

function buildMcpPartPreview(part: McpToolCallContentPart): string {
  if (part.text) return truncate(part.text, 2_400);
  return [part.uri, part.mimeType, part.savedTo].filter(Boolean).join('\n');
}

export function buildMcpToolCallPresentation(
  result: McpCallToolResult,
  options: { previewPrefix?: string; nextStep?: string } = {},
): McpToolCallPresentation {
  const first = result.parts[0];
  const preview = [options.previewPrefix, first ? buildMcpPartPreview(first) : '']
    .filter(Boolean)
    .join('\n\n');
  return {
    summary: result.isError ? 'MCP tool завершился с ошибкой' : 'Вызов MCP tool завершён',
    detail: [
      result.server,
      result.toolName,
      `${result.parts.length} ${pluralize(result.parts.length, 'часть', 'части', 'частей')} результата`,
      result.isError ? 'isError=true' : '',
      result.sourceLabel ? `источник: ${result.sourceLabel}` : '',
    ].filter(Boolean).join(' • '),
    ...(preview ? { preview } : {}),
    nextStep: options.nextStep || `Если нужен другой tool этого сервера, вернись к списку: ${buildListToolsTemplate(result.server)}`,
    server: result.server,
    toolName: result.toolName,
    isError: result.isError,
    partCount: result.parts.length,
    sections: result.parts.length > 0
      ? [{
        title: 'Результат MCP tool',
        items: result.parts.slice(0, 8).map((part) => ({
          title: part.title,
          subtitle: [part.kind, part.uri].filter(Boolean).join(' • '),
          meta: [part.mimeType, part.savedTo, truncateLine(part.text || '', 120)].filter(Boolean).join(' • '),
        })),
      }]
      : [],
  };
}

export function formatMcpToolCallResult(
  result: McpCallToolResult,
  options: { previewPrefix?: string; nextStep?: string } = {},
): string {
  const lines = [
    `mcp_tool ${result.server} ${result.toolName}`,
    '',
    `Сервер: ${result.server}`,
    `Tool: ${result.toolName}`,
    result.sourceLabel ? `Источник конфигурации: ${result.sourceLabel}` : '',
    result.isError ? 'isError: true' : '',
    '',
  ].filter(Boolean);

  if (options.previewPrefix) {
    lines.push(options.previewPrefix);
    lines.push('');
  }

  if (result.parts.length === 0) {
    lines.push('MCP tool вернул пустой content[].');
  } else {
    result.parts.forEach((part, index) => {
      lines.push(`=== [${index + 1}/${result.parts.length}] ${part.title} ===`);
      if (part.uri) lines.push(`uri: ${part.uri}`);
      if (part.mimeType) lines.push(`mime: ${part.mimeType}`);
      if (part.savedTo) lines.push(`saved_to: ${part.savedTo}`);
      if (part.text) lines.push(part.text);
      lines.push('');
    });
  }

  if (result.structuredContent !== undefined) {
    lines.push('structuredContent:');
    lines.push(truncate(JSON.stringify(result.structuredContent, null, 2), 6_000));
    lines.push('');
  }
  lines.push(`Следующий удобный шаг: ${options.nextStep || buildListToolsTemplate(result.server)}`);
  return truncate(lines.join('\n').trim(), 18_000);
}

export function buildMcpAuthPresentation(
  result: McpAuthResult,
  options?: { success?: boolean; preview?: string; nextStep?: string },
): McpAuthPresentation {
  const success = options?.success !== false;
  return {
    summary: success ? 'MCP OAuth завершён' : 'Не удалось завершить MCP OAuth',
    detail: [
      result.server,
      result.browserOpened === false ? 'браузер открыть не удалось' : 'браузер открыт',
      typeof result.callbackPort === 'number' ? `callback: ${result.callbackPort}` : '',
      typeof result.verifiedTools === 'number' ? `tools: ${result.verifiedTools}` : '',
      result.sourceLabel ? `источник: ${result.sourceLabel}` : '',
    ].filter(Boolean).join(' • '),
    ...(options?.preview ? { preview: options.preview } : {}),
    nextStep: options?.nextStep || `Проверь доступные MCP tools: ${buildListToolsTemplate(result.server)}`,
    server: result.server,
    ...(typeof result.browserOpened === 'boolean' ? { browserOpened: result.browserOpened } : {}),
    ...(typeof result.callbackPort === 'number' ? { callbackPort: result.callbackPort } : {}),
    ...(typeof result.verifiedTools === 'number' ? { verifiedTools: result.verifiedTools } : {}),
    sections: [{
      title: 'OAuth',
      items: [{
        title: result.server,
        subtitle: result.authUrl || result.sourceLabel,
        meta: [result.clientId ? `clientId: ${result.clientId}` : '', result.scope ? `scope: ${result.scope}` : '']
          .filter(Boolean)
          .join(' • '),
      }],
    }],
  };
}

export function formatMcpAuthResult(
  result: McpAuthResult,
  options?: { success?: boolean; message?: string },
): string {
  const lines = [
    `mcp_auth ${result.server}`,
    '',
    options?.success === false ? 'OAuth не завершён.' : 'OAuth завершён.',
    result.authUrl ? `auth_url: ${result.authUrl}` : '',
    typeof result.callbackPort === 'number' ? `callback_port: ${result.callbackPort}` : '',
    result.clientId ? `client_id: ${result.clientId}` : '',
    result.scope ? `scope: ${result.scope}` : '',
    typeof result.verifiedTools === 'number' ? `verified_tools: ${result.verifiedTools}` : '',
    options?.message || '',
    '',
    `Следующий удобный шаг: ${buildListToolsTemplate(result.server)}`,
  ].filter(Boolean);
  return truncate(lines.join('\n').trim(), 12_000);
}

export function buildBlockedMcpAuthPresentation(
  server: string,
  sourceLabel: string,
  message: string,
): McpAuthPresentation {
  return buildMcpAuthPresentation(
    {
      server,
      sourceLabel,
    },
    {
      success: false,
      preview: message,
      nextStep: server ? `Проверь конфиг этого сервера и повтори mcp_auth для ${server}.` : 'Проверь MCP конфиг.',
    },
  );
}
