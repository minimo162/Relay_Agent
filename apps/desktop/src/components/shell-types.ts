export type SessionState = "idle" | "running" | "error";

export interface Approval {
  sessionId: string;
  approvalId: string;
  toolName: string;
  description: string;
  target?: string;
  /** Session was started with a workspace cwd — show "Allow for this workspace". */
  workspaceCwdConfigured?: boolean;
}

export interface UserQuestion {
  sessionId: string;
  questionId: string;
  prompt: string;
}
