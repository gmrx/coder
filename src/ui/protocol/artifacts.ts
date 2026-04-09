import type { AgentApprovalRequest, AgentApprovalResult } from '../../agent/runtime/approvals';
import type { AgentQuestionRequest, AgentQuestionResult } from '../../agent/runtime/questions';
import type { DiffLine } from '../diff';
import type {
  CheckpointBranchCommittedMessage,
  CheckpointMessage,
  CheckpointRevertedMessage,
  CheckpointUpdatedMessage,
  UndoRevertDoneMessage,
} from './checkpoints';

export interface PersistedFileChangePayload {
  changeId: string;
  step?: string;
  filePath: string;
  changeType: string;
  tool: string;
  summary?: string;
  stats?: {
    added: number;
    removed: number;
    beforeLines: number;
    afterLines: number;
  };
  oldSnippet: string;
  newSnippet: string;
  cellIdx: number | undefined;
  diffLines: DiffLine[];
}

interface PersistedArtifactBase {
  runId?: string;
}

export type PersistedChatArtifact = (
  | { kind: 'statusMessage'; payload: { text: string } }
  | { kind: 'errorMessage'; payload: { text: string } }
  | { kind: 'fileChange'; payload: PersistedFileChangePayload }
  | { kind: 'changeStatus'; payload: { type: 'changeAccepted' | 'changeRejected'; changeId: string; error?: string } }
  | { kind: 'approvalRequest'; payload: AgentApprovalRequest }
  | { kind: 'approvalResolved'; payload: AgentApprovalResult }
  | { kind: 'questionRequest'; payload: AgentQuestionRequest }
  | { kind: 'questionResolved'; payload: AgentQuestionResult }
  | { kind: 'checkpoint'; payload: CheckpointMessage }
  | { kind: 'checkpointUpdated'; payload: CheckpointUpdatedMessage }
  | { kind: 'checkpointReverted'; payload: CheckpointRevertedMessage }
  | { kind: 'undoRevertDone'; payload: UndoRevertDoneMessage }
  | { kind: 'checkpointBranchCommitted'; payload: CheckpointBranchCommittedMessage }
) & PersistedArtifactBase;
