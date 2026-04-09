import type { DiagnosticsPresentation } from '../diagnostics';
import { getEditPresentationPreview, type EditResultPresentation } from '../editStudy';
import type { FileCollectionPresentation } from '../fileStudy';
import type { GrepPresentation } from '../grepStudy';
import type { LspInspectPresentation } from '../lspStudy';
import type {
  McpAuthPresentation,
  McpResourceReadPresentation,
  McpResourcesPresentation,
  McpToolCallPresentation,
  McpToolsPresentation,
} from '../mcpStudy';
import type { ProjectStudyPresentation } from '../projectStudy';
import type { AskUserResultPresentation } from '../questionStudy';
import type { ReadPresentation } from '../readStudy';
import type { ToolExecutionResult } from '../results';
import type { RelevantFilesPresentation, SemanticSearchPresentation } from '../retrievalStudy';
import { parseShellExecutionPresentation as parseLegacyShellExecutionPresentation } from '../shellStudy';
import type { SkillToolPresentation } from '../skillStudy';
import type { SymbolStudyPresentation } from '../symbolStudy';
import type { TaskPresentation } from '../taskStudy';
import type { ToolSearchPresentation } from './toolSearch';
import {
  parseWebFetchPresentation as parseLegacyWebFetchPresentation,
  parseWebSearchPresentation as parseLegacyWebSearchPresentation,
} from '../webStudy';
import type { WorktreePresentation } from '../worktreeStudy';
import { getToolUserFacingName } from './toolCapabilities';

type ToolPresentationContract = {
  startSummary?: string;
  buildResultSummary?: (execution: ToolExecutionResult) => string;
  compactInTrace?: boolean;
  showResultPreview?: boolean;
  countsAsTool?: boolean;
};

const TOOL_PRESENTATION_CONTRACTS: Partial<Record<string, ToolPresentationContract>> = {
  tool_search: {
    startSummary: 'Подбираю инструмент',
    buildResultSummary(execution) {
      const presentation = getToolSearchPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Каталог не помог' : 'Подобрал инструменты';
    },
    compactInTrace: true,
    showResultPreview: false,
    countsAsTool: false,
  },
  ask_user: {
    startSummary: 'Уточняю вопрос у пользователя',
    buildResultSummary(execution) {
      const presentation = getAskUserPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'blocked' ? 'Ответ пользователя не получен' : 'Получил ответ пользователя';
    },
  },
  skill: {
    startSummary: 'Загружаю навык',
    buildResultSummary(execution) {
      const presentation = getSkillPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Навык не найден' : 'Навык загружен';
    },
  },
  task_create: {
    startSummary: 'Создаю задачу',
    buildResultSummary(execution) {
      const presentation = getTaskPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось создать задачу' : 'Задача создана';
    },
  },
  task_list: {
    startSummary: 'Смотрю task stack',
    buildResultSummary(execution) {
      const presentation = getTaskPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось получить список задач' : 'Собрал список задач';
    },
  },
  task_get: {
    startSummary: 'Проверяю задачу',
    buildResultSummary(execution) {
      const presentation = getTaskPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось прочитать задачу' : 'Статус задачи получен';
    },
  },
  task_update: {
    startSummary: 'Обновляю задачу',
    buildResultSummary(execution) {
      const presentation = getTaskPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось обновить задачу' : 'Задача обновлена';
    },
  },
  task_stop: {
    startSummary: 'Останавливаю задачу',
    buildResultSummary(execution) {
      const presentation = getTaskPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось остановить задачу' : 'Остановка задачи запрошена';
    },
  },
  tool_batch: {
    startSummary: 'Выполняю пакет утилит',
    buildResultSummary(execution) {
      const results = execution.meta?.batchResults || [];
      if (results.length === 0) {
        return execution.status === 'error' ? 'Пакет завершился с ошибкой' : 'Пакет утилит завершён';
      }

      const success = results.filter((result) => result.status === 'success').length;
      const degraded = results.filter((result) => result.status === 'degraded').length;
      const blocked = results.filter((result) => result.status === 'blocked').length;
      const error = results.filter((result) => result.status === 'error').length;
      const parts = [`${results.length} вызова`];

      if (success) parts.push(`${success} ok`);
      if (degraded) parts.push(`${degraded} partial`);
      if (blocked) parts.push(`${blocked} blocked`);
      if (error) parts.push(`${error} error`);

      return `Пакет утилит: ${parts.join(', ')}`;
    },
    showResultPreview: false,
    countsAsTool: false,
  },
  read_file: {
    startSummary: 'Читаю файл',
    buildResultSummary(execution) {
      const presentation = getReadPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Чтение файла завершилось с ошибкой' : 'Прочитал файл';
    },
  },
  read_file_range: {
    startSummary: 'Читаю файл',
    buildResultSummary(execution) {
      const presentation = getReadPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Чтение диапазона завершилось с ошибкой' : 'Прочитал диапазон файла';
    },
  },
  grep: {
    startSummary: 'Ищу по коду',
    buildResultSummary(execution) {
      const presentation = getGrepPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Поиск завершился с ошибкой' : 'Нашёл совпадения';
    },
  },
  semantic_search: {
    startSummary: 'Ищу по смыслу',
    buildResultSummary(execution) {
      const presentation = getSemanticSearchPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Смысловой поиск завершился с ошибкой' : 'Нашёл релевантные фрагменты';
    },
  },
  find_relevant_files: {
    startSummary: 'Подбираю релевантные файлы',
    buildResultSummary(execution) {
      const presentation = getRelevantFilesPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось отобрать релевантные файлы' : 'Отобрал релевантные файлы';
    },
  },
  scan_structure: {
    startSummary: 'Сканирую структуру проекта',
    buildResultSummary(execution) {
      const presentation = getProjectStudyPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Структура проекта не получена' : 'Обновил обзор структуры проекта';
    },
  },
  list_files: {
    startSummary: 'Просматриваю дерево файлов',
    buildResultSummary(execution) {
      const presentation = getFileCollectionPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Список файлов не получен' : 'Обновил дерево файлов';
    },
  },
  find_files: {
    startSummary: 'Ищу файлы по паттерну',
    buildResultSummary(execution) {
      const presentation = getFileCollectionPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Поиск файлов завершился с ошибкой' : 'Нашёл подходящие файлы';
    },
  },
  glob: {
    startSummary: 'Ищу файлы по маске',
    buildResultSummary(execution) {
      const presentation = getFileCollectionPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Поиск по маске завершился с ошибкой' : 'Нашёл файлы по маске';
    },
  },
  detect_stack: {
    startSummary: 'Определяю стек проекта',
    buildResultSummary(execution) {
      const presentation = getProjectStudyPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Стек проекта не определён' : 'Определил стек проекта';
    },
  },
  workspace_symbols: {
    startSummary: 'Ищу символы по проекту',
    buildResultSummary(execution) {
      const presentation = getSymbolStudyPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return 'Нашёл символы';
    },
  },
  lsp_inspect: {
    startSummary: 'Запрашиваю LSP-навигацию',
    buildResultSummary(execution) {
      const presentation = getLspInspectPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'LSP-запрос завершился с ошибкой' : 'LSP-информация получена';
    },
  },
  extract_symbols: {
    startSummary: 'Извлекаю символы файла',
    buildResultSummary(execution) {
      const presentation = getSymbolStudyPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Список символов не получен' : 'Извлёк символы файла';
    },
  },
  dependencies: {
    startSummary: 'Проверяю зависимости',
    buildResultSummary(execution) {
      const presentation = getSymbolStudyPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Сводка зависимостей не получена' : 'Собрал зависимости';
    },
  },
  subagent: {
    startSummary: 'Запускаю подагентов',
    buildResultSummary(execution) {
      return execution.status === 'error' ? 'Подагенты нашли проблемы' : 'Волна подагентов завершена';
    },
  },
  verification_agent: {
    startSummary: 'Проверяю изменения',
    buildResultSummary(execution) {
      const verdict = extractVerdict(execution.content);
      if (verdict === 'PASS') return 'Проверка прошла';
      if (verdict === 'FAIL') return 'Проверка нашла проблему';
      if (verdict === 'PARTIAL') return 'Проверка завершилась частично';
      if (execution.status === 'error') return 'Проверка нашла проблему';
      if (execution.status === 'degraded') return 'Проверка завершилась частично';
      return 'Проверка завершена';
    },
  },
  todo_write: {
    startSummary: 'Обновляю список задач',
    buildResultSummary() {
      return 'Список задач обновлён';
    },
  },
  str_replace: {
    startSummary: 'Редактирую файл',
    buildResultSummary(execution) {
      const presentation = getEditPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      if (execution.status === 'blocked' && /сначала прочитай/i.test(execution.content)) {
        return 'Сначала нужно прочитать файл';
      }
      return execution.status === 'error' ? 'Правка не применилась' : 'Правка применена';
    },
  },
  write_file: {
    startSummary: 'Записываю файл',
    buildResultSummary(execution) {
      const presentation = getEditPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      if (execution.status === 'blocked' && /сначала прочитай/i.test(execution.content)) {
        return 'Нужно прочитать файл перед перезаписью';
      }
      if (execution.status === 'blocked') return 'Запись файла не подтверждена';
      return execution.status === 'error' ? 'Файл не записан' : 'Файл записан';
    },
  },
  delete_file: {
    startSummary: 'Удаляю файл',
    buildResultSummary(execution) {
      const presentation = getEditPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      if (execution.status === 'blocked') return 'Удаление файла не подтверждено';
      return execution.status === 'error' ? 'Файл не удалён' : 'Файл удалён';
    },
  },
  edit_notebook: {
    startSummary: 'Правлю ноутбук',
    buildResultSummary(execution) {
      const presentation = getEditPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      if (execution.status === 'blocked' && /сначала прочитай/i.test(execution.content)) {
        return 'Нужно прочитать notebook перед правкой';
      }
      if (execution.status === 'blocked') return 'Правка notebook не подтверждена';
      return execution.status === 'error' ? 'Ноутбук не изменён' : 'Ноутбук обновлён';
    },
  },
  shell: {
    startSummary: 'Выполняю shell-команду',
    buildResultSummary(execution) {
      const presentation = getShellPresentation(execution);
      if (presentation.status === 'blocked') return 'Команда не выполнена';
      return presentation.summary || 'Команда завершена';
    },
  },
  get_diagnostics: {
    startSummary: 'Проверяю диагностику',
    buildResultSummary(execution) {
      const presentation = getDiagnosticsPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Диагностика не получена' : 'Диагностика получена';
    },
  },
  read_lints: {
    startSummary: 'Проверяю диагностику',
    buildResultSummary(execution) {
      const presentation = getDiagnosticsPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Диагностика не получена' : 'Диагностика получена';
    },
  },
  list_mcp_resources: {
    startSummary: 'Смотрю ресурсы MCP',
    buildResultSummary(execution) {
      const presentation = getMcpResourcesPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось получить список MCP ресурсов' : 'Собрал MCP ресурсы';
    },
  },
  read_mcp_resource: {
    startSummary: 'Читаю MCP ресурс',
    buildResultSummary(execution) {
      const presentation = getMcpResourceReadPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось прочитать MCP ресурс' : 'Прочитал MCP ресурс';
    },
  },
  list_mcp_tools: {
    startSummary: 'Смотрю MCP tools',
    buildResultSummary(execution) {
      const presentation = getMcpToolsPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось получить список MCP tools' : 'Собрал MCP tools';
    },
  },
  mcp_tool: {
    startSummary: 'Вызываю MCP tool',
    buildResultSummary(execution) {
      const presentation = getMcpToolCallPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'MCP tool завершился с ошибкой' : 'Вызов MCP tool завершён';
    },
  },
  mcp_auth: {
    startSummary: 'Выполняю MCP OAuth',
    buildResultSummary(execution) {
      const presentation = getMcpAuthPresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось завершить MCP OAuth' : 'MCP OAuth завершён';
    },
  },
  enter_worktree: {
    startSummary: 'Создаю worktree',
    buildResultSummary(execution) {
      const presentation = getWorktreePresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось создать worktree' : 'Перешёл в worktree';
    },
  },
  exit_worktree: {
    startSummary: 'Завершаю worktree-сессию',
    buildResultSummary(execution) {
      const presentation = getWorktreePresentation(execution);
      if (presentation?.summary) return presentation.summary;
      return execution.status === 'error' ? 'Не удалось завершить worktree-сессию' : 'Вышел из worktree';
    },
  },
  enter_plan_mode: {
    startSummary: 'Перехожу в режим плана',
  },
  exit_plan_mode: {
    startSummary: 'Готовлю план к согласованию',
  },
  web_search: {
    startSummary: 'Ищу в интернете',
    buildResultSummary(execution) {
      const presentation = getWebSearchPresentation(execution);
      if (presentation.summary) return presentation.summary;
      if (/mode:\s*sources\)/i.test(execution.content)) {
        return execution.status === 'degraded' ? 'Подготовил ссылки без подтверждённых веб-результатов' : 'Собрал список веб-источников';
      }
      if (/mode:\s*results\)/i.test(execution.content)) {
        return execution.status === 'degraded' ? 'Поиск без подтверждённых источников' : 'Подготовил веб-результаты со snippets';
      }
      return execution.status === 'degraded' ? 'Поиск без надёжного веб-источника' : 'Подготовил обзор веб-поиска';
    },
  },
  web_fetch: {
    startSummary: 'Загружаю URL',
    buildResultSummary(execution) {
      const presentation = getWebFetchPresentation(execution);
      if (presentation.summary) return presentation.summary;
      if (execution.status === 'error') return 'Не удалось загрузить URL';
      if (/mode:\s*metadata\)/i.test(execution.content)) return 'Собрал метаданные URL';
      if (/content_type:\s*application\/json/i.test(execution.content)) return 'Получил данные JSON по URL';
      if (/mode:\s*content\)/i.test(execution.content)) return 'Получил полный контент по URL';
      return 'Подготовил обзор URL';
    },
  },
};

export function getToolStartSummary(toolName: string): string {
  return TOOL_PRESENTATION_CONTRACTS[toolName]?.startSummary || `Выполняю ${getToolUserFacingName(toolName).toLowerCase()}`;
}

export function getToolResultSummary(toolName: string, execution: ToolExecutionResult): string {
  const summary = TOOL_PRESENTATION_CONTRACTS[toolName]?.buildResultSummary?.(execution);
  if (summary) return summary;
  return `${getToolUserFacingName(toolName)} завершён`;
}

export function getToolResultDetail(toolName: string, execution: ToolExecutionResult): string {
  if (toolName === 'ask_user') {
    const presentation = getAskUserPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'skill') {
    const presentation = getSkillPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'task_create' || toolName === 'task_list' || toolName === 'task_get' || toolName === 'task_update' || toolName === 'task_stop') {
    const presentation = getTaskPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'tool_search') {
    const presentation = getToolSearchPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'scan_structure' || toolName === 'detect_stack') {
    const presentation = getProjectStudyPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'extract_symbols' || toolName === 'dependencies' || toolName === 'workspace_symbols') {
    const presentation = getSymbolStudyPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'lsp_inspect') {
    const presentation = getLspInspectPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'read_file' || toolName === 'read_file_range') {
    const presentation = getReadPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'grep') {
    const presentation = getGrepPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'list_files' || toolName === 'glob' || toolName === 'find_files') {
    const presentation = getFileCollectionPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'get_diagnostics' || toolName === 'read_lints') {
    const presentation = getDiagnosticsPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'list_mcp_resources') {
    const presentation = getMcpResourcesPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'read_mcp_resource') {
    const presentation = getMcpResourceReadPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'list_mcp_tools') {
    const presentation = getMcpToolsPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'mcp_tool') {
    const presentation = getMcpToolCallPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'mcp_auth') {
    const presentation = getMcpAuthPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'enter_worktree' || toolName === 'exit_worktree') {
    const presentation = getWorktreePresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'semantic_search') {
    const presentation = getSemanticSearchPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'find_relevant_files') {
    const presentation = getRelevantFilesPresentation(execution);
    if (presentation) {
      return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }
  if (toolName === 'str_replace' || toolName === 'write_file' || toolName === 'delete_file' || toolName === 'edit_notebook') {
    const presentation = getEditPresentation(execution);
    if (presentation) return presentation.detail;
  }
  if (toolName === 'shell') {
    const presentation = getShellPresentation(execution);
    const parts = [
      presentation.detail,
      presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '',
    ].filter(Boolean);
    return parts.join('\n');
  }
  if (toolName === 'web_search') {
    const presentation = getWebSearchPresentation(execution);
    return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
      .filter(Boolean)
      .join('\n');
  }
  if (toolName === 'web_fetch') {
    const presentation = getWebFetchPresentation(execution);
    return [presentation.detail, presentation.nextStep ? `Следующий шаг: ${presentation.nextStep}` : '']
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function getToolResultPreview(toolName: string, execution: ToolExecutionResult): string {
  if (toolName === 'ask_user') {
    const presentation = getAskUserPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'skill') {
    const presentation = getSkillPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'task_create' || toolName === 'task_list' || toolName === 'task_get' || toolName === 'task_update' || toolName === 'task_stop') {
    const presentation = getTaskPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'tool_search') {
    const presentation = getToolSearchPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'scan_structure' || toolName === 'detect_stack') {
    const presentation = getProjectStudyPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'extract_symbols' || toolName === 'dependencies' || toolName === 'workspace_symbols') {
    const presentation = getSymbolStudyPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'lsp_inspect') {
    const presentation = getLspInspectPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'read_file' || toolName === 'read_file_range') {
    const presentation = getReadPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'grep') {
    const presentation = getGrepPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'list_files' || toolName === 'glob' || toolName === 'find_files') {
    const presentation = getFileCollectionPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'get_diagnostics' || toolName === 'read_lints') {
    const presentation = getDiagnosticsPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
    }
  }
  if (toolName === 'list_mcp_resources') {
    const presentation = getMcpResourcesPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
    }
  }
  if (toolName === 'read_mcp_resource') {
    const presentation = getMcpResourceReadPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
    }
  }
  if (toolName === 'list_mcp_tools') {
    const presentation = getMcpToolsPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
    }
  }
  if (toolName === 'mcp_tool') {
    const presentation = getMcpToolCallPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
    }
  }
  if (toolName === 'mcp_auth') {
    const presentation = getMcpAuthPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
    }
  }
  if (toolName === 'enter_worktree' || toolName === 'exit_worktree') {
    const presentation = getWorktreePresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
      return execution.content || presentation.detail;
    }
  }
  if (toolName === 'semantic_search') {
    const presentation = getSemanticSearchPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
    }
  }
  if (toolName === 'find_relevant_files') {
    const presentation = getRelevantFilesPresentation(execution);
    if (presentation) {
      const parts = [presentation.preview, presentation.nextStep].filter(Boolean);
      if (parts.length > 0) return parts.join('\n\n');
    }
  }
  if (toolName === 'str_replace' || toolName === 'write_file' || toolName === 'delete_file' || toolName === 'edit_notebook') {
    const presentation = getEditPresentation(execution);
    if (presentation) {
      const preview = getEditPresentationPreview(presentation);
      if (preview) return preview;
      if (presentation.detail) return presentation.detail;
    }
  }
  if (toolName === 'shell') {
    const presentation = getShellPresentation(execution);
    if (presentation.outputPreview) return presentation.outputPreview;
    const parts = [presentation.detail, presentation.nextStep].filter(Boolean);
    if (parts.length > 0) return parts.join('\n');
  }
  if (toolName === 'web_search') {
    const presentation = getWebSearchPresentation(execution);
    if (presentation.preview) return presentation.preview;
    const parts = [presentation.detail, presentation.nextStep].filter(Boolean);
    if (parts.length > 0) return parts.join(' • ');
  }
  if (toolName === 'web_fetch') {
    const presentation = getWebFetchPresentation(execution);
    if (presentation.preview) return presentation.preview;
    const parts = [presentation.detail, presentation.nextStep].filter(Boolean);
    if (parts.length > 0) return parts.join(' • ');
  }
  return execution.content || '';
}

export function getToolPresentationMeta(toolName: string): {
  compactInTrace: boolean;
  showResultPreview: boolean;
  countsAsTool: boolean;
} {
  const contract = TOOL_PRESENTATION_CONTRACTS[toolName];
  return {
    compactInTrace: !!contract?.compactInTrace,
    showResultPreview: contract?.showResultPreview !== false,
    countsAsTool: contract?.countsAsTool !== false,
  };
}

function getShellPresentation(execution: ToolExecutionResult) {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'shell') {
    return structured.data;
  }
  return parseLegacyShellExecutionPresentation(execution.content);
}

function getAskUserPresentation(execution: ToolExecutionResult): AskUserResultPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'ask_user') {
    return structured.data;
  }
  return null;
}

function getSkillPresentation(execution: ToolExecutionResult): SkillToolPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'skill') {
    return structured.data;
  }
  return null;
}

function getTaskPresentation(execution: ToolExecutionResult): TaskPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'task') {
    return structured.data;
  }
  return null;
}

function getWebSearchPresentation(execution: ToolExecutionResult) {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'web_search') {
    return structured.data;
  }
  return parseLegacyWebSearchPresentation(execution.content);
}

function getWebFetchPresentation(execution: ToolExecutionResult) {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'web_fetch') {
    return structured.data;
  }
  return parseLegacyWebFetchPresentation(execution.content);
}

function getEditPresentation(execution: ToolExecutionResult): EditResultPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'edit') {
    return structured.data;
  }
  return null;
}

function getReadPresentation(execution: ToolExecutionResult): ReadPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'read') {
    return structured.data;
  }
  return null;
}

function getGrepPresentation(execution: ToolExecutionResult): GrepPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'grep') {
    return structured.data;
  }
  return null;
}

function getFileCollectionPresentation(execution: ToolExecutionResult): FileCollectionPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'file_collection') {
    return structured.data;
  }
  return null;
}

function getProjectStudyPresentation(execution: ToolExecutionResult): ProjectStudyPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'project_study') {
    return structured.data;
  }
  return null;
}

function getSymbolStudyPresentation(execution: ToolExecutionResult): SymbolStudyPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'symbol_study') {
    return structured.data;
  }
  return null;
}

function getLspInspectPresentation(execution: ToolExecutionResult): LspInspectPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'lsp_inspect') {
    return structured.data;
  }
  return null;
}

function getToolSearchPresentation(execution: ToolExecutionResult): ToolSearchPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'tool_search') {
    return structured.data;
  }
  return null;
}

function getWorktreePresentation(execution: ToolExecutionResult): WorktreePresentation | null {
  const presentation = execution.meta?.presentation;
  if (presentation?.kind === 'worktree') return presentation.data;
  return null;
}

function getSemanticSearchPresentation(execution: ToolExecutionResult): SemanticSearchPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'semantic_search') {
    return structured.data;
  }
  return null;
}

function getRelevantFilesPresentation(execution: ToolExecutionResult): RelevantFilesPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'find_relevant_files') {
    return structured.data;
  }
  return null;
}

function getDiagnosticsPresentation(execution: ToolExecutionResult): DiagnosticsPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'diagnostics') {
    return structured.data;
  }
  return null;
}

function getMcpResourcesPresentation(execution: ToolExecutionResult): McpResourcesPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'mcp_resources') {
    return structured.data;
  }
  return null;
}

function getMcpResourceReadPresentation(execution: ToolExecutionResult): McpResourceReadPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'mcp_resource') {
    return structured.data;
  }
  return null;
}

function getMcpToolsPresentation(execution: ToolExecutionResult): McpToolsPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'mcp_tools') {
    return structured.data;
  }
  return null;
}

function getMcpToolCallPresentation(execution: ToolExecutionResult): McpToolCallPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'mcp_tool_call') {
    return structured.data;
  }
  return null;
}

function getMcpAuthPresentation(execution: ToolExecutionResult): McpAuthPresentation | null {
  const structured = execution.meta?.presentation;
  if (structured?.kind === 'mcp_auth') {
    return structured.data;
  }
  return null;
}

function extractVerdict(text: string): string {
  const match = String(text || '').match(/VERDICT:\s*(PASS|FAIL|PARTIAL)\b/i);
  return match ? match[1].toUpperCase() : '';
}
