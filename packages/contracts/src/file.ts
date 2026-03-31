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

// Union

export const fileActionSchema = z.discriminatedUnion("tool", [
  fileListActionSchema,
  fileReadTextActionSchema,
  fileStatActionSchema,
  fileCopyActionSchema,
  fileMoveActionSchema,
  fileDeleteActionSchema
]);

export type FileListAction = z.infer<typeof fileListActionSchema>;
export type FileReadTextAction = z.infer<typeof fileReadTextActionSchema>;
export type FileStatAction = z.infer<typeof fileStatActionSchema>;
export type FileCopyAction = z.infer<typeof fileCopyActionSchema>;
export type FileMoveAction = z.infer<typeof fileMoveActionSchema>;
export type FileDeleteAction = z.infer<typeof fileDeleteActionSchema>;
export type FileAction = z.infer<typeof fileActionSchema>;
