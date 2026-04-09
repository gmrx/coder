import { sendChatRequest } from '../core/api';
import type { ChatMessage } from '../core/types';

export interface ChatPromptRequest {
  systemPrompt?: string;
  userPrompt: string;
  fallbackUserPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function sendChatProbe(
  apiBaseUrl: string,
  apiKey: string,
  model: string,
  request: string,
): Promise<string> {
  return sendChatPromptWithFallback(
    apiBaseUrl,
    apiKey,
    model,
    {
      systemPrompt: 'Ты помогаешь разработчику. Отвечай кратко и по-русски.',
      userPrompt: request,
      fallbackUserPrompt: `Ответь коротко по-русски на сообщение пользователя.\n\nПользователь: ${request}`,
    },
  );
}

export async function sendChatPromptWithFallback(
  apiBaseUrl: string,
  apiKey: string,
  model: string,
  request: ChatPromptRequest,
): Promise<string> {
  const options = buildChatPromptOptions(request);
  const primaryMessages = buildChatPromptMessages(request.systemPrompt, request.userPrompt);
  const fallbackMessages = buildChatPromptMessages(undefined, request.fallbackUserPrompt || request.userPrompt);
  const attempts = [
    { messages: primaryMessages, options },
    { messages: fallbackMessages, options },
    { messages: primaryMessages, options: undefined },
    { messages: fallbackMessages, options: undefined },
  ];

  let lastError: any;
  const attemptedKeys = new Set<string>();

  for (const attempt of attempts) {
    const key = JSON.stringify({
      messages: attempt.messages,
      hasOptions: !!attempt.options,
      temperature: attempt.options?.temperature,
      maxTokens: attempt.options?.maxTokens,
    });
    if (attemptedKeys.has(key)) continue;
    attemptedKeys.add(key);

    try {
      return await sendChatRequest(
        apiBaseUrl,
        apiKey,
        model,
        attempt.messages,
        attempt.options,
      );
    } catch (error: any) {
      lastError = error;
      if (!isRetryableChatError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Chat request failed'));
}

function buildChatPromptMessages(systemPrompt: string | undefined, userPrompt: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userPrompt });
  return messages;
}

function buildChatPromptOptions(request: ChatPromptRequest) {
  const options: { temperature?: number; maxTokens?: number } = {};
  if (typeof request.temperature === 'number') {
    options.temperature = request.temperature;
  }
  if (typeof request.maxTokens === 'number') {
    options.maxTokens = request.maxTokens;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

function isProxyAssistantTextError(error: any): boolean {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('assistant-сообщения') || message.includes('proxy_error') || message.includes('upstream_error');
}

function isRetryableChatError(error: any): boolean {
  if (isProxyAssistantTextError(error)) return true;
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('unsupported') ||
    message.includes('invalid') ||
    message.includes('temperature') ||
    message.includes('max_tokens') ||
    message.includes('max token') ||
    message.includes('bad request') ||
    message.includes('http 400') ||
    message.includes('http 422')
  );
}
