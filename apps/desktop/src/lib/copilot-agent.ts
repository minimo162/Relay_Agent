import {
  type CopilotTurnResponse,
  type ExecutionPlan,
  type PlanStep,
  type ToolExecutionResult
} from "@relay-agent/contracts";

import { type BrowserCommandProgress } from "./browser-automation-ui";
import { executeReadActions } from "./ipc";
import { buildPlanningPrompt, buildStepExecutionPrompt } from "./prompt-templates";
import { extractActionFilePaths, isWithinProjectScope } from "./project-scope";
import { sendPromptViaBrowserTool } from "./browser-automation-ui";
import {
  requestCopilotTurn,
  throwIfAborted,
  type CopilotRetryCallbacks
} from "./copilot-turn";
import {
  buildCompressedContext,
  buildLoopContinuationPrompt,
  summarizeTurn,
  type CopilotConversationTurn,
  type TurnSummary
} from "./prompt-templates";

export { buildPlanningPrompt } from "./prompt-templates";
export type { CopilotConversationTurn } from "./prompt-templates";

type AgentLoopRuntime = {
  sendToCopilot?: typeof sendPromptViaBrowserTool;
  executeReadActions?: typeof executeReadActions;
  now?: () => number;
};

export type AgentLoopConfig = {
  sessionId: string;
  turnId: string;
  initialPrompt: string;
  maxTurns: number;
  loopTimeoutMs: number;
  abortSignal?: AbortSignal;
  planningEnabled?: boolean;
  maxRetries?: number;
  maxFullTurns?: number;
  initialConversationHistory?: CopilotConversationTurn[];
  projectContext?: string;
  projectRootFolder?: string;
  runtime?: AgentLoopRuntime;
};

export type LoopTurnResult = {
  turn: number;
  prompt: string;
  rawResponse: string;
  parsedResponse: CopilotTurnResponse;
  toolResults: ToolExecutionResult[];
  hasWriteActions: boolean;
  retryCount: number;
};

export type AgentLoopResult = {
  status:
    | CopilotTurnResponse["status"]
    | "cancelled"
    | "awaiting_plan_approval";
  finalResponse: CopilotTurnResponse | null;
  turns: LoopTurnResult[];
  summary: string;
  proposedPlan?: ExecutionPlan;
  conversationHistory: CopilotConversationTurn[];
};

export type AgentLoopCallbacks = {
  onBrowserProgress?: (event: BrowserCommandProgress) => void;
  onTurnStart?: (turn: number, prompt: string) => void;
  onCopilotResponse?: (
    turn: number,
    response: CopilotTurnResponse,
    rawResponse: string
  ) => void;
  onToolResults?: (turn: number, toolResults: ToolExecutionResult[]) => void;
  onComplete?: (result: AgentLoopResult) => void;
  onPlanProposed?: (plan: ExecutionPlan) => void;
  onRetry?: CopilotRetryCallbacks["onRetry"];
  onManualFallback?: CopilotRetryCallbacks["onManualFallback"];
  onScopeWarning?: (details: {
    violations: string[];
    rootFolder: string;
    tool: string;
    rawResponse: string;
    parsedResponse: CopilotTurnResponse;
  }) => void;
};

function enforceProjectScope(
  actions: CopilotTurnResponse["actions"],
  rootFolder: string,
  callbacks: AgentLoopCallbacks,
  rawResponse: string,
  parsedResponse: CopilotTurnResponse
): void {
  const violations: Array<{ filePath: string; tool: string }> = [];

  for (const action of actions) {
    for (const filePath of extractActionFilePaths(action as {
      tool: string;
      args: Record<string, unknown>;
    })) {
      if (isWithinProjectScope(filePath, rootFolder)) {
        continue;
      }

      if (!violations.some((candidate) => candidate.filePath === filePath)) {
        violations.push({ filePath, tool: action.tool });
      }
    }
  }

  if (violations.length === 0) {
    return;
  }

  callbacks.onScopeWarning?.({
    violations: violations.map((violation) => violation.filePath),
    rootFolder,
    tool: violations[0]?.tool ?? "unknown",
    rawResponse,
    parsedResponse
  });
  throw new Error(
    `プロジェクトスコープ外のファイルアクセスを検出しました: ${violations[0]?.filePath ?? "unknown"}`
  );
}

function resolveRuntime(runtime?: AgentLoopRuntime): Required<AgentLoopRuntime> {
  return {
    sendToCopilot: runtime?.sendToCopilot ?? sendPromptViaBrowserTool,
    executeReadActions: runtime?.executeReadActions ?? executeReadActions,
    now: runtime?.now ?? Date.now
  };
}

function cloneConversationHistory(
  conversationHistory: CopilotConversationTurn[]
): CopilotConversationTurn[] {
  return [...conversationHistory];
}

function createAgentLoopResult(
  value: Omit<AgentLoopResult, "conversationHistory"> & {
    conversationHistory: CopilotConversationTurn[];
  }
): AgentLoopResult {
  return {
    ...value,
    conversationHistory: cloneConversationHistory(value.conversationHistory)
  };
}

export async function runAgentLoop(
  config: AgentLoopConfig,
  callbacks: AgentLoopCallbacks = {}
): Promise<AgentLoopResult> {
  const runtime = resolveRuntime(config.runtime);
  const startedAt = runtime.now();
  const turns: LoopTurnResult[] = [];
  const conversationHistory = [...(config.initialConversationHistory ?? [])];
  const turnSummaries: TurnSummary[] = [];
  let prompt = config.initialPrompt;

  for (let turn = 1; turn <= config.maxTurns; turn += 1) {
    throwIfAborted(config.abortSignal);
    callbacks.onTurnStart?.(turn, prompt);

    const copilotResult = await requestCopilotTurn({
      turn,
      prompt,
      originalTask: config.initialPrompt,
      loopTimeoutMs: config.loopTimeoutMs,
      abortSignal: config.abortSignal,
      maxRetries: config.maxRetries ?? 2,
      callbacks,
      sendToCopilot: runtime.sendToCopilot,
      conversationHistory,
      timeoutMessage: `ターン ${turn} の Copilot 応答がタイムアウトしました（${Math.round(config.loopTimeoutMs / 1000)}秒）。`
    });

    if ("manualFallback" in copilotResult) {
      const result = createAgentLoopResult({
        status: "error",
        finalResponse: null,
        turns,
        summary: copilotResult.summary,
        conversationHistory
      });
      callbacks.onComplete?.(result);
      return result;
    }

    const { rawResponse, parsedResponse, retryCount } = copilotResult;
    callbacks.onCopilotResponse?.(turn, parsedResponse, rawResponse);
    if (config.projectRootFolder?.trim()) {
      enforceProjectScope(
        parsedResponse.actions,
        config.projectRootFolder,
        callbacks,
        rawResponse,
        parsedResponse
      );
    }

    if (config.planningEnabled && parsedResponse.status === "plan_proposed") {
      if (!parsedResponse.executionPlan) {
        throw new Error(
          "Copilot returned `plan_proposed` without an executionPlan payload."
        );
      }

      callbacks.onPlanProposed?.(parsedResponse.executionPlan);

      turns.push({
        turn,
        prompt,
        rawResponse,
        parsedResponse,
        toolResults: [],
        hasWriteActions: false,
        retryCount
      });

      const result = createAgentLoopResult({
        status: "awaiting_plan_approval",
        finalResponse: parsedResponse,
        turns,
        summary: parsedResponse.executionPlan.summary,
        proposedPlan: parsedResponse.executionPlan,
        conversationHistory
      });
      callbacks.onComplete?.(result);
      return result;
    }

    const readOutcome = await runtime.executeReadActions({
      sessionId: config.sessionId,
      turnId: config.turnId,
      loopTurn: turn,
      maxTurns: config.maxTurns,
      actions: parsedResponse.actions
    });
    callbacks.onToolResults?.(turn, readOutcome.toolResults);

    turns.push({
      turn,
      prompt,
      rawResponse,
      parsedResponse,
      toolResults: readOutcome.toolResults,
      hasWriteActions: readOutcome.hasWriteActions,
      retryCount
    });
    turnSummaries.push(summarizeTurn(turn, parsedResponse.status, readOutcome.toolResults));

    if (runtime.now() - startedAt > config.loopTimeoutMs * config.maxTurns) {
      throw new Error("エージェントループ全体がタイムアウトしました。");
    }

    if (!readOutcome.shouldContinue) {
      const result = createAgentLoopResult({
        status: parsedResponse.status,
        finalResponse: parsedResponse,
        turns,
        summary: readOutcome.guardMessage ?? `Agent loop stopped at turn ${turn}.`,
        conversationHistory
      });
      callbacks.onComplete?.(result);
      return result;
    }

    if (
      parsedResponse.status === "ready_to_write" ||
      parsedResponse.status === "done" ||
      parsedResponse.status === "error" ||
      readOutcome.hasWriteActions
    ) {
      const result = createAgentLoopResult({
        status: parsedResponse.status,
        finalResponse: parsedResponse,
        turns,
        summary: parsedResponse.message ?? parsedResponse.summary,
        conversationHistory
      });
      callbacks.onComplete?.(result);
      return result;
    }

    if (readOutcome.toolResults.length === 0) {
      throw new Error("Copilot requested another turn without any executable read tools.");
    }

    prompt = buildLoopContinuationPrompt({
      originalTask: config.initialPrompt,
      toolResults: readOutcome.toolResults,
      turn,
      priorSummary: parsedResponse.summary,
      priorMessage: parsedResponse.message,
      compressedHistory: buildCompressedContext(
        turnSummaries,
        config.maxFullTurns ?? 2
      ),
      conversationHistory,
      projectContext: config.projectContext
    });
  }

  throw new Error(`最大ターン数（${config.maxTurns}）に達しました。`);
}

export async function resumeAgentLoopWithPlan(
  config: AgentLoopConfig,
  plan: ExecutionPlan,
  callbacks: AgentLoopCallbacks & {
    onStepStart?: (step: PlanStep, index: number) => void;
    onStepComplete?: (
      step: PlanStep,
      index: number,
      result: ToolExecutionResult
    ) => void;
    onWriteStepReached?: (step: PlanStep, index: number) => void;
    waitForStepContinuation?: (step: PlanStep, index: number) => Promise<void>;
  } = {}
): Promise<AgentLoopResult> {
  const runtime = resolveRuntime(config.runtime);
  const turns: LoopTurnResult[] = [];
  const completedResults: ToolExecutionResult[] = [];
  const conversationHistory = [...(config.initialConversationHistory ?? [])];
  const turnSummaries: TurnSummary[] = [];

  for (let index = 0; index < plan.steps.length; index += 1) {
    throwIfAborted(config.abortSignal);
    const step = plan.steps[index];
    await callbacks.waitForStepContinuation?.(step, index);
    throwIfAborted(config.abortSignal);
    callbacks.onStepStart?.(step, index);

    const turn = index + 1;
    const stepPrompt = buildStepExecutionPrompt(
      config.initialPrompt,
      step,
      completedResults,
      {
        turn,
        compressedHistory: buildCompressedContext(
          turnSummaries,
          config.maxFullTurns ?? 2
        ),
        conversationHistory,
        projectContext: config.projectContext
      }
    );
    callbacks.onTurnStart?.(turn, stepPrompt);

    const copilotResult = await requestCopilotTurn({
      turn,
      prompt: stepPrompt,
      originalTask: config.initialPrompt,
      loopTimeoutMs: config.loopTimeoutMs,
      abortSignal: config.abortSignal,
      maxRetries: config.maxRetries ?? 2,
      callbacks,
      sendToCopilot: runtime.sendToCopilot,
      conversationHistory,
      timeoutMessage: `ステップ ${turn} がタイムアウトしました。`
    });

    if ("manualFallback" in copilotResult) {
      const result = createAgentLoopResult({
        status: "error",
        finalResponse: null,
        turns,
        summary: copilotResult.summary,
        proposedPlan: {
          ...plan,
          steps: plan.steps.slice(index)
        },
        conversationHistory
      });
      callbacks.onComplete?.(result);
      return result;
    }

    const { rawResponse, parsedResponse, retryCount } = copilotResult;
    callbacks.onCopilotResponse?.(turn, parsedResponse, rawResponse);
    if (config.projectRootFolder?.trim()) {
      enforceProjectScope(
        parsedResponse.actions,
        config.projectRootFolder,
        callbacks,
        rawResponse,
        parsedResponse
      );
    }

    if (step.phase === "write") {
      callbacks.onWriteStepReached?.(step, index);

      turns.push({
        turn,
        prompt: stepPrompt,
        rawResponse,
        parsedResponse,
        toolResults: [],
        hasWriteActions: parsedResponse.actions.length > 0,
        retryCount
      });

      const result = createAgentLoopResult({
        status: "ready_to_write",
        finalResponse: parsedResponse,
        turns,
        summary: parsedResponse.message ?? parsedResponse.summary,
        proposedPlan:
          index + 1 < plan.steps.length
            ? {
                ...plan,
                totalEstimatedSteps: plan.steps.length - (index + 1),
                steps: plan.steps.slice(index + 1)
              }
            : undefined,
        conversationHistory
      });
      callbacks.onComplete?.(result);
      return result;
    }

    const readOutcome = await runtime.executeReadActions({
      sessionId: config.sessionId,
      turnId: config.turnId,
      loopTurn: turn,
      maxTurns: plan.steps.length,
      actions: parsedResponse.actions
    });
    callbacks.onToolResults?.(turn, readOutcome.toolResults);

    const stepResult =
      readOutcome.toolResults[0] ??
      ({
        tool: step.tool,
        args: step.args ?? {},
        ok: true,
        result: null,
        error: undefined
      } satisfies ToolExecutionResult);
    completedResults.push(...readOutcome.toolResults);
    callbacks.onStepComplete?.(step, index, stepResult);

    turns.push({
      turn,
      prompt: stepPrompt,
      rawResponse,
      parsedResponse,
      toolResults: readOutcome.toolResults,
      hasWriteActions: readOutcome.hasWriteActions,
      retryCount
    });
    turnSummaries.push(summarizeTurn(turn, parsedResponse.status, readOutcome.toolResults));

    if (!readOutcome.shouldContinue) {
      const result = createAgentLoopResult({
        status: parsedResponse.status,
        finalResponse: parsedResponse,
        turns,
        summary: readOutcome.guardMessage ?? `Plan execution stopped at step ${turn}.`,
        proposedPlan: {
          ...plan,
          steps: plan.steps.slice(index + 1)
        },
        conversationHistory
      });
      callbacks.onComplete?.(result);
      return result;
    }
  }

  const result = createAgentLoopResult({
    status: "done",
    finalResponse: turns[turns.length - 1]?.parsedResponse ?? null,
    turns,
    summary: `全 ${plan.steps.length} ステップが完了しました。`,
    conversationHistory
  });
  callbacks.onComplete?.(result);
  return result;
}
