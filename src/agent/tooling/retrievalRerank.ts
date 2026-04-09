import { sendRerankRequest } from '../../core/api';
import type { RankedChunkMatch, RankedFileMatch, RetrievalConfigSnapshot } from './retrievalTypes';

export async function rerankChunkMatches(
  query: string,
  matches: RankedChunkMatch[],
  config: RetrievalConfigSnapshot,
  limit: number,
  signal?: AbortSignal,
): Promise<{ matches: RankedChunkMatch[]; reranked: boolean }> {
  if (!config.rerankModel || matches.length === 0) {
    return { matches, reranked: false };
  }

  try {
    const results = await sendRerankRequest(
      config.apiBaseUrl,
      config.apiKey,
      config.rerankModel,
      query,
      matches.map((match) => `${match.path}:${match.startLine}\n${match.text}`),
      {
        topN: Math.min(Math.max(limit, 1), matches.length),
        signal: createRerankSignal(signal),
      },
    );

    if (!Array.isArray(results) || results.length === 0) {
      return { matches, reranked: false };
    }

    const reranked = results
      .sort((left, right) => (right.relevanceScore ?? right.score ?? 0) - (left.relevanceScore ?? left.score ?? 0))
      .slice(0, limit)
      .map((result) => {
        const source = matches[result.index];
        if (!source) return null;
        return {
          ...source,
          score: result.relevanceScore ?? result.score ?? source.score,
        };
      })
      .filter((value): value is RankedChunkMatch => !!value);

    return reranked.length > 0
      ? { matches: reranked, reranked: true }
      : { matches, reranked: false };
  } catch {
    return { matches, reranked: false };
  }
}

export async function rerankFileMatches(
  query: string,
  matches: RankedFileMatch[],
  config: RetrievalConfigSnapshot,
  limit: number,
  signal?: AbortSignal,
): Promise<{ matches: RankedFileMatch[]; reranked: boolean }> {
  if (!config.rerankModel || matches.length === 0) {
    return { matches, reranked: false };
  }

  try {
    const documents = matches.map((match) => {
      const snippets = match.snippets
        .slice(0, 2)
        .map((snippet) => `${match.path}:${snippet.startLine}\n${snippet.text}`)
        .join('\n\n');
      return `FILE: ${match.path}\n${snippets}`;
    });

    const results = await sendRerankRequest(
      config.apiBaseUrl,
      config.apiKey,
      config.rerankModel,
      query,
      documents,
      {
        topN: Math.min(Math.max(limit, 1), matches.length),
        signal: createRerankSignal(signal),
      },
    );

    if (!Array.isArray(results) || results.length === 0) {
      return { matches, reranked: false };
    }

    const reranked = results
      .sort((left, right) => (right.relevanceScore ?? right.score ?? 0) - (left.relevanceScore ?? left.score ?? 0))
      .slice(0, limit)
      .map((result) => {
        const source = matches[result.index];
        if (!source) return null;
        return {
          ...source,
          score: result.relevanceScore ?? result.score ?? source.score,
        };
      })
      .filter((value): value is RankedFileMatch => !!value);

    return reranked.length > 0
      ? { matches: reranked, reranked: true }
      : { matches, reranked: false };
  } catch {
    return { matches, reranked: false };
  }
}

function createRerankSignal(signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
}
