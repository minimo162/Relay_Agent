#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolCalls, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";
import { createAdversarialDciCorpus } from "./lib/dci-corpus-fixtures.mjs";

const token = "relay-dci-final-refine-token";
const port = 17913;
const dataDir = mkdtempSync(join(tmpdir(), "relay-dci-final-refine-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-dci-final-refine-workspace-"));
const corpus = createAdversarialDciCorpus(workspace);

const responses = [
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: corpus.files.guide, limit: 12000 } }),
  JSON.stringify({ action: "final", answer: "用語ガイドを確認しました。" }),
  JSON.stringify({ action: "final", answer: "再検索後に候補を確認しました。" }),
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
    runId: "dci-final-refinement",
    instruction: "この曖昧なアフター系の根拠を、用語ガイドだけで終わらず再検索して確認して",
  });
  if (!hasRunFinished(run.events)) {
    throw new Error(`run did not finish: ${JSON.stringify(run.events)}`);
  }
  const calls = [...collectToolCalls(run.events).values()];
  const names = calls.map((call) => call.name);
  if (names.join(",") !== "read") {
    throw new Error(`generic harness should not inject hidden grep refinement: ${names.join(",")}`);
  }
  console.log("[dci-final-refinement-smoke] ok");
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
