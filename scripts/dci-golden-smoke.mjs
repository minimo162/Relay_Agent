#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, collectToolCall, collectToolCalls, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

const token = "relay-dci-golden-token";
const port = 17903;
const dataDir = mkdtempSync(join(tmpdir(), "relay-dci-golden-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-dci-golden-workspace-"));

mkdirSync(join(workspace, "companies"), { recursive: true });
mkdirSync(join(workspace, "evidence"), { recursive: true });
mkdirSync(join(workspace, "notes"), { recursive: true });

writeFileSync(
  join(workspace, "companies", "Mパーツ.md"),
  [
    "# Mパーツ",
    "Mパーツは会社名です。このメモは売上対象外の会社プロフィールで、部品売上の根拠ではありません。",
  ].join("\n"),
  "utf8",
);
writeFileSync(
  join(workspace, "evidence", "q4-parts-revenue.md"),
  [
    "# Q4 parts revenue",
    "FY160 4Q の国内補修部品について、部品 売上の確定実績はこの表で確認する。",
    "The local evidence combines parts and sales in the same context.",
  ].join("\n"),
  "utf8",
);
writeFileSync(join(workspace, "notes", "generic-sales.md"), "売上だけの一般メモで部品の話はありません。\n", "utf8");

const responses = [
  JSON.stringify({
    action: "tool",
    tool: "grep",
    args: {
      pattern: "部品|売上|Mパーツ",
      includeGlobs: ["**/*.md"],
      contextLines: 1,
      limit: 20,
    },
  }),
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: "companies/Mパーツ.md", limit: 4000 } }),
  JSON.stringify({
    action: "tool",
    tool: "grep",
    args: {
      allTerms: ["部品", "売上"],
      excludeTerms: ["対象外", "会社名"],
      includeGlobs: ["**/*.md"],
      contextLines: 1,
      limit: 20,
    },
  }),
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: "evidence/q4-parts-revenue.md", limit: 4000 } }),
  JSON.stringify({ action: "final", answer: "部品売上の根拠は evidence/q4-parts-revenue.md です。Mパーツ.md は会社名プロフィールなので候補から外します。" }),
  JSON.stringify({
    action: "tool",
    tool: "grep",
    args: {
      allTerms: ["部品", "売上"],
      includeGlobs: ["**/*.md"],
      limit: 20,
    },
  }),
  JSON.stringify({ action: "final", answer: "根拠ファイル: evidence/q4-parts-revenue.md" }),
  JSON.stringify({ action: "final", answer: "readiness repair inserted read before this final." }),
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
    runId: "dci-golden",
    instruction: "部品売上に関する根拠ファイルを、会社名だけの紛らわしい候補を避けて探して",
  });

  if (!hasRunFinished(run.events)) {
    throw new Error(`DCI golden run did not finish: ${JSON.stringify(run.events)}`);
  }
  const calls = [...collectToolCalls(run.events).values()];
  const names = calls.map((call) => call.name);
  if (names.filter((name) => name === "grep").length < 2) {
    throw new Error(`DCI golden did not refine with multiple grep calls: ${names.join(", ")}`);
  }
  if (names.filter((name) => name === "read").length < 2) {
    throw new Error(`DCI golden did not inspect local context with read calls: ${names.join(", ")}`);
  }

  const final = assistantText(run.events);
  if (!final.includes("evidence/q4-parts-revenue.md")) {
    throw new Error(`final answer did not cite the content-confirmed evidence path: ${final}`);
  }
  if (!final.includes("候補から外")) {
    throw new Error(`final answer did not explain the misleading entity-name decoy: ${final}`);
  }

  const refinedGrep = collectToolCall(run.events, "grep");
  if (!refinedGrep.results.join("\n").includes("RelayGrepObservation.v1")) {
    throw new Error("grep did not return structured DCI observation");
  }

  const prematureFinal = await postAgUi({
    port,
    token,
    workspace,
    runId: "dci-final-readiness",
    instruction: "部品売上の根拠ファイルを探し、根拠を確認して答えて",
  });
  if (!hasRunFinished(prematureFinal.events)) {
    throw new Error(`DCI final readiness run did not finish: ${JSON.stringify(prematureFinal.events)}`);
  }
  const readinessTools = [...collectToolCalls(prematureFinal.events).values()].map((call) => call.name);
  if (readinessTools.join(",") !== "grep,read") {
    throw new Error(`premature final was not replaced with evidence read: ${readinessTools.join(", ")}`);
  }
  if (assistantText(prematureFinal.events) !== "readiness repair inserted read before this final.") {
    throw new Error(`final readiness answer mismatch: ${assistantText(prematureFinal.events)}`);
  }

  console.log("[dci-golden-smoke] ok");
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
