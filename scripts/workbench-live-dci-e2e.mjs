#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, collectToolCalls, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";
import { ensureCopilotCdp } from "./lib/copilot-cdp.mjs";
import { computeDciMetrics } from "./lib/dci-metrics.mjs";
import { buildDciTrajectory } from "./lib/dci-trajectory.mjs";
import { createAdversarialDciCorpus } from "./lib/dci-corpus-fixtures.mjs";

const token = "relay-live-dci-token";
const port = 17904;
const preferredCopilotCdpPort = Number(process.env.RELAY_LIVE_COPILOT_CDP_PORT ?? process.env.RELAY_COPILOT_CDP_PORT ?? "9360");
const dataDir = mkdtempSync(join(tmpdir(), "relay-live-dci-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-live-dci-workspace-"));
const artifactDir = join(process.cwd(), "dist", "e2e", "live-dci");
const corpus = createAdversarialDciCorpus(workspace);
const goldPath = corpus.files.gold;
const hardNegativePaths = corpus.hardNegativePaths;

mkdirSync(artifactDir, { recursive: true });
let copilotCdp;
let sidecar;
let sidecarStderr = "";

try {
  copilotCdp = await ensureCopilotCdp({
    preferredPort: preferredCopilotCdpPort,
    artifactDir,
  });

  sidecar = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RELAY_PORT: String(port),
      RELAY_LAUNCH_TOKEN: token,
      RELAY_DATA_DIR: dataDir,
      RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
      RELAY_COPILOT_CDP_PORT: String(copilotCdp.port),
      RELAY_COPILOT_FRESH_TARGET: "1",
      RELAY_COPILOT_REPLY_TIMEOUT_SECONDS: process.env.RELAY_LIVE_DCI_COPILOT_REPLY_TIMEOUT_SECONDS ?? "240",
      RELAY_COPILOT_PROMPT_DUMP_DIR: process.env.RELAY_COPILOT_PROMPT_DUMP_DIR ?? join(artifactDir, "prompts"),
      RELAY_COPILOT_RESPONSE_DUMP_DIR: process.env.RELAY_COPILOT_RESPONSE_DUMP_DIR ?? join(artifactDir, "responses"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  sidecar.stderr.on("data", (chunk) => {
    sidecarStderr += chunk.toString();
  });

  await waitForStatus();
  const instruction = [
    "このローカルワークスペースだけを使ってください。",
    "この前話していたアフター系の数字の根拠ファイルを探してください。",
    "まず notes/aftermarket-glossary.md を read して、言い換え候補を確認してください。",
    "何の言い換えか曖昧な場合は、候補文書の中身から用語を拾って再検索してください。",
    "用語ガイドだけで終わらず、そこに書かれた言い換えで必ず再検索してください。",
    "会社名や過年度などの紛らわしい候補を少なくとも1件 read し、根拠ではないことを確認して除外してください。",
    "会社名だけが一致する候補、古い参考資料、一般的な売上メモは内容を確認して外してください。",
    "grepで根拠候補を見つけたら、最終回答の直前にその候補ファイルを必ずreadしてください。",
    "今期4Qの根拠ファイルを、grep と根拠ファイル自身のreadで確認してから日本語で短く答えてください。",
  ].join("\n");
  const run = await postAgUi({
    port,
    token,
    workspace,
    runId: "live-dci",
    instruction,
  });
  writeFileSync(join(artifactDir, "agui-events.json"), `${JSON.stringify(run.events, null, 2)}\n`, "utf8");

  if (!hasRunFinished(run.events)) {
    throw new Error(`run did not finish: ${JSON.stringify(run.events)}`);
  }
  const calls = [...collectToolCalls(run.events).values()];
  const names = calls.map((call) => call.name);
  const final = assistantText(run.events);
  const dciTrajectory = buildDciTrajectory(calls, final);
  writeFileSync(join(artifactDir, "dci-trajectory.json"), `${JSON.stringify(dciTrajectory, null, 2)}\n`, "utf8");
  const dciMetrics = computeDciMetrics(calls, final, {
    goldPath,
    hardNegativePaths,
    evidencePattern: /売上実績|parts sales|service parts revenue/,
  });
  writeFileSync(join(artifactDir, "dci-metrics.json"), `${JSON.stringify(dciMetrics, null, 2)}\n`, "utf8");
  if (!names.includes("grep") || !names.includes("read")) {
    throw new Error(`DCI live run did not use both grep and read: ${names.join(", ")}`);
  }
  if (!dciMetrics.noRetrieverTools) {
    throw new Error(`DCI live run used tools outside the raw-corpus DCI set: ${names.join(", ")}`);
  }
  if (!dciMetrics.noFailedTools) {
    throw new Error("DCI live run had failed tool observations.");
  }
  if (!dciMetrics.noInventedReadTargets) {
    throw new Error(`DCI live run attempted an invented read target: ${JSON.stringify(dciMetrics.readTargets)}`);
  }
  if (!dciMetrics.weakClueConjunction) {
    throw new Error(`DCI live run did not combine weak clues in grep args: ${JSON.stringify(dciMetrics.grepArgs)}`);
  }
  if (!dciMetrics.queryExpansionFromAmbiguity) {
    throw new Error(`DCI live run did not expand the ambiguous user phrase into domain terms: ${JSON.stringify(dciMetrics.grepArgs)}`);
  }
  if (!dciMetrics.observationToNextActionDependency) {
    throw new Error(`DCI live run did not show observation-driven refinement: ${JSON.stringify(dciMetrics, null, 2)}`);
  }
  if (dciMetrics.hardNegativeReadCount < 1 || dciMetrics.candidateRejectionCount < 1) {
    throw new Error(`DCI live run did not inspect and reject a hard negative: ${JSON.stringify(dciMetrics, null, 2)}`);
  }
  if (!dciMetrics.coverageAny) {
    throw new Error(`DCI live run did not surface the gold document in grep observations: ${JSON.stringify(dciMetrics.grepMatchPaths)}`);
  }
  if (!dciMetrics.localizationExactRead || !dciMetrics.evidenceSpanLocalized) {
    throw new Error(`DCI live run did not localize evidence by exact read: ${JSON.stringify(dciMetrics.readTargets)}`);
  }
  if (/該当なし|見つかりません|確認できない|確認できません|no match|not found/i.test(final)) {
    throw new Error(`final answer incorrectly reported no evidence: ${final}`);
  }
  if (!dciMetrics.hardNegativeRejected) {
    throw new Error(`final answer cited a hard negative as evidence: ${final}`);
  }
  if (!/部品/.test(final) || !/売上/.test(final)) {
    throw new Error(`final answer did not resolve the ambiguous aftermarket request into parts sales: ${final}`);
  }
  if (!/source-a|finance\/q4/i.test(final)) {
    throw new Error(`final answer did not identify the content evidence file: ${final}`);
  }
  const result = { workspace, tools: names, dciTrajectory, dciMetrics, final };
  writeFileSync(join(artifactDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`[workbench-live-dci-e2e] ok workspace=${workspace}`);
} catch (error) {
  const classification = classifyLiveDciFailure(error);
  const message = error instanceof Error ? error.message : String(error);
  writeFileSync(join(artifactDir, "sidecar-stderr.txt"), sidecarStderr, "utf8");
  writeFileSync(join(artifactDir, "workspace.txt"), `${workspace}\n`, "utf8");
  writeFileSync(join(artifactDir, "failure.json"), `${JSON.stringify({ classification, message }, null, 2)}\n`, "utf8");
  throw new Error(`[workbench-live-dci-e2e:${classification}] ${message}`);
} finally {
  sidecar?.kill("SIGTERM");
  copilotCdp?.cleanup();
}

async function waitForStatus() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`, {
        headers: { "X-Relay-Token": token },
      });
      if (response.ok) {
        const status = await response.json();
        const copilot = status.checks?.find((check) => check.name === "copilot-cdp");
        if (!copilot?.ready) throw new Error(`Copilot readiness failed: ${JSON.stringify(status)}`);
        return;
      }
    } catch (error) {
      if (attempt > 20 && error instanceof Error && error.message.includes("Copilot readiness failed")) throw error;
    }
    await sleep(250);
  }
  throw new Error(`sidecar did not become ready; stderr=${sidecarStderr}`);
}

function classifyLiveDciFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/CDP is not reachable|does not look like Microsoft Edge|Copilot readiness failed|fetch failed|ECONNREFUSED/i.test(message)) return "environment";
  if (/quota|rate limit|request limit|number of requests per hour|上限/i.test(message)) return "copilot_quota";
  if (/provider_response_timeout|Timed out waiting for Copilot response/i.test(message)) return "provider_response_timeout";
  if (/Prompt did not reach|composer|visible length|input|send/i.test(message)) return "prompt_delivery";
  if (/invalid JSON|schema|tool projection|expected JSON/i.test(message)) return "schema_validation";
  if (/grep|read|ripgrep|workspace|tool/i.test(message)) return "tool_contract";
  return "unknown";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
