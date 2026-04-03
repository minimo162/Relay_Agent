import { z } from "zod";

import { fileActionSchema } from "./file";
import { entityIdSchema, nonEmptyStringSchema } from "./shared";
import { diffSummarySchema } from "./workbook";

export const toolPhaseSchema = z.enum(["read", "write"]);
export const mcpTransportSchema = z.enum(["sse", "stdio"]);

export const toolDescriptorSchema = z.object({
  id: entityIdSchema,
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  phase: toolPhaseSchema,
  requiresApproval: z.boolean().default(false)
});

export const toolSourceSchema = z.enum(["builtin", "mcp"]);
export const artifactTypeSchema = z.enum([
  "spreadsheet_diff",
  "file_operation",
  "text_diff",
  "text_extraction",
  "csv_table",
  "raw_text"
]);

export const toolRegistrationSchema = z.object({
  id: z.string().trim().min(1),
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  phase: toolPhaseSchema,
  requiresApproval: z.boolean().default(false),
  source: toolSourceSchema.default("builtin"),
  enabled: z.boolean().default(true),
  parameterSchema: z.record(z.string(), z.unknown()).optional(),
  mcpServerUrl: z.string().trim().min(1).optional(),
  mcpTransport: mcpTransportSchema.optional()
});

export const validationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: nonEmptyStringSchema,
  code: nonEmptyStringSchema
});

export const agentLoopStatusSchema = z.enum([
  "thinking",
  "ready_to_write",
  "done",
  "error",
  "plan_proposed"
]);

export const planStepSchema = z.object({
  id: z.string().trim().min(1),
  description: nonEmptyStringSchema,
  tool: z.string().trim().min(1),
  phase: toolPhaseSchema,
  args: z.record(z.string(), z.unknown()).optional(),
  estimatedEffect: z.string().default("")
});

export const executionPlanSchema = z.object({
  steps: z.array(planStepSchema).min(1),
  summary: nonEmptyStringSchema,
  totalEstimatedSteps: z.number().int().positive()
});

export const relayActionSchema = fileActionSchema;

export const outputArtifactSchema = z.object({
  id: entityIdSchema,
  type: artifactTypeSchema,
  label: nonEmptyStringSchema,
  sourcePath: z.string().default(""),
  outputPath: z.string().default(""),
  warnings: z.array(z.string()).default([]),
  content: z.record(z.string(), z.unknown())
});

export const spreadsheetDiffArtifactSchema = outputArtifactSchema.extend({
  type: z.literal("spreadsheet_diff"),
  content: z.object({
    type: z.literal("spreadsheet_diff"),
    diffSummary: diffSummarySchema
  })
});

export const qualityCheckSchema = z.object({
  name: nonEmptyStringSchema,
  passed: z.boolean(),
  detail: z.string()
});

export const qualityCheckResultSchema = z.object({
  passed: z.boolean(),
  checks: z.array(qualityCheckSchema).default([]),
  warnings: z.array(z.string()).default([])
});

export const agentTurnResponseSchema = z.object({
  version: z.literal("1.0").default("1.0"),
  status: agentLoopStatusSchema.default("ready_to_write"),
  summary: nonEmptyStringSchema,
  actions: z.array(relayActionSchema).default([]),
  executionPlan: executionPlanSchema.optional(),
  message: z.string().optional(),
  followupQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});

export const agentEventNameSchema = z.enum([
  "agent:tool_start",
  "agent:tool_result",
  "agent:approval_needed",
  "agent:turn_complete",
  "agent:error"
]);

export const agentToolStartEventPayloadSchema = z.object({
  sessionId: entityIdSchema,
  toolUseId: z.string().trim().min(1),
  toolName: z.string().trim().min(1)
});

export const agentToolResultEventPayloadSchema = z.object({
  sessionId: entityIdSchema,
  toolUseId: z.string().trim().min(1),
  toolName: z.string().trim().min(1),
  content: z.string(),
  isError: z.boolean()
});

export const agentApprovalNeededEventPayloadSchema = z.object({
  sessionId: entityIdSchema,
  approvalId: z.string().trim().min(1),
  toolName: z.string().trim().min(1),
  description: nonEmptyStringSchema,
  target: z.string().trim().min(1).optional(),
  input: z.unknown()
});

export const agentTurnCompleteEventPayloadSchema = z.object({
  sessionId: entityIdSchema,
  stopReason: nonEmptyStringSchema,
  assistantMessage: z.string(),
  messageCount: z.number().int().nonnegative()
});

export const agentErrorEventPayloadSchema = z.object({
  sessionId: entityIdSchema,
  error: nonEmptyStringSchema,
  cancelled: z.boolean()
});

export const agentEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("agent:tool_start"),
    payload: agentToolStartEventPayloadSchema
  }),
  z.object({
    event: z.literal("agent:tool_result"),
    payload: agentToolResultEventPayloadSchema
  }),
  z.object({
    event: z.literal("agent:approval_needed"),
    payload: agentApprovalNeededEventPayloadSchema
  }),
  z.object({
    event: z.literal("agent:turn_complete"),
    payload: agentTurnCompleteEventPayloadSchema
  }),
  z.object({
    event: z.literal("agent:error"),
    payload: agentErrorEventPayloadSchema
  })
]);

export type ToolPhase = z.infer<typeof toolPhaseSchema>;
export type McpTransport = z.infer<typeof mcpTransportSchema>;
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;
export type ToolSource = z.infer<typeof toolSourceSchema>;
export type ArtifactType = z.infer<typeof artifactTypeSchema>;
export type ToolRegistration = z.infer<typeof toolRegistrationSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type AgentLoopStatus = z.infer<typeof agentLoopStatusSchema>;
export type PlanStep = z.infer<typeof planStepSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
export type RelayAction = z.infer<typeof relayActionSchema>;
export type OutputArtifact = z.infer<typeof outputArtifactSchema>;
export type SpreadsheetDiffArtifact = z.infer<typeof spreadsheetDiffArtifactSchema>;
export type QualityCheck = z.infer<typeof qualityCheckSchema>;
export type QualityCheckResult = z.infer<typeof qualityCheckResultSchema>;
export type AgentTurnResponse = z.infer<typeof agentTurnResponseSchema>;
export type AgentEventName = z.infer<typeof agentEventNameSchema>;
export type AgentToolStartEventPayload = z.infer<
  typeof agentToolStartEventPayloadSchema
>;
export type AgentToolResultEventPayload = z.infer<
  typeof agentToolResultEventPayloadSchema
>;
export type AgentApprovalNeededEventPayload = z.infer<
  typeof agentApprovalNeededEventPayloadSchema
>;
export type AgentTurnCompleteEventPayload = z.infer<
  typeof agentTurnCompleteEventPayloadSchema
>;
export type AgentErrorEventPayload = z.infer<
  typeof agentErrorEventPayloadSchema
>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
