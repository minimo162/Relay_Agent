#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, collectToolCalls, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

const token = "relay-live-dci-token";
const port = 17904;
const copilotCdpPort = Number(process.env.RELAY_LIVE_COPILOT_CDP_PORT ?? process.env.RELAY_COPILOT_CDP_PORT ?? "9360");
const dataDir = mkdtempSync(join(tmpdir(), "relay-live-dci-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-live-dci-workspace-"));
const artifactDir = join(process.cwd(), "dist", "e2e", "live-dci");

mkdirSync(artifactDir, { recursive: true });
mkdirSync(join(workspace, "companies"), { recursive: true });
mkdirSync(join(workspace, "finance", "q4"), { recursive: true });
mkdirSync(join(workspace, "notes"), { recursive: true });

writeFileSync(
  join(workspace, "companies", "Mパーツ.md"),
  [
    "# Mパーツ",
    "Mパーツは会社名です。このファイルは会社プロフィールであり、部品売上の根拠ファイルではありません。",
  ].join("\n"),
  "utf8",
);
writeFileSync(
  join(workspace, "finance", "q4", "parts-revenue-evidence.md"),
  [
    "# FY160 4Q 部品売上 evidence",
    "国内サービス部品について、部品 売上の確定実績はこのファイルの集計表に基づく。",
    "補修部品、パーツ売上、parts sales の表現が同じ文脈で出る。",
  ].join("\n"),
  "utf8",
);
writeFileSync(join(workspace, "notes", "generic-sales.md"), "売上高の一般メモ。部品の文脈はありません。\n", "utf8");

const sidecar = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_COPILOT_CDP_PORT: String(copilotCdpPort),
    RELAY_COPILOT_FRESH_TARGET: "1",
    RELAY_COPILOT_REPLY_TIMEOUT_SECONDS: process.env.RELAY_LIVE_DCI_COPILOT_REPLY_TIMEOUT_SECONDS ?? "240",
    RELAY_COPILOT_PROMPT_DUMP_DIR: process.env.RELAY_COPILOT_PROMPT_DUMP_DIR ?? join(artifactDir, "prompts"),
    RELAY_COPILOT_RESPONSE_DUMP_DIR: process.env.RELAY_COPILOT_RESPONSE_DUMP_DIR ?? join(artifactDir, "responses"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let sidecarStderr = "";
sidecar.stderr.on("data", (chunk) => {
  sidecarStderr += chunk.toString();
});

try {
  await assertCopilotCdpAvailable();
  await waitForStatus();
  const instruction = [
    "このローカルワークスペースだけを使ってください。",
    "部品売上に関する根拠ファイルを探してください。",
    "会社名だけが一致する紛らわしい候補は、内容を確認して候補から外してください。",
    "必ず grep と read でローカル根拠を確認し、最後に根拠ファイルと理由を日本語で短く答えてください。",
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
  if (!names.includes("grep") || !names.includes("read")) {
    throw new Error(`DCI live run did not use both grep and read: ${names.join(", ")}`);
  }
  const final = assistantText(run.events);
  if (!/部品/.test(final) || !/売上/.test(final)) {
    throw new Error(`final answer did not address parts sales: ${final}`);
  }
  if (!/parts-revenue-evidence|根拠|finance/i.test(final)) {
    throw new Error(`final answer did not identify the content evidence file: ${final}`);
  }
  const result = { workspace, tools: names, final };
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
  sidecar.kill("SIGTERM");
}

async function assertCopilotCdpAvailable() {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${copilotCdpPort}/json/version`);
  } catch (error) {
    throw new Error(`Copilot Edge CDP is not reachable on ${copilotCdpPort}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`Copilot Edge CDP is not reachable on ${copilotCdpPort}: ${response.status}`);
  const version = await response.json();
  if (!String(version.Browser ?? "").toLowerCase().includes("edg")) {
    throw new Error(`CDP port ${copilotCdpPort} does not look like Microsoft Edge: ${JSON.stringify(version)}`);
  }
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
