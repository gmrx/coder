import type { AgentTodoItem, AgentTodoStatus } from './types';

const MAX_TODOS = 8;

export type TodoWriteResult = {
  todos: AgentTodoItem[];
  changed: boolean;
  clearedCompleted: boolean;
  verificationNudgeNeeded: boolean;
  content: string;
};

export function normalizeTodoItems(input: any): AgentTodoItem[] {
  const rawItems = Array.isArray(input?.todos) ? input.todos : Array.isArray(input) ? input : [];
  const todos = rawItems
    .map((item: any, index: number) => normalizeTodoItem(item, index))
    .filter((item: AgentTodoItem | null): item is AgentTodoItem => !!item)
    .slice(0, MAX_TODOS);

  if (todos.length === 0) return [];

  const hasIncomplete = todos.some((todo: AgentTodoItem) => todo.status !== 'completed');
  if (!hasIncomplete) {
    return [];
  }

  let inProgressSeen = false;
  for (const todo of todos) {
    if (todo.status !== 'in_progress') continue;
    if (!inProgressSeen) {
      inProgressSeen = true;
      continue;
    }
    todo.status = 'pending';
  }

  if (!inProgressSeen) {
    const firstPending = todos.find((todo: AgentTodoItem) => todo.status === 'pending');
    if (firstPending) {
      firstPending.status = 'in_progress';
    }
  }

  return todos;
}

export function applyTodoWriteUpdate(
  previousTodos: AgentTodoItem[],
  input: any,
  options: { mutationQuery: boolean; verificationAlreadyUsed: boolean },
): TodoWriteResult {
  const nextTodos = normalizeTodoItems(input);
  const changed = JSON.stringify(previousTodos) !== JSON.stringify(nextTodos);
  const rawTodos = Array.isArray(input?.todos) ? input.todos : Array.isArray(input) ? input : [];
  const allCompleted = rawTodos.length > 0 && nextTodos.length === 0;
  const verificationMentioned = rawTodos.some((todo: any) => /verif|провер|тест|регресс/i.test(String(todo?.content || '')));
  const verificationNudgeNeeded =
    options.mutationQuery &&
    !options.verificationAlreadyUsed &&
    rawTodos.length >= 3 &&
    allCompleted &&
    !verificationMentioned;

  return {
    todos: nextTodos,
    changed,
    clearedCompleted: allCompleted,
    verificationNudgeNeeded,
    content: buildTodoWriteSummary(previousTodos, nextTodos, changed, allCompleted),
  };
}

function normalizeTodoItem(item: any, index: number): AgentTodoItem | null {
  if (!item || typeof item !== 'object') return null;
  const content = normalizeText(item.content || item.text || item.label);
  if (!content) return null;
  const activeForm = normalizeText(item.activeForm || item.active || item.inProgressText) || content;
  const status = normalizeStatus(item.status);
  return {
    id: normalizeText(item.id) || `todo-${index + 1}`,
    content,
    activeForm,
    status,
  };
}

function normalizeText(value: any): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 160) : '';
}

function normalizeStatus(value: any): AgentTodoStatus {
  return value === 'completed' || value === 'in_progress' ? value : 'pending';
}

function buildTodoWriteSummary(
  previousTodos: AgentTodoItem[],
  nextTodos: AgentTodoItem[],
  changed: boolean,
  clearedCompleted: boolean,
): string {
  if (clearedCompleted) {
    return 'Список задач обновлён: все задачи завершены, активный список очищен.';
  }

  if (!changed) {
    return nextTodos.length > 0
      ? `Список задач оставлен без изменений: ${formatTodoSummary(nextTodos)}`
      : 'Список задач пуст и не изменился.';
  }

  return nextTodos.length > 0
    ? `Список задач обновлён.\nБыло: ${formatTodoSummary(previousTodos)}\nСтало: ${formatTodoSummary(nextTodos)}`
    : 'Список задач очищен.';
}

function formatTodoSummary(todos: AgentTodoItem[]): string {
  if (!todos.length) return 'нет активных задач';
  return todos
    .map((todo) => `${statusLabel(todo.status)} ${todo.content}`)
    .join(' • ');
}

function statusLabel(status: AgentTodoStatus): string {
  if (status === 'completed') return '[готово]';
  if (status === 'in_progress') return '[в работе]';
  return '[ожидает]';
}
