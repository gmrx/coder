import type { ToolExecutionResult } from '../../tooling/results';

export class FailureMemory {
  subagentErrorBatches = 0;

  noteSubagentBatchFailure(): void {
    this.subagentErrorBatches++;
  }
}

export function isToolResultError(tool: string, result: string | ToolExecutionResult): boolean {
  if (typeof result !== 'string') {
    return result.status === 'error' || result.status === 'blocked';
  }

  const value = String(result || '').trim();
  if (!value) return false;
  if (/^ошибка:/i.test(value)) return true;

  if (tool === 'subagent') {
    return /^\(subagent\)/m.test(value);
  }

  return false;
}
