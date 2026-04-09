import * as fs from 'fs/promises';
import { truncate } from '../../../core/utils';
import {
  buildTaskDetailPresentation,
  buildTaskListPresentation,
  buildTaskMutationPresentation,
  formatTaskDetailResult,
  formatTaskListResult,
} from '../taskStudy';
import { createToolExecutionResult } from '../results';
import type { ToolHandlerMap } from '../types';
import {
  createTaskRecord,
  listTaskRecords,
  patchTaskRecord,
  readTaskRecord,
  stopTaskProcess,
  syncTaskRecordState,
  toTaskWorkspaceRelativePath,
  type AgentTaskRecord,
} from '../../tasks/store';
import { getAgentWorkspaceRootPath } from '../../worktreeSession';

function hasText(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function normalizeStatus(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeLimit(value: unknown, fallback = 10, max = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function normalizeOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

async function buildTaskOutputPreview(task: AgentTaskRecord): Promise<string> {
  if (task.kind !== 'shell') return '';
  const chunks: string[] = [];

  if (task.stdoutPath) {
    try {
      const stdout = await fs.readFile(task.stdoutPath, 'utf8');
      const trimmed = truncate(stdout.trim(), 2_500);
      if (trimmed) chunks.push(`stdout\n${trimmed}`);
    } catch {
      // Ignore missing stdout file.
    }
  }

  if (task.stderrPath) {
    try {
      const stderr = await fs.readFile(task.stderrPath, 'utf8');
      const trimmed = truncate(stderr.trim(), 2_500);
      if (trimmed) chunks.push(`stderr\n${trimmed}`);
    } catch {
      // Ignore missing stderr file.
    }
  }

  return chunks.join('\n\n').trim();
}

function filterTasks(tasks: AgentTaskRecord[], args: any): AgentTaskRecord[] {
  const status = normalizeStatus(args?.status);
  const kind = normalizeStatus(args?.kind);
  let filtered = tasks;
  if (status) {
    filtered = filtered.filter((task) => normalizeStatus(task.status) === status);
  }
  if (kind) {
    filtered = filtered.filter((task) => normalizeStatus(task.kind) === kind);
  }
  return filtered;
}

export const taskToolHandlers: ToolHandlerMap = {
  async task_create(args) {
    const rootPath = getAgentWorkspaceRootPath() || process.cwd();
    const subject = String(args?.subject || '').trim();
    const description = String(args?.description || subject).trim();
    const task = await createTaskRecord(
      {
        kind: 'generic',
        subject,
        description,
        ...(hasText(args?.activeForm) ? { activeForm: String(args.activeForm).trim() } : {}),
        status: 'pending',
        ...(args?.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata) ? { metadata: args.metadata } : {}),
      },
      rootPath,
    );
    return createToolExecutionResult(
      'task_create',
      'success',
      `Task #${task.id} создана: ${task.subject}`,
      {
        presentation: {
          kind: 'task',
          data: buildTaskMutationPresentation(
            'Задача создана',
            `#${task.id} • ${task.subject}`,
            `Следующий шаг: ${JSON.stringify({ tool: 'task_get', args: { id: task.id } })}`,
            task,
          ),
        },
      },
    );
  },

  async task_list(args) {
    const rootPath = getAgentWorkspaceRootPath() || process.cwd();
    const limit = normalizeLimit(args?.limit, 10, 50);
    const offset = normalizeOffset(args?.offset);
    const allTasks = filterTasks(await listTaskRecords(rootPath), args);
    const tasks = allTasks.slice(offset, offset + limit);
    return createToolExecutionResult(
      'task_list',
      'success',
      formatTaskListResult(tasks, {
        status: normalizeStatus(args?.status) || undefined,
        kind: normalizeStatus(args?.kind) || undefined,
        limit,
        offset,
      }),
      {
        presentation: {
          kind: 'task',
          data: buildTaskListPresentation(tasks, {
            status: normalizeStatus(args?.status) || undefined,
            kind: normalizeStatus(args?.kind) || undefined,
            limit,
            offset,
          }),
        },
      },
    );
  },

  async task_get(args) {
    const rootPath = getAgentWorkspaceRootPath() || process.cwd();
    const id = String(args?.id || '').trim();
    const task = id ? await readTaskRecord(id, rootPath) : null;
    if (!task) {
      return createToolExecutionResult(
        'task_get',
        'error',
        `Task "${id}" не найдена.`,
        {
          presentation: {
            kind: 'task',
            data: buildTaskMutationPresentation('Задача не найдена', `#${id}`, `Следующий шаг: ${JSON.stringify({ tool: 'task_list' })}`),
          },
        },
      );
    }

    const syncedTask = await syncTaskRecordState(task, rootPath);
    const preview = await buildTaskOutputPreview(syncedTask);
    const displayTask: AgentTaskRecord = {
      ...syncedTask,
      ...(syncedTask.stdoutPath ? { stdoutPath: toTaskWorkspaceRelativePath(syncedTask.stdoutPath, rootPath) } : {}),
      ...(syncedTask.stderrPath ? { stderrPath: toTaskWorkspaceRelativePath(syncedTask.stderrPath, rootPath) } : {}),
    };

    return createToolExecutionResult(
      'task_get',
      'success',
      formatTaskDetailResult(displayTask, preview),
      {
        presentation: {
          kind: 'task',
          data: buildTaskDetailPresentation(displayTask, preview),
        },
      },
    );
  },

  async task_update(args) {
    const rootPath = getAgentWorkspaceRootPath() || process.cwd();
    const id = String(args?.id || '').trim();
    const updated = await patchTaskRecord(
      id,
      (current) => ({
        ...current,
        ...(hasText(args?.subject) ? { subject: String(args.subject).trim() } : {}),
        ...(hasText(args?.description) ? { description: String(args.description).trim() } : {}),
        ...(hasText(args?.activeForm) ? { activeForm: String(args.activeForm).trim() } : {}),
        ...(hasText(args?.status) ? { status: normalizeStatus(args.status) as AgentTaskRecord['status'] } : {}),
        ...(args?.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
          ? { metadata: { ...(current.metadata || {}), ...args.metadata } }
          : {}),
      }),
      rootPath,
    );
    if (!updated) {
      return createToolExecutionResult(
        'task_update',
        'error',
        `Task "${id}" не найдена.`,
        {
          presentation: {
            kind: 'task',
            data: buildTaskMutationPresentation('Задача не найдена', `#${id}`, `Следующий шаг: ${JSON.stringify({ tool: 'task_list' })}`),
          },
        },
      );
    }

    return createToolExecutionResult(
      'task_update',
      'success',
      `Task #${updated.id} обновлена: ${updated.subject}`,
      {
        presentation: {
          kind: 'task',
          data: buildTaskMutationPresentation(
            'Задача обновлена',
            `#${updated.id} • ${updated.status}`,
            `Следующий шаг: ${JSON.stringify({ tool: 'task_get', args: { id: updated.id } })}`,
            updated,
          ),
        },
      },
    );
  },

  async task_stop(args) {
    const rootPath = getAgentWorkspaceRootPath() || process.cwd();
    const id = String(args?.id || '').trim();
    const force = args?.force === true;
    const task = await stopTaskProcess(id, { force, rootPath });
    if (!task) {
      return createToolExecutionResult(
        'task_stop',
        'error',
        `Task "${id}" не найдена.`,
        {
          presentation: {
            kind: 'task',
            data: buildTaskMutationPresentation('Задача не найдена', `#${id}`, `Следующий шаг: ${JSON.stringify({ tool: 'task_list' })}`),
          },
        },
      );
    }

    return createToolExecutionResult(
      'task_stop',
      'success',
      `Для task #${task.id} запрошена остановка.`,
      {
        presentation: {
          kind: 'task',
          data: buildTaskMutationPresentation(
            force ? 'Задача принудительно останавливается' : 'Для задачи запрошена остановка',
            `#${task.id} • ${task.status}`,
            `Следующий шаг: ${JSON.stringify({ tool: 'task_get', args: { id: task.id } })}`,
            task,
          ),
        },
      },
    );
  },
};
