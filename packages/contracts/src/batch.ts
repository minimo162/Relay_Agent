import { z } from "zod";

import {
  entityIdSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema
} from "./shared";

export const batchTargetStatusEnum = z.enum([
  "pending",
  "running",
  "done",
  "failed",
  "skipped"
]);

export const batchJobStatusEnum = z.enum(["idle", "running", "done", "failed"]);

export const batchTargetSchema = z.object({
  filePath: z.string().trim().min(1),
  status: batchTargetStatusEnum,
  outputPath: z.string().trim().min(1).optional(),
  errorMessage: z.string().trim().min(1).optional(),
  sessionId: entityIdSchema.optional()
});

export const batchJobSchema = z.object({
  id: entityIdSchema,
  workflowGoal: nonEmptyStringSchema,
  projectId: entityIdSchema.optional(),
  targets: z.array(batchTargetSchema).default([]),
  concurrency: z.literal(1).default(1),
  stopOnFirstError: z.boolean().default(false),
  status: batchJobStatusEnum,
  outputDir: z.string().trim().min(1).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
});

export const batchCreateRequestSchema = z.object({
  workflowGoal: nonEmptyStringSchema,
  projectId: entityIdSchema.optional(),
  targetPaths: z.array(z.string().trim().min(1)).min(1),
  stopOnFirstError: z.boolean().default(false)
});

export const batchStatusRequestSchema = z.object({
  batchId: entityIdSchema
});

export const batchRunRequestSchema = batchStatusRequestSchema;

export const batchSkipTargetRequestSchema = z.object({
  batchId: entityIdSchema,
  targetPath: z.string().trim().min(1)
});

export const batchTargetUpdateEventSchema = z.object({
  batchJob: batchJobSchema,
  targetPath: z.string().trim().min(1),
  status: batchTargetStatusEnum
});

export type BatchTargetStatus = z.infer<typeof batchTargetStatusEnum>;
export type BatchJobStatus = z.infer<typeof batchJobStatusEnum>;
export type BatchTarget = z.infer<typeof batchTargetSchema>;
export type BatchJob = z.infer<typeof batchJobSchema>;
export type BatchCreateRequest = z.infer<typeof batchCreateRequestSchema>;
export type BatchStatusRequest = z.infer<typeof batchStatusRequestSchema>;
export type BatchRunRequest = z.infer<typeof batchRunRequestSchema>;
export type BatchSkipTargetRequest = z.infer<typeof batchSkipTargetRequestSchema>;
export type BatchTargetUpdateEvent = z.infer<typeof batchTargetUpdateEventSchema>;
