#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const artifactsDir = mkdtempSync(join(tmpdir(), "relay-live-m365-tetris-html-"));
const tauriLogPath = join(artifactsDir, "tauri-dev.log");
const xvfbLogPath = join(artifactsDir, "xvfb.log");
const edgeLogPath = join(artifactsDir, "edge-start.log");
const doctorStdoutPath = join(artifactsDir, "doctor.stdout.log");
const doctorStderrPath = join(artifactsDir, "doctor.stderr.log");
const finalStatePath = join(artifactsDir, "final-state.json");
const progressTracePath = join(artifactsDir, "progress-trace.json");
const reportPath = join(artifactsDir, "report.json");
const appLocalDataDir = join(artifactsDir, "app-local-data");

const cdpPort = 9360;
const devControlPort = Number.parseInt(process.env.RELAY_DEV_APP_CONTROL_PORT ?? "18411", 10);
const workspacePath = "/root/Relay_Agent";
const outputPath = join(workspacePath, "tetris.html");
const legacyIndexPath = join(workspacePath, "index.html");
const prompt = "htmlでテトリスを作成して";

let tauriChild = null;
let xvfbChild = null;
let ownsXvfb = false;
let currentStage = "init";
let activeSessionId = null;
let capturedDoctor = null;
let capturedPreflightState = null;
let capturedCompletedState = null;
let capturedApprovalHistory = [];
const progressTrace = [];
let lastProgressFingerprint = null;

class HarnessError extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = "HarnessError";
    this.kind = kind;
    this.details = details;
  }
}

function fail(kind, message, details = {}) {
  throw new HarnessError(kind, message, details);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
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

function outputPreview(text, span = 240) {
  const normalized = text.replace(/\r\n/g, "\n");
  return {
    head: normalized.slice(0, span),
    tail: normalized.slice(Math.max(0, normalized.length - span)),
  };
}

function outputMetadata(path) {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      sha256: null,
      bytes: 0,
      preview: null,
      content: null,
    };
  }
  const content = readFileSync(path, "utf8");
  return {
    path,
    exists: true,
    sha256: sha256Text(content),
    bytes: statSync(path).size,
    preview: outputPreview(content),
    content,
  };
}

function escapedHtmlDetected(text) {
  const lower = text.toLowerCase();
  return lower.includes("&lt;!doctype html") || lower.includes("&lt;html") || lower.includes("&lt;head") || lower.includes("&lt;body");
}

function looksLikeHtmlDocument(text) {
  const lower = text.toLowerCase();
  const hasHtmlShell = lower.includes("<html") && lower.includes("</html>") && lower.includes("<body");
  const hasDoctypeOrHead = lower.includes("<!doctype html") || lower.includes("<head");
  return hasHtmlShell && hasDoctypeOrHead;
}

function looksLikeTetrisDocument(text) {
  return /tetris|tetromino|tetrominoes|line clear|score|hold|next/i.test(text);
}

function extractBridgeFailure(state, doctor = null) {
  return (
    state?.relayDiagnostics?.lastCopilotBridgeFailure ??
    doctor?.report?.lastCopilotBridgeFailure ??
    doctor?.report?.checks?.find?.((check) => check.id === "bridge_status")?.details?.lastCopilotBridgeFailure ??
    null
  );
}

function recordProgressTrace(label, state, sessionId = null) {
  const session = sessionId ? sessionById(state, sessionId) : latestSession(state);
  if (!session) return;
  const entry = {
    label,
    observedAtMs: Date.now(),
    sessionId: session.sessionId,
    running: session.running,
    lastStopReason: session.lastStopReason ?? null,
    currentCopilotRequestId: session.currentCopilotRequestId ?? null,
    messageCount: session.messageCount ?? 0,
    streamDeltaCount: session.streamDeltaCount ?? 0,
    firstStreamAtMs: session.firstStreamAtMs ?? null,
    lastStreamAtMs: session.lastStreamAtMs ?? null,
    streamPreviewText: session.streamPreviewText ?? null,
    lastAssistantText: session.lastAssistantText ?? null,
  };
  const fingerprint = JSON.stringify(entry);
  if (fingerprint === lastProgressFingerprint) return;
  lastProgressFingerprint = fingerprint;
  progressTrace.push(entry);
  writeJson(progressTracePath, progressTrace);
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

async function pollState(label, timeoutMs, predicate, sessionId = null) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await getState();
    writeJson(join(artifactsDir, `${label}.json`), lastState);
    recordProgressTrace(label, lastState, sessionId);
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

async function waitForSessionCompletionWithAutoApprovals(sessionId, timeoutMs) {
  const startedAt = Date.now();
  let lastState = null;
  let firstAssistantState = null;
  const approvalHistory = [];
  const lastApprovalAttemptAt = new Map();

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await getState();
    writeJson(join(artifactsDir, "completed.json"), lastState);
    recordProgressTrace("completed", lastState, sessionId);

    const session = sessionById(lastState, sessionId);
    if (!session) {
      await sleep(1500);
      continue;
    }

    if (!firstAssistantState && typeof session.lastAssistantText === "string" && session.lastAssistantText.trim().length > 0) {
      firstAssistantState = lastState;
      writeJson(join(artifactsDir, "first-assistant-state.json"), lastState);
    }

    const pendingApprovals = Array.isArray(session.pendingApprovals) ? session.pendingApprovals : [];
    if (pendingApprovals.length > 0) {
      const approval = pendingApprovals[0];
      if (!["write_file", "edit_file"].includes(approval.toolName)) {
        throw new HarnessError("unexpected_approval_tool", `unexpected approval tool: ${approval.toolName ?? "none"}`, {
          sessionId,
          approval,
        });
      }
      const approvalKey = `${approval.approvalId}:${approval.toolName}`;
      const now = Date.now();
      const lastApprovedAt = lastApprovalAttemptAt.get(approvalKey) ?? 0;
      if (now - lastApprovedAt >= 3000) {
        await postDevControl("/approve", {
          sessionId,
          approvalId: approval.approvalId,
          approved: true,
        });
        lastApprovalAttemptAt.set(approvalKey, now);
        approvalHistory.push({
          observedAtMs: now,
          approvalId: approval.approvalId,
          toolName: approval.toolName,
        });
      }
      await sleep(1500);
      continue;
    }

    if (!session.running) {
      if (session.lastStopReason === "completed") {
        return {
          completedState: lastState,
          approvalHistory,
          firstAssistantState,
        };
      }
      throw new HarnessError("session_stopped", `session stopped with ${session.lastStopReason ?? "unknown"}`, {
        sessionId,
        lastStopReason: session.lastStopReason ?? null,
      });
    }

    await sleep(1500);
  }

  if (lastState) {
    writeJson(finalStatePath, lastState);
  }
  throw new HarnessError("session_timeout", "Timed out waiting for session completion", { sessionId });
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
  const probe = spawnSync("xdpyinfo", ["-display", displayValue], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (probe.status === 0) {
    return displayValue;
  }
  const logStream = createWriteStream(xvfbLogPath, { flags: "a" });
  xvfbChild = spawn("Xvfb", [displayValue, "-screen", "0", "1440x900x24", "-nolisten", "tcp"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  xvfbChild.stdout?.pipe(logStream);
  xvfbChild.stderr?.pipe(logStream);
  xvfbChild.unref();
  ownsXvfb = true;
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
  writeFileSync(edgeLogPath, `${result.stdout ?? ""}${result.stderr ?? ""}`, "utf8");
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
  if (ownsXvfb && xvfbChild) {
    stopDetachedChild(xvfbChild);
  }
}

process.on("exit", () => {
  stopDetachedChild(tauriChild);
  if (ownsXvfb && xvfbChild) stopDetachedChild(xvfbChild);
});

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

function buildFailureReport(error, extra = {}) {
  const finalState = existsSync(finalStatePath) ? JSON.parse(readFileSync(finalStatePath, "utf8")) : null;
  const activeState = extra.activeState ?? finalState;
  const session = activeSessionId && activeState ? sessionById(activeState, activeSessionId) : null;
  return {
    status: "failed",
    stage: currentStage,
    kind: error instanceof HarnessError ? error.kind : "unexpected_error",
    message: error instanceof Error ? error.message : String(error),
    artifactsDir,
    appLocalDataDir,
    sessionId: activeSessionId,
    doctor: extra.doctor ?? capturedDoctor,
    preflightState: extra.preflightState ?? capturedPreflightState,
    completedState: extra.completedState ?? capturedCompletedState,
    finalState,
    approvalHistory: extra.approvalHistory ?? capturedApprovalHistory,
    outputPath,
    outputExists: existsSync(outputPath),
    outputSha256: outputMetadata(outputPath).sha256,
    outputBytes: outputMetadata(outputPath).bytes,
    outputPreview: outputMetadata(outputPath).preview,
    indexHtmlCreated: existsSync(legacyIndexPath),
    escapedHtmlDetected: existsSync(outputPath) ? escapedHtmlDetected(readFileSync(outputPath, "utf8")) : false,
    bridgeFailure: extractBridgeFailure(activeState, extra.doctor ?? capturedDoctor),
    sessionSnapshot: session,
    errorDetails: error instanceof HarnessError ? error.details : {},
  };
}

async function main() {
  currentStage = "preflight_output_guard";
  if (existsSync(outputPath) || existsSync(legacyIndexPath)) {
    fail("preexisting_output", "workspace root already contains tetris.html or index.html; refusing to overwrite unknown files", {
      outputPathExists: existsSync(outputPath),
      indexPathExists: existsSync(legacyIndexPath),
      outputPath,
      legacyIndexPath,
    });
  }

  const displayValue = await ensureVirtualDisplay();
  currentStage = "start_edge";
  startEdge(displayValue);

  currentStage = "doctor";
  capturedDoctor = runDoctor(displayValue);
  if (!doctorPassesLiveGate(capturedDoctor.report)) {
    fail("doctor_failed", `doctor failed live-readiness gate with status ${capturedDoctor.report.status}`, {
      doctor: capturedDoctor,
    });
  }

  currentStage = "start_tauri";
  startTauri(displayValue);
  await waitForDevControl(180_000);

  currentStage = "configure";
  await postDevControl("/configure", {
    workspacePath,
    cdpPort,
    autoLaunchEdge: false,
    timeoutMs: 60_000,
    maxTurns: 16,
    alwaysOnTop: false,
    persistSettings: false,
    rerunWarmup: true,
  });

  currentStage = "preflight_ready";
  capturedPreflightState = await pollState("preflight-ready", 180_000, (state) => {
    const diagnostics = state?.relayDiagnostics ?? {};
    if (
      diagnostics.copilotBridgeConnected === true &&
      diagnostics.copilotBridgeLoginRequired === false
    ) {
      return { done: true };
    }
    return { done: false };
  });

  currentStage = "start_agent";
  const started = await postDevControl("/start-agent", {
    goal: prompt,
    cwd: workspacePath,
    cdpPort,
    autoLaunchEdge: false,
    timeoutMs: 60_000,
    maxTurns: 16,
  });
  activeSessionId = started?.sessionId ?? null;
  if (!activeSessionId) {
    fail("missing_session_id", "start-agent did not return a sessionId");
  }

  currentStage = "session_created";
  await pollState(
    "session-created",
    60_000,
    (state) => ({ done: Boolean(sessionById(state, activeSessionId)) }),
    activeSessionId,
  );

  currentStage = "wait_completion";
  const {
    completedState,
    approvalHistory,
    firstAssistantState,
  } = await waitForSessionCompletionWithAutoApprovals(activeSessionId, 420_000);
  capturedCompletedState = completedState;
  capturedApprovalHistory = approvalHistory;
  writeJson(finalStatePath, completedState);

  currentStage = "validate_output";
  const finalOutput = outputMetadata(outputPath);
  const legacyIndex = outputMetadata(legacyIndexPath);

  if (!firstAssistantState) {
    fail("no_first_assistant_reply", "session completed or stopped without any assistant reply captured", {
      sessionId: activeSessionId,
    });
  }
  if (approvalHistory.length === 0) {
    fail("missing_write_approval", "session completed without surfacing a write/edit approval", {
      sessionId: activeSessionId,
    });
  }
  if (!finalOutput.exists) {
    fail("missing_tetris_output", `expected output file was not created: ${outputPath}`, {
      sessionId: activeSessionId,
    });
  }
  if (escapedHtmlDetected(finalOutput.content)) {
    fail("escaped_html_output", "saved tetris.html still contains escaped document-level HTML", {
      sessionId: activeSessionId,
    });
  }
  if (!looksLikeHtmlDocument(finalOutput.content)) {
    fail("invalid_html_document", "saved tetris.html does not look like a complete HTML document", {
      sessionId: activeSessionId,
    });
  }
  if (!looksLikeTetrisDocument(finalOutput.content)) {
    fail("missing_tetris_marker", "saved tetris.html does not contain a recognizable Tetris marker", {
      sessionId: activeSessionId,
    });
  }

  const finalSession = sessionById(completedState, activeSessionId);
  const report = {
    status: "passed",
    stage: currentStage,
    artifactsDir,
    appLocalDataDir,
    sessionId: activeSessionId,
    doctor: capturedDoctor,
    preflightState: capturedPreflightState,
    completedState,
    approvalHistory,
    outputPath,
    outputExists: finalOutput.exists,
    outputSha256: finalOutput.sha256,
    outputBytes: finalOutput.bytes,
    outputPreview: finalOutput.preview,
    indexHtmlCreated: legacyIndex.exists,
    escapedHtmlDetected: false,
    bridgeFailure: extractBridgeFailure(completedState, capturedDoctor),
    sessionSnapshot: finalSession,
    firstAssistantObserved: true,
  };
  writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  const report = buildFailureReport(error);
  writeJson(reportPath, report);
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
