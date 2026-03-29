import { z } from "zod";

import { relayModeSchema } from "./shared";

export const appStageSchema = z.enum(["planning", "implementation"]);

export const projectInfoSchema = z.object({
  name: z.literal("Relay Agent"),
  stage: appStageSchema,
  supportedRelayModes: z.array(relayModeSchema).default(relayModeSchema.options)
});

export type AppStage = z.infer<typeof appStageSchema>;
export type ProjectInfo = z.infer<typeof projectInfoSchema>;

export const projectInfo: ProjectInfo = {
  name: "Relay Agent",
  stage: "implementation",
  supportedRelayModes: relayModeSchema.options
};
