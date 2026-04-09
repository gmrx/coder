import { readConfig, sendEmbeddingsRequest } from '../../core/api';
import { getSemanticIndex } from './semanticIndex';
import { buildRankedFileMatches } from './retrievalPools';
import type {
  PreparedRetrieval,
  RankedChunkMatch,
  RetrievalPreparationOptions,
} from './retrievalTypes';

export async function prepareSemanticRetrieval(
  query: string,
  options: RetrievalPreparationOptions = {},
): Promise<PreparedRetrieval> {
  const config = readConfig();
  if (!config.embeddingsModel) {
    throw new Error('Модель эмбеддингов не настроена.');
  }

  const index = await getSemanticIndex({
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
    embeddingsModel: config.embeddingsModel,
    targetDirectory: options.targetDirectory,
    signal: options.signal,
  });
  if (!index || index.chunks.length === 0) {
    throw new Error('Файлы с кодом не найдены.');
  }

  let queryEmbedding: number[];
  try {
    [queryEmbedding] = await sendEmbeddingsRequest(
      config.apiBaseUrl,
      config.apiKey,
      config.embeddingsModel,
      [query],
      { signal: options.signal },
    );
  } catch (error: any) {
    throw new Error(`Ошибка embeddings: ${error?.message || error}`);
  }
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    throw new Error('Embeddings вернули пустой вектор для запроса.');
  }

  const rankedChunks: RankedChunkMatch[] = index.chunks
    .map((chunk, chunkIndex) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, index.embeddings[chunkIndex] || []),
    }))
    .sort((left, right) => right.score - left.score);

  return {
    config: {
      apiBaseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      embeddingsModel: config.embeddingsModel,
      rerankModel: config.rerankModel,
    },
    rankedChunks,
    fileMatches: buildRankedFileMatches(rankedChunks),
  };
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || !right.length || left.length !== right.length) return 0;

  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    normLeft += left[index] * left[index];
    normRight += right[index] * right[index];
  }

  const denominator = Math.sqrt(normLeft) * Math.sqrt(normRight);
  return denominator === 0 ? 0 : dot / denominator;
}
