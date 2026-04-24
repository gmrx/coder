import { truncate } from '../../../core/utils';
import {
  buildTfsWiql,
  formatTfsProjectList,
  formatTfsTaskDetail,
  formatTfsTaskSearchResult,
  getTfsTaskDetails,
  listTfsProjects,
  normalizeLimit,
  normalizeOffset,
  normalizeTfsTaskId,
  readTfsConnectionConfig,
  searchTfsTasks,
  type TfsConnectionConfig,
  type TfsSearchTasksOptions,
} from '../../../core/tfsClient';
import { createToolExecutionResult, type ToolExecutionResult } from '../results';
import type { ToolHandlerMap } from '../types';

export const tfsToolHandlers: ToolHandlerMap = {
  async tfs_list_projects(args, context) {
    const connection = readTfsConnectionConfig(args || {});
    const limit = normalizeLimit(args?.limit, 100, 500);
    const offset = normalizeOffset(args?.offset ?? args?.startAt ?? args?.start_at);
    const query = firstText(args?.query, args?.search, args?.text);

    try {
      const projects = await listTfsProjects(connection, query);
      const page = projects.slice(offset, offset + limit);
      return createToolExecutionResult(
        'tfs_list_projects',
        'success',
        truncate(formatTfsProjectList(page, projects.length, { connection, offset, limit }), 12_000),
      );
    } catch (error: any) {
      return createTfsErrorResult('tfs_list_projects', error, connection);
    }
  },

  async tfs_search_tasks(args, context) {
    const connection = readTfsConnectionConfig(args || {});
    const limit = normalizeLimit(args?.limit ?? args?.maxResults ?? args?.max_results, 10, 50);
    const offset = normalizeOffset(args?.offset ?? args?.startAt ?? args?.start_at);
    const options: TfsSearchTasksOptions = {
      wiql: firstText(args?.wiql),
      project: firstText(args?.project, args?.teamProject, args?.team_project),
      assignee: firstText(args?.assignee, args?.assignedTo, args?.assigned_to, 'me'),
      status: args?.status ?? args?.state,
      text: firstText(args?.text, args?.query, args?.search),
      limit,
      offset,
      orderBy: firstText(args?.orderBy, args?.order_by),
    };
    const wiql = options.wiql || buildTfsWiql(options);

    try {
      const tasks = await searchTfsTasks(connection, options);
      return createToolExecutionResult(
        'tfs_search_tasks',
        'success',
        truncate(formatTfsTaskSearchResult(tasks, { connection, wiql, offset, limit }), 14_000),
      );
    } catch (error: any) {
      return createTfsErrorResult('tfs_search_tasks', error, connection);
    }
  },

  async tfs_get_task(args, context) {
    const connection = readTfsConnectionConfig(args || {});
    const id = normalizeTfsTaskId(firstText(args?.id, args?.workItemId, args?.work_item_id, args?.key));
    if (!id) {
      return createToolExecutionResult('tfs_get_task', 'error', 'Для tfs_get_task обязателен id или workItemId.');
    }

    try {
      const task = await getTfsTaskDetails(connection, id);
      return createToolExecutionResult(
        'tfs_get_task',
        'success',
        truncate(formatTfsTaskDetail(task, connection), 24_000),
      );
    } catch (error: any) {
      return createTfsErrorResult('tfs_get_task', error, connection);
    }
  },
};

function createTfsErrorResult(
  toolName: 'tfs_list_projects' | 'tfs_search_tasks' | 'tfs_get_task',
  error: any,
  connection: TfsConnectionConfig,
): ToolExecutionResult {
  const lines = [
    `Ошибка TFS: ${error?.message || error}`,
    connection.serverUrl ? `Host: ${connection.serverUrl}` : '',
    connection.collection ? `Коллекция: ${connection.collection}` : '',
    connection.authMode === 'basic' && connection.username ? `Авторизация: Basic (${connection.username})` : '',
    'Проверь настройки TFS: host, collection, login и password. Если TFS принимает только доменный логин, укажи DOMAIN\\login или оставь короткий логин, чтобы расширение попробовало домен из NTLM challenge.',
  ].filter(Boolean);
  return createToolExecutionResult(toolName, 'error', truncate(lines.join('\n'), 8_000));
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}
