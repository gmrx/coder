import type { ToolHandlerMap } from '../types';
import { codeAnalysisToolHandlers } from './codeAnalysisTools';
import { codeSearchToolHandlers } from './codeSearchTools';
import { lspToolHandlers } from './lspTools';

export const codeToolHandlers: ToolHandlerMap = {
  ...codeSearchToolHandlers,
  ...codeAnalysisToolHandlers,
  ...lspToolHandlers,
};
