import {
  buildRecommendedToolRecoveryWorkflowPrompt,
  shouldSuppressGenericRecoveryPrompt,
} from '../tooling/catalog';
import type { ToolExecutionResult } from '../tooling/results';
import type { AgentSession } from './agentSession';

export type PostToolRecoveryDirective = {
  prompt: string;
};

type PostToolRecoveryResolver = (
  session: AgentSession,
  toolName: string,
  execution: ToolExecutionResult,
) => PostToolRecoveryDirective | null;

const POST_TOOL_RECOVERY_RESOLVERS: Record<
  Extract<ToolExecutionResult['status'], 'blocked' | 'error' | 'degraded'>,
  PostToolRecoveryResolver[]
> = {
  blocked: [
    resolvePreflightFollowupDirective,
    resolveBlockedRecoveryDirective,
  ],
  error: [
    resolvePreflightFollowupDirective,
    resolveErrorRecoveryDirective,
  ],
  degraded: [
    resolvePreflightFollowupDirective,
    resolveDegradedRecoveryDirective,
  ],
};

export function resolvePostToolRecoveryDirective(
  session: AgentSession,
  toolName: string,
  execution: ToolExecutionResult,
): PostToolRecoveryDirective | null {
  if (execution.status !== 'blocked' && execution.status !== 'error' && execution.status !== 'degraded') {
    return null;
  }

  const resolvers = POST_TOOL_RECOVERY_RESOLVERS[execution.status];
  for (const resolve of resolvers) {
    const directive = resolve(session, toolName, execution);
    if (directive) return directive;
  }

  return null;
}

function resolvePreflightFollowupDirective(
  _session: AgentSession,
  _toolName: string,
  execution: ToolExecutionResult,
): PostToolRecoveryDirective | null {
  if (
    (execution.meta?.phase === 'validation' || execution.meta?.phase === 'permission') &&
    execution.meta?.followupPrompt
  ) {
    return {
      prompt: execution.meta.followupPrompt,
    };
  }

  return null;
}

function resolveBlockedRecoveryDirective(
  session: AgentSession,
  toolName: string,
  _execution: ToolExecutionResult,
): PostToolRecoveryDirective {
  return {
    prompt: buildRecommendedToolRecoveryWorkflowPrompt(
      toolName,
      'blocked',
      session.getToolSearchRecommendation(),
    ),
  };
}

function resolveErrorRecoveryDirective(
  session: AgentSession,
  toolName: string,
  _execution: ToolExecutionResult,
): PostToolRecoveryDirective | null {
  if (shouldSuppressGenericRecoveryPrompt(toolName, 'error')) {
    return null;
  }

  return {
    prompt: buildRecommendedToolRecoveryWorkflowPrompt(
      toolName,
      'error',
      session.getToolSearchRecommendation(),
    ),
  };
}

function resolveDegradedRecoveryDirective(
  session: AgentSession,
  toolName: string,
  _execution: ToolExecutionResult,
): PostToolRecoveryDirective | null {
  if (shouldSuppressGenericRecoveryPrompt(toolName, 'degraded')) {
    return null;
  }

  return {
    prompt: buildRecommendedToolRecoveryWorkflowPrompt(
      toolName,
      'degraded',
      session.getToolSearchRecommendation(),
    ),
  };
}
