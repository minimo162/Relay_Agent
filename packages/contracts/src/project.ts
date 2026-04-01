import { z } from "zod";

import {
  entityIdSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema
} from "./shared";

export const projectMemorySourceSchema = z.enum(["user", "auto"]);

export const projectMemoryEntrySchema = z.object({
  key: nonEmptyStringSchema,
  value: z.string(),
  learnedAt: isoDateTimeSchema,
  source: projectMemorySourceSchema.default("user")
});

export const projectSchema = z.object({
  id: entityIdSchema,
  name: nonEmptyStringSchema,
  rootFolder: nonEmptyStringSchema,
  customInstructions: z.string().default(""),
  memory: z.array(projectMemoryEntrySchema).default([]),
  sessionIds: z.array(entityIdSchema).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
});

export type ProjectMemorySource = z.infer<typeof projectMemorySourceSchema>;
export type ProjectMemoryEntry = z.infer<typeof projectMemoryEntrySchema>;
export type Project = z.infer<typeof projectSchema>;
