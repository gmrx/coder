export type ToolEventCallback = (phase: string, message: string, meta?: any) => void | Promise<any>;
import type { ToolExecutionOutput, ToolExecutionResult } from './results';
import type { AgentToolSearchRecommendation } from '../runtime/types';
import type { AgentWorktreeSession } from '../worktreeSession';

export interface ToolRuntimeHints {
  studiedFiles?: Set<string>;
  worktreeSession?: AgentWorktreeSession | null;
  setWorktreeSession?: (session: AgentWorktreeSession | null) => void;
}

export interface ToolExecutionContext {
  query?: string;
  onEvent?: ToolEventCallback;
  signal?: AbortSignal;
  studiedFiles?: Set<string>;
  worktreeSession?: AgentWorktreeSession | null;
  setWorktreeSession?: (session: AgentWorktreeSession | null) => void;
}

export type ExecuteToolFn = (
  toolName: string,
  args: any,
  query?: string,
  onEvent?: ToolEventCallback,
  signal?: AbortSignal,
  recommendation?: AgentToolSearchRecommendation | null,
  runtimeHints?: ToolRuntimeHints,
) => Promise<string>;

export type ExecuteToolResultFn = (
  toolName: string,
  args: any,
  query?: string,
  onEvent?: ToolEventCallback,
  signal?: AbortSignal,
  recommendation?: AgentToolSearchRecommendation | null,
  runtimeHints?: ToolRuntimeHints,
) => Promise<ToolExecutionResult>;

export type ToolHandler = (args: any, context: ToolExecutionContext) => Promise<ToolExecutionOutput>;

export type ToolHandlerMap = Record<string, ToolHandler>;
