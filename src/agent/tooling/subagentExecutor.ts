import { stripJsonBlocks } from '../prompt';
import { readConfig } from '../../core/api';
import { truncate } from '../../core/utils';
import { runSubagentSingle, sendChatWithStepRetry } from './subagentCore';
import {
  buildSubagentBatchPresentation,
  buildSubagentBatchTaskPresentation,
  buildSubagentDonePresentation,
  buildSubagentErrorPresentation,
  buildSubagentLifecyclePresentation,
  buildSubagentQueuedPresentation,
  buildSubagentResultPresentation,
  buildSubagentStartPresentation,
  buildSubagentStepPresentation,
  buildSubagentSummarizedPresentation,
  buildSubagentToolPresentation,
} from './subagentEventPresentation';
import { expandTaskTargets, inferFilesForPrompt } from './subagentTaskExpander';
import { summarizeSubagentTask } from './subagentTaskNormalizer';
import type {
  NormalizedSubagentTask,
  SubagentBatchPlan,
  SubagentExecutionDependencies,
  SubagentLifecycleState,
  SubagentTaskOutput,
  WorkspaceFileCatalogCache,
} from './subagentTypes';

function emitLifecycle(
  deps: SubagentExecutionDependencies,
  task: NormalizedSubagentTask,
  state: SubagentLifecycleState,
  extra?: Record<string, any>,
) {
  deps.context.onEvent?.('subagent-lifecycle', `[Subagent ${task.label}] ${state}`, {
    ...buildSubagentLifecyclePresentation(state, {
      purpose: extra?.purpose,
      subagentType: extra?.subagentType || task.subagentType,
      readonly: extra?.readonly !== undefined ? extra.readonly : task.readonly,
      files: extra?.files,
      mode: extra?.mode,
      summary: extra?.summary,
      error: extra?.error,
      degraded: extra?.degraded,
    }),
    id: task.eventId,
    label: task.label,
    state,
    ...extra,
  });
}

export async function executeSubagentBatch(
  plan: SubagentBatchPlan,
  executeTool: SubagentExecutionDependencies['executeTool'],
  context: SubagentExecutionDependencies['context'],
): Promise<SubagentTaskOutput[]> {
  const deps: SubagentExecutionDependencies = {
    executeTool,
    context,
    guidedReadCache: new Map<string, Promise<string>>(),
    workspaceFileCache: {},
  };

  context.onEvent?.('subagent-batch', ` [Subagent] Запуск батча: ${plan.tasks.length} задач (${plan.parallel ? 'parallel' : 'sequential'})`, {
    ...buildSubagentBatchPresentation(
      plan.tasks.map((task) => ({
        label: task.label,
        purpose: summarizeSubagentTask(task),
      })),
    ),
    batchId: plan.batchId,
    count: plan.tasks.length,
    parallel: plan.parallel,
    tasks: plan.tasks.map((task) => ({
      id: task.eventId,
      label: task.label,
      purpose: summarizeSubagentTask(task),
      subagentType: task.subagentType,
      readonly: task.readonly,
      lifecycle: 'planned',
      ...buildSubagentBatchTaskPresentation(task),
    })),
  });

  for (const task of plan.tasks) {
    emitLifecycle(deps, task, 'planned', {
      purpose: summarizeSubagentTask(task),
      subagentType: task.subagentType,
      readonly: task.readonly,
    });
    context.onEvent?.('subagent-queued', ` [Subagent ${task.label}] queued`, {
      ...buildSubagentQueuedPresentation({
        purpose: summarizeSubagentTask(task),
        subagentType: task.subagentType,
        readonly: task.readonly,
      }),
      id: task.eventId,
      label: task.label,
      purpose: summarizeSubagentTask(task),
      subagentType: task.subagentType,
      readonly: task.readonly,
      state: 'queued',
    });
  }

  const runOne = (task: NormalizedSubagentTask) => executeNormalizedTask(task, deps);
  if (plan.parallel) {
    return Promise.all(plan.tasks.map(runOne));
  }

  const outputs: SubagentTaskOutput[] = [];
  for (const task of plan.tasks) {
    outputs.push(await runOne(task));
  }
  return outputs;
}

async function executeNormalizedTask(
  task: NormalizedSubagentTask,
  deps: SubagentExecutionDependencies,
): Promise<SubagentTaskOutput> {
  if (task.action) {
    return executeDirectTask(task, deps);
  }

  const explicitTargets = task.files && task.files.length > 0
    ? await expandTaskTargets(task.files, task.prompt, deps.workspaceFileCache)
    : [];
  const inferredFiles = !task.mcpFocused && explicitTargets.length === 0 && task.prompt
    ? await inferFilesForPrompt(task.prompt, deps.executeTool, deps.context, deps.workspaceFileCache)
    : [];
  const guidedFiles = explicitTargets.length > 0 ? explicitTargets : inferredFiles;

  if (task.mcpFocused) {
    emitLifecycle(deps, task, 'running', { mode: 'single' });
    const result = await runSubagentSingle(
      {
        prompt: task.prompt,
        subagent_type: task.subagentType,
        readonly: task.readonly,
        mcp_focused: true,
      },
      deps.executeTool,
      deps.context,
    );
    emitLifecycle(deps, task, 'done', { summary: truncate(result, 400) });
    deps.context.onEvent?.('subagent-summarized', ` [Subagent ${task.label}] summarized`, {
      ...buildSubagentSummarizedPresentation({ preview: truncate(result, 400) }),
      id: task.eventId,
      label: task.label,
      state: 'summarized',
      preview: truncate(result, 400),
    });
    emitLifecycle(deps, task, 'summarized', { summary: truncate(result, 400) });
    return { label: task.label, result };
  }

  if (guidedFiles.length > 0) {
    return executeGuidedTask(task, guidedFiles, deps);
  }

  emitLifecycle(deps, task, 'running', { mode: 'single' });
  const result = await runSubagentSingle(
    {
      prompt: task.prompt,
      subagent_type: task.subagentType,
      readonly: task.readonly,
      mcp_focused: Boolean(task.mcpFocused),
    },
    deps.executeTool,
    deps.context,
  );
  emitLifecycle(deps, task, 'done', { summary: truncate(result, 400) });
  deps.context.onEvent?.('subagent-summarized', ` [Subagent ${task.label}] summarized`, {
    ...buildSubagentSummarizedPresentation({ preview: truncate(result, 400) }),
    id: task.eventId,
    label: task.label,
    state: 'summarized',
    preview: truncate(result, 400),
  });
  emitLifecycle(deps, task, 'summarized', { summary: truncate(result, 400) });
  return { label: task.label, result };
}

async function executeDirectTask(
  task: NormalizedSubagentTask,
  deps: SubagentExecutionDependencies,
): Promise<SubagentTaskOutput> {
  emitLifecycle(deps, task, 'running', { mode: 'direct' });
  deps.context.onEvent?.('subagent-start', ` [Subagent ${task.label}] direct-mode`, {
    ...buildSubagentStartPresentation({
      purpose: task.prompt || summarizeSubagentTask(task),
      subagentType: task.subagentType,
      readonly: task.readonly,
      mode: 'direct',
    }),
    id: task.eventId,
    label: task.label,
    purpose: task.prompt || summarizeSubagentTask(task),
    state: 'running',
    mode: 'direct',
  });
  deps.context.onEvent?.('subagent-step', ` [Subagent ${task.label}] direct action`, {
    ...buildSubagentStepPresentation({ step: 1 }),
    id: task.eventId,
    label: task.label,
    step: 1,
    state: 'running',
  });
  deps.context.onEvent?.('subagent-tool', ` [Subagent ${task.label}] ${task.action}`, {
    ...buildSubagentToolPresentation({
      tool: task.action,
      args: task.actionArgs || {},
    }),
    id: task.eventId,
    label: task.label,
    tool: task.action,
    args: task.actionArgs || {},
    state: 'running',
  });

  const result = await deps.executeTool(task.action!, task.actionArgs || {}, deps.context.query, deps.context.onEvent, deps.context.signal);
  deps.context.onEvent?.('subagent-result', ` [Subagent ${task.label}] ${task.action} → ${result.split('\n').length} строк`, {
    ...buildSubagentResultPresentation({
      tool: task.action,
      resultPreview: truncate(result, 400),
    }),
    id: task.eventId,
    label: task.label,
    tool: task.action,
    resultPreview: truncate(result, 400),
    state: 'running',
  });
  deps.context.onEvent?.('subagent-done', ` [Subagent ${task.label}] Завершён`, {
    ...buildSubagentDonePresentation({ preview: result }),
    id: task.eventId,
    label: task.label,
    state: 'done',
    preview: result,
  });
  deps.context.onEvent?.('subagent-summarized', ` [Subagent ${task.label}] summarized`, {
    ...buildSubagentSummarizedPresentation({ preview: truncate(result, 400) }),
    id: task.eventId,
    label: task.label,
    state: 'summarized',
    preview: truncate(result, 400),
  });
  emitLifecycle(deps, task, 'summarized', { summary: truncate(result, 400) });
  return { label: task.label, result };
}

async function executeGuidedTask(
  task: NormalizedSubagentTask,
  guidedFiles: string[],
  deps: SubagentExecutionDependencies,
): Promise<SubagentTaskOutput> {
  const config = readConfig();
  emitLifecycle(deps, task, 'running', { mode: 'guided', files: guidedFiles });
  deps.context.onEvent?.('subagent-start', ` [Subagent ${task.label}] guided-mode: ${guidedFiles.length} файлов`, {
    ...buildSubagentStartPresentation({
      purpose: task.prompt || '',
      subagentType: task.subagentType,
      readonly: task.readonly,
      files: guidedFiles,
      mode: 'guided',
    }),
    id: task.eventId,
    label: task.label,
    purpose: task.prompt || '',
    files: guidedFiles,
    state: 'running',
  });

  const snippets: string[] = [];
  for (let index = 0; index < guidedFiles.length; index++) {
    const filePath = guidedFiles[index];
    deps.context.onEvent?.('subagent-step', ` [Subagent ${task.label}] Шаг ${index + 1}`, {
      ...buildSubagentStepPresentation({ step: index + 1 }),
      id: task.eventId,
      label: task.label,
      step: index + 1,
      state: 'running',
    });
    deps.context.onEvent?.('subagent-tool', ` [Subagent ${task.label}] read_file`, {
      ...buildSubagentToolPresentation({
        tool: 'read_file',
        args: { path: filePath },
      }),
      id: task.eventId,
      label: task.label,
      tool: 'read_file',
      args: { path: filePath },
      state: 'running',
    });

    let readPromise = deps.guidedReadCache.get(filePath);
    if (!readPromise) {
      readPromise = deps.executeTool('read_file', { path: filePath }, deps.context.query, deps.context.onEvent, deps.context.signal);
      deps.guidedReadCache.set(filePath, readPromise);
    }

    const result = await readPromise;
    deps.context.onEvent?.('subagent-result', ` [Subagent ${task.label}] read_file → ${result.split('\n').length} строк`, {
      ...buildSubagentResultPresentation({
        tool: 'read_file',
        resultPreview: truncate(result, 400),
      }),
      id: task.eventId,
      label: task.label,
      tool: 'read_file',
      resultPreview: truncate(result, 400),
      state: 'running',
    });
    snippets.push(`### ${filePath}\n${truncate(result, 4500)}`);
  }

  if (!config.apiBaseUrl || !config.apiKey || !config.model) {
    const fallback = `Guided subagent (${task.label})\n\n${snippets.join('\n\n')}`;
    deps.context.onEvent?.('subagent-done', ` [Subagent ${task.label}] Завершён`, {
      ...buildSubagentDonePresentation({ preview: truncate(fallback, 400) }),
      id: task.eventId,
      label: task.label,
      state: 'done',
      preview: truncate(fallback, 400),
    });
    deps.context.onEvent?.('subagent-summarized', ` [Subagent ${task.label}] summarized`, {
      ...buildSubagentSummarizedPresentation({ preview: truncate(fallback, 400) }),
      id: task.eventId,
      label: task.label,
      state: 'summarized',
      preview: truncate(fallback, 400),
    });
    emitLifecycle(deps, task, 'summarized', { summary: truncate(fallback, 400) });
    return { label: task.label, result: fallback };
  }

  try {
    const summary = await sendChatWithStepRetry(
      config.apiBaseUrl,
      config.apiKey,
      config.model,
      [
        {
          role: 'system',
          content: 'Ты подагент-аналитик. Дай краткий, но фактический markdown-отчёт только по предоставленным фрагментам. Не выдумывай данные, отмечай неопределённость явно.',
        },
        {
          role: 'user',
          content: `Задача:\n${task.prompt || 'Проанализируй материалы'}\n\nМатериалы:\n${snippets.join('\n\n')}\n\nСформируй структурированный итог (ключевые факты, выводы, риски, что проверить).`,
        },
      ],
      { temperature: 0.2, signal: deps.context.signal },
      task.label,
      deps.context.onEvent,
    );

    const done = stripJsonBlocks(summary);
    deps.context.onEvent?.('subagent-done', ` [Subagent ${task.label}] Завершён`, {
      ...buildSubagentDonePresentation({ preview: truncate(done, 400) }),
      id: task.eventId,
      label: task.label,
      state: 'done',
      preview: truncate(done, 400),
    });
    deps.context.onEvent?.('subagent-summarized', ` [Subagent ${task.label}] summarized`, {
      ...buildSubagentSummarizedPresentation({ preview: truncate(done, 400) }),
      id: task.eventId,
      label: task.label,
      state: 'summarized',
      preview: truncate(done, 400),
    });
    emitLifecycle(deps, task, 'summarized', { summary: truncate(done, 400) });
    return { label: task.label, result: done };
  } catch (error: any) {
    const fallback = `Guided subagent (${task.label})\n\n${snippets.join('\n\n')}`;
    deps.context.onEvent?.('subagent-error', ` [Subagent ${task.label}] Ошибка API: ${error?.message || error}`, {
      ...buildSubagentErrorPresentation({
        error: error?.message || String(error),
      }),
      id: task.eventId,
      label: task.label,
      state: 'error',
      error: error?.message || String(error),
    });
    emitLifecycle(deps, task, 'error', { error: error?.message || String(error) });
    deps.context.onEvent?.('subagent-done', ` [Subagent ${task.label}] Завершён (fallback)`, {
      ...buildSubagentDonePresentation({ preview: truncate(fallback, 400) }),
      id: task.eventId,
      label: task.label,
      state: 'done',
      preview: truncate(fallback, 400),
    });
    deps.context.onEvent?.('subagent-summarized', ` [Subagent ${task.label}] summarized`, {
      ...buildSubagentSummarizedPresentation({ preview: truncate(fallback, 400) }),
      id: task.eventId,
      label: task.label,
      state: 'summarized',
      preview: truncate(fallback, 400),
    });
    emitLifecycle(deps, task, 'summarized', { summary: truncate(fallback, 400), degraded: true });
    return { label: task.label, result: fallback };
  }
}
