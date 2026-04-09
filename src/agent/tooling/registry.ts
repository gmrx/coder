import type { ExecuteToolFn, ToolHandlerMap } from './types';
import { createSubagentHandler } from './subagent';
import { createVerificationAgentHandler } from './verificationAgent';
import { catalogToolHandlers } from './handlers/catalogTools';
import { codeToolHandlers } from './handlers/codeTools';
import { editToolHandlers } from './handlers/editTools';
import { externalToolHandlers } from './handlers/externalTools';
import { mcpToolHandlers } from './handlers/mcpTools';
import { projectToolHandlers } from './handlers/projectTools';
import { taskToolHandlers } from './handlers/taskTools';
import { worktreeToolHandlers } from './handlers/worktreeTools';

export function createToolHandlers(executeTool: ExecuteToolFn): ToolHandlerMap {
  return {
    ...catalogToolHandlers,
    ...projectToolHandlers,
    ...codeToolHandlers,
    ...editToolHandlers,
    ...externalToolHandlers,
    ...mcpToolHandlers,
    ...taskToolHandlers,
    ...worktreeToolHandlers,
    subagent: createSubagentHandler(executeTool),
    verification_agent: createVerificationAgentHandler(executeTool),
  };
}
