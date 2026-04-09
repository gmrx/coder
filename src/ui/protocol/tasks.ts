export interface TaskListItemMessage {
  id: string;
  kind: 'generic' | 'shell';
  subject: string;
  description: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'blocked';
  command?: string;
  cwd?: string;
  note?: string;
  taskFilePath?: string;
  stdoutPath?: string;
  stderrPath?: string;
  stdoutPreview?: string;
  stderrPreview?: string;
  exitCode?: number;
  signal?: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  stopRequestedAt?: number;
  preview?: string;
}

export interface TasksStateMessage {
  type: 'tasksState';
  tasks: TaskListItemMessage[];
  summary: string;
  activeCount: number;
  totalCount: number;
  shownCount: number;
  updatedAt: number;
}
