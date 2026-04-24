import type { ChatMessage } from '../../core/types';

type TextSection = {
  title: string;
  text: string;
};

const DEFAULT_KEY_LINE_RE =
  /\b(jira|tfs|wiql|work item|AILAB|AIPRJ|[A-Z][A-Z0-9]+-\d+|#\d+|ошибк|error|warning|коммит|ветк|branch|репозитор|repo|статус|приоритет|исполнитель|автор|эпик|связ|описан|задач|проект|TODO|FIXME)\b/i;

export function compactTextWithBoundary(
  text: string,
  maxChars: number,
  label = 'фрагмент',
): string {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length <= maxChars) return normalized;
  if (maxChars < 800) return compactShortTextWithBoundary(normalized, maxChars, label);

  const safeMax = maxChars;
  const omittedStart = Math.floor(safeMax * 0.52);
  const omittedTail = Math.floor(safeMax * 0.22);
  const header = [
    `[Сжато для контекстного окна: ${label}]`,
    `Исходный размер: ${normalized.length} символов. Сохранены начало, конец и сводка середины; это не молчаливое обрезание.`,
  ].join('\n');
  const summaryBudget = Math.max(420, safeMax - omittedStart - omittedTail - header.length - 12);
  const headBudget = Math.max(240, Math.min(omittedStart, safeMax - header.length - summaryBudget - 120));
  const tailBudget = Math.max(180, Math.min(omittedTail, safeMax - header.length - summaryBudget - headBudget - 40));
  const head = cutAtBoundary(normalized.slice(0, headBudget), 'end');
  const tail = cutAtBoundary(normalized.slice(Math.max(0, normalized.length - tailBudget)), 'start');
  const middle = normalized.slice(head.length, Math.max(head.length, normalized.length - tail.length));
  const summary = summarizeTextFragment(middle, summaryBudget);

  return [
    head,
    '',
    header,
    summary,
    '[Конец сжатой середины]',
    '',
    tail,
  ].filter(Boolean).join('\n').trim();
}

function compactShortTextWithBoundary(text: string, maxChars: number, label: string): string {
  const safeMax = Math.max(160, maxChars);
  const note = `[Сжато: ${label}; исходно ${text.length} символов; сохранены начало и конец.]`;
  const contentBudget = Math.max(40, safeMax - note.length - 4);
  const headBudget = Math.max(20, Math.floor(contentBudget * 0.6));
  const tailBudget = Math.max(20, contentBudget - headBudget);
  const head = text.slice(0, headBudget).trimEnd();
  const tail = text.slice(Math.max(0, text.length - tailBudget)).trimStart();
  return [head, note, tail].filter(Boolean).join('\n').trim();
}

export function packExternalContextForPrompt(context: string, maxChars: number): string {
  const normalized = normalizeText(context);
  if (!normalized || normalized.length <= maxChars) return normalized;

  const sections = splitContextSections(normalized);
  if (sections.length <= 1) {
    return compactTextWithBoundary(normalized, maxChars, 'контекст текущей сессии');
  }

  const header = [
    '[Контекст текущей сессии сжат без молчаливого обрезания]',
    `Исходный размер: ${normalized.length} символов; разделов: ${sections.length}.`,
    'Сохранены заголовки разделов, ключевые строки, начало/конец больших блоков и сводка сжатых частей.',
    '',
  ].join('\n');
  const budget = Math.max(1_200, maxChars - header.length);
  const weights = sections.map((section) => sectionWeight(section.title));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const packedSections = sections.map((section, index) => {
    const sectionBudget = Math.max(600, Math.floor((budget * weights[index]) / totalWeight));
    return packContextSection(section, sectionBudget);
  });

  const packed = `${header}${packedSections.join('\n\n')}`.trim();
  if (packed.length <= maxChars) return packed;
  return compactTextWithBoundary(packed, maxChars, 'упакованный контекст текущей сессии');
}

export function compactToolResultForContext(
  toolName: string,
  content: string,
  maxChars = 8_000,
): string {
  const normalized = normalizeText(content);
  if (!normalized || normalized.length <= maxChars) return normalized;
  return compactTextWithBoundary(normalized, maxChars, `результат инструмента ${toolName || 'tool'}`);
}

export function selectHistoryMessagesWithSummary(
  history: ChatMessage[],
  maxChars: number,
): ChatMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  const summaryBudget = Math.min(5_000, Math.max(1_400, Math.floor(maxChars * 0.18)));
  const selectedBudget = Math.max(8_000, maxChars - summaryBudget);
  const selected: ChatMessage[] = [];
  let total = 0;

  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    const size = String(message?.content || '').length;
    if (selected.length > 0 && total + size > selectedBudget) break;
    selected.unshift(message);
    total += size;
  }

  const omittedCount = Math.max(0, history.length - selected.length);
  if (omittedCount === 0) return selected;

  const omitted = history.slice(0, omittedCount);
  const summary = buildHeuristicConversationSummary(omitted, summaryBudget);
  return [
    {
      role: 'user',
      content:
        '[Автосводка ранней истории диалога]\n' +
        'Ранние сообщения не помещались в запрос целиком, поэтому они представлены сводкой вместо молчаливого удаления.\n\n' +
        summary,
    },
    ...selected,
  ];
}

export function serializeMessagesWithCompaction(
  messages: ChatMessage[],
  maxChars: number,
  perMessageLimit: number,
): string {
  const selected = selectHistoryMessagesWithSummary(messages, maxChars);
  if (selected.length === 0) return '';
  return selected
    .map((msg) => {
      const role = msg.role === 'user' ? 'Пользователь' : 'Агент';
      return `${role}: ${compactTextWithBoundary(String(msg.content || ''), perMessageLimit, `сообщение ${role}`)}`;
    })
    .join('\n\n');
}

export function compactMessagesForPromptRetry(
  messages: ChatMessage[],
  options: {
    preservePrefixMessages?: number;
    keepTailMessages?: number;
    summaryBudget?: number;
  } = {},
): boolean {
  if (!Array.isArray(messages) || messages.length < 14) return false;

  const preservePrefixMessages = Math.max(1, options.preservePrefixMessages ?? 5);
  const keepTailMessages = Math.max(4, options.keepTailMessages ?? 8);
  const summaryBudget = Math.max(1_800, options.summaryBudget ?? 7_000);
  if (messages.length <= preservePrefixMessages + keepTailMessages + 1) return false;

  const middleStart = preservePrefixMessages;
  const middleEnd = messages.length - keepTailMessages;
  const middle = messages.slice(middleStart, middleEnd);
  if (middle.length === 0) return false;

  const summary = buildHeuristicConversationSummary(middle, summaryBudget);
  messages.splice(
    middleStart,
    middle.length,
    {
      role: 'user',
      content:
        '[Reactive compact после переполнения контекста]\n' +
        `Сжато сообщений: ${middle.length}. Prefix (${preservePrefixMessages}) и последние ${keepTailMessages} сообщений сохранены без изменений.\n\n` +
        summary,
    },
  );
  return true;
}

export function buildHeuristicConversationSummary(
  messages: ChatMessage[],
  maxChars = 4_800,
): string {
  const normalizedMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && String(message.content || '').trim());
  if (normalizedMessages.length === 0) return '- Нет ранних сообщений для сводки.';

  const text = normalizedMessages.map((message) => message.content).join('\n\n');
  const userRequests = uniqueStrings(
    normalizedMessages
      .filter((message) => message.role === 'user')
      .map((message) => compactLine(stripContextEnvelope(message.content), 260))
      .filter(Boolean),
  ).slice(-8);
  const assistantFacts = uniqueStrings(
    normalizedMessages
      .filter((message) => message.role === 'assistant')
      .map((message) => compactLine(message.content, 260))
      .filter(Boolean),
  ).slice(-8);
  const keyLines = extractKeyLines(text, 12, 260);
  const fileMentions = uniqueStrings(extractFileMentions(text)).slice(0, 12);
  const jiraKeys = uniqueStrings(text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || []).slice(0, 12);

  const sections: string[] = [
    `Сообщений сжато: ${normalizedMessages.length}; исходный размер: ${text.length} символов.`,
  ];
  if (jiraKeys.length) sections.push(`Jira/task keys: ${jiraKeys.join(', ')}`);
  if (fileMentions.length) {
    sections.push('Файлы и области:\n' + fileMentions.map((file) => `- ${file}`).join('\n'));
  }
  if (userRequests.length) {
    sections.push('Запросы пользователя:\n' + userRequests.map((line) => `- ${line}`).join('\n'));
  }
  if (keyLines.length) {
    sections.push('Ключевые строки:\n' + keyLines.map((line) => `- ${line}`).join('\n'));
  }
  if (assistantFacts.length) {
    sections.push('Рабочие выводы агента:\n' + assistantFacts.map((line) => `- ${line}`).join('\n'));
  }

  return compactTextWithBoundary(sections.join('\n\n'), maxChars, 'эвристическая сводка истории');
}

function packContextSection(section: TextSection, maxChars: number): string {
  const text = section.text.trim();
  if (!text || text.length <= maxChars) return text;

  if (/^(Комментарии Jira|История\/комментарии TFS)/i.test(section.title)) {
    return packJiraCommentsSection(text, maxChars, section.title);
  }

  return compactTextWithBoundary(text, maxChars, section.title);
}

function packJiraCommentsSection(text: string, maxChars: number, label = 'Комментарии Jira'): string {
  const comments = parseJiraComments(text);
  if (comments.length === 0) {
    return compactTextWithBoundary(text, maxChars, label);
  }

  const header = [
    comments[0]?.sectionTitle || `${label}:`,
    `[Сжато для контекстного окна: ${label}]`,
    `Всего записей в блоке: ${comments.length}. Сохранены все заголовки; длинные тела представлены ключевыми строками.`,
  ];
  const bodyBudget = Math.max(400, maxChars - header.join('\n').length - 2);
  const perCommentBudget = Math.max(180, Math.floor(bodyBudget / Math.max(1, comments.length)));
  const lines = [...header];

  for (const comment of comments) {
    lines.push(comment.header);
    const body = comment.body.trim();
    if (body) {
      const compacted = compactTextWithBoundary(body, perCommentBudget, `тело комментария ${comment.header.replace(/^-\s*/, '')}`);
      lines.push(indent(compacted, '  '));
    }
  }

  const packed = lines.join('\n');
  if (packed.length <= maxChars) return packed;
  return compactTextWithBoundary(packed, maxChars, `сжатый блок ${label}`);
}

function parseJiraComments(text: string): Array<{ sectionTitle: string; header: string; body: string }> {
  const lines = text.split(/\r?\n/);
  const sectionTitle = lines.shift()?.trim() || 'Комментарии Jira:';
  const comments: Array<{ sectionTitle: string; header: string; body: string }> = [];
  let current: { sectionTitle: string; header: string; bodyLines: string[] } | null = null;

  for (const line of lines) {
    if (/^-\s+.+\s+•\s+.+/.test(line.trim())) {
      if (current) {
        comments.push({ sectionTitle, header: current.header, body: current.bodyLines.join('\n').trim() });
      }
      current = { sectionTitle, header: line.trim(), bodyLines: [] };
      continue;
    }
    if (current) current.bodyLines.push(line.replace(/^\s{2}/, ''));
  }

  if (current) {
    comments.push({ sectionTitle, header: current.header, body: current.bodyLines.join('\n').trim() });
  }
  return comments;
}

function splitContextSections(text: string): TextSection[] {
  const lines = text.split(/\r?\n/);
  const sections: TextSection[] = [];
  let currentTitle = 'Вводные инструкции контекста';
  let bucket: string[] = [];

  const flush = () => {
    const body = bucket.join('\n').trim();
    if (body) {
      sections.push({ title: currentTitle, text: body });
    }
    bucket = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (isContextSectionHeader(trimmed) && bucket.length > 0) {
      flush();
      currentTitle = trimmed.replace(/:$/, '');
      bucket.push(line);
      continue;
    }
    bucket.push(line);
  }
  flush();

  return sections.length > 0 ? sections : [{ title: 'Контекст текущей сессии', text }];
}

function isContextSectionHeader(line: string): boolean {
  if (!line) return false;
  return /^(Контекст Jira-задачи\b|Контекст TFS work item\b|Описание:|Связи Jira:|Связи TFS:|Комментарии Jira(?:\b|\s*\()|История\/комментарии TFS(?:\b|\s*\()|Вложения Jira:|Дополнительные поля Jira:|Дополнительные поля TFS:|Предупреждения Jira:|Предупреждения TFS:|Git-контекст\b|Репозиторий:|Коммиты:|Репозитории с ошибками проверки:|Для свежих данных\b)/i.test(line);
}

function sectionWeight(title: string): number {
  if (/Вводные инструкции/i.test(title)) return 0.8;
  if (/Контекст (?:Jira-задачи|TFS work item)/i.test(title)) return 1.5;
  if (/Описание/i.test(title)) return 2.0;
  if (/Комментарии Jira|История\/комментарии TFS/i.test(title)) return 2.2;
  if (/Git-контекст|Репозиторий|Коммиты/i.test(title)) return 1.8;
  if (/Связи Jira|Связи TFS|Дополнительные поля|Вложения/i.test(title)) return 1.4;
  return 1;
}

function summarizeTextFragment(text: string, maxChars: number): string {
  const normalized = normalizeText(text);
  if (!normalized) return '- Сжатая середина пуста.';
  const lines = normalized.split(/\r?\n/);
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  const keyLines = extractKeyLines(normalized, 10, 220);
  const firstLines = nonEmpty.slice(0, 3).map((line) => compactLine(line, 220));
  const lastLines = nonEmpty.slice(-3).map((line) => compactLine(line, 220));
  const summaryLines = [
    `- Сжато символов: ${normalized.length}; строк: ${lines.length}.`,
    ...keyLines.map((line) => `- Ключевая строка: ${line}`),
    ...firstLines.map((line) => `- Начало сжатой части: ${line}`),
    ...lastLines.map((line) => `- Конец сжатой части: ${line}`),
  ];
  return compactTextWithBoundary(summaryLines.join('\n'), maxChars, 'сводка сжатой середины');
}

function extractKeyLines(text: string, limit: number, maxLineChars: number): string[] {
  const lines = normalizeText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const selected = uniqueStrings([
    ...lines.filter((line) => DEFAULT_KEY_LINE_RE.test(line)),
    ...lines.filter((line) => /^[-*]\s+/.test(line)).slice(0, limit),
    ...lines.slice(-Math.min(4, limit)),
  ].map((line) => compactLine(line, maxLineChars)));
  return selected.slice(0, limit);
}

function extractFileMentions(text: string): string[] {
  const filePattern =
    /(?:\/[\w.-]+)+(?:\/[\w.-]+)+|(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9_-]+|[\w.-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|yml|yaml|toml|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|sh|sql|html)/g;
  return (text.match(filePattern) || [])
    .map((match) => match.trim().replace(/^`|`$/g, ''))
    .filter((match) => match.length >= 4 && !/^https?:/i.test(match));
}

function stripContextEnvelope(text: string): string {
  return String(text || '')
    .replace(/^\[(?:Результат|Авто-контекст|Контекст)[^\]]*\]:?\s*/i, '')
    .trim();
}

function compactLine(text: string, maxChars: number): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function cutAtBoundary(text: string, side: 'start' | 'end'): string {
  const normalized = String(text || '');
  if (normalized.length < 120) return normalized.trim();
  if (side === 'end') {
    const index = Math.max(normalized.lastIndexOf('\n'), normalized.lastIndexOf('. '));
    return (index > 80 ? normalized.slice(0, index + 1) : normalized).trimEnd();
  }
  const index = normalized.search(/\n|\. /);
  return (index >= 0 && index < normalized.length - 80 ? normalized.slice(index + 1) : normalized).trimStart();
}

function indent(text: string, prefix: string): string {
  return String(text || '').split(/\r?\n/).map((line) => `${prefix}${line}`).join('\n');
}

function normalizeText(text: string): string {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\n{5,}/g, '\n\n\n')
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
