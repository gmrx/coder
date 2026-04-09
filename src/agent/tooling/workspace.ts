import * as vscode from 'vscode';
import { IGNORE_PATTERN } from '../../core/constants';
import { decoder } from '../../core/utils';
import {
  createAgentRelativePattern,
  getAgentWorkspaceRootUri,
  toAgentWorkspaceUri,
} from '../worktreeSession';

export function normalizeOutputMode(mode: string | undefined): 'content' | 'files_with_matches' | 'count' {
  const value = (mode || 'content').toLowerCase();
  if (value === 'files' || value === 'files_with_matches') return 'files_with_matches';
  if (value === 'count') return 'count';
  return 'content';
}

export async function resolveWorkspaceUri(filePath: string): Promise<vscode.Uri | null> {
  const root = getAgentWorkspaceRootUri();
  if (!root || !filePath) return null;

  const exact = toAgentWorkspaceUri(filePath);
  if (!exact) return null;
  try {
    await vscode.workspace.fs.stat(exact);
    return exact;
  } catch {
    // Fall back to workspace search when the model gives an inexact path.
  }

  const found = await vscode.workspace.findFiles(createAgentRelativePattern(`**/${filePath}`), IGNORE_PATTERN, 1);
  if (found.length > 0) return found[0];

  const normalized = filePath.replace(/^\.?\//, '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const baseName = parts[parts.length - 1];
    const parentHint = parts.slice(0, -1).join('/');
    const inParent = await vscode.workspace.findFiles(createAgentRelativePattern(`**/${parentHint}/**/${baseName}`), IGNORE_PATTERN, 2);
    if (inParent.length === 1) return inParent[0];
  }

  if (parts.length > 0) {
    const baseName = parts[parts.length - 1];
    const byName = await vscode.workspace.findFiles(createAgentRelativePattern(`**/${baseName}`), IGNORE_PATTERN, 2);
    if (byName.length === 1) return byName[0];
  }

  return null;
}

export function extractFileHintsFromText(text: string): string[] {
  if (!text) return [];

  const seen = new Set<string>();
  const add = (value: string) => {
    const cleaned = value
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/[),;:.]+$/g, '');

    if (!cleaned || cleaned.length < 3) return;
    if (cleaned.includes(' ') && !cleaned.includes('/')) return;
    if (/[а-яА-Я]/.test(cleaned)) return;

    if (cleaned.includes('/')) {
      if (cleaned.endsWith('/')) {
        seen.add(cleaned);
        return;
      }
      if (!/\.[a-z0-9]{1,8}$/i.test(cleaned)) {
        const lastSegment = cleaned.split('/').filter(Boolean).pop() || '';
        if (lastSegment.length < 8) return;
      }
      seen.add(cleaned);
      return;
    }

    if (/^\./.test(cleaned) || /\.[a-z0-9]{2,5}$/i.test(cleaned)) {
      seen.add(cleaned);
    }
  };

  const tokenRe = /(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+|\.[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{2,5})/g;
  const matches = text.match(tokenRe) || [];
  for (const match of matches) add(match);

  return [...seen].slice(0, 8);
}

export async function readWorkspaceText(uri: vscode.Uri): Promise<string> {
  return decoder.decode(await readWorkspaceBytes(uri));
}

export async function readWorkspaceBytes(uri: vscode.Uri): Promise<Uint8Array> {
  return vscode.workspace.fs.readFile(uri);
}

export function isLikelyBinaryContent(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;

  const sample = bytes.slice(0, Math.min(bytes.length, 4096));
  let suspicious = 0;

  for (const value of sample) {
    if (value === 0) return true;
    if (value <= 6 || (value >= 14 && value <= 31)) suspicious++;
  }

  return suspicious / sample.length > 0.18;
}
