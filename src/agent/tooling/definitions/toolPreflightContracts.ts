import type { AgentToolSearchRecommendation } from '../../runtime/types';
import {
  buildEditPresentation,
  type EditPresentationChangeType,
} from '../editStudy';
import { buildShellPreflightPresentation } from '../shellStudy';
import {
  buildWebFetchPreflightPresentation,
  buildWebSearchPreflightPresentation,
  normalizeWebFetchOutputMode,
  normalizeWebSearchOutputMode,
} from '../webStudy';
import {
  createToolExecutionResult,
  type ToolExecutionPhase,
  type ToolExecutionRecoveryHint,
  type ToolExecutionResult,
} from '../results';
import { getToolUserFacingName } from './toolCapabilities';
import { getToolDefinition } from './toolPolicies';
import { getToolPromptGroup } from './toolPromptPresentation';
import { isRecommendationRedirectTool, isToolSearchSuggestionTool } from './toolWorkflowDecisions';

export type ToolPreflightPhase = Extract<ToolExecutionPhase, 'validation' | 'permission'>;

type EditPreflightDescriptor = {
  filePath: string;
  changeType: EditPresentationChangeType;
  cellIdx?: number;
  language?: string;
};

function isSpecializedTool(toolName: string): boolean {
  const definition = getToolDefinition(toolName);
  return !!definition && getToolPromptGroup(definition) === 'specialized';
}

function buildToolSearchSelectStep(toolName: string): string {
  return `{"tool":"tool_search","args":{"query":"select:${toolName}"}}`;
}

function shouldRedirectToRecommendation(
  toolName: string,
  recommendation?: AgentToolSearchRecommendation | null,
): boolean {
  return !!recommendation?.toolName &&
    toolName !== recommendation.toolName &&
    isRecommendationRedirectTool(toolName);
}

function resolvePreflightHint(
  toolName: string,
  phase: ToolPreflightPhase,
  recommendation?: AgentToolSearchRecommendation | null,
): ToolExecutionRecoveryHint {
  if (shouldRedirectToRecommendation(toolName, recommendation)) {
    return {
      kind: 'recommended_tool',
      toolName: recommendation!.toolName,
      nextStep: recommendation!.nextStep,
    };
  }

  if (phase === 'validation' && isToolSearchSuggestionTool(toolName)) {
    return { kind: 'tool_search' };
  }

  if (phase === 'validation' && isSpecializedTool(toolName)) {
    return {
      kind: 'adjust_args',
      toolName,
      nextStep: buildToolSearchSelectStep(toolName),
    };
  }

  return { kind: 'adjust_args', toolName };
}

function buildFollowupPrompt(
  toolName: string,
  phase: ToolPreflightPhase,
  hint: ToolExecutionRecoveryHint,
  message: string,
): string {
  const label = getToolUserFacingName(toolName);

  if (hint.kind === 'recommended_tool' && hint.toolName) {
    return (
      `${label} не прошёл preflight-проверку (${phase === 'validation' ? 'некорректные аргументы' : 'ограничение политики'}).\n` +
      `Подходящий следующий инструмент уже найден через tool_search: ${hint.toolName}.\n` +
      'Если это не меняет стратегию, не возвращайся к общим шагам без новой информации.\n' +
      (hint.nextStep
        ? `Следующим ходом лучше использовать:\n${hint.nextStep}`
        : `Следующим ходом лучше вернуть JSON-вызов инструмента ${hint.toolName}.`)
    );
  }

  if (hint.kind === 'tool_search') {
    return (
      `${label} не выглядит лучшим следующим шагом в текущем контексте.\n` +
      'Не зацикливайся на исправлении этого общего вызова.\n' +
      'Сначала вызови tool_search коротким intent-запросом, чтобы выбрать более подходящий специализированный инструмент, а потом переходи к нему.'
    );
  }

  if (phase === 'validation') {
    return (
      `${label} вызван с некорректными аргументами.\n` +
      'Исправь args и повтори вызов только если этот инструмент всё ещё действительно нужен.\n' +
      (hint.nextStep
        ? `Если не помнишь точный формат, сначала вызови:\n${hint.nextStep}\nЗатем повтори инструмент с исправленными args.`
        : 'Если формат вызова неочевиден, сначала уточни его через tool_search или выбери более подходящий инструмент.')
    );
  }

  if (/сначала прочитай/i.test(message)) {
    return (
      `${label} пока нельзя выполнять вслепую.\n` +
      'Сначала прочитай целевой файл в этой сессии, затем повтори изменение уже с точным контекстом.\n' +
      'Если файл большой, начни с read_file overview, потом переходи к read_file_range для нужного участка.'
    );
  }

  return (
    `${label} заблокирован preflight-политикой до выполнения.\n` +
    'Измени аргументы на безопасные или выбери другой инструмент.\n' +
    'Не повторяй этот вызов буквально без новой причины.'
  );
}

function resolveEditPreflightDescriptor(toolName: string, args: any): EditPreflightDescriptor | null {
  if (toolName === 'str_replace') {
    return {
      filePath: String(args?.path || '').trim(),
      changeType: 'edit',
    };
  }

  if (toolName === 'write_file') {
    const filePath = String(args?.path || '').trim();
    if (!filePath) return null;
    return {
      filePath,
      changeType: 'overwrite',
    };
  }

  if (toolName === 'delete_file') {
    return {
      filePath: String(args?.path || '').trim(),
      changeType: 'delete',
    };
  }

  if (toolName === 'edit_notebook') {
    const filePath = String(args?.target_notebook || args?.path || args?.notebook || '').trim();
    const rawCellIdx = args?.cell_idx ?? args?.cell_index;
    return {
      filePath,
      changeType: args?.is_new_cell === true || args?.new_cell === true ? 'notebook-new-cell' : 'notebook-edit-cell',
      ...(typeof rawCellIdx === 'number' ? { cellIdx: rawCellIdx } : {}),
      ...(typeof args?.cell_language === 'string'
        ? { language: args.cell_language }
        : (typeof args?.language === 'string' ? { language: args.language } : {})),
    };
  }

  return null;
}

function buildEditPreflightSummary(toolName: string, phase: ToolPreflightPhase, message: string): string {
  if (phase === 'permission' && /сначала прочитай/i.test(message)) {
    switch (toolName) {
      case 'str_replace':
        return 'Сначала нужно прочитать файл';
      case 'write_file':
        return 'Нужно прочитать файл перед перезаписью';
      case 'edit_notebook':
        return 'Нужно прочитать notebook перед правкой';
      default:
        return 'Нужно сначала собрать контекст';
    }
  }

  if (phase === 'validation') {
    switch (toolName) {
      case 'str_replace':
        return 'Некорректный вызов правки';
      case 'write_file':
        return 'Некорректный вызов записи файла';
      case 'delete_file':
        return 'Некорректный вызов удаления файла';
      case 'edit_notebook':
        return 'Некорректный вызов правки notebook';
      default:
        return 'Некорректный вызов инструмента';
    }
  }

  switch (toolName) {
    case 'str_replace':
      return 'Правка файла заблокирована';
    case 'write_file':
      return 'Запись файла заблокирована';
    case 'delete_file':
      return 'Удаление файла заблокировано';
    case 'edit_notebook':
      return 'Правка notebook заблокирована';
    default:
      return 'Инструмент заблокирован';
  }
}

function buildPreflightPresentation(
  toolName: string,
  args: any,
  phase: ToolPreflightPhase,
  message: string,
):
  | { kind: 'edit'; data: ReturnType<typeof buildEditPresentation> }
  | { kind: 'shell'; data: ReturnType<typeof buildShellPreflightPresentation> }
  | { kind: 'web_search'; data: ReturnType<typeof buildWebSearchPreflightPresentation> }
  | { kind: 'web_fetch'; data: ReturnType<typeof buildWebFetchPreflightPresentation> }
  | null {
  const edit = resolveEditPreflightDescriptor(toolName, args);
  if (edit?.filePath) {
    return {
      kind: 'edit',
      data: buildEditPresentation({
        toolName: toolName as 'str_replace' | 'write_file' | 'delete_file' | 'edit_notebook',
        filePath: edit.filePath,
        changeType: edit.changeType,
        outcome: phase === 'permission' ? 'blocked' : 'error',
        summary: buildEditPreflightSummary(toolName, phase, message),
        detail: message,
        preview: message,
        ...(edit.cellIdx !== undefined ? { cellIdx: edit.cellIdx } : {}),
        ...(edit.language ? { language: edit.language } : {}),
      }),
    };
  }

  if (toolName === 'shell') {
    return {
      kind: 'shell',
      data: buildShellPreflightPresentation(
        String(args?.command || args?.cmd || ''),
        String(args?.cwd || args?.working_directory || ''),
        message,
        phase === 'permission' ? 'blocked' : 'error',
      ),
    };
  }

  if (toolName === 'web_search') {
    return {
      kind: 'web_search',
      data: buildWebSearchPreflightPresentation(
        String(args?.query || args?.search_term || ''),
        normalizeWebSearchOutputMode(args?.outputMode || args?.mode || args?.view),
        message,
      ),
    };
  }

  if (toolName === 'web_fetch') {
    return {
      kind: 'web_fetch',
      data: buildWebFetchPreflightPresentation(
        String(args?.url || ''),
        normalizeWebFetchOutputMode(args?.outputMode || args?.mode || args?.view),
        message,
      ),
    };
  }

  return null;
}

export function createToolPreflightResult(
  toolName: string,
  args: any,
  phase: ToolPreflightPhase,
  message: string,
  recommendation?: AgentToolSearchRecommendation | null,
): ToolExecutionResult {
  const hint = resolvePreflightHint(toolName, phase, recommendation);
  const status = phase === 'permission' ? 'blocked' : 'error';
  const meta = {
    phase,
    recoveryHint: hint,
    followupPrompt: buildFollowupPrompt(toolName, phase, hint, message),
  };

  const presentation = buildPreflightPresentation(toolName, args, phase, message);
  if (presentation) {
    return createToolExecutionResult(toolName, status, message, {
      ...meta,
      presentation,
    });
  }

  return createToolExecutionResult(toolName, status, message, meta);
}
