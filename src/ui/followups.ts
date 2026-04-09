import type { AssistantConfig, ChatMessage } from '../core/types';
import { sendChatPromptWithFallback } from './chatPrompt';

export interface FollowupSuggestion {
  label: string;
  query: string;
  hint: string;
}

export type FollowupState = 'starters' | 'waiting' | 'loading' | 'ready' | 'error';

export async function generateFollowupSuggestions(
  config: AssistantConfig,
  recentHistory: ChatMessage[],
): Promise<FollowupSuggestion[]> {
  if (recentHistory.length === 0) {
    return [];
  }

  const summary = recentHistory
    .map((message) => `${message.role}: ${(message.content || '').slice(0, 150).replace(/\n/g, ' ')}`)
    .join('\n');

  const raw = await sendChatPromptWithFallback(
    config.apiBaseUrl,
    config.apiKey,
    config.model,
    {
      systemPrompt: 'Ты помогаешь разработчику продолжать рабочий диалог в IDE. Возвращай только полезные следующие шаги.',
      userPrompt: buildFollowupPrompt(summary),
      fallbackUserPrompt:
        'Сформируй 4 следующих запроса для разработчика по текущему диалогу. ' +
        'Верни только JSON-массив объектов {label, query, hint} без пояснений.\n\n' +
        `Диалог:\n${summary}`,
    },
  );

  return parseSuggestions(raw);
}

export function buildFollowupPrompt(summary: string): string {
  return (
    'На основе последнего обмена в чате предложи 4 следующих полезных действия для разработчика.\n\n' +
    `Диалог:\n${summary}\n\n` +
    'Требования:\n' +
    '- Пиши на языке текущего диалога.\n' +
    '- Каждый вариант должен решать отдельную практическую задачу.\n' +
    '- Не используй пустые формулировки вроде "продолжи" или "расскажи подробнее".\n' +
    '- label: 2-4 слова.\n' +
    '- query: полный следующий запрос к ассистенту.\n' +
    '- hint: очень короткое пояснение, зачем нажимать эту кнопку.\n\n' +
    'Ответь только JSON-массивом:\n' +
    '[{"label":"2-4 слова","query":"полный следующий запрос","hint":"краткая польза"},...]'
  );
}

export function parseSuggestions(raw: string): FollowupSuggestion[] {
  let json = raw.trim();
  const fenced = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    json = fenced[1].trim();
  }

  const start = json.indexOf('[');
  const end = json.lastIndexOf(']');
  if (start >= 0 && end > start) {
    json = json.slice(start, end + 1);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : Array.isArray(parsed?.suggestions)
        ? parsed.suggestions
        : [];

  return items
    .filter((item: any) => item && typeof item.label === 'string' && typeof item.query === 'string')
    .map((item: any) => ({
      label: item.label.trim().slice(0, 36),
      query: item.query.trim().slice(0, 240),
      hint: typeof item.hint === 'string'
        ? item.hint.trim().slice(0, 72)
        : item.query.trim().slice(0, 72),
    }))
    .filter((item: FollowupSuggestion) => item.label && item.query)
    .filter((item: FollowupSuggestion, index: number, array: FollowupSuggestion[]) => {
      return array.findIndex((candidate) => candidate.query === item.query) === index;
    })
    .slice(0, 4);
}
