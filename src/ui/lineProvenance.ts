import { computeLineDiffOperations, type LineDiffOperation } from '../core/lineDiff';

export type LineAttributionChange = {
  oldText: string;
  newText: string;
};

export type LineAttributionClassification = {
  agentLines: Set<number>;
  agentModifiedByUserLines: Set<number>;
  userOnlyLines: Set<number>;
  agentRemovedLines: number;
  agentDeletedByUserLines: number;
  userRemovedLines: number;
  unknown: boolean;
};

type LineOrigin = 'base' | 'agent' | 'agentUser' | 'user';

type LineProvenanceState = {
  text: string;
  origins: LineOrigin[];
  agentRemovedLines: number;
  agentDeletedByUserLines: number;
  userRemovedLines: number;
  unknown: boolean;
};

export function classifyLineAttribution(
  originalText: string,
  changes: Iterable<LineAttributionChange>,
  currentText: string,
): LineAttributionClassification {
  let state: LineProvenanceState = {
    text: originalText,
    origins: splitTextLines(originalText).map(() => 'base'),
    agentRemovedLines: 0,
    agentDeletedByUserLines: 0,
    userRemovedLines: 0,
    unknown: false,
  };

  for (const change of changes) {
    state = applyManualTextChange(state, change.oldText || '');
    state = applyAgentTextChange(state, change.newText || '');
  }
  state = applyManualTextChange(state, currentText);

  const classification: LineAttributionClassification = {
    agentLines: new Set<number>(),
    agentModifiedByUserLines: new Set<number>(),
    userOnlyLines: new Set<number>(),
    agentRemovedLines: state.agentRemovedLines,
    agentDeletedByUserLines: state.agentDeletedByUserLines,
    userRemovedLines: state.userRemovedLines,
    unknown: state.unknown,
  };

  for (let index = 0; index < state.origins.length; index++) {
    const origin = state.origins[index];
    if (origin === 'agent') classification.agentLines.add(index);
    if (origin === 'agentUser') classification.agentModifiedByUserLines.add(index);
    if (origin === 'user') classification.userOnlyLines.add(index);
  }

  return classification;
}

function applyManualTextChange(state: LineProvenanceState, newText: string): LineProvenanceState {
  if (state.text === newText) return state;
  return applyLineOperations(state, newText, 'manual');
}

function applyAgentTextChange(state: LineProvenanceState, newText: string): LineProvenanceState {
  if (state.text === newText) return state;
  return applyLineOperations(state, newText, 'agent');
}

function applyLineOperations(
  state: LineProvenanceState,
  newText: string,
  actor: 'agent' | 'manual',
): LineProvenanceState {
  const operations = computeLineDiffOperations(state.text, newText);
  if (!operations) {
    return {
      ...state,
      text: newText,
      origins: splitTextLines(newText).map(() => 'base'),
      unknown: true,
    };
  }

  const nextOrigins: LineOrigin[] = [];
  let agentRemovedLines = state.agentRemovedLines;
  let agentDeletedByUserLines = state.agentDeletedByUserLines;
  let userRemovedLines = state.userRemovedLines;

  const groups = groupNonContextOperations(operations);
  for (const group of groups) {
    if (group.context) {
      const operation = group.operations[0];
      if (operation.oldNo) nextOrigins.push(state.origins[operation.oldNo - 1] || 'base');
      continue;
    }

    const deletedOrigins = group.operations
      .filter((operation) => operation.type === 'del' && operation.oldNo)
      .map((operation) => state.origins[Number(operation.oldNo) - 1] || 'base');
    const addedCount = group.operations.filter((operation) => operation.type === 'add').length;

    if (actor === 'agent') {
      agentRemovedLines += deletedOrigins.length;
    } else if (addedCount === 0) {
      for (const origin of deletedOrigins) {
        if (origin === 'agent' || origin === 'agentUser') {
          agentDeletedByUserLines += 1;
        } else {
          userRemovedLines += 1;
        }
      }
    }

    if (addedCount === 0) continue;

    const origin: LineOrigin = actor === 'agent'
      ? 'agent'
      : deletedOrigins.some((deletedOrigin) => deletedOrigin === 'agent' || deletedOrigin === 'agentUser')
        ? 'agentUser'
        : 'user';
    for (let index = 0; index < addedCount; index++) nextOrigins.push(origin);
  }

  return {
    text: newText,
    origins: nextOrigins,
    agentRemovedLines,
    agentDeletedByUserLines,
    userRemovedLines,
    unknown: state.unknown,
  };
}

function splitTextLines(text: string): string[] {
  return text ? text.split('\n') : [];
}

function groupNonContextOperations(operations: LineDiffOperation[]): Array<{ context: boolean; operations: LineDiffOperation[] }> {
  const groups: Array<{ context: boolean; operations: LineDiffOperation[] }> = [];
  let pending: LineDiffOperation[] = [];

  const flushPending = () => {
    if (!pending.length) return;
    groups.push({ context: false, operations: pending });
    pending = [];
  };

  for (const operation of operations) {
    if (operation.type === 'ctx') {
      flushPending();
      groups.push({ context: true, operations: [operation] });
      continue;
    }
    pending.push(operation);
  }
  flushPending();

  return groups;
}
