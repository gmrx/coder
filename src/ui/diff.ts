export { computeLineChangeStats, type LineChangeStats } from '../core/lineDiff';

export interface DiffLine {
  type: 'context' | 'add' | 'del' | 'sep' | 'hunk';
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface EditorDiffResult {
  addedLines: number[];
  removedRegions: Array<{ afterLine: number; lines: string[] }>;
}

export function computeUnifiedDiff(oldText: string, newText: string, context = 3): DiffLine[] {
  if (oldText === newText || (!oldText && !newText)) return [];

  if (!oldText) {
    return newText.split('\n').slice(0, 300).map((line, index) => ({ type: 'add', text: line, newNo: index + 1 }));
  }
  if (!newText) {
    return oldText.split('\n').slice(0, 300).map((line, index) => ({ type: 'del', text: line, oldNo: index + 1 }));
  }

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const operations = buildDiffOperations(oldLines, newLines);
  if (!operations || operations.length === 0) return [];

  const visible = new Set<number>();
  for (let index = 0; index < operations.length; index++) {
    if (operations[index].type !== 'ctx') {
      for (let cursor = Math.max(0, index - context); cursor <= Math.min(operations.length - 1, index + context); cursor++) {
        visible.add(cursor);
      }
    }
  }
  if (visible.size === 0) return [];

  const lines: DiffLine[] = [];
  let previousVisible = -1;
  for (let index = 0; index < operations.length && lines.length < 300; index++) {
    if (!visible.has(index)) {
      previousVisible = -1;
      continue;
    }
    if (previousVisible >= 0 && index - previousVisible > 1) {
      lines.push({ type: 'sep', text: '···' });
    }
    previousVisible = index;

    const operation = operations[index];
    if (operation.type === 'ctx') lines.push({ type: 'context', text: operation.text, oldNo: operation.oldNo, newNo: operation.newNo });
    if (operation.type === 'del') lines.push({ type: 'del', text: operation.text, oldNo: operation.oldNo });
    if (operation.type === 'add') lines.push({ type: 'add', text: operation.text, newNo: operation.newNo });
  }

  return lines;
}

export function computeEditorDiff(oldText: string, newText: string): EditorDiffResult {
  const result: EditorDiffResult = { addedLines: [], removedRegions: [] };
  if (oldText === newText || (!oldText && !newText)) return result;
  if (!oldText) {
    result.addedLines = newText.split('\n').map((_, index) => index);
    return result;
  }
  if (!newText) {
    result.removedRegions = [{ afterLine: -1, lines: oldText.split('\n') }];
    return result;
  }

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const operations = buildDiffOperations(oldLines, newLines);
  if (!operations) return result;

  let lastNewLine = -1;
  let currentRemoved: string[] = [];
  let removedAfter = -1;

  for (const operation of operations) {
    if (operation.type === 'ctx') {
      flushRemovedRegion(result, currentRemoved, removedAfter);
      currentRemoved = [];
      lastNewLine = operation.newNo! - 1;
      continue;
    }

    if (operation.type === 'add') {
      flushRemovedRegion(result, currentRemoved, removedAfter);
      currentRemoved = [];
      result.addedLines.push(operation.newNo! - 1);
      lastNewLine = operation.newNo! - 1;
      continue;
    }

    if (currentRemoved.length === 0) removedAfter = lastNewLine;
    currentRemoved.push(operation.text);
  }

  flushRemovedRegion(result, currentRemoved, removedAfter);
  return result;
}

function flushRemovedRegion(result: EditorDiffResult, lines: string[], afterLine: number) {
  if (lines.length === 0) return;
  result.removedRegions.push({ afterLine, lines: [...lines] });
}

function buildDiffOperations(oldLines: string[], newLines: string[]) {
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  if (oldCount > 2000 || newCount > 2000) return null;

  const dp: number[][] = Array.from({ length: oldCount + 1 }, () => new Array(newCount + 1).fill(0));
  for (let oldIndex = 1; oldIndex <= oldCount; oldIndex++) {
    for (let newIndex = 1; newIndex <= newCount; newIndex++) {
      dp[oldIndex][newIndex] = oldLines[oldIndex - 1] === newLines[newIndex - 1]
        ? dp[oldIndex - 1][newIndex - 1] + 1
        : Math.max(dp[oldIndex - 1][newIndex], dp[oldIndex][newIndex - 1]);
    }
  }

  const operations: Array<{ type: 'ctx' | 'del' | 'add'; text: string; oldNo?: number; newNo?: number }> = [];
  let oldIndex = oldCount;
  let newIndex = newCount;
  while (oldIndex > 0 || newIndex > 0) {
    if (oldIndex > 0 && newIndex > 0 && oldLines[oldIndex - 1] === newLines[newIndex - 1]) {
      operations.unshift({ type: 'ctx', text: oldLines[oldIndex - 1], oldNo: oldIndex, newNo: newIndex });
      oldIndex--;
      newIndex--;
    } else if (newIndex > 0 && (oldIndex === 0 || dp[oldIndex][newIndex - 1] >= dp[oldIndex - 1][newIndex])) {
      operations.unshift({ type: 'add', text: newLines[newIndex - 1], newNo: newIndex });
      newIndex--;
    } else {
      operations.unshift({ type: 'del', text: oldLines[oldIndex - 1], oldNo: oldIndex });
      oldIndex--;
    }
  }

  return operations;
}
