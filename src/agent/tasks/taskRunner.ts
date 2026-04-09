import * as fsSync from 'fs';
import { spawn } from 'child_process';
import { patchTaskRecord, readTaskRecord, type AgentTaskStatus } from './store';

type CliArgs = {
  rootPath: string;
  taskId: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let rootPath = '';
  let taskId = '';
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === '--root') rootPath = String(args[index + 1] || '');
    if (token === '--task') taskId = String(args[index + 1] || '');
  }
  if (!rootPath || !taskId) {
    throw new Error('Usage: node taskRunner.js --root <workspaceRoot> --task <taskId>');
  }
  return { rootPath, taskId };
}

async function main(): Promise<void> {
  const { rootPath, taskId } = parseArgs(process.argv);
  const task = await readTaskRecord(taskId, rootPath);
  if (!task || task.kind !== 'shell' || !task.command) {
    throw new Error(`Task "${taskId}" не найден или не является shell background job.`);
  }

  const stdoutPath = task.stdoutPath;
  const stderrPath = task.stderrPath;
  if (!stdoutPath || !stderrPath) {
    throw new Error(`Task "${taskId}" не содержит stdout/stderr paths.`);
  }

  const stdoutFd = fsSync.openSync(stdoutPath, 'a');
  const stderrFd = fsSync.openSync(stderrPath, 'a');
  const shellExecutable = process.env.SHELL || '/bin/zsh';
  const child = spawn(shellExecutable, ['-lc', task.command], {
    cwd: task.cwd || rootPath,
    detached: false,
    stdio: ['ignore', stdoutFd, stderrFd],
    env: { ...process.env, LANG: 'en_US.UTF-8' },
  });

  let stopping = false;

  await patchTaskRecord(
    taskId,
    {
      status: 'in_progress',
      startedAt: Date.now(),
      pid: process.pid,
      childPid: child.pid,
      note: 'Background job запущен.',
    },
    rootPath,
  );

  const forwardStop = (force = false): void => {
    stopping = true;
    try {
      child.kill(force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // Ignore child kill errors for already-exited jobs.
    }
  };

  process.on('SIGTERM', () => forwardStop(false));
  process.on('SIGINT', () => forwardStop(false));

  child.once('error', async (error: Error) => {
    await patchTaskRecord(
      taskId,
      {
        status: 'failed',
        finishedAt: Date.now(),
        exitCode: 1,
        note: error.message || 'Не удалось запустить background job.',
      },
      rootPath,
    );
    fsSync.closeSync(stdoutFd);
    fsSync.closeSync(stderrFd);
    process.exit(1);
  });

  child.once('exit', async (code, signal) => {
    const status: AgentTaskStatus = stopping
      ? 'cancelled'
      : code === 0
        ? 'completed'
        : 'failed';
    await patchTaskRecord(
      taskId,
      {
        status,
        finishedAt: Date.now(),
        exitCode: typeof code === 'number' ? code : undefined,
        signal: signal || null,
        note: stopping
          ? 'Background job остановлен.'
          : status === 'completed'
            ? 'Background job завершён.'
            : 'Background job завершился с ошибкой.',
      },
      rootPath,
    );
    fsSync.closeSync(stdoutFd);
    fsSync.closeSync(stderrFd);
    process.exit(status === 'completed' ? 0 : 1);
  });
}

void main().catch(async (error: any) => {
  // Runner fallback: if args were parsed but task failed early, let stderr carry the reason.
  console.error(error?.message || String(error));
  process.exit(1);
});

