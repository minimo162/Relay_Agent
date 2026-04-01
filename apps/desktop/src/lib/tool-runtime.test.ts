import test from "node:test";
import assert from "node:assert/strict";

import type { ToolRegistration } from "@relay-agent/contracts";

import {
  invokeRegisteredTool,
  sendPromptViaBrowserTool,
  type ToolRuntime
} from "./tool-runtime";

function makeMcpTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    id: "mcp.test.my_tool",
    title: "Test Tool",
    description: "test",
    phase: "write",
    requiresApproval: true,
    source: "mcp",
    enabled: true,
    mcpServerUrl: "http://localhost:3100/mcp",
    mcpTransport: "sse",
    ...overrides
  };
}

function makeBuiltinTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    id: "browser.send_to_copilot",
    title: "Copilot",
    description: "test",
    phase: "read",
    requiresApproval: false,
    source: "builtin",
    enabled: true,
    ...overrides
  };
}

function createMockRuntime(): ToolRuntime {
  return {
    sendToCopilot: async (_prompt, options) => {
      options?.onProgress?.({ step: "sent" });
      return "browser-response";
    },
    invokeMcpTool: async ({ toolId, args }) => ({
      toolId,
      source: "mcp",
      result: { echoed: args.message }
    })
  };
}

test("invokeRegisteredTool routes browser tool calls through the browser runtime", async () => {
  const events: string[] = [];
  const result = await invokeRegisteredTool(
    makeBuiltinTool(),
    { prompt: "hello" },
    {
      onBrowserProgress: (event) => events.push(event.step)
    },
    createMockRuntime()
  );

  assert.deepEqual(result, { response: "browser-response" });
  assert.deepEqual(events, ["sent"]);
});

test("invokeRegisteredTool routes MCP tool calls through IPC", async () => {
  const result = await invokeRegisteredTool(
    makeMcpTool(),
    { message: "hello" },
    {},
    createMockRuntime()
  );

  assert.deepEqual(result, { echoed: "hello" });
});

test("sendPromptViaBrowserTool unwraps the browser tool response", async () => {
  const response = await sendPromptViaBrowserTool("hello", {}, {
    sendToCopilot: async () => "copilot-response"
  });

  assert.equal(response, "copilot-response");
});

test("invokeRegisteredTool throws when MCP tool has no mcpServerUrl", async () => {
  await assert.rejects(
    invokeRegisteredTool(makeMcpTool({ mcpServerUrl: undefined }), {}, {}, createMockRuntime()),
    /missing mcpServerUrl/
  );
});

test("invokeRegisteredTool throws when MCP tool is disabled", async () => {
  await assert.rejects(
    invokeRegisteredTool(makeMcpTool({ enabled: false }), {}, {}, createMockRuntime()),
    /disabled/
  );
});

test("invokeRegisteredTool throws for unknown builtin tool id", async () => {
  await assert.rejects(
    invokeRegisteredTool(
      makeBuiltinTool({ id: "unknown.tool" }),
      {},
      {},
      createMockRuntime()
    ),
    /does not expose/
  );
});

test("invokeRegisteredTool propagates MCP invocation errors", async () => {
  const failRuntime: ToolRuntime = {
    ...createMockRuntime(),
    invokeMcpTool: async () => {
      throw new Error("server error");
    }
  };

  await assert.rejects(
    invokeRegisteredTool(makeMcpTool(), {}, {}, failRuntime),
    /server error/
  );
});

test("invokeRegisteredTool times out hung MCP calls", async () => {
  const hangingRuntime: ToolRuntime = {
    ...createMockRuntime(),
    invokeMcpTool: async () => new Promise(() => undefined)
  };

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = ((callback: (...args: never[]) => void) => {
    callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as unknown as typeof clearTimeout;

  try {
    await assert.rejects(
      invokeRegisteredTool(makeMcpTool(), {}, {}, hangingRuntime),
      /timed out/
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
