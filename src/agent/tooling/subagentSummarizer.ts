import type { SubagentBatchPlan, SubagentTaskOutput } from './subagentTypes';

export function buildSubagentBatchResult(plan: SubagentBatchPlan, outputs: SubagentTaskOutput[]): string {
  const lines = [`Subagent batch: ${outputs.length} задач (${plan.parallel ? 'parallel' : 'sequential'})`, ''];
  for (const output of outputs) {
    lines.push(`### ${output.label}`);
    lines.push(output.result || '(пустой результат)');
    lines.push('');
  }
  return lines.join('\n').trim();
}
