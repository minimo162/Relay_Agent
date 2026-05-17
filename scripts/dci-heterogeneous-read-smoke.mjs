#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolCall, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";
import { createAdversarialDciCorpus } from "./lib/dci-corpus-fixtures.mjs";

const token = "relay-dci-read-token";
const port = 17912;
const dataDir = mkdtempSync(join(tmpdir(), "relay-dci-read-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-dci-read-workspace-"));
const corpus = createAdversarialDciCorpus(workspace);
const csvPath = corpus.files.csvGold;

const responses = [
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: csvPath, limit: 12000 } }),
  JSON.stringify({ action: "final", answer: `csv read ok ${csvPath}` }),
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
    runId: "dci-heterogeneous-read",
    instruction: "CSV根拠を読み取って",
  });
  if (!hasRunFinished(run.events)) {
    throw new Error(`run did not finish: ${JSON.stringify(run.events)}`);
  }
  const observation = JSON.parse(collectToolCall(run.events, "read").results.join("\n"));
  const data = observation.data;
  if (data.kind !== "csv" || data.evidenceState !== "exact_text") {
    throw new Error(`CSV read did not expose exact structured text metadata: ${JSON.stringify(data, null, 2)}`);
  }
  if (data.anchors?.[0]?.kind !== "row_range") {
    throw new Error(`CSV read did not expose row anchors: ${JSON.stringify(data.anchors, null, 2)}`);
  }
  if (data.evidenceProjection?.tableLike !== true || !data.textSha256) {
    throw new Error(`CSV read lacked projection/hash metadata: ${JSON.stringify(data, null, 2)}`);
  }
  console.log("[dci-heterogeneous-read-smoke] ok");
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
