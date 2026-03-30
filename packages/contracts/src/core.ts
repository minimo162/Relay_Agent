import { z } from "zod";

import {
  entityIdSchema,
  isoDateTimeSchema,
  jsonValueSchema,
  nonEmptyStringSchema,
  relayModeSchema
} from "./shared";

const nullishNonEmptyStringSchema = nonEmptyStringSchema
  .nullish()
  .transform((value) => value ?? undefined);
const nullishEntityIdSchema = entityIdSchema
  .nullish()
  .transform((value) => value ?? undefined);

export const sessionStatusSchema = z.enum(["draft", "active", "archived", "error"]);

export const turnStatusSchema = z.enum([
  "draft",
  "packet-ready",
  "awaiting-response",
  "validated",
  "preview-ready",
  "approved",
  "executed",
  "failed"
]);

export const itemKindSchema = z.enum([
  "objective",
  "relay-packet",
  "copilot-response",
  "validation",
  "workbook-profile",
  "diff-summary",
  "preview",
  "note",
  "log"
]);

export const sessionSchema = z.object({
  id: entityIdSchema,
  title: nonEmptyStringSchema,
  objective: nonEmptyStringSchema,
  status: sessionStatusSchema,
  primaryWorkbookPath: nullishNonEmptyStringSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  latestTurnId: nullishEntityIdSchema,
  turnIds: z.array(entityIdSchema).default([])
});

export const turnSchema = z.object({
  id: entityIdSchema,
  sessionId: entityIdSchema,
  title: nonEmptyStringSchema,
  objective: nonEmptyStringSchema,
  mode: relayModeSchema,
  status: turnStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  itemIds: z.array(entityIdSchema).default([]),
  validationErrorCount: z.number().int().nonnegative().default(0)
});

export const itemSchema = z.object({
  id: entityIdSchema,
  sessionId: entityIdSchema,
  turnId: nullishEntityIdSchema,
  kind: itemKindSchema,
  label: nonEmptyStringSchema,
  payload: jsonValueSchema,
  createdAt: isoDateTimeSchema
});

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type TurnStatus = z.infer<typeof turnStatusSchema>;
export type ItemKind = z.infer<typeof itemKindSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type Item = z.infer<typeof itemSchema>;
