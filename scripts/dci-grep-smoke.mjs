#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolCall, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

const token = "relay-dci-grep-token";
const port = 17901;
const dataDir = mkdtempSync(join(tmpdir(), "relay-dci-grep-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-dci-grep-workspace-"));

mkdirSync(join(workspace, "evidence"), { recursive: true });
mkdirSync(join(workspace, "decoy"), { recursive: true });
mkdirSync(join(workspace, "other"), { recursive: true });

writeFileSync(
  join(workspace, "evidence", "parts-revenue.md"),
  [
    "# FY160 Q4 memo",
    "国内向けの部品 売上はサービス部品と補修部品の実績データで確認する。",
    "The parts sales evidence lives here.",
  ].join("\n"),
  "utf8",
);
writeFileSync(
  join(workspace, "decoy", "Mパーツ.md"),
  [
    "# Mパーツ",
    "会社名としてのパーツ情報であり、売上対象外のプロフィールです。",
  ].join("\n"),
  "utf8",
);
writeFileSync(join(workspace, "other", "generic-sales.md"), "売上だけを含む一般メモです。\n", "utf8");
writeFileSync(join(workspace, "other", "literal.txt"), "CLI option looking token: -literal\n", "utf8");

const responses = [
  JSON.stringify({
    action: "tool",
    tool: "grep",
    args: {
      allTerms: ["部品", "売上"],
      excludeTerms: ["対象外"],
      includeGlobs: ["**/*.md"],
      contextLines: 1,
      maxMatchesPerFile: 3,
      limit: 10,
    },
  }),
  JSON.stringify({ action: "final", answer: "conjunctive grep ok" }),
  JSON.stringify({
    action: "tool",
    tool: "grep",
    args: {
      pattern: "-literal",
      fixedStrings: true,
      includeGlobs: ["**/*.txt"],
      limit: 5,
    },
  }),
  JSON.stringify({ action: "final", answer: "dash pattern grep ok" }),
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

  const conjunctive = await postAgUi({
    port,
    token,
    workspace,
    runId: "dci-conjunctive-grep",
    instruction: "部品売上の根拠を検索して",
  });
  if (!hasRunFinished(conjunctive.events)) {
    throw new Error(`conjunctive run did not finish: ${JSON.stringify(conjunctive.events)}`);
  }
  const conjunctiveResult = parseToolObservation(collectToolCall(conjunctive.events, "grep"));
  const conjunctiveData = conjunctiveResult.data;
  if (conjunctiveData.schemaVersion !== "RelayGrepObservation.v1") {
    throw new Error(`unexpected grep schema: ${JSON.stringify(conjunctiveData)}`);
  }
  if (!conjunctiveData.matches?.length) {
    throw new Error(`conjunctive grep returned no matches: ${JSON.stringify(conjunctiveData)}`);
  }
  const paths = conjunctiveData.matches.map((match) => match.displayPath);
  if (!paths.includes("evidence/parts-revenue.md")) {
    throw new Error(`conjunctive grep missed evidence file: ${JSON.stringify(paths)}`);
  }
  if (paths.some((path) => String(path).includes("Mパーツ") || String(path).includes("generic-sales"))) {
    throw new Error(`conjunctive grep promoted decoy/generic matches: ${JSON.stringify(paths)}`);
  }
  const evidenceMatch = conjunctiveData.matches.find((match) => match.displayPath === "evidence/parts-revenue.md");
  if (evidenceMatch.evidenceState !== "conjunctive_content_match") {
    throw new Error(`evidence match was not conjunctive: ${JSON.stringify(evidenceMatch)}`);
  }
  for (const term of ["部品", "売上"]) {
    if (!evidenceMatch.matchedTerms?.includes(term)) {
      throw new Error(`evidence match did not record term ${term}: ${JSON.stringify(evidenceMatch)}`);
    }
  }

  const dashPattern = await postAgUi({
    port,
    token,
    workspace,
    runId: "dci-dash-pattern-grep",
    instruction: "-literal を検索して",
  });
  if (!hasRunFinished(dashPattern.events)) {
    throw new Error(`dash-pattern run did not finish: ${JSON.stringify(dashPattern.events)}`);
  }
  const dashResult = parseToolObservation(collectToolCall(dashPattern.events, "grep"));
  const dashPaths = dashResult.data.matches.map((match) => match.displayPath);
  if (!dashPaths.includes("other/literal.txt")) {
    throw new Error(`dash-leading pattern did not match expected file: ${JSON.stringify(dashResult.data)}`);
  }

  console.log("[dci-grep-smoke] ok");
} finally {
  child.kill("SIGTERM");
}

function parseToolObservation(toolCall) {
  const content = toolCall.results.join("\n");
  const parsed = JSON.parse(content);
  if (parsed.success !== true) {
    throw new Error(`tool call failed: ${content}`);
  }
  return parsed;
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
