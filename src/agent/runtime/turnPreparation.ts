import type { ChatMessage } from '../../core/types';
import { truncate } from '../../core/utils';
import { buildFewShotMessages, buildSystemPrompt } from '../prompt';
import { shouldPrimeRetrievalByWorkflow } from '../tooling/catalog';
import { requiresMermaidDiagram } from '../runnerOutput';
import { executeToolResult } from '../executor';
import { updateMemory } from '../runnerMemory';
import { isMcpFreshnessSensitiveQuery, isMutationIntentQuery } from './memory';
import type { AgentSession } from './agentSession';
import type { AgentTurnPreparationInput, PreparedAgentTurn } from './types';

const INITIAL_HISTORY_BUDGET_CHARS = 42_000;
const CARRYOVER_CONTEXT_BUDGET_CHARS = 18_000;
const CARRYOVER_PER_MESSAGE_CHARS = 1_800;

export function prepareAgentTurnInput(input: AgentTurnPreparationInput, embeddingsModel: string): PreparedAgentTurn {
  const lastQuestion = input.chatHistory[input.chatHistory.length - 1]?.content || input.question;
  const mutationQuery = isMutationIntentQuery(lastQuestion);
  const retrievalAutoContext = shouldPrimeRetrievalByWorkflow(lastQuestion, embeddingsModel);
  const carryoverContext = buildCarryoverContext(input.chatHistory, input.sessionMemory || null);
  const freshMcpRequired = isMcpFreshnessSensitiveQuery(lastQuestion, carryoverContext);

  return {
    lastQuestion,
    messages: buildInitialMessages(input.chatHistory, input.activeFile, input.sessionMemory || null, input.systemPrompt || ''),
    carryoverContext,
    freshMcpRequired,
    isFirstMessage: input.chatHistory.length <= 1,
    mutationQuery,
    needMermaid: requiresMermaidDiagram(lastQuestion),
    retrievalAutoContext,
  };
}

function buildCarryoverContext(
  chatHistory: ChatMessage[],
  sessionMemory: AgentTurnPreparationInput['sessionMemory'],
): string {
  const sections: string[] = [];
  const memoryMessage = buildSessionMemoryMessage(sessionMemory);
  if (memoryMessage?.content) {
    sections.push(memoryMessage.content);
  }

  const priorMessages = chatHistory
    .slice(0, -1)
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant');
  const historyTranscript = serializeConversationMessages(
    priorMessages,
    CARRYOVER_CONTEXT_BUDGET_CHARS,
    CARRYOVER_PER_MESSAGE_CHARS,
  );

  if (historyTranscript) {
    sections.push('[История предыдущих запросов и ответов]');
    sections.push(historyTranscript);
  }

  return sections.join('\n\n').trim();
}

export async function primePreparedTurn(
  session: AgentSession,
  prepared: PreparedAgentTurn,
): Promise<void> {
  if (prepared.isFirstMessage) {
    for (const toolName of ['scan_structure', 'list_files', 'detect_stack']) {
      await runAutoContextTool(session, toolName, {});
    }
  }

  if (prepared.retrievalAutoContext) {
    await runAutoContextTool(session, 'find_relevant_files', {
      query: prepared.lastQuestion,
      limit: 8,
    });
  }

  session.pushUser(buildUserRequestEnvelope(prepared.lastQuestion, prepared.isFirstMessage, prepared.freshMcpRequired));
}

function buildInitialMessages(
  chatHistory: ChatMessage[],
  activeFile: AgentTurnPreparationInput['activeFile'],
  sessionMemory: AgentTurnPreparationInput['sessionMemory'],
  systemPrompt: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(chatHistory, systemPrompt) }];
  messages.push(...buildFewShotMessages());

  const memoryMessage = buildSessionMemoryMessage(sessionMemory);
  if (memoryMessage) {
    messages.push(memoryMessage);
  }

  for (const msg of selectHistoryMessages(chatHistory.slice(0, -1), INITIAL_HISTORY_BUDGET_CHARS)) {
    messages.push(msg);
  }

  if (activeFile) {
    messages.push({
      role: 'user',
      content: `[Контекст] Открыт файл: ${activeFile.path} (${activeFile.language})\n\`\`\`\n${truncate(activeFile.content, 3000)}\n\`\`\``,
    });
  }

  return messages;
}

function buildSessionMemoryMessage(
  sessionMemory: AgentTurnPreparationInput['sessionMemory'],
): ChatMessage | null {
  if (!sessionMemory) return null;

  const title = truncate(String(sessionMemory.title || '').trim(), 140, '…');
  const currentState = truncate(String(sessionMemory.currentState || '').trim(), 350, '…');
  const summary = truncate(String(sessionMemory.summary || '').trim(), 1_600, '…');
  if (!title && !currentState && !summary) return null;

  const parts = ['[Память сессии из предыдущих запросов]'];
  if (title) parts.push(`Сессия: ${title}`);
  if (currentState) parts.push(`Текущее состояние: ${currentState}`);
  if (summary) parts.push(summary);
  parts.push('Используй эту память как накопленный рабочий контекст из прошлых запросов. Если пользователь продолжает уже изученную тему, опирайся на неё и не начинай исследование заново без необходимости.');

  return {
    role: 'user',
    content: parts.join('\n\n'),
  };
}

function selectHistoryMessages(history: ChatMessage[], maxChars: number): ChatMessage[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  const selected: ChatMessage[] = [];
  let total = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    const size = String(message?.content || '').length;
    if (selected.length > 0 && total + size > maxChars) break;
    selected.unshift(message);
    total += size;
  }
  return selected;
}

function serializeConversationMessages(
  messages: ChatMessage[],
  maxChars: number,
  perMessageLimit: number,
): string {
  const selected = selectHistoryMessages(messages, maxChars);
  if (selected.length === 0) return '';
  return selected
    .map((msg) => `${msg.role === 'user' ? 'Пользователь' : 'Агент'}: ${truncate(String(msg.content || ''), perMessageLimit, '…')}`)
    .join('\n\n');
}

function buildUserRequestEnvelope(
  lastQuestion: string,
  isFirstMessage: boolean,
  freshMcpRequired: boolean,
): string {
  return (
    `[Запрос пользователя]: ${lastQuestion}\n\n` +
    (freshMcpRequired
      ? 'Это вопрос про внешние данные MCP/remote system. Память прошлых запросов используй только как подсказку маршрута. Перед final_answer сначала получи свежий результат через list_mcp_tools или mcp_tool в ТЕКУЩЕМ запуске.\n\n'
      : '') +
    (isFirstMessage
      ? 'Выше — контекст проекта. Следуй исходной цели пользователя и собери только релевантные факты.'
      : 'Вызови утилиту или final_answer, если контекста достаточно для цели пользователя.')
  );
}

async function runAutoContextTool(
  session: AgentSession,
  toolName: string,
  args: any,
): Promise<void> {
  session.trace.autoStart(toolName, args);

  try {
    const result = await executeToolResult(toolName, args, session.lastQuestion, session.trace.event, session.signal);
    session.pushUser(`[Авто-контекст: ${toolName}]:\n${truncate(result.content)}`);
    session.usedCalls.add(session.buildToolCallKey(toolName, args));
    updateMemory(session.memory, toolName, args, result);
    session.modelUsedTools.add(toolName);
    session.trace.autoDone(toolName, args, result.content, result.status);
  } catch {
    // Авто-контекст не должен останавливать основной запрос.
  }
}
