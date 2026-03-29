import { z } from "zod";

import { sessionSchema, turnSchema } from "./core";
import {
  copilotTurnResponseSchema,
  relayPacketSchema,
  validationIssueSchema
} from "./relay";
import { relayModeSchema } from "./shared";
import { diffSummarySchema } from "./workbook";

export const storageModeSchema = z.enum(["memory", "local-json"]);

export const initializeAppResponseSchema = z.object({
  appName: z.literal("Relay Agent"),
  initialized: z.boolean(),
  storageReady: z.boolean(),
  storageMode: storageModeSchema,
  sessionCount: z.number().int().nonnegative(),
  supportedRelayModes: z.array(relayModeSchema).default(relayModeSchema.options)
});

export const createSessionRequestSchema = z.object({
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  primaryWorkbookPath: z.string().trim().min(1).optional()
});

export const readSessionRequestSchema = z.object({
  sessionId: z.string().trim().min(1)
});

export const sessionDetailSchema = z.object({
  session: sessionSchema,
  turns: z.array(turnSchema).default([])
});

export const startTurnRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  mode: relayModeSchema
});

export const startTurnResponseSchema = z.object({
  session: sessionSchema,
  turn: turnSchema
});

export const listSessionsResponseSchema = z.array(sessionSchema);

export const generateRelayPacketRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1)
});

export const submitCopilotResponseRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1),
  rawResponse: z.string().trim().min(1)
});

export const submitCopilotResponseResponseSchema = z.object({
  turn: turnSchema,
  accepted: z.boolean(),
  validationIssues: z.array(validationIssueSchema),
  parsedResponse: copilotTurnResponseSchema.optional(),
  repairPrompt: z.string().optional()
});

export const previewExecutionRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1)
});

export const previewExecutionResponseSchema = z.object({
  turn: turnSchema,
  ready: z.boolean(),
  requiresApproval: z.boolean(),
  canExecute: z.boolean(),
  diffSummary: diffSummarySchema,
  warnings: z.array(z.string()).default([])
});

export const approvalDecisionSchema = z.enum(["approved", "rejected"]);

export const respondToApprovalRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1),
  decision: approvalDecisionSchema,
  note: z.string().trim().min(1).optional()
});

export const respondToApprovalResponseSchema = z.object({
  turn: turnSchema,
  decision: approvalDecisionSchema,
  readyForExecution: z.boolean()
});

export const runExecutionRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1)
});

export const runExecutionResponseSchema = z.object({
  turn: turnSchema,
  executed: z.boolean(),
  outputPath: z.string().min(1).optional(),
  warnings: z.array(z.string()).default([]),
  reason: z.string().min(1).optional()
});

export type StorageMode = z.infer<typeof storageModeSchema>;
export type InitializeAppResponse = z.infer<typeof initializeAppResponseSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type ReadSessionRequest = z.infer<typeof readSessionRequestSchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type StartTurnRequest = z.infer<typeof startTurnRequestSchema>;
export type StartTurnResponse = z.infer<typeof startTurnResponseSchema>;
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;
export type GenerateRelayPacketRequest = z.infer<typeof generateRelayPacketRequestSchema>;
export type GenerateRelayPacketResponse = z.infer<typeof relayPacketSchema>;
export type SubmitCopilotResponseRequest = z.infer<
  typeof submitCopilotResponseRequestSchema
>;
export type SubmitCopilotResponseResponse = z.infer<
  typeof submitCopilotResponseResponseSchema
>;
export type PreviewExecutionRequest = z.infer<typeof previewExecutionRequestSchema>;
export type PreviewExecutionResponse = z.infer<typeof previewExecutionResponseSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type RespondToApprovalRequest = z.infer<typeof respondToApprovalRequestSchema>;
export type RespondToApprovalResponse = z.infer<
  typeof respondToApprovalResponseSchema
>;
export type RunExecutionRequest = z.infer<typeof runExecutionRequestSchema>;
export type RunExecutionResponse = z.infer<typeof runExecutionResponseSchema>;
