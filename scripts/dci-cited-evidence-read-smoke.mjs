#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolCalls, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";
import { createAdversarialDciCorpus } from "./lib/dci-corpus-fixtures.mjs";

const token = "relay-dci-cited-read-token";
const port = 17915;
const dataDir = mkdtempSync(join(tmpdir(), "relay-dci-cited-read-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-dci-cited-read-workspace-"));
const corpus = createAdversarialDciCorpus(workspace);

const responses = [
  JSON.stringify({
    action: "tool",
    tool: "grep",
    args: {
      allTerms: ["サービス部品", "売上", "4Q"],
      anyTerms: ["補修部品", "パーツ事業"],
      limit: 20,
    },
  }),
  JSON.stringify({ action: "final", answer: `根拠は ${corpus.files.gold} です。` }),
  JSON.stringify({ action: "final", answer: `根拠は ${corpus.files.gold} です。` }),
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
    runId: "dci-cited-evidence-read",
    instruction: "grepで見つけた根拠ファイルを最終回答前にreadして確認して",
  });
  if (!hasRunFinished(run.events)) {
    throw new Error(`run did not finish: ${JSON.stringify(run.events)}`);
  }
  const calls = [...collectToolCalls(run.events).values()];
  const names = calls.map((call) => call.name);
  if (names.join(",") !== "grep,read") {
    throw new Error(`final guard did not force cited evidence read before final: ${names.join(",")}`);
  }
  const readCall = calls.find((call) => call.name === "read");
  if (!readCall?.args.includes(corpus.files.gold)) {
    throw new Error(`forced evidence read targeted the wrong file: ${JSON.stringify(calls, null, 2)}`);
  }
  console.log("[dci-cited-evidence-read-smoke] ok");
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
