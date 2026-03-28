import { z } from "zod";

export const nonEmptyStringSchema = z.string().trim().min(1);
export const entityIdSchema = nonEmptyStringSchema;
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const relayModeSchema = z.enum(["discover", "plan", "repair", "followup"]);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema)
  ])
);
