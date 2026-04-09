import { truncate } from '../../core/utils';
import type { AgentTaskRecord } from '../tasks/store';
import type { StructuredPresentationSection } from './presentationItems';

export interface TaskPresentation {
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  sections: StructuredPresentationSection[];
  taskId?: string;
  status?: string;
  taskCount?: number;
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function compact(text: string | undefined, max = 140): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function buildTaskMeta(task: AgentTaskRecord): string {
  return [
    task.kind === 'shell' ? 'shell job' : 'task',
    task.status,
    task.command ? compact(task.command, 80) : '',
    task.exitCode !== undefined ? `exit ${task.exitCode}` : '',
  ].filter(Boolean).join(' • ');
}

function buildTaskNextStep(task: AgentTaskRecord): string {
  if (task.kind === 'shell') {
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      const stdoutPath = task.stdoutPath ? JSON.stringify({ tool: 'read_file', args: { path: task.stdoutPath } }) : '';
      return stdoutPath
        ? `Если нужен вывод, открой stdout: ${stdoutPath}`
        : `Проверь задачу ещё раз: ${JSON.stringify({ tool: 'task_get', args: { id: task.id } })}`;
    }
    return `Проверь статус позже: ${JSON.stringify({ tool: 'task_get', args: { id: task.id } })}`;
  }
  return `Если нужны все задачи, вызови: ${JSON.stringify({ tool: 'task_list' })}`;
}

export function buildTaskListPresentation(
  tasks: AgentTaskRecord[],
  options?: { status?: string; kind?: string; limit?: number; offset?: number },
): TaskPresentation {
  return {
    summary: tasks.length === 0
      ? 'Задачи не найдены'
      : `Нашёл ${tasks.length} ${pluralize(tasks.length, 'задачу', 'задачи', 'задач')}`,
    detail: [
      options?.status ? `status: ${options.status}` : '',
      options?.kind ? `kind: ${options.kind}` : '',
      typeof options?.offset === 'number' ? `offset: ${options.offset}` : '',
    ].filter(Boolean).join(' • '),
    nextStep: tasks[0]
      ? `Открой первую задачу: ${JSON.stringify({ tool: 'task_get', args: { id: tasks[0].id } })}`
      : 'Создай новую задачу через task_create или запусти shell с run_in_background=true.',
    taskCount: tasks.length,
    sections: tasks.length > 0
      ? [{
        title: 'Задачи',
        items: tasks.slice(0, 10).map((task) => ({
          title: task.subject || task.id,
          subtitle: `#${task.id}`,
          meta: buildTaskMeta(task),
        })),
      }]
      : [],
  };
}

export function formatTaskListResult(
  tasks: AgentTaskRecord[],
  options?: { status?: string; kind?: string; limit?: number; offset?: number },
): string {
  if (tasks.length === 0) {
    return [
      'Задачи не найдены.',
      '',
      options?.status ? `Фильтр status: ${options.status}` : '',
      options?.kind ? `Фильтр kind: ${options.kind}` : '',
      '',
      'Следующий удобный шаг: создай новую задачу через task_create или запусти shell с run_in_background=true.',
    ].filter(Boolean).join('\n');
  }

  const lines = [
    `Найдено ${tasks.length} ${pluralize(tasks.length, 'задача', 'задачи', 'задач')}.`,
    '',
  ];
  tasks.forEach((task, index) => {
    lines.push(`${index + 1}. ${task.subject}`);
    lines.push(`   #${task.id} • ${buildTaskMeta(task)}`);
    if (task.description) lines.push(`   ${compact(task.description, 160)}`);
  });
  lines.push('');
  lines.push(`Следующий удобный шаг: ${JSON.stringify({ tool: 'task_get', args: { id: tasks[0].id } })}`);
  return truncate(lines.join('\n').trim(), 14_000);
}

export function buildTaskDetailPresentation(task: AgentTaskRecord, preview?: string): TaskPresentation {
  return {
    summary: task.status === 'completed'
      ? 'Задача завершена'
      : task.status === 'failed'
        ? 'Задача завершилась с ошибкой'
        : task.status === 'cancelled'
          ? 'Задача остановлена'
          : task.status === 'in_progress'
            ? 'Задача выполняется'
            : 'Задача создана',
    detail: [
      `#${task.id}`,
      buildTaskMeta(task),
      task.cwd ? compact(task.cwd, 120) : '',
    ].filter(Boolean).join(' • '),
    ...(preview ? { preview } : {}),
    nextStep: buildTaskNextStep(task),
    taskId: task.id,
    status: task.status,
    sections: [{
      title: 'Task',
      items: [{
        title: task.subject || task.id,
        subtitle: task.description || undefined,
        meta: buildTaskMeta(task),
      }],
    }],
  };
}

export function formatTaskDetailResult(task: AgentTaskRecord, preview?: string): string {
  const lines = [
    `Task #${task.id}: ${task.subject}`,
    `status: ${task.status}`,
    `kind: ${task.kind}`,
    task.description ? `description: ${task.description}` : '',
    task.command ? `command: ${task.command}` : '',
    task.cwd ? `cwd: ${task.cwd}` : '',
    task.stdoutPath ? `stdout: ${task.stdoutPath}` : '',
    task.stderrPath ? `stderr: ${task.stderrPath}` : '',
    task.exitCode !== undefined ? `exitCode: ${task.exitCode}` : '',
    task.note ? `note: ${task.note}` : '',
    '',
    preview ? preview : '',
    '',
    `Следующий удобный шаг: ${buildTaskNextStep(task)}`,
  ].filter(Boolean);
  return truncate(lines.join('\n').trim(), 16_000);
}

export function buildTaskMutationPresentation(
  summary: string,
  detail: string,
  nextStep?: string,
  task?: AgentTaskRecord,
): TaskPresentation {
  return {
    summary,
    detail,
    ...(nextStep ? { nextStep } : {}),
    ...(task ? { taskId: task.id, status: task.status } : {}),
    sections: task
      ? [{
        title: 'Task',
        items: [{
          title: task.subject || task.id,
          subtitle: `#${task.id}`,
          meta: buildTaskMeta(task),
        }],
      }]
      : [],
  };
}
