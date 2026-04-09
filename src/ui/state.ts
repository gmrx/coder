import type { ChatMessage } from '../core/types';

export interface FileSnapshot {
  content: string;
  existed: boolean;
}

export interface PendingChangeSnapshot {
  filePath: string;
  oldText: string;
  newText: string;
  existedBefore: boolean;
}

export interface Checkpoint {
  id: string;
  index: number;
  timestamp: number;
  userMessage: string;
  userMessageIndex: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  requestChanges: Map<string, FileSnapshot>;
  savedPendingChanges: Map<string, PendingChangeSnapshot>;
  savedTrackedFiles: Set<string>;
  savedOriginalFileStates: Map<string, FileSnapshot>;
  savedChatHistory: ChatMessage[];
}

export interface RevertSnapshot {
  checkpointId: string;
  pendingChanges: Map<string, PendingChangeSnapshot>;
  trackedFiles: Set<string>;
  originalFileStates: Map<string, FileSnapshot>;
  chatHistory: ChatMessage[];
  fileContents: Map<string, FileSnapshot>;
}
