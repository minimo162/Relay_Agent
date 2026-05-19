#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rid = process.platform === "win32" ? "win-x64" : process.platform === "linux" ? "linux-x64" : null;
if (!rid) {
  console.log("[app-server-real-provider-smoke] skipped: unsupported platform");
  process.exit(0);
}

const executableName = process.platform === "win32" ? "codex.exe" : "codex";
const executable = join(root, "tools/codex-app-server", rid, executableName);
if (!existsSync(executable)) {
  const fetchScript = rid === "win-x64" ? "appserver:fetch:windows" : "appserver:fetch:linux";
  const result = spawnSync("pnpm", [fetchScript], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${fetchScript} failed with ${result.status}`);
  }
}
if (!existsSync(executable)) {
  throw new Error(`Codex app-server executable was not materialized: ${executable}`);
}

const token = "relay-real-app-server-smoke-token";
const port = 17934;
const origin = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), "relay-real-app-server-smoke-"));
const workArea = mkdtempSync(join(tmpdir(), "relay-real-app-server-work-"));
writeFileSync(join(workArea, "note.txt"), "hello from bundled app server\n", "utf8");

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: root,
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(root, "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSES_JSON: JSON.stringify([
      `${JSON.stringify({ content: "bundled app-server text turn complete" })}\n次の作業を教えて`,
      `${JSON.stringify({ tool_calls: [{ name: "exec_command", arguments: { cmd: "cat note.txt", workdir: workArea, max_output_tokens: 2000 } }] })}\nこの環境でできることは？`,
      `${JSON.stringify({ content: "bundled app-server tool turn complete" })}\nテストを実行して`,
    ]),
    RELAY_APP_SERVER_COMMAND: executable,
    RELAY_APP_SERVER_ARGS_JSON: JSON.stringify(["app-server"]),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForStatus();

  const session = await bridgePost("/bridge/sessions", { workArea, ephemeral: true });
  assert(session.sessionId?.startsWith("session-"), `unexpected session: ${JSON.stringify(session)}`);
  assert(session.appServerThreadId, `session did not include app-server thread id: ${JSON.stringify(session)}`);

  const textTurn = await bridgePost(`/bridge/sessions/${session.sessionId}/turns`, {
    input: "Answer with a short confirmation.",
    workArea,
  });
  const textStream = await readEventStream(textTurn);
  assert(textStream.includes("bundled app-server text turn complete"), `text turn did not stream assistant output: ${textStream}`);
  assert(textStream.includes("event: turn/completed"), `text turn did not complete: ${textStream}`);

  const toolTurn = await bridgePost(`/bridge/sessions/${session.sessionId}/turns`, {
    input: "Read note.txt and answer briefly.",
    workArea,
  });
  const toolStream = await readEventStream(toolTurn);
  assert(toolStream.includes("event: item/started"), `tool turn did not start items: ${toolStream}`);
  assert(toolStream.includes("commandExecution"), `tool turn did not use app-server native command execution: ${toolStream}`);
  assert(toolStream.includes("hello from bundled app server"), `tool turn did not expose command output: ${toolStream}`);
  assert(toolStream.includes("event: turn/completed"), `tool turn did not complete: ${toolStream}`);

  console.log("[app-server-real-provider-smoke] ok");
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
    throw new Error(`${path} failed: ${response.status} ${await response.text()}\nstdout=${stdout}\nstderr=${stderr}`);
  }
  return response.json();
}

async function readEventStream(turn) {
  const response = await fetch(`${origin}${turn.eventUrl}?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!response.ok) {
    throw new Error(`event stream failed: ${response.status} ${await response.text()}`);
  }
  if (!response.body) {
    throw new Error("event stream had no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.includes("event: turn/completed") || text.includes("event: turn/failed") || text.includes("event: turn/cancelled")) {
      break;
    }
  }
  return text;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
