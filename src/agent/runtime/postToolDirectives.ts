import { getToolOutcomeDirective } from '../tooling/catalog';
import type { ToolExecutionResult } from '../tooling/results';
import type { AgentSession } from './agentSession';
import type { TurnLoopState } from './turnState';
import { emitAgentTransition } from './transitionDispatcher';
import { createTurnTransition, type AgentTurnTransitionReason } from './transitions';

export type PostToolDirective = {
  transitionReason: AgentTurnTransitionReason;
  detail: string;
  prompt: string;
  toolName?: string;
  markSubagentUsed?: boolean;
};

type PostToolDirectiveResolver = (
  session: AgentSession,
  state: TurnLoopState,
  toolName: string,
  toolArgs: any,
  execution: ToolExecutionResult,
) => PostToolDirective | null;

const POST_TOOL_DIRECTIVE_RESOLVERS: PostToolDirectiveResolver[] = [
  resolveOutcomeContractDirective,
  resolveTraceFileGuardDirective,
];

export function resolvePostToolDirective(
  session: AgentSession,
  state: TurnLoopState,
  toolName: string,
  toolArgs: any,
  execution: ToolExecutionResult,
): PostToolDirective | null {
  for (const resolve of POST_TOOL_DIRECTIVE_RESOLVERS) {
    const directive = resolve(session, state, toolName, toolArgs, execution);
    if (directive) return directive;
  }
  return null;
}

export function executePostToolDirective(
  session: AgentSession,
  state: TurnLoopState,
  directive: PostToolDirective,
): void {
  if (directive.markSubagentUsed) {
    state.subagentUsed = true;
  }

  emitAgentTransition(
    session,
    state,
    createTurnTransition(
      state.iteration,
      directive.transitionReason,
      directive.detail,
      directive.toolName,
    ),
  );
  session.pushUser(directive.prompt);
}

function resolveOutcomeContractDirective(
  _session: AgentSession,
  _state: TurnLoopState,
  toolName: string,
  _toolArgs: any,
  execution: ToolExecutionResult,
): PostToolDirective | null {
  const directive = getToolOutcomeDirective(toolName, execution);
  if (!directive) return null;

  return {
    transitionReason: directive.transitionReason,
    detail: directive.detail,
    prompt: directive.prompt,
    toolName,
    markSubagentUsed: directive.markSubagentUsed,
  };
}

function resolveTraceFileGuardDirective(
  _session: AgentSession,
  state: TurnLoopState,
  toolName: string,
  toolArgs: any,
  _execution: ToolExecutionResult,
): PostToolDirective | null {
  if (
    !state.subagentUsed ||
    toolName !== 'read_file' ||
    !String(toolArgs?.path || '').startsWith('.ai-assistant/traces/')
  ) {
    return null;
  }

  return {
    transitionReason: 'trace_file_guard',
    detail: 'Служебные trace-файлы не должны уводить анализ в сторону.',
    prompt:
      'Не анализируй служебные trace-файлы для ответа пользователю, если это не было явно запрошено. ' +
      'Сфокусируйся на исходном коде и конфигурации проекта.',
    toolName,
  };
}
