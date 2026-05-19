#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "relay-app-server-bridge-smoke-token";
const port = 17931;
const origin = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), "relay-app-server-bridge-"));
const workArea = mkdtempSync(join(tmpdir(), "relay-app-server-workarea-"));
const fixtureTrace = join(dataDir, "fixture-trace.log");
writeFileSync(join(workArea, "alpha.txt"), "alpha bridge smoke\n", "utf8");

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSE: "bridge smoke",
    RELAY_APP_SERVER_COMMAND: process.execPath,
    RELAY_APP_SERVER_ARGS_JSON: JSON.stringify([join(process.cwd(), "scripts/fixtures/codex-app-server-fixture.mjs")]),
    RELAY_APP_SERVER_FIXTURE_TRACE: fixtureTrace,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
let stdout = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});

try {
  await waitForStatus();

  const unauthorized = await fetch(`${origin}/bridge/health`);
  if (unauthorized.status !== 401) {
    throw new Error(`bridge health without token should be 401, got ${unauthorized.status}`);
  }

  const healthBefore = await bridgeGet("/bridge/health");
  if (healthBefore.schemaVersion !== "RelayCodexAppServerBridgeHealth.v1") {
    throw new Error(`unexpected bridge health schema: ${JSON.stringify(healthBefore)}`);
  }
  if (healthBefore.configured !== true) {
    throw new Error(`fixture app-server should be configured: ${JSON.stringify(healthBefore)}`);
  }

  const badOrigin = await fetch(`${origin}/bridge/sessions?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: "http://evil.invalid",
    },
    body: JSON.stringify({ workArea }),
  });
  if (badOrigin.status !== 403) {
    throw new Error(`bridge session with bad origin should be 403, got ${badOrigin.status}`);
  }

  const session = await bridgePost("/bridge/sessions", { workArea, ephemeral: true });
  if (!session.sessionId?.startsWith("session-") || !session.appServerThreadId?.startsWith("thread-fixture-")) {
    throw new Error(`unexpected bridge session: ${JSON.stringify(session)}`);
  }

  const fetchedSession = await bridgeGet(`/bridge/sessions/${session.sessionId}`);
  if (fetchedSession.sessionId !== session.sessionId) {
    throw new Error(`session lookup mismatch: ${JSON.stringify(fetchedSession)}`);
  }

  const attachmentForm = new FormData();
  attachmentForm.append("files", new Blob(["attached bridge note\n"], { type: "text/plain" }), "note.txt");
  const attachmentResponse = await fetch(`${origin}/bridge/attachments?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "X-Relay-Token": token,
      Origin: origin,
    },
    body: attachmentForm,
  });
  if (!attachmentResponse.ok) {
    throw new Error(`attachment staging failed: ${attachmentResponse.status} ${await attachmentResponse.text()}`);
  }
  const attachmentResult = await attachmentResponse.json();
  const attachmentId = attachmentResult.attachments?.[0]?.attachmentId;
  if (!attachmentId?.startsWith("attachment-")) {
    throw new Error(`unexpected attachment response: ${JSON.stringify(attachmentResult)}`);
  }

  const turn = await bridgePost(`/bridge/sessions/${session.sessionId}/turns`, {
    input: "Create a tiny fixture response",
    workArea,
    attachmentIds: [attachmentId],
  });
  if (!turn.turnId?.startsWith("turn-") || !turn.appServerTurnId?.startsWith("turn-fixture-")) {
    throw new Error(`unexpected bridge turn: ${JSON.stringify(turn)}`);
  }

  const streamText = await readEventStream(turn);
  for (const needle of ["event: turn/started", "event: item/agentMessage/delta", "event: turn/completed"]) {
    if (!streamText.includes(needle)) {
      throw new Error(`event stream missing ${needle}: ${streamText}`);
    }
  }
  if (!streamText.includes(turn.appServerTurnId)) {
    throw new Error(`event stream did not include app-server turn id: ${streamText}`);
  }

  const approvalTurn = await bridgePost(`/bridge/sessions/${session.sessionId}/turns`, {
    input: "fixture-command-approval",
    workArea,
  });
  const approvalStream = await readEventStream(approvalTurn, async (event) => {
    if (event.event !== "approval/requested") return;
    const approvalId = event.payload?.approvalId;
    if (!approvalId) throw new Error(`approval event did not include approvalId: ${JSON.stringify(event)}`);
    const beforeApproval = await bridgeGet(`/bridge/turns/${approvalTurn.turnId}/approvals`);
    if (!Array.isArray(beforeApproval) || beforeApproval.length !== 1) {
      throw new Error(`expected one pending approval: ${JSON.stringify(beforeApproval)}`);
    }
    await bridgePost(`/bridge/approvals/${approvalId}`, { approved: true });
  });
  for (const needle of ["event: item/commandExecution/requestApproval", "event: approval/requested", "event: approval/resolved", "Approval command resolved: accept"]) {
    if (!approvalStream.includes(needle)) {
      throw new Error(`approval stream missing ${needle}: ${approvalStream}`);
    }
  }

  const fileApprovalTurn = await bridgePost(`/bridge/sessions/${session.sessionId}/turns`, {
    input: "fixture-file-approval",
    workArea,
  });
  const fileApprovalStream = await readEventStream(fileApprovalTurn, async (event) => {
    if (event.event !== "approval/requested") return;
    const approvalId = event.payload?.approvalId;
    if (!approvalId) throw new Error(`approval event did not include approvalId: ${JSON.stringify(event)}`);
    await bridgePost(`/bridge/approvals/${approvalId}`, { approved: false });
  });
  for (const needle of ["event: item/fileChange/requestApproval", "event: approval/requested", "event: approval/resolved", "Approval file resolved: decline"]) {
    if (!fileApprovalStream.includes(needle)) {
      throw new Error(`file approval stream missing ${needle}: ${fileApprovalStream}`);
    }
  }

  const dynamicTurn = await bridgePost(`/bridge/sessions/${session.sessionId}/turns`, {
    input: "fixture-dynamic-tool",
    workArea,
  });
  const dynamicStream = await readEventStream(dynamicTurn);
  for (const needle of ["event: item/tool/call", "event: dynamic-tool/rejected", "Dynamic tool rejected"]) {
    if (!dynamicStream.includes(needle)) {
      throw new Error(`dynamic tool rejection stream missing ${needle}: ${dynamicStream}`);
    }
  }
  if (existsSync(join(workArea, "tool-loop-output.txt"))) {
    throw new Error("Relay bridge smoke must not create files through a Relay-owned tool worker.");
  }

  const healthAfter = await bridgeGet("/bridge/health");
  if (healthAfter.ready !== true || healthAfter.state !== "ready") {
    throw new Error(`bridge did not become ready after session: ${JSON.stringify(healthAfter)}`);
  }

  console.log("[app-server-bridge-smoke] ok");
} finally {
  child.kill("SIGTERM");
}

async function waitForStatus() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/status?token=${encodeURIComponent(token)}`, {
        headers: { "X-Relay-Token": token },
      });
      if (response.ok) return response.json();
    } catch {
      // Wait for Kestrel to bind.
    }
    await delay(250);
  }
  throw new Error(`sidecar did not become ready; stdout=${stdout}; stderr=${stderr}`);
}

async function bridgeGet(path) {
  const response = await fetch(`${origin}${path}?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}${readFixtureTrace()}`);
  }
  return response.json();
}

function readFixtureTrace() {
  return existsSync(fixtureTrace) ? `\nfixture trace:\n${readFileSync(fixtureTrace, "utf8")}` : "";
}

async function bridgePost(path, body) {
  const response = await fetch(`${origin}${path}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function readEventStream(turn, onEvent = async () => undefined) {
  const eventResponse = await fetch(`${origin}${turn.eventUrl}?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!eventResponse.ok) {
    throw new Error(`event stream failed: ${eventResponse.status} ${await eventResponse.text()}`);
  }
  if (!eventResponse.body) throw new Error("event stream had no body");

  const reader = eventResponse.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    text += chunk;
    buffer += chunk;
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const parsed = parseSseBlock(block);
      await onEvent(parsed);
    }
  }
  if (buffer.trim()) {
    await onEvent(parseSseBlock(buffer));
  }
  return text;
}

function parseSseBlock(block) {
  const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message";
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  let payload = null;
  try {
    payload = data ? JSON.parse(data) : null;
  } catch {
    payload = data;
  }
  return { event, payload };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
