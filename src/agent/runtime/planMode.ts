import { isToolReadOnly } from '../tooling/catalog';

export function isToolBlockedInPlanMode(toolName: string, args: any): boolean {
  if (toolName === 'enter_plan_mode' || toolName === 'exit_plan_mode' || toolName === 'final_answer') {
    return false;
  }

  if (toolName === 'subagent') {
    const readonly = args?.readonly !== false;
    const type = String(args?.subagent_type || 'explore');
    return !readonly || type === 'shell' || type === 'generalPurpose';
  }

  return !isToolReadOnly(toolName);
}
