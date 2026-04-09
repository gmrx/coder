export interface CheckpointSummaryDto {
  id: string;
  index: number;
  timestamp: number;
  userMessage: string;
  userMessageIndex?: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  changedFiles: number;
}

export interface CheckpointBranchCommitDto {
  checkpointId: string;
  prunedCheckpointIds: string[];
}

export interface CheckpointMessage extends CheckpointSummaryDto {
  type: 'checkpoint';
}

export interface CheckpointUpdatedMessage extends CheckpointSummaryDto {
  type: 'checkpointUpdated';
}

export interface CheckpointsListMessage {
  type: 'checkpointsList';
  checkpoints: CheckpointSummaryDto[];
}

export interface CheckpointRevertedMessage {
  type: 'checkpointReverted';
  checkpointId: string;
  index: number;
  rewoundCheckpointIds: string[];
  rewoundRequests: number;
  restoredFiles: number;
  errors: string[];
  restoredPendingIds: string[];
}

export interface UndoRevertDoneMessage {
  type: 'undoRevertDone';
  checkpointId: string;
  restoredPendingIds: string[];
  errors: string[];
}

export interface CheckpointBranchCommittedMessage extends CheckpointBranchCommitDto {
  type: 'checkpointBranchCommitted';
}
