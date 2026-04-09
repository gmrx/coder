import type { RankedChunkMatch, RankedFileMatch } from './retrievalTypes';
import { buildRankedFileMatches, compactSnippetPreview } from './retrievalPools';
import type { StructuredPresentationSection } from './presentationItems';

export type SemanticSearchOutputMode = 'summary' | 'chunks' | 'files';
export type RelevantFilesOutputMode = 'summary' | 'files' | 'snippets';

type Pagination = {
  limit: number;
  offset: number;
};

type RetrievalContext = {
  reranked: boolean;
  targetDirectory?: string;
};

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

interface RetrievalPresentationBase {
  query: string;
  outputMode: string;
  resultCount: number;
  reranked: boolean;
  targetDirectory?: string;
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  sections?: StructuredPresentationSection[];
}

export interface RetrievalFilePreviewItem {
  path: string;
  score: number;
  startLine?: number;
  snippet?: string;
}

export interface RetrievalChunkPreviewItem {
  path: string;
  startLine: number;
  score: number;
  snippet: string;
}

export interface SemanticSearchPresentation extends RetrievalPresentationBase {
  outputMode: SemanticSearchOutputMode;
  chunkCount: number;
  fileCount: number;
  topFiles?: RetrievalFilePreviewItem[];
  topChunks?: RetrievalChunkPreviewItem[];
}

export interface RelevantFilesPresentation extends RetrievalPresentationBase {
  outputMode: RelevantFilesOutputMode;
  fileCount: number;
  topFiles?: RetrievalFilePreviewItem[];
}

export function normalizeSemanticSearchOutputMode(value: any): SemanticSearchOutputMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'chunks' || mode === 'chunk' || mode === 'content' || mode === 'snippets') return 'chunks';
  if (mode === 'files' || mode === 'by_file') return 'files';
  return 'summary';
}

export function normalizeRelevantFilesOutputMode(value: any): RelevantFilesOutputMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'files' || mode === 'by_file') return 'files';
  if (mode === 'snippets' || mode === 'chunks' || mode === 'content') return 'snippets';
  return 'summary';
}

export function formatSemanticSearchOutput(
  query: string,
  matches: RankedChunkMatch[],
  options: Pagination & RetrievalContext & { outputMode: SemanticSearchOutputMode },
): string {
  const fileMatches = buildRankedFileMatches(matches);
  if (options.outputMode === 'files') {
    return buildRetrievalFilesOutput(query, fileMatches, {
      ...options,
      title: 'Файлы по смыслу',
      toolName: 'semantic_search',
      filesMode: 'files',
      summaryMode: 'summary',
      detailMode: 'chunks',
    });
  }
  if (options.outputMode === 'chunks') {
    return buildSemanticChunkOutput(query, matches, options);
  }
  return buildSemanticSummaryOutput(query, matches, fileMatches, options);
}

export function buildSemanticSearchPresentation(
  query: string,
  matches: RankedChunkMatch[],
  options: Pagination & RetrievalContext & { outputMode: SemanticSearchOutputMode },
): SemanticSearchPresentation {
  const files = buildRankedFileMatches(matches);
  const topFile = files[0];
  const topChunk = matches[0];
  const summary = matches.length === 0
    ? 'Смысловой поиск не дал результатов'
    : options.outputMode === 'files'
      ? 'Подготовил file-view по смысловому поиску'
      : options.outputMode === 'chunks'
        ? 'Подготовил chunk-view по смысловому поиску'
        : 'Подготовил overview смыслового поиска';
  const detailParts = [
    `${matches.length} ${pluralize(matches.length, 'фрагмент', 'фрагмента', 'фрагментов')}`,
    `${files.length} ${pluralize(files.length, 'файл', 'файла', 'файлов')}`,
    options.reranked ? 'reranked' : 'embeddings',
    options.targetDirectory ? `область: ${options.targetDirectory}` : '',
  ].filter(Boolean);
  const preview = matches.length === 0
    ? `По запросу "${query}" ничего не найдено.`
    : options.outputMode === 'chunks'
      ? matches.slice(0, Math.min(matches.length, 3)).map((chunk) =>
        `- ${chunk.path}:${chunk.startLine} (score: ${chunk.score.toFixed(3)}) — ${compactSnippetPreview(chunk.text)}`,
      ).join('\n')
      : files.slice(0, Math.min(files.length, 4)).map((file) =>
        `- ${file.path} (score: ${file.score.toFixed(3)})${file.snippets[0] ? ` — L${file.snippets[0].startLine}` : ''}`,
      ).join('\n');

  return {
    query,
    outputMode: options.outputMode,
    resultCount: matches.length,
    chunkCount: matches.length,
    fileCount: files.length,
    reranked: options.reranked,
    ...(options.targetDirectory ? { targetDirectory: options.targetDirectory } : {}),
    ...(files.length > 0
      ? {
        topFiles: files.slice(0, 5).map((file) => ({
          path: file.path,
          score: file.score,
          ...(file.snippets[0]?.startLine ? { startLine: file.snippets[0].startLine } : {}),
          ...(file.snippets[0]?.text ? { snippet: compactSnippetPreview(file.snippets[0].text) } : {}),
        })),
      }
      : {}),
    ...(matches.length > 0
      ? {
        topChunks: matches.slice(0, 5).map((chunk) => ({
          path: chunk.path,
          startLine: chunk.startLine,
          score: chunk.score,
          snippet: compactSnippetPreview(chunk.text),
        })),
      }
      : {}),
    summary,
    detail: detailParts.join(' • '),
    ...(preview ? { preview } : {}),
    sections: buildSemanticSearchSections(matches, files),
    nextStep: matches.length === 0
      ? 'Уточни запрос, target_directory или попробуй соседний retrieval-инструмент.'
      : options.outputMode === 'chunks'
        ? topChunk
          ? `Открой лучший фрагмент: ${buildToolCall('read_file_range', { path: topChunk.path, startLine: Math.max(1, topChunk.startLine - 6), endLine: topChunk.startLine + 28 })}`
          : 'Перейди к file-view или открой лучший файл обзорно.'
        : topFile
          ? `Открой лучший файл обзорно: ${buildToolCall('read_file', { path: topFile.path, outputMode: 'outline' })}`
          : 'Перейди к chunk-view или уточни запрос.',
  };
}

export function formatRelevantFilesOutput(
  query: string,
  matches: RankedFileMatch[],
  options: Pagination & RetrievalContext & { outputMode: RelevantFilesOutputMode },
): string {
  if (options.outputMode === 'files') {
    return buildRetrievalFilesOutput(query, matches, {
      ...options,
      title: 'Файлы по смыслу',
      toolName: 'find_relevant_files',
      filesMode: 'files',
      summaryMode: 'summary',
      detailMode: 'snippets',
    });
  }
  if (options.outputMode === 'snippets') {
    return buildRelevantFileSnippetsOutput(query, matches, options);
  }
  return buildRelevantFilesSummaryOutput(query, matches, options);
}

export function buildRelevantFilesPresentation(
  query: string,
  matches: RankedFileMatch[],
  options: Pagination & RetrievalContext & { outputMode: RelevantFilesOutputMode },
): RelevantFilesPresentation {
  const topFile = matches[0];
  const topSnippet = topFile?.snippets[0];
  const summary = matches.length === 0
    ? 'Релевантные файлы не найдены'
    : options.outputMode === 'files'
      ? 'Подготовил shortlist релевантных файлов'
      : options.outputMode === 'snippets'
        ? 'Подготовил snippet-view по релевантным файлам'
        : 'Подготовил overview релевантных файлов';
  const detailParts = [
    `${matches.length} ${pluralize(matches.length, 'кандидат', 'кандидата', 'кандидатов')}`,
    options.reranked ? 'reranked' : 'embeddings',
    options.targetDirectory ? `область: ${options.targetDirectory}` : '',
  ].filter(Boolean);
  const preview = matches.length === 0
    ? `По запросу "${query}" релевантные файлы не выделены.`
    : options.outputMode === 'snippets'
      ? matches.slice(0, Math.min(matches.length, 3)).map((file) => {
        const snippet = file.snippets[0];
        return snippet
          ? `- ${file.path} (score: ${file.score.toFixed(3)}) — L${snippet.startLine}: ${compactSnippetPreview(snippet.text)}`
          : `- ${file.path} (score: ${file.score.toFixed(3)})`;
      }).join('\n')
      : matches.slice(0, Math.min(matches.length, 5)).map((file) =>
        `- ${file.path} (score: ${file.score.toFixed(3)})${file.snippets[0] ? ` — L${file.snippets[0].startLine}` : ''}`,
      ).join('\n');

  return {
    query,
    outputMode: options.outputMode,
    resultCount: matches.length,
    fileCount: matches.length,
    reranked: options.reranked,
    ...(options.targetDirectory ? { targetDirectory: options.targetDirectory } : {}),
    ...(matches.length > 0
      ? {
        topFiles: matches.slice(0, 6).map((file) => ({
          path: file.path,
          score: file.score,
          ...(file.snippets[0]?.startLine ? { startLine: file.snippets[0].startLine } : {}),
          ...(file.snippets[0]?.text ? { snippet: compactSnippetPreview(file.snippets[0].text) } : {}),
        })),
      }
      : {}),
    summary,
    detail: detailParts.join(' • '),
    ...(preview ? { preview } : {}),
    sections: buildRelevantFilesSections(matches),
    nextStep: matches.length === 0
      ? 'Уточни запрос или перейди к semantic_search для chunk-level retrieval.'
      : topSnippet
        ? `Открой лучший фрагмент: ${buildToolCall('read_file_range', { path: topFile!.path, startLine: Math.max(1, topSnippet.startLine - 6), endLine: topSnippet.startLine + 28 })}`
        : topFile
          ? `Открой лучший файл обзорно: ${buildToolCall('read_file', { path: topFile.path, outputMode: 'outline' })}`
          : 'Уточни запрос или переключи outputMode.',
  };
}

function buildSemanticSearchSections(
  chunks: RankedChunkMatch[],
  files: RankedFileMatch[],
): StructuredPresentationSection[] {
  const sections: StructuredPresentationSection[] = [];
  if (files.length > 0) {
    sections.push({
      title: 'Лучшие файлы',
      items: files.slice(0, 5).map((file) => ({
        title: file.path,
        subtitle: `score ${file.score.toFixed(3)}${file.snippets[0] ? ` • L${file.snippets[0].startLine}` : ''}`,
        meta: file.snippets[0]?.text ? compactSnippetPreview(file.snippets[0].text) : '',
      })),
    });
  }
  if (chunks.length > 0) {
    sections.push({
      title: 'Лучшие фрагменты',
      items: chunks.slice(0, 5).map((chunk) => ({
        title: `${chunk.path}:L${chunk.startLine}`,
        subtitle: `score ${chunk.score.toFixed(3)}`,
        meta: compactSnippetPreview(chunk.text),
      })),
    });
  }
  return sections;
}

function buildRelevantFilesSections(
  files: RankedFileMatch[],
): StructuredPresentationSection[] {
  if (files.length === 0) return [];
  return [{
    title: 'Кандидаты',
    items: files.slice(0, 6).map((file) => ({
      title: file.path,
      subtitle: `score ${file.score.toFixed(3)}${file.snippets[0] ? ` • L${file.snippets[0].startLine}` : ''}`,
      meta: file.snippets[0]?.text ? compactSnippetPreview(file.snippets[0].text) : '',
    })),
  }];
}

function buildSemanticSummaryOutput(
  query: string,
  chunks: RankedChunkMatch[],
  files: RankedFileMatch[],
  options: Pagination & RetrievalContext,
): string {
  const strengthSummary = summarizeChunkStrengths(chunks);
  const lines = [
    `Семантический поиск по "${query}": найдено ${chunks.length} релевантных фрагментов в ${files.length} файлах${buildEngineSuffix(options)}.`,
  ];

  if (options.targetDirectory) {
    lines.push(`Область поиска: ${options.targetDirectory}`);
  }
  lines.push(`Семантика score: чем выше score, тем ближе результат к запросу. ${strengthSummary}`);

  lines.push('');
  lines.push('Топ-файлы:');
  for (const file of files.slice(0, 4)) {
    const bestSnippet = file.snippets[0];
    const preview = compactSnippetPreview(bestSnippet?.text || '');
    lines.push(`- ${file.path} (score: ${file.score.toFixed(3)})${bestSnippet ? ` — лучший фрагмент: ${bestSnippet.startLine}` : ''}${buildFileMatchReason(file)}`);
    if (preview) {
      lines.push(`  ↳ ${preview}`);
    }
  }

  if (chunks[0]) {
    lines.push('');
    lines.push('Топ-фрагменты:');
    for (const chunk of chunks.slice(0, 3)) {
      lines.push(`- ${chunk.path}:${chunk.startLine} (score: ${chunk.score.toFixed(3)}) — ${describeChunkStrength(chunk.score)}; ${compactSnippetPreview(chunk.text)}`);
    }
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- shortlist файлов: ${buildToolCall('find_relevant_files', { query, target_directory: options.targetDirectory, outputMode: 'files', limit: Math.max(8, options.limit) })}`);
  lines.push(`- открыть chunk-выдачу: ${buildToolCall('semantic_search', { query, target_directory: options.targetDirectory, outputMode: 'chunks', limit: options.limit })}`);
  lines.push(`- открыть file-выдачу: ${buildToolCall('semantic_search', { query, target_directory: options.targetDirectory, outputMode: 'files', limit: options.limit })}`);
  if (files[0]) {
    lines.push(`- открыть первый файл обзорно: ${buildToolCall('read_file', { path: files[0].path, outputMode: 'outline' })}`);
  }

  return lines.join('\n');
}

function buildRelevantFilesSummaryOutput(
  query: string,
  files: RankedFileMatch[],
  options: Pagination & RetrievalContext,
): string {
  const strengthSummary = summarizeFileStrengths(files);
  const lines = [
    `Релевантные файлы по "${query}": найдено ${files.length} кандидатов${buildEngineSuffix(options)}.`,
  ];

  if (options.targetDirectory) {
    lines.push(`Область поиска: ${options.targetDirectory}`);
  }
  lines.push(`Семантика score: чем выше score, тем ближе файл к запросу. ${strengthSummary}`);

  lines.push('');
  lines.push('Лучшие кандидаты:');
  for (const file of files.slice(0, 5)) {
    const bestSnippet = file.snippets[0];
    const preview = compactSnippetPreview(bestSnippet?.text || '');
    lines.push(`- ${file.path} (score: ${file.score.toFixed(3)})${bestSnippet ? ` — фрагмент: ${bestSnippet.startLine}` : ''}${buildFileMatchReason(file)}`);
    if (preview) {
      lines.push(`  ↳ ${preview}`);
    }
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- открыть file-выдачу: ${buildToolCall('find_relevant_files', { query, target_directory: options.targetDirectory, outputMode: 'files', limit: options.limit })}`);
  lines.push(`- открыть snippet-выдачу: ${buildToolCall('find_relevant_files', { query, target_directory: options.targetDirectory, outputMode: 'snippets', limit: options.limit })}`);
  lines.push(`- перейти к chunk retrieval: ${buildToolCall('semantic_search', { query, target_directory: options.targetDirectory, outputMode: 'chunks', limit: options.limit })}`);
  if (files[0]) {
    lines.push(`- открыть первый файл обзорно: ${buildToolCall('read_file', { path: files[0].path, outputMode: 'outline' })}`);
  }

  return lines.join('\n');
}

function buildSemanticChunkOutput(
  query: string,
  chunks: RankedChunkMatch[],
  options: Pagination & RetrievalContext,
): string {
  const page = paginate(chunks, options);
  if (page.items.length === 0) {
    return buildEmptyPageMessage(
      'semantic_search',
      { query, target_directory: options.targetDirectory, outputMode: 'chunks', limit: options.limit },
      options.offset,
      options.limit,
      'Релевантные фрагменты',
    );
  }

  const lines = [
    `Релевантные фрагменты по "${query}": показаны ${page.start + 1}–${page.end} из ${chunks.length}${buildEngineSuffix(options)}.`,
    '',
  ];

  for (const chunk of page.items) {
    lines.push(`- ${chunk.path}:${chunk.startLine} (score: ${chunk.score.toFixed(3)}) — ${describeChunkStrength(chunk.score)}`);
    lines.push(indentBlock(compactChunkBlock(chunk.text)));
    lines.push('');
  }

  lines.push('Удобные следующие шаги:');
  lines.push(`- file-выдача: ${buildToolCall('semantic_search', { query, target_directory: options.targetDirectory, outputMode: 'files', limit: options.limit })}`);
  lines.push(`- shortlist файлов: ${buildToolCall('find_relevant_files', { query, target_directory: options.targetDirectory, outputMode: 'files', limit: Math.max(8, options.limit) })}`);
  if (page.items[0]) {
    lines.push(`- открыть первый фрагмент: ${buildToolCall('read_file_range', { path: page.items[0].path, startLine: Math.max(1, page.items[0].startLine - 6), endLine: page.items[0].startLine + 28 })}`);
  }
  appendPagination(lines, 'semantic_search', { query, target_directory: options.targetDirectory, outputMode: 'chunks', limit: options.limit }, page, options);
  return lines.join('\n');
}

function buildRetrievalFilesOutput(
  query: string,
  files: RankedFileMatch[],
  options: Pagination & RetrievalContext & {
    title: string;
    toolName: 'semantic_search' | 'find_relevant_files';
    filesMode: string;
    summaryMode: string;
    detailMode: string;
  },
): string {
  const page = paginate(files, options);
  if (page.items.length === 0) {
    return buildEmptyPageMessage(
      options.toolName,
      { query, target_directory: options.targetDirectory, outputMode: options.filesMode, limit: options.limit },
      options.offset,
      options.limit,
      options.title,
    );
  }

  const lines = [
    `${options.title} по "${query}": показаны ${page.start + 1}–${page.end} из ${files.length}${buildEngineSuffix(options)}.`,
    '',
  ];

  for (const file of page.items) {
    const preview = compactSnippetPreview(file.snippets[0]?.text || '');
    lines.push(`- ${file.path} (score: ${file.score.toFixed(3)})${file.snippets[0] ? ` — лучший фрагмент: ${file.snippets[0].startLine}` : ''}${buildFileMatchReason(file)}`);
    if (preview) {
      lines.push(`  ↳ ${preview}`);
    }
  }

  lines.push('');
  lines.push('Удобные следующие шаги:');
  lines.push(`- overview retrieval: ${buildToolCall(options.toolName, { query, target_directory: options.targetDirectory, outputMode: options.summaryMode, limit: options.limit })}`);
  lines.push(`- детальная выдача: ${buildToolCall(options.toolName, { query, target_directory: options.targetDirectory, outputMode: options.detailMode, limit: options.limit })}`);
  if (page.items[0]) {
    lines.push(`- открыть первый файл обзорно: ${buildToolCall('read_file', { path: page.items[0].path, outputMode: 'outline' })}`);
    lines.push(`- посмотреть символы первого файла: ${buildToolCall('extract_symbols', { path: page.items[0].path, outputMode: 'summary', limit: 20 })}`);
  }
  appendPagination(lines, options.toolName, { query, target_directory: options.targetDirectory, outputMode: options.filesMode, limit: options.limit }, page, options);
  return lines.join('\n');
}

function buildRelevantFileSnippetsOutput(
  query: string,
  files: RankedFileMatch[],
  options: Pagination & RetrievalContext,
): string {
  const page = paginate(files, options);
  if (page.items.length === 0) {
    return buildEmptyPageMessage(
      'find_relevant_files',
      { query, target_directory: options.targetDirectory, outputMode: 'snippets', limit: options.limit },
      options.offset,
      options.limit,
      'Фрагменты по релевантным файлам',
    );
  }

  const lines = [
    `Фрагменты по релевантным файлам для "${query}": показаны ${page.start + 1}–${page.end} из ${files.length}${buildEngineSuffix(options)}.`,
    '',
  ];

  for (const file of page.items) {
    const snippet = file.snippets[0];
    lines.push(`- ${file.path} (score: ${file.score.toFixed(3)})${buildFileMatchReason(file)}`);
    if (snippet) {
      lines.push(`  лучший фрагмент: L${snippet.startLine} — ${describeChunkStrength(snippet.score)}`);
      lines.push(indentBlock(compactChunkBlock(snippet.text)));
    }
    lines.push('');
  }

  lines.push('Удобные следующие шаги:');
  lines.push(`- file-выдача: ${buildToolCall('find_relevant_files', { query, target_directory: options.targetDirectory, outputMode: 'files', limit: options.limit })}`);
  lines.push(`- chunk retrieval: ${buildToolCall('semantic_search', { query, target_directory: options.targetDirectory, outputMode: 'chunks', limit: options.limit })}`);
  if (page.items[0]?.snippets[0]) {
    lines.push(`- открыть первый фрагмент: ${buildToolCall('read_file_range', { path: page.items[0].path, startLine: Math.max(1, page.items[0].snippets[0].startLine - 6), endLine: page.items[0].snippets[0].startLine + 28 })}`);
  }
  appendPagination(lines, 'find_relevant_files', { query, target_directory: options.targetDirectory, outputMode: 'snippets', limit: options.limit }, page, options);
  return lines.join('\n');
}

function appendPagination<T>(
  lines: string[],
  toolName: 'semantic_search' | 'find_relevant_files',
  baseArgs: Record<string, unknown>,
  page: { items: T[]; start: number; end: number; hasMore: boolean },
  options: Pagination,
): void {
  if (!(page.start > 0 || page.hasMore)) return;
  if (lines[lines.length - 1] !== 'Удобные следующие шаги:') {
    lines.push('');
    lines.push('Удобные следующие шаги:');
  }
  if (page.start > 0) {
    lines.push(`- предыдущая страница: ${buildToolCall(toolName, { ...baseArgs, offset: Math.max(0, options.offset - options.limit) })}`);
  }
  if (page.hasMore) {
    lines.push(`- следующая страница: ${buildToolCall(toolName, { ...baseArgs, offset: options.offset + page.items.length })}`);
  }
}

function buildEmptyPageMessage(
  toolName: 'semantic_search' | 'find_relevant_files',
  baseArgs: Record<string, unknown>,
  offset: number,
  limit: number,
  label: string,
): string {
  return [
    `${label}: страница с offset=${offset} пуста.`,
    '',
    `Попробуй меньший offset: ${buildToolCall(toolName, { ...baseArgs, offset: Math.max(0, offset - limit) })}`,
  ].join('\n');
}

function paginate<T>(items: T[], pagination: Pagination): { items: T[]; start: number; end: number; hasMore: boolean } {
  const start = Math.max(0, pagination.offset);
  const pageItems = items.slice(start, start + pagination.limit);
  return {
    items: pageItems,
    start,
    end: start + pageItems.length,
    hasMore: start + pageItems.length < items.length,
  };
}

function compactChunkBlock(text: string): string {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 8);

  const joined = lines.join('\n');
  if (joined.length <= 500) return joined;
  return `${joined.slice(0, 500).trimEnd()}\n...`;
}

function indentBlock(text: string): string {
  return String(text || '')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function buildEngineSuffix(options: RetrievalContext): string {
  return options.reranked ? ', reranked' : ', embeddings';
}

function buildFileMatchReason(file: RankedFileMatch): string {
  const parts = [describeChunkStrength(file.topChunkScore)];
  if (file.snippets.length >= 2) {
    parts.push(`несколько релевантных фрагментов (${file.snippets.length})`);
  }
  return parts.length > 0 ? ` — ${parts.join('; ')}` : '';
}

function describeChunkStrength(score: number): string {
  if (score >= 0.72) return 'очень сильное совпадение';
  if (score >= 0.5) return 'сильное совпадение';
  if (score >= 0.3) return 'умеренное совпадение';
  return 'пограничное совпадение';
}

function summarizeChunkStrengths(chunks: RankedChunkMatch[]): string {
  const strong = chunks.filter((item) => item.score >= 0.5).length;
  const medium = chunks.filter((item) => item.score >= 0.3 && item.score < 0.5).length;
  const borderline = Math.max(0, chunks.length - strong - medium);
  return `Сильных: ${strong}, умеренных: ${medium}, пограничных: ${borderline}.`;
}

function summarizeFileStrengths(files: RankedFileMatch[]): string {
  const strong = files.filter((item) => item.topChunkScore >= 0.5).length;
  const medium = files.filter((item) => item.topChunkScore >= 0.3 && item.topChunkScore < 0.5).length;
  const borderline = Math.max(0, files.length - strong - medium);
  return `Сильных кандидатов: ${strong}, умеренных: ${medium}, пограничных: ${borderline}.`;
}

function buildToolCall(toolName: string, args: Record<string, unknown>): string {
  return JSON.stringify({ tool: toolName, args: compactArgs(args) });
}

function compactArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined && value !== ''),
  );
}
