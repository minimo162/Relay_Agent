import test from "node:test";
import assert from "node:assert/strict";

import {
  raceWithAbort,
  requestCopilotTurn,
  throwIfAborted,
  trimConversationHistory,
  withTimeout
} from "./copilot-turn";

test("requestCopilotTurn retries invalid JSON and preserves conversation history", async () => {
  const prompts: string[] = [];
  const conversationHistory: {
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }[] = [];

  const result = await requestCopilotTurn({
    turn: 1,
    prompt: "元の依頼",
    originalTask: "元の依頼",
    loopTimeoutMs: 1_000,
    maxRetries: 2,
    callbacks: {},
    sendToCopilot: async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1
        ? "not-json"
        : JSON.stringify({
            version: "1.0",
            status: "done",
            summary: "完了",
            actions: []
          });
    },
    conversationHistory,
    timeoutMessage: "timeout"
  });

  assert.ok(!("manualFallback" in result));
  assert.equal(prompts.length, 2);
  assert.equal(conversationHistory[0]?.role, "user");
  assert.equal(conversationHistory[1]?.role, "assistant");
  assert.equal(conversationHistory.at(-1)?.role, "assistant");
  assert.match(prompts[1] ?? "", /解析できませんでした|シンプルに回答してください/);
});

test("requestCopilotTurn falls back after max retries and emits retry callbacks", async () => {
  const retries: number[] = [];
  let fallbackPrompt = "";

  const result = await requestCopilotTurn({
    turn: 1,
    prompt: "元の依頼",
    originalTask: "元の依頼",
    loopTimeoutMs: 1_000,
    maxRetries: 2,
    callbacks: {
      onRetry: (_turn, retryLevel) => {
        retries.push(retryLevel);
      },
      onManualFallback: (_turn, prompt) => {
        fallbackPrompt = prompt;
      }
    },
    sendToCopilot: async () => "still-not-json",
    conversationHistory: [],
    timeoutMessage: "timeout"
  });

  assert.ok("manualFallback" in result);
  assert.deepEqual(retries, [1, 2]);
  assert.match(fallbackPrompt, /元の依頼/);
  if ("manualFallback" in result) {
    assert.match(result.summary, /手動モードにフォールバック/);
  }
});

test("throwIfAborted throws AbortError when signal is aborted", () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => throwIfAborted(controller.signal), { name: "AbortError" });
});

test("throwIfAborted does nothing when signal is not aborted", () => {
  const controller = new AbortController();
  assert.doesNotThrow(() => throwIfAborted(controller.signal));
});

test("throwIfAborted does nothing when signal is undefined", () => {
  assert.doesNotThrow(() => throwIfAborted(undefined));
});

test("withTimeout rejects after timeout", async () => {
  const slowPromise = new Promise<string>((resolve) => {
    setTimeout(() => resolve("late"), 100);
  });

  await assert.rejects(() => withTimeout(slowPromise, 10, "timed out"), {
    message: "timed out"
  });
});

test("withTimeout resolves if promise completes before timeout", async () => {
  const result = await withTimeout(Promise.resolve("fast"), 1000, "timed out");
  assert.equal(result, "fast");
});

test("raceWithAbort rejects when signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();

  assert.throws(() => raceWithAbort(Promise.resolve("done"), controller.signal), {
    name: "AbortError"
  });
});

test("raceWithAbort cleans up abort listener when promise resolves", async () => {
  const controller = new AbortController();
  const addEventListener = controller.signal.addEventListener.bind(controller.signal);
  const removeEventListener = controller.signal.removeEventListener.bind(controller.signal);
  let addCount = 0;
  let removeCount = 0;

  controller.signal.addEventListener = ((...args: Parameters<AbortSignal["addEventListener"]>) => {
    addCount += 1;
    return addEventListener(...args);
  }) as AbortSignal["addEventListener"];
  controller.signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => {
    removeCount += 1;
    return removeEventListener(...args);
  }) as AbortSignal["removeEventListener"];

  const result = await raceWithAbort(Promise.resolve("done"), controller.signal);
  assert.equal(result, "done");
  assert.equal(addCount, 1);
  assert.equal(removeCount, 1);
});

test("requestCopilotTurn retries on parse error and returns fallback after max retries", async () => {
  let callCount = 0;
  const history: { role: "user" | "assistant"; content: string; timestamp: string }[] = [];

  const result = await requestCopilotTurn({
    turn: 1,
    prompt: "test",
    originalTask: "test",
    loopTimeoutMs: 5_000,
    maxRetries: 1,
    callbacks: {},
    sendToCopilot: async () => {
      callCount += 1;
      return "not json";
    },
    conversationHistory: history,
    timeoutMessage: "timeout"
  });

  assert.equal(callCount, 2);
  assert.ok("manualFallback" in result);
});

test("conversationHistory is trimmed when exceeding max size", () => {
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message-${index}`,
    timestamp: new Date(2026, 0, 1, 0, 0, index).toISOString()
  }));

  trimConversationHistory(history);

  assert.ok(history.length <= 30);
  assert.equal(history[0]?.content, "message-0");
  assert.equal(history[1]?.content, "message-1");
  assert.equal(history.at(-1)?.content, "message-39");
});
