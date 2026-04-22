import type { AssistantConfig } from '../core/types';
import { readConfig } from '../core/api';
import * as http from 'http';
import * as https from 'https';

const JIRA_TIMEOUT_MS = 20_000;
const JIRA_COMMENTS_PAGE_SIZE = 100;
const JIRA_COMMENTS_MAX_PAGES = 100;

export interface JiraProjectTaskSummary {
  key: string;
  name: string;
  taskCount: number;
  url: string;
  tasks: JiraTaskSummary[];
}

export interface JiraTaskSummary {
  key: string;
  title: string;
  description: string;
  url: string;
  status?: string;
  updatedAt?: number;
}

export interface JiraTaskLinkedIssue {
  key: string;
  title: string;
  description: string;
  url: string;
  status: string;
  type: string;
  relationship?: string;
}

export interface JiraTaskIssueLink {
  type: string;
  direction: string;
  issue: JiraTaskLinkedIssue;
}

export interface JiraTaskComment {
  id: string;
  author: string;
  created: string;
  updated: string;
  body: string;
}

export interface JiraTaskAttachment {
  filename: string;
  author: string;
  created: string;
  size: string;
  mimeType: string;
  url: string;
}

export interface JiraTaskCustomField {
  id: string;
  name: string;
  value: string;
}

export interface JiraTaskDetails extends JiraTaskSummary {
  projectKey: string;
  projectName: string;
  type: string;
  priority: string;
  assignee: string;
  reporter: string;
  created: string;
  updated: string;
  resolution: string;
  dueDate: string;
  environment: string;
  labels: string[];
  components: string[];
  fixVersions: string[];
  affectedVersions: string[];
  epic: JiraTaskLinkedIssue | null;
  parent: JiraTaskLinkedIssue | null;
  subtasks: JiraTaskLinkedIssue[];
  issueLinks: JiraTaskIssueLink[];
  comments: JiraTaskComment[];
  commentsTotal: number;
  attachments: JiraTaskAttachment[];
  customFields: JiraTaskCustomField[];
  warnings: string[];
}

export interface JiraCheckResult {
  ok: boolean;
  error: string;
  authUser: string;
  authMode: 'anonymous' | 'basic';
  baseUrl: string;
  projectsCount: number;
  totalTasks: number;
  projects: JiraProjectTaskSummary[];
  warning?: string;
}

interface JiraConnectionConfig {
  baseUrl: string;
  username: string;
  password: string;
  authMode: 'anonymous' | 'basic';
}

export interface JiraAuthCheckResult {
  ok: boolean;
  error: string;
  authUser: string;
  authMode: 'anonymous' | 'basic';
  baseUrl: string;
}

export interface JiraProjectOption {
  key: string;
  name: string;
  url: string;
}

export interface JiraProjectListResult extends JiraAuthCheckResult {
  projects: JiraProjectOption[];
}

export interface JiraProjectTasksResult extends JiraAuthCheckResult {
  projectKey: string;
  tasks: JiraTaskSummary[];
}

export interface JiraTaskDetailsResult extends JiraAuthCheckResult {
  task: JiraTaskDetails | null;
}

class JiraRequestError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} ${statusText}: ${body.slice(0, 500)}`);
  }
}

class JiraTimeoutError extends Error {
  constructor(readonly step: string) {
    super(`${step}: Jira не ответила за ${JIRA_TIMEOUT_MS / 1000} секунд.`);
    this.name = 'JiraTimeoutError';
  }
}

export async function checkJiraSettings(data: Partial<AssistantConfig>): Promise<JiraCheckResult> {
  const connection = readJiraConnectionConfig(data);
  try {
    const me = await requestJiraJson(connection, 'rest/api/2/myself', undefined, 'Проверка авторизации');
    const authUser = formatJiraUser(me);
    const projects = await requestJiraJson(connection, 'rest/api/2/project', undefined, 'Загрузка проектов');
    const projectList = Array.isArray(projects) ? projects : [];
    const taskCounts = await readCurrentUserTaskCounts(connection);
    const summaries = projectList.map((project: any) => {
      const key = firstText(project?.key, project?.id);
      const name = firstText(project?.name, key);
      return {
        key,
        name,
        taskCount: key ? taskCounts.byProject.get(key) || 0 : 0,
        url: `${connection.baseUrl}/browse/${encodeURIComponent(key)}`,
        tasks: key ? taskCounts.tasksByProject.get(key) || [] : [],
      };
    });
    const normalized = summaries
      .filter((project) => project.key)
      .sort((a, b) => b.taskCount - a.taskCount || a.key.localeCompare(b.key));
    return {
      ok: true,
      error: '',
      authUser,
      authMode: connection.authMode,
      baseUrl: connection.baseUrl,
      projectsCount: normalized.length,
      totalTasks: taskCounts.total,
      projects: normalized,
      ...(taskCounts.warning ? { warning: taskCounts.warning } : {}),
    };
  } catch (error: any) {
    return {
      ok: false,
      error: formatJiraError(error),
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.baseUrl,
      projectsCount: 0,
      totalTasks: 0,
      projects: [],
    };
  }
}

export async function checkSavedJiraAuthorization(): Promise<JiraAuthCheckResult> {
  const connection = readSavedJiraConnectionConfig();
  try {
    ensureBasicJiraAuthorization(connection);
    const me = await requestJiraJson(connection, 'rest/api/2/myself', undefined, 'Проверка авторизации');
    return {
      ok: true,
      error: '',
      authUser: formatJiraUser(me),
      authMode: connection.authMode,
      baseUrl: connection.baseUrl,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: formatJiraError(error),
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.baseUrl,
    };
  }
}

export async function listSavedJiraProjects(): Promise<JiraProjectListResult> {
  const connection = readSavedJiraConnectionConfig();
  try {
    ensureBasicJiraAuthorization(connection);
    const me = await requestJiraJson(connection, 'rest/api/2/myself', undefined, 'Проверка авторизации');
    const projects = await requestJiraJson(connection, 'rest/api/2/project', undefined, 'Загрузка проектов');
    const projectList = Array.isArray(projects) ? projects : [];
    return {
      ok: true,
      error: '',
      authUser: formatJiraUser(me),
      authMode: connection.authMode,
      baseUrl: connection.baseUrl,
      projects: projectList
        .map((project: any) => {
          const key = firstText(project?.key, project?.id);
          const name = firstText(project?.name, key);
          return {
            key,
            name,
            url: key ? `${connection.baseUrl}/browse/${encodeURIComponent(key)}` : connection.baseUrl,
          };
        })
        .filter((project: JiraProjectOption) => project.key)
        .sort((left: JiraProjectOption, right: JiraProjectOption) => left.key.localeCompare(right.key)),
    };
  } catch (error: any) {
    return {
      ok: false,
      error: formatJiraError(error),
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.baseUrl,
      projects: [],
    };
  }
}

export async function listSavedJiraProjectTasks(projectKey: string, limit = 100): Promise<JiraProjectTasksResult> {
  const connection = readSavedJiraConnectionConfig();
  const key = normalizeJiraKey(projectKey);
  try {
    ensureBasicJiraAuthorization(connection);
    if (!key) throw new Error('Не выбран проект Jira.');
    const me = await requestJiraJson(connection, 'rest/api/2/myself', undefined, 'Проверка авторизации');
    const maxResults = Math.max(1, Math.min(Math.floor(Number(limit) || 100), 500));
    const result = await requestJiraJson(connection, 'rest/api/2/search', {
      jql: `project = ${quoteJiraJqlValue(key)} AND assignee = currentUser() ORDER BY updated DESC`,
      startAt: '0',
      maxResults: String(maxResults),
      fields: 'project,summary,description,status,updated',
    }, 'Загрузка задач проекта');
    const issues = Array.isArray(result?.issues) ? result.issues : [];
    return {
      ok: true,
      error: '',
      authUser: formatJiraUser(me),
      authMode: connection.authMode,
      baseUrl: connection.baseUrl,
      projectKey: key,
      tasks: issues
        .map((issue: any) => toJiraTaskSummary(issue, connection.baseUrl))
        .filter((task: JiraTaskSummary) => task.key),
    };
  } catch (error: any) {
    return {
      ok: false,
      error: formatJiraError(error),
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.baseUrl,
      projectKey: key,
      tasks: [],
    };
  }
}

export async function getSavedJiraTaskDetails(issueKey: string): Promise<JiraTaskDetailsResult> {
  const connection = readSavedJiraConnectionConfig();
  const key = normalizeJiraKey(issueKey);
  try {
    ensureBasicJiraAuthorization(connection);
    if (!key) throw new Error('Не выбрана задача Jira.');
    const issue = await requestJiraJson(connection, `rest/api/2/issue/${encodeURIComponent(key)}`, {
      fields: '*all',
      expand: 'names,schema',
    }, 'Загрузка задачи');
    const comments = await readAllJiraIssueCommentsSafe(connection, key);
    const task = toJiraTaskDetails(issue, connection.baseUrl, comments.comments, comments.total);
    if (comments.warning) task.warnings.push(comments.warning);
    await hydrateJiraTaskLinkedIssues(connection, task, connection.baseUrl);
    return {
      ok: true,
      error: '',
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.baseUrl,
      task,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: formatJiraError(error),
      authUser: '',
      authMode: connection.authMode,
      baseUrl: connection.baseUrl,
      task: null,
    };
  }
}

function readJiraConnectionConfig(data: Partial<AssistantConfig>): JiraConnectionConfig {
  const baseUrl = normalizeJiraBaseUrl(firstText(data.jiraBaseUrl));
  const username = firstText(data.jiraUsername);
  const password = firstText(data.jiraPassword);
  return {
    baseUrl,
    username,
    password,
    authMode: username && password ? 'basic' : 'anonymous',
  };
}

function readSavedJiraConnectionConfig(): JiraConnectionConfig {
  return readJiraConnectionConfig(readConfig());
}

function ensureBasicJiraAuthorization(connection: JiraConnectionConfig): void {
  if (connection.authMode !== 'basic') {
    throw new Error('Сначала сохраните Jira host, логин и пароль в настройках и проверьте авторизацию.');
  }
}

async function readCurrentUserTaskCounts(connection: JiraConnectionConfig): Promise<{
  byProject: Map<string, number>;
  tasksByProject: Map<string, JiraTaskSummary[]>;
  total: number;
  warning?: string;
}> {
  const byProject = new Map<string, number>();
  const tasksByProject = new Map<string, JiraTaskSummary[]>();
  const maxResults = 1000;
  let startAt = 0;
  let total = 0;
  let loaded = 0;

  try {
    for (let page = 0; page < 50; page++) {
      const result = await requestJiraJson(connection, 'rest/api/2/search', {
        jql: 'assignee = currentUser() ORDER BY project ASC, updated DESC',
        startAt: String(startAt),
        maxResults: String(maxResults),
        fields: 'project,summary,description',
      }, 'Подсчёт задач пользователя');
      const issues = Array.isArray(result?.issues) ? result.issues : [];
      total = Math.max(total, Number(result?.total) || 0);
      for (const issue of issues) {
        const key = firstText(issue?.fields?.project?.key, issue?.fields?.project?.id);
        if (!key) continue;
        byProject.set(key, (byProject.get(key) || 0) + 1);
        const issueKey = firstText(issue?.key, issue?.id);
        if (issueKey) {
          const tasks = tasksByProject.get(key) || [];
          tasks.push({
            key: issueKey,
            title: firstText(issue?.fields?.summary, '(без названия)'),
            description: truncateText(formatJiraDescription(issue?.fields?.description), 3_000),
            url: `${connection.baseUrl}/browse/${encodeURIComponent(issueKey)}`,
          });
          tasksByProject.set(key, tasks);
        }
      }
      loaded += issues.length;
      if (loaded >= total || issues.length === 0) break;
      startAt += issues.length;
    }
    const warning = loaded < total
      ? `Загружено ${loaded} задач из ${total}; счётчики по проектам могут быть неполными.`
      : '';
    return {
      byProject,
      tasksByProject,
      total,
      ...(warning ? { warning } : {}),
    };
  } catch (error: any) {
    return {
      byProject,
      tasksByProject,
      total: 0,
      warning: `Авторизация и список проектов проверены, но задачи посчитать не удалось: ${formatJiraError(error)}`,
    };
  }
}

async function readAllJiraIssueCommentsSafe(
  connection: JiraConnectionConfig,
  issueKey: string,
): Promise<{ comments: JiraTaskComment[]; total: number; warning: string }> {
  try {
    return await readAllJiraIssueComments(connection, issueKey);
  } catch (error: any) {
    return {
      comments: [],
      total: 0,
      warning: `Комментарии Jira не удалось загрузить: ${formatJiraError(error)}`,
    };
  }
}

async function readAllJiraIssueComments(
  connection: JiraConnectionConfig,
  issueKey: string,
): Promise<{ comments: JiraTaskComment[]; total: number; warning: string }> {
  const comments: JiraTaskComment[] = [];
  let startAt = 0;
  let total = 0;

  for (let page = 0; page < JIRA_COMMENTS_MAX_PAGES; page++) {
    const result = await requestJiraJson(connection, `rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`, {
      startAt: String(startAt),
      maxResults: String(JIRA_COMMENTS_PAGE_SIZE),
    }, 'Загрузка комментариев задачи');
    const pageComments = Array.isArray(result?.comments) ? result.comments : [];
    total = Math.max(total, Number(result?.total) || 0, startAt + pageComments.length);
    comments.push(...pageComments.map(toJiraTaskComment));
    if (pageComments.length === 0 || comments.length >= total) {
      return { comments, total: Math.max(total, comments.length), warning: '' };
    }
    startAt += pageComments.length;
  }

  return {
    comments,
    total: Math.max(total, comments.length),
    warning: `Комментарии Jira загружены не полностью: ${comments.length} из ${Math.max(total, comments.length)}.`,
  };
}

async function readLinkedJiraIssueDetails(
  connection: JiraConnectionConfig,
  issueKey: string,
  baseUrl: string,
  relationship: string,
): Promise<JiraTaskLinkedIssue | null> {
  const key = normalizeJiraKey(issueKey);
  if (!key) return null;
  try {
    const issue = await requestJiraJson(connection, `rest/api/2/issue/${encodeURIComponent(key)}`, {
      fields: 'summary,description,status,issuetype',
    }, 'Загрузка связанной задачи');
    return toJiraLinkedIssue(issue, baseUrl, relationship);
  } catch {
    return null;
  }
}

async function hydrateJiraTaskLinkedIssues(
  connection: JiraConnectionConfig,
  task: JiraTaskDetails,
  baseUrl: string,
): Promise<void> {
  const cache = new Map<string, Promise<JiraTaskLinkedIssue | null>>();
  const load = async (issue: JiraTaskLinkedIssue | null, fallbackRelationship: string): Promise<JiraTaskLinkedIssue | null> => {
    if (!issue?.key) return issue;
    const key = normalizeJiraKey(issue.key);
    if (!cache.has(key)) {
      cache.set(key, readLinkedJiraIssueDetails(connection, key, baseUrl, issue.relationship || fallbackRelationship));
    }
    const loaded = await cache.get(key);
    if (!loaded) return issue;
    return {
      ...issue,
      ...loaded,
      relationship: issue.relationship || loaded.relationship || fallbackRelationship,
    };
  };

  task.epic = await load(task.epic, 'Эпик');
  task.parent = await load(task.parent, 'Родительская задача');
  task.subtasks = (await Promise.all(task.subtasks.map((issue) => load(issue, 'Подзадача')))).filter(isPresent);
  task.issueLinks = (await Promise.all(task.issueLinks.map(async (link) => ({
    ...link,
    issue: await load(link.issue, link.direction || link.type || 'Связь'),
  })))).filter((link): link is JiraTaskIssueLink => !!link.issue);
}

async function requestJiraJson(
  connection: JiraConnectionConfig,
  path: string,
  params?: Record<string, string>,
  step = 'Запрос Jira',
): Promise<any> {
  if (!connection.baseUrl) {
    throw new Error('Сначала укажите Jira host в настройках.');
  }
  const url = new URL(`${connection.baseUrl}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  const response = await requestJiraText(url, buildHeaders(connection), step);
  if (response.status < 200 || response.status >= 300) {
    throw new JiraRequestError(response.status, response.statusText, stripMarkup(response.body));
  }
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(`${step}: Jira вернула не JSON: ${stripMarkup(response.body).slice(0, 500)}`);
  }
}

function requestJiraText(
  url: URL,
  headers: Record<string, string>,
  step: string,
): Promise<{ status: number; statusText: string; body: string }> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const hostname = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
    const requestOptions: http.RequestOptions & https.RequestOptions = {
      protocol: url.protocol,
      hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        ...headers,
        Host: url.host,
      },
      timeout: JIRA_TIMEOUT_MS,
      rejectUnauthorized: false,
    };

    const request = transport.request(requestOptions, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode || 0,
          statusText: response.statusMessage || '',
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new JiraTimeoutError(step));
    });
    request.on('error', reject);
    request.end();
  });
}

function buildHeaders(connection: JiraConnectionConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (connection.authMode === 'basic') {
    const credentials = Buffer.from(`${connection.username}:${connection.password}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  }
  return headers;
}

function normalizeJiraBaseUrl(value: string): string {
  const raw = firstText(value);
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);
  const path = url.pathname
    .replace(/\/rest\/api\/2\/?$/i, '')
    .replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path === '/' ? '' : path}`.replace(/\/+$/, '');
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function formatJiraUser(value: any): string {
  return firstText(
    value?.displayName,
    value?.emailAddress,
    value?.name,
    value?.key,
    value?.accountId,
    typeof value === 'string' || typeof value === 'number' ? value : '',
  );
}

function toJiraTaskSummary(issue: any, baseUrl: string): JiraTaskSummary {
  const fields = issue?.fields || {};
  const key = firstText(issue?.key, issue?.id);
  const updated = Date.parse(firstText(fields.updated));
  return {
    key,
    title: firstText(fields.summary, '(без названия)'),
    description: truncateText(formatJiraDescription(fields.description), 3_000),
    url: key ? `${baseUrl}/browse/${encodeURIComponent(key)}` : baseUrl,
    status: firstText(fields.status?.name, fields.status),
    ...(Number.isFinite(updated) ? { updatedAt: updated } : {}),
  };
}

function toJiraTaskDetails(
  issue: any,
  baseUrl: string,
  comments: JiraTaskComment[] = [],
  commentsTotal = comments.length,
): JiraTaskDetails {
  const fields = issue?.fields || {};
  const summary = toJiraTaskSummary(issue, baseUrl);
  const parent = toJiraLinkedIssue(fields.parent, baseUrl, 'Родительская задача');
  const customFields = toJiraCustomFields(issue, baseUrl);
  return {
    ...summary,
    description: truncateText(formatJiraDescription(fields.description), 8_000),
    projectKey: firstText(fields.project?.key, fields.project?.id, summary.key.split('-')[0]),
    projectName: firstText(fields.project?.name, fields.project?.key, summary.key.split('-')[0]),
    type: formatNamedField(fields.issuetype),
    priority: formatNamedField(fields.priority),
    assignee: formatJiraUser(fields.assignee),
    reporter: formatJiraUser(fields.reporter),
    created: formatJiraDate(fields.created),
    updated: formatJiraDate(fields.updated),
    resolution: formatNamedField(fields.resolution),
    dueDate: formatJiraDate(fields.duedate),
    environment: truncateText(formatJiraDescription(fields.environment), 2_000),
    labels: formatStringArray(fields.labels),
    components: formatNamedArray(fields.components),
    fixVersions: formatNamedArray(fields.fixVersions),
    affectedVersions: formatNamedArray(fields.versions),
    epic: findJiraEpic(issue, baseUrl, parent),
    parent,
    subtasks: toJiraLinkedIssues(fields.subtasks, baseUrl, 'Подзадача'),
    issueLinks: toJiraIssueLinks(fields.issuelinks, baseUrl),
    comments,
    commentsTotal,
    attachments: toJiraAttachments(fields.attachment),
    customFields,
    warnings: [],
  };
}

function toJiraTaskComment(comment: any): JiraTaskComment {
  return {
    id: firstText(comment?.id),
    author: formatJiraUser(comment?.author),
    created: formatJiraDate(comment?.created),
    updated: formatJiraDate(comment?.updated),
    body: truncateText(formatJiraDescription(comment?.body), 16_000),
  };
}

function toJiraLinkedIssues(value: any, baseUrl: string, relationship: string): JiraTaskLinkedIssue[] {
  return Array.isArray(value)
    ? value.map((item) => toJiraLinkedIssue(item, baseUrl, relationship)).filter(isPresent)
    : [];
}

function toJiraLinkedIssue(value: any, baseUrl: string, relationship = ''): JiraTaskLinkedIssue | null {
  if (!value || typeof value !== 'object') return null;
  const fields = value.fields || {};
  const key = firstText(value.key, extractJiraIssueKey(firstText(value.id)));
  if (!key) return null;
  return {
    key,
    title: firstText(fields.summary, value.summary, key),
    description: truncateText(formatJiraDescription(fields.description), 3_000),
    url: baseUrl ? `${baseUrl}/browse/${encodeURIComponent(key)}` : '',
    status: firstText(fields.status?.name, value.status?.name, value.status),
    type: firstText(fields.issuetype?.name, value.issuetype?.name, value.type?.name, value.type),
    ...(relationship ? { relationship } : {}),
  };
}

function toJiraIssueLinks(value: any, baseUrl: string): JiraTaskIssueLink[] {
  if (!Array.isArray(value)) return [];
  const links: JiraTaskIssueLink[] = [];
  for (const link of value) {
    const type = firstText(link?.type?.name, link?.type);
    const outward = toJiraLinkedIssue(link?.outwardIssue, baseUrl, firstText(link?.type?.outward, type));
    if (outward) {
      links.push({ type, direction: firstText(link?.type?.outward, 'outward'), issue: outward });
    }
    const inward = toJiraLinkedIssue(link?.inwardIssue, baseUrl, firstText(link?.type?.inward, type));
    if (inward) {
      links.push({ type, direction: firstText(link?.type?.inward, 'inward'), issue: inward });
    }
  }
  return links;
}

function toJiraAttachments(value: any): JiraTaskAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      filename: firstText(item?.filename, item?.name),
      author: formatJiraUser(item?.author),
      created: formatJiraDate(item?.created),
      size: formatFileSize(item?.size),
      mimeType: firstText(item?.mimeType, item?.contentType),
      url: firstText(item?.content, item?.self),
    }))
    .filter((item) => item.filename);
}

function toJiraCustomFields(issue: any, baseUrl: string): JiraTaskCustomField[] {
  const fields = issue?.fields || {};
  const names = typeof issue?.names === 'object' && issue.names ? issue.names : {};
  return Object.keys(fields)
    .filter((id) => id.startsWith('customfield_'))
    .map((id) => ({
      id,
      name: firstText(names[id], id),
      value: truncateText(formatCustomFieldValue(fields[id], baseUrl), 2_000),
    }))
    .filter((field) => field.value)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function findJiraEpic(
  issue: any,
  baseUrl: string,
  parent: JiraTaskLinkedIssue | null,
): JiraTaskLinkedIssue | null {
  if (parent && isEpicText(parent.type)) {
    return { ...parent, relationship: 'Эпик' };
  }

  const fields = issue?.fields || {};
  const names = typeof issue?.names === 'object' && issue.names ? issue.names : {};
  let epicName = '';
  let epicKey = '';
  let epicTitle = '';
  let relationship = 'Эпик';

  for (const id of Object.keys(fields)) {
    if (!id.startsWith('customfield_')) continue;
    const name = firstText(names[id], id);
    if (!isEpicText(name)) continue;
    const rawValue = fields[id];
    const linked = extractLinkedIssue(rawValue, baseUrl, name);
    if (linked && isEpicLinkFieldName(name)) return linked;

    const text = formatCustomFieldValue(rawValue, baseUrl);
    const key = extractJiraIssueKey(text);
    if (isEpicNameFieldName(name) && text) {
      epicName = text;
    }
    if (key && (isEpicLinkFieldName(name) || !epicKey)) {
      epicKey = key;
      epicTitle = text !== key ? text : '';
      relationship = name;
    }
  }

  if (!epicKey) return null;
  return {
    key: epicKey,
    title: epicTitle || epicName || epicKey,
    description: '',
    url: `${baseUrl}/browse/${encodeURIComponent(epicKey)}`,
    status: '',
    type: 'Эпик',
    relationship,
  };
}

function extractLinkedIssue(value: any, baseUrl: string, relationship: string): JiraTaskLinkedIssue | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const linked = extractLinkedIssue(item, baseUrl, relationship);
      if (linked) return linked;
    }
    return null;
  }
  return toJiraLinkedIssue(value, baseUrl, relationship);
}

function formatCustomFieldValue(value: any, baseUrl: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return firstText(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => formatCustomFieldValue(item, baseUrl))
      .filter(Boolean)
      .join('; ');
  }
  if (typeof value !== 'object') return '';

  const linked = toJiraLinkedIssue(value, baseUrl);
  if (linked) {
    return [linked.key, linked.title !== linked.key ? linked.title : '', linked.status].filter(Boolean).join(' • ');
  }
  const user = formatJiraUser(value);
  if (user) return user;
  const named = firstText(value.name, value.value, value.displayName, value.key, value.id);
  if (named) return named;
  const text = formatJiraDescription(value);
  if (text) return text;
  try {
    return JSON.stringify(value, (key, item) => {
      if (key === 'self' || key === 'avatarUrls' || key === 'iconUrl') return undefined;
      return item;
    });
  } catch {
    return '';
  }
}

function isEpicText(value: string): boolean {
  return /epic|эпик/i.test(value || '');
}

function isEpicLinkFieldName(value: string): boolean {
  return /epic\s*link|эпик/i.test(value || '');
}

function isEpicNameFieldName(value: string): boolean {
  return /epic\s*name|название\s*эпика|имя\s*эпика/i.test(value || '');
}

function extractJiraIssueKey(value: string): string {
  const match = String(value || '').match(/\b[A-Z][A-Z0-9_]+-\d+\b/);
  return match ? match[0] : '';
}

function formatFileSize(value: unknown): string {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function formatNamedField(value: any): string {
  return firstText(value?.name, value?.displayName, value?.key, value?.id, value);
}

function formatNamedArray(value: any): string[] {
  return Array.isArray(value)
    ? value.map(formatNamedField).filter(Boolean)
    : [];
}

function formatStringArray(value: any): string[] {
  return Array.isArray(value)
    ? value.map((item) => firstText(item)).filter(Boolean)
    : [];
}

function formatJiraDate(value: unknown): string {
  return firstText(value).replace('T', ' ').replace(/\.\d{3}[+-]\d{4}$/, '');
}

function formatJiraDescription(value: any): string {
  const parts: string[] = [];
  collectJiraDescriptionText(value, parts, 0);
  return parts
    .join(' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectJiraDescriptionText(value: any, parts: string[], depth: number): void {
  if (depth > 20 || value === undefined || value === null) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    if (text) parts.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJiraDescriptionText(item, parts, depth + 1);
    }
    return;
  }
  if (typeof value !== 'object') return;

  if (typeof value.text === 'string') {
    collectJiraDescriptionText(value.text, parts, depth + 1);
  }
  if (typeof value.value === 'string') {
    collectJiraDescriptionText(value.value, parts, depth + 1);
  }
  if (Array.isArray(value.content)) {
    collectJiraDescriptionText(value.content, parts, depth + 1);
  }
}

function truncateText(value: string, maxLength: number): string {
  const text = firstText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeJiraKey(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function quoteJiraJqlValue(value: string): string {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatJiraError(error: any): string {
  if (error instanceof JiraRequestError) {
    if (error.status === 401 || error.status === 403) {
      return `Jira не авторизовала пользователя: ${error.message}`;
    }
    return `Jira ответила ошибкой: ${error.message}`;
  }
  if (error instanceof JiraTimeoutError) {
    return `${error.step}: Jira не ответила за ${JIRA_TIMEOUT_MS / 1000} секунд.`;
  }
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return `Jira не ответила за ${JIRA_TIMEOUT_MS / 1000} секунд.`;
  }
  const cause = error?.cause;
  if (cause?.code || cause?.message) {
    return [cause.code, cause.message].filter(Boolean).join(': ');
  }
  return error?.message || String(error);
}

function stripMarkup(text: string): string {
  return String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
