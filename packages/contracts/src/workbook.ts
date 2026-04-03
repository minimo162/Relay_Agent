import { z } from "zod";

import { nonEmptyStringSchema } from "./shared";
export const previewTargetKindSchema = z.enum(["sheet", "table"]);
export const rowDiffKindSchema = z.enum(["changed", "added", "removed"]);

export const previewTargetSchema = z.object({
  kind: previewTargetKindSchema,
  sheet: nonEmptyStringSchema,
  table: nonEmptyStringSchema.optional(),
  label: nonEmptyStringSchema
});

export const rowDiffSampleSchema = z.object({
  kind: rowDiffKindSchema,
  rowNumber: z.number().int().positive(),
  before: z.record(z.string(), z.string()).optional(),
  after: z.record(z.string(), z.string()).optional()
});

export const sheetDiffSchema = z.object({
  target: previewTargetSchema,
  estimatedAffectedRows: z.number().int().nonnegative(),
  addedColumns: z.array(nonEmptyStringSchema).default([]),
  changedColumns: z.array(nonEmptyStringSchema).default([]),
  removedColumns: z.array(nonEmptyStringSchema).default([]),
  rowSamples: z.array(rowDiffSampleSchema).default([]),
  warnings: z.array(z.string()).default([])
});

export const diffSummarySchema = z.object({
  sourcePath: z.string().min(1),
  outputPath: z.string().min(1),
  mode: z.enum(["preview", "approval", "execution"]).default("preview"),
  targetCount: z.number().int().nonnegative(),
  estimatedAffectedRows: z.number().int().nonnegative(),
  sheets: z.array(sheetDiffSchema),
  warnings: z.array(z.string()).default([])
});

export type PreviewTargetKind = z.infer<typeof previewTargetKindSchema>;
export type RowDiffKind = z.infer<typeof rowDiffKindSchema>;
export type PreviewTarget = z.infer<typeof previewTargetSchema>;
export type RowDiffSample = z.infer<typeof rowDiffSampleSchema>;
export type DiffSummary = z.infer<typeof diffSummarySchema>;
