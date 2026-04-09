import type { AgentQuestionRequest, AgentQuestionResult } from '../../agent/runtime/questions';

export interface QuestionRequestMessage {
  type: 'questionRequest';
  request: AgentQuestionRequest;
}

export interface QuestionResolvedMessage {
  type: 'questionResolved';
  result: AgentQuestionResult;
}

export interface QuestionResultMessage {
  type: 'questionResult';
  result: AgentQuestionResult;
}
