import type { ExecuteToolFn, ToolExecutionContext, ToolHandler } from './types';
import { runSubagentSingle } from './subagentCore';
import { executeSubagentBatch } from './subagentExecutor';
import { createSubagentBatchPlan } from './subagentTaskNormalizer';
import { buildSubagentBatchResult } from './subagentSummarizer';

export function createSubagentHandler(executeTool: ExecuteToolFn): ToolHandler {
  return async (args, context) => runSubagent(args || {}, executeTool, context);
}

async function runSubagent(args: any, executeTool: ExecuteToolFn, context: ToolExecutionContext): Promise<string> {
  const rawTasks = Array.isArray(args?.tasks) ? args.tasks : [];
  if (rawTasks.length === 0) {
    return runSubagentSingle(args, executeTool, context);
  }

  const plan = createSubagentBatchPlan(args);
  if (plan.tasks.length === 0) {
    return '(subagent) "tasks" передан, но задачи пустые. Используй массив строк или объекты с description/prompt/task/query/goal/instruction.';
  }

  const outputs = await executeSubagentBatch(plan, executeTool, context);
  return buildSubagentBatchResult(plan, outputs);
}
