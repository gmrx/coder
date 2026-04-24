import type { ExecuteToolFn, ExecuteToolResultFn, ToolHandlerMap } from './types';
import { createSubagentHandler } from './subagent';
import { createVerificationAgentHandler } from './verificationAgent';
import { catalogToolHandlers } from './handlers/catalogTools';
import { codeToolHandlers } from './handlers/codeTools';
import { editToolHandlers } from './handlers/editTools';
import { externalToolHandlers } from './handlers/externalTools';
import { jiraToolHandlers } from './handlers/jiraTools';
import { mcpToolHandlers } from './handlers/mcpTools';
import { projectToolHandlers } from './handlers/projectTools';
import { taskToolHandlers } from './handlers/taskTools';
import { tfsToolHandlers } from './handlers/tfsTools';
import { worktreeToolHandlers } from './handlers/worktreeTools';

export function createToolHandlers(
  executeTool: ExecuteToolFn,
  executeToolResult: ExecuteToolResultFn,
): ToolHandlerMap {
  return {
    ...catalogToolHandlers,
    ...projectToolHandlers,
    ...codeToolHandlers,
    ...editToolHandlers,
    ...externalToolHandlers,
    ...jiraToolHandlers,
    ...tfsToolHandlers,
    ...mcpToolHandlers,
    ...taskToolHandlers,
    ...worktreeToolHandlers,
    subagent: createSubagentHandler(executeToolResult),
    verification_agent: createVerificationAgentHandler(executeToolResult),
  };
}
