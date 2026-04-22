import type { ToolExecutionResult } from '../../tooling/results';
import { CoverageMemory, getReadTopDirs } from './coverageMemory';
import { FailureMemory, isToolResultError } from './failureMemory';
import {
  isBroadStudyQuery,
  isMcpCatalogQuery,
  isMcpFreshnessSensitiveQuery,
  isJiraTopicQuery,
  isMutationIntentQuery,
  isPlanningIntentQuery,
} from './intents';
import { MutationMemory } from './mutationMemory';
import { RetrievalMemory } from './retrievalMemory';

export class AgentMemory {
  readonly coverage = new CoverageMemory();
  readonly failure = new FailureMemory();
  readonly mutation = new MutationMemory();
  readonly retrieval = new RetrievalMemory();

  get topDirs(): Set<string> {
    return this.coverage.topDirs;
  }

  get readFiles(): Set<string> {
    return this.coverage.readFiles;
  }

  get workspaceMutations(): number {
    return this.mutation.workspaceMutations;
  }

  get subagentErrorBatches(): number {
    return this.failure.subagentErrorBatches;
  }

  get toolCalls(): number {
    return this.retrieval.toolCalls;
  }

  get subagentBatches(): number {
    return this.retrieval.subagentBatches;
  }

  get subagentTasks(): number {
    return this.retrieval.subagentTasks;
  }

  get keyFacts(): string[] {
    return this.retrieval.keyFacts;
  }

  get freshMcpCatalogReads(): number {
    return this.retrieval.freshMcpCatalogReads;
  }

  get freshMcpToolCalls(): number {
    return this.retrieval.freshMcpToolCalls;
  }

  get freshMcpFacts(): string[] {
    return this.retrieval.freshMcpFacts;
  }
}

export function createAgentMemory(): AgentMemory {
  return new AgentMemory();
}

function getToolResultContent(result: string | ToolExecutionResult): string {
  return typeof result === 'string' ? result : result.content;
}

export function updateMemory(
  memory: AgentMemory,
  tool: string,
  args: any,
  result: string | ToolExecutionResult,
): void {
  const content = getToolResultContent(result);
  memory.retrieval.noteToolCall();
  memory.mutation.noteTool(tool, result);
  memory.coverage.registerPathsFromArgs(args);

  if (tool === 'subagent' || tool === 'semantic_search' || tool === 'find_relevant_files') {
    memory.coverage.registerHintsFromText(content);
  }

  if (tool === 'subagent') {
    memory.retrieval.noteSubagentBatch(content);
    if (isToolResultError(tool, result)) {
      memory.failure.noteSubagentBatchFailure();
    }
  }

  memory.retrieval.addToolFact(tool, content, result);
}

export function buildMemorySnapshot(memory: AgentMemory): string {
  const facts = memory.keyFacts.length
    ? memory.keyFacts.map((fact) => `- ${fact}`).join('\n')
    : '- (пока нет зафиксированных фактов)';

  return (
    '[Снимок контекста и прогресса]\n' +
    `- toolCalls: ${memory.toolCalls}\n` +
    `- workspace mutations: ${memory.workspaceMutations}\n` +
    `- покрытие топ-директорий: ${[...memory.topDirs].slice(0, 8).join(', ') || '(нет)'}\n` +
    `- прочитано файлов (уник.): ${memory.readFiles.size}\n` +
    `- свежие MCP catalog/tool calls: ${memory.freshMcpCatalogReads}/${memory.freshMcpToolCalls}\n` +
    `- subagent batches/tasks/errors: ${memory.subagentBatches}/${memory.subagentTasks}/${memory.subagentErrorBatches}\n` +
    '- ключевые факты:\n' +
    `${facts}\n` +
    'Используй этот снимок как накопленную память и учитывай его при решении: продолжать сбор фактов или переходить к final_answer.'
  );
}

export function hasFreshMcpContext(question: string, memory: AgentMemory): boolean {
  if (isMcpCatalogQuery(question)) {
    return memory.freshMcpCatalogReads >= 1 || memory.freshMcpToolCalls >= 1;
  }
  return memory.freshMcpToolCalls >= 1;
}

export function hasEnoughContext(
  question: string,
  memory: AgentMemory,
  options: { freshMcpRequired?: boolean } = {},
): boolean {
  if (options.freshMcpRequired || isMcpFreshnessSensitiveQuery(question)) {
    if (!hasFreshMcpContext(question, memory)) return false;
  }

  if (isMutationIntentQuery(question)) {
    return memory.workspaceMutations >= 1 || (memory.readFiles.size >= 2 && memory.toolCalls >= 4);
  }

  if (isJiraTopicQuery(question) && memory.keyFacts.some((fact) => fact.startsWith('Jira:'))) {
    return true;
  }

  const broadStudy = isBroadStudyQuery(question);
  const subagentQualityOk = memory.subagentBatches === 0 || memory.subagentErrorBatches <= 1;
  if (broadStudy) {
    const strongSubagentCoverage =
      memory.subagentBatches >= 1 &&
      memory.subagentTasks >= 4 &&
      memory.keyFacts.length >= 2 &&
      subagentQualityOk;
    if (strongSubagentCoverage) {
      return true;
    }

    return (
      memory.topDirs.size >= 3 &&
      memory.readFiles.size >= 5 &&
      (memory.subagentTasks >= 2 || memory.toolCalls >= 10) &&
      subagentQualityOk
    );
  }

  if (memory.toolCalls >= 3 && memory.keyFacts.length >= 2) return true;

  return memory.readFiles.size >= 2 || memory.toolCalls >= 4;
}

export function buildThinkMessage(
  iteration: number,
  question: string,
  memory: AgentMemory,
  lastTool: string | null,
  lastReasoning: string | null,
  options: { freshMcpRequired?: boolean } = {},
): string {
  const enough = hasEnoughContext(question, memory, options);
  const coverage = `${memory.topDirs.size} dirs, ${memory.readFiles.size} files`;
  const previousStep = lastTool ? `${lastTool}${lastReasoning ? ` — ${lastReasoning}` : ''}` : 'начальная оценка контекста';
  const decision = enough
    ? 'контекста похоже достаточно, проверяю можно ли переходить к final_answer'
    : 'контекста пока мало, выбираю следующий самый информативный шаг';

  return `[Агент] Шаг ${iteration}: ${decision} (покрытие: ${coverage}; предыдущий шаг: ${previousStep})`;
}

export {
  getReadTopDirs,
  isBroadStudyQuery,
  isMcpCatalogQuery,
  isMcpFreshnessSensitiveQuery,
  isJiraTopicQuery,
  isMutationIntentQuery,
  isPlanningIntentQuery,
  isToolResultError,
};
