import * as vscode from 'vscode';
import { getAgentWorkspaceFolder } from '../agent/worktreeSession';
import { EXTENSION_NAME } from '../core/constants';
import type { ChatMessage } from '../core/types';
import type { WebviewMessageSink } from './protocol/messages';
import type { CheckpointBranchCommitDto, CheckpointSummaryDto } from './protocol/checkpoints';
import type { Checkpoint, FileSnapshot, PendingChangeSnapshot, RevertSnapshot } from './state';

interface CheckpointControllerOptions {
  getPendingChanges: () => Map<string, PendingChangeSnapshot>;
  setPendingChanges: (value: Map<string, PendingChangeSnapshot>) => void;
  getTrackedFiles: () => Set<string>;
  setTrackedFiles: (value: Set<string>) => void;
  getOriginalFileStates: () => Map<string, FileSnapshot>;
  setOriginalFileStates: (value: Map<string, FileSnapshot>) => void;
  getChatHistory: () => ChatMessage[];
  setChatHistory: (value: ChatMessage[]) => void;
  refreshOriginalProvider: (states: Map<string, FileSnapshot>) => void;
  refreshScm: () => void;
  post: WebviewMessageSink;
}

interface FileChangeMeta {
  filePath?: string;
  changeType?: string;
  fullOldText?: string;
  fileExistedBefore?: boolean;
}

type SerializedFileStateEntry = [string, FileSnapshot];
type SerializedPendingChangeEntry = [string, PendingChangeSnapshot];

interface SerializedCheckpointRecord {
  id: string;
  index: number;
  timestamp: number;
  userMessage: string;
  userMessageIndex: number;
  status: Checkpoint['status'];
  requestChanges: SerializedFileStateEntry[];
  savedPendingChanges: SerializedPendingChangeEntry[];
  savedTrackedFiles: string[];
  savedOriginalFileStates: SerializedFileStateEntry[];
  savedChatHistory: ChatMessage[];
}

interface SerializedRevertSnapshot {
  checkpointId: string;
  pendingChanges: SerializedPendingChangeEntry[];
  trackedFiles: string[];
  originalFileStates: SerializedFileStateEntry[];
  chatHistory: ChatMessage[];
  fileContents: SerializedFileStateEntry[];
}

export interface CheckpointControllerState {
  checkpointSequence: number;
  activeCheckpointId: string | null;
  checkpoints: SerializedCheckpointRecord[];
  preRevertSnapshot: SerializedRevertSnapshot | null;
}

const MAX_CHECKPOINTS = 20;

export class CheckpointController {
  private checkpoints: Checkpoint[] = [];
  private checkpointSequence = 0;
  private activeCheckpointId: string | null = null;
  private preRevertSnapshot: RevertSnapshot | null = null;

  constructor(private readonly options: CheckpointControllerOptions) {}

  hasActiveRevert(): boolean {
    return this.preRevertSnapshot !== null;
  }

  snapshotState(): CheckpointControllerState {
    return {
      checkpointSequence: this.checkpointSequence,
      activeCheckpointId: this.activeCheckpointId,
      checkpoints: this.checkpoints.map((checkpoint) => serializeCheckpoint(checkpoint)),
      preRevertSnapshot: serializeRevertSnapshot(this.preRevertSnapshot),
    };
  }

  restoreState(state: CheckpointControllerState | null | undefined) {
    if (!state) {
      this.reset();
      return;
    }

    this.checkpointSequence = Number.isFinite(state.checkpointSequence) ? Number(state.checkpointSequence) : 0;
    this.checkpoints = Array.isArray(state.checkpoints)
      ? state.checkpoints.slice(-MAX_CHECKPOINTS).map((checkpoint) => deserializeCheckpoint(checkpoint))
      : [];
    this.activeCheckpointId = typeof state.activeCheckpointId === 'string' && this.checkpoints.some((item) => item.id === state.activeCheckpointId)
      ? state.activeCheckpointId
      : null;
    this.preRevertSnapshot = deserializeRevertSnapshot(state.preRevertSnapshot);
  }

  reset() {
    this.checkpoints = [];
    this.checkpointSequence = 0;
    this.activeCheckpointId = null;
    this.preRevertSnapshot = null;
  }

  commitRevertBranch(): CheckpointBranchCommitDto | null {
    if (!this.preRevertSnapshot) return null;

    const checkpoint = this.checkpoints.find((item) => item.id === this.preRevertSnapshot?.checkpointId);
    if (!checkpoint) {
      this.preRevertSnapshot = null;
      return null;
    }

    const prunedCheckpointIds = this.checkpoints
      .filter((item) => item.index > checkpoint.index)
      .map((item) => item.id);

    this.checkpoints = this.checkpoints.filter((item) => item.index <= checkpoint.index);
    this.preRevertSnapshot = null;

    return {
      checkpointId: checkpoint.id,
      prunedCheckpointIds,
    };
  }

  async createCheckpoint(userMessage: string): Promise<Checkpoint> {
    if (this.preRevertSnapshot) {
      throw new Error('Нельзя создавать новый чекпоинт, пока активен откат. Сначала продолжи работу с текущего состояния.');
    }

    const checkpoint: Checkpoint = {
      id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      index: this.checkpointSequence++,
      timestamp: Date.now(),
      userMessage,
      userMessageIndex: countUserMessages(this.options.getChatHistory()) - 1,
      status: 'running',
      requestChanges: new Map<string, FileSnapshot>(),
      savedPendingChanges: clonePendingChanges(this.options.getPendingChanges()),
      savedTrackedFiles: new Set(this.options.getTrackedFiles()),
      savedOriginalFileStates: cloneFileStates(this.options.getOriginalFileStates()),
      savedChatHistory: cloneChatHistory(this.options.getChatHistory()),
    };

    this.checkpoints.push(checkpoint);
    if (this.checkpoints.length > MAX_CHECKPOINTS) {
      this.checkpoints = this.checkpoints.slice(this.checkpoints.length - MAX_CHECKPOINTS);
    }

    this.activeCheckpointId = checkpoint.id;
    return checkpoint;
  }

  recordFileChange(meta: FileChangeMeta) {
    const checkpoint = this.getActiveCheckpoint();
    const filePath = typeof meta.filePath === 'string' ? meta.filePath.trim() : '';
    if (!checkpoint || !filePath || checkpoint.requestChanges.has(filePath)) return;

    checkpoint.requestChanges.set(filePath, {
      content: meta.fullOldText || '',
      existed: typeof meta.fileExistedBefore === 'boolean' ? meta.fileExistedBefore : meta.changeType !== 'create',
    });
  }

  completeActiveCheckpoint(status: Checkpoint['status']): Checkpoint | null {
    const checkpoint = this.getActiveCheckpoint();
    if (!checkpoint) return null;

    checkpoint.status = status;
    this.activeCheckpointId = null;
    return checkpoint;
  }

  async revertToCheckpoint(checkpointId: string): Promise<void> {
    if (this.activeCheckpointId) {
      this.options.post({ type: 'error', text: 'Сначала дождитесь завершения текущего запуска агента.' });
      return;
    }
    if (this.preRevertSnapshot) {
      this.options.post({ type: 'error', text: 'Сначала отмените текущий откат или продолжите работу с него.' });
      return;
    }

    const checkpoint = this.checkpoints.find((item) => item.id === checkpointId);
    if (!checkpoint) {
      this.options.post({ type: 'error', text: 'Чекпоинт не найден.' });
      return;
    }

    const folder = getAgentWorkspaceFolder();
    if (!folder) return;

    const revertedCheckpoints = this.checkpoints
      .filter((item) => item.index >= checkpoint.index)
      .sort((left, right) => right.index - left.index);

    const revertedFilePaths = new Set<string>();
    for (const item of revertedCheckpoints) {
      for (const filePath of item.requestChanges.keys()) {
        revertedFilePaths.add(filePath);
      }
    }

    this.preRevertSnapshot = {
      checkpointId,
      pendingChanges: clonePendingChanges(this.options.getPendingChanges()),
      trackedFiles: new Set(this.options.getTrackedFiles()),
      originalFileStates: cloneFileStates(this.options.getOriginalFileStates()),
      chatHistory: cloneChatHistory(this.options.getChatHistory()),
      fileContents: await snapshotFiles(folder.uri, revertedFilePaths),
    };

    const touchedFiles = new Set<string>();
    const errors: string[] = [];

    for (const item of revertedCheckpoints) {
      for (const [filePath, snapshot] of item.requestChanges) {
        try {
          await restoreWorkspaceSnapshot(vscode.Uri.joinPath(folder.uri, filePath), snapshot);
          touchedFiles.add(filePath);
        } catch (error: any) {
          errors.push(`${filePath}: ${error?.message || error}`);
        }
      }
    }

    this.options.setPendingChanges(clonePendingChanges(checkpoint.savedPendingChanges));
    this.options.setTrackedFiles(new Set(checkpoint.savedTrackedFiles));
    this.options.setOriginalFileStates(cloneFileStates(checkpoint.savedOriginalFileStates));
    this.options.setChatHistory(cloneChatHistory(checkpoint.savedChatHistory));
    this.options.refreshOriginalProvider(this.options.getOriginalFileStates());
    this.options.refreshScm();

    this.options.post({
      type: 'checkpointReverted',
      checkpointId,
      index: checkpoint.index,
      rewoundCheckpointIds: revertedCheckpoints.map((item) => item.id),
      rewoundRequests: revertedCheckpoints.length,
      restoredFiles: touchedFiles.size,
      errors,
      restoredPendingIds: Array.from(this.options.getPendingChanges().keys()),
    });

    vscode.window.showInformationMessage(
      `${EXTENSION_NAME}: откат к чекпоинту #${checkpoint.index} — откатил ${revertedCheckpoints.length} запрос(ов), восстановил ${touchedFiles.size} файлов${errors.length ? `, ошибок: ${errors.length}` : ''}`,
    );
  }

  async undoRevert(): Promise<void> {
    const snapshot = this.preRevertSnapshot;
    if (!snapshot) {
      this.options.post({ type: 'error', text: 'Нет сохранённого состояния для отмены отката.' });
      return;
    }

    const folder = getAgentWorkspaceFolder();
    if (!folder) return;

    const errors: string[] = [];
    for (const [filePath, fileSnapshot] of snapshot.fileContents) {
      try {
        await restoreWorkspaceSnapshot(vscode.Uri.joinPath(folder.uri, filePath), fileSnapshot);
      } catch (error: any) {
        errors.push(`${filePath}: ${error?.message || error}`);
      }
    }

    this.options.setPendingChanges(clonePendingChanges(snapshot.pendingChanges));
    this.options.setTrackedFiles(new Set(snapshot.trackedFiles));
    this.options.setOriginalFileStates(cloneFileStates(snapshot.originalFileStates));
    this.options.setChatHistory(cloneChatHistory(snapshot.chatHistory));
    this.options.refreshOriginalProvider(this.options.getOriginalFileStates());
    this.options.refreshScm();

    this.options.post({
      type: 'undoRevertDone',
      checkpointId: snapshot.checkpointId,
      restoredPendingIds: Array.from(this.options.getPendingChanges().keys()),
      errors,
    });

    this.preRevertSnapshot = null;
    vscode.window.showInformationMessage(`${EXTENSION_NAME}: откат отменён, состояние восстановлено.`);
  }

  sendCheckpointsList() {
    this.options.post({
      type: 'checkpointsList',
      checkpoints: this.checkpoints.map((checkpoint) => ({
        id: checkpoint.id,
        index: checkpoint.index,
        timestamp: checkpoint.timestamp,
        userMessage: checkpoint.userMessage.slice(0, 120),
        userMessageIndex: checkpoint.userMessageIndex,
        status: checkpoint.status,
        changedFiles: checkpoint.requestChanges.size,
      })) satisfies CheckpointSummaryDto[],
    });
  }

  private getActiveCheckpoint(): Checkpoint | null {
    if (!this.activeCheckpointId) return null;
    return this.checkpoints.find((item) => item.id === this.activeCheckpointId) || null;
  }
}

function clonePendingChanges(source: Map<string, PendingChangeSnapshot>): Map<string, PendingChangeSnapshot> {
  return new Map(Array.from(source, ([key, value]) => [key, { ...value }]));
}

function cloneFileStates(source: Map<string, FileSnapshot>): Map<string, FileSnapshot> {
  return new Map(Array.from(source, ([key, value]) => [key, { ...value }]));
}

function cloneChatHistory(source: ChatMessage[]): ChatMessage[] {
  return source.map((message) => ({ ...message }));
}

function countUserMessages(messages: ChatMessage[]): number {
  return messages.filter((message) => message.role === 'user').length;
}

function serializeCheckpoint(checkpoint: Checkpoint): SerializedCheckpointRecord {
  return {
    id: checkpoint.id,
    index: checkpoint.index,
    timestamp: checkpoint.timestamp,
    userMessage: checkpoint.userMessage,
    userMessageIndex: checkpoint.userMessageIndex,
    status: checkpoint.status,
    requestChanges: serializeFileStateMap(checkpoint.requestChanges),
    savedPendingChanges: serializePendingChangeMap(checkpoint.savedPendingChanges),
    savedTrackedFiles: Array.from(checkpoint.savedTrackedFiles),
    savedOriginalFileStates: serializeFileStateMap(checkpoint.savedOriginalFileStates),
    savedChatHistory: cloneChatHistory(checkpoint.savedChatHistory),
  };
}

function deserializeCheckpoint(checkpoint: SerializedCheckpointRecord): Checkpoint {
  return {
    id: typeof checkpoint.id === 'string' ? checkpoint.id : `cp-${Date.now()}`,
    index: Number.isFinite(checkpoint.index) ? Number(checkpoint.index) : 0,
    timestamp: Number.isFinite(checkpoint.timestamp) ? Number(checkpoint.timestamp) : Date.now(),
    userMessage: typeof checkpoint.userMessage === 'string' ? checkpoint.userMessage : '',
    userMessageIndex: Number.isFinite(checkpoint.userMessageIndex) ? Number(checkpoint.userMessageIndex) : -1,
    status: checkpoint.status === 'failed' || checkpoint.status === 'stopped' || checkpoint.status === 'completed'
      ? checkpoint.status
      : 'running',
    requestChanges: deserializeFileStateMap(checkpoint.requestChanges),
    savedPendingChanges: deserializePendingChangeMap(checkpoint.savedPendingChanges),
    savedTrackedFiles: new Set(Array.isArray(checkpoint.savedTrackedFiles) ? checkpoint.savedTrackedFiles.filter((item) => typeof item === 'string') : []),
    savedOriginalFileStates: deserializeFileStateMap(checkpoint.savedOriginalFileStates),
    savedChatHistory: cloneChatHistory(Array.isArray(checkpoint.savedChatHistory) ? checkpoint.savedChatHistory : []),
  };
}

function serializeRevertSnapshot(snapshot: RevertSnapshot | null): SerializedRevertSnapshot | null {
  if (!snapshot) return null;
  return {
    checkpointId: snapshot.checkpointId,
    pendingChanges: serializePendingChangeMap(snapshot.pendingChanges),
    trackedFiles: Array.from(snapshot.trackedFiles),
    originalFileStates: serializeFileStateMap(snapshot.originalFileStates),
    chatHistory: cloneChatHistory(snapshot.chatHistory),
    fileContents: serializeFileStateMap(snapshot.fileContents),
  };
}

function deserializeRevertSnapshot(snapshot: SerializedRevertSnapshot | null | undefined): RevertSnapshot | null {
  if (!snapshot) return null;
  return {
    checkpointId: typeof snapshot.checkpointId === 'string' ? snapshot.checkpointId : '',
    pendingChanges: deserializePendingChangeMap(snapshot.pendingChanges),
    trackedFiles: new Set(Array.isArray(snapshot.trackedFiles) ? snapshot.trackedFiles.filter((item) => typeof item === 'string') : []),
    originalFileStates: deserializeFileStateMap(snapshot.originalFileStates),
    chatHistory: cloneChatHistory(Array.isArray(snapshot.chatHistory) ? snapshot.chatHistory : []),
    fileContents: deserializeFileStateMap(snapshot.fileContents),
  };
}

function serializeFileStateMap(source: Map<string, FileSnapshot>): SerializedFileStateEntry[] {
  return Array.from(source, ([key, value]) => [key, { ...value }]);
}

function deserializeFileStateMap(source: SerializedFileStateEntry[] | undefined): Map<string, FileSnapshot> {
  const entries = Array.isArray(source) ? source : [];
  return new Map(
    entries
      .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object')
      .map(([key, value]) => [key, { content: typeof value.content === 'string' ? value.content : '', existed: !!value.existed }] as [string, FileSnapshot]),
  );
}

function serializePendingChangeMap(source: Map<string, PendingChangeSnapshot>): SerializedPendingChangeEntry[] {
  return Array.from(source, ([key, value]) => [key, { ...value }]);
}

function deserializePendingChangeMap(source: SerializedPendingChangeEntry[] | undefined): Map<string, PendingChangeSnapshot> {
  const entries = Array.isArray(source) ? source : [];
  return new Map(
    entries
      .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object')
      .map(([key, value]) => [key, {
        filePath: typeof value.filePath === 'string' ? value.filePath : '',
        oldText: typeof value.oldText === 'string' ? value.oldText : '',
        newText: typeof value.newText === 'string' ? value.newText : '',
        existedBefore: !!value.existedBefore,
      }] as [string, PendingChangeSnapshot]),
  );
}

async function snapshotFiles(rootUri: vscode.Uri, filePaths: Set<string>): Promise<Map<string, FileSnapshot>> {
  const snapshots = new Map<string, FileSnapshot>();
  for (const filePath of filePaths) {
    snapshots.set(filePath, await readWorkspaceSnapshot(vscode.Uri.joinPath(rootUri, filePath)));
  }
  return snapshots;
}

async function readWorkspaceSnapshot(uri: vscode.Uri): Promise<FileSnapshot> {
  try {
    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
    return { content, existed: true };
  } catch {
    return { content: '', existed: false };
  }
}

async function restoreWorkspaceSnapshot(uri: vscode.Uri, snapshot: FileSnapshot): Promise<void> {
  if (snapshot.existed) {
    await ensureParentDirectory(uri);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(snapshot.content, 'utf-8'));
    return;
  }

  try {
    await vscode.workspace.fs.delete(uri);
  } catch {
    // Ignore deleting already absent files.
  }
}

async function ensureParentDirectory(uri: vscode.Uri): Promise<void> {
  const parentPath = uri.path.replace(/\/[^/]+$/, '');
  if (!parentPath || parentPath === uri.path) return;
  await vscode.workspace.fs.createDirectory(uri.with({ path: parentPath }));
}
