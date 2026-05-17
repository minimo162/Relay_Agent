#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, collectToolCalls, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";
import { ensureCopilotCdp } from "./lib/copilot-cdp.mjs";

const token = "relay-live-dci-token";
const port = 17904;
const preferredCopilotCdpPort = Number(process.env.RELAY_LIVE_COPILOT_CDP_PORT ?? process.env.RELAY_COPILOT_CDP_PORT ?? "9360");
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
  join(workspace, "finance", "q4", "source-a.md"),
  [
    "# FY160 4Q source memo",
    "国内サービス部品について、部品 売上の確定実績はこのファイルの集計表に基づく。",
    "補修部品、パーツ売上、parts sales の表現が同じ文脈で出る。",
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
    "部品売上に関する根拠ファイルを探してください。",
    "ファイル名だけでは判断できないので、必ず grep で内容を検索してください。",
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
  const grepEvidencePaths = calls
    .filter((call) => call.name === "grep")
    .flatMap((call) => grepMatchPaths(call));
  if (!grepEvidencePaths.some((path) => path === "finance/q4/source-a.md")) {
    throw new Error(`DCI live run did not grep the separated-term evidence file: ${JSON.stringify(grepEvidencePaths)}`);
  }
  const readTargets = calls
    .filter((call) => call.name === "read")
    .map((call) => readTarget(call))
    .filter(Boolean);
  if (!readTargets.some((target) => target.endsWith("finance/q4/source-a.md"))) {
    throw new Error(`DCI live run did not read the content evidence file: ${JSON.stringify(readTargets)}`);
  }
  const final = assistantText(run.events);
  if (/該当なし|見つかりません|確認できない|確認できません|no match|not found/i.test(final)) {
    throw new Error(`final answer incorrectly reported no evidence: ${final}`);
  }
  if (!/部品/.test(final) || !/売上/.test(final)) {
    throw new Error(`final answer did not address parts sales: ${final}`);
  }
  if (!/source-a|finance\/q4/i.test(final)) {
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

function grepMatchPaths(call) {
  const paths = [];
  for (const result of call.results) {
    try {
      const parsed = JSON.parse(result);
      const matches = parsed?.data?.matches;
      if (Array.isArray(matches)) {
        for (const match of matches) {
          if (typeof match?.displayPath === "string") paths.push(match.displayPath);
        }
      }
    } catch {
      // Ignore non-JSON fragments; malformed tool results are caught elsewhere.
    }
  }
  return paths;
}

function readTarget(call) {
  try {
    const parsed = JSON.parse(call.args || "{}");
    return typeof parsed.file_path === "string" ? parsed.file_path.replaceAll("\\", "/") : "";
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
