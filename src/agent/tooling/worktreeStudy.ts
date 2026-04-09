import type { StructuredPresentationSection } from './presentationItems';
import type { AgentWorktreeSession } from '../worktreeSession';

export interface WorktreePresentation {
  action: 'enter' | 'keep' | 'remove';
  state: 'success' | 'blocked' | 'error';
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  originalRootPath?: string;
  sections?: StructuredPresentationSection[];
}

function buildSections(session: Partial<AgentWorktreeSession> & { worktreePath?: string; worktreeBranch?: string; originalRootPath?: string }): StructuredPresentationSection[] {
  const items = [
    session.worktreePath
      ? {
        title: 'Worktree',
        subtitle: session.worktreePath,
        meta: session.worktreeBranch || '',
      }
      : null,
    session.originalRootPath
      ? {
        title: 'Исходный root',
        subtitle: session.originalRootPath,
        meta: '',
      }
      : null,
  ].filter(Boolean) as Array<{ title: string; subtitle: string; meta?: string }>;

  return items.length > 0 ? [{ title: 'Контекст', items }] : [];
}

export function buildEnterWorktreePresentation(
  session: AgentWorktreeSession,
): WorktreePresentation {
  return {
    action: 'enter',
    state: 'success',
    summary: 'Перешёл в worktree',
    detail: session.worktreeBranch
      ? `Ветка ${session.worktreeBranch} • root переключён на worktree`
      : 'Root переключён на worktree',
    preview: [
      `Worktree: ${session.worktreePath}`,
      session.worktreeBranch ? `Ветка: ${session.worktreeBranch}` : '',
      `Исходный root: ${session.originalWorkspaceRootPath}`,
    ].filter(Boolean).join('\n'),
    nextStep: 'Дальше работай уже внутри worktree: читай, редактируй и проверяй проект как обычно.',
    worktreePath: session.worktreePath,
    worktreeBranch: session.worktreeBranch,
    originalRootPath: session.originalWorkspaceRootPath,
    sections: buildSections({
      worktreePath: session.worktreePath,
      worktreeBranch: session.worktreeBranch,
      originalRootPath: session.originalWorkspaceRootPath,
    }),
  };
}

export function buildExitWorktreePresentation(params: {
  action: 'keep' | 'remove';
  worktreePath: string;
  worktreeBranch?: string;
  originalRootPath: string;
  discardedFiles?: number;
  discardedCommits?: number;
}): WorktreePresentation {
  const discardedParts = [
    params.discardedFiles ? `${params.discardedFiles} файлов` : '',
    params.discardedCommits ? `${params.discardedCommits} коммитов` : '',
  ].filter(Boolean);
  const removed = params.action === 'remove';

  return {
    action: params.action,
    state: 'success',
    summary: removed ? 'Вышел и удалил worktree' : 'Вышел из worktree',
    detail: removed
      ? discardedParts.length > 0
        ? `Удалён worktree и ветка • отброшено: ${discardedParts.join(', ')}`
        : 'Удалён worktree и связанная ветка'
      : 'Worktree сохранён на диске, root возвращён к исходному проекту',
    preview: [
      `Был worktree: ${params.worktreePath}`,
      params.worktreeBranch ? `Ветка: ${params.worktreeBranch}` : '',
      `Текущий root: ${params.originalRootPath}`,
    ].filter(Boolean).join('\n'),
    nextStep: removed
      ? 'Теперь можно продолжать работу в основном проекте без изолированного worktree.'
      : `Если позже нужно вернуться, открой ${params.worktreePath} как workspace root или заново войди в новый worktree.`,
    worktreePath: params.worktreePath,
    worktreeBranch: params.worktreeBranch,
    originalRootPath: params.originalRootPath,
    sections: buildSections({
      worktreePath: params.worktreePath,
      worktreeBranch: params.worktreeBranch,
      originalRootPath: params.originalRootPath,
    }),
  };
}

export function buildBlockedWorktreePresentation(params: {
  action: 'enter' | 'keep' | 'remove';
  message: string;
  worktreePath?: string;
  worktreeBranch?: string;
  originalRootPath?: string;
}): WorktreePresentation {
  return {
    action: params.action,
    state: 'blocked',
    summary: 'Worktree-действие не выполнено',
    detail: params.message,
    preview: params.worktreePath || params.originalRootPath
      ? [
        params.worktreePath ? `Worktree: ${params.worktreePath}` : '',
        params.worktreeBranch ? `Ветка: ${params.worktreeBranch}` : '',
        params.originalRootPath ? `Root: ${params.originalRootPath}` : '',
      ].filter(Boolean).join('\n')
      : params.message,
    worktreePath: params.worktreePath,
    worktreeBranch: params.worktreeBranch,
    originalRootPath: params.originalRootPath,
    sections: buildSections(params),
  };
}

export function buildErroredWorktreePresentation(params: {
  action: 'enter' | 'keep' | 'remove';
  message: string;
  worktreePath?: string;
  worktreeBranch?: string;
  originalRootPath?: string;
}): WorktreePresentation {
  return {
    action: params.action,
    state: 'error',
    summary: 'Worktree-действие завершилось с ошибкой',
    detail: params.message,
    preview: params.message,
    worktreePath: params.worktreePath,
    worktreeBranch: params.worktreeBranch,
    originalRootPath: params.originalRootPath,
    sections: buildSections(params),
  };
}
