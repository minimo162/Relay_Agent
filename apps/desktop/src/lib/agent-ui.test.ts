import assert from "node:assert/strict";
import test from "node:test";

import { get } from "svelte/store";

import { createAgentUi } from "./agent-ui";

type MockEvent<TPayload> = {
  payload: TPayload;
};

test("agent-ui startAgent loads session history and records a start entry", async () => {
  const listeners = new Map<string, (event: MockEvent<unknown>) => void>();

  const agentUi = createAgentUi({
    listen: async (eventName, handler) => {
      listeners.set(eventName, handler as (event: MockEvent<unknown>) => void);
      return () => {
        listeners.delete(eventName);
      };
    },
    invoke: async <TResponse>(command: string, args?: Record<string, unknown>) => {
      if (command === "start_agent") {
        return "session-1" as TResponse;
      }

      if (command === "get_session_history") {
        assert.deepEqual(args, {
          request: {
            sessionId: "session-1"
          }
        });

        return {
          sessionId: "session-1",
          running: true,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "goal" }]
            }
          ]
        } as TResponse;
      }

      throw new Error(`Unexpected command: ${command}`);
    }
  });

  const sessionId = await agentUi.startAgent({
    goal: "goal",
    files: ["/tmp/demo.csv"]
  });

  assert.equal(sessionId, "session-1");
  assert.equal(get(agentUi.sessionStore).sessionId, "session-1");
  assert.equal(get(agentUi.sessionStore).messages.length, 1);
  assert.equal(get(agentUi.feedStore).length, 1);
  assert.equal(get(agentUi.feedStore)[0]?.type, "session_started");
  assert.equal(listeners.size, 5);
});

test("agent-ui updates approval and completion state from bridge events", async () => {
  const listeners = new Map<string, (event: MockEvent<unknown>) => void>();

  const agentUi = createAgentUi({
    listen: async (eventName, handler) => {
      listeners.set(eventName, handler as (event: MockEvent<unknown>) => void);
      return () => {
        listeners.delete(eventName);
      };
    },
    invoke: async <TResponse>(command: string) => {
      if (command === "start_agent") {
        return "session-2" as TResponse;
      }

      if (command === "get_session_history") {
        return {
          sessionId: "session-2",
          running: false,
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "done" }]
            }
          ]
        } as TResponse;
      }

      return null as TResponse;
    }
  });

  await agentUi.startAgent({ goal: "goal" });

  listeners.get("agent:approval_needed")?.({
    payload: {
      sessionId: "session-2",
      approvalId: "approval-1",
      toolName: "file_write",
      description: "execute tool file_write",
      target: "/tmp/out.csv",
      input: { path: "/tmp/out.csv" }
    }
  });

  assert.equal(get(agentUi.sessionStore).status, "awaiting_approval");
  assert.equal(get(agentUi.approvalStore).pending?.approvalId, "approval-1");

  listeners.get("agent:turn_complete")?.({
    payload: {
      sessionId: "session-2",
      stopReason: "EndTurn",
      assistantMessage: "done",
      messageCount: 3
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(get(agentUi.sessionStore).status, "completed");
  assert.equal(get(agentUi.sessionStore).running, false);
  assert.equal(get(agentUi.approvalStore).pending, null);
  assert.equal(get(agentUi.feedStore).at(-1)?.type, "turn_complete");
});
