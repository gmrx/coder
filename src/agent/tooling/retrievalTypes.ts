export interface RankedChunkMatch {
  path: string;
  text: string;
  startLine: number;
  score: number;
}

export interface RankedFileMatch {
  path: string;
  score: number;
  topChunkScore: number;
  snippets: RankedChunkMatch[];
}

export interface RetrievalConfigSnapshot {
  apiBaseUrl: string;
  apiKey: string;
  embeddingsModel: string;
  rerankModel: string;
}

export interface RetrievalPreparationOptions {
  targetDirectory?: string;
  signal?: AbortSignal;
}

export interface PreparedRetrieval {
  config: RetrievalConfigSnapshot;
  rankedChunks: RankedChunkMatch[];
  fileMatches: RankedFileMatch[];
}
