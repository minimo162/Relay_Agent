#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, collectToolCalls, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";
import { ensureCopilotCdp } from "./lib/copilot-cdp.mjs";
import { computeDciMetrics } from "./lib/dci-metrics.mjs";
import { buildDciTrajectory } from "./lib/dci-trajectory.mjs";

const token = "relay-live-dci-token";
const port = 17904;
const preferredCopilotCdpPort = Number(process.env.RELAY_LIVE_COPILOT_CDP_PORT ?? process.env.RELAY_COPILOT_CDP_PORT ?? "9360");
const dataDir = mkdtempSync(join(tmpdir(), "relay-live-dci-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-live-dci-workspace-"));
const artifactDir = join(process.cwd(), "dist", "e2e", "live-dci");
const goldPath = "finance/q4/source-a.md";
const hardNegativePaths = [
  "archive/fy159/aftermarket-reference.md",
  "companies/Mパーツ.md",
  "notes/generic-sales.md",
  "notes/aftermarket-glossary.md",
];

mkdirSync(artifactDir, { recursive: true });
mkdirSync(join(workspace, "archive", "fy159"), { recursive: true });
mkdirSync(join(workspace, "companies"), { recursive: true });
mkdirSync(join(workspace, "finance", "q4"), { recursive: true });
mkdirSync(join(workspace, "notes"), { recursive: true });

writeFileSync(
  join(workspace, "companies", "Mパーツ.md"),
  [
    "# Mパーツ",
    "Mパーツは会社名です。このファイルは会社プロフィールであり、アフター系の売上根拠ファイルではありません。",
    "会社名にパーツを含むだけなので、数値根拠としては除外します。",
  ].join("\n"),
  "utf8",
);
writeFileSync(
  join(workspace, "archive", "fy159", "aftermarket-reference.md"),
  [
    "# FY159 reference",
    "過年度のアフター系メモ。補修部品の売上を説明するが、FY159の参考資料であり今期4Qの根拠ではありません。",
  ].join("\n"),
  "utf8",
);
writeFileSync(
  join(workspace, "notes", "aftermarket-glossary.md"),
  [
    "# 用語ガイド",
    "今期4Qのアフター系の根拠を探すときは、サービス部品、補修部品、パーツ事業の実績という言い換えで再検索します。",
    "このガイド自体は根拠資料ではありません。会社名としてのMパーツと、売上根拠としてのサービス部品実績は区別してください。",
  ].join("\n"),
  "utf8",
);
writeFileSync(
  join(workspace, "finance", "q4", "source-a.md"),
  [
    "# FY160 4Q source memo",
    "アフター系の確定根拠: FY160 4Q 国内サービス部品、補修部品、パーツ事業の売上実績はこのファイルの集計表に基づく。",
    "確定版として、parts sales と service parts revenue の根拠行を保持する。",
  ].join("\n"),
  "utf8",
);
writeFileSync(join(workspace, "notes", "generic-sales.md"), "売上高の一般メモ。部品の文脈はありません。\n", "utf8");

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
    "何の言い換えか曖昧な場合は、候補文書の中身から用語を拾って再検索してください。",
    "用語ガイドだけで終わらず、そこに書かれた言い換えで必ず再検索してください。",
    "会社名だけが一致する候補、古い参考資料、一般的な売上メモは内容を確認して外してください。",
    "今期4Qの根拠ファイルを、grep と read で確認してから日本語で短く答えてください。",
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
