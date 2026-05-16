#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "relay-agui-client-tool-token";
const port = 17901;
const dataDir = mkdtempSync(join(tmpdir(), "relay-agui-client-tool-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-agui-client-tool-workspace-"));
const outputPath = join(workspace, "agui-approved.txt");
const rejectedPath = join(workspace, "agui-rejected.txt");
const responses = [
  JSON.stringify({ action: "tool", tool: "read", args: { path: "seed.txt" } }),
  JSON.stringify({ action: "final", answer: "AG-UI read completed." }),
  JSON.stringify({ action: "tool", tool: "write", args: { path: "agui-approved.txt", content: "approved by ag-ui" } }),
  JSON.stringify({ action: "final", answer: "AG-UI approved write completed." }),
  JSON.stringify({ action: "tool", tool: "write", args: { path: "agui-rejected.txt", content: "this must not be written" } }),
  JSON.stringify({ action: "final", answer: "AG-UI rejected write was not executed." }),
];

await writeFile(join(workspace, "seed.txt"), "seed");

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSES_JSON: JSON.stringify(responses),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function waitForStatus() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`, {
        headers: { "X-Relay-Token": token },
      });
      if (response.ok) return;
    } catch {
      // Wait for Kestrel.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

async function postAgUi(body) {
  const response = await fetch(`http://127.0.0.1:${port}/agui/relay?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      "Origin": `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AG-UI endpoint failed: ${response.status} ${text}`);
  }
  return parseSse(text);
}

function parseSse(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    events.push(JSON.parse(line.slice(6)));
  }
  return { text, events };
}

function collectToolCall(events, expectedName) {
  const calls = new Map();
  for (const event of events) {
    if (event.type === "TOOL_CALL_START") {
      calls.set(event.toolCallId, { id: event.toolCallId, name: event.toolCallName, args: "" });
    } else if (event.type === "TOOL_CALL_ARGS") {
      const call = calls.get(event.toolCallId);
      if (call) call.args += event.delta ?? "";
    }
  }
  for (const call of calls.values()) {
    if (call.name === expectedName) return call;
  }
  throw new Error(`Did not find ${expectedName} tool call: ${JSON.stringify(events)}`);
}

function readApprovalRequest(toolCall) {
  const args = JSON.parse(toolCall.args || "{}");
  if (typeof args.request !== "string") {
    throw new Error(`approval request args did not include request JSON string: ${toolCall.args}`);
  }
  const request = JSON.parse(args.request);
  if (!request.approvalId || !request.toolCallId || !request.functionName) {
    throw new Error(`invalid approval request payload: ${JSON.stringify(request)}`);
  }
  return { args, request };
}

function runInput(runId, userText, messages = []) {
  return {
    threadId: `thread-${runId}`,
    runId,
    state: { workspace },
    messages: messages.length > 0
      ? messages
      : [{ id: `${runId}-user`, role: "user", content: userText }],
    tools: [],
    context: [{ description: "workspace", value: workspace }],
    forwardedProps: { workspace },
    forwardedProperties: { workspace },
  };
}

function approvalMessages(runId, userText, approvalToolCall, approved) {
  return [
    { id: `${runId}-user`, role: "user", content: userText },
    {
      id: `${runId}-assistant-approval`,
      role: "assistant",
      toolCalls: [
        {
          id: approvalToolCall.id,
          type: "function",
          function: {
            name: approvalToolCall.name,
            arguments: approvalToolCall.args,
          },
        },
      ],
    },
    {
      id: `${runId}-tool-approval`,
      role: "tool",
      toolCallId: approvalToolCall.id,
      content: JSON.stringify({ approved, reason: approved ? "approved in AG-UI smoke" : "rejected in AG-UI smoke" }),
    },
  ];
}

try {
  await waitForStatus();

  const readPrompt = "seed.txt を読んで";
  const readRun = await postAgUi(runInput("agui-client-tool-read", readPrompt));
  const readCall = collectToolCall(readRun.events, "read");
  if (!readCall.args.includes("seed.txt")) {
    throw new Error(`read AG-UI tool call did not target seed.txt: ${JSON.stringify(readRun.events)}`);
  }
  if (readRun.events.some((event) => event.type === "TOOL_CALL_START" && event.toolCallName === "request_approval")) {
    throw new Error(`read-only AG-UI tool unexpectedly requested approval: ${JSON.stringify(readRun.events)}`);
  }
  if (!readRun.events.some((event) => event.type === "TOOL_CALL_RESULT" && String(event.content ?? "").includes("chars read"))) {
    throw new Error(`read-only AG-UI tool did not return a read observation: ${JSON.stringify(readRun.events)}`);
  }

  const approvePrompt = "agui-approved.txt を作成して";
  const approvalStart = await postAgUi(runInput("agui-client-tool-approve-start", approvePrompt));
  const approvalCall = collectToolCall(approvalStart.events, "request_approval");
  const approvalRequest = readApprovalRequest(approvalCall).request;
  if (approvalRequest.functionName !== "write") {
    throw new Error(`expected write approval request, got ${approvalRequest.functionName}`);
  }
  if (existsSync(outputPath)) {
    throw new Error("write executed before AG-UI approval");
  }

  const approved = await postAgUi(runInput(
    "agui-client-tool-approve-resume",
    approvePrompt,
    approvalMessages("agui-client-tool-approve-resume", approvePrompt, approvalCall, true),
  ));
  if (!approved.events.some((event) => event.type === "TOOL_CALL_RESULT")) {
    throw new Error(`approved run did not emit a tool result: ${JSON.stringify(approved.events)}`);
  }
  if (!existsSync(outputPath)) {
    throw new Error(`approved AG-UI write was not created: ${JSON.stringify(approved.events)} stderr=${stderr}`);
  }
  if (readFileSync(outputPath, "utf8") !== "approved by ag-ui") {
    throw new Error(`approved AG-UI write output mismatch: ${JSON.stringify(approved.events)}`);
  }
  if (!approved.events.some((event) => event.type === "RUN_FINISHED")) {
    throw new Error(`approved run did not finish: ${JSON.stringify(approved.events)}`);
  }

  const rejectPrompt = "agui-rejected.txt を作成して";
  const rejectStart = await postAgUi(runInput("agui-client-tool-reject-start", rejectPrompt));
  const rejectCall = collectToolCall(rejectStart.events, "request_approval");
  const rejectRequest = readApprovalRequest(rejectCall).request;
  if (rejectRequest.functionName !== "write") {
    throw new Error(`expected write rejection request, got ${rejectRequest.functionName}`);
  }
  if (existsSync(rejectedPath)) {
    throw new Error("rejected file was written before rejection");
  }

  const rejected = await postAgUi(runInput(
    "agui-client-tool-reject-resume",
    rejectPrompt,
    approvalMessages("agui-client-tool-reject-resume", rejectPrompt, rejectCall, false),
  ));
  if (existsSync(rejectedPath)) {
    throw new Error("rejected AG-UI write unexpectedly executed");
  }
  if (!rejected.events.some((event) => event.type === "RUN_FINISHED")) {
    throw new Error(`rejected run did not finish: ${JSON.stringify(rejected.events)}`);
  }

  console.log("[agui-client-tool-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
