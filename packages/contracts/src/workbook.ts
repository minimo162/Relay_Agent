import { z } from "zod";

import { entityIdSchema, nonEmptyStringSchema } from "./shared";

export const workbookFormatSchema = z.enum(["csv", "xlsx"]);
export const columnTypeSchema = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "date"
]);
export const aggregateOperationSchema = z.enum([
  "sum",
  "avg",
  "count",
  "min",
  "max"
]);
export const deriveColumnPositionSchema = z.enum(["start", "end", "after"]);
export const previewTargetKindSchema = z.enum(["sheet", "table"]);

export const workbookSheetSchema = z.object({
  name: nonEmptyStringSchema,
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  columns: z.array(nonEmptyStringSchema).default([])
});

export const workbookProfileSchema = z.object({
  sourcePath: z.string().min(1),
  format: workbookFormatSchema,
  sheetCount: z.number().int().nonnegative(),
  sheets: z.array(workbookSheetSchema),
  warnings: z.array(z.string()).default([])
});

export const sheetPreviewRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  values: z.array(z.string()).default([])
});

export const sheetPreviewSchema = z.object({
  sheet: nonEmptyStringSchema,
  columns: z.array(nonEmptyStringSchema).default([]),
  rows: z.array(sheetPreviewRowSchema).default([]),
  truncated: z.boolean(),
  warnings: z.array(z.string()).default([])
});

export const columnProfileSummarySchema = z.object({
  column: nonEmptyStringSchema,
  inferredType: columnTypeSchema,
  nonEmptyCount: z.number().int().nonnegative(),
  nullCount: z.number().int().nonnegative(),
  sampleValues: z.array(z.string()).default([])
});

export const sheetColumnProfileSchema = z.object({
  sheet: nonEmptyStringSchema,
  rowCount: z.number().int().nonnegative(),
  sampledRows: z.number().int().nonnegative(),
  columns: z.array(columnProfileSummarySchema).default([]),
  warnings: z.array(z.string()).default([])
});

const readActionBaseSchema = z.object({
  id: entityIdSchema.optional(),
  rationale: z.string().trim().min(1).optional()
});

const writeActionBaseSchema = readActionBaseSchema.extend({
  sheet: nonEmptyStringSchema
});

export const workbookInspectActionSchema = readActionBaseSchema.extend({
  tool: z.literal("workbook.inspect"),
  args: z.object({
    sourcePath: z.string().min(1).optional()
  })
});

export const sheetPreviewActionSchema = readActionBaseSchema.extend({
  tool: z.literal("sheet.preview"),
  args: z.object({
    sheet: nonEmptyStringSchema,
    limit: z.number().int().positive().max(200).default(25)
  })
});

export const sheetProfileColumnsActionSchema = readActionBaseSchema.extend({
  tool: z.literal("sheet.profile_columns"),
  args: z.object({
    sheet: nonEmptyStringSchema,
    sampleSize: z.number().int().positive().max(5000).default(250)
  })
});

export const sessionDiffFromBaseActionSchema = readActionBaseSchema.extend({
  tool: z.literal("session.diff_from_base"),
  args: z.object({
    artifactId: entityIdSchema.optional()
  })
});

export const renameColumnsActionSchema = writeActionBaseSchema.extend({
  tool: z.literal("table.rename_columns"),
  args: z.object({
    renames: z
      .array(
        z.object({
          from: nonEmptyStringSchema,
          to: nonEmptyStringSchema
        })
      )
      .min(1)
  })
});

export const castColumnsActionSchema = writeActionBaseSchema.extend({
  tool: z.literal("table.cast_columns"),
  args: z.object({
    casts: z
      .array(
        z.object({
          column: nonEmptyStringSchema,
          toType: columnTypeSchema
        })
      )
      .min(1)
  })
});

export const filterRowsActionSchema = writeActionBaseSchema.extend({
  tool: z.literal("table.filter_rows"),
  args: z.object({
    predicate: nonEmptyStringSchema,
    outputSheet: nonEmptyStringSchema.optional()
  })
});

export const deriveColumnActionSchema = writeActionBaseSchema.extend({
  tool: z.literal("table.derive_column"),
  args: z.object({
    column: nonEmptyStringSchema,
    expression: nonEmptyStringSchema,
    position: deriveColumnPositionSchema.default("end"),
    afterColumn: nonEmptyStringSchema.optional()
  })
});

export const groupAggregateActionSchema = writeActionBaseSchema.extend({
  tool: z.literal("table.group_aggregate"),
  args: z.object({
    groupBy: z.array(nonEmptyStringSchema).min(1),
    measures: z
      .array(
        z.object({
          column: nonEmptyStringSchema,
          op: aggregateOperationSchema,
          as: nonEmptyStringSchema
        })
      )
      .min(1),
    outputSheet: nonEmptyStringSchema.optional()
  })
});

export const saveCopyActionSchema = readActionBaseSchema.extend({
  tool: z.literal("workbook.save_copy"),
  args: z.object({
    outputPath: z.string().min(1)
  })
});

export const spreadsheetActionSchema = z.discriminatedUnion("tool", [
  workbookInspectActionSchema,
  sheetPreviewActionSchema,
  sheetProfileColumnsActionSchema,
  sessionDiffFromBaseActionSchema,
  renameColumnsActionSchema,
  castColumnsActionSchema,
  filterRowsActionSchema,
  deriveColumnActionSchema,
  groupAggregateActionSchema,
  saveCopyActionSchema
]);

export const previewTargetSchema = z.object({
  kind: previewTargetKindSchema,
  sheet: nonEmptyStringSchema,
  table: nonEmptyStringSchema.optional(),
  label: nonEmptyStringSchema
});

export const sheetDiffSchema = z.object({
  target: previewTargetSchema,
  estimatedAffectedRows: z.number().int().nonnegative(),
  addedColumns: z.array(nonEmptyStringSchema).default([]),
  changedColumns: z.array(nonEmptyStringSchema).default([]),
  removedColumns: z.array(nonEmptyStringSchema).default([]),
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

export type WorkbookFormat = z.infer<typeof workbookFormatSchema>;
export type ColumnType = z.infer<typeof columnTypeSchema>;
export type AggregateOperation = z.infer<typeof aggregateOperationSchema>;
export type DeriveColumnPosition = z.infer<typeof deriveColumnPositionSchema>;
export type PreviewTargetKind = z.infer<typeof previewTargetKindSchema>;
export type WorkbookSheet = z.infer<typeof workbookSheetSchema>;
export type WorkbookProfile = z.infer<typeof workbookProfileSchema>;
export type SheetPreviewRow = z.infer<typeof sheetPreviewRowSchema>;
export type SheetPreview = z.infer<typeof sheetPreviewSchema>;
export type ColumnProfileSummary = z.infer<typeof columnProfileSummarySchema>;
export type SheetColumnProfile = z.infer<typeof sheetColumnProfileSchema>;
export type SpreadsheetAction = z.infer<typeof spreadsheetActionSchema>;
export type PreviewTarget = z.infer<typeof previewTargetSchema>;
export type DiffSummary = z.infer<typeof diffSummarySchema>;
