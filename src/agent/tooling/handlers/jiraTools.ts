import { readConfig } from '../../../core/api';
import { truncate } from '../../../core/utils';
import { createToolExecutionResult, type ToolExecutionResult } from '../results';
import type { ToolHandlerMap } from '../types';

const REQUEST_TIMEOUT_MS = 20_000;
const COMMENT_PAGE_SIZE = 100;
const COMMENT_MAX_PAGES = 100;
const DEFAULT_SEARCH_FIELDS = [
  'summary',
  'status',
  'assignee',
  'reporter',
  'updated',
  'created',
  'priority',
  'issuetype',
  'project',
  'description',
];
const DEFAULT_DETAIL_FIELDS = [
  '*all',
];

type JiraAuthMode = 'anonymous' | 'basic';

interface JiraConnectionConfig {
  baseUrl: string;
  username: string;
  password: string;
  authMode: JiraAuthMode;
}

class JiraHttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly url: string,
    readonly bodyText: string,
    readonly json: any,
  ) {
    super(`Jira HTTP ${status} ${statusText}`);
  }
}

export const jiraToolHandlers: ToolHandlerMap = {
  async jira_list_projects(args, context) {
    const connection = readJiraConnectionConfig(args);
    const limit = normalizeLimit(args?.limit, 100, 500);
    const offset = normalizeOffset(args?.offset ?? args?.startAt ?? args?.start_at);
    const query = firstText(args?.query, args?.search, args?.text).toLowerCase();

    try {
      const result = await requestJiraJson(connection, 'rest/api/2/project', {}, context.signal);
      const allProjects = Array.isArray(result.json) ? result.json : [];
      const filtered = query
        ? allProjects.filter((project: any) => projectMatchesQuery(project, query))
        : allProjects;
      const page = filtered.slice(offset, offset + limit);
      return createToolExecutionResult(
        'jira_list_projects',
        'success',
        truncate(formatProjectList(page, filtered.length, { connection, offset, limit }), 12_000),
      );
    } catch (error: any) {
      return createJiraErrorResult('jira_list_projects', error, connection);
    }
  },

  async jira_search_tasks(args, context) {
    const connection = readJiraConnectionConfig(args);
    const limit = normalizeLimit(args?.limit ?? args?.maxResults ?? args?.max_results, 10, 50);
    const offset = normalizeOffset(args?.offset ?? args?.startAt ?? args?.start_at);
    const fields = normalizeFields(args?.fields, DEFAULT_SEARCH_FIELDS);
    const jql = buildSearchJql(args);

    try {
      const result = await requestJiraJson(
        connection,
        'rest/api/2/search',
        {
          jql,
          startAt: String(offset),
          maxResults: String(limit),
          fields: fields.join(','),
        },
        context.signal,
      );
      const issues = Array.isArray(result.json?.issues) ? result.json.issues : [];
      const total = Number(result.json?.total ?? issues.length);
      const startAt = Number(result.json?.startAt ?? offset);
      const maxResults = Number(result.json?.maxResults ?? limit);
      return createToolExecutionResult(
        'jira_search_tasks',
        'success',
        truncate(formatIssueSearchResult(issues, { connection, jql, total, startAt, maxResults }), 12_000),
      );
    } catch (error: any) {
      return createJiraErrorResult('jira_search_tasks', error, connection);
    }
  },

  async jira_get_task(args, context) {
    const connection = readJiraConnectionConfig(args);
    const key = firstText(args?.key, args?.issueKey, args?.issue_key, args?.id).toUpperCase();
    const fields = normalizeFields(args?.fields, DEFAULT_DETAIL_FIELDS);
    if (!key) {
      return createToolExecutionResult('jira_get_task', 'error', 'Для jira_get_task обязателен key или issueKey.');
    }

    try {
      const params: Record<string, string> = { fields: fields.join(',') };
      if (fields.includes('*all')) {
        params.expand = 'names,schema';
      }
      const result = await requestJiraJson(
        connection,
        `rest/api/2/issue/${encodeURIComponent(key)}`,
        params,
        context.signal,
      );
      const comments = await readAllJiraIssueCommentsSafe(connection, key, context.signal);
      return createToolExecutionResult(
        'jira_get_task',
        'success',
        truncate(formatIssueDetail(result.json, connection, comments), 24_000),
      );
    } catch (error: any) {
      return createJiraErrorResult('jira_get_task', error, connection);
    }
  },
};

function readJiraConnectionConfig(args: any): JiraConnectionConfig {
  const config = readConfig();
  const baseUrl = normalizeJiraBaseUrl(firstText(
    args?.baseUrl,
    args?.base_url,
    config.jiraBaseUrl,
    process.env.JIRA_BASE_URL,
  ));
  const username = firstText(
    config.jiraUsername,
    process.env.JIRA_USERNAME,
    process.env.JIRA_USER,
  );
  const password = firstText(
    config.jiraPassword,
    process.env.JIRA_PASSWORD,
    process.env.JIRA_API_TOKEN,
  );

  return {
    baseUrl,
    username,
    password,
    authMode: username && password ? 'basic' : 'anonymous',
  };
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function normalizeJiraBaseUrl(value: string): string {
  const raw = firstText(value);
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withProtocol);
    const normalizedPath = url.pathname
      .replace(/\/rest\/api\/2\/?$/i, '')
      .replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${normalizedPath === '/' ? '' : normalizedPath}`;
  } catch {
    return '';
  }
}

function normalizeLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function normalizeOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeFields(value: unknown, fallback: string[]): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const fields = raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 40);
  return fields.length ? fields : fallback;
}

function buildSearchJql(args: any): string {
  const directJql = firstText(args?.jql);
  if (directJql) return directJql;

  const clauses: string[] = [];
  appendJqlClause(clauses, 'issuekey', firstText(args?.issueKey, args?.issue_key, args?.key));
  appendJqlClause(clauses, 'project', args?.project);
  appendJqlClause(clauses, 'status', args?.status);
  appendAssigneeClause(clauses, firstText(args?.assignee));

  const text = firstText(args?.text, args?.query, args?.search);
  if (text) {
    clauses.push(`text ~ ${quoteJqlString(text)}`);
  }

  const orderBy = firstText(args?.orderBy, args?.order_by, 'updated DESC');
  return [clauses.join(' AND '), orderBy ? `ORDER BY ${orderBy}` : '']
    .filter(Boolean)
    .join(' ')
    .trim() || 'ORDER BY updated DESC';
}

function appendJqlClause(clauses: string[], field: string, value: unknown): void {
  if (Array.isArray(value)) {
    const values = value.map((item) => firstText(item)).filter(Boolean);
    if (values.length === 1) {
      clauses.push(`${field} = ${quoteJqlString(values[0])}`);
    } else if (values.length > 1) {
      clauses.push(`${field} in (${values.map(quoteJqlString).join(', ')})`);
    }
    return;
  }
  const text = firstText(value);
  if (text) {
    const values = text.split(',').map((item) => firstText(item)).filter(Boolean);
    if (values.length > 1) {
      clauses.push(`${field} in (${values.map(quoteJqlString).join(', ')})`);
      return;
    }
    clauses.push(`${field} = ${quoteJqlString(text)}`);
  }
}

function appendAssigneeClause(clauses: string[], value: string): void {
  if (!value) return;
  const normalized = value.replace(/\s+/g, '').toLowerCase();
  const jqlValue = normalized === 'me' || normalized === 'current' || normalized === 'currentuser()'
    ? 'currentUser()'
    : quoteJqlString(value);
  clauses.push(`assignee = ${jqlValue}`);
}

function quoteJqlString(value: string): string {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function requestJiraJson(
  connection: JiraConnectionConfig,
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ json: any; url: string }> {
  if (!connection.baseUrl) {
    throw new Error('Сначала укажите Jira host в настройках расширения.');
  }
  const url = new URL(`${connection.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: buildJiraHeaders(connection),
    signal: withRequestTimeout(signal),
  });
  const text = await response.text();
  const json = parseJson(text);
  if (!response.ok) {
    throw new JiraHttpError(response.status, response.statusText, url.toString(), text, json);
  }
  if (json === null) {
    throw new Error(`Jira вернула не JSON: ${truncate(stripMarkup(text), 500)}`);
  }
  return { json, url: url.toString() };
}

async function readAllJiraIssueCommentsSafe(
  connection: JiraConnectionConfig,
  issueKey: string,
  signal?: AbortSignal,
): Promise<{ comments: any[]; total: number; warning: string }> {
  try {
    return await readAllJiraIssueComments(connection, issueKey, signal);
  } catch (error: any) {
    return {
      comments: [],
      total: 0,
      warning: `Комментарии Jira не удалось загрузить: ${error?.message || error}`,
    };
  }
}

async function readAllJiraIssueComments(
  connection: JiraConnectionConfig,
  issueKey: string,
  signal?: AbortSignal,
): Promise<{ comments: any[]; total: number; warning: string }> {
  const comments: any[] = [];
  let startAt = 0;
  let total = 0;

  for (let page = 0; page < COMMENT_MAX_PAGES; page++) {
    const result = await requestJiraJson(
      connection,
      `rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        startAt: String(startAt),
        maxResults: String(COMMENT_PAGE_SIZE),
      },
      signal,
    );
    const pageComments = Array.isArray(result.json?.comments) ? result.json.comments : [];
    total = Math.max(total, Number(result.json?.total) || 0, startAt + pageComments.length);
    comments.push(...pageComments);
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

function buildJiraHeaders(connection: JiraConnectionConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (connection.authMode === 'basic') {
    const credentials = Buffer.from(`${connection.username}:${connection.password}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  }
  return headers;
}

function withRequestTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function projectMatchesQuery(project: any, query: string): boolean {
  return [
    project?.key,
    project?.name,
    project?.projectTypeKey,
    project?.lead?.displayName,
    project?.lead?.name,
  ].some((value) => String(value || '').toLowerCase().includes(query));
}

function formatProjectList(
  projects: any[],
  total: number,
  options: { connection: JiraConnectionConfig; offset: number; limit: number },
): string {
  const lines = [
    `Jira projects: ${projects.length} из ${total} (offset=${options.offset}, limit=${options.limit})`,
    formatAuthLine(options.connection),
    '',
  ];

  if (!projects.length) {
    lines.push(formatEmptyHint(options.connection, 'Проекты не найдены.'));
    return lines.join('\n').trim();
  }

  for (const project of projects) {
    const key = firstText(project?.key, project?.id);
    const name = firstText(project?.name, '(без названия)');
    const type = firstText(project?.projectTypeKey, project?.style);
    const lead = formatJiraUser(project?.lead);
    lines.push(`- ${key}: ${name}`);
    lines.push(`  URL: ${browseUrl(options.connection.baseUrl, key)}`);
    lines.push(`  Тип: ${type || 'n/a'}; Lead: ${lead || 'n/a'}`);
  }

  return lines.join('\n').trim();
}

function formatIssueSearchResult(
  issues: any[],
  options: { connection: JiraConnectionConfig; jql: string; total: number; startAt: number; maxResults: number },
): string {
  const lines = [
    `Jira tasks: ${issues.length} из ${options.total} (startAt=${options.startAt}, maxResults=${options.maxResults})`,
    `JQL: ${options.jql}`,
    formatAuthLine(options.connection),
    '',
  ];

  if (!issues.length) {
    lines.push(formatEmptyHint(options.connection, 'Задачи не найдены.'));
    return lines.join('\n').trim();
  }

  for (const issue of issues) {
    lines.push(formatIssueSummary(issue, options.connection.baseUrl));
  }

  return lines.join('\n').trim();
}

function formatIssueSummary(issue: any, baseUrl: string): string {
  const fields = issue?.fields || {};
  const key = firstText(issue?.key, issue?.id);
  const summary = firstText(fields.summary, '(без темы)');
  const description = formatJiraDescription(fields.description);
  const meta = [
    formatNamedField('Тип', fields.issuetype),
    formatNamedField('Статус', fields.status),
    formatNamedField('Приоритет', fields.priority),
  ].filter(Boolean).join('; ');
  return [
    `- ${key}: ${truncate(summary, 240, '...')}`,
    `  URL: ${browseUrl(baseUrl, key)}`,
    `  ${meta || 'Метаданные: n/a'}`,
    `  Исполнитель: ${formatJiraUser(fields.assignee) || 'n/a'}; Автор: ${formatJiraUser(fields.reporter) || 'n/a'}`,
    `  Обновлена: ${formatJiraDate(fields.updated) || 'n/a'}; Создана: ${formatJiraDate(fields.created) || 'n/a'}`,
    `  Описание: ${description ? truncate(description, 1_200, '...').replace(/\n/g, '\n  ') : 'не заполнено'}`,
  ].join('\n');
}

function formatIssueDetail(
  issue: any,
  connection: JiraConnectionConfig,
  loadedComments: { comments: any[]; total: number; warning: string },
): string {
  const fields = issue?.fields || {};
  const key = firstText(issue?.key, issue?.id);
  const lines = [
    `Jira task ${key}: ${firstText(fields.summary, '(без темы)')}`,
    `URL: ${browseUrl(connection.baseUrl, key)}`,
    formatAuthLine(connection),
    '',
    [
      formatNamedField('Проект', fields.project),
      formatNamedField('Тип', fields.issuetype),
      formatNamedField('Статус', fields.status),
      formatNamedField('Решение', fields.resolution),
      formatNamedField('Приоритет', fields.priority),
    ].filter(Boolean).join('; '),
    `Исполнитель: ${formatJiraUser(fields.assignee) || 'n/a'}`,
    `Автор: ${formatJiraUser(fields.reporter) || 'n/a'}`,
    `Создана: ${formatJiraDate(fields.created) || 'n/a'}`,
    `Обновлена: ${formatJiraDate(fields.updated) || 'n/a'}`,
  ].filter(Boolean);

  const labels = Array.isArray(fields.labels) ? fields.labels.filter(Boolean) : [];
  if (labels.length) lines.push(`Labels: ${labels.join(', ')}`);

  const components = formatNamedArray(fields.components);
  if (components) lines.push(`Components: ${components}`);

  const fixVersions = formatNamedArray(fields.fixVersions);
  if (fixVersions) lines.push(`Fix versions: ${fixVersions}`);

  const affectedVersions = formatNamedArray(fields.versions);
  if (affectedVersions) lines.push(`Affected versions: ${affectedVersions}`);

  const epic = formatEpicField(issue, connection.baseUrl);
  if (epic) lines.push(`Эпик: ${epic}`);

  const parent = formatLinkedIssue(fields.parent, connection.baseUrl);
  if (parent) lines.push(`Родительская задача: ${parent}`);

  const subtasks = Array.isArray(fields.subtasks)
    ? fields.subtasks.map((task: any) => formatLinkedIssue(task, connection.baseUrl)).filter(Boolean)
    : [];
  if (subtasks.length) lines.push('', 'Подзадачи:', ...subtasks.map((task: string) => `- ${task}`));

  const links = formatIssueLinks(fields.issuelinks, connection.baseUrl);
  if (links.length) lines.push('', 'Связанные задачи:', ...links.map((link) => `- ${link}`));

  const description = formatJiraDescription(fields.description);
  if (description) {
    lines.push('', 'Описание:', truncate(description, 5_000));
  }

  const comments = loadedComments.comments.length
    ? loadedComments.comments
    : Array.isArray(fields.comment?.comments)
      ? fields.comment.comments
      : [];
  if (comments.length) {
    lines.push('', `Комментарии (${comments.length}${loadedComments.total > comments.length ? ` из ${loadedComments.total}` : ''}):`);
    for (const comment of comments) {
      lines.push(`- ${formatJiraUser(comment?.author) || 'n/a'} • ${formatJiraDate(comment?.updated || comment?.created) || 'n/a'}`);
      lines.push(`  ${truncate(formatJiraDescription(comment?.body), 1_500).replace(/\n/g, '\n  ')}`);
    }
  }
  if (loadedComments.warning) lines.push('', loadedComments.warning);

  const attachments = formatAttachments(fields.attachment);
  if (attachments.length) lines.push('', 'Вложения:', ...attachments.map((attachment) => `- ${attachment}`));

  const customFields = formatCustomFields(issue, connection.baseUrl);
  if (customFields.length) {
    lines.push('', 'Дополнительные поля Jira:');
    for (const field of customFields) {
      lines.push(`- ${field}`);
    }
  }

  return lines.join('\n').trim();
}

function formatEpicField(issue: any, baseUrl: string): string {
  const fields = issue?.fields || {};
  const names = typeof issue?.names === 'object' && issue.names ? issue.names : {};
  const parent = formatLinkedIssue(fields.parent, baseUrl);
  if (parent && /epic|эпик/i.test(formatNamedArray([fields.parent?.fields?.issuetype]))) {
    return parent;
  }
  let epicName = '';
  let epicKey = '';
  for (const id of Object.keys(fields)) {
    if (!id.startsWith('customfield_')) continue;
    const name = firstText(names[id], id);
    if (!/epic|эпик/i.test(name)) continue;
    const text = formatJiraValue(fields[id], baseUrl);
    const key = extractJiraIssueKey(text);
    if (/epic\s*name|название\s*эпика|имя\s*эпика/i.test(name) && text) {
      epicName = text;
    }
    if (key && !epicKey) {
      epicKey = key;
    }
  }
  if (!epicKey) return '';
  return [epicKey, epicName && epicName !== epicKey ? epicName : '', browseUrl(baseUrl, epicKey)].filter(Boolean).join(' • ');
}

function formatLinkedIssue(value: any, baseUrl: string): string {
  if (!value || typeof value !== 'object') return '';
  const fields = value.fields || {};
  const key = firstText(value.key, extractJiraIssueKey(firstText(value.id)));
  if (!key) return '';
  return [
    key,
    firstText(fields.summary, value.summary),
    formatNamedField('Статус', fields.status || value.status),
    formatNamedField('Тип', fields.issuetype || value.issuetype),
    browseUrl(baseUrl, key),
  ].filter(Boolean).join(' • ');
}

function formatIssueLinks(value: any, baseUrl: string): string[] {
  if (!Array.isArray(value)) return [];
  const links: string[] = [];
  for (const link of value) {
    const outward = formatLinkedIssue(link?.outwardIssue, baseUrl);
    if (outward) links.push(`${firstText(link?.type?.outward, link?.type?.name, 'outward')}: ${outward}`);
    const inward = formatLinkedIssue(link?.inwardIssue, baseUrl);
    if (inward) links.push(`${firstText(link?.type?.inward, link?.type?.name, 'inward')}: ${inward}`);
  }
  return links;
}

function formatAttachments(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => [
      firstText(item?.filename, item?.name),
      formatFileSize(item?.size),
      firstText(item?.mimeType, item?.contentType),
      formatJiraUser(item?.author) ? `автор: ${formatJiraUser(item?.author)}` : '',
      formatJiraDate(item?.created),
    ].filter(Boolean).join(' • '))
    .filter(Boolean);
}

function formatCustomFields(issue: any, baseUrl: string): string[] {
  const fields = issue?.fields || {};
  const names = typeof issue?.names === 'object' && issue.names ? issue.names : {};
  return Object.keys(fields)
    .filter((id) => id.startsWith('customfield_'))
    .map((id) => {
      const value = truncate(formatJiraValue(fields[id], baseUrl), 2_000);
      return value ? `${firstText(names[id], id)} (${id}): ${value}` : '';
    })
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function formatJiraValue(value: any, baseUrl: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return firstText(value);
  if (Array.isArray(value)) {
    return value.map((item) => formatJiraValue(item, baseUrl)).filter(Boolean).join('; ');
  }
  if (typeof value !== 'object') return '';
  const linkedIssue = formatLinkedIssue(value, baseUrl);
  if (linkedIssue) return linkedIssue;
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

function formatNamedField(label: string, value: any): string {
  const name = firstText(value?.name, value?.displayName, value?.key, value?.id, value);
  return name ? `${label}: ${name}` : '';
}

function formatNamedArray(value: any): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => firstText(item?.name, item?.displayName, item?.key, item?.id, item))
    .filter(Boolean)
    .join(', ');
}

function formatJiraUser(value: any): string {
  if (!value) return '';
  return firstText(
    value.displayName,
    value.emailAddress,
    value.name,
    value.key,
    value.accountId,
    typeof value === 'string' || typeof value === 'number' ? value : '',
  );
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

function browseUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}`;
}

function formatAuthLine(connection: JiraConnectionConfig): string {
  return connection.authMode === 'basic'
    ? `Авторизация: Basic (${connection.username})`
    : 'Авторизация: anonymous';
}

function formatEmptyHint(connection: JiraConnectionConfig, prefix: string): string {
  if (connection.authMode === 'anonymous') {
    return `${prefix} Jira ответила без авторизации; если ожидались личные проекты или задачи, укажи Jira host, логин и пароль в настройках.`;
  }
  return prefix;
}

function createJiraErrorResult(
  toolName: 'jira_list_projects' | 'jira_search_tasks' | 'jira_get_task',
  error: any,
  connection: JiraConnectionConfig,
): ToolExecutionResult {
  if (error instanceof JiraHttpError) {
    const lines = [
      `Ошибка Jira: HTTP ${error.status} ${error.statusText}`,
      `URL: ${error.url}`,
      formatJiraErrorBody(error),
    ].filter(Boolean);
    if (error.status === 401 || error.status === 403) {
      lines.push('Проверь Jira host, логин и пароль в настройках расширения. Без них Jira читает только публично доступные данные.');
    }
    return createToolExecutionResult(toolName, 'error', truncate(lines.join('\n'), 8_000));
  }

  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return createToolExecutionResult(
      toolName,
      'error',
      `Ошибка Jira: запрос к ${connection.baseUrl} не успел завершиться за ${REQUEST_TIMEOUT_MS / 1000} секунд.`,
    );
  }

  return createToolExecutionResult(
    toolName,
    'error',
    `Ошибка Jira: ${error?.message || error}`,
  );
}

function formatJiraErrorBody(error: JiraHttpError): string {
  if (Array.isArray(error.json?.errorMessages) && error.json.errorMessages.length) {
    return error.json.errorMessages.join('\n');
  }
  if (error.json?.errors && typeof error.json.errors === 'object') {
    return Object.entries(error.json.errors)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('\n');
  }
  return truncate(stripMarkup(error.bodyText), 1_500);
}

function stripMarkup(text: string): string {
  return String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
