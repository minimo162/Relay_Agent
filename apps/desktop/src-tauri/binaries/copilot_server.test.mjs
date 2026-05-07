import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOpenAiCompletionBody,
  createServer,
  extractOpenAiToolCallsFromText,
  parseOpenAiRequest,
  shouldStartNewChatForRequest,
} from "./copilot_server.mjs";

function collectSseContentDeltas(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)))
    .map((event) => event?.choices?.[0]?.delta?.content)
    .filter((content) => typeof content === "string" && content.length);
}

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
  assert.match(parsed.systemPrompt, /Tool Call Emulation Layer:/);
  assert.match(parsed.systemPrompt, /Available tools: read/);
  assert.equal(parsed.toolProtocolMode, "tool_planning");
  assert.equal(parsed.requiresStrictToolCalls, true);
  assert.equal(parsed.tools[0].function.name, "read");
});

test("parseOpenAiRequest allows final answers when tools are available but no environment access is requested", () => {
  const parsed = parseOpenAiRequest({
    messages: [{ role: "user", content: "Explain recursion in one sentence." }],
    tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
  });

  assert.equal(parsed.toolProtocolMode, "final_answer");
  assert.equal(parsed.requiresStrictToolCalls, false);
  assert.match(parsed.systemPrompt, /Mode: final_answer/);
});

test("parseOpenAiRequest treats tool results as final-answer mode", () => {
  const parsed = parseOpenAiRequest({
    messages: [
      { role: "user", content: "Read README." },
      { role: "tool", content: "README contents", tool_call_id: "call_read" },
    ],
    tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
  });

  assert.equal(parsed.hasToolResultMessages, true);
  assert.equal(parsed.toolProtocolMode, "final_answer");
  assert.equal(parsed.requiresStrictToolCalls, false);
  assert.match(parsed.systemPrompt, /Answer only from the provided TOOL\/FUNCTION results/);
});

test("parseOpenAiRequest honors explicit no-tool choice", () => {
  const parsed = parseOpenAiRequest({
    messages: [{ role: "user", content: "Read README.md." }],
    tool_choice: "none",
    tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
  });

  assert.equal(parsed.openAiToolChoice, "none");
  assert.equal(parsed.toolProtocolMode, "final_answer");
  assert.equal(parsed.requiresStrictToolCalls, false);
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
  assert.equal(body.choices[0].message.content, null);
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
    assert.equal(prompts[0].toolProtocolMode, "tool_planning");
    assert.equal(prompts[0].requiresStrictToolCalls, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("createServer emulates tool calling for environment-access prompts in auto mode", async () => {
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
            : "I will use Microsoft 365 Copilot to inspect the workspace.",
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
        messages: [{ role: "user", content: "README.md を読んで要約して" }],
        tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0].toolProtocolMode, "tool_planning");
    assert.equal(prompts[0].requiresStrictToolCalls, true);
    assert.match(prompts[0].systemPrompt, /Natural language is invalid/);
    assert.equal(prompts[1].openAiToolRepairAttempt, true);
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

test("createServer fail-closes strict tool planning when repair mixes prose with tool calls", async () => {
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
            ? 'Here is the call: {"tool_calls":[{"id":"call_read","function":{"name":"read","arguments":"{\\"path\\":\\"README.md\\"}"}}]}'
            : "I can inspect the file with my own tools.",
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
        messages: [{ role: "user", content: "Read README.md." }],
        tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
      }),
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error.code, "relay_tool_call_repair_failed");
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1].requiresStrictToolCalls, true);
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

test("createServer buffers streaming text until the final completion", async () => {
  const progress = { visibleText: "", done: false, phase: "queued" };
  const server = createServer({
    async inspectStatus() {
      return { connected: true };
    },
    async startOrJoinDescribe(prompt) {
      progress.visibleText = "Draft duplicated text";
      await new Promise((resolve) => setTimeout(resolve, 260));
      progress.visibleText = "Draft duplicated text Draft duplicated text";
      await new Promise((resolve) => setTimeout(resolve, 260));
      progress.done = true;
      progress.phase = "completed";
      return {
        status: 200,
        body: buildOpenAiCompletionBody("Final stable answer", prompt),
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
    assert.deepEqual(collectSseContentDeltas(text), ["Final stable answer"]);
    assert.doesNotMatch(text, /Draft duplicated text/);
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

test("direct copilot_server writes the assigned port file for port 0", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "relay-copilot-port-file-"));
  const portFile = path.join(tempDir, "port.txt");
  for (const filename of [
    "copilot_server.js",
    "copilot_server.mjs",
    "copilot_dom_poll.mjs",
    "copilot_send_timing.mjs",
    "copilot_wait_dom_response.mjs",
  ]) {
    await fs.copyFile(fileURLToPath(new URL(`./${filename}`, import.meta.url)), path.join(tempDir, filename));
  }
  const script = path.join(tempDir, "copilot_server.js");
  const child = spawn(process.execPath, [
    "--no-warnings",
    script,
    "--port",
    "0",
    "--port-file",
    portFile,
    "--instance-id",
    "test-instance",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    let port = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const raw = await fs.readFile(portFile, "utf8");
        port = Number.parseInt(raw.trim(), 10);
        if (Number.isInteger(port) && port > 0) break;
      } catch {
        // wait below
      }
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.ok(port > 0, `expected assigned port file; stderr=${stderr}`);
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.instanceId, "test-instance");
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("close", resolve));
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
