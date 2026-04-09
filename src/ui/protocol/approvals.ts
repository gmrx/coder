import type { AgentApprovalRequest, AgentApprovalResult } from '../../agent/runtime/approvals';

export interface ApprovalRequestMessage {
  type: 'approvalRequest';
  request: AgentApprovalRequest;
}

export interface ApprovalResolvedMessage {
  type: 'approvalResolved';
  result: AgentApprovalResult;
}

export interface ApprovalResultMessage {
  type: 'approvalResult';
  result: AgentApprovalResult;
}
