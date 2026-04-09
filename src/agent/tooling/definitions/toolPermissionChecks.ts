import * as path from 'path';
import * as vscode from 'vscode';
import { hasStudiedFile, normalizeStudyPath } from '../studyContext';

export interface ToolPermissionCheckContext {
  query?: string;
  studiedFiles?: Set<string>;
}

export interface ToolPermissionCheckResult {
  allowed: boolean;
  message?: string;
}

export type ToolPermissionChecker = (
  args: any,
  context: ToolPermissionCheckContext,
) => ToolPermissionCheckResult | Promise<ToolPermissionCheckResult>;

export const BLOCKED_SHELL_PATTERNS = [
  /\brm\s+-rf\s+[\/~]/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bsudo\b/i,
  /\bchmod\s+777/i,
  /\bcurl\b.*\|\s*(ba)?sh/i,
  /\bgit\s+push\b.*--force(?:-with-lease)?\b/i,
  /\bgit\s+reset\b.*--hard\b/i,
  /\bgit\s+clean\b.*\-(?:fd|df|xfd|xdf)\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bkillall\b/i,
  /\bpkill\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

function allow(): ToolPermissionCheckResult {
  return { allowed: true };
}

function block(message: string): ToolPermissionCheckResult {
  return { allowed: false, message };
}

function normalizeUserPath(rawPath: any): string {
  return String(rawPath || '').trim().replace(/\\/g, '/');
}

function validateWorkspaceRelativePath(rawPath: any, label: string): ToolPermissionCheckResult {
  const value = normalizeUserPath(rawPath);
  if (!value) return allow();
  if (value.startsWith('~') || path.isAbsolute(value)) {
    return block(`Путь для "${label}" должен быть относительным к workspace, абсолютные пути запрещены.`);
  }

  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../')) {
    return block(`Путь для "${label}" выходит за пределы workspace и заблокирован.`);
  }

  return allow();
}

function validateWorkspaceRelativePaths(rawPaths: any, label: string): ToolPermissionCheckResult {
  if (!Array.isArray(rawPaths)) return allow();
  for (const rawPath of rawPaths) {
    const result = validateWorkspaceRelativePath(rawPath, label);
    if (!result.allowed) return result;
  }
  return allow();
}

function validateWorkspaceCwd(rawCwd: any): ToolPermissionCheckResult {
  const value = String(rawCwd || '').trim();
  if (!value) return allow();
  if (!path.isAbsolute(value)) return allow();

  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return block('Workspace не открыт, поэтому внешняя cwd запрещена.');

  const resolved = path.resolve(value);
  const insideWorkspace = folders.some((folder) => {
    const root = path.resolve(folder.uri.fsPath);
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });

  return insideWorkspace
    ? allow()
    : block('Shell cwd должна находиться внутри открытого workspace.');
}

function buildReadBeforeEditMessage(filePath: string, mode: 'file' | 'notebook' = 'file'): string {
  const normalizedPath = normalizeStudyPath(filePath);
  const nextStep = mode === 'notebook'
    ? `{"tool":"read_file","args":{"path":"${normalizedPath}","outputMode":"head","limit":120}}`
    : `{"tool":"read_file","args":{"path":"${normalizedPath}","outputMode":"outline"}}`;

  return (
    `Сначала прочитай ${mode === 'notebook' ? 'ноутбук' : 'файл'} "${normalizedPath}" хотя бы один раз перед правкой.\n` +
    'Это защищает от слепой перезаписи и ближе к безопасному режиму редактирования.\n' +
    `Следующим шагом используй:\n${nextStep}`
  );
}

async function requirePriorStudy(
  rawPath: any,
  label: string,
  context: ToolPermissionCheckContext,
  mode: 'file' | 'notebook' = 'file',
): Promise<ToolPermissionCheckResult> {
  const pathCheck = validateWorkspaceRelativePath(rawPath, label);
  if (!pathCheck.allowed) return pathCheck;

  const filePath = normalizeUserPath(rawPath);
  if (!filePath) return allow();
  if (hasStudiedFile(context.studiedFiles, filePath)) return allow();

  return block(buildReadBeforeEditMessage(filePath, mode));
}

export function isShellCommandBlocked(command: string): boolean {
  return BLOCKED_SHELL_PATTERNS.some((pattern) => pattern.test(command));
}

export const TOOL_PERMISSION_CHECKERS: Partial<Record<string, ToolPermissionChecker>> = {
  list_files(args) {
    return validateWorkspaceRelativePath(args?.path || args?.dir || args?.target_directory, 'list_files');
  },
  read_file(args) {
    return validateWorkspaceRelativePath(args?.path, 'read_file');
  },
  read_file_range(args) {
    return validateWorkspaceRelativePath(args?.path, 'read_file_range');
  },
  extract_symbols(args) {
    return validateWorkspaceRelativePath(args?.path, 'extract_symbols');
  },
  dependencies(args) {
    const singlePath = validateWorkspaceRelativePath(args?.path, 'dependencies');
    if (!singlePath.allowed) return singlePath;
    return validateWorkspaceRelativePaths(args?.paths, 'dependencies');
  },
  read_lints(args) {
    const singlePath = validateWorkspaceRelativePath(args?.path, 'read_lints');
    if (!singlePath.allowed) return singlePath;
    return validateWorkspaceRelativePaths(args?.paths, 'read_lints');
  },
  get_diagnostics(args) {
    const singlePath = validateWorkspaceRelativePath(args?.path, 'get_diagnostics');
    if (!singlePath.allowed) return singlePath;
    return validateWorkspaceRelativePaths(args?.paths, 'get_diagnostics');
  },
  glob(args) {
    return validateWorkspaceRelativePath(args?.target_directory || args?.directory || args?.dir, 'glob');
  },
  find_files(args) {
    return validateWorkspaceRelativePath(args?.target_directory || args?.directory || args?.dir, 'find_files');
  },
  lsp_inspect(args) {
    return validateWorkspaceRelativePath(args?.path || args?.file_path, 'lsp_inspect');
  },
  async str_replace(args, context) {
    return requirePriorStudy(args?.path, 'str_replace', context);
  },
  async write_file(args, context) {
    const pathCheck = validateWorkspaceRelativePath(args?.path, 'write_file');
    if (!pathCheck.allowed) return pathCheck;

    const filePath = normalizeUserPath(args?.path);
    if (!filePath) return allow();

    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) return allow();
    const exactTarget = vscode.Uri.joinPath(root, filePath);
    try {
      await vscode.workspace.fs.stat(exactTarget);
    } catch {
      return allow();
    }

    return requirePriorStudy(filePath, 'write_file', context);
  },
  delete_file(args) {
    return validateWorkspaceRelativePath(args?.path, 'delete_file');
  },
  async edit_notebook(args, context) {
    return requirePriorStudy(args?.target_notebook || args?.path || args?.notebook, 'edit_notebook', context, 'notebook');
  },
  shell(args) {
    const command = String(args?.command || args?.cmd || '');
    if (isShellCommandBlocked(command)) {
      return block(`Команда заблокирована: "${command}"`);
    }
    const cwdCheck = validateWorkspaceCwd(args?.cwd || args?.working_directory);
    return cwdCheck.allowed ? allow() : cwdCheck;
  },
};

export async function checkToolPermissions(
  toolName: string,
  args: any,
  context: ToolPermissionCheckContext = {},
): Promise<ToolPermissionCheckResult> {
  const checker = TOOL_PERMISSION_CHECKERS[toolName];
  return checker ? await checker(args || {}, context) : allow();
}
