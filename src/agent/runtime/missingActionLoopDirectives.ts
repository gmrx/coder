import type { AgentSession } from './agentSession';
import type { AgentLoopDirective } from './loopDirectives';
import { buildFallbackFinalProgressLabel } from './loopDirectiveContracts';
import { evaluateMissingAction } from './turnStateMachine';
import type { TurnLoopState } from './turnState';

export function resolveMissingActionLoopDirective(
  session: AgentSession,
  state: TurnLoopState,
  response: string,
): AgentLoopDirective {
  const decision = evaluateMissingAction(session, state);
  if (decision.kind === 'continue') {
    return {
      kind: 'continue',
      response,
      decision: decision.decision,
    };
  }

  if (decision.kind === 'fallback_final') {
    return {
      kind: 'fallback_final',
      response,
      transition: decision.transition,
      finalPrompt: session.buildFallbackFinalPrompt(),
      progressLabel: buildFallbackFinalProgressLabel(),
    };
  }

  if (decision.kind === 'execute_tool') {
    return {
      kind: 'execute_tool',
      response: '',
      action: decision.action,
      transition: decision.transition,
      synthetic: true,
    };
  }

  return {
    kind: 'error',
    message: decision.message,
  };
}
