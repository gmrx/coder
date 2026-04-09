import { truncate } from '../../core/utils';
import type { WebSearchHit } from './webStudy';

const WEB_USER_AGENT = 'Mozilla/5.0 (compatible; CursorCoderVSCode/1.0; +https://example.invalid)';
const SEARCH_CACHE_TTL_MS = 10 * 60_000;
const FETCH_CACHE_TTL_MS = 15 * 60_000;
const MAX_SEARCH_CACHE_ENTRIES = 48;
const MAX_FETCH_CACHE_ENTRIES = 96;
const MAX_REDIRECTS = 10;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type WebSearchCacheValue = {
  results: WebSearchHit[];
};

type WebFetchSuccess = {
  kind: 'success';
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  bytes: number;
  textContent?: string;
  jsonText?: string;
  isBinary: boolean;
  cacheHit: boolean;
  redirected: boolean;
};

type WebFetchRedirect = {
  kind: 'redirect';
  requestedUrl: string;
  redirectUrl: string;
  statusCode: number;
  cacheHit: boolean;
};

type WebFetchHttpError = {
  kind: 'http_error';
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  bodyPreview?: string;
  cacheHit: boolean;
};

export type WebFetchOutcome = WebFetchSuccess | WebFetchRedirect | WebFetchHttpError;

type CachedWebFetchOutcome = Omit<WebFetchSuccess, 'cacheHit'> | Omit<WebFetchRedirect, 'cacheHit'> | Omit<WebFetchHttpError, 'cacheHit'>;

const searchCache = new Map<string, CacheEntry<WebSearchCacheValue>>();
const fetchCache = new Map<string, CacheEntry<CachedWebFetchOutcome>>();

function pruneCache<T>(cache: Map<string, CacheEntry<T>>, maxEntries: number): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > maxEntries) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) break;
    cache.delete(firstKey);
  }
}

function getCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  pruneCache(cache, Number.MAX_SAFE_INTEGER);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCacheValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number, maxEntries: number): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  pruneCache(cache, maxEntries);
}

function isRedirectStatus(statusCode: number): boolean {
  return statusCode >= 300 && statusCode < 400;
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function isSafeSameHostRedirect(fromUrl: string, toUrl: string): boolean {
  try {
    const from = new URL(fromUrl);
    const to = new URL(toUrl);
    if (!/^https?:$/i.test(to.protocol)) return false;
    if (to.username || to.password) return false;
    return normalizeHost(from.href) === normalizeHost(to.href);
  } catch {
    return false;
  }
}

function isTextLikeContentType(contentType: string): boolean {
  const value = String(contentType || '').toLowerCase();
  return (
    value.startsWith('text/') ||
    value.includes('json') ||
    value.includes('xml') ||
    value.includes('html') ||
    value.includes('javascript') ||
    value.includes('ecmascript') ||
    value.includes('svg')
  );
}

function cacheKeyForFetch(url: string): string {
  return String(url || '').trim();
}

function cacheKeyForSearch(query: string): string {
  return String(query || '').trim().toLowerCase();
}

function withoutCacheFlag(outcome: WebFetchOutcome): CachedWebFetchOutcome {
  const { cacheHit: _cacheHit, ...rest } = outcome;
  return rest;
}

export async function searchDuckDuckGoLite(
  query: string,
  parseResults: (html: string) => WebSearchHit[],
  signal?: AbortSignal,
): Promise<{ results: WebSearchHit[]; cacheHit: boolean }> {
  const normalizedQuery = String(query || '').trim();
  const cacheKey = cacheKeyForSearch(normalizedQuery);
  const cached = getCacheValue(searchCache, cacheKey);
  if (cached) {
    return { results: cached.results.map((item) => ({ ...item })), cacheHit: true };
  }

  const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(normalizedQuery)}`, {
    headers: { 'User-Agent': WEB_USER_AGENT },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const results = parseResults(html);
  setCacheValue(searchCache, cacheKey, { results }, SEARCH_CACHE_TTL_MS, MAX_SEARCH_CACHE_ENTRIES);
  return { results: results.map((item) => ({ ...item })), cacheHit: false };
}

export async function fetchWebResource(
  url: string,
  signal?: AbortSignal,
): Promise<WebFetchOutcome> {
  const normalizedUrl = String(url || '').trim();
  const cacheKey = cacheKeyForFetch(normalizedUrl);
  const cached = getCacheValue(fetchCache, cacheKey);
  if (cached) {
    return { ...cached, cacheHit: true } as WebFetchOutcome;
  }

  let currentUrl = normalizedUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetch(currentUrl, {
      headers: { 'User-Agent': WEB_USER_AGENT },
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        const outcome: WebFetchHttpError = {
          kind: 'http_error',
          requestedUrl: normalizedUrl,
          finalUrl: currentUrl,
          statusCode: response.status,
          contentType: response.headers.get('content-type') || 'unknown',
          bodyPreview: 'Редирект без заголовка location.',
          cacheHit: false,
        };
        setCacheValue(fetchCache, cacheKey, withoutCacheFlag(outcome), FETCH_CACHE_TTL_MS, MAX_FETCH_CACHE_ENTRIES);
        return outcome;
      }

      const redirectUrl = new URL(location, currentUrl).toString();
      if (!isSafeSameHostRedirect(currentUrl, redirectUrl)) {
        const outcome: WebFetchRedirect = {
          kind: 'redirect',
          requestedUrl: normalizedUrl,
          redirectUrl,
          statusCode: response.status,
          cacheHit: false,
        };
        setCacheValue(fetchCache, cacheKey, withoutCacheFlag(outcome), FETCH_CACHE_TTL_MS, MAX_FETCH_CACHE_ENTRIES);
        return outcome;
      }

      currentUrl = redirectUrl;
      continue;
    }

    const contentType = response.headers.get('content-type') || 'unknown';
    if (!response.ok) {
      const bodyPreview = isTextLikeContentType(contentType)
        ? truncate(await response.text(), 500)
        : '';
      const outcome: WebFetchHttpError = {
        kind: 'http_error',
        requestedUrl: normalizedUrl,
        finalUrl: currentUrl,
        statusCode: response.status,
        contentType,
        ...(bodyPreview ? { bodyPreview } : {}),
        cacheHit: false,
      };
      setCacheValue(fetchCache, cacheKey, withoutCacheFlag(outcome), FETCH_CACHE_TTL_MS, MAX_FETCH_CACHE_ENTRIES);
      return outcome;
    }

    if (isTextLikeContentType(contentType)) {
      const bodyText = await response.text();
      const bytes = Buffer.byteLength(bodyText);
      const outcome: WebFetchSuccess = {
        kind: 'success',
        requestedUrl: normalizedUrl,
        finalUrl: currentUrl,
        statusCode: response.status,
        contentType,
        bytes,
        ...(contentType.toLowerCase().includes('json')
          ? { jsonText: bodyText }
          : { textContent: bodyText }),
        isBinary: false,
        cacheHit: false,
        redirected: currentUrl !== normalizedUrl,
      };
      setCacheValue(fetchCache, cacheKey, withoutCacheFlag(outcome), FETCH_CACHE_TTL_MS, MAX_FETCH_CACHE_ENTRIES);
      return outcome;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const outcome: WebFetchSuccess = {
      kind: 'success',
      requestedUrl: normalizedUrl,
      finalUrl: currentUrl,
      statusCode: response.status,
      contentType,
      bytes: buffer.byteLength,
      isBinary: true,
      cacheHit: false,
      redirected: currentUrl !== normalizedUrl,
    };
    setCacheValue(fetchCache, cacheKey, withoutCacheFlag(outcome), FETCH_CACHE_TTL_MS, MAX_FETCH_CACHE_ENTRIES);
    return outcome;
  }

  throw new Error('Слишком много редиректов при загрузке URL.');
}
