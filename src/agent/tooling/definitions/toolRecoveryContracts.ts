import type { ToolExecutionStatus } from '../results';
import { getToolUserFacingName } from './toolCapabilities';

type ToolRecoveryContract = {
  blockedSummary?: string;
  blockedPrompt?: string;
  errorSummary?: string;
  errorPrompt?: string;
  degradedSummary?: string;
  degradedPrompt?: string;
  approvalRejectedSummary?: string;
};

const FILE_MUTATION_TOOLS = new Set(['write_file', 'delete_file', 'edit_notebook']);

const TOOL_RECOVERY_CONTRACTS: Partial<Record<string, ToolRecoveryContract>> = {
  str_replace: {
    blockedSummary: 'Собираю контекст перед точечной правкой',
    blockedPrompt:
      'Точная правка сейчас заблокирована.\n' +
      'Либо пользователь не подтвердил действие, либо файл ещё не был прочитан в этой сессии.\n' +
      'Не повторяй ту же правку вслепую: сначала собери контекст через read_file/read_file_range, затем вернись к точечной замене.',
  },
  write_file: {
    blockedSummary: 'Перестраиваю ход после отклонённого изменения',
    blockedPrompt:
      'Запись файла сейчас заблокирована.\n' +
      'Либо пользователь не подтвердил изменение, либо существующий файл ещё не был прочитан в этой сессии.\n' +
      'Не повторяй ту же файловую мутацию сразу.\n' +
      'Сначала прочитай файл и уточни контекст, либо предложи более безопасный вариант.',
    approvalRejectedSummary: 'Изменение не согласовано, пересматриваю следующий шаг',
  },
  delete_file: {
    blockedSummary: 'Перестраиваю ход после отклонённого изменения',
    blockedPrompt:
      'Удаление файла не было подтверждено пользователем.\n' +
      'Не повторяй ту же файловую мутацию сразу.\n' +
      'Либо собери дополнительный контекст и предложи более безопасный вариант, либо честно зафиксируй, что изменение пока не согласовано.',
    approvalRejectedSummary: 'Изменение не согласовано, пересматриваю следующий шаг',
  },
  edit_notebook: {
    blockedSummary: 'Перестраиваю ход после отклонённого изменения',
    blockedPrompt:
      'Правка notebook сейчас заблокирована.\n' +
      'Либо пользователь не подтвердил изменение, либо notebook ещё не был прочитан в этой сессии.\n' +
      'Не повторяй ту же файловую мутацию сразу.\n' +
      'Сначала прочитай notebook и уточни контекст, либо предложи более безопасный вариант.',
    approvalRejectedSummary: 'Изменение не согласовано, пересматриваю следующий шаг',
  },
  shell: {
    blockedSummary: 'Ищу обход без неподтверждённой команды',
    blockedPrompt:
      'Команда не была подтверждена пользователем.\n' +
      'Не повторяй тот же shell-вызов без нового обоснования.\n' +
      'Попробуй сначала read-only шаги: чтение, поиск, diagnostics, retrieval — либо сформулируй более безопасную и точную команду.',
  },
  web_search: {
    degradedSummary: 'Уточняю данные после ограниченного веб-поиска',
    degradedPrompt:
      'Веб-поиск дал ограниченный или ненадёжный результат.\n' +
      'Либо перепроверь данные другим способом, либо явно учитывай ограничение источника в последующих шагах и финальном ответе.',
  },
  verification_agent: {
    errorSummary: 'Исправляю проблему после независимой проверки',
    degradedSummary: 'Добираю проверку после частичной верификации',
  },
  subagent: {
    errorSummary: 'Перезапускаю анализ после неудачной волны подагентов',
    errorPrompt:
      'Волна подагентов завершилась с ошибкой.\n' +
      'Не повторяй тот же батч буквально.\n' +
      'Сузь задачи, укажи файлы или конкретные области и перезапусти только проблемные направления.',
  },
  semantic_search: {
    errorPrompt:
      'Семантический поиск завершился с ошибкой.\n' +
      'Не зацикливайся на том же retrieval-вызове.\n' +
      'Либо измени query/область поиска, либо временно перейди на grep/read_file по конкретным файлам.',
  },
  find_relevant_files: {
    errorPrompt:
      'Подбор релевантных файлов завершился с ошибкой.\n' +
      'Не зацикливайся на том же retrieval-вызове.\n' +
      'Либо измени query/область поиска, либо временно перейди на grep/read_file по конкретным файлам.',
  },
  exit_plan_mode: {
    approvalRejectedSummary: 'Дорабатываю план после замечаний',
  },
};

export function getToolRecoverySummary(
  toolName: string,
  status: Extract<ToolExecutionStatus, 'blocked' | 'error' | 'degraded'>,
): string {
  const contract = TOOL_RECOVERY_CONTRACTS[toolName];
  const label = getToolUserFacingName(toolName).toLowerCase();

  if (status === 'blocked') {
    return contract?.blockedSummary || `Перестраиваю шаг после блокировки: ${label}`;
  }

  if (status === 'degraded') {
    return contract?.degradedSummary || `Уточняю результат после ${label}`;
  }

  return contract?.errorSummary || `Исправляю сбой после ${label}`;
}

export function getToolRecoveryPrompt(
  toolName: string,
  status: Extract<ToolExecutionStatus, 'blocked' | 'error' | 'degraded'>,
): string {
  const contract = TOOL_RECOVERY_CONTRACTS[toolName];
  const label = getToolUserFacingName(toolName);

  if (status === 'blocked') {
    return contract?.blockedPrompt || (
      `${label} был заблокирован или отклонён.\n` +
      'Не повторяй тот же шаг буквально.\n' +
      'Пересмотри следующий ход: измени аргументы, выбери более безопасный инструмент или объясни пользователю ограничение.'
    );
  }

  if (status === 'degraded') {
    return contract?.degradedPrompt || (
      `${label} дал частичный результат.\n` +
      'Используй уже полученные данные, но добери критичные пробелы другим шагом, если без этого нельзя уверенно завершать задачу.'
    );
  }

  return contract?.errorPrompt || (
    `${label} завершился с ошибкой.\n` +
    'Не повторяй идентичный вызов.\n' +
    'Либо измени аргументы, либо выбери другой инструмент, который даст недостающий факт или позволит обойти сбой.'
  );
}

export function getApprovalRejectedRecoverySummary(toolName: string): string {
  const contract = TOOL_RECOVERY_CONTRACTS[toolName];
  if (contract?.approvalRejectedSummary) {
    return contract.approvalRejectedSummary;
  }
  if (FILE_MUTATION_TOOLS.has(toolName)) {
    return 'Изменение не согласовано, пересматриваю следующий шаг';
  }
  return `Пересматриваю шаг после отклонения: ${getToolUserFacingName(toolName).toLowerCase()}`;
}
