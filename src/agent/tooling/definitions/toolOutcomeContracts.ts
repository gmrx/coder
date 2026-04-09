import type { ToolExecutionResult, ToolExecutionStatus } from '../results';

export type ToolOutcomeTransitionReason =
  | 'subagent_followup'
  | 'verification_failed'
  | 'verification_partial'
  | 'verification_passed';

export type ToolOutcomeDirective = {
  transitionReason: ToolOutcomeTransitionReason;
  detail: string;
  prompt: string;
  markSubagentUsed?: boolean;
};

type ToolOutcomeContract = {
  suppressGenericRecoveryPromptFor?: ToolExecutionStatus[];
  resolveDirective?: (execution: ToolExecutionResult) => ToolOutcomeDirective | null;
};

const TOOL_OUTCOME_CONTRACTS: Partial<Record<string, ToolOutcomeContract>> = {
  subagent: {
    suppressGenericRecoveryPromptFor: ['error'],
    resolveDirective(execution) {
      const hasSubErrors = execution.status === 'error';
      return {
        transitionReason: 'subagent_followup',
        detail: hasSubErrors
          ? 'Есть проблемные направления, нужен добор.'
          : 'Теперь можно синтезировать и добирать только критичные пробелы.',
        prompt: hasSubErrors
          ? 'Часть subagent-задач завершилась с ошибками. Сначала сделай вторую волну subagent:\n- только по проваленным направлениям\n- с более конкретными задачами (goal/task + files при наличии)\n- parallel:true\nПосле этого добери только критические пробелы и переходи к final_answer.'
          : 'Subagent-результаты получены. Теперь работай как оркестратор: синтезируй вывод, добери только критические пробелы и переходи к final_answer.',
        markSubagentUsed: true,
      };
    },
  },
  verification_agent: {
    suppressGenericRecoveryPromptFor: ['error', 'degraded'],
    resolveDirective(execution) {
      if (execution.status === 'error') {
        return {
          transitionReason: 'verification_failed',
          detail: execution.content,
          prompt:
            'Независимая проверка нашла проблему.\n' +
            'Не переходи к final_answer как будто всё в порядке.\n' +
            'Либо исправь найденный риск, либо явно добери недостающий факт/проверку перед завершением.',
        };
      }

      if (execution.status === 'degraded') {
        return {
          transitionReason: 'verification_partial',
          detail: execution.content,
          prompt:
            'Верификация завершилась частично: часть проверок не удалось подтвердить.\n' +
            'Либо добери ещё доступные проверки, либо в финальном ответе явно укажи ограничения и что осталось непроверенным.',
        };
      }

      if (execution.status === 'success') {
        return {
          transitionReason: 'verification_passed',
          detail: execution.content,
          prompt:
            'Независимая верификация завершилась успешно.\n' +
            'Теперь либо добери последний критичный штрих, либо переходи к final_answer и кратко учти результаты проверки.',
        };
      }

      return null;
    },
  },
};

export function getToolOutcomeDirective(
  toolName: string,
  execution: ToolExecutionResult,
): ToolOutcomeDirective | null {
  return TOOL_OUTCOME_CONTRACTS[toolName]?.resolveDirective?.(execution) || null;
}

export function shouldSuppressGenericRecoveryPrompt(
  toolName: string,
  status: ToolExecutionStatus,
): boolean {
  return !!TOOL_OUTCOME_CONTRACTS[toolName]?.suppressGenericRecoveryPromptFor?.includes(status);
}
