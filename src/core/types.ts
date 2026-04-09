export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProjectStructureOverview {
  rootName: string;
  topDirectories: { name: string; count: number }[];
  importantFiles: string[];
}

export interface EntrypointsInfo {
  languageGuesses: string[];
  entryFiles: string[];
}

export interface GrepMatch {
  file: string;
  line: number;
  matchedLine: string;
  context: string;
  contextStartLine: number;
}

export interface FileSymbolOutline {
  file: string;
  symbols: {
    name: string;
    kind: string;
    line: number;
    detail?: string;
  }[];
}

export interface ImportInfo {
  source: string;
  target: string;
  isRelative: boolean;
}

export interface DependencyEdge {
  from: string;
  to: string;
}

export interface AssistantAutoApprovalConfig {
  fileCreate: boolean;
  fileEdit: boolean;
  fileDelete: boolean;
  webFetch: boolean;
  shell: boolean;
  worktree: boolean;
  mcp: boolean;
}

export interface AssistantConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  embeddingsModel: string;
  rerankModel: string;
  systemPrompt: string;
  mcpConfigPath: string;
  mcpServers: Record<string, unknown>;
  mcpDisabledTools: string[];
  mcpTrustedTools: string[];
  webTrustedHosts: string[];
  webBlockedHosts: string[];
  autoApproval: AssistantAutoApprovalConfig;
}
