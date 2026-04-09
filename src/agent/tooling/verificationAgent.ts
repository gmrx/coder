import type { ExecuteToolFn, ToolExecutionContext, ToolHandler } from './types';
import { runSubagentSingle } from './subagentCore';
import { buildVerificationAgentTaskPrompt } from './verificationPromptContracts';

export function createVerificationAgentHandler(executeTool: ExecuteToolFn): ToolHandler {
  return async (args, context) => runVerificationAgent(args || {}, executeTool, context);
}

async function runVerificationAgent(
  args: any,
  executeTool: ExecuteToolFn,
  context: ToolExecutionContext,
): Promise<string> {
  const task = pickString(args?.task, args?.original_task, context.query);
  if (!task) {
    return '(verification_agent) укажи "task" или вызови инструмент в контексте пользовательского запроса.';
  }

  const changedFiles = normalizeStringList(args?.changed_files || args?.files || args?.paths);
  const approach = pickString(args?.approach, args?.implementation, args?.summary);
  const focus = pickString(args?.focus, args?.checks, args?.risks);

  return runSubagentSingle(
    {
      prompt: buildVerificationAgentTaskPrompt({
        task,
        changedFiles,
        approach,
        focus,
      }),
      subagent_type: 'verification',
      readonly: false,
    },
    executeTool,
    context,
  );
}

function pickString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeStringList(value: any): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return items
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}
