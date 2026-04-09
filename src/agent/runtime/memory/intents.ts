function normalizeQuery(query: string): string {
  return String(query || '').toLowerCase();
}

export function isBroadStudyQuery(query: string): boolean {
  const value = normalizeQuery(query);
  return /изучи|обзор|обследуй|проанализируй|рассмотри|comprehensive|deep|analy[sz]e|review|explore|audit|архитектур|риски|уязвимост|vulnerabilit|сделай.*обзор|проведи.*аудит/.test(value);
}

export function isMutationIntentQuery(query: string): boolean {
  const value = normalizeQuery(query);
  return /исправ|почини|фикс|fix\b|bugfix|отредакт|измени|замени|перепиши|обнови|добавь|реализуй|implement|создай|удали|delete|remove|rename|переимен|refactor|рефактор|внеси.*измен|сделай.*правк|apply.*change|modify|edit\b|change\b/.test(value);
}

export function isPlanningIntentQuery(query: string): boolean {
  const value = normalizeQuery(query);
  return /составь.*план|нужен.*план|спланируй|продумай.*план|plan\b|planning\b|implementation plan|design approach|сначала.*план|без реализации.*план|только.*план/.test(value);
}

export function isMcpTopicContext(text: string): boolean {
  const value = normalizeQuery(text);
  return /(hubthe|mcp\b|mcp_|mcp-|mcp tool|mcp tools|mcp сервер|mcp вызов|remote tool|server=|current_project|project_guid|list_projects|list_my_tasks|list_sprints|search_tasks|projects|tasks|participants|участник|участники|исполнител|проекты|задач|спринт|guid=|email=|name=)/.test(value);
}

export function isCorrectionQuery(query: string): boolean {
  const value = normalizeQuery(query);
  return /(неправда|ошиб|не так|не тот|не та|ты не использовал|ты не вызвал|это неверно|в .* нет|нет\b|не один|не одна|неправильн)/.test(value);
}

export function isMcpCatalogQuery(query: string): boolean {
  const value = normalizeQuery(query);
  return /(какие mcp|какие есть mcp|список mcp|какие mcp tools|список mcp tools|какие серверы|какие mcp серверы|доступные mcp|проверь mcp|работу mcp|mcp hub|mcp hubthe|какие утилиты mcp|какие tools mcp|list mcp|mcp resources|mcp tools)/.test(value);
}

export function isMcpFreshnessSensitiveQuery(query: string, context = ''): boolean {
  const value = normalizeQuery(query);
  if (!value.trim()) return false;
  if (isMcpCatalogQuery(value)) return true;
  if (/(hubthe|mcp\b|connector|коннектор|remote tool|remote action)/.test(value)) return true;

  const liveEntityRequest = /(кто я|кто это|имя какое|мой email|мой guid|какие у меня проекты|какие проекты|в каких проектах|мои проекты|какие у меня задачи|мои задачи|найди.*задач|найди.*проект|где есть|есть ли|участник|участники|исполнител|проекты|задачи|спринт|who am i|whoami|projects\b|tasks\b|participants\b|members\b|member\b|project\b)/.test(value);
  if (liveEntityRequest && isMcpTopicContext(context)) return true;
  if (isCorrectionQuery(value) && isMcpTopicContext(context)) return true;
  return false;
}
