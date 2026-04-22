export interface LineChangeStats {
  added: number;
  removed: number;
  beforeLines: number;
  afterLines: number;
}

export type LineDiffOperation = {
  type: 'ctx' | 'del' | 'add';
  text: string;
  oldNo?: number;
  newNo?: number;
};

export function computeLineChangeStats(oldText: string, newText: string): LineChangeStats {
  const oldLines = splitLinesForStats(oldText);
  const newLines = splitLinesForStats(newText);
  const beforeLines = oldLines.length;
  const afterLines = newLines.length;

  if (oldText === newText) {
    return { added: 0, removed: 0, beforeLines, afterLines };
  }
  if (!oldText) {
    return { added: afterLines, removed: 0, beforeLines, afterLines };
  }
  if (!newText) {
    return { added: 0, removed: beforeLines, beforeLines, afterLines };
  }

  const operations = buildLineOperations(oldLines, newLines);
  if (operations) {
    let added = 0;
    let removed = 0;
    for (const operation of operations) {
      if (operation.type === 'add') added += 1;
      if (operation.type === 'del') removed += 1;
    }
    return { added, removed, beforeLines, afterLines };
  }

  return computeLargeFileLineChangeStats(oldLines, newLines, beforeLines, afterLines);
}

export function computeLineDiffOperations(oldText: string, newText: string): LineDiffOperation[] | null {
  return buildLineOperations(splitLinesForStats(oldText), splitLinesForStats(newText));
}

function buildLineOperations(oldLines: string[], newLines: string[]): LineDiffOperation[] | null {
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

  const operations: LineDiffOperation[] = [];
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

function computeLargeFileLineChangeStats(
  oldLines: string[],
  newLines: string[],
  beforeLines: number,
  afterLines: number,
): LineChangeStats {
  let prefix = 0;
  const prefixLimit = Math.min(oldLines.length, newLines.length);
  while (prefix < prefixLimit && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let oldSuffix = oldLines.length - 1;
  let newSuffix = newLines.length - 1;
  while (
    oldSuffix >= prefix &&
    newSuffix >= prefix &&
    oldLines[oldSuffix] === newLines[newSuffix]
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  return {
    added: Math.max(0, newSuffix - prefix + 1),
    removed: Math.max(0, oldSuffix - prefix + 1),
    beforeLines,
    afterLines,
  };
}

function splitLinesForStats(text: string): string[] {
  if (!text) return [];
  return text.split('\n');
}
