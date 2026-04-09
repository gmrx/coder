import type { AgentQuestionRequest, AgentQuestionResult } from '../agent/runtime/questions';
import type { QuestionRequestMessage, QuestionResolvedMessage } from './protocol/questions';

type QuestionResolver = (result: AgentQuestionResult) => void;
type QuestionPost = (message: QuestionRequestMessage | QuestionResolvedMessage) => void;

type PendingQuestion = {
  request: AgentQuestionRequest;
  resolve: QuestionResolver;
};

export class QuestionController {
  private readonly pending = new Map<string, PendingQuestion>();

  constructor(private readonly post: QuestionPost) {}

  request(request: AgentQuestionRequest, signal?: AbortSignal): Promise<AgentQuestionResult> {
    if (signal?.aborted) {
      return Promise.resolve(this.buildCancelledResult(request, 'Запуск остановлен пользователем.'));
    }

    return new Promise<AgentQuestionResult>((resolve) => {
      const finish = (result: AgentQuestionResult) => {
        this.pending.delete(request.confirmId);
        resolve(result);
      };

      this.pending.set(request.confirmId, {
        request,
        resolve: finish,
      });
      this.post({ type: 'questionRequest', request });
    });
  }

  resolve(result: AgentQuestionResult | undefined): void {
    if (!result?.confirmId) return;
    const pending = this.pending.get(result.confirmId);
    if (!pending) return;
    this.post({ type: 'questionResolved', result });
    pending.resolve(result);
  }

  cancel(confirmId: string, reason = 'Запуск остановлен пользователем.'): void {
    const pending = this.pending.get(confirmId);
    if (!pending) return;
    const result = this.buildCancelledResult(pending.request, reason);
    this.post({ type: 'questionResolved', result });
    pending.resolve(result);
  }

  private buildCancelledResult(request: AgentQuestionRequest, reason: string): AgentQuestionResult {
    return {
      kind: 'question',
      confirmId: request.confirmId,
      answered: false,
      answers: {},
      cancelled: true,
      reason,
    };
  }
}
