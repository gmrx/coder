import type { AssistantConfig } from '../../core/types';

export type WebTrustKind = 'preapproved' | 'trusted' | 'blocked' | 'restricted' | 'external';

export interface WebTrustDecision {
  kind: WebTrustKind;
  host: string;
  reason: string;
  matchedRule?: string;
}

const PREAPPROVED_WEB_FETCH_ENTRIES = [
  'platform.openai.com',
  'help.openai.com',
  'openai.com',
  'platform.claude.com',
  'code.claude.com',
  'modelcontextprotocol.io',
  'agentskills.io',
  'github.com/anthropics',
  'docs.python.org',
  'en.cppreference.com',
  'docs.oracle.com',
  'learn.microsoft.com',
  'developer.mozilla.org',
  'go.dev',
  'pkg.go.dev',
  'www.php.net',
  'docs.swift.org',
  'kotlinlang.org',
  'ruby-doc.org',
  'doc.rust-lang.org',
  'www.typescriptlang.org',
  'react.dev',
  'angular.io',
  'vuejs.org',
  'nextjs.org',
  'expressjs.com',
  'nodejs.org',
  'bun.sh',
  'getbootstrap.com',
  'tailwindcss.com',
  'redux.js.org',
  'webpack.js.org',
  'jestjs.io',
  'reactrouter.com',
  'docs.djangoproject.com',
  'flask.palletsprojects.com',
  'fastapi.tiangolo.com',
  'pandas.pydata.org',
  'numpy.org',
  'www.tensorflow.org',
  'pytorch.org',
  'scikit-learn.org',
  'matplotlib.org',
  'requests.readthedocs.io',
  'jupyter.org',
  'laravel.com',
  'symfony.com',
  'wordpress.org',
  'docs.spring.io',
  'hibernate.org',
  'gradle.org',
  'maven.apache.org',
  'asp.net',
  'dotnet.microsoft.com',
  'nuget.org',
  'reactnative.dev',
  'docs.flutter.dev',
  'developer.apple.com',
  'developer.android.com',
  'keras.io',
  'spark.apache.org',
  'huggingface.co',
  'www.kaggle.com',
  'www.mongodb.com',
  'redis.io',
  'www.postgresql.org',
  'dev.mysql.com',
  'www.sqlite.org',
  'graphql.org',
  'prisma.io',
  'docs.aws.amazon.com',
  'cloud.google.com',
  'kubernetes.io',
  'www.docker.com',
  'www.terraform.io',
  'www.ansible.com',
  'vercel.com/docs',
  'docs.netlify.com',
  'devcenter.heroku.com',
  'cypress.io',
  'selenium.dev',
  'docs.unity.com',
  'docs.unrealengine.com',
  'git-scm.com',
  'nginx.org',
  'httpd.apache.org',
] as const;

const PREAPPROVED_HOSTS = new Set<string>();
const PREAPPROVED_PATH_PREFIXES = new Map<string, string[]>();

for (const entry of PREAPPROVED_WEB_FETCH_ENTRIES) {
  const slashIndex = entry.indexOf('/');
  if (slashIndex === -1) {
    PREAPPROVED_HOSTS.add(entry);
    continue;
  }
  const host = entry.slice(0, slashIndex);
  const prefix = entry.slice(slashIndex);
  const existing = PREAPPROVED_PATH_PREFIXES.get(host);
  if (existing) existing.push(prefix);
  else PREAPPROVED_PATH_PREFIXES.set(host, [prefix]);
}

function looksLikeIp(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function isPrivateIpv4(host: string): boolean {
  if (!looksLikeIp(host)) return false;
  const parts = host.split('.').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 0) return true;
  return false;
}

function normalizeHost(rawValue: unknown): string {
  return String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function isRestrictedHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home.arpa') ||
    normalized.endsWith('.localdomain') ||
    isPrivateIpv4(normalized)
  );
}

export function normalizeWebHostList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const host = normalizeHost(item);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    normalized.push(host);
  }
  return normalized;
}

export function updateWebHostList(
  current: string[] | undefined,
  host: string,
  mode: 'add' | 'remove',
): string[] {
  const normalizedHost = normalizeHost(host);
  const next = normalizeWebHostList(current || []);
  if (!normalizedHost) return next;
  if (mode === 'remove') {
    return next.filter((item) => item !== normalizedHost);
  }
  return next.includes(normalizedHost) ? next : [...next, normalizedHost];
}

export function isPreapprovedWebHost(hostname: string, pathname = '/'): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (PREAPPROVED_HOSTS.has(host)) return true;
  const prefixes = PREAPPROVED_PATH_PREFIXES.get(host);
  if (!prefixes) return false;
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function getWebFetchTrustDecision(
  url: string,
  config: Pick<AssistantConfig, 'webTrustedHosts' | 'webBlockedHosts'>,
): WebTrustDecision {
  try {
    const parsed = new URL(String(url || '').trim());
    if (!/^https?:$/i.test(parsed.protocol)) {
      return {
        kind: 'restricted',
        host: normalizeHost(parsed.hostname),
        reason: 'Поддерживаются только http:// и https:// URL.',
      };
    }
    if (parsed.username || parsed.password) {
      return {
        kind: 'restricted',
        host: normalizeHost(parsed.hostname),
        reason: 'URL с логином или паролем в адресе заблокированы.',
      };
    }

    const host = normalizeHost(parsed.hostname);
    if (isRestrictedHost(host)) {
      return {
        kind: 'restricted',
        host,
        reason: 'Локальные, внутренние и приватные адреса через web_fetch запрещены.',
      };
    }

    const blockedHosts = normalizeWebHostList(config.webBlockedHosts || []);
    const blockedRule = blockedHosts.find((rule) => matchesDomain(host, rule));
    if (blockedRule) {
      return {
        kind: 'blocked',
        host,
        matchedRule: blockedRule,
        reason: `Хост ${host} находится в пользовательском блок-листе web_fetch.`,
      };
    }

    if (isPreapprovedWebHost(host, parsed.pathname || '/')) {
      return {
        kind: 'preapproved',
        host,
        reason: 'Домен входит в список доверенных documentation/code hosts.',
      };
    }

    const trustedHosts = normalizeWebHostList(config.webTrustedHosts || []);
    const trustedRule = trustedHosts.find((rule) => matchesDomain(host, rule));
    if (trustedRule) {
      return {
        kind: 'trusted',
        host,
        matchedRule: trustedRule,
        reason: `Хост ${host} уже разрешён в настройках web_fetch.`,
      };
    }

    return {
      kind: 'external',
      host,
      reason: `Хост ${host} не входит в доверенные web-fetch домены.`,
    };
  } catch {
    return {
      kind: 'restricted',
      host: '',
      reason: 'URL не удалось разобрать.',
    };
  }
}

export function shouldAutoFetchGroundingUrl(
  url: string,
  config: Pick<AssistantConfig, 'webTrustedHosts' | 'webBlockedHosts'>,
): boolean {
  const decision = getWebFetchTrustDecision(url, config);
  return decision.kind === 'preapproved' || decision.kind === 'trusted';
}
