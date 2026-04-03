import { z } from "zod";

import { approvalPolicyEnum, operationRiskEnum } from "./approval";
import { sessionSchema, turnSchema, turnStatusSchema } from "./core";
import {
  documentReadTextActionSchema,
  fileListActionSchema,
  fileCopyActionSchema,
  fileDeleteActionSchema,
  fileMoveActionSchema,
  fileReadTextActionSchema,
  fileStatActionSchema,
  textReplaceActionSchema,
  textSearchActionSchema
} from "./file";
import {
  projectMemoryEntrySchema,
  projectMemorySourceSchema,
  projectSchema
} from "./project";
import {
  copilotTurnResponseSchema,
  executionPlanSchema,
  outputArtifactSchema,
  outputSpecSchema,
  mcpTransportSchema,
  planStepSchema,
  qualityCheckResultSchema,
  relayPacketSchema,
  toolRegistrationSchema,
  toolSourceSchema,
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
export const planningContextToolGroupsSchema = z.object({
  read: z.array(z.string().trim().min(1)).default([]),
  write: z.array(z.string().trim().min(1)).default([])
});
export const planningContextSchema = z.object({
  workbookSummary: z.string().trim().min(1),
  availableTools: planningContextToolGroupsSchema,
  suggestedApproach: z.array(z.string().trim().min(1)).default([])
});
export const assessCopilotHandoffResponseSchema = z.object({
  status: copilotHandoffStatusSchema,
  headline: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  reasons: z.array(copilotHandoffReasonSchema).default([]),
  suggestedActions: z.array(z.string().trim().min(1)).default([]),
  planningContext: planningContextSchema.optional()
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
  repairPrompt: z.string().optional(),
  autoLearnedMemory: z.array(projectMemoryEntrySchema).default([])
});

export const previewExecutionRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1)
});

export const toolExecutionResultSchema = z.object({
  tool: z.string().trim().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().trim().min(1).optional()
});

export const executeReadActionsRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  turnId: z.string().trim().min(1),
  loopTurn: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  actions: z
    .array(
      z.union([
        fileListActionSchema,
        fileReadTextActionSchema,
        fileStatActionSchema,
        textSearchActionSchema,
        documentReadTextActionSchema,
        z.object({
          tool: z.literal("workbook.inspect"),
          args: z.object({
            sourcePath: z.string().trim().min(1).optional()
          })
        }),
        z.object({
          tool: z.literal("sheet.preview"),
          args: z.object({
            sheet: z.string().trim().min(1),
            limit: z.number().int().positive().max(200).default(25)
          })
        }),
        z.object({
          tool: z.literal("sheet.profile_columns"),
          args: z.object({
            sheet: z.string().trim().min(1),
            sampleSize: z.number().int().positive().max(5000).default(250)
          })
        }),
        z.object({
          tool: z.literal("session.diff_from_base"),
          args: z.object({
            artifactId: z.string().trim().min(1).optional()
          })
        }),
        z.object({
          tool: z.enum([
            "table.rename_columns",
            "table.cast_columns",
            "table.filter_rows",
            "table.derive_column",
            "table.group_aggregate",
            "workbook.save_copy",
            "file.copy",
            "file.move",
            "file.delete",
            "text.replace"
          ]),
          sheet: z.string().trim().min(1).optional(),
          args: z.record(z.string(), z.unknown()).default({})
        })
      ])
    )
    .default([])
});

export const executeReadActionsResponseSchema = z.object({
  shouldContinue: z.boolean(),
  toolResults: z.array(toolExecutionResultSchema).default([]),
  hasWriteActions: z.boolean().default(false),
  guardMessage: z.string().trim().min(1).optional()
});

export const planStepStatusSchema = z.object({
  stepId: z.string().trim().min(1),
  state: z.enum(["pending", "running", "completed", "skipped", "failed"]),
  result: z.unknown().optional(),
  error: z.string().trim().min(1).optional()
});

export const approvePlanRequestSchema = z.object({
  sessionId: entityIdSchema,
  turnId: entityIdSchema,
  approvedStepIds: z.array(z.string().trim().min(1)).default([]),
  modifiedSteps: z.array(planStepSchema).default([])
});

export const approvePlanResponseSchema = z.object({
  approved: z.boolean(),
  plan: executionPlanSchema
});

export const planProgressRequestSchema = z.object({
  sessionId: entityIdSchema,
  turnId: entityIdSchema
});

export const planProgressResponseSchema = z.object({
  currentStepId: z.string().trim().min(1).nullable(),
  completedCount: z.number().int().min(0),
  totalCount: z.number().int().min(0),
  stepStatuses: z.array(planStepStatusSchema).default([])
});
export const recordPlanProgressRequestSchema = z.object({
  sessionId: entityIdSchema,
  turnId: entityIdSchema,
  currentStepId: z.string().trim().min(1).nullable(),
  completedCount: z.number().int().min(0),
  totalCount: z.number().int().min(0),
  stepStatuses: z.array(planStepStatusSchema).default([])
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

export const runExecutionMultiRequestSchema = z.object({
  sessionId: entityIdSchema,
  turnId: entityIdSchema,
  outputSpecs: z.array(outputSpecSchema).min(1)
});

export const runExecutionMultiResponseSchema = z.array(runExecutionResponseSchema);

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
export type PlanningContextToolGroups = z.infer<
  typeof planningContextToolGroupsSchema
>;
export type PlanningContext = z.infer<typeof planningContextSchema>;
export type AssessCopilotHandoffResponse = z.infer<
  typeof assessCopilotHandoffResponseSchema
>;
export type SubmitCopilotResponseRequest = z.infer<
  typeof submitCopilotResponseRequestSchema
>;
export type SubmitCopilotResponseResponse = z.infer<
  typeof submitCopilotResponseResponseSchema
>;
export type ToolExecutionResult = z.infer<typeof toolExecutionResultSchema>;
export type ExecuteReadActionsRequest = z.infer<
  typeof executeReadActionsRequestSchema
>;
export type ExecuteReadActionsResponse = z.infer<
  typeof executeReadActionsResponseSchema
>;
export type PlanStepStatus = z.infer<typeof planStepStatusSchema>;
export type ApprovePlanRequest = z.infer<typeof approvePlanRequestSchema>;
export type ApprovePlanResponse = z.infer<typeof approvePlanResponseSchema>;
export type PlanProgressRequest = z.infer<typeof planProgressRequestSchema>;
export type PlanProgressResponse = z.infer<typeof planProgressResponseSchema>;
export type RecordPlanProgressRequest = z.infer<
  typeof recordPlanProgressRequestSchema
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
export type RunExecutionMultiRequest = z.infer<typeof runExecutionMultiRequestSchema>;
export type RunExecutionMultiResponse = z.infer<typeof runExecutionMultiResponseSchema>;
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
