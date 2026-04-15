#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const artifactsDir = mkdtempSync(join(tmpdir(), "relay-live-m365-smoke-"));
const tauriLogPath = join(artifactsDir, "tauri-dev.log");
const xvfbLogPath = join(artifactsDir, "xvfb.log");
const edgeLogPath = join(artifactsDir, "edge-start.log");
const doctorStdoutPath = join(artifactsDir, "doctor.stdout.log");
const doctorStderrPath = join(artifactsDir, "doctor.stderr.log");
const finalStatePath = join(artifactsDir, "final-state.json");
const reportPath = join(artifactsDir, "report.json");
const appLocalDataDir = join(artifactsDir, "app-local-data");

const cdpPort = 9360;
const devControlPort = Number.parseInt(process.env.RELAY_DEV_APP_CONTROL_PORT ?? "18411", 10);
const workspacePath = "/root/Relay_Agent";
const outputPath = join(workspacePath, "relay_live_m365_smoke.txt");
const prompt =
  'README.md を読み、冒頭説明の最初の文を使って /root/Relay_Agent/relay_live_m365_smoke.txt を作成してください。内容は 2 行だけにし、1 行目は "source: README.md"、2 行目は "summary: <最初の文>"。他のファイルは変更しないでください。';

let tauriChild = null;
let xvfbChild = null;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function extractFirstSentenceFromReadme() {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const firstSentenceSource = readme
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  if (!firstSentenceSource) {
    throw new Error("README.md has no non-heading content.");
  }
  const match = firstSentenceSource.match(/^(.*?\.)($|\s)/u);
  return (match ? match[1] : firstSentenceSource).trim();
}

function latestSession(state) {
  if (!state || !Array.isArray(state.sessions) || state.sessions.length === 0) return null;
  if (state.latestSessionId) {
    return state.sessions.find((session) => session.sessionId === state.latestSessionId) ?? state.sessions[0];
  }
  return state.sessions[0];
}

function sessionById(state, sessionId) {
  if (!state || !Array.isArray(state.sessions)) return null;
  return state.sessions.find((session) => session.sessionId === sessionId) ?? null;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let json = null;
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Expected JSON from ${url}: ${error instanceof Error ? error.message : String(error)}\n${raw}`);
    }
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${raw}`);
  }
  return json;
}

async function waitForDevControl(timeoutMs) {
  const startedAt = Date.now();
  const url = `http://127.0.0.1:${devControlPort}/health`;
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error(`Timed out waiting for dev control: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function postDevControl(path, body) {
  const url = `http://127.0.0.1:${devControlPort}${path}`;
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getState() {
  return fetchJson(`http://127.0.0.1:${devControlPort}/state`);
}

async function pollState(label, timeoutMs, predicate) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await getState();
    writeJson(join(artifactsDir, `${label}.json`), lastState);
    const result = predicate(lastState);
    if (result?.fatal) {
      throw new Error(result.fatal);
    }
    if (result?.done) {
      return lastState;
    }
    await sleep(1500);
  }
  if (lastState) {
    writeJson(finalStatePath, lastState);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function runDoctor(displayValue) {
  const env = { ...process.env };
  if (displayValue) env.DISPLAY = displayValue;
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "--bin",
      "relay-agent-doctor",
      "--",
      "--json",
      "--cdp-port",
      String(cdpPort),
    ],
    {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  writeFileSync(doctorStdoutPath, result.stdout ?? "", "utf8");
  writeFileSync(doctorStderrPath, result.stderr ?? "", "utf8");
  const stdout = (result.stdout ?? "").trim();
  if (!stdout) {
    throw new Error("doctor produced no JSON output");
  }
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("doctor output did not contain JSON");
  }
  const doctor = JSON.parse(stdout.slice(jsonStart));
  return {
    exitCode: result.status ?? 1,
    report: doctor,
  };
}

function doctorPassesLiveGate(report) {
  const checks = new Map((report?.checks ?? []).map((check) => [check.id, check]));
  return (
    checks.get("edge_cdp")?.status === "ok" &&
    checks.get("bridge_health")?.status === "ok" &&
    checks.get("bridge_status")?.status === "ok" &&
    checks.get("m365_sign_in")?.status === "ok"
  );
}

async function ensureVirtualDisplay() {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    return process.env.DISPLAY ?? null;
  }
  const displayValue = ":99";
  const logStream = createWriteStream(xvfbLogPath, { flags: "a" });
  xvfbChild = spawn("Xvfb", [displayValue, "-screen", "0", "1440x900x24", "-nolisten", "tcp"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  xvfbChild.stdout?.pipe(logStream);
  xvfbChild.stderr?.pipe(logStream);
  xvfbChild.unref();
  await sleep(1000);
  if (xvfbChild.exitCode !== null) {
    throw new Error(`Xvfb exited early with code ${xvfbChild.exitCode}`);
  }
  return displayValue;
}

function startEdge(displayValue) {
  const env = {
    ...process.env,
    RELAY_EDGE_CDP_PORT: String(cdpPort),
  };
  if (displayValue) env.DISPLAY = displayValue;
  const result = spawnSync("bash", [join(repoRoot, "scripts/start-relay-edge-cdp.sh")], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  writeFileSync(
    edgeLogPath,
    `${result.stdout ?? ""}${result.stderr ?? ""}`,
    "utf8",
  );
  if (result.status !== 0) {
    throw new Error(`Edge start failed. See ${edgeLogPath}`);
  }
}

function startTauri(displayValue) {
  const logStream = createWriteStream(tauriLogPath, { flags: "a" });
  mkdirSync(appLocalDataDir, { recursive: true });
  const env = {
    ...process.env,
    RELAY_SKIP_PRESTART_EDGE: "1",
    RELAY_DEV_APP_CONTROL_PORT: String(devControlPort),
    RELAY_AGENT_TEST_APP_LOCAL_DATA_DIR: appLocalDataDir,
  };
  if (displayValue) env.DISPLAY = displayValue;
  tauriChild = spawn("pnpm", ["tauri:dev"], {
    cwd: appRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  tauriChild.stdout?.pipe(logStream);
  tauriChild.stderr?.pipe(logStream);
  tauriChild.unref();
}

function stopDetachedChild(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* ignore */
  }
}

async function cleanup() {
  stopDetachedChild(tauriChild);
  if (xvfbChild) {
    stopDetachedChild(xvfbChild);
  }
}

process.on("exit", () => {
  stopDetachedChild(tauriChild);
  if (xvfbChild) stopDetachedChild(xvfbChild);
});

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

async function main() {
  const expectedSummary = extractFirstSentenceFromReadme();
  if (existsSync(outputPath)) {
    rmSync(outputPath, { force: true });
  }

  const displayValue = await ensureVirtualDisplay();
  startEdge(displayValue);

  const doctor = runDoctor(displayValue);
  if (!doctorPassesLiveGate(doctor.report)) {
    writeJson(reportPath, {
      status: "failed",
      stage: "doctor",
      artifactsDir,
      doctor,
    });
    throw new Error(`doctor failed live-readiness gate with status ${doctor.report.status}`);
  }

  startTauri(displayValue);
  await waitForDevControl(180_000);

  await postDevControl("/configure", {
    workspacePath,
    sessionPreset: "build",
    cdpPort,
    autoLaunchEdge: false,
    timeoutMs: 60_000,
    maxTurns: 16,
    alwaysOnTop: false,
    persistSettings: false,
    rerunWarmup: true,
  });

  const preflightState = await pollState("preflight-ready", 180_000, (state) => {
    const diagnostics = state?.relayDiagnostics ?? {};
    if (
      diagnostics.copilotBridgeConnected === true &&
      diagnostics.copilotBridgeLoginRequired === false
    ) {
      return { done: true };
    }
    return { done: false };
  });

  const started = await postDevControl("/start-agent", {
    goal: prompt,
    cwd: workspacePath,
    cdpPort,
    autoLaunchEdge: false,
    timeoutMs: 60_000,
    maxTurns: 16,
    sessionPreset: "build",
  });
  const sessionId = started?.sessionId;
  if (!sessionId) {
    throw new Error("start-agent did not return a sessionId");
  }

  const createdState = await pollState("session-created", 60_000, (state) => ({
    done: Boolean(sessionById(state, sessionId)),
  }));
  const approvalState = await pollState("approval-needed", 300_000, (state) => {
    const session = sessionById(state, sessionId);
    if (!session) return { done: false };
    if (Array.isArray(session.pendingApprovals) && session.pendingApprovals.length > 0) {
      return { done: true };
    }
    if (!session.running && session.lastStopReason) {
      return {
        fatal: `session stopped before approval: ${session.lastStopReason}`,
      };
    }
    return { done: false };
  });

  const approvalSession = sessionById(approvalState, sessionId);
  const firstApproval = approvalSession?.pendingApprovals?.[0] ?? null;
  if (!firstApproval || !["write_file", "edit_file"].includes(firstApproval.toolName)) {
    throw new Error(`unexpected approval tool: ${firstApproval?.toolName ?? "none"}`);
  }

  await postDevControl("/approve", {
    sessionId,
    approvalId: firstApproval.approvalId,
    approved: true,
  });

  const completedState = await pollState("completed", 300_000, (state) => {
    const session = sessionById(state, sessionId);
    if (!session) return { done: false };
    if (!session.running) {
      if (session.lastStopReason === "completed") {
        return { done: true };
      }
      return {
        fatal: `session stopped with ${session.lastStopReason ?? "unknown"}`,
      };
    }
    return { done: false };
  });

  writeJson(finalStatePath, completedState);

  if (!existsSync(outputPath)) {
    throw new Error(`expected output file was not created: ${outputPath}`);
  }
  const output = readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n").trimEnd();
  const lines = output.split("\n");
  if (lines.length !== 2) {
    throw new Error(`expected 2 output lines, got ${lines.length}`);
  }
  if (lines[0] !== "source: README.md") {
    throw new Error(`unexpected first line: ${lines[0]}`);
  }
  if (lines[1] !== `summary: ${expectedSummary}`) {
    throw new Error(`unexpected summary line: ${lines[1]}`);
  }

  const finalSession = sessionById(completedState, sessionId);
  const readFileCount = finalSession?.toolResultCounts?.read_file ?? 0;
  const writeFileCount =
    (finalSession?.toolResultCounts?.write_file ?? 0) +
    (finalSession?.toolResultCounts?.edit_file ?? 0);
  if (readFileCount < 1) {
    throw new Error("read_file tool result was not observed");
  }
  if (writeFileCount < 1) {
    throw new Error("write_file/edit_file tool result was not observed");
  }

  const report = {
    status: "passed",
    artifactsDir,
    appLocalDataDir,
    display: displayValue,
    doctor,
    preflightState,
    createdState,
    approvalState,
    completedState,
    outputPath,
    output,
  };
  writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  await main();
} finally {
  await cleanup();
}
