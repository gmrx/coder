import { resolveCanonicalToolName } from './toolAliases';
import { TOOL_DEFINITIONS, type ToolDefinition } from './toolDefinitions';
import { getToolCapabilityNotes } from './toolCapabilities';
import type { StructuredPresentationSection } from '../presentationItems';
import {
  buildToolPromptFit,
  getToolPromptAvoidWhen,
  getToolPromptGuidance,
  getToolPromptGroup,
  getToolPromptWhenToUse,
} from './toolPromptPresentation';

export interface ToolSearchMatch {
  definition: ToolDefinition;
  score: number;
  reasons: string[];
}

export interface ToolSearchRecommendation {
  toolName: string;
  nextStep?: string;
}

export interface ToolSearchPresentation {
  query: string;
  matchCount: number;
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  recommendation?: ToolSearchRecommendation;
  sections?: StructuredPresentationSection[];
  matches?: Array<{
    toolName: string;
    summary: string;
    reasons?: string[];
  }>;
  tools: string[];
}

export function listPrimaryToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((definition) => getToolPromptGroup(definition) === 'primary');
}

export function listSpecializedToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((definition) => getToolPromptGroup(definition) === 'specialized');
}

export function searchToolDefinitions(query: string, limit = 8): ToolSearchMatch[] {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const { requiredTerms, scoringTerms } = parseQueryTerms(normalizedQuery);
  const terms = scoringTerms;
  const normalizedLimit = Math.max(1, limit);
  if (!normalizedQuery || terms.length === 0) return [];

  const selected = searchSelectedTools(normalizedQuery);
  if (selected.length > 0) {
    return selected.slice(0, normalizedLimit);
  }

  const specializedMatches = rankDefinitions(listSpecializedToolDefinitions(), normalizedQuery, requiredTerms, terms);
  if (specializedMatches.length > 0) {
    const seen = new Set(specializedMatches.map((match) => match.definition.name));
    const fallback = rankDefinitions(
      TOOL_DEFINITIONS.filter((definition) => !seen.has(definition.name)),
      normalizedQuery,
      requiredTerms,
      terms,
    );
    return rankCombinedMatchesWithSpecializedBias([...specializedMatches, ...fallback], normalizedLimit);
  }

  return rankDefinitions(TOOL_DEFINITIONS, normalizedQuery, requiredTerms, terms).slice(0, normalizedLimit);
}

export function buildToolSearchResponse(query: string, limit = 8): string {
  return buildToolSearchResult(query, limit).content;
}

export function buildToolSearchResult(
  query: string,
  limit = 8,
): {
  content: string;
  presentation: ToolSearchPresentation;
  recommendation: ToolSearchRecommendation | null;
} {
  const matches = searchToolDefinitions(query, limit);
  if (matches.length === 0) {
    const content = `tool_search "${query}"\n\nПодходящих инструментов не найдено. Попробуй сформулировать intent короче: например "поиск по смыслу", "точечная правка файла", "независимая проверка изменений".`;
    return {
      content,
      presentation: {
        query,
        matchCount: 0,
        summary: 'Каталог не помог',
        detail: 'Подходящие инструменты не найдены',
        preview: content,
        tools: [],
      },
      recommendation: null,
    };
  }

  const selectedMode = String(query || '').trim().toLowerCase().startsWith('select:');
  const specializedOnly = matches.every((match) => getToolPromptGroup(match.definition) === 'specialized');
  const lines = [
    `tool_search "${query}"`,
    '',
    selectedMode
      ? `Выбрал ${matches.length} инструмент(ов) по явному select-запросу:`
      : specializedOnly
        ? `Подобрал ${matches.length} специализированных инструмент(ов):`
        : `Подобрал ${matches.length} инструмент(ов):`,
    '',
  ];
  lines.push(...buildToolSearchRecommendationBlock(matches, query, { selectedMode }));
  if (!selectedMode) {
    lines.push('После tool_search не повторяй поиск без новой информации: обычно следующий ход — вызов рекомендованного инструмента.');
    lines.push('');
  }
  for (const [index, match] of matches.entries()) {
    const definition = match.definition;
    const requiredArgs = definition.args?.filter((arg) => arg.required).map((arg) => arg.name) || [];
    const aliases = definition.aliases?.slice(0, 3).join(', ');
    const capabilityNotes = getToolCapabilityNotes(definition.name);
    const alternativeHint = buildAlternativeHint(matches, index);

    lines.push(`${index + 1}. ${definition.name} — ${definition.summary}`);
    if (match.reasons.length > 0) {
      lines.push(`   Почему подходит: ${match.reasons.join('; ')}`);
    }
    if (capabilityNotes.length > 0) {
      lines.push(`   Свойства: ${capabilityNotes.join('; ')}`);
    }
    if (requiredArgs.length > 0) {
      lines.push(`   Обязательные args: ${requiredArgs.join(', ')}`);
    }
    const fit = buildToolPromptFit(definition);
    if (fit) {
      lines.push(`   Когда применять: ${fit}`);
    }
    const avoidWhen = getToolPromptAvoidWhen(definition);
    if (avoidWhen.length > 0) {
      lines.push(`   Когда не применять: ${avoidWhen.slice(0, 2).join('; ')}`);
    }
    const guidance = getToolPromptGuidance(definition);
    if (guidance) {
      lines.push(`   Подсказка: ${guidance}`);
    }
    if (alternativeHint) {
      lines.push(`   Не путай с: ${alternativeHint}`);
    }
    const template = buildToolCallTemplate(definition, query);
    if (template) {
      lines.push(`   Шаблон вызова: ${template}`);
    }
    if (aliases) {
      lines.push(`   Алиасы: ${aliases}`);
    }
    lines.push('');
  }

  const content = lines.join('\n').trim();
  const recommendation = extractToolSearchRecommendation(content);
  const detailParts = [
    `${matches.length} инструментов`,
    specializedOnly ? 'специализированная выдача' : 'смешанная выдача',
    selectedMode ? 'select-режим' : '',
  ].filter(Boolean);
  const preview = matches
    .slice(0, 4)
    .map((match) => `- ${match.definition.name} — ${match.definition.summary}`)
    .join('\n');

  return {
    content,
    presentation: {
      query,
      matchCount: matches.length,
      summary: 'Подобрал инструменты',
      detail: detailParts.join(' • '),
      ...(preview ? { preview } : {}),
      ...(recommendation?.nextStep ? { nextStep: recommendation.nextStep } : {}),
      ...(recommendation ? { recommendation } : {}),
      sections: matches.length > 0
        ? [{
          title: 'Инструменты',
          items: matches.slice(0, 6).map((match) => ({
            title: match.definition.name,
            subtitle: match.definition.summary,
            meta: match.reasons.slice(0, 2).join(' • '),
          })),
        }]
        : [],
      matches: matches.slice(0, 6).map((match) => ({
        toolName: match.definition.name,
        summary: match.definition.summary,
        ...(match.reasons.length > 0 ? { reasons: match.reasons.slice(0, 2) } : {}),
      })),
      tools: matches.map((match) => match.definition.name),
    },
    recommendation,
  };
}

export function extractToolSearchRecommendation(content: string): ToolSearchRecommendation | null {
  const value = String(content || '');
  const toolMatch = value.match(/^(?:Рекомендуемый|Явно выбранный) инструмент:\s*([a-z0-9_]+)/im);
  if (!toolMatch) return null;

  const nextStepMatch = value.match(/^Следующий шаг:\s*(.+)$/im);
  return {
    toolName: toolMatch[1],
    nextStep: nextStepMatch?.[1]?.trim() || undefined,
  };
}

function buildToolSearchRecommendationBlock(
  matches: ToolSearchMatch[],
  query: string,
  options: { selectedMode?: boolean } = {},
): string[] {
  const primary = matches[0];
  if (!primary) return [];

  const lines: string[] = [
    options.selectedMode
      ? `Явно выбранный инструмент: ${primary.definition.name}`
      : `Рекомендуемый инструмент: ${primary.definition.name}`,
  ];

  const recommendationNote = buildRecommendationNote(matches);
  if (recommendationNote) {
    lines.push(
      options.selectedMode
        ? `Почему это хороший выбор: ${recommendationNote}`
        : `Почему начать с него: ${recommendationNote}`,
    );
  }

  const template = buildToolCallTemplate(primary.definition, query);
  if (template) {
    lines.push(`Следующий шаг: ${template}`);
  }

  const route = buildUtilityRoute(primary.definition, query);
  if (route.length > 0) {
    lines.push('Короткий маршрут:');
    for (const step of route) {
      lines.push(`- ${step}`);
    }
  }

  const second = matches[1];
  if (second) {
    const secondFit = buildToolPromptFit(second.definition, 1);
    lines.push(
      secondFit
        ? `Ближайшая альтернатива: ${second.definition.name} — лучше, если ${secondFit}`
        : `Ближайшая альтернатива: ${second.definition.name} — ${second.definition.summary}`,
    );
  }

  lines.push('');
  return lines;
}

function searchSelectedTools(query: string): ToolSearchMatch[] {
  if (!query.startsWith('select:')) return [];
  const raw = query.slice('select:'.length);
  const tokens = [...new Set(
    raw
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean),
  )];

  const matches: ToolSearchMatch[] = [];
  for (const token of tokens) {
    const canonical = resolveCanonicalToolName(token);
    const definition = TOOL_DEFINITIONS.find((item) => item.name === canonical);
    if (!definition) continue;
    matches.push({
      definition,
      score: 10_000 - matches.length,
      reasons: ['выбран явно через select'],
    });
  }
  return matches;
}

function rankDefinitions(
  definitions: ToolDefinition[],
  normalizedQuery: string,
  requiredTerms: string[],
  terms: string[],
): ToolSearchMatch[] {
  return definitions
    .map((definition) => rankToolDefinition(definition, normalizedQuery, requiredTerms, terms))
    .filter((match): match is ToolSearchMatch => !!match)
    .sort((left, right) => right.score - left.score || left.definition.name.localeCompare(right.definition.name));
}

function rankToolDefinition(
  definition: ToolDefinition,
  normalizedQuery: string,
  requiredTerms: string[],
  terms: string[],
): ToolSearchMatch | null {
  let score = 0;
  const reasons = new Set<string>();
  const name = definition.name.toLowerCase();
  const aliases = (definition.aliases || []).map((alias) => alias.toLowerCase());
  const userFacingName = definition.capabilities?.userFacingName?.toLowerCase() || '';
  const summary = definition.summary.toLowerCase();
  const details = (definition.details || []).join(' ').toLowerCase();
  const hints = (definition.searchHints || []).join(' ').toLowerCase();
  const whenToUse = getToolPromptWhenToUse(definition).join(' ').toLowerCase();
  const avoidWhen = getToolPromptAvoidWhen(definition).join(' ').toLowerCase();
  const guidance = (getToolPromptGuidance(definition) || '').toLowerCase();
  const args = (definition.args || []).map((arg) => `${arg.name} ${arg.description}`.toLowerCase()).join(' ');
  const searchableText = [name, userFacingName, summary, details, hints, whenToUse, avoidWhen, guidance, args, ...aliases].join(' ');

  if (requiredTerms.length > 0) {
    const matchesAllRequired = requiredTerms.every((term) => searchableText.includes(term));
    if (!matchesAllRequired) return null;
    reasons.add('совпадает по обязательным терминам');
  }

  if (name === normalizedQuery) {
    score += 120;
    reasons.add('точное имя инструмента');
  }
  if (aliases.includes(normalizedQuery)) {
    score += 90;
    reasons.add('точный алиас');
  }
  if (userFacingName && userFacingName === normalizedQuery) {
    score += 80;
    reasons.add('точное отображаемое имя');
  }

  for (const term of terms) {
    if (name === term) {
      score += 45;
      reasons.add('совпадение по имени');
      continue;
    }
    if (name.includes(term)) {
      score += 22;
      reasons.add('имя инструмента');
    }
    if (aliases.some((alias) => alias.includes(term))) {
      score += 18;
      reasons.add('алиас');
    }
    if (userFacingName.includes(term)) {
      score += 18;
      reasons.add('отображаемое имя');
    }
    if (summary.includes(term)) {
      score += 10;
      reasons.add('краткое описание');
    }
    if (hints.includes(term)) {
      score += 12;
      reasons.add('сценарий применения');
    }
    if (whenToUse.includes(term)) {
      score += 14;
      reasons.add('когда применять');
    }
    if (details.includes(term)) {
      score += 6;
      reasons.add('детали использования');
    }
    if (guidance.includes(term)) {
      score += 5;
      reasons.add('подсказка по использованию');
    }
    if (args.includes(term)) {
      score += 6;
      reasons.add('аргументы');
    }
  }

  if (score === 0) return null;

  if (
    definition.name === 'list_mcp_resources' &&
    /(ресурс|resource|uri|blob|mime|содержим|content)/.test(normalizedQuery) &&
    !/(tool|schema|утилит|инструмент|command)/.test(normalizedQuery)
  ) {
    score += 18;
    reasons.add('лучший первый шаг для выбора MCP URI');
  }

  if (
    definition.name === 'read_mcp_resource' &&
    /(uri|read|чита|содержим|content|body|blob)/.test(normalizedQuery)
  ) {
    score += 18;
    reasons.add('запрос похож на чтение конкретного MCP ресурса');
  }

  if (
    definition.name === 'list_mcp_tools' &&
    /(mcp|connector|коннектор|remote tool|remote action|tool schema|tool list|какие mcp|какие коннекторы|какие серверы|какие утилиты|список mcp)/.test(normalizedQuery) &&
    !/(ресурс|resource|uri|blob|mime|содержим|content)/.test(normalizedQuery) &&
    !/(oauth|auth|401|reauth|authorize|authorization)/.test(normalizedQuery)
  ) {
    score += 18;
    reasons.add('лучший первый шаг для выбора MCP tool');
  }

  if (
    definition.name === 'mcp_tool' &&
    /(mcp tool|connector tool|remote tool|call connector|вызвать mcp|вызвать коннектор)/.test(normalizedQuery)
  ) {
    score += 18;
    reasons.add('запрос похож на прямой вызов MCP tool');
  }

  if (
    definition.name === 'mcp_auth' &&
    /(oauth|auth|401|reauth|authorize|authorization|аутентиф|авторизац)/.test(normalizedQuery)
  ) {
    score += 20;
    reasons.add('запрос похож на MCP аутентификацию');
  }

  if (
    definition.name === 'skill' &&
    /(^[$/])|(skill|skills|навык|навыки|скилл|скиллы|slash command|slash-команд)/.test(normalizedQuery)
  ) {
    score += 18;
    reasons.add('запрос похож на вызов навыка');
  }

  if (
    definition.name === 'task_list' &&
    /(task|задач|background|фон|jobs|джоб|выполняетс|running|активн)/.test(normalizedQuery) &&
    !/(mcp|hubthe|connector|коннектор|remote tool|remote action)/.test(normalizedQuery)
  ) {
    score += 18;
    reasons.add('запрос похож на обзор task stack');
  }

  if (
    definition.name === 'task_get' &&
    /(task status|статус задачи|stdout|stderr|лог задачи|вывод задачи|task id|конкретн.*task)/.test(normalizedQuery)
  ) {
    score += 18;
    reasons.add('запрос похож на просмотр конкретной задачи');
  }

  if (
    definition.name === 'task_stop' &&
    /(stop task|остановить задачу|cancel task|kill task|остановить фон|остановить job|прервать background)/.test(normalizedQuery)
  ) {
    score += 18;
    reasons.add('запрос похож на остановку background task');
  }

  if (
    definition.name === 'shell' &&
    /(watch|dev server|долг.*команд|длинн.*команд|в фоне|background build|background shell|package vsix|собрать vsix|npm run package)/.test(normalizedQuery)
  ) {
    score += 14;
    reasons.add('запрос похож на shell-команду, которую удобно запустить в фоне');
  }

  if (getToolPromptGroup(definition) === 'primary') {
    score += 2;
  }
  return {
    definition,
    score,
    reasons: [...reasons].slice(0, 3),
  };
}

function buildToolCallTemplate(definition: ToolDefinition, query = ''): string | null {
  const args = definition.args || [];
  if (args.length === 0) {
    return `{"tool":"${definition.name}"}`;
  }

  const suggestedArgs = buildSuggestedArgs(definition, query);
  if (suggestedArgs) {
    return JSON.stringify({ tool: definition.name, args: suggestedArgs });
  }

  const requiredArgs = args.filter((arg) => arg.required);
  const renderedArgs = requiredArgs.length > 0 ? requiredArgs : args.slice(0, Math.min(2, args.length));
  const argsPayload = renderedArgs
    .map((arg) => `"${arg.name}":"<${escapeTemplateText(arg.description)}>"`)
    .join(', ');

  return `{"tool":"${definition.name}","args":{${argsPayload}}}`;
}

function buildAlternativeHint(matches: ToolSearchMatch[], currentIndex: number): string | null {
  const current = matches[currentIndex];
  if (!current) return null;

  const alternatives = matches
    .filter((match, index) => index !== currentIndex && match.definition.name !== current.definition.name)
    .slice(0, 2)
    .map((match) => {
      const fit = buildToolPromptFit(match.definition, 1);
      if (fit) {
        return `${match.definition.name} — лучше, если ${fit}`;
      }
      return `${match.definition.name} — ${match.definition.summary}`;
    });

  if (alternatives.length === 0) return null;
  return alternatives.join(' | ');
}

function buildRecommendationNote(matches: ToolSearchMatch[]): string | null {
  const primary = matches[0];
  if (!primary) return null;

  const reasons = primary.reasons.slice(0, 2);
  const second = matches[1];
  if (!second) {
    return reasons.length > 0
      ? `это единственный явный матч по запросу (${reasons.join('; ')})`
      : 'это единственный явный матч по запросу';
  }

  const gap = primary.score - second.score;
  if (gap >= 20) {
    return reasons.length > 0
      ? `он заметно сильнее остальных (${reasons.join('; ')})`
      : 'он заметно сильнее остальных';
  }

  return reasons.length > 0
    ? `это лучший старт, но рядом есть близкие альтернативы (${reasons.join('; ')})`
    : 'это лучший старт, но рядом есть близкие альтернативы';
}

function buildUtilityRoute(definition: ToolDefinition, query: string): string[] {
  const normalized = String(query || '').toLowerCase();
  const tool = definition.name;

  if (tool === 'scan_structure' || tool === 'detect_stack') {
    return [
      `начни с ${tool === 'detect_stack' ? '{"tool":"detect_stack","args":{"outputMode":"summary"}}' : '{"tool":"scan_structure","args":{"outputMode":"overview"}}'}`,
      'затем сузь область через list_files с outputMode="dirs" или read_file по важному файлу',
      'после выбора файла переходи к extract_symbols, dependencies или lsp_inspect',
    ];
  }

  if (tool === 'list_files') {
    return [
      'для большой директории начни с outputMode="dirs"',
      'после выбора папки переходи к tree или flat',
      'когда файл уже выбран, открывай его через read_file с outputMode="outline"',
    ];
  }

  if (tool === 'glob' || tool === 'find_files') {
    return [
      `для широкого поиска начни с ${JSON.stringify({ tool, args: { ...(tool === 'glob' ? { glob_pattern: '<glob-шаблон>' } : { pattern: '<имя файла или паттерн>' }), outputMode: 'grouped', limit: 40 } })}`,
      'потом открой нужную директорию через list_files',
      'после выбора файла переходи к read_file или lsp_inspect',
    ];
  }

  if (tool === 'grep') {
    return [
      `сначала полезно получить список файлов: ${JSON.stringify({ tool: 'grep', args: { pattern: '<строка или regex>', outputMode: 'files_with_matches', limit: 40 } })}`,
      'потом открой участок через read_file_range',
      'если нужен точный символ или call graph, переходи к lsp_inspect',
    ];
  }

  if (tool === 'read_file') {
    if (/(package|tsconfig|pyproject|cargo|go\\.mod|manifest|конфиг)/.test(normalized)) {
      return [
        'для config/manifest начни с outputMode="manifest"',
        'если нужно глубже, переключайся на outputMode="outline" или read_file_range',
        'для связей по коду затем используй dependencies, extract_symbols или lsp_inspect',
      ];
    }

    return [
      'для большого файла начни с outputMode="outline"',
      'потом переходи к read_file_range по нужному участку',
      'если уже известен символ или позиция, подключай lsp_inspect',
    ];
  }

  if (tool === 'extract_symbols') {
    return [
      `сначала получи overview: ${JSON.stringify({ tool: 'extract_symbols', args: { path: '<путь к файлу>', outputMode: 'summary', limit: 20 } })}`,
      'если нужно понять shape файла, затем сгруппируй символы по видам через outputMode="kinds"',
      'после этого открывай участок через read_file_range или переходи к lsp_inspect',
    ];
  }

  if (tool === 'dependencies') {
    return [
      `сначала возьми overview: ${JSON.stringify({ tool: 'dependencies', args: { paths: ['<путь к файлу или manifest>'], outputMode: 'summary', limit: 20 } })}`,
      'для package-манифестов затем переходи к manifests или packages, а для кода — к files или graph',
      'после этого открывай конкретные файлы через read_file, extract_symbols или lsp_inspect',
    ];
  }

  if (tool === 'lsp_inspect') {
    return [
      'если знаешь имя символа, начни с workspace_symbols',
      'если знаешь точку в файле, переходи к definition/references/hover',
      'для понимания вызовов используй incoming_calls или outgoing_calls',
    ];
  }

  if (tool === 'read_lints' || tool === 'get_diagnostics') {
    return [
      'сначала возьми summary или files',
      'для деталей переходи к items',
      'после выбора проблемы открывай участок через read_file_range',
    ];
  }

  if (tool === 'web_search') {
    return [
      `для первого прохода начни с ${JSON.stringify({ tool: 'web_search', args: { query: '<актуальный вопрос>', outputMode: 'summary', limit: 5 } })}`,
      'если нужны только ссылки и домены, переключайся на outputMode="sources"',
      `если нужен уже grounded answer по найденным источникам, переходи к ${JSON.stringify({ tool: 'web_search', args: { query: '<актуальный вопрос>', outputMode: 'answer', prompt: '<какой ответ собрать>', fetchTopResults: 3 } })}`,
      'когда уже выбран конкретный URL, переходи к web_fetch',
    ];
  }

  if (tool === 'web_fetch') {
    return [
      `для first-pass используй ${JSON.stringify({ tool: 'web_fetch', args: { url: '<полный URL>', outputMode: 'summary' } })}`,
      `если нужно вытащить конкретный ответ из страницы, используй ${JSON.stringify({ tool: 'web_fetch', args: { url: '<полный URL>', outputMode: 'summary', prompt: '<что нужно извлечь>' } })}`,
      'если нужен полный текст или JSON, переключайся на outputMode="content"',
      'для бинарных или подозрительных ресурсов сначала смотри metadata',
      'для доверенных documentation/code hosts загрузка обычно идёт сразу; внешний неизвестный домен может запросить подтверждение',
    ];
  }

  if (tool === 'list_mcp_resources') {
    return [
      `сначала получи список ресурсов: ${JSON.stringify({ tool: 'list_mcp_resources', args: { server: '<имя MCP сервера>' } })}`,
      'после выбора URI переходи к read_mcp_resource',
      'если сервер не выбран, сначала посмотри общий список, затем сузься по server',
    ];
  }

  if (tool === 'read_mcp_resource') {
    return [
      `если URI уже известен, читай ресурс напрямую: ${JSON.stringify({ tool: 'read_mcp_resource', args: { server: '<имя MCP сервера>', uri: '<resource URI>' } })}`,
      'если URI ещё неясен, сначала вернись к list_mcp_resources',
      'для бинарных ресурсов ожидай путь к сохранённому файлу вместо текстового тела',
    ];
  }

  if (tool === 'list_mcp_tools') {
    return [
      `сначала получи список remote tools: ${JSON.stringify({ tool: 'list_mcp_tools', args: { server: '<имя MCP сервера>' } })}`,
      'после выбора tool переходи к mcp_tool с server + name + arguments',
      'если сервер отвечает 401, сначала выполни mcp_auth',
    ];
  }

  if (tool === 'mcp_tool') {
    return [
      `если tool уже известен, вызывай так: ${JSON.stringify({ tool: 'mcp_tool', args: { server: '<имя MCP сервера>', name: '<имя MCP tool>', arguments: { key: '<value>' } } })}`,
      'если tool name или schema неясны, сначала вернись к list_mcp_tools',
      'если inputSchema у remote tool содержит только command:string, передавай всю CLI-строку целиком в arguments.command и не разделяй её на command + args',
      'если MCP tool вернул schema/deserialize/invalid-argument ошибку, исправь arguments по schema hint из результата, а не перебирай случайные варианты',
      'если MCP сервер требует OAuth, сначала используй mcp_auth',
    ];
  }

  if (tool === 'mcp_auth') {
    return [
      `если сервер требует OAuth, начни так: ${JSON.stringify({ tool: 'mcp_auth', args: { server: '<имя MCP сервера>' } })}`,
      'для повторной авторизации используй force=true',
      'после успеха обычно сразу проверь list_mcp_tools',
    ];
  }

  if (tool === 'enter_worktree') {
    return [
      `когда нужен изолированный git-контекст, начни так: ${JSON.stringify({ tool: 'enter_worktree', args: { name: 'refactor-branch' } })}`,
      'после входа работай обычными read/edit/shell утилитами уже внутри worktree',
      'после завершения не забудь выйти через exit_worktree',
    ];
  }

  if (tool === 'exit_worktree') {
    return [
      `для возврата без удаления используй ${JSON.stringify({ tool: 'exit_worktree', args: { action: 'keep' } })}`,
      `для полного удаления временного дерева используй ${JSON.stringify({ tool: 'exit_worktree', args: { action: 'remove', discard_changes: true } })}`,
      'если в worktree есть незакоммиченные изменения или лишние коммиты, сначала явно подтверди discard_changes=true',
    ];
  }

  if (tool === 'str_replace') {
    return [
      'сначала прочитай файл через read_file с outputMode="outline" или через read_file_range по нужному участку',
      `потом вноси точечную правку: ${JSON.stringify({ tool: 'str_replace', args: { path: '<путь к файлу>', old_string: '<уникальный фрагмент>', new_string: '<новый фрагмент>' } })}`,
      'после правки проверь файл через get_diagnostics или verification_agent, если изменение нетривиальное',
    ];
  }

  if (tool === 'ask_user') {
    return [
      `если без решения пользователя нельзя безопасно продолжать, задай вопрос так: ${JSON.stringify({ tool: 'ask_user', args: { questions: [{ question: 'Какой вариант выбрать?', header: 'Выбор', options: [{ label: 'Минимальный', description: 'Меньше изменений, быстрее внедрить' }, { label: 'Полный', description: 'Чище архитектурно, но больше объём работ' }] }] } })}`,
      'держи вопросы короткими и конкретными, а варианты взаимоисключающими, если не нужен multiSelect',
      'после ответа пользователя сразу переходи к следующему осмысленному действию, а не задавай ещё один уточняющий круг без причины',
    ];
  }

  if (tool === 'skill') {
    return [
      `если имя навыка уже известно, загрузи его так: ${JSON.stringify({ tool: 'skill', args: { name: '<имя навыка>', task: '<что нужно сделать этим навыком>' } })}`,
      'после загрузки навыка не пересказывай его, а продолжай выполнение по его инструкциям',
      'если пользователь назвал навык через $name или /name, это сильный сигнал сначала использовать skill',
    ];
  }

  if (tool === 'task_create') {
    return [
      `если нужно вручную зафиксировать работу в task stack, создай задачу так: ${JSON.stringify({ tool: 'task_create', args: { subject: '<краткий заголовок>', description: '<что нужно сделать>', activeForm: '<что сейчас делается>' } })}`,
      'для длинной shell-команды обычно удобнее не task_create, а shell с run_in_background=true',
      'после создания смотри задачу через task_get или весь stack через task_list',
    ];
  }

  if (tool === 'task_list') {
    return [
      `для активных задач начни с ${JSON.stringify({ tool: 'task_list', args: { status: 'in_progress', limit: 10 } })}`,
      `для всех shell jobs используй ${JSON.stringify({ tool: 'task_list', args: { kind: 'shell', limit: 20 } })}`,
      'после выбора задачи переходи к task_get',
    ];
  }

  if (tool === 'task_get') {
    return [
      `если id уже известен, открой задачу так: ${JSON.stringify({ tool: 'task_get', args: { id: '<task-id>' } })}`,
      'если нужен полный вывод, после task_get открой stdout/stderr через read_file',
      'если задача зависла, переходи к task_stop',
    ];
  }

  if (tool === 'task_update') {
    return [
      `если нужно явно обновить запись, используй ${JSON.stringify({ tool: 'task_update', args: { id: '<task-id>', status: 'completed' } })}`,
      'для простого просмотра task_update не нужен — используй task_get',
      'metadata удобно использовать для небольших служебных полей, а не для хранения вывода команды',
    ];
  }

  if (tool === 'task_stop') {
    return [
      `для обычной остановки используй ${JSON.stringify({ tool: 'task_stop', args: { id: '<task-id>' } })}`,
      `если процесс не реагирует, переходи к ${JSON.stringify({ tool: 'task_stop', args: { id: '<task-id>', force: true } })}`,
      'после остановки проверь финальный статус через task_get',
    ];
  }

  if (tool === 'write_file') {
    return [
      'если файл новый, можно сразу писать его целиком',
      'если файл уже существует, сначала прочитай его через read_file, затем подтверждай полную перезапись',
      'после записи проверь результат через get_diagnostics или read_file',
    ];
  }

  if (tool === 'delete_file') {
    return [
      'сначала убедись, что удаление действительно нужно и файл выбран правильно',
      `затем удаляй: ${JSON.stringify({ tool: 'delete_file', args: { path: '<путь к файлу>' } })}`,
      'если есть сомнения, сначала открой файл через read_file или read_file с outputMode="metadata"',
    ];
  }

  if (tool === 'edit_notebook') {
    return [
      `сначала прочитай notebook: ${JSON.stringify({ tool: 'read_file', args: { path: '<путь к .ipynb>', outputMode: 'head', limit: 120 } })}`,
      `затем точечно измени ячейку: ${JSON.stringify({ tool: 'edit_notebook', args: { target_notebook: '<путь к .ipynb>', cell_idx: 0, old_string: '<старый фрагмент>', new_string: '<новый фрагмент>' } })}`,
      'для новой ячейки используй is_new_cell=true и укажи cell_language',
    ];
  }

  if (tool === 'shell') {
    if (/(git diff|diff изменений|изменения ветки|что изменилось|stat diff)/.test(normalized)) {
      return [
        `для обзора изменений начни с ${JSON.stringify({ tool: 'shell', args: { command: 'git diff --stat' } })}`,
        'если нужен список файлов и статус — переходи к git status --short',
        'если нужно читать конкретный diff подробно, открой файл через read_file или используй git diff по узкому пути',
      ];
    }
    if (/(git log|история коммитов|последние коммиты|коммиты ветки)/.test(normalized)) {
      return [
        `для истории начни с ${JSON.stringify({ tool: 'shell', args: { command: 'git log --oneline -10' } })}`,
        'если нужен конкретный коммит, переходи к git show --stat <sha>',
        'после выбора commit/open file переходи к read_file или verification_agent',
      ];
    }
    if (/(тест|test|проверки)/.test(normalized)) {
      return [
        `для проектных проверок начни с ${JSON.stringify({ tool: 'shell', args: { command: 'npm test' } })}`,
        'если тестовый раннер другой, подставь точную команду проекта',
        `если проверки долгие и их не нужно ждать синхронно, используй ${JSON.stringify({ tool: 'shell', args: { command: 'npm test', run_in_background: true, task_subject: 'Запустить тесты' } })}`,
        'после ошибки переходи к get_diagnostics, read_lints или read_file_range по проблемному файлу',
      ];
    }
    if (/(build|сборк|typecheck|tsc)/.test(normalized)) {
      return [
        `для сборки или typecheck начни с ${JSON.stringify({ tool: 'shell', args: { command: 'npm run build' } })}`,
        'если нужен только typecheck, используй точную команду проекта вроде tsc --noEmit',
        `если сборка долгая, запусти её в фоне: ${JSON.stringify({ tool: 'shell', args: { command: 'npm run build', run_in_background: true, task_subject: 'Собрать проект' } })}`,
        'после ошибки открывай проблемные файлы через get_diagnostics или read_file_range',
      ];
    }
    if (/(lint|линт|eslint|ruff|mypy)/.test(normalized)) {
      return [
        `для quality-check начни с ${JSON.stringify({ tool: 'shell', args: { command: 'npm run lint' } })}`,
        'если нужен конкретный линтер, подставь точную команду проекта',
        `если линтинг долгий, можно вынести его в фон: ${JSON.stringify({ tool: 'shell', args: { command: 'npm run lint', run_in_background: true, task_subject: 'Проверить линтинг' } })}`,
        'после ошибок переходи к get_diagnostics, read_lints или read_file_range',
      ];
    }
    if (/(watch|dev server|serve|дев сервер|долгий процесс|в фоне|background|package|vsix)/.test(normalized)) {
      return [
        `для долгой команды начни с ${JSON.stringify({ tool: 'shell', args: { command: '<долгая команда>', run_in_background: true, task_subject: '<краткий заголовок>' } })}`,
        'затем отслеживай выполнение через task_get или task_list',
        'если процесс больше не нужен, останови его через task_stop',
      ];
    }
    if (/(rg|grep|ripgrep|поиск в терминале)/.test(normalized)) {
      return [
        `для терминального поиска используй ${JSON.stringify({ tool: 'shell', args: { command: "rg '<паттерн>' ." } })}`,
        'если нужен structured code-search, сначала сравни с grep, find_files или glob',
        'после нахождения совпадений открывай файл через read_file_range',
      ];
    }
    return [
      'для проверок предпочитай короткие и точные команды вроде npm test, npm run build, npm run lint, git status',
      `пример: ${JSON.stringify({ tool: 'shell', args: { command: 'npm test' } })}`,
      'если shell нужен только для чтения состояния проекта, держи команду короткой и не заменяй ею специализированные file/code tools без причины',
    ];
  }

  if (tool === 'semantic_search') {
    return [
      `сначала возьми overview: ${JSON.stringify({ tool: 'semantic_search', args: { query: '<вопрос на естественном языке>', outputMode: 'summary', limit: 8 } })}`,
      'затем переключайся на files, чтобы выбрать, что читать дальше, или на chunks для детальных фрагментов',
      'после этого открывай конкретный файл или диапазон через read_file, read_file_range, extract_symbols или lsp_inspect',
    ];
  }

  if (tool === 'find_relevant_files') {
    return [
      `сначала возьми overview: ${JSON.stringify({ tool: 'find_relevant_files', args: { query: '<вопрос на естественном языке>', outputMode: 'summary', limit: 8 } })}`,
      'затем переходи к files для shortlist или к snippets, чтобы посмотреть лучшие фрагменты по каждому файлу',
      'после выбора файла открывай его через read_file, extract_symbols или lsp_inspect',
    ];
  }

  return [];
}

function rankCombinedMatchesWithSpecializedBias(matches: ToolSearchMatch[], limit: number): ToolSearchMatch[] {
  return matches
    .sort((left, right) => {
      const scoreDelta = getMatchRankingScore(right) - getMatchRankingScore(left);
      if (scoreDelta !== 0) return scoreDelta;
      return left.definition.name.localeCompare(right.definition.name);
    })
    .slice(0, limit);
}

function getMatchRankingScore(match: ToolSearchMatch): number {
  const specializedBias = getToolPromptGroup(match.definition) === 'specialized' ? 8 : 0;
  return match.score + specializedBias;
}

function tokenize(query: string): string[] {
  return [...new Set(
    query
      .split(/[^a-zа-я0-9_]+/i)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2),
  )];
}

function escapeTemplateText(value: string): string {
  return String(value || '').replace(/"/g, '\'');
}

function buildSuggestedArgs(definition: ToolDefinition, query: string): Record<string, unknown> | null {
  const normalized = String(query || '').toLowerCase();

  if (definition.name === 'read_file') {
    if (/(package\.json|package-lock|tsconfig|jsconfig|pyproject|cargo\.toml|go\.mod|requirements|manifest|конфиг|конфигурац|зависимост)/.test(normalized)) {
      return { path: '<путь к файлу>', outputMode: 'manifest' };
    }
    if (/(metadata|метадан|размер|binary|бинар|артефакт|сборка|minified|минифиц)/.test(normalized)) {
      return { path: '<путь к файлу>', outputMode: 'metadata' };
    }
    if (/(конец|хвост|tail|последн)/.test(normalized)) {
      return { path: '<путь к файлу>', outputMode: 'tail', limit: 120 };
    }
    if (/(начало|head|первые|верх)/.test(normalized)) {
      return { path: '<путь к файлу>', outputMode: 'head', limit: 120 };
    }
    if (/(overview|обзор|outline|структур)/.test(normalized)) {
      return { path: '<путь к файлу>', outputMode: 'outline' };
    }
  }

  if (definition.name === 'ask_user') {
    return {
      questions: [{
        question: 'Какой вариант выбрать?',
        header: 'Выбор',
        options: [
          { label: 'Минимальный', description: 'Меньше изменений и быстрее реализация' },
          { label: 'Полный', description: 'Чище архитектурно, но больше объём работ' },
        ],
      }],
    };
  }

  if (definition.name === 'skill') {
    return {
      name: '<имя навыка>',
      task: '<что нужно сделать этим навыком>',
    };
  }

  if (definition.name === 'task_create') {
    return {
      subject: '<краткий заголовок>',
      description: '<что нужно сделать>',
      activeForm: '<что сейчас делается>',
    };
  }

  if (definition.name === 'task_list') {
    if (/(активн|running|in progress|выполняетс)/.test(normalized)) {
      return { status: 'in_progress', limit: 10 };
    }
    if (/(shell|background|фон|jobs|джоб)/.test(normalized)) {
      return { kind: 'shell', limit: 20 };
    }
    return { limit: 10 };
  }

  if (definition.name === 'task_get') {
    return { id: '<task-id>' };
  }

  if (definition.name === 'task_update') {
    return { id: '<task-id>', status: 'completed' };
  }

  if (definition.name === 'task_stop') {
    if (/(force|kill|принуд|жестко)/.test(normalized)) {
      return { id: '<task-id>', force: true };
    }
    return { id: '<task-id>' };
  }

  if (definition.name === 'list_mcp_resources') {
    return /(сервер|server|connector|коннектор)/.test(normalized)
      ? { server: '<имя MCP сервера>' }
      : {};
  }

  if (definition.name === 'read_mcp_resource') {
    return {
      server: '<имя MCP сервера>',
      uri: '<resource URI>',
    };
  }

  if (definition.name === 'list_mcp_tools') {
    return /(сервер|server|connector|коннектор)/.test(normalized)
      ? { server: '<имя MCP сервера>' }
      : {};
  }

  if (definition.name === 'mcp_tool') {
    return {
      server: '<имя MCP сервера>',
      name: '<имя MCP tool>',
      arguments: { key: '<value>' },
    };
  }

  if (definition.name === 'mcp_auth') {
    return {
      server: '<имя MCP сервера>',
    };
  }

  if (definition.name === 'enter_worktree') {
    return /(refactor|изоляц|ветк|worktree|чернов|эксперимент)/.test(normalized)
      ? { name: 'refactor-branch' }
      : {};
  }

  if (definition.name === 'exit_worktree') {
    if (/(удал|remove|cleanup|закрыть полностью)/.test(normalized)) {
      return { action: 'remove', discard_changes: true };
    }
    return { action: 'keep' };
  }

  if (definition.name === 'grep') {
    if (/(файлы с совпад|где встречает|список файлов|files_with_matches)/.test(normalized)) {
      return {
        pattern: '<строка или regex>',
        outputMode: 'files_with_matches',
        limit: 40,
      };
    }
    if (/(сколько раз|частот|count|по файлам сколько|сколько совпадений)/.test(normalized)) {
      return {
        pattern: '<строка или regex>',
        outputMode: 'count',
        limit: 80,
      };
    }
    if (/(контекст|фрагмент|content|кусок кода|строки вокруг)/.test(normalized)) {
      return {
        pattern: '<строка или regex>',
        outputMode: 'content',
        limit: 20,
      };
    }
  }

  if (definition.name === 'glob' || definition.name === 'find_files') {
    if (/(директори|папк|где лежат|grouped|сгрупп|по директориям)/.test(normalized)) {
      return definition.name === 'glob'
        ? { glob_pattern: '<glob-шаблон>', outputMode: 'grouped', limit: 40 }
        : { pattern: '<имя файла или паттерн>', outputMode: 'grouped', limit: 40 };
    }
    if (/(расширен|маск|glob|все ts|все js|все файлы такого типа)/.test(normalized) && definition.name === 'glob') {
      return { glob_pattern: '<glob-шаблон>', outputMode: 'flat', limit: 60 };
    }
    if (/(имя файла|filename|router|config|readme|package)/.test(normalized) && definition.name === 'find_files') {
      return { pattern: '<имя файла или паттерн>', outputMode: 'flat', limit: 60 };
    }
  }

  if (definition.name === 'list_files') {
    if (/(директори|папк|первого уровня|обзор директории|dirs|folders)/.test(normalized)) {
      return { path: '<директория>', outputMode: 'dirs', limit: 40 };
    }
    if (/(дерево|tree|layout|структур)/.test(normalized)) {
      return { path: '<директория>', outputMode: 'tree', limit: 120 };
    }
    if (/(список|flat|все файлы|длинный список)/.test(normalized)) {
      return { path: '<директория>', outputMode: 'flat', limit: 80 };
    }
  }

  if (definition.name === 'scan_structure') {
    if (/(директор|папк|folders|dirs)/.test(normalized)) {
      return { outputMode: 'dirs', limit: 40 };
    }
    if (/(важн|entry|конфиг|ключев|important)/.test(normalized)) {
      return { outputMode: 'important_files', limit: 40 };
    }
  }

  if (definition.name === 'detect_stack') {
    if (/(entry|entrypoint|точк|вход|boot|startup)/.test(normalized)) {
      return { outputMode: 'entrypoints', limit: 30 };
    }
    if (/(infra|docker|ci|build|deploy|инфра|инфраструкт)/.test(normalized)) {
      return { outputMode: 'infra', limit: 30 };
    }
  }

  if (definition.name === 'dependencies') {
    if (/(манифест|manifest|package\\.json|requirements|cargo|go\\.mod|библиотек|libraries overview)/.test(normalized)) {
      return { paths: ['<путь к файлу или manifest>'], outputMode: 'manifests', limit: 20 };
    }
    if (/(по файлам|by file|какие файлы зависят|файлы с импортами|sources)/.test(normalized)) {
      return { paths: ['<путь к файлу или manifest>'], outputMode: 'files', limit: 20 };
    }
    if (/(graph|граф|цепоч|import|импорт)/.test(normalized)) {
      return { paths: ['<путь к файлу или manifest>'], outputMode: 'graph', limit: 40 };
    }
    if (/(package|library|библиотек|зависимост)/.test(normalized)) {
      return { paths: ['<путь к файлу или manifest>'], outputMode: 'packages', limit: 40 };
    }
  }

  if (definition.name === 'semantic_search') {
    if (/(файлы по смыслу|shortlist|какие файлы читать|files)/.test(normalized)) {
      return { query: '<вопрос на естественном языке>', outputMode: 'files', limit: 8 };
    }
    if (/(фрагмент|chunks|chunk|snippet|контекст по смыслу|релевантные куски)/.test(normalized)) {
      return { query: '<вопрос на естественном языке>', outputMode: 'chunks', limit: 6 };
    }
    return { query: '<вопрос на естественном языке>', outputMode: 'summary', limit: 8 };
  }

  if (definition.name === 'find_relevant_files') {
    if (/(snippet|snippets|лучшие фрагменты по файлам|сниппет)/.test(normalized)) {
      return { query: '<вопрос на естественном языке>', outputMode: 'snippets', limit: 8 };
    }
    if (/(files|по файлам|shortlist|какие файлы)/.test(normalized)) {
      return { query: '<вопрос на естественном языке>', outputMode: 'files', limit: 8 };
    }
    return { query: '<вопрос на естественном языке>', outputMode: 'summary', limit: 8 };
  }

  if (definition.name === 'extract_symbols') {
    if (/(типы символов|виды символов|group by kind|kinds|types)/.test(normalized)) {
      return { path: '<путь к файлу>', outputMode: 'kinds', limit: 12 };
    }
    if (/(подробный список|list symbols|symbols list|все символы|items)/.test(normalized)) {
      return { path: '<путь к файлу>', outputMode: 'symbols', limit: 30 };
    }
    if (/(обзор symbols|overview symbols|shape файла|структура символов|summary)/.test(normalized)) {
      return { path: '<путь к файлу>', outputMode: 'summary', limit: 20 };
    }
  }

  if (definition.name === 'lsp_inspect') {
    if (/(callers|incoming|кто вызывает|входящ|каллеры)/.test(normalized)) {
      return {
        operation: 'incoming_calls',
        path: '<путь к файлу>',
        line: '<номер строки>',
        character: '<номер символа>',
        limit: 20,
      };
    }
    if (/(callees|outgoing|что вызывает|исходящ|вызовы из функции)/.test(normalized)) {
      return {
        operation: 'outgoing_calls',
        path: '<путь к файлу>',
        line: '<номер строки>',
        character: '<номер символа>',
        limit: 20,
      };
    }
    if (/(references|refs|ссылк)/.test(normalized)) {
      return {
        operation: 'references',
        path: '<путь к файлу>',
        line: '<номер строки>',
        character: '<номер символа>',
        limit: 20,
      };
    }
    if (/(definition|определен|go to def)/.test(normalized)) {
      return {
        operation: 'definition',
        path: '<путь к файлу>',
        line: '<номер строки>',
        character: '<номер символа>',
      };
    }
    if (/(workspace symbols|символы по проекту|найти символ по имени)/.test(normalized)) {
      return {
        operation: 'workspace_symbols',
        query: '<имя символа>',
        limit: 20,
      };
    }
  }

  if (definition.name === 'read_lints' || definition.name === 'get_diagnostics') {
    if (/(по файлам|files|файлам)/.test(normalized)) {
      return { outputMode: 'files', limit: 40 };
    }
    if (/(ошибк|warning|warnings|items|problem|проблем)/.test(normalized)) {
      return { outputMode: 'items', limit: 40 };
    }
  }

  if (definition.name === 'web_search') {
    if (/(answer|grounded|собери ответ|собрать ответ|summary по источникам|ответ по источникам)/.test(normalized)) {
      return { query: '<актуальный запрос>', outputMode: 'answer', prompt: '<какой ответ собрать>', fetchTopResults: 3, limit: 5 };
    }
    if (/(sources|источники|ссылки|домены|domains|urls)/.test(normalized)) {
      return { query: '<актуальный запрос>', outputMode: 'sources', limit: 6 };
    }
    if (/(results|результаты|snippets|сниппеты|фрагменты выдачи)/.test(normalized)) {
      return { query: '<актуальный запрос>', outputMode: 'results', limit: 6 };
    }
    return { query: '<актуальный запрос>', outputMode: 'summary', limit: 5 };
  }

  if (definition.name === 'web_fetch') {
    if (/(extract|вытащи|извлеки|извлечь|ответ из страницы|steps from page|что написано на странице)/.test(normalized)) {
      return { url: '<полный URL>', outputMode: 'summary', prompt: '<что нужно извлечь>' };
    }
    if (/(metadata|метадан|headers|content-type|тип ресурса|бинар)/.test(normalized)) {
      return { url: '<полный URL>', outputMode: 'metadata' };
    }
    if (/(content|полный текст|полное содержимое|json целиком|full text)/.test(normalized)) {
      return { url: '<полный URL>', outputMode: 'content' };
    }
    return { url: '<полный URL>', outputMode: 'summary' };
  }

  if (definition.name === 'str_replace') {
    if (/(rename|переимен|replace all|заменить все|по всему файлу)/.test(normalized)) {
      return {
        path: '<путь к файлу>',
        old_string: '<старый фрагмент>',
        new_string: '<новый фрагмент>',
        replace_all: true,
      };
    }

    return {
      path: '<путь к файлу>',
      old_string: '<уникальный фрагмент>',
      new_string: '<новый фрагмент>',
    };
  }

  if (definition.name === 'write_file') {
    return {
      path: '<путь к файлу>',
      contents: '<полное содержимое файла>',
    };
  }

  if (definition.name === 'delete_file') {
    return {
      path: '<путь к файлу>',
    };
  }

  if (definition.name === 'edit_notebook') {
    if (/(новая ячейка|new cell|добавить ячейку)/.test(normalized)) {
      return {
        target_notebook: '<путь к .ipynb>',
        cell_idx: 0,
        is_new_cell: true,
        cell_language: 'python',
        new_string: '<содержимое ячейки>',
      };
    }

    return {
      target_notebook: '<путь к .ipynb>',
      cell_idx: 0,
      old_string: '<старый фрагмент>',
      new_string: '<новый фрагмент>',
    };
  }

  if (definition.name === 'shell') {
    if (/(watch|dev server|serve|долг|в фоне|background|package|vsix)/.test(normalized)) {
      return { command: '<долгая команда>', run_in_background: true, task_subject: '<краткий заголовок>' };
    }
    if (/(git diff|diff изменений|что изменилось|покажи изменения|stat diff)/.test(normalized)) {
      return { command: 'git diff --stat' };
    }
    if (/(git status short|короткий git status|изменённые файлы git)/.test(normalized)) {
      return { command: 'git status --short' };
    }
    if (/(git log|история коммитов|последние коммиты|коммиты ветки)/.test(normalized)) {
      return { command: 'git log --oneline -10' };
    }
    if (/(git show|покажи коммит|последний коммит diff)/.test(normalized)) {
      return { command: 'git show --stat --oneline HEAD' };
    }
    if (/(git status|статус git|состояние репозитория)/.test(normalized)) {
      return { command: 'git status' };
    }
    if (/(lint|линт|eslint|ruff|mypy)/.test(normalized)) {
      return { command: 'npm run lint' };
    }
    if (/(build|сборк|typecheck|tsc)/.test(normalized)) {
      return { command: 'npm run build' };
    }
    if (/(test|тест|провер)/.test(normalized)) {
      return { command: 'npm test' };
    }
    if (/(rg|grep|поиск в терминале|ripgrep)/.test(normalized)) {
      return { command: "rg '<паттерн>' ." };
    }
  }

  return null;
}

function parseQueryTerms(query: string): {
  requiredTerms: string[];
  scoringTerms: string[];
} {
  const rawTokens = String(query || '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const requiredTerms = new Set<string>();
  const optionalTerms = new Set<string>();

  for (const token of rawTokens) {
    if (token.startsWith('+') && token.length > 1) {
      for (const term of tokenize(token.slice(1))) {
        requiredTerms.add(term);
      }
      continue;
    }
    for (const term of tokenize(token)) {
      optionalTerms.add(term);
    }
  }

  const scoringTerms = [...new Set([
    ...requiredTerms,
    ...optionalTerms,
  ])];

  return {
    requiredTerms: [...requiredTerms],
    scoringTerms,
  };
}
