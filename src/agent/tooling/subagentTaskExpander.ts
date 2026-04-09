import { listAllProjectFiles } from '../../analysis/scanner';
import type { ExecuteToolFn, ToolExecutionContext } from './types';
import { extractFileHintsFromText } from './workspace';
import type { WorkspaceFileCatalogCache } from './subagentTypes';

function normalizeHint(value: string): string {
  return value.trim().replace(/^\.?\//, '').replace(/\\/g, '/');
}

function isLikelyFilePath(value: string): boolean {
  const normalized = normalizeHint(value).replace(/\/+$/, '');
  const lastSegment = normalized.split('/').filter(Boolean).pop() || '';
  return /\.[a-z0-9]{1,8}$/i.test(lastSegment);
}

function isLikelyDirectoryPath(value: string): boolean {
  const normalized = normalizeHint(value);
  if (!normalized || isLikelyFilePath(normalized)) return false;
  return normalized.endsWith('/') || normalized.split('/').filter(Boolean).length >= 2;
}

async function getWorkspaceFiles(cache: WorkspaceFileCatalogCache): Promise<string[]> {
  if (!cache.allFiles) {
    cache.allFiles = listAllProjectFiles().then((groups) => groups.flatMap((group) => group.files));
  }
  return cache.allFiles;
}

function scoreDirectoryCandidate(filePath: string, directory: string, prompt: string): number {
  const normalizedDir = directory.replace(/\/+$/, '');
  const normalizedFile = normalizeHint(filePath);
  const relative = normalizedFile.slice(normalizedDir.length).replace(/^\/+/, '');
  const depth = relative ? relative.split('/').length : 0;
  const base = normalizedFile.split('/').pop()?.toLowerCase() || '';
  const loweredPrompt = (prompt || '').toLowerCase();

  let score = 100 - depth * 8;
  if (/(index|main|app|provider|runner|executor|prompt|tools|api|types|state|controller|registry|config|template)/.test(base)) {
    score += 10;
  }
  if (loweredPrompt.includes(base.replace(/\.[a-z0-9]+$/i, ''))) {
    score += 6;
  }
  if (/readme|test|spec|mock/i.test(base)) {
    score -= 12;
  }
  return score;
}

export async function expandTaskTargets(
  rawTargets: string[] | undefined,
  prompt: string | undefined,
  cache: WorkspaceFileCatalogCache,
): Promise<string[]> {
  const seen = new Set<string>();
  const explicitFiles: string[] = [];
  const directories: string[] = [];

  for (const rawValue of rawTargets || []) {
    const normalized = normalizeHint(rawValue);
    if (!normalized) continue;
    if (isLikelyFilePath(normalized)) {
      if (!seen.has(normalized)) {
        seen.add(normalized);
        explicitFiles.push(normalized);
      }
      continue;
    }
    if (isLikelyDirectoryPath(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      directories.push(normalized.replace(/\/+$/, ''));
    }
  }

  if (directories.length === 0) {
    return explicitFiles.slice(0, 12);
  }

  const allFiles = await getWorkspaceFiles(cache);
  for (const directory of directories) {
    const candidates = allFiles
      .filter((filePath) => filePath.startsWith(directory + '/'))
      .sort((left, right) => {
        const scoreDelta = scoreDirectoryCandidate(right, directory, prompt || '') - scoreDirectoryCandidate(left, directory, prompt || '');
        return scoreDelta !== 0 ? scoreDelta : left.localeCompare(right);
      })
      .slice(0, 8);

    for (const candidate of candidates) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        explicitFiles.push(candidate);
      }
    }
  }

  return explicitFiles.slice(0, 12);
}

export async function inferFilesForPrompt(
  prompt: string,
  executeTool: ExecuteToolFn,
  context: ToolExecutionContext,
  workspaceFileCache: WorkspaceFileCatalogCache,
): Promise<string[]> {
  const direct = extractFileHintsFromText(prompt || '');
  if (direct.length > 0) {
    const expanded = await expandTaskTargets(direct, prompt, workspaceFileCache);
    if (expanded.length > 0) return expanded;
  }

  const inferred = new Set<string>();
  try {
    const stack = await executeTool('detect_stack', {}, context.query, context.onEvent, context.signal);
    for (const file of await expandTaskTargets(extractFileHintsFromText(stack), prompt, workspaceFileCache)) {
      inferred.add(file);
    }
  } catch {
    // Ignore inference failures and keep going.
  }
  try {
    const structure = await executeTool('scan_structure', {}, context.query, context.onEvent, context.signal);
    for (const file of await expandTaskTargets(extractFileHintsFromText(structure), prompt, workspaceFileCache)) {
      inferred.add(file);
    }
  } catch {
    // Ignore inference failures and keep going.
  }

  return [...inferred].slice(0, 10);
}
