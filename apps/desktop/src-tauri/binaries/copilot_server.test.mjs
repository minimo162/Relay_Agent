import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildOpenAiCompletionBody,
  createServer,
  extractOpenAiToolCallsFromText,
  parseOpenAiRequest,
  shouldStartNewChatForRequest,
} from "./copilot_server.js";

test("shouldStartNewChatForRequest opens a new chat only for uninitialized or forced fresh-chat cases", () => {
  assert.equal(
    shouldStartNewChatForRequest({
      relaySessionInitialized: false,
    }),
    true,
  );
  assert.equal(
    shouldStartNewChatForRequest({
      relaySessionInitialized: true,
    }),
    false,
  );
  assert.equal(
    shouldStartNewChatForRequest({
      probeMode: true,
      relaySessionInitialized: true,
    }),
    true,
  );
  assert.equal(
    shouldStartNewChatForRequest({
      relayForceFreshChat: true,
      relaySessionInitialized: true,
    }),
    true,
  );
});

test("shouldStartNewChatForRequest keeps initialized sessions on the same chat", () => {
  assert.equal(
    shouldStartNewChatForRequest({
      relayNewChat: true,
      relaySessionInitialized: true,
      repairStage: true,
      repairReplayUsed: false,
    }),
    false,
  );
  assert.equal(
    shouldStartNewChatForRequest({
      relayNewChat: true,
      relaySessionInitialized: true,
      repairStage: false,
    }),
    false,
  );
  assert.equal(
    shouldStartNewChatForRequest({
      relaySessionInitialized: true,
      repairStage: true,
      repairReplayUsed: true,
    }),
    false,
  );
});

test("parseOpenAiRequest accepts plain OpenAI-compatible requests without Relay IDs", () => {
  const parsed = parseOpenAiRequest({
    model: "m365-copilot",
    user: "opencode-session-1",
    messages: [
      { role: "system", content: "Be concise." },
      { role: "user", content: "List files." },
    ],
  });

  assert.equal(parsed.model, "m365-copilot");
  assert.equal(parsed.relaySessionId, "openai-opencode-session-1");
  assert.match(parsed.relayRequestId, /^openai-/);
  assert.equal(parsed.userPrompt, "List files.");
  assert.equal(parsed.systemPrompt, "Be concise.");
});

test("parseOpenAiRequest preserves conversation history for stateless provider calls", () => {
  const parsed = parseOpenAiRequest({
    messages: [
      { role: "user", content: "What did we decide?" },
      { role: "assistant", content: "Use OpenCode as execution substrate." },
      { role: "user", content: "Summarize the next step." },
    ],
  });

  assert.match(parsed.userPrompt, /USER:\nWhat did we decide\?/);
  assert.match(parsed.userPrompt, /ASSISTANT:\nUse OpenCode as execution substrate\./);
  assert.match(parsed.userPrompt, /USER:\nSummarize the next step\./);
});

test("parseOpenAiRequest isolates stateless OpenAI-compatible requests by default", () => {
  const first = parseOpenAiRequest({
    messages: [{ role: "user", content: "Generate a title." }],
  });
  const second = parseOpenAiRequest({
    messages: [{ role: "user", content: "Do the real task." }],
  });

  assert.match(first.relaySessionId, /^openai-/);
  assert.match(second.relaySessionId, /^openai-/);
  assert.notEqual(first.relaySessionId, "openai-default");
  assert.notEqual(second.relaySessionId, "openai-default");
  assert.notEqual(first.relaySessionId, second.relaySessionId);
});

test("parseOpenAiRequest injects tool protocol instructions for OpenAI tools", () => {
  const parsed = parseOpenAiRequest({
    messages: [{ role: "user", content: "Read README." }],
    tools: [
      {
        type: "function",
        function: {
          name: "read",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      },
    ],
  });

  assert.match(parsed.systemPrompt, /Tool invocation protocol:/);
  assert.match(parsed.systemPrompt, /Available tools: read/);
  assert.equal(parsed.tools[0].function.name, "read");
});

test("parseOpenAiRequest tracks tool result messages and explicit tool choice", () => {
  const parsed = parseOpenAiRequest({
    messages: [
      { role: "user", content: "Read README." },
      { role: "tool", content: "README contents", tool_call_id: "call_read" },
    ],
    tool_choice: { type: "function", function: { name: "read" } },
    tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
  });

  assert.equal(parsed.hasToolResultMessages, true);
  assert.deepEqual(parsed.openAiToolChoice, { type: "function", function: { name: "read" } });
});

test("extractOpenAiToolCallsFromText converts relay_tool fences to OpenAI tool_calls", () => {
  const extracted = extractOpenAiToolCallsFromText(
    '```relay_tool\n{"name":"read","relay_tool_call":true,"input":{"path":"README.md"}}\n```',
    [{ type: "function", function: { name: "read" } }],
  );

  assert.equal(extracted.displayText, "");
  assert.equal(extracted.toolCalls.length, 1);
  assert.equal(extracted.toolCalls[0].type, "function");
  assert.equal(extracted.toolCalls[0].function.name, "read");
  assert.deepEqual(JSON.parse(extracted.toolCalls[0].function.arguments), { path: "README.md" });
});

test("extractOpenAiToolCallsFromText converts OpenAI-compatible tool_uses", () => {
  const extracted = extractOpenAiToolCallsFromText(
    '{"tool_uses":[{"recipient_name":"functions.glob","parameters":{"pattern":"**/*.rs"}}]}',
    [{ type: "function", function: { name: "glob" } }],
  );

  assert.equal(extracted.toolCalls.length, 1);
  assert.equal(extracted.toolCalls[0].function.name, "glob");
  assert.deepEqual(JSON.parse(extracted.toolCalls[0].function.arguments), { pattern: "**/*.rs" });
});

test("extractOpenAiToolCallsFromText recovers embedded repeated tool_calls JSON", () => {
  const repeated =
    '{"{"{"tool_calls":[{"id":"call_read","function":{"name":"read","arguments":"{\\"filePath\\":\\"/tmp/a.txt\\"}"}}]}' +
    '{"tool_calls":[{"id":"call_read","function":{"name":"read","arguments":"{\\"filePath\\":\\"/tmp/a.txt\\"}"}}]}';
  const extracted = extractOpenAiToolCallsFromText(repeated, [
    { type: "function", function: { name: "read" } },
  ]);

  assert.equal(extracted.toolCalls.length, 1);
  assert.equal(extracted.toolCalls[0].function.name, "read");
  assert.deepEqual(JSON.parse(extracted.toolCalls[0].function.arguments), { filePath: "/tmp/a.txt" });
});

test("extractOpenAiToolCallsFromText recovers unescaped nested arguments JSON", () => {
  const malformed =
    '{"tool_calls":[{"id":"call_1","function":{"name":"read","arguments":"{"filePath":"/tmp/a.txt"}"}}]}';
  const extracted = extractOpenAiToolCallsFromText(malformed, [
    { type: "function", function: { name: "read" } },
  ]);

  assert.equal(extracted.toolCalls.length, 1);
  assert.equal(extracted.toolCalls[0].id, "call_1");
  assert.equal(extracted.toolCalls[0].function.name, "read");
  assert.deepEqual(JSON.parse(extracted.toolCalls[0].function.arguments), { filePath: "/tmp/a.txt" });
});

test("buildOpenAiCompletionBody returns finish_reason tool_calls when a tool is extracted", () => {
  const body = buildOpenAiCompletionBody(
    '{"tool_calls":[{"id":"call_1","function":{"name":"read","arguments":"{\\"path\\":\\"README.md\\"}"}}]}',
    {
      model: "m365-copilot",
      tools: [{ type: "function", function: { name: "read" } }],
    },
  );

  assert.equal(body.object, "chat.completion");
  assert.equal(body.choices[0].finish_reason, "tool_calls");
  assert.equal(body.choices[0].message.tool_calls[0].id, "call_1");
  assert.equal(body.choices[0].message.tool_calls[0].function.name, "read");
});

test("createServer exposes OpenAI-compatible models and streaming chat endpoints", async () => {
  const server = createServer({
    async inspectStatus() {
      return { connected: true };
    },
    async startOrJoinDescribe(prompt) {
      return {
        status: 200,
        body: buildOpenAiCompletionBody("streamed response", prompt),
      };
    },
    abortRequest() {
      return false;
    },
    getRequestProgress() {
      return null;
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const models = await fetch(`${base}/v1/models`).then((res) => res.json());
    assert.equal(models.object, "list");
    assert.equal(models.data[0].id, "m365-copilot");

    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "m365-copilot",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
    const text = await response.text();
    assert.match(text, /data: /);
    assert.match(text, /streamed response/);
    assert.match(text, /data: \[DONE\]/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createServer repairs explicit OpenAI-compatible tool requests once", async () => {
  const prompts = [];
  const server = createServer({
    async inspectStatus() {
      return { connected: true };
    },
    async startOrJoinDescribe(prompt) {
      prompts.push(prompt);
      const responseText = prompt.openAiToolRepairAttempt
        ? '{"tool_calls":[{"id":"call_read","function":{"name":"read","arguments":"{\\"path\\":\\"README.md\\"}"}}]}'
        : '```python\nopen("README.md").read()\n```';
      return {
        status: 200,
        body: buildOpenAiCompletionBody(responseText, prompt),
      };
    },
    abortRequest() {
      return false;
    },
    getRequestProgress() {
      return null;
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "m365-copilot",
        messages: [{ role: "user", content: "Use the read tool to read README.md." }],
        tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1].openAiToolRepairAttempt, true);
    assert.equal(prompts[1].relayStageLabel, "tool_repair1");
    assert.deepEqual(prompts[1].tools.map((tool) => tool.function.name), ["read"]);
    assert.match(prompts[1].userPrompt, /Previous invalid response:/);
    assert.equal(body.choices[0].finish_reason, "tool_calls");
    assert.equal(body.choices[0].message.tool_calls[0].function.name, "read");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createServer repairs explicit tool requests after an empty first response", async () => {
  const prompts = [];
  const server = createServer({
    async inspectStatus() {
      return { connected: true };
    },
    async startOrJoinDescribe(prompt) {
      prompts.push(prompt);
      return {
        status: 200,
        body: buildOpenAiCompletionBody(
          prompt.openAiToolRepairAttempt
            ? '{"tool_calls":[{"id":"call_read","function":{"name":"read","arguments":"{\\"path\\":\\"README.md\\"}"}}]}'
            : "",
          prompt,
        ),
      };
    },
    abortRequest() {
      return false;
    },
    getRequestProgress() {
      return null;
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "m365-copilot",
        messages: [{ role: "user", content: "Use the read tool to read README.md." }],
        tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1].openAiToolRepairAttempt, true);
    assert.equal(body.choices[0].finish_reason, "tool_calls");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createServer does not force tool repair after OpenAI tool result messages", async () => {
  const prompts = [];
  const server = createServer({
    async inspectStatus() {
      return { connected: true };
    },
    async startOrJoinDescribe(prompt) {
      prompts.push(prompt);
      return {
        status: 200,
        body: buildOpenAiCompletionBody("final answer after tool result", prompt),
      };
    },
    abortRequest() {
      return false;
    },
    getRequestProgress() {
      return null;
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "m365-copilot",
        messages: [
          { role: "user", content: "Use the read tool to read README.md." },
          { role: "tool", content: "README contents", tool_call_id: "call_read" },
        ],
        tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(prompts.length, 1);
    assert.equal(body.choices[0].message.content, "final answer after tool result");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createServer writes an artifact when tool-call repair still fails", async () => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-tool-repair-artifacts-"));
  const previousArtifactDir = process.env.RELAY_OPENAI_TOOL_REPAIR_ARTIFACT_DIR;
  process.env.RELAY_OPENAI_TOOL_REPAIR_ARTIFACT_DIR = artifactDir;
  const prompts = [];
  const server = createServer({
    async inspectStatus() {
      return { connected: true };
    },
    async startOrJoinDescribe(prompt) {
      prompts.push(prompt);
      return {
        status: 200,
        body: buildOpenAiCompletionBody(
          prompt.openAiToolRepairAttempt
            ? "I can read it with Python: open('README.md').read()"
            : "```python\nopen('README.md').read()\n```",
          prompt,
        ),
      };
    },
    abortRequest() {
      return false;
    },
    getRequestProgress() {
      return null;
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "m365-copilot",
        messages: [{ role: "user", content: "Use the read tool to read README.md." }],
        tools: [
          { type: "function", function: { name: "read", description: "Read a file", parameters: { type: "object" } } },
          { type: "function", function: { name: "write", description: "Write a file", parameters: { type: "object" } } },
        ],
      }),
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error.code, "relay_tool_call_repair_failed");
    assert.equal(path.isAbsolute(body.error.artifact_path), true);
    assert.equal(path.extname(body.error.artifact_path), ".json");
    assert.equal(prompts.length, 2);
    assert.deepEqual(prompts[1].tools.map((tool) => tool.function.name), ["read"]);

    const artifact = JSON.parse(await fs.readFile(body.error.artifact_path, "utf8"));
    assert.equal(artifact.kind, "openai_tool_call_repair_failed");
    assert.equal(artifact.repair.parsedToolCallCount, 0);
    assert.equal(artifact.tools.length, 1);
    assert.equal(artifact.tools[0].name, "read");
    assert.match(artifact.repair.text, /Python/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousArtifactDir == null) {
      delete process.env.RELAY_OPENAI_TOOL_REPAIR_ARTIFACT_DIR;
    } else {
      process.env.RELAY_OPENAI_TOOL_REPAIR_ARTIFACT_DIR = previousArtifactDir;
    }
    await fs.rm(artifactDir, { recursive: true, force: true });
  }
});

test("createServer accepts OpenAI-compatible bearer API key auth", async () => {
  const server = createServer(
    {
      async inspectStatus() {
        return { connected: true };
      },
      async startOrJoinDescribe(prompt) {
        return {
          status: 200,
          body: buildOpenAiCompletionBody("authorized response", prompt),
        };
      },
      abortRequest() {
        return false;
      },
      getRequestProgress() {
        return null;
      },
    },
    { bootToken: "relay-secret" },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const unauthorized = await fetch(`${base}/v1/models`);
    assert.equal(unauthorized.status, 401);

    const models = await fetch(`${base}/v1/models`, {
      headers: { Authorization: "Bearer relay-secret" },
    });
    assert.equal(models.status, 200);

    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer relay-secret",
      },
      body: JSON.stringify({
        model: "m365-copilot",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.choices[0].message.content, "authorized response");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createServer streams live progress snapshots before final completion", async () => {
  const progress = { visibleText: "", done: false, phase: "queued" };
  const server = createServer({
    async inspectStatus() {
      return { connected: true };
    },
    async startOrJoinDescribe(prompt) {
      progress.visibleText = "First chunk";
      await new Promise((resolve) => setTimeout(resolve, 260));
      progress.visibleText = "First chunk and second chunk";
      await new Promise((resolve) => setTimeout(resolve, 260));
      progress.done = true;
      progress.phase = "completed";
      return {
        status: 200,
        body: buildOpenAiCompletionBody("First chunk and second chunk final", prompt),
      };
    },
    abortRequest() {
      return false;
    },
    getRequestProgress() {
      return progress;
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "m365-copilot",
        stream: true,
        messages: [{ role: "user", content: "stream progress" }],
      }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /First chunk/);
    assert.match(text, / and second chunk/);
    assert.match(text, / final/);
    assert.match(text, /finish_reason":"stop"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createServer streams OpenAI-compatible tool calls with chunk indexes", async () => {
  const server = createServer({
    async inspectStatus() {
      return { connected: true };
    },
    async startOrJoinDescribe(prompt) {
      return {
        status: 200,
        body: buildOpenAiCompletionBody(
          '{"tool_calls":[{"id":"call_read","function":{"name":"read","arguments":"{\\"filePath\\":\\"/tmp/smoke.txt\\"}"}}]}',
          prompt,
        ),
      };
    },
    abortRequest() {
      return false;
    },
    getRequestProgress() {
      return null;
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "m365-copilot",
        stream: true,
        messages: [{ role: "user", content: "read file" }],
        tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
      }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /"tool_calls":\[\{"index":0,"id":"call_read"/);
    assert.match(text, /"finish_reason":"tool_calls"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createServer aborts the Relay request when an OpenAI-compatible client disconnects", async () => {
  let aborted = false;
  let resolveDescribe;
  const server = createServer({
    async inspectStatus() {
      return { connected: true };
    },
    async startOrJoinDescribe() {
      return await new Promise((resolve) => {
        resolveDescribe = resolve;
      });
    },
    abortRequest() {
      aborted = true;
      resolveDescribe?.({
        status: 499,
        body: { error: { message: "relay_copilot_aborted", type: "request_aborted", code: "relay_copilot_aborted" } },
      });
      return true;
    },
    getRequestProgress() {
      return null;
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const controller = new AbortController();
    const request = fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "m365-copilot",
        messages: [{ role: "user", content: "cancel me" }],
      }),
      signal: controller.signal,
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await request;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(aborted, true);
  } finally {
    resolveDescribe?.({
      status: 499,
      body: { error: { message: "relay_copilot_aborted", type: "request_aborted", code: "relay_copilot_aborted" } },
    });
    await new Promise((resolve) => server.close(resolve));
  }
});
