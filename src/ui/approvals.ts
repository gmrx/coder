import type {
  AgentApprovalRequest,
  AgentApprovalResult,
} from '../agent/runtime/approvals';
import type { ApprovalRequestMessage, ApprovalResolvedMessage } from './protocol/approvals';

type ApprovalResolver = (result: AgentApprovalResult) => void;
type ApprovalPost = (message: ApprovalRequestMessage | ApprovalResolvedMessage) => void;
type PendingApproval = {
  request: AgentApprovalRequest;
  resolve: ApprovalResolver;
};

export class ApprovalController {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(private readonly post: ApprovalPost) {}

  request(request: AgentApprovalRequest, signal?: AbortSignal): Promise<AgentApprovalResult> {
    if (signal?.aborted) {
      return Promise.resolve(this.buildCancelledResult(request, 'Запуск остановлен пользователем.'));
    }

    return new Promise<AgentApprovalResult>((resolve) => {
      const finish = (result: AgentApprovalResult) => {
        this.pending.delete(request.confirmId);
        resolve(result);
      };

      this.pending.set(request.confirmId, {
        request,
        resolve: finish,
      });
      this.post({ type: 'approvalRequest', request });
    });
  }

  resolve(result: AgentApprovalResult | undefined): void {
    if (!result?.confirmId) return;
    const pending = this.pending.get(result.confirmId);
    if (!pending) return;
    this.post({ type: 'approvalResolved', result });
    pending.resolve(result);
  }

  cancel(confirmId: string, reason = 'Запуск остановлен пользователем.'): void {
    const pending = this.pending.get(confirmId);
    if (!pending) return;
    const result = this.buildCancelledResult(pending.request, reason);
    this.post({ type: 'approvalResolved', result });
    pending.resolve(result);
  }

  resolveLegacyShell(meta: { confirmId: string; approved?: boolean; command?: string }): void {
    this.resolve({
      kind: 'shell',
      confirmId: meta.confirmId,
      approved: !!meta.approved,
      command: meta.command || '',
    });
  }

  resolveLegacyPlan(meta: { confirmId: string; approved?: boolean; plan?: string; feedback?: string }): void {
    this.resolve({
      kind: 'plan',
      confirmId: meta.confirmId,
      approved: !!meta.approved,
      plan: meta.plan || '',
      feedback: meta.feedback || '',
    });
  }

  resolveLegacyFile(meta: { confirmId: string; approved?: boolean }): void {
    this.resolve({
      kind: 'file',
      confirmId: meta.confirmId,
      approved: !!meta.approved,
    });
  }

  private buildCancelledResult(request: AgentApprovalRequest, reason: string): AgentApprovalResult {
    if (request.kind === 'shell') {
      return {
        kind: 'shell',
        confirmId: request.confirmId,
        approved: false,
        cancelled: true,
        reason,
        command: request.command,
      };
    }

    if (request.kind === 'plan') {
      return {
        kind: 'plan',
        confirmId: request.confirmId,
        approved: false,
        cancelled: true,
        reason,
        plan: request.plan,
        feedback: reason,
      };
    }

    if (request.kind === 'worktree') {
      return {
        kind: 'worktree',
        confirmId: request.confirmId,
        approved: false,
        cancelled: true,
        reason,
      };
    }

    if (request.kind === 'mcp') {
      return {
        kind: 'mcp',
        confirmId: request.confirmId,
        approved: false,
        cancelled: true,
        reason,
      };
    }

    if (request.kind === 'web') {
      return {
        kind: 'web',
        confirmId: request.confirmId,
        approved: false,
        cancelled: true,
        reason,
      };
    }

    return {
      kind: 'file',
      confirmId: request.confirmId,
      approved: false,
      cancelled: true,
      reason,
    };
  }
}
