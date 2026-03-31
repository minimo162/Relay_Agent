import {
  copilotTurnResponseSchema,
  type CopilotTurnResponse,
  type ToolExecutionResult
} from "@relay-agent/contracts";

import { sendToCopilot } from "./copilot-browser";
import { executeReadActions } from "./ipc";

export type AgentLoopConfig = {
  sessionId: string;
  turnId: string;
  initialPrompt: string;
  maxTurns: number;
  loopTimeoutMs: number;
  abortSignal?: AbortSignal;
};

export type LoopTurnResult = {
  turn: number;
  prompt: string;
  rawResponse: string;
  parsedResponse: CopilotTurnResponse;
  toolResults: ToolExecutionResult[];
  hasWriteActions: boolean;
};

export type AgentLoopResult = {
  status: CopilotTurnResponse["status"] | "cancelled";
  finalResponse: CopilotTurnResponse | null;
  turns: LoopTurnResult[];
  summary: string;
};

export type AgentLoopCallbacks = {
  onTurnStart?: (turn: number, prompt: string) => void;
  onCopilotResponse?: (
    turn: number,
    response: CopilotTurnResponse,
    rawResponse: string
  ) => void;
  onToolResults?: (turn: number, toolResults: ToolExecutionResult[]) => void;
  onComplete?: (result: AgentLoopResult) => void;
};

export async function runAgentLoop(
  config: AgentLoopConfig,
  callbacks: AgentLoopCallbacks = {}
): Promise<AgentLoopResult> {
  const startedAt = Date.now();
  const turns: LoopTurnResult[] = [];
  let prompt = config.initialPrompt;

  for (let turn = 1; turn <= config.maxTurns; turn += 1) {
    throwIfAborted(config.abortSignal);
    callbacks.onTurnStart?.(turn, prompt);

    const rawResponse = await raceWithAbort(
      withTimeout(
        sendToCopilot(prompt),
        config.loopTimeoutMs,
        `ターン ${turn} の Copilot 応答がタイムアウトしました（${Math.round(config.loopTimeoutMs / 1000)}秒）。`
      ),
      config.abortSignal
    );
    const parsedResponse = copilotTurnResponseSchema.parse(JSON.parse(rawResponse));
    callbacks.onCopilotResponse?.(turn, parsedResponse, rawResponse);

    const readOutcome = await executeReadActions({
      sessionId: config.sessionId,
      turnId: config.turnId,
      loopTurn: turn,
      maxTurns: config.maxTurns,
      actions: parsedResponse.actions
    });
    callbacks.onToolResults?.(turn, readOutcome.toolResults);

    const turnResult: LoopTurnResult = {
      turn,
      prompt,
      rawResponse,
      parsedResponse,
      toolResults: readOutcome.toolResults,
      hasWriteActions: readOutcome.hasWriteActions
    };
    turns.push(turnResult);

    if (Date.now() - startedAt > config.loopTimeoutMs * config.maxTurns) {
      throw new Error("エージェントループ全体がタイムアウトしました。");
    }

    if (!readOutcome.shouldContinue) {
      const result: AgentLoopResult = {
        status: parsedResponse.status,
        finalResponse: parsedResponse,
        turns,
        summary:
          readOutcome.guardMessage ??
          `Agent loop stopped at turn ${turn}.`
      };
      callbacks.onComplete?.(result);
      return result;
    }

    if (
      parsedResponse.status === "ready_to_write" ||
      parsedResponse.status === "done" ||
      parsedResponse.status === "error" ||
      readOutcome.hasWriteActions
    ) {
      const result: AgentLoopResult = {
        status: parsedResponse.status,
        finalResponse: parsedResponse,
        turns,
        summary: parsedResponse.message ?? parsedResponse.summary
      };
      callbacks.onComplete?.(result);
      return result;
    }

    if (readOutcome.toolResults.length === 0) {
      throw new Error("Copilot requested another turn without any executable read tools.");
    }

    prompt = buildFollowUpPrompt(config.initialPrompt, readOutcome.toolResults, {
      turn,
      priorSummary: parsedResponse.summary,
      priorMessage: parsedResponse.message
    });
  }

  throw new Error(`最大ターン数（${config.maxTurns}）に達しました。`);
}

export function buildFollowUpPrompt(
  originalTask: string,
  toolResults: ToolExecutionResult[],
  context?: {
    turn?: number;
    priorSummary?: string;
    priorMessage?: string;
  }
): string {
  const sections = [
    "You are continuing the same Relay Agent task.",
    "Return strict JSON only. Do not include markdown fences.",
    `Original task:\n${originalTask.trim()}`
  ];

  if (context?.turn) {
    sections.push(`Current turn: ${context.turn + 1}`);
  }

  if (context?.priorSummary) {
    sections.push(`Previous summary:\n${context.priorSummary}`);
  }

  if (context?.priorMessage) {
    sections.push(`Previous message:\n${context.priorMessage}`);
  }

  sections.push(
    [
      "Tool results:",
      ...toolResults.map((result, index) =>
        [
          `### Result ${index + 1}: ${result.tool}`,
          `ok: ${result.ok}`,
          "```json",
          JSON.stringify(result.ok ? result.result ?? {} : { error: result.error }, null, 2),
          "```"
        ].join("\n")
      )
    ].join("\n\n")
  );

  sections.push(
    [
      "Decide the next step:",
      '- If more read tools are needed, return `status: "thinking"` with those read actions.',
      '- If you are ready to propose write actions, return `status: "ready_to_write"`.',
      '- If the task is complete without writes, return `status: "done"` and no actions.',
      '- If the task cannot continue, return `status: "error"` with a short `message`.'
    ].join("\n")
  );

  return sections.join("\n\n");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Agent loop cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    throwIfAborted(signal);
  }

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          const error = new Error("Agent loop cancelled.");
          error.name = "AbortError";
          reject(error);
        },
        { once: true }
      );
    })
  ]);
}
