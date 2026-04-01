import {
  copilotTurnResponseSchema,
  type CopilotTurnResponse
} from "@relay-agent/contracts";

import {
  buildErrorRecoveryPrompt,
  type CopilotConversationTurn
} from "./prompt-templates";

export type CopilotProgressEvent = {
  step: string;
  detail?: string;
};

export type CopilotRetryCallbacks = {
  onBrowserProgress?: (event: CopilotProgressEvent) => void;
  onRetry?: (turn: number, retryLevel: number, error: string, retryPrompt: string) => void;
  onManualFallback?: (turn: number, fallbackPrompt: string, error: string) => void;
};

export type CopilotRequestSuccess = {
  rawResponse: string;
  parsedResponse: CopilotTurnResponse;
  retryCount: number;
};

export type CopilotRequestFallback = {
  manualFallback: true;
  fallbackPrompt: string;
  error: string;
  summary: string;
};

const MAX_CONVERSATION_HISTORY = 30;

export function trimConversationHistory(
  history: CopilotConversationTurn[],
  maxSize = MAX_CONVERSATION_HISTORY,
  preserveHead = 2
): void {
  if (history.length <= maxSize) {
    return;
  }

  const preserved = history.slice(0, preserveHead);
  const recent = history.slice(-(maxSize - preserveHead));
  history.length = 0;
  history.push(...preserved, ...recent);
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Agent loop cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

export function withTimeout<T>(
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

export function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    throwIfAborted(signal);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const error = new Error("Agent loop cancelled.");
      error.name = "AbortError";
      reject(error);
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

export async function requestCopilotTurn(
  params: {
    turn: number;
    prompt: string;
    originalTask: string;
    loopTimeoutMs: number;
    abortSignal?: AbortSignal;
    maxRetries: number;
    callbacks: CopilotRetryCallbacks;
    sendToCopilot: (
      prompt: string,
      options?: { onProgress?: (event: CopilotProgressEvent) => void }
    ) => Promise<string>;
    conversationHistory: CopilotConversationTurn[];
    timeoutMessage: string;
  }
): Promise<CopilotRequestSuccess | CopilotRequestFallback> {
  let lastError = "";
  let lastValidResponse: string | undefined;

  for (let retryCount = 0; retryCount <= params.maxRetries; retryCount += 1) {
    const promptToSend =
      retryCount === 0
        ? params.prompt
        : buildErrorRecoveryPrompt({
            originalTask: params.originalTask,
            errorDescription: lastError,
            retryLevel: retryCount as 1 | 2,
            lastValidResponse
          });

    if (retryCount > 0) {
      params.callbacks.onRetry?.(params.turn, retryCount, lastError, promptToSend);
    }

    params.conversationHistory.push({
      role: "user",
      content: promptToSend,
      timestamp: new Date().toISOString()
    });
    trimConversationHistory(params.conversationHistory);

    try {
      const rawResponse = await raceWithAbort(
        withTimeout(
          params.sendToCopilot(promptToSend, {
            onProgress: params.callbacks.onBrowserProgress
          }),
          params.loopTimeoutMs,
          params.timeoutMessage
        ),
        params.abortSignal
      );

      params.conversationHistory.push({
        role: "assistant",
        content: rawResponse,
        timestamp: new Date().toISOString()
      });
      trimConversationHistory(params.conversationHistory);

      lastValidResponse = rawResponse;

      return {
        rawResponse,
        parsedResponse: copilotTurnResponseSchema.parse(JSON.parse(rawResponse)),
        retryCount
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      lastError = error instanceof Error ? error.message : String(error);

      if (retryCount >= params.maxRetries) {
        const fallbackPrompt =
          buildErrorRecoveryPrompt({
            originalTask: params.originalTask,
            errorDescription: lastError,
            retryLevel: 3,
            lastValidResponse
          }) || params.prompt;
        params.callbacks.onManualFallback?.(params.turn, fallbackPrompt, lastError);

        return {
          manualFallback: true,
          fallbackPrompt,
          error: lastError,
          summary:
            "Copilot の応答を自動処理できなかったため、手動モードにフォールバックしました。"
        };
      }
    }
  }

  return {
    manualFallback: true,
    fallbackPrompt: params.prompt,
    error: lastError || "Unknown Copilot error.",
    summary: "Copilot の応答を自動処理できなかったため、手動モードにフォールバックしました."
  };
}
