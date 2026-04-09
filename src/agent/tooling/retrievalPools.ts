import type { RankedChunkMatch, RankedFileMatch } from './retrievalTypes';

const DEFAULT_CHUNK_POOL = 60;
const DEFAULT_FILE_POOL = 24;

export function selectChunkPool(matches: RankedChunkMatch[], limit: number, maxPool = DEFAULT_CHUNK_POOL): RankedChunkMatch[] {
  const normalizedLimit = clamp(limit, 1, maxPool);
  return matches.slice(0, Math.min(Math.max(normalizedLimit * 4, 20), matches.length, maxPool));
}

export function selectFilePool(matches: RankedFileMatch[], limit: number, maxPool = DEFAULT_FILE_POOL): RankedFileMatch[] {
  const normalizedLimit = clamp(limit, 1, maxPool);
  return matches.slice(0, Math.min(Math.max(normalizedLimit * 3, 12), matches.length, maxPool));
}

export function buildRankedFileMatches(rankedChunks: RankedChunkMatch[]): RankedFileMatch[] {
  const files = new Map<string, RankedFileMatch>();

  for (const chunk of rankedChunks) {
    const existing = files.get(chunk.path);
    if (!existing) {
      files.set(chunk.path, {
        path: chunk.path,
        score: chunk.score,
        topChunkScore: chunk.score,
        snippets: [chunk],
      });
      continue;
    }

    existing.snippets.push(chunk);
    existing.snippets.sort((left, right) => right.score - left.score);
    existing.snippets = existing.snippets.slice(0, 3);
    existing.topChunkScore = Math.max(existing.topChunkScore, chunk.score);
    existing.score = scoreFileMatch(existing.snippets);
  }

  return [...files.values()]
    .sort((left, right) => right.score - left.score)
    .map((match) => ({
      ...match,
      snippets: match.snippets.slice(0, 2),
    }));
}

export function compactSnippetPreview(text: string): string {
  const line = String(text || '')
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.length > 0) || '';
  return line.slice(0, 160);
}

function scoreFileMatch(snippets: RankedChunkMatch[]): number {
  if (snippets.length === 0) return 0;
  const [first, second, third] = snippets;
  return (
    (first?.score || 0) * 0.72 +
    (second?.score || 0) * 0.2 +
    (third?.score || 0) * 0.08
  );
}

function clamp(value: number, min: number, max: number): number {
  const numeric = Number.isFinite(value) ? value : min;
  return Math.min(Math.max(Math.floor(numeric), min), max);
}
