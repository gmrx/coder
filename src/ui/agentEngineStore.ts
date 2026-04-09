import { AgentQueryEngine } from '../agent';
import type { ChatMessage } from '../core/types';
import type { AgentRuntimeChangeKind, AgentRuntimeSnapshot } from '../agent/runtime/types';

export class ConversationAgentEngineStore {
  private readonly engines = new Map<string, AgentQueryEngine>();

  constructor(
    private readonly onRuntimeChanged?: (conversationId: string, kind: AgentRuntimeChangeKind) => void | Promise<void>,
  ) {}

  getOrCreate(
    conversationId: string,
    messages: ChatMessage[],
    runtimeSnapshot?: AgentRuntimeSnapshot | null,
  ): AgentQueryEngine {
    let engine = this.engines.get(conversationId);
    if (!engine) {
      const created = AgentQueryEngine.create({
        initialMessages: messages,
      });
      if (!created.ok) {
        throw new Error(created.error);
      }
      engine = created.engine;
      engine.setStateChangeListener((kind) => {
        void this.onRuntimeChanged?.(conversationId, kind);
      });
      this.engines.set(conversationId, engine);
    } else {
      engine.hydrateConversation(messages);
    }

    engine.hydrateRuntime(runtimeSnapshot || null);
    return engine;
  }

  sync(
    conversationId: string,
    messages: ChatMessage[],
    runtimeSnapshot?: AgentRuntimeSnapshot | null,
  ): void {
    const engine = this.engines.get(conversationId);
    if (!engine) return;
    engine.hydrateConversation(messages);
    if (runtimeSnapshot !== undefined) {
      engine.hydrateRuntime(runtimeSnapshot);
    }
  }

  get(conversationId: string): AgentQueryEngine | undefined {
    return this.engines.get(conversationId);
  }

  delete(conversationId: string): void {
    this.engines.delete(conversationId);
  }

  clear(): void {
    this.engines.clear();
  }
}
