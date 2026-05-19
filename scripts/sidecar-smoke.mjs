#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

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
  RELAY_COPILOT_MOCK_RESPONSE: JSON.stringify({ action: "final", answer: "mock Copilot response from sidecar transport" }),
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
  if (status.ready !== true) throw new Error(`required readiness was not green: ${JSON.stringify(status)}`);
  if (!status.checks.some((check) => check.name === "copilot-cdp" && check.ready === true)) {
    throw new Error(`mock Copilot readiness was not reported: ${JSON.stringify(status)}`);
  }
  const officeCli = status.checks.find((check) => check.name === "officecli");
  if (!officeCli || officeCli.required !== false) {
    throw new Error(`OfficeCLI readiness must be optional: ${JSON.stringify(status)}`);
  }

  const models = await fetch(`http://127.0.0.1:${port}/v1/models?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!models.ok) throw new Error(`models endpoint failed: ${models.status}`);

  const health = await fetch(`http://127.0.0.1:${port}/health?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!health.ok) throw new Error(`health endpoint failed: ${health.status}`);
  const healthJson = await health.json();
  if (healthJson.schemaVersion !== "RelayCoreHealth.v1") {
    throw new Error(`unexpected health contract: ${JSON.stringify(healthJson)}`);
  }

  const session = await fetch(`http://127.0.0.1:${port}/v1/copilot/session?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!session.ok) throw new Error(`copilot session endpoint failed: ${session.status}`);

  const tools = await fetch(`http://127.0.0.1:${port}/v1/tools?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!tools.ok) throw new Error(`tools endpoint failed: ${tools.status}`);

  const completion = await fetch(`http://127.0.0.1:${port}/v1/chat/completions?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": token,
      Origin: `http://127.0.0.1:${port}`,
    },
    body: JSON.stringify({
      model: "m365-copilot",
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (!completion.ok) throw new Error(`completion endpoint failed: ${completion.status}`);
  const completionJson = await completion.json();
  const expected = JSON.stringify({ action: "final", answer: "mock Copilot response from sidecar transport" });
  if (completionJson.choices?.[0]?.message?.content !== expected) {
    throw new Error(`unexpected completion response: ${JSON.stringify(completionJson)}`);
  }

  const agui = await postAgUi({
    port,
    token,
    workspace: process.cwd(),
    runId: "sidecar-smoke-run",
    instruction: "ping",
  });
  if (!hasRunFinished(agui.events)) {
    throw new Error(`official AG-UI stream did not emit run lifecycle events: ${agui.text}`);
  }
  if (assistantText(agui.events) !== "mock Copilot response from sidecar transport") {
    throw new Error(`official AG-UI final text mismatch: ${agui.text}`);
  }

  const manifest = await fetch(`http://127.0.0.1:${port}/v1/relay/manifest?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!manifest.ok) throw new Error(`manifest endpoint failed: ${manifest.status}`);
  const manifestJson = await manifest.json();
  if (manifestJson.schemaVersion !== "RelayHtmlToolManifest.v1") {
    throw new Error(`unexpected manifest contract: ${JSON.stringify(manifestJson)}`);
  }
  if (!manifestJson.endpoints?.some((endpoint) => endpoint.path === "/v1/chat/completions")) {
    throw new Error(`manifest did not advertise chat completions: ${JSON.stringify(manifestJson)}`);
  }

  const preflight = await fetch(`http://127.0.0.1:${port}/v1/chat/completions?token=${encodeURIComponent(token)}`, {
    method: "OPTIONS",
    headers: {
      Origin: "null",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  if (preflight.status !== 204) throw new Error(`HTML tool CORS preflight failed: ${preflight.status}`);
  if (preflight.headers.get("access-control-allow-origin") !== "null") {
    throw new Error(`HTML tool CORS origin was not echoed: ${preflight.headers.get("access-control-allow-origin")}`);
  }

  console.log("[sidecar-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
