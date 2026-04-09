import * as vscode from 'vscode';
import { sendEmbeddingsRequest } from '../../core/api';
import {
  CODE_EXTENSIONS_WITH_DATA_RE,
  IGNORE_PATTERN,
  MAX_FILE_SIZE,
  SEARCHABLE_EXTENSIONS,
  SEARCHABLE_EXTENSIONS_BARE,
} from '../../core/constants';
import { readWorkspaceText } from './workspace';
import { getAgentWorkspaceFolder, toAgentRelativePath } from '../worktreeSession';

interface SemanticChunk {
  path: string;
  text: string;
  startLine: number;
}

interface SemanticIndex {
  cacheKey: string;
  fingerprint: string;
  chunks: SemanticChunk[];
  embeddings: number[][];
}

interface SemanticIndexOptions {
  apiBaseUrl: string;
  apiKey: string;
  embeddingsModel: string;
  targetDirectory?: string;
  signal?: AbortSignal;
}

const MAX_CACHED_INDEXES = 4;
const semanticIndexCache = new Map<string, SemanticIndex>();

export async function getSemanticIndex(options: SemanticIndexOptions): Promise<SemanticIndex | null> {
  const folder = getAgentWorkspaceFolder();
  if (!folder) return null;

  let glob: vscode.GlobPattern = SEARCHABLE_EXTENSIONS;
  if (options.targetDirectory) {
    glob = new vscode.RelativePattern(vscode.Uri.joinPath(folder.uri, options.targetDirectory), SEARCHABLE_EXTENSIONS_BARE);
  } else {
    glob = new vscode.RelativePattern(folder, SEARCHABLE_EXTENSIONS_BARE);
  }

  const allUris = await vscode.workspace.findFiles(glob, IGNORE_PATTERN, 500);
  const codeUris = allUris.filter((uri) => CODE_EXTENSIONS_WITH_DATA_RE.test(uri.fsPath)).slice(0, 200);
  if (codeUris.length === 0) return null;

  const fileFingerprints: string[] = [];
  for (const uri of codeUris) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      fileFingerprints.push(`${toAgentRelativePath(uri)}:${stat.mtime}:${stat.size}`);
    } catch {
      fileFingerprints.push(`${toAgentRelativePath(uri)}:missing`);
    }
  }

  const cacheKey = [
    folder.uri.toString(),
    options.targetDirectory || '.',
    options.embeddingsModel,
  ].join('::');
  const fingerprint = fileFingerprints.join('|');

  const cached = semanticIndexCache.get(cacheKey);
  if (cached && cached.fingerprint === fingerprint) {
    semanticIndexCache.delete(cacheKey);
    semanticIndexCache.set(cacheKey, cached);
    return cached;
  }

  const chunks: SemanticChunk[] = [];
  for (const uri of codeUris) {
    try {
      const text = await readWorkspaceText(uri);
      if (text.length > MAX_FILE_SIZE) continue;

      const relativePath = toAgentRelativePath(uri);
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index += 30) {
        const chunkText = lines.slice(index, index + 40).join('\n');
        if (chunkText.trim().length < 20) continue;
        chunks.push({
          path: relativePath,
          text: chunkText.slice(0, 800),
          startLine: index + 1,
        });
      }
    } catch {
      // Skip unreadable files.
    }
  }

  if (chunks.length === 0) return null;

  const embeddings: number[][] = [];
  const chunkTexts = chunks.map((chunk) => `${chunk.path}:${chunk.startLine}\n${chunk.text}`);
  for (let index = 0; index < chunkTexts.length; index += 50) {
    try {
      embeddings.push(...await sendEmbeddingsRequest(
        options.apiBaseUrl,
        options.apiKey,
        options.embeddingsModel,
        chunkTexts.slice(index, index + 50),
        { signal: options.signal },
      ));
    } catch {
      for (let offset = 0; offset < Math.min(50, chunkTexts.length - index); offset++) {
        embeddings.push([]);
      }
    }
  }

  const builtIndex: SemanticIndex = { cacheKey, fingerprint, chunks, embeddings };
  semanticIndexCache.set(cacheKey, builtIndex);
  while (semanticIndexCache.size > MAX_CACHED_INDEXES) {
    const oldestKey = semanticIndexCache.keys().next().value;
    if (!oldestKey) break;
    semanticIndexCache.delete(oldestKey);
  }

  return builtIndex;
}
