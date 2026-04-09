import type { AgentApprovalRequest } from './approvals';
import type { AgentQuestionRequest } from './questions';
import type { AgentTodoItem } from './types';

function compactText(text: string | undefined, maxLength = 180): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

export function summarizeApprovalRequest(
  request: AgentApprovalRequest,
): { summary: string; detail: string } {
  if (request.kind === 'shell') {
    return {
      summary: 'Жду подтверждения команды',
      detail: compactText(request.command, 160),
    };
  }

  if (request.kind === 'plan') {
    return {
      summary: 'Жду согласования плана',
      detail: compactText(request.description || request.plan, 160),
    };
  }

  if (request.kind === 'worktree') {
    return {
      summary: request.action === 'enter'
        ? 'Жду подтверждения создания worktree'
        : request.action === 'remove'
          ? 'Жду подтверждения удаления worktree'
          : 'Жду подтверждения выхода из worktree',
      detail: compactText(request.summary || request.worktreePath || request.originalRootPath, 160),
    };
  }

  if (request.kind === 'mcp') {
    return {
      summary: 'Жду подтверждения MCP tool',
      detail: compactText(
        request.summary || `${request.server} • ${request.mcpToolName}`,
        160,
      ),
    };
  }

  if (request.kind === 'web') {
    return {
      summary: 'Жду подтверждения загрузки URL',
      detail: compactText(
        request.summary || `${request.host} • ${request.url}`,
        160,
      ),
    };
  }

  return {
    summary: 'Жду подтверждения изменения файла',
    detail: compactText(request.filePath, 160),
  };
}

export function summarizeQuestionRequest(
  request: AgentQuestionRequest,
): { summary: string; detail: string } {
  const firstQuestion = request.questions[0];
  return {
    summary: 'Жду ответа пользователя',
    detail: compactText(
      firstQuestion
        ? `${firstQuestion.header}: ${firstQuestion.question}`
        : (request.description || request.title || ''),
      180,
    ),
  };
}

export function summarizeModeChange(
  mode: 'plan' | 'normal',
  text?: string,
): { summary: string; detail: string } {
  return {
    summary: mode === 'plan' ? 'Работаю в режиме плана' : 'Продолжаю обычный запуск',
    detail: compactText(text || '', 180),
  };
}

export function summarizePlanApprovalStatus(
  status: 'requested' | 'approved' | 'rejected' | 'cancelled',
  text?: string,
): { summary: string; detail: string } {
  if (status === 'requested') {
    return {
      summary: 'Жду согласования плана',
      detail: compactText(text || '', 180),
    };
  }

  if (status === 'approved') {
    return {
      summary: 'План согласован',
      detail: compactText(text || '', 180),
    };
  }

  if (status === 'cancelled') {
    return {
      summary: 'Согласование плана прервано',
      detail: compactText(text || '', 180),
    };
  }

  return {
    summary: 'Дорабатываю план',
    detail: compactText(text || '', 180),
  };
}

export function summarizeTodoUpdate(
  todos: AgentTodoItem[],
): { summary: string; detail: string } {
  const items = Array.isArray(todos) ? todos : [];
  const allCompleted = items.length > 0 && items.every((todo) => todo && todo.status === 'completed');
  const active = items.find((todo) => todo && todo.status === 'in_progress');
  const lastCompleted = [...items].reverse().find((todo) => todo && todo.status === 'completed');

  if (allCompleted) {
    return {
      summary: 'План работ завершён',
      detail: compactText(lastCompleted?.content || (items.length > 0 ? `задач: ${items.length}` : ''), 180),
    };
  }

  if (active?.activeForm) {
    return {
      summary: 'План работ обновлён',
      detail: compactText(active.activeForm, 180),
    };
  }

  if (active?.content) {
    return {
      summary: 'План работ обновлён',
      detail: compactText(active.content, 180),
    };
  }

  return {
    summary: 'План работ обновлён',
    detail: items.length > 0 ? `задач: ${items.length}` : '',
  };
}

export function summarizeSubagentBatch(
  tasks: Array<{ label?: string; purpose?: string }> | undefined,
): { summary: string; detail: string } {
  const items = Array.isArray(tasks) ? tasks : [];
  if (items.length === 0) {
    return { summary: 'Запускаю волну подагентов', detail: '' };
  }

  const labels = items
    .map((task) => compactText(task?.label || task?.purpose || '', 48))
    .filter(Boolean)
    .slice(0, 3);

  return {
    summary: 'Запускаю волну подагентов',
    detail:
      labels.length > 0
        ? labels.join(' • ') + (items.length > labels.length ? ` +${items.length - labels.length}` : '')
        : `задач: ${items.length}`,
  };
}
