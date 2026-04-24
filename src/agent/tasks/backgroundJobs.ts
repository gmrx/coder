import * as path from 'path';
import { spawn } from 'child_process';
import { getExtensionStoragePath } from '../../core/extensionStorage';
import {
  buildBackgroundShellTaskSubject,
  createTaskRecord,
  getTaskStderrPath,
  getTaskStdoutPath,
  patchTaskRecord,
  toTaskWorkspaceRelativePath,
  type AgentTaskRecord,
} from './store';

export async function startBackgroundShellJob(input: {
  command: string;
  cwd: string;
  taskSubject?: string;
  taskDescription?: string;
  rootPath?: string;
}): Promise<AgentTaskRecord> {
  const rootPath = path.resolve(input.rootPath || input.cwd || process.cwd());
  const task = await createTaskRecord(
    {
      kind: 'shell',
      subject: String(input.taskSubject || '').trim() || `Shell: ${buildBackgroundShellTaskSubject(input.command)}`,
      description: String(input.taskDescription || '').trim() || `Background shell job: ${input.command}`,
      activeForm: 'Выполняю background job',
      status: 'pending',
      command: input.command,
      cwd: input.cwd,
    },
    rootPath,
  );
  const stdoutPath = getTaskStdoutPath(task.id, rootPath);
  const stderrPath = getTaskStderrPath(task.id, rootPath);
  const actualTask = await patchTaskRecord(
    task.id,
    {
      stdoutPath,
      stderrPath,
      note: 'Подготовлена background shell job.',
    },
    rootPath,
  );
  if (!actualTask) {
    throw new Error(`Не удалось подготовить background task ${task.id}.`);
  }

  const runnerPath = path.resolve(__dirname, '../tasks/taskRunner.js');
  const runnerArgs = [runnerPath, '--root', rootPath, '--task', actualTask.id];
  const storagePath = getExtensionStoragePath();
  if (storagePath) {
    runnerArgs.push('--storage', storagePath);
  }
  const child = spawn(
    process.execPath,
    runnerArgs,
    {
      cwd: rootPath,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    },
  );
  child.unref();
  return {
    ...actualTask,
    stdoutPath: toTaskWorkspaceRelativePath(actualTask.stdoutPath, rootPath),
    stderrPath: toTaskWorkspaceRelativePath(actualTask.stderrPath, rootPath),
  };
}
