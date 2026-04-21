import {
  clearMcpOAuthState,
  McpAuthCancelledError,
  McpAuthRequiredError,
  performMcpOAuthFlow,
} from '../../mcp/auth';
import { buildMcpConfigHelpText, loadMcpServerRegistry } from '../../mcp/config';
import {
  callMcpTool,
  clearMcpClientCache,
  listMcpResources,
  listMcpTools,
  readMcpResource,
} from '../../mcp/client';
import {
  classifyMcpToolExecutionPolicy,
  getMcpArgumentsArg,
  getMcpServerArg,
  getMcpToolNameArg,
} from '../../mcp/executionPolicy';
import { readConfig } from '../../../core/api';
import { filterDisabledMcpTools, isMcpToolDisabled } from '../../../core/mcpToolAvailability';
import { buildToolApprovalRequest } from '../catalog';
import {
  buildBlockedMcpAuthPresentation,
  buildMcpToolTemplate,
  buildListMcpResourcesPresentation,
  buildListMcpToolsPresentation,
  buildMcpAuthPresentation,
  buildMcpToolCallPresentation,
  describeMcpInputSchema,
  buildReadMcpResourcePresentation,
  formatListMcpResourcesResult,
  formatListMcpToolsResult,
  formatMcpAuthResult,
  formatMcpToolCallResult,
  formatReadMcpResourceResult,
  isCommandWrapperInputSchema,
} from '../mcpStudy';
import { createToolExecutionResult } from '../results';
import type { AgentApprovalResult } from '../../runtime/approvals';
import type { ToolHandlerMap } from '../types';

function hasText(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function makeConfirmId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function findMcpToolDescriptor(server: string, name: string) {
  const result = await listMcpTools(server);
  return result.tools.find((tool) => tool.server === server && tool.name === name);
}

function getMcpInputSchemaProperties(descriptor: { inputSchema?: Record<string, unknown> } | undefined): Record<string, unknown> {
  const schema = descriptor?.inputSchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {};
  const properties = schema.properties;
  return properties && typeof properties === 'object' && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : {};
}

function getMcpInputSchemaRequired(descriptor: { inputSchema?: Record<string, unknown> } | undefined): string[] {
  const schema = descriptor?.inputSchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || !Array.isArray(schema.required)) return [];
  return schema.required.filter((value): value is string => typeof value === 'string');
}

function isStringSchema(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  if (type === 'string') return true;
  return Array.isArray(type) && type.includes('string');
}

function isCommandWrapperDescriptor(descriptor: { inputSchema?: Record<string, unknown> } | undefined): boolean {
  return isCommandWrapperInputSchema(descriptor?.inputSchema);
}

function coerceCommandSuffix(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ');
  }
  return hasText(value) ? String(value).trim() : '';
}

function normalizeMcpToolArguments(
  descriptor: { inputSchema?: Record<string, unknown> } | undefined,
  rawArgs: Record<string, unknown>,
): { toolArgs: Record<string, unknown>; previewPrefix?: string } {
  if (!isCommandWrapperDescriptor(descriptor)) {
    return { toolArgs: rawArgs };
  }

  const directCommand = hasText(rawArgs.command) ? String(rawArgs.command).trim() : '';
  const argsSuffix = coerceCommandSuffix(rawArgs.args);
  const promptCommand = hasText(rawArgs.prompt) ? String(rawArgs.prompt).trim() : '';
  const queryCommand = hasText(rawArgs.query) ? String(rawArgs.query).trim() : '';
  let mergedCommand = directCommand || promptCommand || queryCommand || '';

  if (!mergedCommand && argsSuffix) {
    mergedCommand = argsSuffix;
  } else if (mergedCommand && argsSuffix && mergedCommand !== argsSuffix) {
    mergedCommand = `${mergedCommand} ${argsSuffix}`.trim();
  }

  if (!mergedCommand) {
    return {
      toolArgs: rawArgs,
      previewPrefix: 'Этот MCP tool принимает всю команду целиком в arguments.command.',
    };
  }

  const changed = Object.keys(rawArgs).length !== 1 || rawArgs.command !== mergedCommand;
  return {
    toolArgs: { command: mergedCommand },
    previewPrefix: changed
      ? 'Нормализация MCP args: tool принимает одну строку в arguments.command, поэтому я собрал полный CLI-вызов в это поле.'
      : 'Этот MCP tool принимает всю команду целиком в arguments.command.',
  };
}

function buildCommandWrapperHelpCommand(_toolName: string, toolArgs: Record<string, unknown>): string {
  const command = hasText(toolArgs.command) ? String(toolArgs.command).trim() : '';
  const entityMatch = command.match(/(?:^|\s)(?:search|get)\s+([a-zA-Z-]+)/);
  if (entityMatch?.[1]) {
    return `list ${entityMatch[1]}`;
  }
  const verbMatch = command.match(/^(list|search|get|find)\b/i);
  if (verbMatch?.[1]) {
    return verbMatch[1].toLowerCase();
  }
  return '<полная команда согласно описанию MCP tool>';
}

interface McpSchemaIssue {
  path: string;
  message: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNumberLike(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function matchesJsonSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return isNumberLike(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function validateJsonSchema(
  value: unknown,
  schema: unknown,
  path: string,
): McpSchemaIssue[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const normalizedSchema = schema as Record<string, unknown>;

  const variants = Array.isArray(normalizedSchema.oneOf)
    ? normalizedSchema.oneOf
    : Array.isArray(normalizedSchema.anyOf)
      ? normalizedSchema.anyOf
      : undefined;
  if (variants && variants.length > 0) {
    const results = variants.map((variant) => validateJsonSchema(value, variant, path));
    if (results.some((issues) => issues.length === 0)) return [];
    return results.sort((left, right) => left.length - right.length)[0] || [{
      path,
      message: 'значение не подходит ни под один вариант schema',
    }];
  }

  const type = normalizedSchema.type;
  if (typeof type === 'string' && !matchesJsonSchemaType(value, type)) {
    return [{ path, message: `ожидался тип ${type}` }];
  }
  if (Array.isArray(type) && type.length > 0) {
    const allowed = type.filter((item): item is string => typeof item === 'string');
    if (allowed.length > 0 && !allowed.some((item) => matchesJsonSchemaType(value, item))) {
      return [{ path, message: `ожидался один из типов: ${allowed.join(', ')}` }];
    }
  }

  if (Array.isArray(normalizedSchema.enum) && normalizedSchema.enum.length > 0) {
    const enumValues = normalizedSchema.enum;
    if (!enumValues.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
      return [{
        path,
        message: `ожидалось одно из значений: ${enumValues.slice(0, 6).map((item) => JSON.stringify(item)).join(', ')}`,
      }];
    }
  }

  const inferredObject =
    type === 'object' ||
    (type === undefined && (isPlainObject(normalizedSchema.properties) || Array.isArray(normalizedSchema.required)));
  if (inferredObject) {
    if (!isPlainObject(value)) {
      return [{ path, message: 'ожидался объект аргументов' }];
    }
    const issues: McpSchemaIssue[] = [];
    const required = Array.isArray(normalizedSchema.required)
      ? normalizedSchema.required.filter((item): item is string => typeof item === 'string')
      : [];
    for (const key of required) {
      if (!(key in value) || value[key] === undefined) {
        issues.push({ path: `${path}.${key}`, message: 'обязательное поле отсутствует' });
      }
    }
    const properties = isPlainObject(normalizedSchema.properties) ? normalizedSchema.properties : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value && value[key] !== undefined) {
        issues.push(...validateJsonSchema(value[key], childSchema, `${path}.${key}`));
      }
    }
    if (normalizedSchema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          issues.push({ path: `${path}.${key}`, message: 'поле не описано в inputSchema' });
        }
      }
    }
    return issues;
  }

  if (type === 'array' && normalizedSchema.items && Array.isArray(value)) {
    return value.flatMap((item, index) => validateJsonSchema(item, normalizedSchema.items, `${path}[${index}]`));
  }

  return [];
}

function buildMcpSchemaPreview(
  descriptor: { inputSchema?: Record<string, unknown> } | undefined,
  toolArgs: Record<string, unknown>,
  issues: McpSchemaIssue[] = [],
): string {
  const lines = [
    `Ожидаемая schema: ${describeMcpInputSchema(descriptor?.inputSchema)}`,
    issues.length > 0
      ? `Проблемы:\n${issues.slice(0, 8).map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`
      : '',
    `Текущие arguments:\n${JSON.stringify(toolArgs, null, 2)}`,
  ].filter(Boolean);
  return lines.join('\n\n');
}

function buildMcpRetryNextStep(
  server: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  descriptor: { inputSchema?: Record<string, unknown> } | undefined,
): string {
  if (isCommandWrapperDescriptor(descriptor)) {
    return `Этот MCP tool принимает всю CLI-строку в arguments.command. Сверь синтаксис с описанием и повтори вызов: ${JSON.stringify({ tool: 'mcp_tool', args: { server, name: toolName, arguments: { command: buildCommandWrapperHelpCommand(toolName, toolArgs) } } })}`;
  }
  if (descriptor?.inputSchema) {
    return `Сверь вызов с inputSchema и повтори: ${buildMcpToolTemplate(server, toolName, descriptor.inputSchema)}`;
  }
  return `Проверь доступные tools: ${JSON.stringify({ tool: 'list_mcp_tools', args: { server } })}`;
}

function buildMcpValidationResult(
  server: string,
  name: string,
  toolArgs: Record<string, unknown>,
  descriptor: { inputSchema?: Record<string, unknown> } | undefined,
  previewPrefix: string,
  issues: McpSchemaIssue[],
) {
  const preview = [previewPrefix, buildMcpSchemaPreview(descriptor, toolArgs, issues)]
    .filter(Boolean)
    .join('\n\n');
  const nextStep = descriptor?.inputSchema
    ? `Исправь arguments по inputSchema и повтори: ${buildMcpToolTemplate(server, name, descriptor.inputSchema)}`
    : `Сначала перечитай schema tool: ${JSON.stringify({ tool: 'list_mcp_tools', args: { server } })}`;
  const content = [
    `Аргументы MCP tool не соответствуют inputSchema: ${server} • ${name}`,
    '',
    preview,
    '',
    `Следующий удобный шаг: ${nextStep}`,
  ].filter(Boolean).join('\n');

  return createToolExecutionResult('mcp_tool', 'error', content, {
    phase: 'validation',
    recoveryHint: {
      kind: 'adjust_args',
      toolName: 'mcp_tool',
      nextStep,
    },
    presentation: {
      kind: 'mcp_tool_call',
      data: {
        summary: 'Аргументы MCP tool не прошли schema-проверку',
        detail: `${server} • ${name}`,
        preview,
        nextStep,
        server,
        toolName: name,
        isError: true,
        partCount: 0,
        sections: [],
      },
    },
  });
}

async function confirmMcpToolCall(
  payload: {
    server: string;
    mcpToolName: string;
    argsJson: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    summary: string;
  },
  onEvent: ((phase: string, message: string, meta?: any) => void | Promise<any>) | undefined,
): Promise<AgentApprovalResult | undefined> {
  if (!onEvent) return undefined;
  const confirmId = makeConfirmId('mcp');
  const request = buildToolApprovalRequest('mcp_tool', {
    confirmId,
    title: 'Подтвердите вызов MCP tool',
    description: 'Remote MCP tool может читать или изменять внешнюю систему. Проверь сервер, tool и аргументы.',
    ...payload,
  });
  if (!request) return undefined;
  return onEvent('approval-request', request.title, request) as Promise<AgentApprovalResult | undefined>;
}

export const mcpToolHandlers: ToolHandlerMap = {
  async list_mcp_resources(args) {
    const server = hasText(args?.server) ? String(args.server).trim() : undefined;

    try {
      const result = await listMcpResources(server);
      if (result.serverCount === 0) {
        const content = `MCP серверы не настроены.\n${buildMcpConfigHelpText()}`;
        return createToolExecutionResult('list_mcp_resources', 'blocked', content, {
          presentation: {
            kind: 'mcp_resources',
            data: buildListMcpResourcesPresentation({
              ...result,
              server,
            }),
          },
        });
      }

      const status = result.failures.length > 0 && result.resources.length > 0
        ? 'degraded'
        : result.resources.length === 0 && (result.failures.length > 0 || result.configErrors.length > 0)
          ? 'error'
          : 'success';
      return createToolExecutionResult(
        'list_mcp_resources',
        status,
        formatListMcpResourcesResult(result, { server }),
        {
          presentation: {
            kind: 'mcp_resources',
            data: buildListMcpResourcesPresentation({
              ...result,
              server,
            }),
          },
        },
      );
    } catch (error: any) {
      const message = `Ошибка: ${error?.message || error}`;
      return createToolExecutionResult('list_mcp_resources', 'error', message, {
        presentation: {
          kind: 'mcp_resources',
          data: buildListMcpResourcesPresentation({
            resources: [],
            failures: server ? [{ server, message }] : [],
            unsupported: [],
            serverCount: server ? 1 : 0,
            sources: [],
            configErrors: [],
            server,
          }),
        },
      });
    }
  },

  async read_mcp_resource(args) {
    const server = String(args?.server || '').trim();
    const uri = String(args?.uri || '').trim();
    if (!server || !uri) {
      const message = !server
        ? 'Для "read_mcp_resource" обязателен args.server'
        : 'Для "read_mcp_resource" обязателен args.uri';
      return createToolExecutionResult('read_mcp_resource', 'error', message);
    }

    try {
      const result = await readMcpResource(server, uri);
      return createToolExecutionResult(
        'read_mcp_resource',
        result.contents.length > 0 ? 'success' : 'degraded',
        formatReadMcpResourceResult(result),
        {
          presentation: {
            kind: 'mcp_resource',
            data: buildReadMcpResourcePresentation(result),
          },
        },
      );
    } catch (error: any) {
      const message = `Ошибка: ${error?.message || error}`;
      return createToolExecutionResult('read_mcp_resource', 'error', message, {
        presentation: {
          kind: 'mcp_resource',
          data: {
            summary: 'Не удалось прочитать MCP ресурс',
            detail: server ? `${server} • ${uri}` : uri || server,
            preview: message,
            nextStep: server
              ? `Сначала перечитай список ресурсов: ${JSON.stringify({ tool: 'list_mcp_resources', args: { server } })}`
              : 'Сначала проверь server и uri.',
            server,
            uri,
            contentCount: 0,
            binaryCount: 0,
            sections: [],
          },
        },
      });
    }
  },

  async list_mcp_tools(args) {
    const server = hasText(args?.server) ? String(args.server).trim() : undefined;

    try {
      const result = await listMcpTools(server);
      const disabledTools = new Set(readConfig().mcpDisabledTools || []);
      const filteredTools = filterDisabledMcpTools(result.tools, disabledTools);
      const effectiveResult = {
        ...result,
        tools: filteredTools,
      };
      if (result.serverCount === 0) {
        const content = `MCP серверы не настроены.\n${buildMcpConfigHelpText()}`;
        return createToolExecutionResult('list_mcp_tools', 'blocked', content, {
          presentation: {
            kind: 'mcp_tools',
            data: buildListMcpToolsPresentation({
              ...effectiveResult,
              server,
            }),
          },
        });
      }

      const status = result.failures.length > 0 && effectiveResult.tools.length > 0
        ? 'degraded'
        : effectiveResult.tools.length === 0 && (result.failures.length > 0 || result.configErrors.length > 0)
          ? 'error'
          : 'success';

      return createToolExecutionResult(
        'list_mcp_tools',
        status,
        formatListMcpToolsResult(effectiveResult, { server }),
        {
          presentation: {
            kind: 'mcp_tools',
            data: buildListMcpToolsPresentation({
              ...effectiveResult,
              server,
            }),
          },
        },
      );
    } catch (error: any) {
      const message = `Ошибка: ${error?.message || error}`;
      return createToolExecutionResult('list_mcp_tools', 'error', message, {
        presentation: {
          kind: 'mcp_tools',
          data: buildListMcpToolsPresentation({
            tools: [],
            failures: server ? [{ server, message }] : [],
            unsupported: [],
            serverCount: server ? 1 : 0,
            sources: [],
            configErrors: [],
            server,
          }),
        },
      });
    }
  },

  async mcp_tool(args, context) {
    const server = getMcpServerArg(args);
    const name = getMcpToolNameArg(args);
    const rawToolArgs = getMcpArgumentsArg(args);
    let descriptor: Awaited<ReturnType<typeof findMcpToolDescriptor>> | undefined;
    let toolArgs: Record<string, unknown> = rawToolArgs;
    let previewPrefix = '';

    if (!server || !name) {
      const message = !server
        ? 'Для "mcp_tool" обязателен args.server'
        : 'Для "mcp_tool" обязателен args.name';
      return createToolExecutionResult('mcp_tool', 'error', message);
    }

    try {
      if (isMcpToolDisabled(readConfig().mcpDisabledTools || [], server, name)) {
        const message = `MCP tool "${server}::${name}" выключен в настройках. Сначала включи его в разделе MCP.`;
        return createToolExecutionResult('mcp_tool', 'blocked', message, {
          presentation: {
            kind: 'mcp_tool_call',
            data: {
              summary: 'MCP tool выключен в настройках',
              detail: `${server} • ${name}`,
              preview: message,
              nextStep: 'Открой настройки MCP и включи этот tool в списке проверенных утилит.',
              server,
              toolName: name,
              isError: false,
              partCount: 0,
              sections: [],
            },
          },
        });
      }
      descriptor = await findMcpToolDescriptor(server, name).catch(() => undefined);
      const normalized = normalizeMcpToolArguments(descriptor, rawToolArgs);
      toolArgs = normalized.toolArgs;
      previewPrefix = normalized.previewPrefix || '';
      if (descriptor?.inputSchema) {
        const schemaIssues = validateJsonSchema(toolArgs, descriptor.inputSchema, 'arguments');
        if (schemaIssues.length > 0) {
          return buildMcpValidationResult(server, name, toolArgs, descriptor, previewPrefix, schemaIssues);
        }
      }
      const policy = classifyMcpToolExecutionPolicy(server, name, descriptor);
      const argsJson = JSON.stringify(toolArgs, null, 2);
      let autoApproved = false;

      if (policy.requiresApproval) {
        const approval = await confirmMcpToolCall(
          {
            server,
            mcpToolName: name,
            argsJson,
            readOnlyHint: policy.readOnly,
            destructiveHint: policy.destructive,
            summary: descriptor?.description || `Вызов MCP tool ${server} • ${name}`,
          },
          context.onEvent,
        );
        autoApproved = approval?.reason === 'auto_approved';
        if (!approval) {
          const message = `Вызов MCP tool не выполнен: подтверждение не получено для ${server} • ${name}.`;
          return createToolExecutionResult('mcp_tool', 'blocked', message, {
            presentation: {
              kind: 'mcp_tool_call',
              data: {
                summary: 'Вызов MCP tool не подтверждён',
                detail: `${server} • ${name}`,
                preview: [previewPrefix, argsJson].filter(Boolean).join('\n\n'),
                nextStep: `Повтори вызов после явного подтверждения: ${JSON.stringify({ tool: 'mcp_tool', args: { server, name, arguments: toolArgs } })}`,
                server,
                toolName: name,
                isError: false,
                partCount: 0,
                sections: [],
              },
            },
          });
        }
        if (approval.cancelled) {
          const message = `Вызов MCP tool не выполнен: ожидание подтверждения прервано для ${server} • ${name}.`;
          return createToolExecutionResult('mcp_tool', 'blocked', message, {
            presentation: {
              kind: 'mcp_tool_call',
              data: {
                summary: 'Вызов MCP tool прерван',
                detail: `${server} • ${name}`,
                preview: [previewPrefix, argsJson].filter(Boolean).join('\n\n'),
                nextStep: `Повтори вызов при необходимости: ${JSON.stringify({ tool: 'mcp_tool', args: { server, name, arguments: toolArgs } })}`,
                server,
                toolName: name,
                isError: false,
                partCount: 0,
                sections: [],
              },
            },
          });
        }
        if (!approval.approved) {
          const message = `Вызов MCP tool отклонён пользователем: ${server} • ${name}`;
          return createToolExecutionResult('mcp_tool', 'blocked', message, {
            presentation: {
              kind: 'mcp_tool_call',
              data: {
                summary: 'Вызов MCP tool отклонён',
                detail: `${server} • ${name}`,
                preview: [previewPrefix, argsJson].filter(Boolean).join('\n\n'),
                nextStep: `Если нужно, сначала изучи tool: ${JSON.stringify({ tool: 'list_mcp_tools', args: { server } })}`,
                server,
                toolName: name,
                isError: false,
                partCount: 0,
                sections: [],
              },
            },
          });
        }
      }

      const result = await callMcpTool(server, name, toolArgs);
      const errorPreviewPrefix = result.isError && descriptor?.inputSchema
        ? [previewPrefix, buildMcpSchemaPreview(descriptor, toolArgs)]
          .filter(Boolean)
          .join('\n\n')
        : previewPrefix;
      return createToolExecutionResult(
        'mcp_tool',
        result.isError ? 'error' : 'success',
        formatMcpToolCallResult(result, {
          previewPrefix: errorPreviewPrefix,
          ...(result.isError ? { nextStep: buildMcpRetryNextStep(server, name, toolArgs, descriptor) } : {}),
        }),
        {
          autoApproved,
          remoteStateHint: {
            system: 'mcp',
            key: policy.stateKey,
            changed: policy.changesState && !result.isError,
            readOnly: policy.readOnly,
            concurrencySafe: policy.concurrencySafe,
          },
          presentation: {
            kind: 'mcp_tool_call',
            data: buildMcpToolCallPresentation(result, {
              previewPrefix: errorPreviewPrefix,
              ...(result.isError ? { nextStep: buildMcpRetryNextStep(server, name, toolArgs, descriptor) } : {}),
            }),
          },
        },
      );
    } catch (error: any) {
      if (error instanceof McpAuthRequiredError) {
        const message = `Ошибка: ${error.message}`;
        return createToolExecutionResult('mcp_tool', 'blocked', message, {
          recoveryHint: {
            kind: 'recommended_tool',
            toolName: 'mcp_auth',
            nextStep: JSON.stringify({ tool: 'mcp_auth', args: { server } }),
          },
          presentation: {
            kind: 'mcp_tool_call',
            data: {
              summary: 'MCP tool требует аутентификацию',
              detail: `${server} • ${name}`,
              preview: [previewPrefix, message].filter(Boolean).join('\n\n'),
              nextStep: `Сначала авторизуй сервер: ${JSON.stringify({ tool: 'mcp_auth', args: { server } })}`,
              server,
              toolName: name,
              isError: true,
              partCount: 0,
              sections: [],
            },
          },
        });
      }
      const message = `Ошибка: ${error?.message || error}`;
      const catchPreview = descriptor?.inputSchema
        ? [previewPrefix, message, buildMcpSchemaPreview(descriptor, toolArgs)]
          .filter(Boolean)
          .join('\n\n')
        : [previewPrefix, message].filter(Boolean).join('\n\n');
      return createToolExecutionResult('mcp_tool', 'error', message, {
        presentation: {
          kind: 'mcp_tool_call',
          data: {
            summary: 'Не удалось вызвать MCP tool',
            detail: `${server} • ${name}`,
            preview: catchPreview,
            nextStep: buildMcpRetryNextStep(server, name, toolArgs, descriptor),
            server,
            toolName: name,
            isError: true,
            partCount: 0,
            sections: [],
          },
        },
      });
    }
  },

  async mcp_auth(args, context) {
    const serverName = String(args?.server || '').trim();
    const force = !!args?.force;
    if (!serverName) {
      return createToolExecutionResult('mcp_auth', 'error', 'Для "mcp_auth" обязателен args.server');
    }

    try {
      const registry = await loadMcpServerRegistry();
      const server = registry.servers[serverName];
      if (!server) {
        const message = Object.keys(registry.servers).length > 0
          ? `MCP сервер "${serverName}" не найден. Доступные серверы: ${Object.keys(registry.servers).join(', ')}`
          : `MCP сервер "${serverName}" не найден. ${buildMcpConfigHelpText()}`;
        return createToolExecutionResult('mcp_auth', 'error', message, {
          presentation: {
            kind: 'mcp_auth',
            data: buildBlockedMcpAuthPresentation(serverName, '', message),
          },
        });
      }
      if (server.type !== 'http') {
        const message = `MCP OAuth поддержан только для http серверов. "${serverName}" использует ${server.type}.`;
        return createToolExecutionResult('mcp_auth', 'blocked', message, {
          presentation: {
            kind: 'mcp_auth',
            data: buildBlockedMcpAuthPresentation(serverName, server.sourceLabel, message),
          },
        });
      }
      if (!server.oauth) {
        const message = `У сервера "${serverName}" не настроен oauth. Добавь oauth.clientId или authServerMetadataUrl в MCP config.`;
        return createToolExecutionResult('mcp_auth', 'blocked', message, {
          presentation: {
            kind: 'mcp_auth',
            data: buildBlockedMcpAuthPresentation(serverName, server.sourceLabel, message),
          },
        });
      }

      if (force) {
        await clearMcpOAuthState(server);
      }
      await clearMcpClientCache(serverName);

      const auth = await performMcpOAuthFlow(server, {
        force,
        signal: context.signal,
        onStatus: (status) => {
          context.onEvent?.(
            'agent-transition',
            status.message,
            {
              summary: 'Выполняю MCP OAuth',
              detail: `${serverName}${status.authUrl ? ` • ${status.authUrl}` : ''}`,
            },
          );
        },
      });

      await clearMcpClientCache(serverName);
      const toolsResult = await listMcpTools(serverName).catch(() => null);
      const verifiedTools = toolsResult ? toolsResult.tools.length : undefined;
      const result = {
        server: serverName,
        sourceLabel: server.sourceLabel,
        authUrl: auth.authUrl,
        browserOpened: auth.browserOpened,
        callbackPort: auth.callbackPort,
        clientId: auth.clientId,
        expiresAt: auth.expiresAt,
        scope: auth.scope,
        ...(typeof verifiedTools === 'number' ? { verifiedTools } : {}),
      };

      return createToolExecutionResult(
        'mcp_auth',
        'success',
        formatMcpAuthResult(result, {
          success: true,
          message: verifiedTools !== undefined
            ? `После авторизации найдено ${verifiedTools} MCP tools.`
            : 'Авторизация завершена.',
        }),
        {
          presentation: {
            kind: 'mcp_auth',
            data: buildMcpAuthPresentation(result, {
              success: true,
              preview: auth.browserOpened
                ? 'OAuth flow завершён через браузер и локальный callback.'
                : `OAuth flow завершён, но браузер пришлось открыть вручную: ${auth.authUrl}`,
            }),
          },
        },
      );
    } catch (error: any) {
      if (error instanceof McpAuthCancelledError || error?.code === 'mcp_auth_cancelled') {
        const message = `MCP OAuth для "${serverName}" прерван до завершения.`;
        return createToolExecutionResult('mcp_auth', 'blocked', message, {
          presentation: {
            kind: 'mcp_auth',
            data: buildBlockedMcpAuthPresentation(serverName, '', message),
          },
        });
      }
      const message = `Ошибка: ${error?.message || error}`;
      return createToolExecutionResult('mcp_auth', 'error', message, {
        presentation: {
          kind: 'mcp_auth',
          data: buildBlockedMcpAuthPresentation(serverName, '', message),
        },
      });
    }
  },
};
