import type { AgentQuestionRequest, AgentQuestionResult } from '../../runtime/questions';
import { getAgentWorkspaceRootPath } from '../../worktreeSession';
import { readSkillContentSync, resolveSkillByNameSync, searchAvailableSkillsSync } from '../../skills/discovery';
import { buildToolSearchResult } from '../definitions/toolSearch';
import {
  buildAskUserBlockedPresentation,
  buildAskUserResultContent,
  buildAskUserSuccessPresentation,
  normalizeAskUserQuestions,
} from '../questionStudy';
import {
  buildSkillLoadedPresentation,
  buildSkillNotFoundPresentation,
  buildSkillToolSearchResult,
  formatSkillLoadedResult,
  formatSkillNotFoundResult,
  isExplicitSkillQuery,
} from '../skillStudy';
import { createToolExecutionResult } from '../results';
import type { ToolHandlerMap } from '../types';

function createQuestionConfirmId(): string {
  return `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const catalogToolHandlers: ToolHandlerMap = {
  async tool_search(args) {
    const query = String(args?.query || args?.intent || args?.task || '').trim();
    const limit = typeof args?.limit === 'number' && args.limit > 0 ? args.limit : 8;
    if (!query) {
      const content = '(укажи "query" — какую capability или тип инструмента нужно найти)';
      return createToolExecutionResult('tool_search', 'error', content, {
        presentation: {
          kind: 'tool_search',
          data: {
            query: '',
            matchCount: 0,
            summary: 'Каталог не помог',
            detail: 'Запрос не указан',
            preview: content,
            tools: [],
          },
        },
      });
    }

    const workspaceRoot = getAgentWorkspaceRootPath() || process.cwd();
    const baseResult = buildToolSearchResult(query, limit);
    const skillMatches = searchAvailableSkillsSync(query, workspaceRoot, Math.min(Math.max(limit, 1), 6));
    const useSkills = skillMatches.length > 0 && (isExplicitSkillQuery(query) || baseResult.presentation.matchCount === 0 || skillMatches[0].exact);
    const result = useSkills
      ? buildSkillToolSearchResult(query, skillMatches, baseResult.presentation.tools[0])
      : baseResult;
    return createToolExecutionResult('tool_search', 'success', result.content, {
      presentation: {
        kind: 'tool_search',
        data: result.presentation,
      },
    });
  },
  async skill(args) {
    const rawName = String(args?.name || args?.skill || args?.command || '').trim();
    const workspaceRoot = getAgentWorkspaceRootPath() || process.cwd();
    const resolved = resolveSkillByNameSync(rawName, workspaceRoot);

    if (!resolved.skill) {
      const content = formatSkillNotFoundResult(rawName, resolved.suggestions);
      return createToolExecutionResult('skill', 'error', content, {
        presentation: {
          kind: 'skill',
          data: buildSkillNotFoundPresentation(rawName, resolved.suggestions),
        },
      });
    }

    const markdown = readSkillContentSync(resolved.skill);
    const content = formatSkillLoadedResult(resolved.skill, markdown, args);
    return createToolExecutionResult('skill', 'success', content, {
      presentation: {
        kind: 'skill',
        data: buildSkillLoadedPresentation(resolved.skill, markdown, args),
      },
    });
  },
  async ask_user(args, context) {
    const questions = normalizeAskUserQuestions(args?.questions);
    if (!context.onEvent) {
      const content = 'Ошибка: ask_user недоступен без runtime interaction flow.';
      return createToolExecutionResult('ask_user', 'error', content, {
        presentation: {
          kind: 'ask_user',
          data: buildAskUserBlockedPresentation(questions, content),
        },
      });
    }

    const request: AgentQuestionRequest = {
      kind: 'question',
      confirmId: createQuestionConfirmId(),
      title: String(args?.title || 'Нужно уточнение пользователя'),
      description: String(args?.description || 'Выберите вариант ответа, чтобы я продолжил выполнение.'),
      toolName: 'ask_user',
      questions,
    };

    const result = await context.onEvent('question-request', request.title, request) as AgentQuestionResult | undefined;
    if (result?.answered) {
      const content = buildAskUserResultContent(result.answers || {}, undefined, questions);
      return createToolExecutionResult('ask_user', 'success', content, {
        presentation: {
          kind: 'ask_user',
          data: buildAskUserSuccessPresentation(questions, result.answers || {}),
        },
      });
    }

    const reason = result?.cancelled
      ? (result.reason || 'Ожидание ответа пользователя прервано.')
      : 'Пользователь не выбрал ответ.';
    return createToolExecutionResult('ask_user', 'blocked', buildAskUserResultContent({}, reason, questions), {
      presentation: {
        kind: 'ask_user',
        data: buildAskUserBlockedPresentation(questions, reason),
      },
    });
  },
};
