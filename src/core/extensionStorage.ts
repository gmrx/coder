import * as os from 'os';
import * as path from 'path';

let storageRootPath = '';
const fallbackStorageRootPath = path.join(os.tmpdir(), 'cursorcoder-vscode-storage');

function normalizeFsPath(value: string | undefined | null): string {
  const text = String(value || '').trim();
  return text ? path.resolve(text) : '';
}

export function initExtensionStoragePath(fsPath: string | undefined | null): void {
  storageRootPath = normalizeFsPath(fsPath);
}

export function getExtensionStoragePath(): string {
  return storageRootPath || fallbackStorageRootPath;
}

export function getExtensionStorageSubdir(...segments: string[]): string {
  const root = getExtensionStoragePath();
  return path.join(root, ...segments);
}
