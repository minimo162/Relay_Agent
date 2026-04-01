import { z } from "zod";

import {
  entityIdSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema
} from "./shared";

export const workflowTemplateCategoryEnum = z.enum([
  "sales",
  "accounting",
  "hr",
  "general",
  "custom"
]);

export const workflowTemplateSchema = z.object({
  id: entityIdSchema,
  title: nonEmptyStringSchema,
  category: workflowTemplateCategoryEnum,
  description: z.string().trim().min(1).default(""),
  goal: nonEmptyStringSchema,
  expectedTools: z.array(nonEmptyStringSchema).default([]),
  exampleInputFile: z.string().trim().min(1).optional(),
  tags: z.array(nonEmptyStringSchema).default([]),
  isBuiltIn: z.boolean(),
  createdAt: isoDateTimeSchema
});

export const templateListRequestSchema = z.object({
  category: workflowTemplateCategoryEnum.optional()
});

export const templateGetRequestSchema = z.object({
  id: entityIdSchema
});

export const templateCreateRequestSchema = z.object({
  title: nonEmptyStringSchema,
  category: workflowTemplateCategoryEnum,
  description: z.string().default(""),
  goal: nonEmptyStringSchema,
  expectedTools: z.array(nonEmptyStringSchema).default([]),
  tags: z.array(nonEmptyStringSchema).default([])
});

export const templateDeleteRequestSchema = z.object({
  id: entityIdSchema
});

export const templateFromSessionRequestSchema = z.object({
  sessionId: entityIdSchema,
  title: nonEmptyStringSchema.optional(),
  category: workflowTemplateCategoryEnum.default("custom"),
  description: z.string().default("")
});

export type WorkflowTemplateCategory = z.infer<typeof workflowTemplateCategoryEnum>;
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;
export type TemplateListRequest = z.infer<typeof templateListRequestSchema>;
export type TemplateGetRequest = z.infer<typeof templateGetRequestSchema>;
export type TemplateCreateRequest = z.infer<typeof templateCreateRequestSchema>;
export type TemplateDeleteRequest = z.infer<typeof templateDeleteRequestSchema>;
export type TemplateFromSessionRequest = z.infer<typeof templateFromSessionRequestSchema>;
