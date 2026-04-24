import * as http from 'http';
import * as https from 'https';
import type { AssistantConfig } from './types';
import { readConfig } from './api';
import { truncate } from './utils';

const TFS_TIMEOUT_MS = 20_000;
const DEFAULT_TFS_COLLECTION = 'DefaultCollection';
const TFS_API_VERSION = '1.0';
const TFS_PROJECT_API_VERSION = '2.0';
const TFS_WORK_ITEM_BATCH_SIZE = 200;

const SUMMARY_FIELDS = [
  'System.Id',
  'System.Title',
  'System.TeamProject',
  'System.State',
  'System.WorkItemType',
  'System.AssignedTo',
  'System.CreatedBy',
  'System.CreatedDate',
  'System.ChangedDate',
  'System.Description',
  'Microsoft.VSTS.Common.Priority',
  'Microsoft.VSTS.Common.Severity',
];

const KNOWN_DETAIL_FIELDS = new Set([
  'System.Id',
  'System.AreaPath',
  'System.TeamProject',
  'System.IterationPath',
  'System.WorkItemType',
  'System.State',
  'System.Reason',
  'System.AssignedTo',
  'System.CreatedDate',
  'System.CreatedBy',
  'System.ChangedDate',
  'System.ChangedBy',
  'System.Title',
  'System.Description',
  'System.History',
  'System.Tags',
  'Microsoft.VSTS.Common.Priority',
  'Microsoft.VSTS.Common.Severity',
  'Microsoft.VSTS.Common.ValueArea',
  'Microsoft.VSTS.Common.StateChangeDate',
  'Microsoft.VSTS.Common.ActivatedDate',
  'Microsoft.VSTS.Common.ActivatedBy',
  'Microsoft.VSTS.Common.ResolvedDate',
  'Microsoft.VSTS.Common.ResolvedBy',
  'Microsoft.VSTS.Common.ResolvedReason',
  'Microsoft.VSTS.Common.ClosedDate',
  'Microsoft.VSTS.Common.ClosedBy',
]);

export interface TfsConnectionConfig {
  serverUrl: string;
  collection: string;
  collectionUrl: string;
  username: string;
  password: string;
  authMode: 'anonymous' | 'basic';
}

export interface TfsProjectOption {
  id: string;
  key: string;
  name: string;
  description: string;
  url: string;
  state: string;
}

export interface TfsTaskSummary {
  id: number;
  key: string;
  title: string;
  description: string;
  url: string;
  projectName: string;
  status: string;
  type: string;
  assignedTo: string;
  createdBy: string;
  created: string;
  updated: string;
  priority: string;
  severity: string;
  updatedAt?: number;
}

export interface TfsProjectTaskSummary extends TfsProjectOption {
  taskCount: number;
  tasks: TfsTaskSummary[];
}

export interface TfsTaskHistoryEntry {
  revision: number;
  author: string;
  date: string;
  text: string;
  changedFields: string[];
}

export interface TfsTaskRelation {
  type: string;
  url: string;
  label: string;
  targetId: number;
}

export interface TfsTaskCustomField {
  id: string;
  name: string;
  value: string;
}

export interface TfsTaskDetails extends TfsTaskSummary {
  reason: string;
  changedBy: string;
  areaPath: string;
  iterationPath: string;
  tags: string[];
  valueArea: string;
  stateChanged: string;
  activated: string;
  activatedBy: string;
  resolved: string;
  resolvedBy: string;
  resolvedReason: string;
  closed: string;
  closedBy: string;
  relations: TfsTaskRelation[];
  history: TfsTaskHistoryEntry[];
  customFields: TfsTaskCustomField[];
  warnings: string[];
}

export interface TfsAuthCheckResult {
  ok: boolean;
  error: string;
  authUser: string;
  authMode: 'anonymous' | 'basic';
  baseUrl: string;
  collection: string;
  effectiveUsername: string;
}

export interface TfsProjectListResult extends TfsAuthCheckResult {
  projects: TfsProjectOption[];
}

export interface TfsProjectTasksResult extends TfsAuthCheckResult {
  projectKey: string;
  tasks: TfsTaskSummary[];
}

export interface TfsTaskDetailsResult extends TfsAuthCheckResult {
  task: TfsTaskDetails | null;
}

export interface TfsCheckResult extends TfsAuthCheckResult {
  projectsCount: number;
  totalTasks: number;
  projects: TfsProjectTaskSummary[];
  warning?: string;
}

export interface TfsSearchTasksOptions {
  wiql?: string;
  project?: string;
  assignee?: string;
  status?: string | string[];
  text?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
}

class TfsRequestError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly url: string,
    readonly body: string,
    readonly json: any,
  ) {
    super(`TFS HTTP ${status} ${statusText}`);
  }
}

class TfsTimeoutError extends Error {
  constructor(readonly step: string) {
    super(`${step}: TFS не ответил за ${TFS_TIMEOUT_MS / 1000} секунд.`);
    this.name = 'TfsTimeoutError';
  }
}

interface TfsTextResponse {
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  url: string;
  effectiveUsername: string;
}

export function readTfsConnectionConfig(data: Partial<AssistantConfig> | Record<string, unknown> = {}): TfsConnectionConfig {
  const saved: Record<string, unknown> = {
    ...(readConfig() as unknown as Record<string, unknown>),
    ...((data || {}) as Record<string, unknown>),
  };
  const normalized = normalizeTfsBaseUrl(firstText(
    saved.tfsBaseUrl,
    saved.baseUrl,
    saved.base_url,
    process.env.TFS_BASE_URL,
  ));
  const collection = firstText(
    saved.tfsCollection,
    saved.collection,
    saved.collectionName,
    saved.collection_name,
    normalized.collection,
    process.env.TFS_COLLECTION,
    DEFAULT_TFS_COLLECTION,
  );
  const serverUrl = normalized.serverUrl;
  const normalizedCollection = normalizeCollectionName(collection);
  const username = firstText(
    saved.tfsUsername,
    saved.username,
    process.env.TFS_USERNAME,
    process.env.TFS_USER,
  );
  const password = firstText(
    saved.tfsPassword,
    saved.password,
    process.env.TFS_PASSWORD,
    process.env.TFS_TOKEN,
  );
  return {
    serverUrl,
    collection: normalizedCollection,
    collectionUrl: serverUrl && normalizedCollection
      ? `${serverUrl}/${encodePathSegment(normalizedCollection)}`
      : '',
    username,
    password,
    authMode: username && password ? 'basic' : 'anonymous',
  };
}

export function readSavedTfsConnectionConfig(): TfsConnectionConfig {
  return readTfsConnectionConfig(readConfig());
}

export async function checkTfsSettings(data: Partial<AssistantConfig>): Promise<TfsCheckResult> {
  const connection = readTfsConnectionConfig(data);
  try {
    ensureTfsAuthorization(connection);
    const auth = await checkTfsAuthorization(connection);
    const projects = await listTfsProjects(connection);
    const taskCounts = await readCurrentUserTfsTaskCounts(connection);
    const summaries = projects.map((project) => ({
      ...project,
      taskCount: taskCounts.byProject.get(project.name) || 0,
      tasks: taskCounts.tasksByProject.get(project.name) || [],
    })).sort((left, right) => right.taskCount - left.taskCount || left.name.localeCompare(right.name));
    return {
      ok: true,
      error: '',
      authUser: auth.authUser,
      authMode: connection.authMode,
      baseUrl: connection.serverUrl,
      collection: connection.collection,
      effectiveUsername: auth.effectiveUsername,
      projectsCount: summaries.length,
      totalTasks: taskCounts.total,
      projects: summaries,
      ...(taskCounts.warning ? { warning: taskCounts.warning } : {}),
    };
  } catch (error: any) {
    return {
      ok: false,
      error: formatTfsError(error),
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.serverUrl,
      collection: connection.collection,
      effectiveUsername: '',
      projectsCount: 0,
      totalTasks: 0,
      projects: [],
    };
  }
}

export async function checkSavedTfsAuthorization(): Promise<TfsAuthCheckResult> {
  const connection = readSavedTfsConnectionConfig();
  try {
    ensureTfsAuthorization(connection);
    return await checkTfsAuthorization(connection);
  } catch (error: any) {
    return {
      ok: false,
      error: formatTfsError(error),
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.serverUrl,
      collection: connection.collection,
      effectiveUsername: '',
    };
  }
}

export async function listSavedTfsProjects(): Promise<TfsProjectListResult> {
  const connection = readSavedTfsConnectionConfig();
  try {
    ensureTfsAuthorization(connection);
    const auth = await checkTfsAuthorization(connection);
    const projects = await listTfsProjects(connection);
    return {
      ...auth,
      projects,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: formatTfsError(error),
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.serverUrl,
      collection: connection.collection,
      effectiveUsername: '',
      projects: [],
    };
  }
}

export async function listSavedTfsProjectTasks(projectName: string, limit = 100): Promise<TfsProjectTasksResult> {
  const connection = readSavedTfsConnectionConfig();
  const key = firstText(projectName);
  try {
    ensureTfsAuthorization(connection);
    if (!key) throw new Error('Не выбран проект TFS.');
    const auth = await checkTfsAuthorization(connection);
    const tasks = await searchTfsTasks(connection, {
      project: key,
      assignee: 'me',
      limit,
      orderBy: '[System.ChangedDate] DESC',
    });
    return {
      ...auth,
      projectKey: key,
      tasks,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: formatTfsError(error),
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.serverUrl,
      collection: connection.collection,
      effectiveUsername: '',
      projectKey: key,
      tasks: [],
    };
  }
}

export async function getSavedTfsTaskDetails(id: string | number): Promise<TfsTaskDetailsResult> {
  const connection = readSavedTfsConnectionConfig();
  try {
    ensureTfsAuthorization(connection);
    const taskId = normalizeTfsTaskId(id);
    if (!taskId) throw new Error('Не выбран work item TFS.');
    const auth = await checkTfsAuthorization(connection);
    const task = await getTfsTaskDetails(connection, taskId);
    return {
      ...auth,
      task,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: formatTfsError(error),
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.serverUrl,
      collection: connection.collection,
      effectiveUsername: '',
      task: null,
    };
  }
}

export async function checkTfsAuthorization(connection: TfsConnectionConfig): Promise<TfsAuthCheckResult> {
  const result = await requestTfsJson(connection, '_apis/connectionData', {
    apiVersion: TFS_API_VERSION,
    step: 'Проверка авторизации TFS',
  });
  const user = result.json?.authenticatedUser || result.json?.authorizedUser || {};
  return {
    ok: true,
    error: '',
    authUser: formatTfsUser(user) || result.effectiveUsername || connection.username,
    authMode: connection.authMode,
    baseUrl: connection.serverUrl,
    collection: connection.collection,
    effectiveUsername: result.effectiveUsername,
  };
}

export async function listTfsProjects(connection: TfsConnectionConfig, query = ''): Promise<TfsProjectOption[]> {
  const result = await requestTfsJson(connection, '_apis/projects', {
    apiVersion: TFS_PROJECT_API_VERSION,
    step: 'Загрузка проектов TFS',
  });
  const needle = query.toLowerCase().trim();
  return (Array.isArray(result.json?.value) ? result.json.value : [])
    .map((project: any) => toTfsProjectOption(project, connection))
    .filter((project: TfsProjectOption) => project.name)
    .filter((project: TfsProjectOption) => !needle || [
      project.name,
      project.description,
      project.state,
      project.id,
    ].some((value) => String(value || '').toLowerCase().includes(needle)))
    .sort((left: TfsProjectOption, right: TfsProjectOption) => left.name.localeCompare(right.name));
}

export async function searchTfsTasks(
  connection: TfsConnectionConfig,
  options: TfsSearchTasksOptions = {},
): Promise<TfsTaskSummary[]> {
  const wiql = options.wiql || buildTfsWiql(options);
  const result = await requestTfsJson(connection, '_apis/wit/wiql', {
    apiVersion: TFS_API_VERSION,
    method: 'POST',
    body: JSON.stringify({ query: wiql }),
    step: 'Поиск задач TFS',
  });
  const refs = Array.isArray(result.json?.workItems) ? result.json.workItems : [];
  const offset = normalizeOffset(options.offset);
  const limit = normalizeLimit(options.limit, 10, 200);
  const ids: number[] = refs
    .map((item: any) => normalizeTfsTaskId(item?.id))
    .filter((id: number) => id > 0)
    .slice(offset, offset + limit);
  if (!ids.length) return [];

  const tasks = await readTfsWorkItems(connection, ids, SUMMARY_FIELDS);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return ids.map((id) => byId.get(id)).filter(isPresent);
}

export async function getTfsTaskDetails(connection: TfsConnectionConfig, id: number): Promise<TfsTaskDetails> {
  const result = await requestTfsJson(connection, `_apis/wit/workitems/${encodeURIComponent(String(id))}`, {
    apiVersion: TFS_API_VERSION,
    params: { '$expand': 'relations' },
    step: 'Загрузка work item TFS',
  });
  const history = await readTfsTaskHistorySafe(connection, id);
  const task = toTfsTaskDetails(result.json, connection, history.history);
  if (history.warning) task.warnings.push(history.warning);
  return task;
}

export function formatTfsProjectList(
  projects: TfsProjectOption[],
  total: number,
  options: { connection: TfsConnectionConfig; offset: number; limit: number },
): string {
  const lines = [
    `TFS projects: ${projects.length} из ${total} (offset=${options.offset}, limit=${options.limit})`,
    formatTfsAuthLine(options.connection),
    `Коллекция: ${options.connection.collection}`,
    '',
  ];
  if (!projects.length) {
    lines.push('Проекты TFS не найдены.');
    return lines.join('\n').trim();
  }
  for (const project of projects) {
    lines.push(`- ${project.name}`);
    if (project.description) lines.push(`  Описание: ${truncate(project.description, 500, '...')}`);
    lines.push(`  URL: ${project.url}`);
    if (project.state) lines.push(`  Состояние: ${project.state}`);
  }
  return lines.join('\n').trim();
}

export function formatTfsTaskSearchResult(
  tasks: TfsTaskSummary[],
  options: { connection: TfsConnectionConfig; wiql: string; offset: number; limit: number },
): string {
  const lines = [
    `TFS tasks: ${tasks.length} (offset=${options.offset}, limit=${options.limit})`,
    `WIQL: ${options.wiql}`,
    formatTfsAuthLine(options.connection),
    `Коллекция: ${options.connection.collection}`,
    '',
  ];
  if (!tasks.length) {
    lines.push('Задачи TFS не найдены.');
    return lines.join('\n').trim();
  }
  for (const task of tasks) {
    lines.push(formatTfsTaskSummary(task));
  }
  return lines.join('\n').trim();
}

export function formatTfsTaskDetail(task: TfsTaskDetails, connection: TfsConnectionConfig): string {
  const lines = [
    `TFS work item ${task.id}: ${task.title || '(без названия)'}`,
    `URL: ${task.url}`,
    formatTfsAuthLine(connection),
    `Коллекция: ${connection.collection}`,
    '',
    [
      task.projectName ? `Проект: ${task.projectName}` : '',
      task.type ? `Тип: ${task.type}` : '',
      task.status ? `Статус: ${task.status}` : '',
      task.reason ? `Причина: ${task.reason}` : '',
      task.priority ? `Приоритет: ${task.priority}` : '',
      task.severity ? `Severity: ${task.severity}` : '',
    ].filter(Boolean).join('; '),
    `Исполнитель: ${task.assignedTo || 'n/a'}`,
    `Автор: ${task.createdBy || 'n/a'}`,
    `Создана: ${task.created || 'n/a'}`,
    `Обновлена: ${task.updated || 'n/a'}${task.changedBy ? `; кем: ${task.changedBy}` : ''}`,
  ].filter(Boolean);

  if (task.areaPath) lines.push(`Area: ${task.areaPath}`);
  if (task.iterationPath) lines.push(`Iteration: ${task.iterationPath}`);
  if (task.tags.length) lines.push(`Tags: ${task.tags.join(', ')}`);
  if (task.description) {
    lines.push('', 'Описание:', truncate(task.description, 5_000));
  }
  if (task.relations.length) {
    lines.push('', 'Связи TFS:', ...task.relations.map((relation) => `- ${formatTfsRelation(relation)}`));
  }
  if (task.history.length) {
    lines.push('', `История/комментарии (${task.history.length}):`);
    for (const item of task.history.slice(0, 80)) {
      lines.push(`- rev ${item.revision} • ${item.author || 'n/a'} • ${item.date || 'n/a'}`);
      if (item.text) lines.push(`  ${truncate(item.text, 1_500, '...').replace(/\n/g, '\n  ')}`);
      if (item.changedFields.length) lines.push(`  Поля: ${item.changedFields.join(', ')}`);
    }
  }
  if (task.customFields.length) {
    lines.push('', 'Дополнительные поля TFS:');
    for (const field of task.customFields.slice(0, 120)) {
      lines.push(`- ${field.name}: ${truncate(field.value, 1_500, '...')}`);
    }
  }
  if (task.warnings.length) {
    lines.push('', 'Предупреждения:', ...task.warnings.map((warning) => `- ${warning}`));
  }
  return lines.join('\n').trim();
}

export function buildTfsWiql(options: TfsSearchTasksOptions = {}): string {
  const clauses: string[] = [];
  const project = firstText(options.project);
  if (project) {
    clauses.push(`[System.TeamProject] = ${quoteWiqlString(project)}`);
  }

  const assignee = firstText(options.assignee, 'me');
  if (assignee) {
    clauses.push(`[System.AssignedTo] = ${isCurrentUserAlias(assignee) ? '@Me' : quoteWiqlString(assignee)}`);
  }

  appendTfsClause(clauses, '[System.State]', options.status);

  const text = firstText(options.text);
  if (text) {
    clauses.push(`([System.Title] CONTAINS ${quoteWiqlString(text)} OR [System.Description] CONTAINS ${quoteWiqlString(text)})`);
  }

  const orderBy = firstText(options.orderBy, '[System.ChangedDate] DESC');
  return [
    `SELECT [System.Id], [System.Title], [System.TeamProject], [System.State], [System.WorkItemType], [System.AssignedTo], [System.ChangedDate] FROM WorkItems`,
    clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    orderBy ? `ORDER BY ${orderBy}` : '',
  ].filter(Boolean).join(' ');
}

export function normalizeTfsTaskId(value: unknown): number {
  const text = firstText(value).replace(/^#/, '');
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

export function normalizeLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

export function normalizeOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function ensureTfsAuthorization(connection: TfsConnectionConfig): void {
  if (!connection.serverUrl) {
    throw new Error('Сначала укажите TFS host в настройках.');
  }
  if (!connection.collection) {
    throw new Error('Сначала укажите коллекцию TFS в настройках.');
  }
  if (connection.authMode !== 'basic') {
    throw new Error('Сначала сохраните TFS host, логин и пароль в настройках и проверьте авторизацию.');
  }
}

async function readCurrentUserTfsTaskCounts(connection: TfsConnectionConfig): Promise<{
  byProject: Map<string, number>;
  tasksByProject: Map<string, TfsTaskSummary[]>;
  total: number;
  warning?: string;
}> {
  const byProject = new Map<string, number>();
  const tasksByProject = new Map<string, TfsTaskSummary[]>();
  try {
    const wiql = buildTfsWiql({
      assignee: 'me',
      orderBy: '[System.TeamProject] ASC, [System.ChangedDate] DESC',
      limit: 1000,
    });
    const result = await requestTfsJson(connection, '_apis/wit/wiql', {
      apiVersion: TFS_API_VERSION,
      method: 'POST',
      body: JSON.stringify({ query: wiql }),
      step: 'Подсчёт задач пользователя TFS',
    });
    const ids = (Array.isArray(result.json?.workItems) ? result.json.workItems : [])
      .map((item: any) => normalizeTfsTaskId(item?.id))
      .filter(Boolean);
    const tasks = await readTfsWorkItems(connection, ids.slice(0, 2_000), SUMMARY_FIELDS);
    for (const task of tasks) {
      if (!task.projectName) continue;
      byProject.set(task.projectName, (byProject.get(task.projectName) || 0) + 1);
      const projectTasks = tasksByProject.get(task.projectName) || [];
      projectTasks.push(task);
      tasksByProject.set(task.projectName, projectTasks);
    }
    const warning = ids.length > tasks.length
      ? `Загружено ${tasks.length} задач из ${ids.length}; счётчики по проектам могут быть неполными.`
      : '';
    return {
      byProject,
      tasksByProject,
      total: ids.length,
      ...(warning ? { warning } : {}),
    };
  } catch (error: any) {
    return {
      byProject,
      tasksByProject,
      total: 0,
      warning: `Авторизация и список проектов проверены, но задачи TFS посчитать не удалось: ${formatTfsError(error)}`,
    };
  }
}

async function readTfsWorkItems(
  connection: TfsConnectionConfig,
  ids: number[],
  fields: string[] = SUMMARY_FIELDS,
): Promise<TfsTaskSummary[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const output: TfsTaskSummary[] = [];
  for (let index = 0; index < uniqueIds.length; index += TFS_WORK_ITEM_BATCH_SIZE) {
    const batch = uniqueIds.slice(index, index + TFS_WORK_ITEM_BATCH_SIZE);
    const result = await requestTfsJson(connection, '_apis/wit/workitems', {
      apiVersion: TFS_API_VERSION,
      params: {
        ids: batch.join(','),
        fields: fields.join(','),
      },
      step: 'Загрузка work items TFS',
    });
    const items = Array.isArray(result.json?.value) ? result.json.value : [];
    output.push(...items.map((item: any) => toTfsTaskSummary(item, connection)).filter((task: TfsTaskSummary) => task.id));
  }
  return output;
}

async function readTfsTaskHistorySafe(
  connection: TfsConnectionConfig,
  id: number,
): Promise<{ history: TfsTaskHistoryEntry[]; warning: string }> {
  try {
    const result = await requestTfsJson(connection, `_apis/wit/workitems/${encodeURIComponent(String(id))}/updates`, {
      apiVersion: TFS_API_VERSION,
      step: 'Загрузка истории work item TFS',
    });
    const updates = Array.isArray(result.json?.value) ? result.json.value : [];
    return {
      history: updates.map(toTfsHistoryEntry).filter((entry: TfsTaskHistoryEntry) => entry.text || entry.changedFields.length),
      warning: '',
    };
  } catch (error: any) {
    return {
      history: [],
      warning: `Историю TFS не удалось загрузить: ${formatTfsError(error)}`,
    };
  }
}

async function requestTfsJson(
  connection: TfsConnectionConfig,
  path: string,
  options: {
    apiVersion?: string;
    params?: Record<string, string>;
    method?: 'GET' | 'POST';
    body?: string;
    step?: string;
    signal?: AbortSignal;
  } = {},
): Promise<{ json: any; url: string; effectiveUsername: string }> {
  const response = await requestTfsText(connection, path, options);
  const json = parseJson(response.body);
  if (response.status < 200 || response.status >= 300) {
    throw new TfsRequestError(response.status, response.statusText, response.url, stripMarkup(response.body), json);
  }
  if (json === null) {
    throw new Error(`${options.step || 'Запрос TFS'}: TFS вернул не JSON: ${stripMarkup(response.body).slice(0, 500)}`);
  }
  return { json, url: response.url, effectiveUsername: response.effectiveUsername };
}

async function requestTfsText(
  connection: TfsConnectionConfig,
  path: string,
  options: {
    apiVersion?: string;
    params?: Record<string, string>;
    method?: 'GET' | 'POST';
    body?: string;
    step?: string;
    signal?: AbortSignal;
  } = {},
): Promise<TfsTextResponse> {
  if (!connection.collectionUrl) {
    throw new Error('Сначала укажите TFS host и коллекцию в настройках.');
  }

  const url = new URL(`${connection.collectionUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(options.params || {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  url.searchParams.set('api-version', options.apiVersion || TFS_API_VERSION);

  const method = options.method || (options.body ? 'POST' : 'GET');
  const body = options.body || '';
  const firstUsername = connection.username;
  const first = await sendTfsHttpRequest(connection, url, method, body, firstUsername, options.step || 'Запрос TFS', options.signal);
  if (first.status !== 401 || !shouldRetryWithDomain(connection.username)) {
    return first;
  }

  const domain = parseNtlmDomain(first.headers['www-authenticate'])
    || await probeTfsNtlmDomain(url, options.step || 'Запрос TFS', options.signal);
  if (!domain) return first;
  const domainUsername = `${domain}\\${connection.username}`;
  if (domainUsername.toLowerCase() === firstUsername.toLowerCase()) return first;
  return await sendTfsHttpRequest(connection, url, method, body, domainUsername, options.step || 'Запрос TFS', options.signal);
}

function sendTfsHttpRequest(
  connection: TfsConnectionConfig,
  url: URL,
  method: string,
  body: string,
  effectiveUsername: string,
  step: string,
  signal?: AbortSignal,
): Promise<TfsTextResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...buildTfsAuthHeaders(connection, effectiveUsername),
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }

    const requestOptions: http.RequestOptions & https.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        ...headers,
        Host: url.host,
      },
      timeout: TFS_TIMEOUT_MS,
      rejectUnauthorized: false,
    };

    const request = transport.request(requestOptions, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        cleanup();
        resolve({
          status: response.statusCode || 0,
          statusText: response.statusMessage || '',
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          url: url.toString(),
          effectiveUsername,
        });
      });
    });

    const abort = () => request.destroy(new Error(`${step}: запрос TFS отменён.`));
    const cleanup = () => signal?.removeEventListener('abort', abort);
    if (signal) {
      if (signal.aborted) {
        cleanup();
        request.destroy(new Error(`${step}: запрос TFS отменён.`));
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    }
    request.on('timeout', () => request.destroy(new TfsTimeoutError(step)));
    request.on('error', (error) => {
      cleanup();
      reject(error);
    });
    if (body) request.write(body);
    request.end();
  });
}

function probeTfsNtlmDomain(
  url: URL,
  step: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const requestOptions: http.RequestOptions & https.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `NTLM ${buildNtlmType1Message()}`,
        Host: url.host,
      },
      timeout: TFS_TIMEOUT_MS,
      rejectUnauthorized: false,
    };

    const request = transport.request(requestOptions, (response) => {
      response.resume();
      response.on('end', () => {
        cleanup();
        resolve(parseNtlmDomain(response.headers['www-authenticate']));
      });
    });

    const abort = () => request.destroy(new Error(`${step}: NTLM probe TFS отменён.`));
    const cleanup = () => signal?.removeEventListener('abort', abort);
    if (signal) {
      if (signal.aborted) {
        cleanup();
        resolve('');
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    }
    request.on('timeout', () => request.destroy(new TfsTimeoutError(step)));
    request.on('error', () => {
      cleanup();
      resolve('');
    });
    request.end();
  });
}

function buildNtlmType1Message(): string {
  const message = Buffer.alloc(32);
  message.write('NTLMSSP\0', 0, 'ascii');
  message.writeUInt32LE(1, 8);
  message.writeUInt32LE(0x00088207, 12);
  message.writeUInt16LE(0, 16);
  message.writeUInt16LE(0, 18);
  message.writeUInt32LE(32, 20);
  message.writeUInt16LE(0, 24);
  message.writeUInt16LE(0, 26);
  message.writeUInt32LE(32, 28);
  return message.toString('base64');
}

function buildTfsAuthHeaders(connection: TfsConnectionConfig, effectiveUsername: string): Record<string, string> {
  if (connection.authMode !== 'basic') return {};
  const credentials = Buffer.from(`${effectiveUsername}:${connection.password}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${credentials}` };
}

function normalizeTfsBaseUrl(value: string): { serverUrl: string; collection: string } {
  const raw = firstText(value);
  if (!raw) return { serverUrl: '', collection: '' };
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);
  const parts = url.pathname
    .replace(/\/_apis\/.*$/i, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);
  const tfsIndex = parts.findIndex((part) => part.toLowerCase() === 'tfs');
  let serverParts = parts;
  let collection = '';
  if (tfsIndex >= 0) {
    serverParts = parts.slice(0, tfsIndex + 1);
    collection = parts[tfsIndex + 1] || '';
  } else if (parts.length > 1) {
    serverParts = parts.slice(0, -1);
    collection = parts[parts.length - 1] || '';
  }
  const serverPath = serverParts.length ? `/${serverParts.map(encodePathSegment).join('/')}` : '';
  return {
    serverUrl: `${url.protocol}//${url.host}${serverPath}`.replace(/\/+$/, ''),
    collection: normalizeCollectionName(collection),
  };
}

function normalizeCollectionName(value: string): string {
  return firstText(value).replace(/^\/+|\/+$/g, '') || DEFAULT_TFS_COLLECTION;
}

function toTfsProjectOption(project: any, connection: TfsConnectionConfig): TfsProjectOption {
  const name = firstText(project?.name);
  return {
    id: firstText(project?.id),
    key: name,
    name,
    description: stripMarkup(firstText(project?.description)),
    url: buildTfsProjectUrl(connection, name),
    state: firstText(project?.state),
  };
}

function toTfsTaskSummary(item: any, connection: TfsConnectionConfig): TfsTaskSummary {
  const fields = item?.fields || {};
  const id = normalizeTfsTaskId(item?.id || fields['System.Id']);
  const projectName = firstText(fields['System.TeamProject']);
  const updated = formatTfsDate(fields['System.ChangedDate']);
  return {
    id,
    key: String(id || ''),
    title: firstText(fields['System.Title'], `(work item ${id})`),
    description: truncate(stripMarkup(firstText(fields['System.Description'])), 3_000, '...'),
    url: buildTfsWorkItemUrl(connection, projectName, id),
    projectName,
    status: firstText(fields['System.State']),
    type: firstText(fields['System.WorkItemType']),
    assignedTo: formatTfsUser(fields['System.AssignedTo']),
    createdBy: formatTfsUser(fields['System.CreatedBy']),
    created: formatTfsDate(fields['System.CreatedDate']),
    updated,
    priority: firstText(fields['Microsoft.VSTS.Common.Priority']),
    severity: firstText(fields['Microsoft.VSTS.Common.Severity']),
    updatedAt: parseTfsDateMs(fields['System.ChangedDate']),
  };
}

function toTfsTaskDetails(item: any, connection: TfsConnectionConfig, history: TfsTaskHistoryEntry[]): TfsTaskDetails {
  const summary = toTfsTaskSummary(item, connection);
  const fields = item?.fields || {};
  const relations = Array.isArray(item?.relations) ? item.relations.map(toTfsRelation).filter(isPresent) : [];
  return {
    ...summary,
    reason: firstText(fields['System.Reason']),
    changedBy: formatTfsUser(fields['System.ChangedBy']),
    areaPath: firstText(fields['System.AreaPath']),
    iterationPath: firstText(fields['System.IterationPath']),
    tags: firstText(fields['System.Tags']).split(';').map((item) => item.trim()).filter(Boolean),
    valueArea: firstText(fields['Microsoft.VSTS.Common.ValueArea']),
    stateChanged: formatTfsDate(fields['Microsoft.VSTS.Common.StateChangeDate']),
    activated: formatTfsDate(fields['Microsoft.VSTS.Common.ActivatedDate']),
    activatedBy: formatTfsUser(fields['Microsoft.VSTS.Common.ActivatedBy']),
    resolved: formatTfsDate(fields['Microsoft.VSTS.Common.ResolvedDate']),
    resolvedBy: formatTfsUser(fields['Microsoft.VSTS.Common.ResolvedBy']),
    resolvedReason: firstText(fields['Microsoft.VSTS.Common.ResolvedReason']),
    closed: formatTfsDate(fields['Microsoft.VSTS.Common.ClosedDate']),
    closedBy: formatTfsUser(fields['Microsoft.VSTS.Common.ClosedBy']),
    relations,
    history,
    customFields: Object.keys(fields)
      .filter((key) => !KNOWN_DETAIL_FIELDS.has(key))
      .map((key) => ({
        id: key,
        name: key,
        value: truncate(formatTfsValue(fields[key]), 2_000, '...'),
      }))
      .filter((field) => field.value)
      .sort((left, right) => left.name.localeCompare(right.name)),
    warnings: [],
  };
}

function toTfsHistoryEntry(update: any): TfsTaskHistoryEntry {
  const fields = update?.fields || {};
  const history = fields['System.History'];
  const text = stripMarkup(firstText(history?.newValue, history?.oldValue));
  const changedFields = Object.keys(fields)
    .filter((name) => name !== 'System.History')
    .map((name) => {
      const value = fields[name] || {};
      if (value.newValue !== undefined && value.oldValue !== undefined) {
        return `${name}: ${formatTfsValue(value.oldValue)} -> ${formatTfsValue(value.newValue)}`;
      }
      if (value.newValue !== undefined) return `${name}: ${formatTfsValue(value.newValue)}`;
      return name;
    })
    .filter(Boolean)
    .slice(0, 12);
  return {
    revision: Number(update?.rev) || Number(update?.id) || 0,
    author: formatTfsUser(update?.revisedBy),
    date: formatTfsDate(update?.revisedDate),
    text,
    changedFields,
  };
}

function toTfsRelation(relation: any): TfsTaskRelation | null {
  const url = firstText(relation?.url);
  const targetId = extractTfsId(url);
  const type = firstText(relation?.rel);
  const label = firstText(
    relation?.attributes?.name,
    relation?.attributes?.comment,
    type,
  );
  if (!url && !type) return null;
  return {
    type,
    url,
    label,
    targetId,
  };
}

function formatTfsTaskSummary(task: TfsTaskSummary): string {
  return [
    `- #${task.id}: ${truncate(task.title, 240, '...')}`,
    `  URL: ${task.url}`,
    `  Проект: ${task.projectName || 'n/a'}; Тип: ${task.type || 'n/a'}; Статус: ${task.status || 'n/a'}; Приоритет: ${task.priority || 'n/a'}`,
    `  Исполнитель: ${task.assignedTo || 'n/a'}; Автор: ${task.createdBy || 'n/a'}`,
    `  Обновлена: ${task.updated || 'n/a'}; Создана: ${task.created || 'n/a'}`,
    `  Описание: ${task.description ? truncate(task.description, 1_200, '...').replace(/\n/g, '\n  ') : 'не заполнено'}`,
  ].join('\n');
}

function formatTfsRelation(relation: TfsTaskRelation): string {
  return [
    relation.label || relation.type,
    relation.targetId ? `#${relation.targetId}` : '',
    relation.url,
  ].filter(Boolean).join(' • ');
}

function appendTfsClause(clauses: string[], field: string, value: unknown): void {
  if (Array.isArray(value)) {
    const values = value.map((item) => firstText(item)).filter(Boolean);
    if (values.length === 1) clauses.push(`${field} = ${quoteWiqlString(values[0])}`);
    if (values.length > 1) clauses.push(`${field} IN (${values.map(quoteWiqlString).join(', ')})`);
    return;
  }
  const text = firstText(value);
  if (!text) return;
  const values = text.split(',').map((item) => firstText(item)).filter(Boolean);
  if (values.length > 1) {
    clauses.push(`${field} IN (${values.map(quoteWiqlString).join(', ')})`);
  } else {
    clauses.push(`${field} = ${quoteWiqlString(text)}`);
  }
}

function quoteWiqlString(value: string): string {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function isCurrentUserAlias(value: string): boolean {
  const normalized = value.replace(/\s+/g, '').toLowerCase();
  return normalized === 'me' || normalized === '@me' || normalized === 'current' || normalized === 'currentuser';
}

function shouldRetryWithDomain(username: string): boolean {
  return !!username && !/[\\/@]/.test(username);
}

function parseNtlmDomain(value: string | string[] | undefined): string {
  const headers = Array.isArray(value) ? value : value ? [value] : [];
  for (const header of headers) {
    const match = String(header || '').match(/\bNTLM\s+([A-Za-z0-9+/=]+)/i);
    if (!match) continue;
    const decoded = parseNtlmType2TargetName(match[1]);
    if (decoded) return decoded;
  }
  return '';
}

function parseNtlmType2TargetName(base64: string): string {
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < 48 || buffer.toString('ascii', 0, 8) !== 'NTLMSSP\0') return '';
    if (buffer.readUInt32LE(8) !== 2) return '';
    const length = buffer.readUInt16LE(12);
    const offset = buffer.readUInt32LE(16);
    const flags = buffer.readUInt32LE(20);
    if (!length || offset + length > buffer.length) return '';
    const slice = buffer.subarray(offset, offset + length);
    const text = (flags & 1) ? slice.toString('utf16le') : slice.toString('ascii');
    return text.replace(/\0/g, '').trim();
  } catch {
    return '';
  }
}

function formatTfsAuthLine(connection: TfsConnectionConfig): string {
  return connection.authMode === 'basic'
    ? `Авторизация: Basic (${connection.username})`
    : 'Авторизация: anonymous';
}

function formatTfsUser(value: any): string {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return firstText(value);
  const props = value.properties || {};
  const account = firstText(props.Account?.$value, props.Account, value.uniqueName);
  const domain = firstText(props.Domain?.$value, props.Domain);
  return firstText(
    value.displayName,
    value.providerDisplayName,
    value.name,
    value.uniqueName,
    domain && account ? `${domain}\\${account}` : '',
    account,
    value.id,
  );
}

function formatTfsDate(value: unknown): string {
  return firstText(value).replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function parseTfsDateMs(value: unknown): number {
  const parsed = Date.parse(firstText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTfsValue(value: any): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return stripMarkup(String(value));
  }
  if (Array.isArray(value)) {
    return value.map(formatTfsValue).filter(Boolean).join('; ');
  }
  if (typeof value === 'object') {
    const user = formatTfsUser(value);
    if (user) return user;
    const text = firstText(value.name, value.displayName, value.value, value.id);
    if (text) return stripMarkup(text);
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

function stripMarkup(value: string): string {
  return decodeHtmlEntities(String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/div\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : '';
    });
}

function formatTfsError(error: any): string {
  if (error instanceof TfsRequestError) {
    const message = firstText(error.json?.message, error.json?.Message, stripMarkup(error.body), error.statusText);
    const authHint = error.status === 401 || error.status === 403
      ? ' Проверьте TFS host, коллекцию, логин и пароль. Для короткого логина расширение попробует DOMAIN\\login, если домен есть в NTLM challenge.'
      : '';
    return `Ошибка TFS: HTTP ${error.status} ${error.statusText}. ${message}${authHint}`.trim();
  }
  return error?.message || error?.cause?.message || String(error || 'Неизвестная ошибка TFS.');
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildTfsProjectUrl(connection: TfsConnectionConfig, projectName: string): string {
  if (!projectName) return connection.collectionUrl;
  return `${connection.collectionUrl}/${encodePathSegment(projectName)}`;
}

function buildTfsWorkItemUrl(connection: TfsConnectionConfig, projectName: string, id: number): string {
  const projectUrl = buildTfsProjectUrl(connection, projectName);
  return id ? `${projectUrl}/_workitems#_a=edit&id=${encodeURIComponent(String(id))}` : projectUrl;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(String(value || '')).replace(/%5C/gi, '\\');
}

function extractTfsId(value: string): number {
  const match = String(value || '').match(/\/workItems\/(\d+)\b/i) || String(value || '').match(/[?&]id=(\d+)\b/i);
  return match ? normalizeTfsTaskId(match[1]) : 0;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function isPresent<T>(value: T | null | undefined | false | 0 | ''): value is T {
  return !!value;
}
