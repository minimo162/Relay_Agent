#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolCall, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

const token = "relay-dci-context-token";
const port = 17902;
const dataDir = mkdtempSync(join(tmpdir(), "relay-dci-context-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-dci-context-workspace-"));
const promptDumpDir = mkdtempSync(join(tmpdir(), "relay-dci-context-prompts-"));
const longText = Array.from({ length: 160 }, (_, index) =>
  `line ${String(index + 1).padStart(3, "0")}: 部品売上 context compaction evidence ${"x".repeat(80)}`,
).join("\n");

writeFileSync(join(workspace, "large.md"), longText, "utf8");

const responses = [
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: "large.md", limit: 12000 } }),
  JSON.stringify({ action: "final", answer: "compacted read context ok" }),
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
    RELAY_COPILOT_PROMPT_DUMP_DIR: promptDumpDir,
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
    runId: "dci-context-compaction",
    instruction: "large.md を読んで要点を確認して",
  });

  if (!hasRunFinished(run.events)) {
    throw new Error(`context compaction run did not finish: ${JSON.stringify(run.events)}`);
  }
  const readResult = JSON.parse(collectToolCall(run.events, "read").results.join("\n"));
  if (readResult.data?.schemaVersion !== "RelayReadObservation.v1") {
    throw new Error(`read did not return structured observation: ${JSON.stringify(readResult)}`);
  }

  const promptTexts = readdirSync(promptDumpDir)
    .filter((name) => name.includes("relay-copilot-prompt-"))
    .map((name) => readFileSync(join(promptDumpDir, name), "utf8"));
  const toolResultPrompt = promptTexts.find((text) => text.includes("RELAY_TOOL_RESULT"));
  if (!toolResultPrompt) {
    throw new Error(`prompt dump did not include a tool-result continuation prompt; files=${readdirSync(promptDumpDir).join(",")}`);
  }
  if (!toolResultPrompt.includes("RelayReadObservation.v1")) {
    throw new Error("tool-result prompt did not preserve the read observation schema");
  }
  if (!toolResultPrompt.includes("relay_compacted")) {
    throw new Error("large read result was not compacted before being sent back to Copilot");
  }
  if (toolResultPrompt.includes("line 160")) {
    throw new Error("tool-result prompt retained the full large file text instead of a compacted projection");
  }

  console.log("[dci-context-compaction-smoke] ok");
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
