#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, collectToolCall, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

const token = "relay-provider-timeout-retry-token";
const port = 17919;
const dataDir = mkdtempSync(join(tmpdir(), "relay-provider-timeout-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-provider-timeout-workspace-"));
writeFileSync(join(workspace, "notes.md"), "provider timeout retry fixture\n", "utf8");

const responses = [
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: "notes.md" } }),
  "__RELAY_MOCK_PROVIDER_TIMEOUT__",
  JSON.stringify({ action: "final", answer: "provider timeout retry recovered" }),
];

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

try {
  await waitForStatus();
  const run = await postAgUi({
    port,
    token,
    workspace,
    runId: "provider-timeout-retry",
    instruction: "notes.md を読んで要約して",
  });
  if (!hasRunFinished(run.events)) {
    throw new Error(`provider timeout retry run did not finish: ${JSON.stringify(run.events)}`);
  }
  collectToolCall(run.events, "read");
  if (assistantText(run.events) !== "provider timeout retry recovered") {
    throw new Error(`unexpected final text after provider timeout retry: ${assistantText(run.events)}`);
  }
  console.log("[provider-timeout-retry-smoke] ok");
} finally {
  child.kill("SIGTERM");
}

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
