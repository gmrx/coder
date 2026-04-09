import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { WorkspaceChangeControllerState } from './changeController';

export class ChangeStateStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  read(conversationId: string): WorkspaceChangeControllerState | null {
    const filePath = this.getFilePath(conversationId);
    if (!filePath) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed as WorkspaceChangeControllerState : null;
    } catch {
      return null;
    }
  }

  async write(conversationId: string, state: WorkspaceChangeControllerState): Promise<void> {
    const filePath = this.getFilePath(conversationId);
    if (!filePath) return;
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await fsp.writeFile(tempPath, JSON.stringify(state), 'utf8');
    await fsp.rename(tempPath, filePath);
  }

  async delete(conversationId: string): Promise<void> {
    const filePath = this.getFilePath(conversationId);
    if (!filePath) return;
    try {
      await fsp.unlink(filePath);
    } catch {
      // Ignore missing files.
    }
  }

  private getFilePath(conversationId: string): string {
    const storageUri = this.context.storageUri || this.context.globalStorageUri;
    if (!storageUri?.fsPath) return '';
    const safeId = encodeURIComponent(String(conversationId || '').trim() || 'default');
    return path.join(storageUri.fsPath, 'change-states', `${safeId}.json`);
  }
}
