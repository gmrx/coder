import * as vscode from 'vscode';
import * as path from 'path';
import { readConfig, saveConfig, sendChatRequest } from '../../../core/api';
import { truncate } from '../../../core/utils';
import { buildToolApprovalRequest } from '../catalog';
import {
  buildShellBackgroundPresentation,
  buildBlockedShellPresentation,
  buildShellApprovalMeta,
  buildShellExecutionPresentation,
  formatShellBackgroundResult,
  buildShellPreflightPresentation,
  formatShellExecutionResult,
} from '../shellStudy';
import {
  buildWebFetchPreflightPresentation,
  buildWebFetchPresentation,
  buildWebSearchPreflightPresentation,
  buildWebSearchPresentation,
  filterWebSearchHits,
  formatWebFetchResult,
  formatWebSearchResult,
  normalizeWebFetchOutputMode,
  normalizeWebSearchOutputMode,
  parseDuckDuckGoLiteResults,
  prepareWebFetchContent,
  type WebSearchHit,
  type WebSearchOutputMode,
} from '../webStudy';
import type { AgentShellApprovalResult, AgentWebApprovalResult } from '../../runtime/approvals';
import type { ToolExecutionOutput } from '../results';
import type { ToolHandlerMap } from '../types';
import { isShellCommandBlocked } from '../definitions/toolPermissionChecks';
import { createToolExecutionResult } from '../results';
import { getAgentWorkspaceRootPath } from '../../worktreeSession';
import { startBackgroundShellJob } from '../../tasks/backgroundJobs';
import { fetchWebResource, searchDuckDuckGoLite, type WebFetchOutcome } from '../webRuntime';
import { getWebFetchTrustDecision, shouldAutoFetchGroundingUrl, updateWebHostList, type WebTrustKind } from '../webTrust';

export const externalToolHandlers: ToolHandlerMap = {
  async web_search(args, context) {
    const config = readConfig();
    const query = args?.query || args?.search_term || '';
    const answerPrompt = typeof args?.prompt === 'string'
      ? args.prompt.trim()
      : typeof args?.answer_prompt === 'string'
        ? args.answer_prompt.trim()
        : '';
    const allowLlmFallback = args?.allow_llm_fallback === true;
    const requestedOutputMode = normalizeWebSearchOutputMode(args?.outputMode || args?.mode || args?.view);
    const outputMode: WebSearchOutputMode = answerPrompt ? 'answer' : requestedOutputMode;
    const limit = Math.max(1, Math.min(Number(args?.limit) || 6, 10));
    const fetchTopResults = Math.max(1, Math.min(Number(args?.fetchTopResults ?? args?.fetch_top_results) || (outputMode === 'answer' ? 3 : 0), 5));
    const allowedDomains = Array.isArray(args?.allowed_domains) ? args.allowed_domains : [];
    const blockedDomains = Array.isArray(args?.blocked_domains) ? args.blocked_domains : [];
    if (!query) {
      const message = '(укажи "query")';
      return createToolExecutionResult('web_search', 'error', message, {
        presentation: {
          kind: 'web_search',
          data: buildWebSearchPreflightPresentation('', outputMode, message),
        },
      });
    }

    try {
      const search = await searchDuckDuckGoLite(query, parseDuckDuckGoLiteResults, context.signal);
      const parsed = search.results;
      const filtered = filterWebSearchHits(parsed, { allowedDomains, blockedDomains }).slice(0, limit);

      if (filtered.length === 0) {
        return allowLlmFallback
          ? llmSearchFallback(query, 'Нет результатов веб-поиска', outputMode, answerPrompt)
          : createWebSearchResult({
            query,
            results: [],
            outputMode,
            provenance: 'web',
            failureReason: 'Нет подтверждённых веб-результатов.',
            cacheHit: search.cacheHit,
          });
      }

      let groundedAnswer = '';
      let fetchedCount = 0;
      let skippedFetchCount = 0;
      if (outputMode === 'answer') {
        const grounding = await fetchGroundingSources(filtered, fetchTopResults, context.signal, config);
        fetchedCount = grounding.fetchedCount;
        skippedFetchCount = grounding.skippedCount;
        groundedAnswer = await synthesizeGroundedWebAnswer(query, answerPrompt || query, grounding.sources, context.signal);
      }

      return createWebSearchResult({
        query,
        results: filtered,
        outputMode,
        provenance: 'web',
        ...(answerPrompt ? { answerPrompt } : {}),
        ...(groundedAnswer ? { groundedAnswer } : {}),
        ...(fetchedCount ? { fetchedCount } : {}),
        ...(skippedFetchCount ? { skippedFetchCount } : {}),
        cacheHit: search.cacheHit,
      });
    } catch (error: any) {
      return allowLlmFallback
        ? llmSearchFallback(query, `DuckDuckGo недоступен: ${error?.message || error}`, outputMode, answerPrompt)
        : createWebSearchResult({
          query,
          results: [],
          outputMode,
          provenance: 'unavailable',
          failureReason: `DuckDuckGo недоступен: ${error?.message || error}`,
        });
    }
  },

  async web_fetch(args, context) {
    const url = args?.url || '';
    const outputMode = normalizeWebFetchOutputMode(args?.outputMode || args?.mode || args?.view);
    const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : '';
    const config = readConfig();
    if (!url) {
      const message = '(укажи "url")';
      return createToolExecutionResult('web_fetch', 'error', message, {
        presentation: {
          kind: 'web_fetch',
          data: buildWebFetchPreflightPresentation('', outputMode, message),
        },
      });
    }
    if (!/^https?:\/\//i.test(url)) {
      const message = `Некорректный URL: "${url}"`;
      return createToolExecutionResult('web_fetch', 'error', message, {
        presentation: {
          kind: 'web_fetch',
          data: buildWebFetchPreflightPresentation(url, outputMode, message),
        },
      });
    }

    const trustDecision = getWebFetchTrustDecision(url, config);
    if (trustDecision.kind === 'restricted' || trustDecision.kind === 'blocked') {
      return createWebFetchBlockedResult(
        url,
        outputMode,
        trustDecision.reason,
        trustDecision.host,
        trustDecision.kind,
      );
    }

    let autoApproved = false;
    let effectiveTrustKind: WebTrustKind = trustDecision.kind;
    if (trustDecision.kind === 'external') {
      const confirmId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const request = context.onEvent
        ? buildToolApprovalRequest('web_fetch', {
          confirmId,
          url,
          host: trustDecision.host,
          prompt,
          trustKind: trustDecision.kind,
          summary: `Внешний домен ${trustDecision.host} не входит в доверенные web-fetch hosts.`,
        })
        : undefined;

      const result = request && context.onEvent
        ? await context.onEvent('approval-request', request.title, request) as AgentWebApprovalResult | undefined
        : undefined;

      if (!result) {
        return createWebFetchBlockedResult(
          url,
          outputMode,
          `URL не загружен: для домена ${trustDecision.host} нужно подтверждение.`,
          trustDecision.host,
          trustDecision.kind,
        );
      }
      if (result.cancelled) {
        return createWebFetchBlockedResult(
          url,
          outputMode,
          `URL не загружен: ожидание подтверждения прервано для ${trustDecision.host}.`,
          trustDecision.host,
          trustDecision.kind,
        );
      }
      if (!result.approved) {
        return createWebFetchBlockedResult(
          url,
          outputMode,
          `URL отклонён пользователем: ${url}`,
          trustDecision.host,
          trustDecision.kind,
        );
      }

      autoApproved = result.reason === 'auto_approved';
      if (result.rememberHost) {
        await saveConfig({
          webTrustedHosts: updateWebHostList(config.webTrustedHosts, trustDecision.host, 'add'),
          webBlockedHosts: updateWebHostList(config.webBlockedHosts, trustDecision.host, 'remove'),
        });
        effectiveTrustKind = 'trusted';
      }
    }

    try {
      const outcome = await fetchWebResource(url, context.signal);
      if (outcome.kind === 'redirect') {
        return createToolExecutionResult(
          'web_fetch',
          'degraded',
          truncate(formatWebFetchResult({
            url,
            finalUrl: url,
            statusCode: outcome.statusCode,
            contentType: 'redirect',
            outputMode,
            redirectUrl: outcome.redirectUrl,
            redirectStatusCode: outcome.statusCode,
            cacheHit: outcome.cacheHit,
            host: trustDecision.host,
            trustKind: effectiveTrustKind,
          }), 12_000),
          {
            autoApproved,
            presentation: {
              kind: 'web_fetch',
              data: buildWebFetchPresentation({
                url,
                finalUrl: url,
                statusCode: outcome.statusCode,
                contentType: 'redirect',
                outputMode,
                redirectUrl: outcome.redirectUrl,
                redirectStatusCode: outcome.statusCode,
                cacheHit: outcome.cacheHit,
                host: trustDecision.host,
                trustKind: effectiveTrustKind,
              }),
            },
          },
        );
      }

      if (outcome.kind === 'http_error') {
        return createWebFetchErrorResult(
          url,
          outcome.statusCode,
          outcome.contentType,
          `Ошибка: HTTP ${outcome.statusCode} — "${outcome.finalUrl}"${outcome.bodyPreview ? `\n${outcome.bodyPreview}` : ''}`,
          trustDecision.host,
          effectiveTrustKind,
        );
      }

      const contentType = outcome.contentType || '';
      const finalUrl = outcome.finalUrl;
      const cacheHit = outcome.cacheHit;
      const redirected = outcome.redirected;
      let extractedAnswer = '';

      if (contentType.includes('json')) {
        const jsonValue = safeParseJson(outcome.jsonText);
        if (jsonValue !== undefined) {
          if (prompt) {
            extractedAnswer = await extractAnswerFromFetchedResource(
              finalUrl,
              prompt,
              JSON.stringify(jsonValue, null, 2),
              context.signal,
            );
          }
          return createWebFetchResult({
            url,
            finalUrl,
            statusCode: outcome.statusCode,
            contentType,
            outputMode,
            jsonValue,
            bytes: outcome.bytes,
            cacheHit,
            redirected,
            host: trustDecision.host,
            trustKind: effectiveTrustKind,
            ...(prompt ? { prompt } : {}),
            ...(extractedAnswer ? { extractedAnswer } : {}),
          }, autoApproved);
        }
      }

      const rawText = outcome.textContent || outcome.jsonText || '';
      const prepared = prepareWebFetchContent(rawText, contentType);
      const textContent = prepared.textContent ? truncate(prepared.textContent, outputMode === 'content' ? 10_000 : 2_400) : undefined;
      if (prompt && textContent && !prepared.isBinary) {
        extractedAnswer = await extractAnswerFromFetchedResource(
          finalUrl,
          prompt,
          textContent,
          context.signal,
        );
      }

      return createWebFetchResult({
        url,
        finalUrl,
        statusCode: outcome.statusCode,
        contentType,
        outputMode,
        htmlTitle: prepared.htmlTitle,
        textContent,
        bytes: outcome.bytes,
        isBinary: prepared.isBinary,
        cacheHit,
        redirected,
        host: trustDecision.host,
        trustKind: effectiveTrustKind,
        ...(prompt ? { prompt } : {}),
        ...(extractedAnswer ? { extractedAnswer } : {}),
      }, autoApproved);
    } catch (error: any) {
      const message = `Ошибка: ${error?.message || error}`;
      return createToolExecutionResult('web_fetch', 'error', message, {
        autoApproved,
        presentation: {
          kind: 'web_fetch',
          data: {
            ...buildWebFetchPreflightPresentation(url, outputMode, message),
            host: trustDecision.host,
            trustKind: effectiveTrustKind,
          },
        },
      });
    }
  },

  async shell(args, context) {
    const command = args?.command || args?.cmd || '';
    const cwd = args?.cwd || args?.working_directory || getAgentWorkspaceRootPath();
    const runInBackground = args?.run_in_background === true || args?.background === true;
    if (!command) {
      const message = '(укажи "command")';
      return createToolExecutionResult('shell', 'error', message, {
        presentation: {
          kind: 'shell',
          data: buildShellPreflightPresentation(command, cwd, message, 'error'),
        },
      });
    }
    if (/[\r\n]/.test(command)) {
      const message = 'Команда отклонена: многострочные команды запрещены.';
      return createToolExecutionResult('shell', 'blocked', message, {
        presentation: {
          kind: 'shell',
          data: buildBlockedShellPresentation(command, cwd, message),
        },
      });
    }
    if (isShellCommandBlocked(command)) {
      const message = `Команда заблокирована: "${command}"`;
      return createToolExecutionResult('shell', 'blocked', message, {
        presentation: {
          kind: 'shell',
          data: buildBlockedShellPresentation(command, cwd, message),
        },
      });
    }
    let finalCommand = command;
    let autoApproved = false;
    if (context.onEvent) {
      const confirmId = `sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const approvalMeta = buildShellApprovalMeta(command, cwd);
      const request = buildToolApprovalRequest('shell', {
        confirmId,
        command,
        cwd,
        ...approvalMeta,
      });
      const result = request
        ? await context.onEvent('approval-request', request.title, request) as AgentShellApprovalResult | undefined
        : undefined;
      if (!result) {
        const message = `Команда не выполнена: подтверждение не получено для "${command}".`;
        return createToolExecutionResult('shell', 'blocked', message, {
          presentation: {
            kind: 'shell',
            data: buildBlockedShellPresentation(command, cwd, message),
          },
        });
      }
      if (typeof result === 'object' && result.cancelled) {
        const message = `Команда не выполнена: ожидание подтверждения прервано для "${command}".`;
        return createToolExecutionResult('shell', 'blocked', message, {
          presentation: {
            kind: 'shell',
            data: buildBlockedShellPresentation(command, cwd, message),
          },
        });
      }
      if (typeof result === 'object' && !result.approved) {
        const message = `Команда отклонена пользователем: "${command}"`;
        return createToolExecutionResult('shell', 'blocked', message, {
          presentation: {
            kind: 'shell',
            data: buildBlockedShellPresentation(command, cwd, message),
          },
        });
      }
      autoApproved = typeof result === 'object' && result.reason === 'auto_approved';
      if (typeof result === 'object' && result.command) finalCommand = result.command;
      if (isShellCommandBlocked(finalCommand)) {
        const message = `Команда заблокирована: "${finalCommand}"`;
        return createToolExecutionResult('shell', 'blocked', message, {
          autoApproved,
          presentation: {
            kind: 'shell',
            data: buildBlockedShellPresentation(finalCommand, cwd, message),
          },
        });
      }
    }

    try {
      if (runInBackground) {
        const rootPath = getAgentWorkspaceRootPath() || process.cwd();
        const task = await startBackgroundShellJob({
          command: finalCommand,
          cwd: path.resolve(String(cwd || rootPath)),
          taskSubject: typeof args?.task_subject === 'string' ? args.task_subject : undefined,
          taskDescription: typeof args?.task_description === 'string' ? args.task_description : undefined,
          rootPath,
        });
        const presentation = buildShellBackgroundPresentation({
          command: finalCommand,
          cwd: String(cwd || rootPath),
          taskId: task.id,
          stdoutPath: task.stdoutPath,
          stderrPath: task.stderrPath,
        });
        return createToolExecutionResult(
          'shell',
          'success',
          truncate(
            formatShellBackgroundResult({
              command: finalCommand,
              cwd: String(cwd || rootPath),
              taskId: task.id,
              stdoutPath: task.stdoutPath,
              stderrPath: task.stderrPath,
            }),
            12_000,
          ),
          {
            autoApproved,
            presentation: {
              kind: 'shell',
              data: presentation,
            },
          },
        );
      }

      const { exec } = require('child_process') as typeof import('child_process');
      const shellResult = await new Promise<{
        formatted: string;
        presentation: ReturnType<typeof buildShellExecutionPresentation>;
      }>((resolve, reject) => {
        const childProcess = exec(
          finalCommand,
          {
            cwd,
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, LANG: 'en_US.UTF-8' },
          },
          (error: any, stdout: string, stderr: string) => {
            if (error && !stdout && !stderr && typeof error?.code !== 'number') {
              reject(new Error(error.message));
              return;
            }
            const params = {
              command: finalCommand,
              cwd,
              stdout: stdout || '',
              stderr: stderr || '',
              exitCode: typeof error?.code === 'number' ? error.code : 0,
              signal: typeof error?.signal === 'string' ? error.signal : undefined,
            };
            const presentation = buildShellExecutionPresentation(params);
            resolve({
              formatted: formatShellExecutionResult(params),
              presentation,
            });
          },
        );
        childProcess.on('error', (error: any) => reject(error));
      });

      return createToolExecutionResult(
        'shell',
        shellResult.presentation.status,
        truncate(shellResult.formatted, 12_000),
        {
          autoApproved,
          presentation: {
            kind: 'shell',
            data: shellResult.presentation,
          },
        },
      );
    } catch (error: any) {
      const message = `Ошибка: ${error?.message || error}`;
      return createToolExecutionResult('shell', 'error', message, {
        autoApproved,
        presentation: {
          kind: 'shell',
          data: buildShellPreflightPresentation(finalCommand, cwd, message, 'error'),
        },
      });
    }
  },
};

async function llmSearchFallback(
  query: string,
  reason: string,
  outputMode: WebSearchOutputMode,
  answerPrompt?: string,
): Promise<ToolExecutionOutput> {
  const config = readConfig();
  if (config.apiBaseUrl && config.apiKey && config.model) {
    try {
      const answer = await sendChatRequest(
        config.apiBaseUrl,
        config.apiKey,
        config.model,
        [
          { role: 'system', content: 'Дай краткий markdown-ответ на вопрос. Явно пометь, если информация не подтверждена веб-источниками.' },
          { role: 'user', content: answerPrompt || query },
        ],
        { temperature: 0.3, retryUntilSuccess: true },
      );
      return createWebSearchResult({
        query,
        results: [],
        outputMode,
        provenance: 'llm-fallback',
        failureReason: reason,
        llmFallbackAnswer: answer,
        ...(answerPrompt ? { answerPrompt } : {}),
        ...(outputMode === 'answer' ? { groundedAnswer: answer } : {}),
      });
    } catch {
      // Ignore LLM fallback errors and return the original search failure.
    }
  }

  return createWebSearchResult({
    query,
    results: [],
    outputMode,
    provenance: 'unavailable',
    failureReason: reason,
  });
}

function createWebSearchResult(input: Parameters<typeof formatWebSearchResult>[0]) {
  const presentation = buildWebSearchPresentation(input);
  const status = input.provenance === 'web' ? 'success' : 'degraded';
  return createToolExecutionResult(
    'web_search',
    status,
    formatWebSearchResult(input),
    {
      presentation: {
        kind: 'web_search',
        data: presentation,
      },
    },
  );
}

function createWebFetchResult(input: Parameters<typeof formatWebFetchResult>[0], autoApproved = false) {
  const presentation = buildWebFetchPresentation(input);
  return createToolExecutionResult(
    'web_fetch',
    'success',
    truncate(formatWebFetchResult(input), 12_000),
    {
      autoApproved,
      presentation: {
        kind: 'web_fetch',
        data: presentation,
      },
    },
  );
}

function createWebFetchErrorResult(
  url: string,
  statusCode: number,
  contentType: string,
  message: string,
  host?: string,
  trustKind?: WebTrustKind,
) {
  const base = buildWebFetchPresentation({
    url,
    statusCode,
    contentType,
    outputMode: 'metadata',
    host,
    trustKind,
  });
  return createToolExecutionResult(
    'web_fetch',
    'error',
    message,
    {
      presentation: {
        kind: 'web_fetch',
        data: {
          ...base,
          summary: 'Не удалось загрузить URL',
          detail: `HTTP ${statusCode} • ${url}`,
          preview: message,
        },
      },
    },
  );
}

function createWebFetchBlockedResult(
  url: string,
  outputMode: 'summary' | 'content' | 'metadata',
  message: string,
  host?: string,
  trustKind?: WebTrustKind,
) {
  const base = buildWebFetchPresentation({
    url,
    statusCode: 0,
    contentType: 'blocked',
    outputMode,
    host,
    trustKind,
  });
  return createToolExecutionResult(
    'web_fetch',
    'blocked',
    message,
    {
      presentation: {
        kind: 'web_fetch',
        data: {
          ...base,
          summary: 'Загрузка URL заблокирована',
          detail: [host ? `host: ${host}` : '', truncate(message, 180)].filter(Boolean).join(' • '),
          preview: message,
          nextStep: trustKind === 'external'
            ? 'Разреши домен в карточке подтверждения или добавь его в список доверенных host rules.'
            : 'Исправь URL или используй другой источник.',
        },
      },
    },
  );
}

type GroundingSource = {
  title: string;
  url: string;
  snippet?: string;
  content?: string;
};

async function fetchGroundingSources(
  results: WebSearchHit[],
  maxSources: number,
  signal?: AbortSignal,
  config?: ReturnType<typeof readConfig>,
): Promise<{ sources: GroundingSource[]; fetchedCount: number; skippedCount: number }> {
  const shortlisted = results.slice(0, Math.max(0, maxSources));
  const outcomes = await Promise.all(shortlisted.map(async (result) => {
    const trustedForFetch = config ? shouldAutoFetchGroundingUrl(result.url, config) : false;
    if (!trustedForFetch) {
      return {
        source: {
          title: result.title || result.url,
          url: result.url,
          ...(result.snippet ? { snippet: result.snippet } : {}),
        } satisfies GroundingSource,
        fetched: false,
        skipped: true,
      };
    }
    try {
      const outcome = await fetchWebResource(result.url, signal);
      if (outcome.kind !== 'success') {
        return {
          source: {
            title: result.title || result.url,
            url: result.url,
            ...(result.snippet ? { snippet: result.snippet } : {}),
          } satisfies GroundingSource,
          fetched: false,
          skipped: false,
        };
      }

      let content = '';
      if (outcome.jsonText) {
        content = truncate(outcome.jsonText, 2_400);
      } else if (outcome.textContent) {
        const prepared = prepareWebFetchContent(outcome.textContent, outcome.contentType);
        content = truncate(prepared.textContent || '', 2_400);
      }

      return {
        source: {
          title: result.title || result.url,
          url: result.url,
          ...(result.snippet ? { snippet: result.snippet } : {}),
          ...(content ? { content } : {}),
        } satisfies GroundingSource,
        fetched: true,
        skipped: false,
      };
    } catch {
      return {
        source: {
          title: result.title || result.url,
          url: result.url,
          ...(result.snippet ? { snippet: result.snippet } : {}),
        } satisfies GroundingSource,
        fetched: false,
        skipped: false,
      };
    }
  }));

  return {
    sources: outcomes
      .map((item) => item.source)
      .filter((item) => item.snippet || item.content),
    fetchedCount: outcomes.filter((item) => item.fetched).length,
    skippedCount: outcomes.filter((item) => item.skipped).length,
  };
}

async function synthesizeGroundedWebAnswer(
  query: string,
  prompt: string,
  sources: GroundingSource[],
  signal?: AbortSignal,
): Promise<string> {
  if (!sources.length) return '';
  const config = readConfig();
  if (!config.apiBaseUrl || !config.apiKey || !config.model) return '';

  const sourceText = sources.map((source, index) => [
    `[Источник ${index + 1}] ${source.title || source.url}`,
    `URL: ${source.url}`,
    source.snippet ? `Сниппет: ${source.snippet}` : '',
    source.content ? `Контент:\n${source.content}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  try {
    const answer = await sendChatRequest(
      config.apiBaseUrl,
      config.apiKey,
      config.model,
      [
        {
          role: 'system',
          content:
            'Ты помогаешь агенту искать в интернете. Отвечай только по приведённым источникам. Не придумывай факты. ' +
            'Если источники неполные или противоречат друг другу, скажи об этом явно. ' +
            'В конце добавь короткий раздел "Источники:" с нумерованным списком реально использованных URL.',
        },
        {
          role: 'user',
          content: [
            `Запрос пользователя: ${query}`,
            `Нужно ответить так: ${prompt}`,
            '',
            'Источники:',
            sourceText,
          ].join('\n'),
        },
      ],
      {
        temperature: 0.15,
        maxTokens: 1_000,
        retryUntilSuccess: true,
        signal,
      },
    );
    return answer.trim();
  } catch {
    return '';
  }
}

async function extractAnswerFromFetchedResource(
  url: string,
  prompt: string,
  content: string,
  signal?: AbortSignal,
): Promise<string> {
  const config = readConfig();
  if (!config.apiBaseUrl || !config.apiKey || !config.model) return '';

  try {
    const answer = await sendChatRequest(
      config.apiBaseUrl,
      config.apiKey,
      config.model,
      [
        {
          role: 'system',
          content:
            'Ты извлекаешь ответ из содержимого одного веб-источника. Используй только текст, который тебе передан. ' +
            'Если данных недостаточно, скажи об этом прямо. Не придумывай факты и не ссылайся на несуществующие разделы.',
        },
        {
          role: 'user',
          content: [
            `URL: ${url}`,
            `Вопрос: ${prompt}`,
            '',
            'Содержимое:',
            truncate(content, 20_000),
          ].join('\n'),
        },
      ],
      {
        temperature: 0.1,
        maxTokens: 900,
        retryUntilSuccess: true,
        signal,
      },
    );
    return answer.trim();
  } catch {
    return '';
  }
}

function safeParseJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
