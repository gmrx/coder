import { USER_ABORT_MESSAGE } from '../../core/modelClient';
import { buildPlanModeApprovedImplementationPromptContract } from '../tooling/catalog';
import type { AgentSession } from './agentSession';
import { beginApprovalRejectedRecovery, clearAgentRecovery } from './recovery';
import type { TurnLoopState } from './turnState';
import { createTurnTransition } from './transitions';
import { emitAgentTransition } from './transitionDispatcher';

export type PlanModeExitResult =
  | { kind: 'continue' }
  | { kind: 'return'; answer: string };

export async function handlePlanModeExit(
  session: AgentSession,
  state: TurnLoopState,
  response: string,
): Promise<PlanModeExitResult> {
  session.pushAssistant(response);
  const draftPlan = await session.finalizeAnswer(
    session.buildPlanModeFinalPrompt(),
    state.iteration,
    'Формирую план для согласования...',
  );
  if (draftPlan.startsWith('Ошибка API:')) {
    return { kind: 'return', answer: draftPlan };
  }

  session.pushAssistant(draftPlan);
  const approval = await session.requestPlanApproval(draftPlan, state.iteration);

  if (approval.cancelled || session.signal?.aborted) {
    session.trace.planApproval('Согласование плана прервано.', 'cancelled', {
      step: state.iteration,
      reason: approval.reason || 'Запуск остановлен пользователем.',
    });
    return { kind: 'return', answer: USER_ABORT_MESSAGE };
  }

  if (!approval.approved) {
    const recovery = beginApprovalRejectedRecovery(
      state.recovery,
      'exit_plan_mode',
      approval.feedback || approval.plan || '',
    );
    session.trace.planApproval('План возвращён на доработку.', 'rejected', {
      step: state.iteration,
    });
    session.trace.recovery(recovery.summary, {
      step: state.iteration,
      kind: recovery.kind,
      tool: recovery.toolName,
      summary: recovery.summary,
      detail: recovery.detail,
      repeatCount: recovery.repeatCount,
    });
    emitAgentTransition(
      session,
      state,
      createTurnTransition(
        state.iteration,
        'plan_approval_rejected',
        approval.feedback || approval.plan || '',
        'exit_plan_mode',
      ),
    );
    session.pushUser(session.buildPlanRevisionPrompt(approval.feedback, approval.plan));
    return { kind: 'continue' };
  }

  state.planModeCompleted = true;
  clearAgentRecovery(state.recovery);
  const approvedPlan = (approval.plan || draftPlan || '').trim() || draftPlan;
  session.trace.planApproval('План утверждён.', 'approved', {
    step: state.iteration,
  });
  session.exitPlanMode();

  if (session.mutationQuery) {
    session.pushUser(buildPlanModeApprovedImplementationPromptContract(approvedPlan));
    return { kind: 'continue' };
  }

  return { kind: 'return', answer: approvedPlan };
}
