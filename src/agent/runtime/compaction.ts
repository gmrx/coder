import { MAX_CONTEXT_CHARS } from '../../core/constants';
import type { ChatMessage } from '../../core/types';
import type { AgentRuntimeContext } from './types';
import { buildHeuristicConversationSummary, compactTextWithBoundary } from './contextPacking';

const AUTO_COMPACT_THRESHOLD_CHARS = Math.floor(MAX_CONTEXT_CHARS * 0.55);
const COMPACT_KEEP_TAIL_MESSAGES = 8;
const MAX_CONSECUTIVE_COMPACT_FAILURES = 3;
const MODEL_COMPACT_TRANSCRIPT_BUDGET_CHARS = Math.floor(MAX_CONTEXT_CHARS * 0.72);
const MODEL_COMPACT_RETRY_TRANSCRIPT_BUDGET_CHARS = Math.floor(MAX_CONTEXT_CHARS * 0.45);
const MODEL_COMPACT_MAX_OUTPUT_TOKENS = 2_400;
const MODEL_COMPACT_MAX_SUMMARY_CHARS = 14_000;

export type AgentCompactionState = {
  compactCount: number;
  consecutiveFailures: number;
  lastCompactedMessageCount: number;
};

export type AgentCompactionResult = {
  compacted: boolean;
  messages: ChatMessage[];
  kind?: 'model' | 'heuristic';
  summary?: string;
  error?: string;
};

export function createCompactionState(): AgentCompactionState {
  return {
    compactCount: 0,
    consecutiveFailures: 0,
    lastCompactedMessageCount: 0,
  };
}

export function resetCompactionState(state: AgentCompactionState): void {
  state.compactCount = 0;
  state.consecutiveFailures = 0;
  state.lastCompactedMessageCount = 0;
}

export function maybeCompactConversation(
  messages: ChatMessage[],
  sessionSummary: string,
  state: AgentCompactionState,
): AgentCompactionResult {
  if (!shouldCompactConversation(messages, state)) {
    return { compacted: false, messages };
  }
  return buildHeuristicCompaction(messages, sessionSummary, state);
}

export async function maybeCompactConversationWithModel(
  messages: ChatMessage[],
  sessionSummary: string,
  state: AgentCompactionState,
  runtime: AgentRuntimeContext,
): Promise<AgentCompactionResult> {
  if (!shouldCompactConversation(messages, state)) {
    return { compacted: false, messages };
  }

  try {
    const modelResult = await buildModelCompaction(messages, sessionSummary, state, runtime);
    if (modelResult.compacted) return modelResult;
  } catch (error: any) {
    const message = error?.message || String(error);
    if (isPromptTooLongError(message)) {
      try {
        const retryResult = await buildModelCompaction(
          messages,
          sessionSummary,
          state,
          runtime,
          MODEL_COMPACT_RETRY_TRANSCRIPT_BUDGET_CHARS,
        );
        if (retryResult.compacted) return retryResult;
      } catch (retryError: any) {
        return buildHeuristicCompaction(messages, sessionSummary, state, retryError?.message || String(retryError));
      }
    }
    return buildHeuristicCompaction(messages, sessionSummary, state, message);
  }

  return buildHeuristicCompaction(messages, sessionSummary, state);
}

function shouldCompactConversation(
  messages: ChatMessage[],
  state: AgentCompactionState,
): boolean {
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (totalChars < AUTO_COMPACT_THRESHOLD_CHARS) return false;
  if (messages.length <= COMPACT_KEEP_TAIL_MESSAGES + 2) return false;
  if (state.consecutiveFailures >= MAX_CONSECUTIVE_COMPACT_FAILURES) {
    return false;
  }
  return true;
}

async function buildModelCompaction(
  messages: ChatMessage[],
  sessionSummary: string,
  state: AgentCompactionState,
  runtime: AgentRuntimeContext,
  transcriptBudget = MODEL_COMPACT_TRANSCRIPT_BUDGET_CHARS,
): Promise<AgentCompactionResult> {
  const tail = messages.slice(-COMPACT_KEEP_TAIL_MESSAGES);
  const compactedHead = messages.slice(0, -COMPACT_KEEP_TAIL_MESSAGES);
  const transcript = buildCompactionTranscript(compactedHead, transcriptBudget);
  const previousSummary = String(sessionSummary || '').trim();
  const response = await runtime.requestChat(
    [
      {
        role: 'system',
        content:
          'Ты сжимаешь историю инженерного coding-агента. Инструменты недоступны: отвечай только текстом. ' +
          'Нужно сохранить всё, что поможет продолжить работу без потери контекста.',
      },
      {
        role: 'user',
        content: buildModelCompactPrompt(transcript, previousSummary),
      },
    ],
    {
      temperature: 0.1,
      maxTokens: MODEL_COMPACT_MAX_OUTPUT_TOKENS,
      step: 0,
      retryPrefix: 'Ошибка автосжатия контекста,',
    },
  );
  const summary = sanitizeModelCompactSummary(response);
  if (!summary) {
    throw new Error('Модель вернула пустую сводку контекста.');
  }
  return buildCompactedMessages({
    messages,
    tail,
    compactedHead,
    summary,
    state,
    kind: 'model',
  });
}

function buildHeuristicCompaction(
  messages: ChatMessage[],
  sessionSummary: string,
  state: AgentCompactionState,
  error?: string,
): AgentCompactionResult {
  try {
    const tail = messages.slice(-COMPACT_KEEP_TAIL_MESSAGES);
    const compactedHead = messages.slice(0, -COMPACT_KEEP_TAIL_MESSAGES);
    const summary = String(sessionSummary || '').trim()
      || buildHeuristicConversationSummary(compactedHead, 5_500);
    return buildCompactedMessages({
      messages,
      tail,
      compactedHead,
      summary,
      state,
      kind: 'heuristic',
      error,
    });
  } catch {
    state.consecutiveFailures++;
    return { compacted: false, messages };
  }
}

function buildCompactedMessages(params: {
  messages: ChatMessage[];
  tail: ChatMessage[];
  compactedHead: ChatMessage[];
  summary: string;
  state: AgentCompactionState;
  kind: 'model' | 'heuristic';
  error?: string;
}): AgentCompactionResult {
  const summary = compactTextWithBoundary(
    params.summary,
    MODEL_COMPACT_MAX_SUMMARY_CHARS,
    'сводка предыдущего диалога',
  );
  const compactedMessages: ChatMessage[] = [
    {
      role: 'user',
      content:
        '[Сводка предыдущего диалога]\n' +
        `Способ сжатия: ${params.kind === 'model' ? 'model-based auto compact' : 'эвристический fallback'}.\n` +
        `Сжато ранних сообщений: ${params.compactedHead.length}; последние ${params.tail.length} сообщений сохранены ниже без изменений.\n` +
        (params.error ? `Причина fallback: ${compactTextWithBoundary(params.error, 500, 'ошибка model compact')}\n` : '') +
        '\n' +
        summary +
        '\n\nИспользуй эту сводку как память о ранних шагах. Если данных в последних сообщениях хватает, не проси пересказ старой истории.',
    },
    ...params.tail,
  ];

  params.state.compactCount++;
  params.state.consecutiveFailures = 0;
  params.state.lastCompactedMessageCount = params.messages.length;
  return {
    compacted: true,
    messages: compactedMessages,
    kind: params.kind,
    summary,
    ...(params.error ? { error: params.error } : {}),
  };
}

function buildModelCompactPrompt(transcript: string, previousSummary: string): string {
  return [
    'Создай подробную сводку истории диалога для продолжения работы coding-агента.',
    'Верни только блок <summary>...</summary>, без вступления и без markdown fence.',
    '',
    'Требования:',
    '- сохрани явные просьбы пользователя и изменения направления, особенно исправления/недовольство пользователя;',
    '- перечисли важные файлы, модули, функции, уже найденные решения и изменённые участки;',
    '- сохрани ошибки, причины fallback, ограничения и что не надо повторять;',
    '- перечисли все пользовательские сообщения, которые не являются tool result, в сжатом виде;',
    '- отдельно зафиксируй текущую работу и ближайший следующий шаг строго по последнему актуальному запросу;',
    '- если есть Jira/task key, коммиты, ветки, проекты, настройки или контекст задачи, сохрани их явно;',
    '- не выдумывай факты, которых нет в транскрипте.',
    '',
    'Структура внутри <summary>:',
    '1. Primary Request and Intent',
    '2. Key Technical Concepts',
    '3. Files and Code Sections',
    '4. Errors and fixes',
    '5. Problem Solving',
    '6. All user messages',
    '7. Pending Tasks',
    '8. Current Work',
    '9. Optional Next Step',
    '',
    previousSummary ? `Предыдущая память сессии:\n${previousSummary}\n` : '',
    'Транскрипт ранней истории, которую нужно заменить сводкой:',
    transcript,
  ].filter(Boolean).join('\n');
}

function buildCompactionTranscript(messages: ChatMessage[], maxChars: number): string {
  if (messages.length === 0) return '(нет сообщений для сжатия)';

  const selected: ChatMessage[] = [];
  let total = 0;
  const perMessageBudget = Math.max(1_200, Math.floor(maxChars / Math.max(6, Math.min(messages.length, 28))));

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const content = compactTextWithBoundary(
      String(message.content || ''),
      perMessageBudget,
      `сообщение ${index + 1} перед model compact`,
    );
    const size = content.length + 80;
    if (selected.length > 0 && total + size > maxChars) break;
    selected.unshift({ role: message.role, content });
    total += size;
  }

  const omittedCount = Math.max(0, messages.length - selected.length);
  const blocks: string[] = [];
  if (omittedCount > 0) {
    blocks.push('[Эвристическая сводка более ранней части, не вошедшей в prompt model compact]');
    blocks.push(buildHeuristicConversationSummary(messages.slice(0, omittedCount), 4_000));
    blocks.push('');
  }

  selected.forEach((message, index) => {
    const originalIndex = omittedCount + index + 1;
    blocks.push(`--- MESSAGE ${originalIndex}/${messages.length} (${message.role}) ---`);
    blocks.push(message.content);
  });

  return blocks.join('\n').trim();
}

function sanitizeModelCompactSummary(value: string): string {
  const cleaned = stripMarkdownFence(String(value || '').trim());
  const match = cleaned.match(/<summary>([\s\S]*?)<\/summary>/i);
  const summary = (match ? match[1] : cleaned)
    .replace(/<\/?analysis>/gi, '')
    .replace(/<\/?summary>/gi, '')
    .trim();
  return compactTextWithBoundary(summary, MODEL_COMPACT_MAX_SUMMARY_CHARS, 'model compact summary');
}

function stripMarkdownFence(value: string): string {
  return value
    .replace(/^```[a-zA-Z0-9_-]*\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function isPromptTooLongError(message: string): boolean {
  return /prompt.*too.*long|context.*length|maximum context|too many tokens|413|input.*too.*long|контекст|токен/i.test(String(message || ''));
}
