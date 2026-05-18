#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "relay-idle-exit-smoke-token";
const port = 17908;
const dataDir = mkdtempSync(join(tmpdir(), "relay-idle-exit-data-"));
const origin = `http://127.0.0.1:${port}`;
const clientId = "idle-exit-smoke-client";
const env = {
  ...process.env,
  RELAY_PORT: String(port),
  RELAY_LAUNCH_TOKEN: token,
  RELAY_DATA_DIR: dataDir,
  RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
  RELAY_ALLOW_MOCK_COPILOT: "1",
  RELAY_COPILOT_MOCK_RESPONSE: JSON.stringify({ action: "final", answer: "idle exit smoke" }),
  RELAY_ENABLE_IDLE_EXIT: "1",
  RELAY_IDLE_EXIT_MS: "1000",
  RELAY_IDLE_STARTUP_GRACE_MS: "300",
  RELAY_IDLE_HEARTBEAT_TTL_MS: "5000",
};

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
let stdout = "";
let exitCode = null;
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.on("exit", (code) => {
  exitCode = code;
});

try {
  await waitForStatus();
  await postSession("/api/session/heartbeat");
  await delay(800);
  if (exitCode !== null) {
    throw new Error(`sidecar exited while a fresh client heartbeat was active; code=${exitCode}; stdout=${stdout}; stderr=${stderr}`);
  }

  await postSession("/api/session/closed");
  await waitForExit(6_000);
  if (exitCode !== 0) {
    throw new Error(`sidecar idle exit returned non-zero code ${exitCode}; stdout=${stdout}; stderr=${stderr}`);
  }

  console.log("[sidecar-idle-exit-smoke] ok");
} finally {
  if (exitCode === null) {
    child.kill("SIGTERM");
  }
}

async function waitForStatus() {
  const url = `${origin}/api/status?token=${encodeURIComponent(token)}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (exitCode !== null) throw new Error(`sidecar exited before readiness; code=${exitCode}; stdout=${stdout}; stderr=${stderr}`);
    try {
      const response = await fetch(url, { headers: { "X-Relay-Token": token } });
      if (response.ok) return response.json();
    } catch {
      // Wait for Kestrel.
    }
    await delay(250);
  }
  throw new Error(`sidecar did not become ready; stdout=${stdout}; stderr=${stderr}`);
}

async function postSession(path) {
  const response = await fetch(`${origin}${path}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: origin,
    },
    body: JSON.stringify({ clientId }),
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function waitForExit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitCode !== null) return;
    await delay(100);
  }
  throw new Error(`sidecar did not exit after client close; stdout=${stdout}; stderr=${stderr}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
