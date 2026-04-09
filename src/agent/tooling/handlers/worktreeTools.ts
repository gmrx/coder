import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildToolApprovalRequest } from '../catalog';
import { applyWorktreeSession, getActiveWorktreeSession, getAgentWorkspaceFolder, type AgentWorktreeSession } from '../../worktreeSession';
import { createToolExecutionResult } from '../results';
import type { AgentApprovalResult } from '../../runtime/approvals';
import type { ToolHandlerMap } from '../types';
import {
  buildBlockedWorktreePresentation,
  buildEnterWorktreePresentation,
  buildErroredWorktreePresentation,
  buildExitWorktreePresentation,
} from '../worktreeStudy';

type GitResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const WORKTREE_BASE_DIR = '.ai-assistant-worktrees';

function normalizeSlug(raw: string | undefined): string {
  const value = String(raw || '').trim();
  if (value) return value;
  return `session-${Date.now().toString(36)}`;
}

function buildWorktreeBranch(slug: string): string {
  return `codex/worktree/${slug.replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/\/+/g, '/')}`;
}

function buildWorktreeFolderName(rootPath: string, slug: string): string {
  return `${path.basename(rootPath)} @ ${slug}`;
}

function buildWorktreePath(rootPath: string, slug: string): string {
  return path.join(
    path.dirname(rootPath),
    WORKTREE_BASE_DIR,
    path.basename(rootPath),
    slug.replace(/\//g, '--'),
  );
}

async function execGit(args: string[], cwd: string): Promise<GitResult> {
  const { execFile } = await import('child_process');
  return new Promise<GitResult>((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, LANG: 'en_US.UTF-8' },
      },
      (error: any, stdout: string, stderr: string) => {
        resolve({
          code: typeof error?.code === 'number' ? error.code : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

async function resolveCanonicalGitRoot(cwd: string): Promise<string | null> {
  const commonDir = await execGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (commonDir.code === 0) {
    const value = commonDir.stdout.trim();
    if (value) {
      if (path.basename(value) === '.git') {
        return fs.realpathSync.native ? fs.realpathSync.native(path.dirname(value)) : fs.realpathSync(path.dirname(value));
      }
      return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
    }
  }

  const topLevel = await execGit(['rev-parse', '--show-toplevel'], cwd);
  if (topLevel.code !== 0) return null;
  const value = topLevel.stdout.trim();
  if (!value) return null;
  return fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
}

async function resolveHeadCommit(cwd: string): Promise<string | undefined> {
  const result = await execGit(['rev-parse', 'HEAD'], cwd);
  return result.code === 0 ? result.stdout.trim() || undefined : undefined;
}

async function countWorktreeChanges(
  worktreePath: string,
  originalHeadCommit: string | undefined,
): Promise<{ changedFiles: number; commits: number } | null> {
  const status = await execGit(['-C', worktreePath, 'status', '--porcelain'], worktreePath);
  if (status.code !== 0) return null;
  const changedFiles = status.stdout.split('\n').map((line) => line.trim()).filter(Boolean).length;

  if (!originalHeadCommit) return null;
  const commits = await execGit(['-C', worktreePath, 'rev-list', '--count', `${originalHeadCommit}..HEAD`], worktreePath);
  if (commits.code !== 0) return null;
  return {
    changedFiles,
    commits: parseInt(commits.stdout.trim(), 10) || 0,
  };
}

async function confirmWorktreeAction(
  toolName: 'enter_worktree' | 'exit_worktree',
  payload: {
    action: 'enter' | 'keep' | 'remove';
    title: string;
    description: string;
    summary: string;
    worktreePath: string;
    worktreeBranch?: string;
    originalRootPath: string;
    slug?: string;
    destructive?: boolean;
  },
  onEvent: ((phase: string, message: string, meta?: any) => void | Promise<any>) | undefined,
): Promise<AgentApprovalResult | undefined> {
  if (!onEvent) return { kind: 'worktree', confirmId: '', approved: true };
  const confirmId = `worktree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const request = buildToolApprovalRequest(toolName, {
    confirmId,
    ...payload,
  });
  if (!request) return { kind: 'worktree', confirmId, approved: true };
  return onEvent('approval-request', request.title, request) as Promise<AgentApprovalResult | undefined>;
}

function buildEnterMessage(session: AgentWorktreeSession): string {
  const lines = [
    `Создан worktree: ${session.worktreePath}`,
    session.worktreeBranch ? `Ветка: ${session.worktreeBranch}` : '',
    `Исходный root: ${session.originalWorkspaceRootPath}`,
    '',
    'Сессия агента переключена в worktree. Следующие file/shell действия будут работать уже там.',
  ].filter(Boolean);
  return lines.join('\n');
}

function buildExitMessage(params: {
  action: 'keep' | 'remove';
  worktreePath: string;
  worktreeBranch?: string;
  originalRootPath: string;
  discardedFiles?: number;
  discardedCommits?: number;
}): string {
  const lines = [
    params.action === 'remove'
      ? `Worktree удалён: ${params.worktreePath}`
      : `Выход из worktree выполнен: ${params.worktreePath}`,
    params.worktreeBranch ? `Ветка: ${params.worktreeBranch}` : '',
    `Текущий root: ${params.originalRootPath}`,
  ];

  if (params.action === 'remove' && (params.discardedFiles || params.discardedCommits)) {
    lines.push(
      `Отброшено: ${params.discardedFiles || 0} файлов, ${params.discardedCommits || 0} коммитов.`,
    );
  }

  lines.push('');
  lines.push(
    params.action === 'remove'
      ? 'Сессия агента вернулась в исходный проект, временный worktree удалён.'
      : 'Сессия агента вернулась в исходный проект, worktree сохранён.',
  );

  return lines.join('\n');
}

export const worktreeToolHandlers: ToolHandlerMap = {
  async enter_worktree(args, context) {
    if (context.worktreeSession || getActiveWorktreeSession()) {
      const message = 'Уже есть активная worktree-сессия. Сначала используй exit_worktree.';
      return createToolExecutionResult('enter_worktree', 'blocked', message, {
        presentation: {
          kind: 'worktree',
          data: buildBlockedWorktreePresentation({ action: 'enter', message }),
        },
      });
    }

    const folder = getAgentWorkspaceFolder();
    if (!folder) {
      const message = 'Workspace не открыт. EnterWorktreeTool требует открытый git-проект.';
      return createToolExecutionResult('enter_worktree', 'error', message, {
        presentation: {
          kind: 'worktree',
          data: buildErroredWorktreePresentation({ action: 'enter', message }),
        },
      });
    }

    const canonicalRoot = await resolveCanonicalGitRoot(folder.uri.fsPath);
    if (!canonicalRoot) {
      const message = `Папка "${folder.uri.fsPath}" не выглядит как git-репозиторий.`;
      return createToolExecutionResult('enter_worktree', 'error', message, {
        presentation: {
          kind: 'worktree',
          data: buildErroredWorktreePresentation({
            action: 'enter',
            message,
            originalRootPath: folder.uri.fsPath,
          }),
        },
      });
    }

    const slug = normalizeSlug(args?.name);
    const worktreeBranch = buildWorktreeBranch(slug);
    const worktreePath = buildWorktreePath(canonicalRoot, slug);

    if (fs.existsSync(worktreePath)) {
      const message = `Worktree path уже существует: ${worktreePath}`;
      return createToolExecutionResult('enter_worktree', 'blocked', message, {
        presentation: {
          kind: 'worktree',
          data: buildBlockedWorktreePresentation({
            action: 'enter',
            message,
            worktreePath,
            worktreeBranch,
            originalRootPath: folder.uri.fsPath,
          }),
        },
      });
    }

    const approval = await confirmWorktreeAction(
      'enter_worktree',
      {
        action: 'enter',
        title: 'Подтвердите создание worktree',
        description: 'Будет создана отдельная git worktree-ветка и root сессии переключится в неё.',
        summary: `Создать worktree "${slug}" и переключить агента в неё`,
        worktreePath,
        worktreeBranch,
        originalRootPath: folder.uri.fsPath,
        slug,
      },
      context.onEvent,
    );
    const autoApproved = approval?.reason === 'auto_approved';

    if (!approval) {
      const message = `Создание worktree не выполнено: подтверждение не получено для "${slug}".`;
      return createToolExecutionResult('enter_worktree', 'blocked', message, {
        presentation: {
          kind: 'worktree',
          data: buildBlockedWorktreePresentation({ action: 'enter', message, worktreePath, worktreeBranch, originalRootPath: folder.uri.fsPath }),
        },
      });
    }
    if (approval.cancelled) {
      const message = `Создание worktree прервано: ожидание подтверждения остановлено для "${slug}".`;
      return createToolExecutionResult('enter_worktree', 'blocked', message, {
        presentation: {
          kind: 'worktree',
          data: buildBlockedWorktreePresentation({ action: 'enter', message, worktreePath, worktreeBranch, originalRootPath: folder.uri.fsPath }),
        },
      });
    }
    if (!approval.approved) {
      const message = `Создание worktree отклонено пользователем: "${slug}"`;
      return createToolExecutionResult('enter_worktree', 'blocked', message, {
        presentation: {
          kind: 'worktree',
          data: buildBlockedWorktreePresentation({ action: 'enter', message, worktreePath, worktreeBranch, originalRootPath: folder.uri.fsPath }),
        },
      });
    }

    try {
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
      const created = await execGit(['worktree', 'add', '-b', worktreeBranch, worktreePath], canonicalRoot);
      if (created.code !== 0) {
        const message = created.stderr.trim() || created.stdout.trim() || `git worktree add завершился с кодом ${created.code}`;
        return createToolExecutionResult('enter_worktree', 'error', message, {
          presentation: {
            kind: 'worktree',
            data: buildErroredWorktreePresentation({
              action: 'enter',
              message,
              worktreePath,
              worktreeBranch,
              originalRootPath: folder.uri.fsPath,
            }),
          },
        });
      }

      const realWorktreePath = fs.realpathSync.native ? fs.realpathSync.native(worktreePath) : fs.realpathSync(worktreePath);
      const session: AgentWorktreeSession = {
        slug,
        worktreePath: realWorktreePath,
        worktreeBranch,
        worktreeFolderName: buildWorktreeFolderName(canonicalRoot, slug),
        canonicalRootPath: canonicalRoot,
        originalWorkspaceRootPath: folder.uri.fsPath,
        originalWorkspaceFolderName: folder.name,
        originalHeadCommit: await resolveHeadCommit(canonicalRoot),
        createdAt: Date.now(),
      };

      if (!applyWorktreeSession(session)) {
        const message = `Worktree создан, но VS Code не смог переключить root на "${realWorktreePath}".`;
        return createToolExecutionResult('enter_worktree', 'error', message, {
          presentation: {
            kind: 'worktree',
            data: buildErroredWorktreePresentation({
              action: 'enter',
              message,
              worktreePath: realWorktreePath,
              worktreeBranch,
              originalRootPath: folder.uri.fsPath,
            }),
          },
        });
      }

      context.setWorktreeSession?.(session);
      const content = buildEnterMessage(session);
      return createToolExecutionResult('enter_worktree', 'success', content, {
        autoApproved,
        presentation: {
          kind: 'worktree',
          data: buildEnterWorktreePresentation(session),
        },
      });
    } catch (error: any) {
      const message = `Ошибка: ${error?.message || error}`;
      return createToolExecutionResult('enter_worktree', 'error', message, {
        presentation: {
          kind: 'worktree',
          data: buildErroredWorktreePresentation({
            action: 'enter',
            message,
            worktreePath,
            worktreeBranch,
            originalRootPath: folder.uri.fsPath,
          }),
        },
      });
    }
  },

  async exit_worktree(args, context) {
    const session = context.worktreeSession || getActiveWorktreeSession();
    const action = String(args?.action || '').trim().toLowerCase() === 'remove' ? 'remove' : 'keep';

    if (!session) {
      const message = 'Нет активной worktree-сессии. ExitWorktreeTool работает только после enter_worktree.';
      return createToolExecutionResult('exit_worktree', 'blocked', message, {
        presentation: {
          kind: 'worktree',
          data: buildBlockedWorktreePresentation({ action, message }),
        },
      });
    }

    if (action === 'remove' && !args?.discard_changes) {
      const summary = await countWorktreeChanges(session.worktreePath, session.originalHeadCommit);
      if (summary === null) {
        const message = `Не удалось безопасно определить состояние worktree "${session.worktreePath}". Для удаления явно подтверди discard_changes=true или используй action="keep".`;
        return createToolExecutionResult('exit_worktree', 'blocked', message, {
          presentation: {
            kind: 'worktree',
            data: buildBlockedWorktreePresentation({
              action,
              message,
              worktreePath: session.worktreePath,
              worktreeBranch: session.worktreeBranch,
              originalRootPath: session.originalWorkspaceRootPath,
            }),
          },
        });
      }
      if (summary.changedFiles > 0 || summary.commits > 0) {
        const message = `Worktree содержит ${summary.changedFiles} незакоммиченных файлов и ${summary.commits} дополнительных коммитов. Для удаления явно подтверди discard_changes=true или используй action="keep".`;
        return createToolExecutionResult('exit_worktree', 'blocked', message, {
          presentation: {
            kind: 'worktree',
            data: buildBlockedWorktreePresentation({
              action,
              message,
              worktreePath: session.worktreePath,
              worktreeBranch: session.worktreeBranch,
              originalRootPath: session.originalWorkspaceRootPath,
            }),
          },
        });
      }
    }

    const approval = await confirmWorktreeAction(
      'exit_worktree',
      {
        action,
        title: action === 'remove' ? 'Подтвердите удаление worktree' : 'Подтвердите выход из worktree',
        description: action === 'remove'
          ? 'Агент вернётся в исходный root и удалит worktree вместе со связанной веткой.'
          : 'Агент вернётся в исходный root, но сам worktree останется на диске.',
        summary: action === 'remove'
          ? 'Вернуться в исходный root и удалить временный worktree'
          : 'Вернуться в исходный root и оставить worktree на диске',
        worktreePath: session.worktreePath,
        worktreeBranch: session.worktreeBranch,
        originalRootPath: session.originalWorkspaceRootPath,
        slug: session.slug,
        destructive: action === 'remove',
      },
      context.onEvent,
    );
    const autoApproved = approval?.reason === 'auto_approved';

    if (!approval) {
      const message = `Выход из worktree не выполнен: подтверждение не получено для "${session.worktreePath}".`;
      return createToolExecutionResult('exit_worktree', 'blocked', message, {
        presentation: {
          kind: 'worktree',
          data: buildBlockedWorktreePresentation({ action, message, worktreePath: session.worktreePath, worktreeBranch: session.worktreeBranch, originalRootPath: session.originalWorkspaceRootPath }),
        },
      });
    }
    if (approval.cancelled) {
      const message = `Выход из worktree прерван: ожидание подтверждения остановлено для "${session.worktreePath}".`;
      return createToolExecutionResult('exit_worktree', 'blocked', message, {
        presentation: {
          kind: 'worktree',
          data: buildBlockedWorktreePresentation({ action, message, worktreePath: session.worktreePath, worktreeBranch: session.worktreeBranch, originalRootPath: session.originalWorkspaceRootPath }),
        },
      });
    }
    if (!approval.approved) {
      const message = `Выход из worktree отклонён пользователем: "${session.worktreePath}"`;
      return createToolExecutionResult('exit_worktree', 'blocked', message, {
        presentation: {
          kind: 'worktree',
          data: buildBlockedWorktreePresentation({ action, message, worktreePath: session.worktreePath, worktreeBranch: session.worktreeBranch, originalRootPath: session.originalWorkspaceRootPath }),
        },
      });
    }

    try {
      const summary = action === 'remove'
        ? await countWorktreeChanges(session.worktreePath, session.originalHeadCommit)
        : null;

      if (!applyWorktreeSession(null)) {
        const message = `Не удалось вернуть исходный root "${session.originalWorkspaceRootPath}".`;
        return createToolExecutionResult('exit_worktree', 'error', message, {
          presentation: {
            kind: 'worktree',
            data: buildErroredWorktreePresentation({
              action,
              message,
              worktreePath: session.worktreePath,
              worktreeBranch: session.worktreeBranch,
              originalRootPath: session.originalWorkspaceRootPath,
            }),
          },
        });
      }
      context.setWorktreeSession?.(null);

      let discardedFiles = 0;
      let discardedCommits = 0;

      if (action === 'remove') {
        if ((summary?.changedFiles || 0) > 0) {
          discardedFiles = summary?.changedFiles || 0;
          await execGit(['-C', session.worktreePath, 'reset', '--hard'], session.canonicalRootPath);
          await execGit(['-C', session.worktreePath, 'clean', '-fd'], session.canonicalRootPath);
        }
        discardedCommits = summary?.commits || 0;

        const removed = await execGit(['worktree', 'remove', '--force', session.worktreePath], session.canonicalRootPath);
        if (removed.code !== 0) {
          const message = removed.stderr.trim() || removed.stdout.trim() || `git worktree remove завершился с кодом ${removed.code}`;
          return createToolExecutionResult('exit_worktree', 'error', message, {
            presentation: {
              kind: 'worktree',
              data: buildErroredWorktreePresentation({
                action,
                message,
                worktreePath: session.worktreePath,
                worktreeBranch: session.worktreeBranch,
                originalRootPath: session.originalWorkspaceRootPath,
              }),
            },
          });
        }

        if (session.worktreeBranch) {
          await execGit(['branch', '-D', session.worktreeBranch], session.canonicalRootPath);
        }
      }

      const content = buildExitMessage({
        action,
        worktreePath: session.worktreePath,
        worktreeBranch: session.worktreeBranch,
        originalRootPath: session.originalWorkspaceRootPath,
        discardedFiles,
        discardedCommits,
      });
      return createToolExecutionResult('exit_worktree', 'success', content, {
        autoApproved,
        presentation: {
          kind: 'worktree',
          data: buildExitWorktreePresentation({
            action,
            worktreePath: session.worktreePath,
            worktreeBranch: session.worktreeBranch,
            originalRootPath: session.originalWorkspaceRootPath,
            discardedFiles,
            discardedCommits,
          }),
        },
      });
    } catch (error: any) {
      const message = `Ошибка: ${error?.message || error}`;
      return createToolExecutionResult('exit_worktree', 'error', message, {
        presentation: {
          kind: 'worktree',
          data: buildErroredWorktreePresentation({
            action,
            message,
            worktreePath: session.worktreePath,
            worktreeBranch: session.worktreeBranch,
            originalRootPath: session.originalWorkspaceRootPath,
          }),
        },
      });
    }
  },
};
