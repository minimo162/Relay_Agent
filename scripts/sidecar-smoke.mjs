#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "relay-smoke-token";
const port = 17891;
const dataDir = mkdtempSync(join(tmpdir(), "relay-sidecar-smoke-"));
const env = {
  ...process.env,
  RELAY_PORT: String(port),
  RELAY_LAUNCH_TOKEN: token,
  RELAY_DATA_DIR: dataDir,
  RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
  RELAY_ALLOW_MOCK_COPILOT: "1",
  RELAY_COPILOT_MOCK_RESPONSE: "mock Copilot response from sidecar transport",
};

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function waitForStatus() {
  const url = `http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "X-Relay-Token": token } });
      if (response.ok) return response.json();
    } catch {
      // Wait for Kestrel to bind.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

try {
  const status = await waitForStatus();
  if (status.app !== "Relay Agent") throw new Error(`unexpected status app: ${status.app}`);
  if (!status.checks.some((check) => check.name === "copilot-cdp" && check.ready === true)) {
    throw new Error(`mock Copilot readiness was not reported: ${JSON.stringify(status)}`);
  }

  const models = await fetch(`http://127.0.0.1:${port}/v1/models?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!models.ok) throw new Error(`models endpoint failed: ${models.status}`);

  const completion = await fetch(`http://127.0.0.1:${port}/v1/chat/completions?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      "Origin": `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({
      model: "m365-copilot",
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (!completion.ok) throw new Error(`completion endpoint failed: ${completion.status}`);
  const completionJson = await completion.json();
  if (completionJson.choices?.[0]?.message?.content !== "mock Copilot response from sidecar transport") {
    throw new Error(`unexpected completion response: ${JSON.stringify(completionJson)}`);
  }

  const run = await fetch(`http://127.0.0.1:${port}/api/runs?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      "Origin": `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({
      instruction: "部品売上に関するファイルを探して",
      workspace: process.cwd(),
    }),
  });
  if (!run.ok) throw new Error(`run endpoint failed: ${run.status}`);
  const runJson = await run.json();
  if (!runJson.runId || !Array.isArray(runJson.events)) {
    throw new Error(`unexpected run response: ${JSON.stringify(runJson)}`);
  }
  if (runJson.status !== "completed") {
    throw new Error(`run did not complete through mock Copilot transport: ${JSON.stringify(runJson)}`);
  }
  console.log("[sidecar-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
