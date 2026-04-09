import { validateToolInput } from './toolInputValidators';

export function validateToolArgs(tool: string, args: any, query?: string): string | null {
  return validateToolInput(tool, args, { query });
}

export function validateSubagentArgs(tool: string, args: any): string | null {
  return validateToolInput(tool, args, {});
}
