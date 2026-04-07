export type SessionState = "idle" | "running" | "error";

export interface Approval {
  sessionId: string;
  approvalId: string;
  toolName: string;
  description: string;
  target?: string;
}
