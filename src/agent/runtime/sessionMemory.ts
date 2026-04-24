import * as fs from 'fs/promises';
import * as path from 'path';
import type { ChatMessage } from '../../core/types';
import { getExtensionStorageSubdir } from '../../core/extensionStorage';
import type { AgentRuntimeContext } from './types';

const SESSION_MEMORY_DIR = 'session-memory';
const SESSION_MEMORY_INIT_CHARS = 6_000;
const SESSION_MEMORY_UPDATE_CHARS = 2_500;
const SESSION_MEMORY_UPDATE_MESSAGES = 4;
const SESSION_MEMORY_RECENT_MESSAGES = 14;
const SESSION_MEMORY_MAX_OUTPUT_TOKENS = 600;
const SESSION_MEMORY_MAX_FILE_CHARS = 5_800;
const SESSION_MEMORY_MAX_SECTION_CHARS = 700;
const SESSION_MEMORY_MAX_COMPACT_CHARS = 1_100;

type SessionMemorySectionId =
  | 'title'
  | 'current_state'
  | 'request'
  | 'important_files'
  | 'decisions'
  | 'open_questions'
  | 'recent_progress';

type SessionMemorySection = {
  id: SessionMemorySectionId;
  header: string;
  description: string;
};

const SESSION_MEMORY_SECTIONS: SessionMemorySection[] = [
  {
    id: 'title',
    header: '# Заголовок сессии',
    description: '_Короткое и узнаваемое название текущей сессии без лишних слов._',
  },
  {
    id: 'current_state',
    header: '# Текущее состояние',
    description: '_Над чем агент работает прямо сейчас и какой следующий полезный шаг._',
  },
  {
    id: 'request',
    header: '# Запрос и рамки',
    description: '_Что пользователь хочет получить, какие ограничения и предпочтения уже зафиксированы._',
  },
  {
    id: 'important_files',
    header: '# Важные файлы и области',
    description: '_Файлы, модули и подсистемы, к которым уже обращались или которые критичны для продолжения._',
  },
  {
    id: 'decisions',
    header: '# Решения и наблюдения',
    description: '_Что уже решили, что сработало, что не стоит повторять, какие ошибки были важны._',
  },
  {
    id: 'open_questions',
    header: '# Открытые вопросы',
    description: '_Что ещё надо проверить, уточнить у пользователя или довести до конца._',
  },
  {
    id: 'recent_progress',
    header: '# Недавний прогресс',
    description: '_Очень короткий журнал последних заметных шагов по делу._',
  },
];

const SECTION_BY_ID = Object.fromEntries(
  SESSION_MEMORY_SECTIONS.map((section) => [section.id, section]),
) as Record<SessionMemorySectionId, SessionMemorySection>;

export type AgentSessionMemoryState = {
  scopeId: string;
  summary: string;
  title: string;
  currentState: string;
  memoryPath: string;
  lastUpdatedAt: number;
  lastSummarizedMessageCount: number;
  lastSummarizedChars: number;
  updateInFlight: boolean;
  failedUpdates: number;
};

export type AgentSessionMemoryRefreshResult = {
  changed: boolean;
  summary: string;
  title: string;
  currentState: string;
  memoryPath: string;
};

export type AgentSessionMemoryRunSeed = {
  question: string;
  answer: string;
  readFiles: string[];
  topDirs: string[];
  keyFacts: string[];
  toolSummary?: {
    summary?: string;
    detail?: string;
  } | null;
  flowSummary?: {
    summary?: string;
    detail?: string;
  } | null;
};

export function createSessionMemoryState(): AgentSessionMemoryState {
  return {
    scopeId: createSessionMemoryScopeId(),
    summary: '',
    title: '',
    currentState: '',
    memoryPath: '',
    lastUpdatedAt: 0,
    lastSummarizedMessageCount: 0,
    lastSummarizedChars: 0,
    updateInFlight: false,
    failedUpdates: 0,
  };
}

export function resetSessionMemoryState(state: AgentSessionMemoryState): void {
  state.scopeId = createSessionMemoryScopeId();
  state.summary = '';
  state.title = '';
  state.currentState = '';
  state.memoryPath = '';
  state.lastUpdatedAt = 0;
  state.lastSummarizedMessageCount = 0;
  state.lastSummarizedChars = 0;
  state.updateInFlight = false;
  state.failedUpdates = 0;
}

export function primeSessionMemoryFromRun(
  state: AgentSessionMemoryState,
  seed: AgentSessionMemoryRunSeed,
): boolean {
  const sections: string[] = [];
  const question = compactText(seed.question, 240);
  const answer = compactText(seed.answer, 320);
  const currentState = compactText(
    seed.flowSummary?.summary ||
      seed.toolSummary?.summary ||
      (question ? `Последний запрос завершён: ${question}` : ''),
    180,
  );
  const title = state.title || compactText(guessSessionTitle(seed.question), 90) || 'Рабочая сессия';

  sections.push(`## Текущее состояние\n${currentState || '-'}`);

  if (question) {
    sections.push(`## Что хочет пользователь\n- Последний запрос: ${question}`);
  }

  const importantFiles = uniqueStrings(seed.readFiles || []).slice(0, 8);
  if (importantFiles.length > 0) {
    sections.push(`## Важные файлы\n${importantFiles.map((file) => `- \`${compactText(file, 160)}\``).join('\n')}`);
  }

  const observations = uniqueStrings([
    ...((seed.keyFacts || []).map((fact) => compactText(fact, 220))),
    compactText(seed.toolSummary?.summary || '', 180),
    compactText(seed.toolSummary?.detail || '', 220),
    compactText(seed.flowSummary?.summary || '', 180),
    compactText(seed.flowSummary?.detail || '', 220),
  ]).slice(0, 6);
  if (observations.length > 0) {
    sections.push(`## Решения и наблюдения\n${observations.map((item) => `- ${item}`).join('\n')}`);
  }

  const dirs = uniqueStrings(seed.topDirs || []).slice(0, 6);
  const progressLines = uniqueStrings([
    answer ? `Итог прошлого ответа: ${answer}` : '',
    dirs.length > 0 ? `Покрытые директории: ${dirs.join(', ')}` : '',
  ]).slice(0, 3);
  if (progressLines.length > 0) {
    sections.push(`## Недавний прогресс\n${progressLines.map((item) => `- ${compactText(item, 240)}`).join('\n')}`);
  }

  const nextSummary = clampSummary(sections.join('\n\n'));
  const changed =
    state.summary !== nextSummary ||
    state.title !== title ||
    state.currentState !== currentState;

  if (!changed) return false;

  state.summary = nextSummary;
  state.title = title;
  state.currentState = currentState;
  state.lastUpdatedAt = Date.now();
  return true;
}

export async function deleteSessionMemoryFile(memoryPath: string | undefined): Promise<void> {
  if (!memoryPath) return;
  try {
    await fs.unlink(memoryPath);
  } catch {
    // Ignore stale or missing files on reset.
  }
}

export function estimateConversationChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

export function shouldRefreshSessionMemory(
  messages: ChatMessage[],
  state: AgentSessionMemoryState,
): boolean {
  if (state.updateInFlight) return false;
  if (messages.length === 0) return false;

  const totalChars = estimateConversationChars(messages);
  if (!state.summary) {
    return totalChars >= SESSION_MEMORY_INIT_CHARS;
  }

  const deltaChars = Math.max(0, totalChars - state.lastSummarizedChars);
  const deltaMessages = Math.max(0, messages.length - state.lastSummarizedMessageCount);
  return deltaChars >= SESSION_MEMORY_UPDATE_CHARS || deltaMessages >= SESSION_MEMORY_UPDATE_MESSAGES;
}

export async function refreshSessionMemory(
  messages: ChatMessage[],
  state: AgentSessionMemoryState,
): Promise<AgentSessionMemoryRefreshResult> {
  const unchanged = {
    changed: false,
    summary: state.summary,
    title: state.title,
    currentState: state.currentState,
    memoryPath: state.memoryPath,
  };
  if (!shouldRefreshSessionMemory(messages, state)) return unchanged;

  state.updateInFlight = true;
  try {
    const memoryPath = await ensureSessionMemoryFile(state);
    const previousMemory = await readSessionMemoryFile(memoryPath, state);
    const runtime = tryCreateAgentRuntime();
    const nextMemory = runtime.ok
      ? await summarizeWithModel(runtime.runtime, previousMemory, messages, memoryPath)
      : buildHeuristicSessionMemory(previousMemory, messages);

    const normalizedMemory = sanitizeSessionMemoryMarkdown(nextMemory, previousMemory, messages);
    await writeSessionMemoryFile(memoryPath, normalizedMemory);

    const derived = deriveSessionMemorySnapshot(normalizedMemory);
    const changed =
      state.summary !== derived.summary ||
      state.title !== derived.title ||
      state.currentState !== derived.currentState ||
      state.memoryPath !== memoryPath;

    state.summary = derived.summary;
    state.title = derived.title;
    state.currentState = derived.currentState;
    state.memoryPath = memoryPath;
    state.lastUpdatedAt = Date.now();
    state.lastSummarizedMessageCount = messages.length;
    state.lastSummarizedChars = estimateConversationChars(messages);
    state.failedUpdates = 0;

    return {
      changed,
      summary: state.summary,
      title: state.title,
      currentState: state.currentState,
      memoryPath: state.memoryPath,
    };
  } catch {
    state.failedUpdates++;
    const fallbackMemory = sanitizeSessionMemoryMarkdown(
      buildHeuristicSessionMemory('', messages),
      '',
      messages,
    );
    const derived = deriveSessionMemorySnapshot(fallbackMemory);

    state.summary = derived.summary;
    state.title = derived.title;
    state.currentState = derived.currentState;
    state.lastUpdatedAt = Date.now();
    state.lastSummarizedMessageCount = messages.length;
    state.lastSummarizedChars = estimateConversationChars(messages);

    try {
      const memoryPath = await ensureSessionMemoryFile(state);
      await writeSessionMemoryFile(memoryPath, fallbackMemory);
      state.memoryPath = memoryPath;
    } catch {
      // Keep in-memory summary even if file persistence failed.
    }

    return {
      changed: true,
      summary: state.summary,
      title: state.title,
      currentState: state.currentState,
      memoryPath: state.memoryPath,
    };
  } finally {
    state.updateInFlight = false;
  }
}

function tryCreateAgentRuntime():
  | { ok: true; runtime: AgentRuntimeContext }
  | { ok: false } {
  try {
    const mod = require('./modelGateway') as {
      createAgentRuntime?: (params?: unknown) => { ok: true; runtime: AgentRuntimeContext } | { ok: false };
    };
    const created = mod.createAgentRuntime?.({});
    if (created?.ok) {
      return created;
    }
  } catch {
    // Outside VS Code the runtime may be unavailable; we'll fall back to heuristics.
  }
  return { ok: false };
}

function createSessionMemoryScopeId(): string {
  return `sm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeScopeId(value: string): string {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return normalized || createSessionMemoryScopeId();
}

function getSessionMemoryFilePath(scopeId: string): string {
  return path.join(getExtensionStorageSubdir(SESSION_MEMORY_DIR), `${sanitizeScopeId(scopeId)}.md`);
}

async function ensureSessionMemoryFile(state: AgentSessionMemoryState): Promise<string> {
  const preferredPath = getSessionMemoryFilePath(state.scopeId);
  const memoryPath = preferredPath;
  await fs.mkdir(path.dirname(memoryPath), { recursive: true });

  try {
    await fs.stat(memoryPath);
  } catch {
    let initialMemory = state.summary
      ? buildLegacySeedSessionMemory(state.summary, state.title, state.currentState)
      : buildSessionMemoryTemplate();
    await writeSessionMemoryFile(memoryPath, initialMemory);
  }

  return memoryPath;
}

async function readSessionMemoryFile(
  memoryPath: string,
  state: AgentSessionMemoryState,
): Promise<string> {
  try {
    const content = await fs.readFile(memoryPath, 'utf8');
    if (content.trim()) return content;
  } catch {
    // Fall back to seeded content below.
  }

  return state.summary
    ? buildLegacySeedSessionMemory(state.summary, state.title, state.currentState)
    : buildSessionMemoryTemplate();
}

async function writeSessionMemoryFile(memoryPath: string, content: string): Promise<void> {
  const tempPath = `${memoryPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${content.trim()}\n`, 'utf8');
  await fs.rename(tempPath, memoryPath);
}

function buildSessionMemoryTemplate(): string {
  return renderSessionMemory(
    Object.fromEntries(
      SESSION_MEMORY_SECTIONS.map((section) => [section.id, '']),
    ) as Record<SessionMemorySectionId, string>,
  );
}

function buildLegacySeedSessionMemory(
  summary: string,
  title: string,
  currentState: string,
): string {
  return renderSessionMemory({
    title: title || 'Продолжение рабочей сессии',
    current_state: currentState || compactText(summary, 220),
    request: compactText(summary, 420),
    important_files: '',
    decisions: '',
    open_questions: '',
    recent_progress: '',
  });
}

async function summarizeWithModel(
  runtime: AgentRuntimeContext,
  previousMemory: string,
  messages: ChatMessage[],
  memoryPath: string,
): Promise<string> {
  const transcript = messages
    .slice(-SESSION_MEMORY_RECENT_MESSAGES)
    .map((message, index) => `${index + 1}. ${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n');

  const prompt = [
    'Обнови markdown-файл памяти сессии для coding-агента.',
    'Верни полный markdown-файл целиком, без вводных фраз и без code fences.',
    'Сохрани все заголовки разделов и italic description lines точно как в текущем файле.',
    'Обновляй только содержимое разделов под ними.',
    '',
    'Требования:',
    `- весь файл желательно держать до ${SESSION_MEMORY_MAX_FILE_CHARS} символов`,
    `- каждый раздел желательно держать до ${SESSION_MEMORY_MAX_SECTION_CHARS} символов`,
    '- Current state должен отражать самое последнее состояние и ближайший следующий шаг',
    '- Важные файлы указывай с коротким пояснением, зачем они нужны',
    '- Не повторяй весь диалог, оставляй только то, что поможет продолжить работу позже',
    '',
    `Путь файла памяти: ${memoryPath}`,
    '',
    `Текущий файл памяти:\n${previousMemory}`,
    '',
    `Последний фрагмент диалога:\n${transcript}`,
  ].join('\n');

  const content = await runtime.requestChat(
    [
      {
        role: 'system',
        content:
          'Ты поддерживаешь рабочую память инженерного агента. Возвращай только полный markdown-файл памяти без пояснений.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    {
      temperature: 0.1,
      maxTokens: SESSION_MEMORY_MAX_OUTPUT_TOKENS,
      step: 0,
      retryPrefix: 'Ошибка обновления памяти,',
    },
  );

  return content;
}

function sanitizeSessionMemoryMarkdown(
  value: string,
  previousMemory: string,
  messages: ChatMessage[],
): string {
  const cleaned = stripMarkdownFence(value);
  const previousSections = parseSessionMemorySections(previousMemory);
  const generatedSections = parseSessionMemorySections(cleaned);
  const heuristicSections = parseSessionMemorySections(
    buildHeuristicSessionMemory(previousMemory, messages),
  );

  const nextSections = {} as Record<SessionMemorySectionId, string>;
  let hasGeneratedContent = false;

  for (const section of SESSION_MEMORY_SECTIONS) {
    const generated = clampSectionContent(generatedSections[section.id]);
    if (generated) hasGeneratedContent = true;
    nextSections[section.id] =
      generated ||
      clampSectionContent(previousSections[section.id]) ||
      clampSectionContent(heuristicSections[section.id]);
  }

  if (!hasGeneratedContent) {
    return renderSessionMemory(heuristicSections);
  }

  return renderSessionMemory(nextSections);
}

function deriveSessionMemorySnapshot(memoryMarkdown: string): {
  title: string;
  currentState: string;
  summary: string;
} {
  const sections = parseSessionMemorySections(memoryMarkdown);
  const title = compactText(firstMeaningfulLine(sections.title) || 'Рабочая сессия', 96);
  const currentState = compactText(firstMeaningfulLine(sections.current_state), 180);
  const summary = buildCompactionSummaryFromMemory(sections);
  return {
    title,
    currentState,
    summary,
  };
}

function buildCompactionSummaryFromMemory(
  sections: Record<SessionMemorySectionId, string>,
): string {
  const blocks: string[] = [];

  if (sections.current_state) {
    blocks.push(`## Текущее состояние\n${compactParagraph(sections.current_state, 260)}`);
  }

  if (sections.request) {
    blocks.push(`## Что хочет пользователь\n${compactParagraph(sections.request, 260)}`);
  }

  if (sections.important_files) {
    blocks.push(`## Важные файлы\n${takeBullets(sections.important_files, 4, 260)}`);
  }

  if (sections.decisions) {
    blocks.push(`## Решения и наблюдения\n${takeBullets(sections.decisions, 4, 260)}`);
  }

  if (sections.open_questions) {
    blocks.push(`## Открытые вопросы\n${takeBullets(sections.open_questions, 4, 220)}`);
  }

  return clampSummary(blocks.filter(Boolean).join('\n\n'));
}

function buildHeuristicSessionMemory(
  previousMemory: string,
  messages: ChatMessage[],
): string {
  const previousSections = parseSessionMemorySections(previousMemory);
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim());
  const lastUser = [...messages].reverse().find((message) => message.role === 'user' && message.content.trim());
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim());
  const recentAssistants = messages.filter((message) => message.role === 'assistant').slice(-3);
  const recentTurns = messages.slice(-6);

  const files = uniqueStrings(extractFileMentions(messages)).slice(0, 8);
  const openQuestions = collectOpenQuestions(messages, previousSections.open_questions);

  return renderSessionMemory({
    title:
      compactText(previousSections.title, 90) ||
      compactText(guessSessionTitle(firstUser?.content || lastUser?.content || ''), 90) ||
      'Рабочая сессия',
    current_state:
      bulletList(
        [
          compactText(lastAssistant?.content || '', 220),
          lastUser && lastAssistant ? `Следующий фокус: ${compactText(lastUser.content, 180)}` : '',
        ],
        3,
      ) || previousSections.current_state,
    request:
      bulletList(
        [
          compactText(firstUser?.content || '', 220),
          lastUser && lastUser.content !== firstUser?.content
            ? `Последний уточнённый запрос: ${compactText(lastUser.content, 220)}`
            : '',
        ],
        3,
      ) || previousSections.request,
    important_files:
      files.length > 0
        ? files.map((file) => `- \`${file}\``).join('\n')
        : previousSections.important_files,
    decisions:
      bulletList(
        recentAssistants.map((message) => compactText(message.content, 220)),
        4,
      ) || previousSections.decisions,
    open_questions: openQuestions || previousSections.open_questions,
    recent_progress:
      bulletList(
        recentTurns.map((message) =>
          `${message.role === 'user' ? 'Пользователь' : 'Агент'}: ${compactText(message.content, 180)}`,
        ),
        5,
      ) || previousSections.recent_progress,
  });
}

function parseSessionMemorySections(
  content: string,
): Record<SessionMemorySectionId, string> {
  const sections = Object.fromEntries(
    SESSION_MEMORY_SECTIONS.map((section) => [section.id, '']),
  ) as Record<SessionMemorySectionId, string>;
  const buckets = Object.fromEntries(
    SESSION_MEMORY_SECTIONS.map((section) => [section.id, [] as string[]]),
  ) as Record<SessionMemorySectionId, string[]>;

  const headerToId = new Map<string, SessionMemorySectionId>(
    SESSION_MEMORY_SECTIONS.map((section) => [section.header, section.id]),
  );

  let current: SessionMemorySectionId | null = null;
  for (const rawLine of stripMarkdownFence(content).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/g, '');
    const trimmed = line.trim();
    const nextSection = headerToId.get(trimmed);
    if (nextSection) {
      current = nextSection;
      continue;
    }
    if (!current) continue;
    if (trimmed === SECTION_BY_ID[current].description) continue;
    buckets[current].push(line);
  }

  for (const section of SESSION_MEMORY_SECTIONS) {
    sections[section.id] = buckets[section.id].join('\n').trim();
  }

  return sections;
}

function renderSessionMemory(
  sections: Record<SessionMemorySectionId, string>,
): string {
  const lines: string[] = [];
  for (const section of SESSION_MEMORY_SECTIONS) {
    lines.push(section.header);
    lines.push(section.description);
    const content = clampSectionContent(sections[section.id]);
    if (content) {
      lines.push(content);
    }
    lines.push('');
  }

  return lines.join('\n').trim().slice(0, SESSION_MEMORY_MAX_FILE_CHARS).trimEnd();
}

function clampSectionContent(value: string | undefined): string {
  const normalized = String(value || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return '';
  if (normalized.length <= SESSION_MEMORY_MAX_SECTION_CHARS) {
    return normalized;
  }

  const slice = normalized.slice(0, SESSION_MEMORY_MAX_SECTION_CHARS);
  const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
  return (lastBreak > 120 ? slice.slice(0, lastBreak) : slice).trimEnd() + '…';
}

function clampSummary(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.length <= SESSION_MEMORY_MAX_COMPACT_CHARS) return normalized;
  const slice = normalized.slice(0, SESSION_MEMORY_MAX_COMPACT_CHARS);
  const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
  return (lastBreak > 180 ? slice.slice(0, lastBreak) : slice).trimEnd() + '…';
}

function compactText(text: string | undefined, maxLength = 160): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function compactParagraph(text: string | undefined, maxLength = 240): string {
  const value = compactText(text, maxLength);
  return value || '-';
}

function firstMeaningfulLine(text: string | undefined): string {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, '').trim())
    .find(Boolean) || '';
}

function takeBullets(text: string | undefined, limit: number, maxLength = 260): string {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('- ') ? line : `- ${line}`))
    .slice(0, limit);
  if (lines.length === 0) {
    const paragraph = compactText(text, maxLength);
    return paragraph ? `- ${paragraph}` : '-';
  }
  return compactText(lines.join('\n'), maxLength);
}

function bulletList(items: string[], limit = 4): string {
  const lines = uniqueStrings(
    items
      .map((item) => compactText(item, 220))
      .filter(Boolean),
  ).slice(0, limit);
  return lines.map((line) => `- ${line}`).join('\n');
}

function collectOpenQuestions(messages: ChatMessage[], previous: string): string {
  const questions = uniqueStrings(
    messages
      .filter((message) => message.role === 'user')
      .flatMap((message) =>
        message.content
          .split(/\n+/)
          .map((line) => line.trim())
          .filter((line) => line.includes('?') || /\b(нужно|осталось|проверить|уточнить|понять)\b/i.test(line)),
      )
      .map((line) => compactText(line, 180)),
  ).slice(-4);

  return questions.length > 0
    ? questions.map((line) => `- ${line}`).join('\n')
    : previous;
}

function extractFileMentions(messages: ChatMessage[]): string[] {
  const filePattern =
    /(?:\/[\w.-]+)+(?:\/[\w.-]+)+|(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9_-]+|[\w.-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|yml|yaml|toml|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|sh|sql|html)/g;

  return messages.flatMap((message) => {
    const matches = message.content.match(filePattern) || [];
    return matches
      .map((match) => match.trim().replace(/^`|`$/g, ''))
      .filter((match) => match.length >= 4 && !/^https?:/i.test(match));
  });
}

function guessSessionTitle(seed: string): string {
  const normalized = compactText(seed, 80)
    .replace(/^\[.*?\]\s*/g, '')
    .replace(/^([А-ЯA-Z][^:]{0,32}):\s*/u, '')
    .trim();
  return normalized || 'Рабочая сессия';
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

function stripMarkdownFence(value: string): string {
  return String(value || '')
    .replace(/^```(?:markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}
