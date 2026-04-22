import { truncate } from '../../core/utils';
import {
  createToolExecutionResult,
  type ToolExecutionMeta,
  type ToolExecutionResult,
  type ToolExecutionStatus,
} from './results';

export type EditPresentationChangeType =
  | 'edit'
  | 'create'
  | 'overwrite'
  | 'delete'
  | 'notebook-new-cell'
  | 'notebook-edit-cell';

export interface EditResultPresentation {
  toolName: string;
  filePath: string;
  changeType: EditPresentationChangeType;
  outcome: 'applied' | 'blocked' | 'noop' | 'error';
  summary: string;
  detail: string;
  preview?: string;
  cellIdx?: number;
  language?: string;
  stats?: {
    added: number;
    removed: number;
    beforeLines: number;
    afterLines: number;
    oldBytes: number;
    newBytes: number;
    changedLines: number;
  };
}

export type EditPresentationStats = NonNullable<EditResultPresentation['stats']>;

type BuildEditPresentationInput = {
  toolName: string;
  filePath: string;
  changeType: EditPresentationChangeType;
  outcome: EditResultPresentation['outcome'];
  summary: string;
  oldSnippet?: string;
  newSnippet?: string;
  cellIdx?: number;
  language?: string;
  stats?: EditResultPresentation['stats'];
  detail?: string;
  preview?: string;
};

export function createEditExecutionResult(
  status: ToolExecutionStatus,
  content: string,
  input: BuildEditPresentationInput,
  meta?: Omit<ToolExecutionMeta, 'presentation'>,
): ToolExecutionResult {
  return createToolExecutionResult(
    input.toolName,
    status,
    content,
    {
      ...(meta || {}),
      presentation: {
        kind: 'edit',
        data: buildEditPresentation(input),
      },
    },
  );
}

export function buildEditPresentation(input: BuildEditPresentationInput): EditResultPresentation {
  const location = input.cellIdx !== undefined
    ? `${input.filePath} [cell ${input.cellIdx}]`
    : input.filePath;
  const baseDetailParts = [
    location,
    describeChangeType(input.changeType),
    input.language ? `язык: ${input.language}` : '',
    input.stats ? describeEditStats(input.stats) : '',
  ].filter(Boolean);
  const baseDetail = baseDetailParts.join(' • ');
  const detail = [baseDetail, input.detail].filter(Boolean).join('\n');

  return {
    toolName: input.toolName,
    filePath: input.filePath,
    changeType: input.changeType,
    outcome: input.outcome,
    summary: input.summary,
    detail,
    ...(input.preview ? { preview: input.preview } : buildEditPreview(input.oldSnippet, input.newSnippet)),
    ...(input.cellIdx !== undefined ? { cellIdx: input.cellIdx } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.stats ? { stats: input.stats } : {}),
  };
}

export function getEditPresentationPreview(presentation: EditResultPresentation): string {
  return String(presentation.preview || '').trim();
}

function describeChangeType(changeType: EditPresentationChangeType): string {
  switch (changeType) {
    case 'edit':
      return 'точечная правка';
    case 'create':
      return 'новый файл';
    case 'overwrite':
      return 'перезапись файла';
    case 'delete':
      return 'удаление файла';
    case 'notebook-new-cell':
      return 'новая ячейка notebook';
    case 'notebook-edit-cell':
      return 'правка ячейки notebook';
    default:
      return changeType;
  }
}

function describeEditStats(stats: NonNullable<EditResultPresentation['stats']>): string {
  const parts = [];
  parts.push(`+${stats.added} / -${stats.removed}`);
  parts.push(`${stats.beforeLines} -> ${stats.afterLines} строк`);
  if (stats.changedLines > 0) {
    parts.push(`изменено ~${stats.changedLines} строк`);
  }
  if (stats.oldBytes > 0 || stats.newBytes > 0) {
    parts.push(`${stats.oldBytes} -> ${stats.newBytes} байт`);
  }
  return parts.join(' • ');
}

function buildEditPreview(oldSnippet?: string, newSnippet?: string): { preview: string } | {} {
  const oldText = String(oldSnippet || '').trim();
  const newText = String(newSnippet || '').trim();
  const parts: string[] = [];

  if (oldText) {
    parts.push(`Было\n${truncate(oldText, 1600)}`);
  }
  if (newText) {
    parts.push(`Стало\n${truncate(newText, 1600)}`);
  }

  const preview = parts.join('\n\n').trim();
  return preview ? { preview } : {};
}
