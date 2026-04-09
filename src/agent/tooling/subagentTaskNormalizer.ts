import { truncate } from '../../core/utils';
import { isMcpFocusedSubagentTask } from './subagentMcpFocus';
import { extractFileHintsFromText } from './workspace';
import type { NormalizedSubagentTask, SubagentBatchPlan } from './subagentTypes';

let subagentBatchSequence = 0;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'using', 'use',
  'как', 'что', 'для', 'или', 'это', 'надо', 'нужно', 'изучи', 'проанализируй',
  'полностью', 'изучить', 'анализ', 'опиши', 'определи', 'изучи', 'read', 'analyze',
]);

function trimString(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickTaskLabel(task: any, index: number): string {
  return trimString(task?.label) || trimString(task?.title) || trimString(task?.name) || `task-${index + 1}`;
}

function normalizeTaskFiles(task: any, prompt?: string): string[] | undefined {
  const rawValues = [
    ...(Array.isArray(task?.files) ? task.files : []),
    ...(Array.isArray(task?.paths) ? task.paths : []),
  ];
  const normalized = rawValues
    .filter((value: any): value is string => typeof value === 'string')
    .map((value: string) => value.trim())
    .filter(Boolean);

  if (normalized.length > 0) return normalized;
  if (prompt) return extractFileHintsFromText(prompt);
  return undefined;
}

function buildTaskPrompt(task: any): string {
  return [
    task?.prompt,
    task?.task,
    task?.query,
    task?.goal,
    task?.instruction,
    task?.focus,
    task?.description,
    task?.details,
    task?.objective,
    task?.request,
  ]
    .map(trimString)
    .filter(Boolean)
    .join('\n\n');
}

function defaultReadonlyForSubagentType(subagentType: string): boolean {
  return subagentType !== 'verification';
}

function normalizeTask(task: any, index: number, parentArgs: any, batchId: number): NormalizedSubagentTask | null {
  const eventId = `batch-${batchId}-task-${index + 1}`;
  const parentPrompt = buildTaskPrompt(parentArgs);

  if (typeof task === 'string') {
    const text = task.trim();
    if (!text) return null;

    const hintedFiles = extractFileHintsFromText(text);
    const mcpFocused = isMcpFocusedSubagentTask(text, parentPrompt);
    const shortcut = text.match(/^([a-z_]+)\s+(.+)$/i);
    if (shortcut) {
      const [, action, rest] = shortcut;
      if (action === 'read_file') {
        const subagentType = parentArgs?.subagent_type || 'explore';
        return {
          eventId,
          action,
          actionArgs: { path: rest.trim() },
          files: hintedFiles,
          mcpFocused,
          subagentType,
          readonly: parentArgs?.readonly !== undefined ? parentArgs.readonly !== false : defaultReadonlyForSubagentType(subagentType),
          label: `task-${index + 1}`,
        };
      }
      if (action === 'grep') {
        const subagentType = parentArgs?.subagent_type || 'explore';
        return {
          eventId,
          action,
          actionArgs: { pattern: rest.trim() },
          files: hintedFiles,
          mcpFocused,
          subagentType,
          readonly: parentArgs?.readonly !== undefined ? parentArgs.readonly !== false : defaultReadonlyForSubagentType(subagentType),
          label: `task-${index + 1}`,
        };
      }
    }

    const subagentType = parentArgs?.subagent_type || 'explore';
    return {
      eventId,
      prompt: text,
      files: hintedFiles,
      mcpFocused,
      subagentType,
      readonly: parentArgs?.readonly !== undefined ? parentArgs.readonly !== false : defaultReadonlyForSubagentType(subagentType),
      label: `task-${index + 1}`,
    };
  }

  if (!task) return null;
  const label = pickTaskLabel(task, index);

  if (task.action || task.tool) {
    const subagentType = task.subagent_type || task.type || parentArgs?.subagent_type || 'explore';
    const mcpFocused = isMcpFocusedSubagentTask(
      task.action || task.tool,
      JSON.stringify(task.args || {}),
      label,
      parentPrompt,
    );
    return {
      eventId,
      action: task.action || task.tool,
      actionArgs: task.args || {},
      files: normalizeTaskFiles(task),
      mcpFocused,
      subagentType,
      readonly: task.readonly !== undefined
        ? task.readonly !== false
        : parentArgs?.readonly !== undefined
          ? parentArgs.readonly !== false
          : defaultReadonlyForSubagentType(subagentType),
      label,
    };
  }

  const prompt = buildTaskPrompt(task);
  if (!prompt) return null;

  const subagentType = task.subagent_type || task.type || parentArgs?.subagent_type || 'explore';
  const mcpFocused = isMcpFocusedSubagentTask(prompt, label, parentPrompt);
  return {
    eventId,
    prompt,
    files: normalizeTaskFiles(task, prompt),
    mcpFocused,
    subagentType,
    readonly: task.readonly !== undefined
      ? task.readonly !== false
      : parentArgs?.readonly !== undefined
        ? parentArgs.readonly !== false
        : defaultReadonlyForSubagentType(subagentType),
    label,
  };
}

function semanticFingerprint(task: NormalizedSubagentTask): string {
  const source = [
    task.prompt || '',
    task.action || '',
    JSON.stringify(task.actionArgs || {}),
    ...(task.files || []),
  ]
    .join(' ')
    .toLowerCase()
    .replace(/[`"'.,:;()[\]{}]+/g, ' ');

  const tokens = Array.from(new Set(
    source
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
      .filter((token) => !STOP_WORDS.has(token))
      .slice(0, 16),
  )).sort();

  return JSON.stringify({
    action: task.action || '',
    tokens,
    files: [...(task.files || [])].map((file) => file.toLowerCase()).sort(),
    subagentType: task.subagentType,
    readonly: task.readonly,
  });
}

function buildTaskDedupKey(task: NormalizedSubagentTask): string {
  return JSON.stringify({
    prompt: (task.prompt || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    action: task.action || '',
    actionArgs: task.actionArgs || {},
    files: Array.isArray(task.files) ? [...task.files].sort() : [],
    subagentType: task.subagentType,
    readonly: task.readonly,
  });
}

function dedupeTasks(tasks: NormalizedSubagentTask[]): NormalizedSubagentTask[] {
  const unique: NormalizedSubagentTask[] = [];
  const seenExact = new Set<string>();
  const seenSemantic = new Set<string>();

  for (const task of tasks) {
    const exactKey = buildTaskDedupKey(task);
    const semanticKey = semanticFingerprint(task);
    if (seenExact.has(exactKey) || seenSemantic.has(semanticKey)) continue;
    seenExact.add(exactKey);
    seenSemantic.add(semanticKey);
    unique.push(task);
  }

  return unique;
}

export function createSubagentBatchPlan(args: any): SubagentBatchPlan {
  const batchId = ++subagentBatchSequence;
  const rawTasks = Array.isArray(args?.tasks) ? args.tasks : [];
  const tasks = dedupeTasks(
    rawTasks
      .map((task: any, index: number) => normalizeTask(task, index, args, batchId))
      .filter((task: NormalizedSubagentTask | null): task is NormalizedSubagentTask => task !== null),
  );

  return {
    batchId,
    parallel: args?.parallel === true,
    tasks,
  };
}

export function summarizeSubagentTask(task: NormalizedSubagentTask): string {
  if (task.prompt) return truncate(task.prompt, 160);
  if (task.action) {
    const args = task.actionArgs && typeof task.actionArgs === 'object' ? Object.values(task.actionArgs).join(' ') : '';
    return truncate(`${task.action} ${args}`.trim(), 160);
  }
  return task.label;
}
