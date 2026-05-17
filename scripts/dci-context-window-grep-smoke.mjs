#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolCall, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";
import { createAdversarialDciCorpus } from "./lib/dci-corpus-fixtures.mjs";

const token = "relay-dci-window-token";
const port = 17911;
const dataDir = mkdtempSync(join(tmpdir(), "relay-dci-window-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-dci-window-workspace-"));
createAdversarialDciCorpus(workspace);

const responses = [
  JSON.stringify({
    action: "tool",
    tool: "grep",
    args: {
      allTerms: ["サービス部品", "売上実績"],
      includeGlobs: ["**/*.md"],
      contextLines: 2,
      contextWindowLines: 2,
      limit: 10,
    },
  }),
  JSON.stringify({ action: "final", answer: "context window grep ok" }),
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
    runId: "dci-context-window-grep",
    instruction: "サービス部品の売上実績を文脈窓で確認して",
  });
  if (!hasRunFinished(run.events)) {
    throw new Error(`run did not finish: ${JSON.stringify(run.events)}`);
  }
  const observation = JSON.parse(collectToolCall(run.events, "grep").results.join("\n"));
  const match = observation.data.matches.find((item) => item.displayPath === "finance/q4/context-window.md");
  if (!match) {
    throw new Error(`context-window evidence was not surfaced: ${JSON.stringify(observation.data, null, 2)}`);
  }
  if (match.scope !== "context_window" || match.evidenceState !== "context_window_conjunctive_match") {
    throw new Error(`match did not preserve context-window evidence: ${JSON.stringify(match, null, 2)}`);
  }
  if (match.startLine >= match.endLine) {
    throw new Error(`context-window match did not include a line range: ${JSON.stringify(match, null, 2)}`);
  }
  console.log("[dci-context-window-grep-smoke] ok");
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
