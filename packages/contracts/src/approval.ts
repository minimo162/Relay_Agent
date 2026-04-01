import { z } from "zod";

import { isoDateTimeSchema } from "./shared";

export const operationRiskEnum = z.enum([
  "readonly",
  "low",
  "medium",
  "high",
  "critical"
]);

export const approvalPolicyEnum = z.enum(["safe", "standard", "fast"]);

export const approvalPolicyConfigSchema = z.object({
  policy: approvalPolicyEnum,
  updatedAt: isoDateTimeSchema.optional()
});

export const setApprovalPolicyRequestSchema = z.object({
  policy: approvalPolicyEnum
});

export type OperationRisk = z.infer<typeof operationRiskEnum>;
export type ApprovalPolicy = z.infer<typeof approvalPolicyEnum>;
export type ApprovalPolicyConfig = z.infer<typeof approvalPolicyConfigSchema>;
export type SetApprovalPolicyRequest = z.infer<typeof setApprovalPolicyRequestSchema>;
