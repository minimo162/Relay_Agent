import { z } from "zod";

import {
  entityIdSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema
} from "./shared";

export const pipelineStepStatusEnum = z.enum([
  "pending",
  "running",
  "waiting_approval",
  "done",
  "failed"
]);

export const pipelineInputSourceEnum = z.enum(["user", "prev_step_output"]);
export const pipelineStatusEnum = z.enum(["idle", "running", "done", "failed"]);

export const pipelineStepSchema = z.object({
  id: entityIdSchema,
  order: z.number().int().min(0),
  goal: nonEmptyStringSchema,
  inputSource: pipelineInputSourceEnum,
  outputArtifactKey: z.string().trim().min(1).optional(),
  status: pipelineStepStatusEnum,
  errorMessage: z.string().trim().min(1).optional()
});

export const pipelineSchema = z.object({
  id: entityIdSchema,
  title: nonEmptyStringSchema,
  projectId: entityIdSchema.optional(),
  initialInputPath: z.string().trim().min(1).optional(),
  steps: z.array(pipelineStepSchema).default([]),
  status: pipelineStatusEnum,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
});

export const pipelineStepDraftSchema = z.object({
  goal: nonEmptyStringSchema,
  inputSource: pipelineInputSourceEnum
});

export const pipelineCreateRequestSchema = z.object({
  title: nonEmptyStringSchema,
  projectId: entityIdSchema.optional(),
  initialInputPath: z.string().trim().min(1).optional(),
  steps: z.array(pipelineStepDraftSchema).min(1)
});

export const pipelineStatusRequestSchema = z.object({
  pipelineId: entityIdSchema
});

export const pipelineRunRequestSchema = pipelineStatusRequestSchema;
export const pipelineCancelRequestSchema = pipelineStatusRequestSchema;

export const pipelineStepUpdateEventSchema = z.object({
  pipeline: pipelineSchema,
  stepId: entityIdSchema,
  status: pipelineStepStatusEnum
});

export type PipelineStepStatus = z.infer<typeof pipelineStepStatusEnum>;
export type PipelineInputSource = z.infer<typeof pipelineInputSourceEnum>;
export type PipelineStatus = z.infer<typeof pipelineStatusEnum>;
export type PipelineStep = z.infer<typeof pipelineStepSchema>;
export type Pipeline = z.infer<typeof pipelineSchema>;
export type PipelineStepDraft = z.infer<typeof pipelineStepDraftSchema>;
export type PipelineCreateRequest = z.infer<typeof pipelineCreateRequestSchema>;
export type PipelineStatusRequest = z.infer<typeof pipelineStatusRequestSchema>;
export type PipelineRunRequest = z.infer<typeof pipelineRunRequestSchema>;
export type PipelineCancelRequest = z.infer<typeof pipelineCancelRequestSchema>;
export type PipelineStepUpdateEvent = z.infer<typeof pipelineStepUpdateEventSchema>;
