#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, collectToolCalls, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

const token = "relay-dci-invented-read-token";
const port = 17905;
const dataDir = mkdtempSync(join(tmpdir(), "relay-dci-invented-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-dci-invented-workspace-"));
const goldPath = "finance/q4/source-a.md";

mkdirSync(join(workspace, "finance", "q4"), { recursive: true });
writeFileSync(
  join(workspace, goldPath),
  [
    "# FY160 4Q source",
    "FY160 4Q aftermarket sales source. The observed file is the only local evidence.",
  ].join("\n"),
  "utf8",
);

const responses = [
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: "finance/q4/aftermarket-sales-source.md", limit: 4000 } }),
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: goldPath, limit: 4000 } }),
  JSON.stringify({ action: "final", answer: `根拠は ${goldPath} です。` }),
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
    runId: "dci-invented-read",
    instruction: "FY160 4Q の after market sales source をローカルファイルから確認して",
  });
  if (!hasRunFinished(run.events)) {
    throw new Error(`invented-read run did not finish: ${JSON.stringify(run.events)}`);
  }
  const calls = [...collectToolCalls(run.events).values()];
  const names = calls.map((call) => call.name);
  if (names.join(",") !== "read,read") {
    throw new Error(`generic harness should surface failed read and let the model recover: ${names.join(", ")}`);
  }
  if (!calls[0].results.join("\n").includes("file_path does not exist")) {
    throw new Error(`invented read failure was not returned as a tool observation: ${JSON.stringify(calls[0], null, 2)}`);
  }
  if (!calls[1].args.includes(goldPath)) {
    throw new Error(`model recovery did not read the observed exact file: ${JSON.stringify(calls, null, 2)}`);
  }
  if (!assistantText(run.events).includes(goldPath)) {
    throw new Error(`final answer did not cite recovered file: ${assistantText(run.events)}`);
  }

  console.log("[dci-invented-read-smoke] ok");
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
    await sleep(250);
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
