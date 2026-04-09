import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface AgentWorktreeSession {
  slug: string;
  worktreePath: string;
  worktreeBranch?: string;
  worktreeFolderName: string;
  canonicalRootPath: string;
  originalWorkspaceRootPath: string;
  originalWorkspaceFolderName?: string;
  originalHeadCommit?: string;
  createdAt: number;
}

let activeWorktreeSession: AgentWorktreeSession | null = null;

function normalizeFsPath(value: string | undefined | null): string {
  return path.resolve(String(value || ''));
}

function sameFsPath(left: string | undefined | null, right: string | undefined | null): boolean {
  if (!left || !right) return false;
  return normalizeFsPath(left) === normalizeFsPath(right);
}

function cloneSession(session: AgentWorktreeSession | null | undefined): AgentWorktreeSession | null {
  if (!session) return null;
  return {
    ...session,
  };
}

function getFolderIndexByPath(targetPath: string): number {
  const folders = vscode.workspace.workspaceFolders || [];
  return folders.findIndex((folder) => sameFsPath(folder.uri.fsPath, targetPath));
}

function replacePrimaryWorkspaceFolder(nextPath: string, nextName?: string): boolean {
  const folders = vscode.workspace.workspaceFolders || [];
  const nextUri = vscode.Uri.file(nextPath);

  if (folders.length === 0) {
    return vscode.workspace.updateWorkspaceFolders(0, 0, {
      uri: nextUri,
      ...(nextName ? { name: nextName } : {}),
    });
  }

  if (sameFsPath(folders[0].uri.fsPath, nextPath)) {
    return true;
  }

  return vscode.workspace.updateWorkspaceFolders(0, 1, {
    uri: nextUri,
    ...(nextName ? { name: nextName } : {}),
  });
}

function removeDuplicateFolder(targetPath: string): void {
  const index = getFolderIndexByPath(targetPath);
  if (index <= 0) return;
  vscode.workspace.updateWorkspaceFolders(index, 1);
}

export function getActiveWorktreeSession(): AgentWorktreeSession | null {
  return cloneSession(activeWorktreeSession);
}

export function setActiveWorktreeSession(session: AgentWorktreeSession | null): void {
  activeWorktreeSession = cloneSession(session);
}

export function getAgentWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) return undefined;

  if (activeWorktreeSession) {
    const active = folders.find((folder) => sameFsPath(folder.uri.fsPath, activeWorktreeSession!.worktreePath));
    if (active) return active;
  }

  return folders[0];
}

export function getAgentWorkspaceRootUri(): vscode.Uri | undefined {
  return getAgentWorkspaceFolder()?.uri;
}

export function getAgentWorkspaceRootPath(): string | undefined {
  return getAgentWorkspaceFolder()?.uri.fsPath;
}

export function isUriInAgentWorkspace(uri: vscode.Uri): boolean {
  const root = getAgentWorkspaceRootPath();
  if (!root) return false;
  const relative = path.relative(root, uri.fsPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function toAgentRelativePath(uri: vscode.Uri): string {
  const root = getAgentWorkspaceRootPath();
  if (!root) return vscode.workspace.asRelativePath(uri, false);
  const relative = path.relative(root, uri.fsPath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return relative.replace(/\\/g, '/');
  }
  return vscode.workspace.asRelativePath(uri, false);
}

export function toAgentWorkspaceUri(relativePath: string): vscode.Uri | undefined {
  const root = getAgentWorkspaceRootUri();
  if (!root) return undefined;
  return vscode.Uri.joinPath(root, String(relativePath || '').replace(/\\/g, '/'));
}

export function createAgentRelativePattern(glob: string): vscode.GlobPattern {
  const folder = getAgentWorkspaceFolder();
  return folder ? new vscode.RelativePattern(folder, glob) : glob;
}

export function listAgentWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
  const primary = getAgentWorkspaceFolder();
  return primary ? [primary] : [];
}

export function applyWorktreeSession(session: AgentWorktreeSession | null): boolean {
  if (!session) {
    const current = activeWorktreeSession;
    if (!current) return true;

    const restored = replacePrimaryWorkspaceFolder(
      current.originalWorkspaceRootPath,
      current.originalWorkspaceFolderName,
    );
    if (restored) {
      removeDuplicateFolder(current.worktreePath);
      activeWorktreeSession = null;
    }
    return restored;
  }

  if (!fs.existsSync(session.worktreePath)) {
    const current = activeWorktreeSession;
    if (current) {
      replacePrimaryWorkspaceFolder(
        current.originalWorkspaceRootPath,
        current.originalWorkspaceFolderName,
      );
    }
    activeWorktreeSession = null;
    return false;
  }

  const applied = replacePrimaryWorkspaceFolder(session.worktreePath, session.worktreeFolderName);
  if (applied) {
    removeDuplicateFolder(session.originalWorkspaceRootPath);
    activeWorktreeSession = cloneSession(session);
  }
  return applied;
}
