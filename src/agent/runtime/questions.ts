export interface AgentQuestionOption {
  label: string;
  description: string;
}

export interface AgentQuestionPrompt {
  question: string;
  header: string;
  options: AgentQuestionOption[];
  multiSelect?: boolean;
}

export interface AgentQuestionRequest {
  kind: 'question';
  confirmId: string;
  title: string;
  description?: string;
  toolName?: string;
  step?: number | string;
  questions: AgentQuestionPrompt[];
}

export interface AgentQuestionResult {
  kind: 'question';
  confirmId: string;
  answered: boolean;
  answers: Record<string, string>;
  cancelled?: boolean;
  reason?: string;
}
