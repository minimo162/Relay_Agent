import { z } from "zod";

import { nonEmptyStringSchema } from "./shared";

// File read actions

export const fileListActionSchema = z.object({
  tool: z.literal("file.list"),
  args: z.object({
    path: nonEmptyStringSchema,
    pattern: z.string().optional(),
    recursive: z.boolean().default(false)
  })
});

export const fileReadTextActionSchema = z.object({
  tool: z.literal("file.read_text"),
  args: z.object({
    path: nonEmptyStringSchema,
    maxBytes: z.number().int().positive().max(1_048_576).default(65_536)
  })
});

export const fileStatActionSchema = z.object({
  tool: z.literal("file.stat"),
  args: z.object({
    path: nonEmptyStringSchema
  })
});

// File write actions

export const fileCopyActionSchema = z.object({
  tool: z.literal("file.copy"),
  args: z.object({
    sourcePath: nonEmptyStringSchema,
    destPath: nonEmptyStringSchema,
    overwrite: z.boolean().default(false)
  })
});

export const fileMoveActionSchema = z.object({
  tool: z.literal("file.move"),
  args: z.object({
    sourcePath: nonEmptyStringSchema,
    destPath: nonEmptyStringSchema,
    overwrite: z.boolean().default(false)
  })
});

export const fileDeleteActionSchema = z.object({
  tool: z.literal("file.delete"),
  args: z.object({
    path: nonEmptyStringSchema,
    toRecycleBin: z.boolean().default(true)
  })
});

export const textSearchActionSchema = z.object({
  tool: z.literal("text.search"),
  args: z.object({
    path: nonEmptyStringSchema,
    pattern: nonEmptyStringSchema,
    maxMatches: z.number().int().positive().max(500).default(50),
    contextLines: z.number().int().nonnegative().max(10).default(2)
  })
});

export const textReplaceActionSchema = z.object({
  tool: z.literal("text.replace"),
  args: z.object({
    path: nonEmptyStringSchema,
    pattern: nonEmptyStringSchema,
    replacement: z.string(),
    createBackup: z.boolean().default(true)
  })
});

export const documentReadTextActionSchema = z.object({
  tool: z.literal("document.read_text"),
  args: z.object({
    path: nonEmptyStringSchema,
    maxChars: z.number().int().positive().max(500_000).default(50_000)
  })
});

// Union

export const fileActionSchema = z.discriminatedUnion("tool", [
  fileListActionSchema,
  fileReadTextActionSchema,
  fileStatActionSchema,
  fileCopyActionSchema,
  fileMoveActionSchema,
  fileDeleteActionSchema,
  textSearchActionSchema,
  textReplaceActionSchema,
  documentReadTextActionSchema
]);

export type FileListAction = z.infer<typeof fileListActionSchema>;
export type FileReadTextAction = z.infer<typeof fileReadTextActionSchema>;
export type FileStatAction = z.infer<typeof fileStatActionSchema>;
export type FileCopyAction = z.infer<typeof fileCopyActionSchema>;
export type FileMoveAction = z.infer<typeof fileMoveActionSchema>;
export type FileDeleteAction = z.infer<typeof fileDeleteActionSchema>;
export type TextSearchAction = z.infer<typeof textSearchActionSchema>;
export type TextReplaceAction = z.infer<typeof textReplaceActionSchema>;
export type DocumentReadTextAction = z.infer<typeof documentReadTextActionSchema>;
export type FileAction = z.infer<typeof fileActionSchema>;
