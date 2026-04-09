import { MAX_CONTEXT_CHARS } from '../../core/constants';
import type { ChatMessage } from '../../core/types';

const AUTO_COMPACT_THRESHOLD_CHARS = Math.floor(MAX_CONTEXT_CHARS * 0.55);
const COMPACT_KEEP_TAIL_MESSAGES = 8;
const MAX_CONSECUTIVE_COMPACT_FAILURES = 3;

export type AgentCompactionState = {
  compactCount: number;
  consecutiveFailures: number;
  lastCompactedMessageCount: number;
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
): { compacted: boolean; messages: ChatMessage[] } {
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (!sessionSummary) return { compacted: false, messages };
  if (totalChars < AUTO_COMPACT_THRESHOLD_CHARS) return { compacted: false, messages };
  if (messages.length <= COMPACT_KEEP_TAIL_MESSAGES + 2) return { compacted: false, messages };
  if (state.consecutiveFailures >= MAX_CONSECUTIVE_COMPACT_FAILURES) {
    return { compacted: false, messages };
  }

  try {
    const tail = messages.slice(-COMPACT_KEEP_TAIL_MESSAGES);
    const compactedMessages: ChatMessage[] = [
      {
        role: 'user',
        content:
          '[Сводка предыдущего диалога]\n' +
          sessionSummary +
          '\n\nИспользуй эту сводку как память о ранних шагах. Если данных в последних сообщениях хватает, не проси пересказ старой истории.',
      },
      ...tail,
    ];

    state.compactCount++;
    state.consecutiveFailures = 0;
    state.lastCompactedMessageCount = messages.length;
    return {
      compacted: true,
      messages: compactedMessages,
    };
  } catch {
    state.consecutiveFailures++;
    return { compacted: false, messages };
  }
}
