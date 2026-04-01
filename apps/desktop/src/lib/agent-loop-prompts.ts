import type { PlanStep, ToolExecutionResult } from "@relay-agent/contracts";

import {
  buildProjectContext,
  buildCompressedContext,
  buildErrorRecoveryPrompt,
  buildFollowUpPromptV2,
  buildPlanningPrompt,
  buildPlanningPromptV2,
  buildStepExecutionPrompt as buildStepExecutionPromptTemplate,
  summarizeTurn,
  type CopilotConversationTurn,
  type TurnSummary
} from "./prompt-templates";

export {
  buildProjectContext,
  buildCompressedContext,
  buildErrorRecoveryPrompt,
  buildFollowUpPromptV2,
  buildPlanningPrompt,
  buildPlanningPromptV2,
  summarizeTurn
};

export type { CopilotConversationTurn, TurnSummary };

export function buildStepExecutionPrompt(
  originalTask: string,
  step: PlanStep,
  priorResults: ToolExecutionResult[],
  options?: {
    turn?: number;
    compressedHistory?: string;
    conversationHistory?: CopilotConversationTurn[];
    projectContext?: string;
  }
): string {
  return buildStepExecutionPromptTemplate(originalTask, step, priorResults, options);
}
