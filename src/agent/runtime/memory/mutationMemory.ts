import type { ToolExecutionResult } from '../../tooling/results';

export class MutationMemory {
  workspaceMutations = 0;

  noteTool(tool: string, result: string | ToolExecutionResult): void {
    const status = typeof result === 'string' ? 'success' : result.status;
    if (status === 'error' || status === 'blocked') return;

    if (tool === 'str_replace' || tool === 'write_file' || tool === 'delete_file' || tool === 'edit_notebook') {
      this.workspaceMutations++;
    }
  }
}
