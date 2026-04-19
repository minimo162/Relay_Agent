import type { AgentSessionPhase, AgentStopReason } from "../lib/ipc";

export type SessionPhase = AgentSessionPhase;

export interface SessionStatusSnapshot {
  phase: SessionPhase;
  attempt?: number;
  message?: string;
  nextRetryAtMs?: number;
  toolName?: string;
  stopReason?: AgentStopReason;
}

export interface Approval {
  sessionId: string;
  approvalId: string;
  toolName: string;
  description: string;
  target?: string;
  /** Session was started with a workspace cwd — show "Allow for this workspace". */
  workspaceCwdConfigured?: boolean;
}

export type ApprovalActionHandler = (
  sessionId: string,
  approvalId: string,
) => void | Promise<void>;

export interface UserQuestion {
  sessionId: string;
  questionId: string;
  prompt: string;
}
