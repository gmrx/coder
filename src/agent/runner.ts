import { ChatMessage } from '../core/types';
import { AgentQueryEngine } from './runtime/queryEngine';
import type { AgentStepCallback } from './runtime/types';

export type { AgentStepCallback } from './runtime/types';

export async function runAgent(
  question: string,
  chatHistory: ChatMessage[],
  activeFile: { path: string; language: string; content: string } | null,
  onStep?: AgentStepCallback,
  signal?: AbortSignal,
): Promise<string> {
  const init = AgentQueryEngine.create({
    initialMessages: chatHistory.slice(0, -1),
  });

  if (!init.ok) {
    return init.error;
  }

  return init.engine.submitMessage({
    question,
    activeFile,
  }, {
    onStep,
    signal,
  });
}
