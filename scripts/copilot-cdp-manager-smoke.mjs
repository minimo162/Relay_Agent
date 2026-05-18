#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = "relay-cdp-manager-smoke-token";
const port = 17896;
const dataDir = mkdtempSync(join(tmpdir(), "relay-cdp-manager-smoke-"));
const env = {
  ...process.env,
  RELAY_PORT: String(port),
  RELAY_LAUNCH_TOKEN: token,
  RELAY_DATA_DIR: dataDir,
  RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
  RELAY_DISABLE_COPILOT_AUTO_START: "1",
  RELAY_COPILOT_CDP_PORT: "",
  RELAY_ALLOW_MOCK_COPILOT: "",
  RELAY_COPILOT_MOCK_RESPONSE: "",
  RELAY_COPILOT_MOCK_RESPONSES_JSON: "",
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

try {
  const status = await waitForStatus();
  const copilot = status.checks.find((check) => check.name === "copilot-cdp");
  if (!copilot) throw new Error(`missing copilot-cdp readiness: ${JSON.stringify(status)}`);
  if (copilot.detail.includes("RELAY_COPILOT_CDP_PORT")) {
    throw new Error(`installed readiness leaked developer env-var guidance: ${JSON.stringify(copilot)}`);
  }
  if (copilot.state !== "connecting") {
    throw new Error(`expected managed connecting state with auto-start disabled: ${JSON.stringify(copilot)}`);
  }
  console.log("[copilot-cdp-manager-smoke] ok");
} finally {
  child.kill("SIGTERM");
}

async function waitForStatus() {
  const url = `http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "X-Relay-Token": token } });
      if (response.ok) return await response.json();
    } catch {
      // Wait for Kestrel.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}
