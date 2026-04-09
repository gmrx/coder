import type { AssistantConfig } from '../core/types';

export type SettingsSectionId = 'models' | 'mcp' | 'web';

export interface SettingsModelIssue {
  kind: 'chat-model-missing';
  model: string;
  message: string;
  detail: string;
}

export interface SettingsPanelRequest {
  section?: SettingsSectionId;
  modelSelectionIssue?: SettingsModelIssue | null;
  highlightModelSelectionIssue?: boolean;
}

const CHAT_MODEL_MISSING_PATTERNS: RegExp[] = [
  /не обнаружен адрес инференса/i,
  /модель.+не найден/i,
  /не найдена модель/i,
  /model.+not found/i,
  /unknown model/i,
  /unsupported model/i,
  /invalid model/i,
  /does not exist/i,
];

export function buildMissingChatModelIssueFromCatalog(
  config: Pick<AssistantConfig, 'model'>,
  availableModels: string[],
): SettingsModelIssue | null {
  const model = String(config.model || '').trim();
  if (!model || !Array.isArray(availableModels) || availableModels.length === 0) {
    return null;
  }
  if (availableModels.includes(model)) {
    return null;
  }
  return {
    kind: 'chat-model-missing',
    model,
    message: `Модель "${model}" не найдена в списке доступных моделей. Нужно выбрать chat-модель из списка.`,
    detail: `Сервис вернул ${availableModels.length} моделей, но "${model}" среди них нет. Откройте раздел «Модели», проверьте подключение и выберите модель из списка.`,
  };
}

export function detectChatModelIssueFromText(
  text: string,
  config: Pick<AssistantConfig, 'model'>,
): SettingsModelIssue | null {
  const source = String(text || '').trim();
  if (!source) {
    return null;
  }
  if (!CHAT_MODEL_MISSING_PATTERNS.some((pattern) => pattern.test(source))) {
    return null;
  }
  const model = String(config.model || '').trim();
  return {
    kind: 'chat-model-missing',
    model,
    message: model
      ? `Модель "${model}" не найдена в списке доступных моделей или для неё нет адреса инференса. Нужно выбрать другую chat-модель.`
      : 'Chat-модель не выбрана или недоступна. Нужно выбрать chat-модель в настройках.',
    detail: model
      ? `Текущая chat-модель: "${model}". Откройте раздел «Модели», загрузите список моделей и выберите рабочую chat-модель.`
      : 'Откройте раздел «Модели», проверьте подключение и выберите chat-модель из списка.',
  };
}

export function buildChatModelIssueAnswer(issue: SettingsModelIssue): string {
  return `${issue.message} Я открыл настройки в разделе «Модели». Выберите модель и повторите запрос.`;
}
