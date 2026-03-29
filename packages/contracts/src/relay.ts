import { z } from "zod";

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

export const copilotTurnResponseSchema = z.object({
  version: z.literal("1.0").default("1.0"),
  summary: nonEmptyStringSchema,
  actions: z.array(spreadsheetActionSchema).default([]),
  followupQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});

export type ToolPhase = z.infer<typeof toolPhaseSchema>;
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;
export type RelayPacket = z.infer<typeof relayPacketSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type CopilotTurnResponse = z.infer<typeof copilotTurnResponseSchema>;
