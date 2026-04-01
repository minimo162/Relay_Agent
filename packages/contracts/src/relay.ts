import { z } from "zod";

import { fileActionSchema } from "./file";
import { entityIdSchema, nonEmptyStringSchema, relayModeSchema } from "./shared";
import { spreadsheetActionSchema } from "./workbook";

export const toolPhaseSchema = z.enum(["read", "write"]);

export const toolDescriptorSchema = z.object({
  id: entityIdSchema,
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  phase: toolPhaseSchema,
  requiresApproval: z.boolean().default(false)
});

export const relayPacketSchema = z.object({
  version: z.literal("1.0").default("1.0"),
  sessionId: entityIdSchema,
  turnId: entityIdSchema,
  mode: relayModeSchema,
  objective: nonEmptyStringSchema,
  context: z.array(nonEmptyStringSchema).default([]),
  allowedReadTools: z.array(toolDescriptorSchema).default([]),
  allowedWriteTools: z.array(toolDescriptorSchema).default([]),
  responseContract: z.object({
    format: z.literal("json"),
    expectsActions: z.boolean().default(true),
    notes: z.array(z.string()).default([])
  })
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

export const relayActionSchema = z.union([
  spreadsheetActionSchema,
  fileActionSchema
]);

export const copilotTurnResponseSchema = z.object({
  version: z.literal("1.0").default("1.0"),
  status: agentLoopStatusSchema.default("ready_to_write"),
  summary: nonEmptyStringSchema,
  actions: z.array(relayActionSchema).default([]),
  executionPlan: executionPlanSchema.optional(),
  message: z.string().optional(),
  followupQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});

export type ToolPhase = z.infer<typeof toolPhaseSchema>;
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;
export type RelayPacket = z.infer<typeof relayPacketSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type AgentLoopStatus = z.infer<typeof agentLoopStatusSchema>;
export type PlanStep = z.infer<typeof planStepSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
export type RelayAction = z.infer<typeof relayActionSchema>;
export type CopilotTurnResponse = z.infer<typeof copilotTurnResponseSchema>;
