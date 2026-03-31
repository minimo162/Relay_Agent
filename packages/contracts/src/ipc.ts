import { z } from "zod";

import { sessionSchema, turnSchema, turnStatusSchema } from "./core";
import {
  copilotTurnResponseSchema,
  relayPacketSchema,
  validationIssueSchema
} from "./relay";
import {
  entityIdSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  relayModeSchema
} from "./shared";
import {
  diffSummarySchema,
  sheetColumnProfileSchema,
  sheetPreviewSchema,
  workbookFormatSchema,
  workbookProfileSchema
} from "./workbook";

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
export const inspectWorkbookRequestSchema = z.object({
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
export const inspectWorkbookResponseSchema = z.object({
  profile: workbookProfileSchema,
  columnProfiles: z.array(sheetColumnProfileSchema).default([])
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

export const readTurnArtifactsRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1)
});

export const previewArtifactPayloadSchema = z.object({
  diffSummary: diffSummarySchema,
  requiresApproval: z.boolean(),
  warnings: z.array(z.string()).default([])
});

export const turnInspectionSourceTypeSchema = z.enum([
  "live",
  "persisted",
  "mixed"
]);
export const turnInspectionUnavailableReasonSchema = z.enum([
  "notGeneratedYet",
  "stepNotReached",
  "temporaryLiveOnly",
  "notSupportedForTurnVersion",
  "generationFailed"
]);
export const turnOverviewStepStateSchema = z.enum([
  "complete",
  "current",
  "pending",
  "failed",
  "notRequired"
]);
export const executionInspectionStateSchema = z.enum([
  "not-run",
  "completed",
  "failed",
  "not-required"
]);

export const turnOverviewStepSchema = z.object({
  id: z.enum(["packet", "validation", "preview", "approval", "execution"]),
  label: nonEmptyStringSchema,
  state: turnOverviewStepStateSchema,
  summary: nonEmptyStringSchema
});

export const turnOverviewSchema = z.object({
  turnStatus: turnStatusSchema,
  relayMode: relayModeSchema,
  storageMode: storageModeSchema,
  currentStageLabel: nonEmptyStringSchema,
  summary: nonEmptyStringSchema,
  guardrailSummary: nonEmptyStringSchema,
  steps: z.array(turnOverviewStepSchema).default([])
});

export const packetInspectionPayloadSchema = z.object({
  sessionTitle: nonEmptyStringSchema,
  turnTitle: nonEmptyStringSchema,
  sourcePath: nonEmptyStringSchema.optional(),
  relayMode: relayModeSchema,
  objective: nonEmptyStringSchema,
  contextLines: z.array(nonEmptyStringSchema).default([]),
  allowedReadToolCount: z.number().int().nonnegative(),
  allowedWriteToolCount: z.number().int().nonnegative(),
  responseNotes: z.array(nonEmptyStringSchema).default([])
});

export const validationIssueSummarySchema = z.object({
  path: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  code: nonEmptyStringSchema
});

export const validationInspectionPayloadSchema = z.object({
  accepted: z.boolean(),
  canPreview: z.boolean(),
  issueCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  headline: nonEmptyStringSchema,
  primaryReason: nonEmptyStringSchema,
  issues: z.array(validationIssueSummarySchema).default([]),
  repairPromptAvailable: z.boolean(),
  relatedPreviewArtifactId: entityIdSchema.optional()
});

export const approvalInspectionPayloadSchema = z.object({
  decision: z.enum(["approved", "rejected"]).optional(),
  readyForExecution: z.boolean(),
  requiresApproval: z.boolean(),
  approvedAt: isoDateTimeSchema.optional(),
  note: z.string().trim().min(1).optional(),
  previewArtifactId: entityIdSchema.optional(),
  originalFileGuardrail: nonEmptyStringSchema,
  saveCopyGuardrail: nonEmptyStringSchema,
  temporaryModeNote: z.string().trim().min(1).optional()
});

export const executionInspectionPayloadSchema = z.object({
  state: executionInspectionStateSchema,
  outputPath: z.string().trim().min(1).optional(),
  executedAt: isoDateTimeSchema.optional(),
  warningCount: z.number().int().nonnegative(),
  reasonSummary: nonEmptyStringSchema,
  warnings: z.array(nonEmptyStringSchema).default([]),
  outputArtifactId: entityIdSchema.optional()
});

function buildTurnInspectionSectionSchema<TPayload extends z.ZodTypeAny>(
  payloadSchema: TPayload
) {
  return z
    .object({
      available: z.boolean(),
      summary: nonEmptyStringSchema,
      sourceType: turnInspectionSourceTypeSchema.optional(),
      updatedAt: isoDateTimeSchema.optional(),
      artifactId: entityIdSchema.optional(),
      unavailableReason: turnInspectionUnavailableReasonSchema.optional(),
      payload: payloadSchema.optional()
    })
    .superRefine((value, ctx) => {
      if (value.available && !value.payload) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload"],
          message: "payload is required when the inspection section is available"
        });
      }

      if (!value.available && value.payload) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload"],
          message: "payload must be omitted when the inspection section is unavailable"
        });
      }
    });
}

export const packetInspectionSectionSchema = buildTurnInspectionSectionSchema(
  packetInspectionPayloadSchema
);
export const validationInspectionSectionSchema = buildTurnInspectionSectionSchema(
  validationInspectionPayloadSchema
);
export const approvalInspectionSectionSchema = buildTurnInspectionSectionSchema(
  approvalInspectionPayloadSchema
);
export const executionInspectionSectionSchema = buildTurnInspectionSectionSchema(
  executionInspectionPayloadSchema
);

export const turnDetailsViewModelSchema = z.object({
  overview: turnOverviewSchema,
  packet: packetInspectionSectionSchema,
  validation: validationInspectionSectionSchema,
  approval: approvalInspectionSectionSchema,
  execution: executionInspectionSectionSchema
});

const turnArtifactBaseSchema = z.object({
  artifactId: z.string().trim().min(1),
  createdAt: z.string().trim().min(1)
});

export const turnArtifactSchema = z.discriminatedUnion("artifactType", [
  turnArtifactBaseSchema.extend({
    artifactType: z.literal("workbook-profile"),
    payload: workbookProfileSchema
  }),
  turnArtifactBaseSchema.extend({
    artifactType: z.literal("sheet-preview"),
    payload: sheetPreviewSchema
  }),
  turnArtifactBaseSchema.extend({
    artifactType: z.literal("column-profile"),
    payload: sheetColumnProfileSchema
  }),
  turnArtifactBaseSchema.extend({
    artifactType: z.literal("diff-summary"),
    payload: diffSummarySchema
  }),
  turnArtifactBaseSchema.extend({
    artifactType: z.literal("preview"),
    payload: previewArtifactPayloadSchema
  })
]);

export const readTurnArtifactsResponseSchema = z.object({
  turn: turnSchema,
  storageMode: storageModeSchema,
  artifacts: z.array(turnArtifactSchema).default([]),
  turnDetails: turnDetailsViewModelSchema
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

export const copilotBrowserErrorCodeSchema = z.enum([
  "CDP_UNAVAILABLE",
  "NOT_LOGGED_IN",
  "RESPONSE_TIMEOUT",
  "COPILOT_ERROR",
  "SEND_FAILED"
]);

export const copilotBrowserResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), response: z.string() }),
  z.object({
    status: z.literal("error"),
    errorCode: copilotBrowserErrorCodeSchema,
    message: z.string()
  })
]);

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
export type InspectWorkbookRequest = z.infer<typeof inspectWorkbookRequestSchema>;
export type WorkbookPreflightCheck = z.infer<typeof workbookPreflightCheckSchema>;
export type PreflightWorkbookResponse = z.infer<
  typeof preflightWorkbookResponseSchema
>;
export type InspectWorkbookResponse = z.infer<typeof inspectWorkbookResponseSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type ReadSessionRequest = z.infer<typeof readSessionRequestSchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type ReadTurnArtifactsRequest = z.infer<typeof readTurnArtifactsRequestSchema>;
export type PreviewArtifactPayload = z.infer<typeof previewArtifactPayloadSchema>;
export type TurnInspectionSourceType = z.infer<typeof turnInspectionSourceTypeSchema>;
export type TurnInspectionUnavailableReason = z.infer<
  typeof turnInspectionUnavailableReasonSchema
>;
export type TurnOverviewStepState = z.infer<typeof turnOverviewStepStateSchema>;
export type ExecutionInspectionState = z.infer<typeof executionInspectionStateSchema>;
export type TurnOverviewStep = z.infer<typeof turnOverviewStepSchema>;
export type TurnOverview = z.infer<typeof turnOverviewSchema>;
export type PacketInspectionPayload = z.infer<typeof packetInspectionPayloadSchema>;
export type ValidationIssueSummary = z.infer<typeof validationIssueSummarySchema>;
export type ValidationInspectionPayload = z.infer<
  typeof validationInspectionPayloadSchema
>;
export type ApprovalInspectionPayload = z.infer<
  typeof approvalInspectionPayloadSchema
>;
export type ExecutionInspectionPayload = z.infer<
  typeof executionInspectionPayloadSchema
>;
export type PacketInspectionSection = z.infer<typeof packetInspectionSectionSchema>;
export type ValidationInspectionSection = z.infer<
  typeof validationInspectionSectionSchema
>;
export type ApprovalInspectionSection = z.infer<
  typeof approvalInspectionSectionSchema
>;
export type ExecutionInspectionSection = z.infer<
  typeof executionInspectionSectionSchema
>;
export type TurnDetailsViewModel = z.infer<typeof turnDetailsViewModelSchema>;
export type TurnArtifact = z.infer<typeof turnArtifactSchema>;
export type ReadTurnArtifactsResponse = z.infer<typeof readTurnArtifactsResponseSchema>;
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
export type CopilotBrowserErrorCode = z.infer<typeof copilotBrowserErrorCodeSchema>;
export type CopilotBrowserResult = z.infer<typeof copilotBrowserResultSchema>;
