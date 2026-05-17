#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolCalls, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";
import { createAdversarialDciCorpus } from "./lib/dci-corpus-fixtures.mjs";

const token = "relay-dci-guide-scope-token";
const port = 17914;
const dataDir = mkdtempSync(join(tmpdir(), "relay-dci-guide-scope-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-dci-guide-scope-workspace-"));
const corpus = createAdversarialDciCorpus(workspace);

const responses = [
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: corpus.files.guide, limit: 12000 } }),
  JSON.stringify({
    action: "tool",
    tool: "grep",
    args: {
      path: "notes",
      allTerms: ["サービス部品", "実績"],
      anyTerms: ["補修部品", "パーツ事業", "4Q"],
      limit: 20,
    },
  }),
  JSON.stringify({ action: "final", answer: "workspace-wide grep after guide ok" }),
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
    runId: "dci-guide-scoped-grep",
    instruction: "用語ガイドを読んだ後は、同じフォルダだけに絞らず根拠を再検索して",
  });
  if (!hasRunFinished(run.events)) {
    throw new Error(`run did not finish: ${JSON.stringify(run.events)}`);
  }
  const calls = [...collectToolCalls(run.events).values()];
  const grepCall = calls.find((call) => call.name === "grep");
  if (!grepCall) throw new Error(`grep call missing: ${JSON.stringify(calls)}`);
  const grepArgs = JSON.parse(grepCall.args);
  if ("path" in grepArgs) {
    throw new Error(`guide-scoped grep was not widened to workspace scope: ${JSON.stringify(grepArgs)}`);
  }
  const observation = JSON.parse(grepCall.results.join("\n"));
  const paths = observation.data.matches.map((match) => match.displayPath);
  if (!paths.includes(corpus.files.gold)) {
    throw new Error(`widened grep did not surface gold evidence: ${JSON.stringify(paths)}`);
  }
  console.log("[dci-guide-scoped-grep-smoke] ok");
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
