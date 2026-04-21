import type { ExecuteToolResultFn, ToolExecutionContext } from './types';

export type SubagentLifecycleState = 'planned' | 'queued' | 'running' | 'done' | 'error' | 'summarized';

export interface NormalizedSubagentTask {
  eventId: string;
  prompt?: string;
  action?: string;
  actionArgs?: any;
  files?: string[];
  mcpFocused?: boolean;
  subagentType: string;
  readonly: boolean;
  label: string;
}

export interface SubagentBatchPlan {
  batchId: number;
  parallel: boolean;
  tasks: NormalizedSubagentTask[];
}

export interface SubagentTaskOutput {
  label: string;
  result: string;
}

export interface WorkspaceFileCatalogCache {
  allFiles?: Promise<string[]>;
}

export interface SubagentExecutionDependencies {
  executeTool: ExecuteToolResultFn;
  context: ToolExecutionContext;
  guidedReadCache: Map<string, Promise<string>>;
  workspaceFileCache: WorkspaceFileCatalogCache;
}
