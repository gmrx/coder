import type { StructuredPresentationSection } from './presentationItems';
import type { WebTrustKind } from './webTrust';

function stripHtml(html: string): string {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtml(text: string): string {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim();
}

function extractTitle(html: string): string {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtml(stripHtml(match?.[1] || ''));
}

function cleanHtmlToText(html: string): string {
  return decodeHtml(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim(),
  );
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function truncateLine(text: string, maxLength = 180): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function formatNumberedSources(results: WebSearchHit[], options: { includeSnippets?: boolean; limit?: number } = {}): string[] {
  const limit = Math.max(1, Math.min(results.length, options.limit || results.length));
  const includeSnippets = options.includeSnippets !== false;
  const lines: string[] = [];

  for (let index = 0; index < limit; index++) {
    const result = results[index];
    const host = normalizeHost(result.url);
    lines.push(`${index + 1}. ${result.title || result.url}`);
    lines.push(`   ${result.url}${host ? ` (${host})` : ''}`);
    if (includeSnippets && result.snippet) {
      lines.push(`   ${truncateLine(result.snippet, 220)}`);
    }
  }

  return lines;
}

function buildDomainOverview(results: WebSearchHit[]): string {
  const counts = new Map<string, number>();
  for (const result of results) {
    const host = normalizeHost(result.url);
    if (!host) continue;
    counts.set(host, (counts.get(host) || 0) + 1);
  }
  const topHosts = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([host, count]) => count > 1 ? `${host} ×${count}` : host);
  return topHosts.join(', ');
}

function summarizeJsonShape(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [
      `JSON-массив из ${value.length} ${pluralize(value.length, 'элемента', 'элементов', 'элементов')}.`,
      value.length > 0 && typeof value[0] === 'object' && value[0]
        ? `Ключи первого элемента: ${Object.keys(value[0] as Record<string, unknown>).slice(0, 8).join(', ')}`
        : '',
    ].filter(Boolean);
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return [
      `JSON-объект с ${keys.length} ${pluralize(keys.length, 'ключом', 'ключами', 'ключами')}.`,
      keys.length > 0 ? `Ключи: ${keys.slice(0, 10).join(', ')}` : '',
    ].filter(Boolean);
  }

  return [`JSON-значение типа ${typeof value}.`];
}

export type WebSearchOutputMode = 'summary' | 'results' | 'sources' | 'answer';
export type WebSearchProvenance = 'web' | 'llm-fallback' | 'unavailable';
export type WebFetchOutputMode = 'summary' | 'content' | 'metadata';

export interface WebSearchHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebSearchFormatInput {
  query: string;
  results: WebSearchHit[];
  outputMode: WebSearchOutputMode;
  provenance: WebSearchProvenance;
  failureReason?: string;
  llmFallbackAnswer?: string;
  answerPrompt?: string;
  groundedAnswer?: string;
  fetchedCount?: number;
  skippedFetchCount?: number;
  cacheHit?: boolean;
}

export interface WebFetchFormatInput {
  url: string;
  statusCode: number;
  contentType: string;
  outputMode: WebFetchOutputMode;
  finalUrl?: string;
  redirectUrl?: string;
  redirectStatusCode?: number;
  htmlTitle?: string;
  textContent?: string;
  jsonValue?: unknown;
  bytes?: number;
  isBinary?: boolean;
  cacheHit?: boolean;
  redirected?: boolean;
  prompt?: string;
  extractedAnswer?: string;
  host?: string;
  trustKind?: WebTrustKind;
}

export interface WebPresentation {
  summary?: string;
  detail: string;
  nextStep?: string;
  preview?: string;
  sections?: StructuredPresentationSection[];
}

export interface WebSearchPreviewItem {
  title: string;
  url: string;
  host?: string;
  snippet?: string;
}

export interface WebSearchPresentation extends WebPresentation {
  query: string;
  outputMode: WebSearchOutputMode;
  provenance: WebSearchProvenance;
  resultCount: number;
  domainOverview?: string;
  fetchedCount?: number;
  skippedFetchCount?: number;
  cacheHit?: boolean;
  answerPrompt?: string;
  groundedAnswer?: string;
  highlights?: WebSearchPreviewItem[];
}

export interface WebFetchPresentation extends WebPresentation {
  url: string;
  outputMode: WebFetchOutputMode;
  statusCode: number;
  contentType: string;
  bytes?: number;
  finalUrl?: string;
  redirectUrl?: string;
  redirectStatusCode?: number;
  htmlTitle?: string;
  isBinary?: boolean;
  cacheHit?: boolean;
  redirected?: boolean;
  prompt?: string;
  extractedAnswer?: string;
  host?: string;
  trustKind?: WebTrustKind;
}

export function buildWebSearchPreflightPresentation(
  query: string,
  outputMode: WebSearchOutputMode,
  message: string,
): WebSearchPresentation {
  return {
    query,
    outputMode,
    provenance: 'unavailable',
    resultCount: 0,
    summary: 'Веб-поиск не прошёл предварительную проверку',
    detail: truncateLine(message, 180) || 'Запрос веб-поиска отклонён до выполнения.',
    nextStep: 'Исправь запрос или аргументы и повтори web_search.',
    preview: message,
  };
}

export function buildWebFetchPreflightPresentation(
  url: string,
  outputMode: WebFetchOutputMode,
  message: string,
): WebFetchPresentation {
  return {
    url,
    outputMode,
    statusCode: 0,
    contentType: 'unknown',
    summary: 'URL не прошёл предварительную проверку',
    detail: truncateLine(message, 180) || 'Запрос URL отклонён до выполнения.',
    nextStep: 'Исправь URL или args и повтори web_fetch.',
    preview: message,
  };
}

export function normalizeWebSearchOutputMode(value: any): WebSearchOutputMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'answer' || mode === 'grounded' || mode === 'synthesize') return 'answer';
  if (mode === 'results' || mode === 'content' || mode === 'snippets') return 'results';
  if (mode === 'sources' || mode === 'links' || mode === 'urls') return 'sources';
  return 'summary';
}

export function normalizeWebFetchOutputMode(value: any): WebFetchOutputMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'content' || mode === 'full' || mode === 'text') return 'content';
  if (mode === 'metadata' || mode === 'meta' || mode === 'info') return 'metadata';
  return 'summary';
}

export function parseDuckDuckGoLiteResults(html: string): WebSearchHit[] {
  const links = [...String(html || '').matchAll(/<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ url: decodeHtml(match[1]), title: decodeHtml(stripHtml(match[2])) }));
  const snippets = [...String(html || '').matchAll(/<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => decodeHtml(stripHtml(match[1])));

  return links.map((link, index) => ({
    ...link,
    snippet: snippets[index] || undefined,
  }));
}

export function filterWebSearchHits(
  results: WebSearchHit[],
  options: { allowedDomains?: string[]; blockedDomains?: string[] },
): WebSearchHit[] {
  const allowed = new Set((options.allowedDomains || []).map((domain) => String(domain).trim().toLowerCase()).filter(Boolean));
  const blocked = new Set((options.blockedDomains || []).map((domain) => String(domain).trim().toLowerCase()).filter(Boolean));
  const matchesDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

  return results.filter((result) => {
    const host = normalizeHost(result.url).toLowerCase();
    if (!host) return false;
    if ([...blocked].some((domain) => matchesDomain(host, domain))) return false;
    if (allowed.size > 0 && ![...allowed].some((domain) => matchesDomain(host, domain))) return false;
    return true;
  });
}

export function formatWebSearchResult(input: WebSearchFormatInput): string {
  const presentation = buildWebSearchPresentation(input);
  const lines = [
    `web_search "${input.query}" (provenance: ${input.provenance}, results: ${input.results.length}, mode: ${input.outputMode})`,
    '',
  ];

  const domainOverview = presentation.domainOverview || '';
  const firstSource = input.results[0];

  lines.push('Кратко:');
  if (input.results.length === 0) {
    lines.push(`- По запросу не удалось получить подтверждённые веб-результаты.${input.failureReason ? ` Причина: ${input.failureReason}` : ''}`);
    if (input.provenance === 'llm-fallback' && input.llmFallbackAnswer) {
      lines.push('- Ниже только непроверенная fallback-сводка без подтверждённых источников.');
    }
  } else {
    lines.push(`- Найдено ${input.results.length} ${pluralize(input.results.length, 'результат', 'результата', 'результатов')}.`);
    if (domainOverview) {
      lines.push(`- Основные домены: ${domainOverview}.`);
    }
    if (input.fetchedCount) {
      lines.push(`- Полный fetch сделан для ${input.fetchedCount} ${pluralize(input.fetchedCount, 'источника', 'источников', 'источников')}.`);
    }
    if (input.skippedFetchCount) {
      lines.push(`- Для ${input.skippedFetchCount} ${pluralize(input.skippedFetchCount, 'источника', 'источников', 'источников')} полный fetch пропущен: домен не входит в доверенные.`);
    }
    if (firstSource?.title) {
      lines.push(`- Первый ориентир: ${truncateLine(firstSource.title, 120)}.`);
    }
  }
  lines.push('');

  if (input.outputMode === 'summary') {
    lines.push('Источники:');
    if (input.results.length > 0) {
      lines.push(...formatNumberedSources(input.results, { includeSnippets: true, limit: 4 }));
    } else {
      lines.push('- Источники не найдены.');
    }
    lines.push('');
  }

  if (input.outputMode === 'answer') {
    lines.push('Ответ:');
    lines.push(input.groundedAnswer ? input.groundedAnswer : 'Не удалось собрать grounded answer по найденным источникам.');
    lines.push('');
    lines.push('Источники:');
    if (input.results.length > 0) {
      lines.push(...formatNumberedSources(input.results, { includeSnippets: true, limit: Math.min(input.results.length, 6) }));
    } else {
      lines.push('- Источники не найдены.');
    }
    lines.push('');
  }

  if (input.outputMode === 'results') {
    lines.push('Результаты:');
    if (input.results.length > 0) {
      lines.push(...formatNumberedSources(input.results, { includeSnippets: true, limit: input.results.length }));
    } else {
      lines.push('- Результатов нет.');
    }
    lines.push('');
  }

  if (input.outputMode === 'sources') {
    lines.push('Источники:');
    if (input.results.length > 0) {
      lines.push(...formatNumberedSources(input.results, { includeSnippets: false, limit: input.results.length }));
    } else {
      lines.push('- Источники не найдены.');
    }
    lines.push('');
  }

  if (input.llmFallbackAnswer) {
    lines.push('Fallback-сводка:');
    lines.push(truncateLine(input.llmFallbackAnswer, 400));
    lines.push('');
  }

  lines.push(
    `Следующий шаг: ${
      input.outputMode === 'answer' && input.results.length > 0
        ? 'если нужно проверить первоисточник глубже, вызови web_fetch по одному из URL; если нужен только список ссылок, переключись на outputMode="sources".'
        : input.results.length > 0
        ? 'если нужен полный контекст по конкретному источнику, вызови web_fetch с URL из списка; если нужны только ссылки, используй outputMode="sources".'
        : 'если есть точный URL, переходи к web_fetch; иначе уточни запрос или домены.'
    }`,
  );

  return lines.join('\n').trim();
}

export function formatWebFetchResult(input: WebFetchFormatInput): string {
  const presentation = buildWebFetchPresentation(input);
  const host = normalizeHost(input.url);
  const trustLabel = input.trustKind === 'preapproved'
    ? 'доверенный documentation/code host'
    : input.trustKind === 'trusted'
      ? 'разрешённый host'
      : input.trustKind === 'blocked'
        ? 'заблокированный host'
        : input.trustKind === 'restricted'
          ? 'локальный или запрещённый URL'
          : input.trustKind === 'external'
            ? 'внешний host'
            : '';
  const lines = [
    `web_fetch "${input.url}" (status: ${input.statusCode}, content_type: ${input.contentType || 'unknown'}, mode: ${input.outputMode})`,
    '',
    `URL: ${input.url}${host ? ` (${host})` : ''}`,
  ];

  if (input.finalUrl && input.finalUrl !== input.url) {
    lines.push(`Итоговый URL: ${input.finalUrl}`);
  }

  if (input.redirectUrl) {
    lines.push(`Редирект: ${input.redirectUrl}${input.redirectStatusCode ? ` (HTTP ${input.redirectStatusCode})` : ''}`);
  }

  if (input.htmlTitle) {
    lines.push(`Заголовок: ${truncateLine(input.htmlTitle, 140)}`);
  }
  if (input.bytes) {
    lines.push(`Размер: ${input.bytes} B`);
  }
  if (trustLabel) {
    lines.push(`Доверие: ${trustLabel}`);
  }
  if (input.cacheHit) {
    lines.push('Кэш: использован сохранённый ответ');
  }
  lines.push('');

  if (input.redirectUrl) {
    lines.push('Кратко:');
    lines.push('- URL перенаправляет на другой хост, поэтому автоматическая загрузка остановлена из соображений безопасности.');
    lines.push('');
    lines.push('Следующий шаг: повтори web_fetch с redirectUrl, если это действительно нужный источник.');
    return lines.join('\n').trim();
  }

  if (input.outputMode === 'metadata') {
    lines.push('Метаданные:');
    lines.push(`- Статус: ${input.statusCode}`);
    lines.push(`- Тип содержимого: ${input.contentType || 'unknown'}`);
    lines.push(`- Ресурс ${input.isBinary ? 'похож на нетекстовый' : 'похож на текстовый'}.`);
    lines.push('');
    lines.push(`Следующий шаг: ${input.isBinary ? 'ищи HTML/JSON-источник или другой URL с текстовым содержимым.' : 'если нужен текст страницы, вызови web_fetch с outputMode="summary" или outputMode="content".'}`);
    return lines.join('\n').trim();
  }

  if (input.jsonValue !== undefined) {
    const jsonSummary = summarizeJsonShape(input.jsonValue);
    lines.push('Кратко:');
    for (const item of jsonSummary) {
      lines.push(`- ${item}`);
    }
    lines.push('');

    if (input.outputMode === 'content') {
      const jsonText = JSON.stringify(input.jsonValue, null, 2);
      lines.push('Содержимое:');
      lines.push(jsonText.length <= 9_000 ? jsonText : `${jsonText.slice(0, 8_999)}…`);
      lines.push('');
    }

    if (input.extractedAnswer) {
      lines.push('Извлечённый ответ:');
      lines.push(input.extractedAnswer);
      lines.push('');
    }

    lines.push(`Следующий шаг: ${input.outputMode === 'content' ? 'если нужен только обзор структуры, повтори web_fetch с outputMode="summary".' : 'если нужен полный JSON, повтори web_fetch с outputMode="content".'}`);
    return lines.join('\n').trim();
  }

  const text = String(input.textContent || '').trim();
  const shortText = truncateLine(text, 260);

  lines.push('Кратко:');
  if (input.isBinary) {
    lines.push('- Похоже на нетекстовый ресурс, полноценный текстовый обзор недоступен.');
  } else if (shortText) {
    lines.push(`- ${shortText}`);
  } else {
    lines.push('- Текстовое содержимое почти отсутствует.');
  }
  lines.push('');

  if (input.outputMode === 'content') {
    lines.push('Содержимое:');
    lines.push(text || '(пустое содержимое)');
    lines.push('');
  }

  if (input.extractedAnswer) {
    lines.push('Извлечённый ответ:');
    lines.push(input.extractedAnswer);
    lines.push('');
  }

  lines.push(`Следующий шаг: ${input.outputMode === 'content' ? 'если нужен только короткий обзор, повтори web_fetch с outputMode="summary".' : input.isBinary ? 'если нужен текст, ищи HTML/JSON-версию ресурса или другой URL.' : 'если нужен полный текст, повтори web_fetch с outputMode="content".'}`);
  return lines.join('\n').trim();
}

export function buildWebSearchPresentation(input: WebSearchFormatInput): WebSearchPresentation {
  const domainOverview = buildDomainOverview(input.results);
  const firstSource = input.results[0];
  const summary = input.results.length === 0
    ? input.provenance === 'llm-fallback'
      ? 'Поиск без подтверждённых источников'
      : 'Подтвердить результаты не удалось'
    : input.outputMode === 'answer'
      ? input.groundedAnswer
        ? 'Подготовил grounded answer по веб-источникам'
        : 'Собрал веб-источники для ответа'
    : input.outputMode === 'sources'
      ? 'Собрал веб-источники'
      : input.outputMode === 'results'
        ? 'Подготовил веб-результаты'
        : 'Подготовил обзор веб-поиска';
  const detail = input.results.length === 0
    ? `Нет подтверждённых веб-результатов.${input.failureReason ? ` ${truncateLine(input.failureReason, 180)}` : ''}`
    : [
      `${input.results.length} ${pluralize(input.results.length, 'результат', 'результата', 'результатов')}`,
      input.fetchedCount ? `прочитал источников: ${input.fetchedCount}` : '',
      input.skippedFetchCount ? `без полного fetch: ${input.skippedFetchCount}` : '',
      input.cacheHit ? 'выдача из кэша' : '',
      domainOverview ? `домены: ${domainOverview}` : '',
      firstSource?.title ? `первый ориентир: ${truncateLine(firstSource.title, 96)}` : '',
    ].filter(Boolean).join(' • ');
  const previewLines: string[] = [];
  if (input.outputMode === 'answer' && input.groundedAnswer) {
    previewLines.push(input.groundedAnswer.trim());
  } else if (input.results.length > 0) {
    previewLines.push(...formatNumberedSources(input.results, {
      includeSnippets: input.outputMode !== 'sources',
      limit: input.outputMode === 'summary' ? 4 : Math.min(input.results.length, 8),
    }));
  } else if (input.llmFallbackAnswer) {
    previewLines.push(`Fallback-сводка:\n${truncateLine(input.llmFallbackAnswer, 400)}`);
  } else {
    previewLines.push(input.failureReason || 'Подтверждённых веб-результатов нет.');
  }
  return {
    query: input.query,
    outputMode: input.outputMode,
    provenance: input.provenance,
    resultCount: input.results.length,
    ...(input.fetchedCount ? { fetchedCount: input.fetchedCount } : {}),
    ...(input.skippedFetchCount ? { skippedFetchCount: input.skippedFetchCount } : {}),
    ...(input.cacheHit ? { cacheHit: input.cacheHit } : {}),
    ...(input.answerPrompt ? { answerPrompt: input.answerPrompt } : {}),
    ...(input.groundedAnswer ? { groundedAnswer: input.groundedAnswer } : {}),
    ...(domainOverview ? { domainOverview } : {}),
    ...(input.results.length > 0
      ? {
        highlights: input.results.slice(0, input.outputMode === 'summary' ? 4 : 6).map((result) => ({
          title: result.title || result.url,
          url: result.url,
          ...(normalizeHost(result.url) ? { host: normalizeHost(result.url) } : {}),
          ...(result.snippet ? { snippet: truncateLine(result.snippet, 220) } : {}),
        })),
      }
      : {}),
    summary,
    detail,
    nextStep: input.outputMode === 'answer' && input.results.length > 0
      ? 'Если нужно перепроверить конкретный источник, открой его через web_fetch; если нужны только ссылки, переключись на outputMode="sources".'
      : input.results.length > 0
      ? 'Если нужен полный контекст по источнику, вызови web_fetch с URL из списка.'
      : 'Если есть точный URL, переходи к web_fetch; иначе уточни запрос или домены.',
    preview: previewLines.join('\n').trim(),
    sections: input.results.length > 0
      ? [{
        title: 'Источники',
        items: input.results.slice(0, input.outputMode === 'summary' ? 4 : 6).map((result) => ({
          title: result.title || result.url,
          subtitle: normalizeHost(result.url)
            ? `${normalizeHost(result.url)} • ${result.url}`
            : result.url,
          meta: result.snippet ? truncateLine(result.snippet, 220) : '',
        })),
      }]
      : [],
  };
}

export function buildWebFetchPresentation(input: WebFetchFormatInput): WebFetchPresentation {
  const text = String(input.textContent || '').trim();
  const shortText = truncateLine(text, 260);
  const trustLabel = input.trustKind === 'preapproved'
    ? 'доверенный documentation/code host'
    : input.trustKind === 'trusted'
      ? 'разрешённый host'
      : input.trustKind === 'blocked'
        ? 'заблокированный host'
        : input.trustKind === 'restricted'
          ? 'локальный или запрещённый URL'
          : input.trustKind === 'external'
            ? 'внешний host'
            : '';
  const summary = input.redirectUrl
    ? 'URL перенаправляет на другой хост'
    : input.prompt && input.extractedAnswer
      ? 'Извлёк ответ из URL'
    : input.outputMode === 'metadata'
    ? 'Собрал метаданные URL'
    : input.jsonValue !== undefined
      ? input.outputMode === 'content' ? 'Получил полный JSON по URL' : 'Подготовил обзор JSON по URL'
      : input.outputMode === 'content'
        ? 'Получил полный контент по URL'
        : 'Подготовил обзор URL';
  const detail = input.redirectUrl
    ? [
      input.redirectStatusCode ? `HTTP ${input.redirectStatusCode}` : '',
      'нужен явный переход на новый хост',
      truncateLine(input.redirectUrl, 120),
    ].filter(Boolean).join(' • ')
    : input.outputMode === 'metadata'
    ? [
      `статус: ${input.statusCode}`,
      `тип: ${input.contentType || 'unknown'}`,
      input.host ? `host: ${input.host}` : '',
      trustLabel,
      input.cacheHit ? 'из кэша' : '',
      input.isBinary ? 'нетекстовый ресурс' : 'текстовый ресурс',
    ].filter(Boolean).join(' • ')
    : input.jsonValue !== undefined
      ? summarizeJsonShape(input.jsonValue).map((line) => truncateLine(line, 120)).join(' • ')
      : input.prompt && input.extractedAnswer
        ? truncateLine(input.extractedAnswer, 180)
      : input.htmlTitle
        ? truncateLine(input.htmlTitle, 120)
        : input.isBinary
          ? 'Похоже на нетекстовый ресурс, текстовый обзор ограничен.'
          : shortText || 'Текстовое содержимое почти отсутствует.';

  let preview = '';
  if (input.outputMode === 'content') {
    if (input.jsonValue !== undefined) {
      const jsonText = JSON.stringify(input.jsonValue, null, 2);
      preview = jsonText.length <= 9_000 ? jsonText : `${jsonText.slice(0, 8_999)}…`;
    } else {
      preview = text || '(пустое содержимое)';
    }
  } else if (input.outputMode === 'metadata') {
    preview = [
      `URL: ${input.url}`,
      input.host ? `Host: ${input.host}` : '',
      trustLabel ? `Доверие: ${trustLabel}` : '',
      `Статус: ${input.statusCode}`,
      `Тип содержимого: ${input.contentType || 'unknown'}`,
      input.bytes ? `Размер: ${input.bytes} B` : '',
    ].filter(Boolean).join('\n');
  } else {
    preview = [
      input.prompt && input.extractedAnswer ? `Ответ: ${truncateLine(input.extractedAnswer, 260)}` : '',
      trustLabel ? `Доверие: ${trustLabel}` : '',
      input.htmlTitle ? `Заголовок: ${truncateLine(input.htmlTitle, 140)}` : '',
      shortText ? `Кратко: ${shortText}` : '',
      input.bytes ? `Размер: ${input.bytes} B` : '',
    ].filter(Boolean).join('\n');
  }

  return {
    url: input.url,
    outputMode: input.outputMode,
    statusCode: input.statusCode,
    contentType: input.contentType,
    ...(input.bytes ? { bytes: input.bytes } : {}),
    ...(input.finalUrl ? { finalUrl: input.finalUrl } : {}),
    ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}),
    ...(input.redirectStatusCode ? { redirectStatusCode: input.redirectStatusCode } : {}),
    ...(input.htmlTitle ? { htmlTitle: input.htmlTitle } : {}),
    ...(input.isBinary !== undefined ? { isBinary: input.isBinary } : {}),
    ...(input.cacheHit ? { cacheHit: input.cacheHit } : {}),
    ...(input.redirected ? { redirected: input.redirected } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.extractedAnswer ? { extractedAnswer: input.extractedAnswer } : {}),
    ...(input.host ? { host: input.host } : {}),
    ...(input.trustKind ? { trustKind: input.trustKind } : {}),
    summary,
    detail,
    nextStep: input.redirectUrl
      ? 'Если редирект ожидаемый, повтори web_fetch уже по redirectUrl.'
      : input.outputMode === 'content'
      ? 'Если нужен только короткий обзор, повтори web_fetch с outputMode="summary".'
      : input.isBinary
        ? 'Если нужен текст, ищи HTML/JSON-версию ресурса или другой URL.'
        : input.jsonValue !== undefined
          ? 'Если нужен полный JSON, повтори web_fetch с outputMode="content".'
          : 'Если нужен полный текст, повтори web_fetch с outputMode="content".',
    ...(preview ? { preview } : {}),
    sections: buildWebFetchSections(input),
  };
}

function buildWebFetchSections(input: WebFetchFormatInput): StructuredPresentationSection[] {
  const resourceTitle = input.htmlTitle ? truncateLine(input.htmlTitle, 120) : input.url;
  const metaParts = [
    `status ${input.statusCode}`,
    input.contentType || 'unknown',
    input.bytes ? `${input.bytes} B` : '',
    input.cacheHit ? 'cache' : '',
    input.redirected ? 'redirected' : '',
    input.isBinary ? 'binary-like' : 'text-like',
  ].filter(Boolean);

  if (input.jsonValue !== undefined && input.jsonValue && typeof input.jsonValue === 'object' && !Array.isArray(input.jsonValue)) {
    const keys = Object.keys(input.jsonValue as Record<string, unknown>).slice(0, 8);
    return [
      {
        title: 'Ресурс',
        items: [{
          title: resourceTitle,
          subtitle: input.url,
          meta: metaParts.join(' • '),
        }],
      },
      ...(keys.length > 0
        ? [{
          title: 'Ключи JSON',
          items: keys.map((key) => ({ title: key })),
        }]
        : []),
    ];
  }

  return [{
    title: 'Ресурс',
    items: [{
      title: resourceTitle,
      subtitle: input.url,
      meta: metaParts.join(' • '),
    }],
  }];
}

export function parseWebSearchPresentation(content: string): WebPresentation {
  const detail =
    content.match(/^Кратко:\n-\s*(.+)$/m)?.[1]?.trim()
    || content.match(/^Источники:\n1\.\s*(.+)$/m)?.[1]?.trim()
    || 'Веб-результаты получены';
  const nextStep = content.match(/^Следующий шаг:\s*(.+)$/m)?.[1]?.trim();
  return {
    detail,
    nextStep,
  };
}

export function parseWebFetchPresentation(content: string): WebPresentation {
  const detail =
    content.match(/^Заголовок:\s*(.+)$/m)?.[1]?.trim()
    || content.match(/^Кратко:\n-\s*(.+)$/m)?.[1]?.trim()
    || content.match(/^Метаданные:\n-\s*(.+)$/m)?.[1]?.trim()
    || 'Данные по URL получены';
  const nextStep = content.match(/^Следующий шаг:\s*(.+)$/m)?.[1]?.trim();
  return {
    detail,
    nextStep,
  };
}

export function prepareWebFetchContent(
  rawContent: string,
  contentType: string,
): {
  textContent?: string;
  htmlTitle?: string;
  isBinary: boolean;
} {
  const normalizedContentType = String(contentType || '').toLowerCase();
  const isJson = normalizedContentType.includes('json');
  const isTextLike =
    normalizedContentType.startsWith('text/')
    || normalizedContentType.includes('html')
    || normalizedContentType.includes('xml')
    || normalizedContentType.includes('javascript')
    || normalizedContentType.includes('ecmascript');

  if (!isJson && !isTextLike) {
    return {
      isBinary: true,
    };
  }

  if (normalizedContentType.includes('html')) {
    return {
      textContent: cleanHtmlToText(rawContent),
      htmlTitle: extractTitle(rawContent),
      isBinary: false,
    };
  }

  return {
    textContent: String(rawContent || '').trim(),
    isBinary: false,
  };
}
