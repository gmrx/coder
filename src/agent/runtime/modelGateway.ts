import { readConfig, sendChatRequest } from '../../core/api';
import { isConfigValid } from '../../core/utils';
import type { ChatUsage, RetryNotice } from '../../core/modelClient';
import type { ChatMessage } from '../../core/types';
import type { AgentRuntimeConfig, AgentRuntimeContext, AgentRequestOptions, AgentTurnExecutionParams } from './types';

export type AgentRuntimeInitResult =
  | { ok: true; runtime: AgentRuntimeContext }
  | { ok: false; error: string };

export function createAgentRuntime(
  params: Pick<AgentTurnExecutionParams, 'signal'> & {
    onContextRequest?: (messages: ChatMessage[], model: string) => void;
    onContextUsage?: (messages: ChatMessage[], model: string, usage: ChatUsage) => void;
  },
): AgentRuntimeInitResult {
  const config = snapshotConfig(readConfig());
  if (!isConfigValid(config)) {
    return {
      ok: false,
      error: 'Ошибка: не настроены API-параметры (URL, ключ, модель). Откройте вкладку «Настройки».',
    };
  }

  return {
    ok: true,
    runtime: {
      config,
      requestChat: (
        messages,
        options: AgentRequestOptions,
        onRetry?: (notice: RetryNotice) => void,
      ) => {
        params.onContextRequest?.(messages, config.model);
        return sendChatRequest(config.apiBaseUrl, config.apiKey, config.model, messages, {
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          retryUntilSuccess: options.retryUntilSuccess,
          signal: params.signal,
          onRetry,
          onUsage: (usage) => {
            params.onContextUsage?.(messages, config.model, usage);
          },
        });
      },
    },
  };
}

function snapshotConfig(config: ReturnType<typeof readConfig>): AgentRuntimeConfig {
  return {
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
    model: config.model,
    embeddingsModel: config.embeddingsModel,
    rerankModel: config.rerankModel,
  };
}
