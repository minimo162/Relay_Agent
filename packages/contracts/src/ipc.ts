import { z } from "zod";

import { sessionSchema, turnSchema } from "./core";
import {
  copilotTurnResponseSchema,
  relayPacketSchema,
  validationIssueSchema
} from "./relay";
import { relayModeSchema } from "./shared";
import { diffSummarySchema, workbookFormatSchema } from "./workbook";

export const storageModeSchema = z.enum(["memory", "local-json"]);
export const startupStatusSchema = z.enum(["ready", "attention"]);
export const startupRecoveryActionSchema = z.enum([
  "retryInit",
  "continueTemporaryMode",
  "openSettings"
]);

export const startupIssueSchema = z.object({
  problem: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  nextSteps: z.array(z.string().trim().min(1)).default([]),
  recoveryActions: z.array(startupRecoveryActionSchema).default([]),
  storagePath: z.string().trim().min(1).optional()
});

export const initializeAppResponseSchema = z.object({
  appName: z.literal("Relay Agent"),
  initialized: z.boolean(),
  storageReady: z.boolean(),
  storageMode: storageModeSchema,
  storagePath: z.string().trim().min(1).optional(),
  sessionCount: z.number().int().nonnegative(),
  supportedRelayModes: z.array(relayModeSchema).default(relayModeSchema.options),
  startupStatus: startupStatusSchema,
  startupIssue: startupIssueSchema.optional(),
  sampleWorkbookPath: z.string().trim().min(1).optional()
});

export const workbookPreflightStatusSchema = z.enum([
  "ready",
  "warning",
  "blocked"
]);
export const workbookPreflightCheckLevelSchema = z.enum([
  "info",
  "warning",
  "blocking"
]);
export const preflightWorkbookRequestSchema = z.object({
  workbookPath: z.string().trim().min(1)
});
export const workbookPreflightCheckSchema = z.object({
  code: z.string().trim().min(1),
  title: z.string().trim().min(1),
  detail: z.string().trim().min(1),
  level: workbookPreflightCheckLevelSchema
});
export const preflightWorkbookResponseSchema = z.object({
  workbookPath: z.string().trim().min(1),
  status: workbookPreflightStatusSchema,
  headline: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  format: workbookFormatSchema.optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  checks: z.array(workbookPreflightCheckSchema).default([]),
  guidance: z.array(z.string().trim().min(1)).default([])
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

export const copilotHandoffStatusSchema = z.enum(["clear", "caution"]);
export const copilotHandoffReasonSourceSchema = z.enum([
  "path",
  "column",
  "objective"
]);
export const assessCopilotHandoffRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1)
});
export const copilotHandoffReasonSchema = z.object({
  source: copilotHandoffReasonSourceSchema,
  label: z.string().trim().min(1),
  detail: z.string().trim().min(1)
});
export const assessCopilotHandoffResponseSchema = z.object({
  status: copilotHandoffStatusSchema,
  headline: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  reasons: z.array(copilotHandoffReasonSchema).default([]),
  suggestedActions: z.array(z.string().trim().min(1)).default([])
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
export type StartupStatus = z.infer<typeof startupStatusSchema>;
export type StartupRecoveryAction = z.infer<typeof startupRecoveryActionSchema>;
export type StartupIssue = z.infer<typeof startupIssueSchema>;
export type InitializeAppResponse = z.infer<typeof initializeAppResponseSchema>;
export type WorkbookPreflightStatus = z.infer<typeof workbookPreflightStatusSchema>;
export type WorkbookPreflightCheckLevel = z.infer<
  typeof workbookPreflightCheckLevelSchema
>;
export type PreflightWorkbookRequest = z.infer<typeof preflightWorkbookRequestSchema>;
export type WorkbookPreflightCheck = z.infer<typeof workbookPreflightCheckSchema>;
export type PreflightWorkbookResponse = z.infer<
  typeof preflightWorkbookResponseSchema
>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type ReadSessionRequest = z.infer<typeof readSessionRequestSchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type StartTurnRequest = z.infer<typeof startTurnRequestSchema>;
export type StartTurnResponse = z.infer<typeof startTurnResponseSchema>;
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;
export type GenerateRelayPacketRequest = z.infer<typeof generateRelayPacketRequestSchema>;
export type GenerateRelayPacketResponse = z.infer<typeof relayPacketSchema>;
export type CopilotHandoffStatus = z.infer<typeof copilotHandoffStatusSchema>;
export type CopilotHandoffReasonSource = z.infer<
  typeof copilotHandoffReasonSourceSchema
>;
export type AssessCopilotHandoffRequest = z.infer<
  typeof assessCopilotHandoffRequestSchema
>;
export type CopilotHandoffReason = z.infer<typeof copilotHandoffReasonSchema>;
export type AssessCopilotHandoffResponse = z.infer<
  typeof assessCopilotHandoffResponseSchema
>;
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
