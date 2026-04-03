import { z } from "zod";

import { approvalPolicyEnum, operationRiskEnum } from "./approval";
import { sessionSchema, turnSchema, turnStatusSchema } from "./core";
import {
  fileCopyActionSchema,
  fileDeleteActionSchema,
  fileMoveActionSchema,
  textReplaceActionSchema,
} from "./file";
import {
  projectMemoryEntrySchema,
  projectMemorySourceSchema,
  projectSchema
} from "./project";
import {
  agentTurnResponseSchema,
  executionPlanSchema,
  outputArtifactSchema,
  mcpTransportSchema,
  planStepSchema,
  qualityCheckResultSchema,
  toolRegistrationSchema,
  toolSourceSchema
} from "./relay";
import {
  entityIdSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  relayModeSchema
} from "./shared";
import {
  diffSummarySchema
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

export const createSessionRequestSchema = z.object({
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  primaryWorkbookPath: z.string().trim().min(1).optional()
});

export const addInboxFileRequestSchema = z.object({
  sessionId: entityIdSchema,
  path: nonEmptyStringSchema
});

export const removeInboxFileRequestSchema = z.object({
  sessionId: entityIdSchema,
  path: nonEmptyStringSchema
});

export const createProjectRequestSchema = z.object({
  name: nonEmptyStringSchema,
  rootFolder: nonEmptyStringSchema,
  customInstructions: z.string().default("")
});

export const readProjectRequestSchema = z.object({
  projectId: entityIdSchema
});

export const updateProjectRequestSchema = z.object({
  projectId: entityIdSchema,
  name: nonEmptyStringSchema.optional(),
  customInstructions: z.string().optional()
});

export const addProjectMemoryRequestSchema = z.object({
  projectId: entityIdSchema,
  key: nonEmptyStringSchema,
  value: z.string(),
  source: projectMemorySourceSchema.default("user")
});

export const removeProjectMemoryRequestSchema = z.object({
  projectId: entityIdSchema,
  key: nonEmptyStringSchema
});

export const linkSessionToProjectRequestSchema = z.object({
  projectId: entityIdSchema,
  sessionId: entityIdSchema
});

export const setSessionProjectRequestSchema = z.object({
  sessionId: entityIdSchema,
  projectId: entityIdSchema.nullable().optional()
});

export const listProjectsResponseSchema = z.object({
  projects: z.array(projectSchema).default([])
});

export const mcpServerConfigSchema = z.object({
  url: z.string().trim().min(1),
  name: nonEmptyStringSchema,
  transport: mcpTransportSchema.default("sse")
});

export const browserAutomationSettingsSchema = z.object({
  cdpPort: z.number().int().positive(),
  autoLaunchEdge: z.boolean(),
  timeoutMs: z.number().int().positive()
});

export const listToolsResponseSchema = z.object({
  tools: z.array(toolRegistrationSchema).default([]),
  restoreWarnings: z.array(z.string().trim().min(1)).default([])
});

export const setToolEnabledRequestSchema = z.object({
  toolId: z.string().trim().min(1),
  enabled: z.boolean()
});

export const connectMcpServerRequestSchema = mcpServerConfigSchema;

export const connectMcpServerResponseSchema = z.object({
  registeredToolIds: z.array(z.string().trim().min(1)).default([]),
  tools: z.array(toolRegistrationSchema).default([])
});

export const invokeMcpToolRequestSchema = z.object({
  toolId: z.string().trim().min(1),
  args: z.record(z.string(), z.unknown()).default({})
});

export const invokeMcpToolResponseSchema = z.object({
  toolId: z.string().trim().min(1),
  result: z.unknown(),
  source: toolSourceSchema.default("mcp")
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
  autoApproved: z.boolean().default(false),
  highestRisk: operationRiskEnum.default("medium"),
  approvalPolicy: approvalPolicyEnum.default("safe"),
  warnings: z.array(z.string()).default([]),
  artifacts: z.array(outputArtifactSchema).default([]),
  fileWriteActions: z
    .array(
      z.union([
        fileCopyActionSchema,
        fileMoveActionSchema,
        fileDeleteActionSchema,
        textReplaceActionSchema
      ])
    )
    .default([])
});

export const executionArtifactPayloadSchema = z.object({
  executed: z.boolean(),
  outputPath: z.string().trim().min(1).optional(),
  outputPaths: z.array(z.string().trim().min(1)).default([]),
  artifacts: z.array(outputArtifactSchema).default([]),
  warnings: z.array(z.string()).default([]),
  reason: z.string().trim().min(1).optional()
});

export const scopeApprovalArtifactPayloadSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  rootFolder: nonEmptyStringSchema,
  violations: z.array(nonEmptyStringSchema).default([]),
  source: z.enum(["manual", "agent-loop"]),
  note: z.string().trim().min(1).optional(),
  responseArtifactId: entityIdSchema.optional()
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
  id: z.enum(["validation", "preview", "approval", "execution"]),
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
  autoApproved: z.boolean().default(false),
  highestRisk: operationRiskEnum.default("medium"),
  approvalPolicy: approvalPolicyEnum.default("safe"),
  approvedAt: isoDateTimeSchema.optional(),
  note: z.string().trim().min(1).optional(),
  previewArtifactId: entityIdSchema.optional(),
  scopeOverride: z
    .object({
      decision: z.enum(["approved", "rejected"]),
      decidedAt: isoDateTimeSchema,
      rootFolder: nonEmptyStringSchema,
      violations: z.array(nonEmptyStringSchema).default([]),
      source: z.enum(["manual", "agent-loop"]),
      note: z.string().trim().min(1).optional(),
      responseArtifactId: entityIdSchema.optional(),
      artifactId: entityIdSchema.optional()
    })
    .optional(),
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
    artifactType: z.literal("diff-summary"),
    payload: diffSummarySchema
  }),
  turnArtifactBaseSchema.extend({
    artifactType: z.literal("preview"),
    payload: previewArtifactPayloadSchema
  }),
  turnArtifactBaseSchema.extend({
    artifactType: z.literal("execution"),
    payload: executionArtifactPayloadSchema
  }),
  turnArtifactBaseSchema.extend({
    artifactType: z.literal("scope-approval"),
    payload: scopeApprovalArtifactPayloadSchema
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

export const recordStructuredResponseRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1),
  rawResponse: z.string().trim().min(1).optional(),
  parsedResponse: agentTurnResponseSchema
});

export const recordStructuredResponseResponseSchema = z.object({
  turn: turnSchema,
  parsedResponse: agentTurnResponseSchema,
  autoLearnedMemory: z.array(projectMemoryEntrySchema).default([])
});

export const previewExecutionRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1)
});

export const previewExecutionResponseSchema = z.object({
  turn: turnSchema,
  ready: z.boolean(),
  requiresApproval: z.boolean(),
  autoApproved: z.boolean().default(false),
  highestRisk: operationRiskEnum.default("medium"),
  approvalPolicy: approvalPolicyEnum.default("safe"),
  canExecute: z.boolean(),
  diffSummary: diffSummarySchema,
  artifacts: z.array(outputArtifactSchema).default([]),
  warnings: z.array(z.string()).default([]),
  fileWriteActions: z
    .array(
      z.union([
        fileCopyActionSchema,
        fileMoveActionSchema,
        fileDeleteActionSchema,
        textReplaceActionSchema
      ])
    )
    .default([])
});

export const approvalDecisionSchema = z.enum(["approved", "rejected"]);
export const scopeApprovalSourceSchema = z.enum(["manual", "agent-loop"]);

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

export const recordScopeApprovalRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1),
  decision: approvalDecisionSchema,
  rootFolder: nonEmptyStringSchema,
  violations: z.array(nonEmptyStringSchema).min(1),
  source: scopeApprovalSourceSchema,
  note: z.string().trim().min(1).optional()
});

export const recordScopeApprovalResponseSchema = z.object({
  turn: turnSchema,
  decision: approvalDecisionSchema,
  recordedAt: isoDateTimeSchema
});

export const runExecutionRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1)
});

export const runExecutionResponseSchema = z.object({
  turn: turnSchema,
  executed: z.boolean(),
  outputPath: z.string().min(1).optional(),
  outputPaths: z.array(z.string().min(1)).default([]),
  artifacts: z.array(outputArtifactSchema).default([]),
  warnings: z.array(z.string()).default([]),
  reason: z.string().min(1).optional()
});

export const validateOutputQualityRequestSchema = z.object({
  sourcePath: nonEmptyStringSchema,
  outputPath: nonEmptyStringSchema
});

export const validateOutputQualityResponseSchema = qualityCheckResultSchema;

export const copilotBrowserProgressEventSchema = z.object({
  requestId: z.string().trim().min(1),
  step: z.string().trim().min(1),
  detail: z.string().trim().min(1).optional()
});

export const sendCopilotPromptRequestSchema = z.object({
  prompt: z.string().trim().min(1),
  settings: browserAutomationSettingsSchema,
  progressEventId: z.string().trim().min(1).optional()
});

export const checkCopilotConnectionRequestSchema = z.object({
  settings: browserAutomationSettingsSchema,
  progressEventId: z.string().trim().min(1).optional()
});

export const copilotBrowserErrorCodeSchema = z.enum([
  "CDP_UNAVAILABLE",
  "NOT_LOGGED_IN",
  "RESPONSE_TIMEOUT",
  "COPILOT_ERROR",
  "SEND_FAILED"
]);

export const copilotBrowserConnectResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    cdpPort: z.number().int().positive()
  }),
  z.object({
    status: z.literal("error"),
    errorCode: copilotBrowserErrorCodeSchema,
    message: z.string(),
    cdpPort: z.number().int().positive().optional()
  })
]);

export const copilotBrowserResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    response: z.string(),
    cdpPort: z.number().int().positive().optional()
  }),
  z.object({
    status: z.literal("error"),
    errorCode: copilotBrowserErrorCodeSchema,
    message: z.string(),
    cdpPort: z.number().int().positive().optional()
  })
]);

export type StorageMode = z.infer<typeof storageModeSchema>;
export type StartupStatus = z.infer<typeof startupStatusSchema>;
export type StartupRecoveryAction = z.infer<typeof startupRecoveryActionSchema>;
export type StartupIssue = z.infer<typeof startupIssueSchema>;
export type InitializeAppResponse = z.infer<typeof initializeAppResponseSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type AddInboxFileRequest = z.infer<typeof addInboxFileRequestSchema>;
export type RemoveInboxFileRequest = z.infer<typeof removeInboxFileRequestSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type ReadProjectRequest = z.infer<typeof readProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type AddProjectMemoryRequest = z.infer<typeof addProjectMemoryRequestSchema>;
export type RemoveProjectMemoryRequest = z.infer<
  typeof removeProjectMemoryRequestSchema
>;
export type LinkSessionToProjectRequest = z.infer<
  typeof linkSessionToProjectRequestSchema
>;
export type SetSessionProjectRequest = z.infer<
  typeof setSessionProjectRequestSchema
>;
export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>;
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
export type ListToolsResponse = z.infer<typeof listToolsResponseSchema>;
export type SetToolEnabledRequest = z.infer<typeof setToolEnabledRequestSchema>;
export type ConnectMcpServerRequest = z.infer<typeof connectMcpServerRequestSchema>;
export type ConnectMcpServerResponse = z.infer<typeof connectMcpServerResponseSchema>;
export type InvokeMcpToolRequest = z.infer<typeof invokeMcpToolRequestSchema>;
export type InvokeMcpToolResponse = z.infer<typeof invokeMcpToolResponseSchema>;
export type ReadSessionRequest = z.infer<typeof readSessionRequestSchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type ReadTurnArtifactsRequest = z.infer<typeof readTurnArtifactsRequestSchema>;
export type PreviewArtifactPayload = z.infer<typeof previewArtifactPayloadSchema>;
export type ExecutionArtifactPayload = z.infer<typeof executionArtifactPayloadSchema>;
export type TurnInspectionSourceType = z.infer<typeof turnInspectionSourceTypeSchema>;
export type TurnInspectionUnavailableReason = z.infer<
  typeof turnInspectionUnavailableReasonSchema
>;
export type TurnOverviewStepState = z.infer<typeof turnOverviewStepStateSchema>;
export type ExecutionInspectionState = z.infer<typeof executionInspectionStateSchema>;
export type TurnOverviewStep = z.infer<typeof turnOverviewStepSchema>;
export type TurnOverview = z.infer<typeof turnOverviewSchema>;
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
export type RecordStructuredResponseRequest = z.infer<
  typeof recordStructuredResponseRequestSchema
>;
export type RecordStructuredResponseResponse = z.infer<
  typeof recordStructuredResponseResponseSchema
>;
export type PreviewExecutionRequest = z.infer<typeof previewExecutionRequestSchema>;
export type PreviewExecutionResponse = z.infer<typeof previewExecutionResponseSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type ScopeApprovalSource = z.infer<typeof scopeApprovalSourceSchema>;
export type RespondToApprovalRequest = z.infer<typeof respondToApprovalRequestSchema>;
export type RespondToApprovalResponse = z.infer<
  typeof respondToApprovalResponseSchema
>;
export type RecordScopeApprovalRequest = z.infer<
  typeof recordScopeApprovalRequestSchema
>;
export type RecordScopeApprovalResponse = z.infer<
  typeof recordScopeApprovalResponseSchema
>;
export type RunExecutionRequest = z.infer<typeof runExecutionRequestSchema>;
export type RunExecutionResponse = z.infer<typeof runExecutionResponseSchema>;
export type ValidateOutputQualityRequest = z.infer<
  typeof validateOutputQualityRequestSchema
>;
export type ValidateOutputQualityResponse = z.infer<
  typeof validateOutputQualityResponseSchema
>;
export type BrowserAutomationSettings = z.infer<
  typeof browserAutomationSettingsSchema
>;
export type CopilotBrowserProgressEvent = z.infer<
  typeof copilotBrowserProgressEventSchema
>;
export type SendCopilotPromptRequest = z.infer<
  typeof sendCopilotPromptRequestSchema
>;
export type CheckCopilotConnectionRequest = z.infer<
  typeof checkCopilotConnectionRequestSchema
>;
export type CopilotBrowserErrorCode = z.infer<typeof copilotBrowserErrorCodeSchema>;
export type CopilotBrowserConnectResult = z.infer<
  typeof copilotBrowserConnectResultSchema
>;
export type CopilotBrowserResult = z.infer<typeof copilotBrowserResultSchema>;
