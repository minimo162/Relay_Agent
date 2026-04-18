#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const artifactsDir = mkdtempSync(join(tmpdir(), "relay-live-m365-long-continuity-"));
const tauriLogPath = join(artifactsDir, "tauri-dev.log");
const xvfbLogPath = join(artifactsDir, "xvfb.log");
const edgeLogPath = join(artifactsDir, "edge-start.log");
const doctorStdoutPath = join(artifactsDir, "doctor.stdout.log");
const doctorStderrPath = join(artifactsDir, "doctor.stderr.log");
const doctorJsonPath = join(artifactsDir, "doctor.json");
const finalStatePath = join(artifactsDir, "final-state.json");
const reportPath = join(artifactsDir, "report.json");
const appLocalDataDir = join(artifactsDir, "app-local-data");

const cdpPort = Number.parseInt(process.env.RELAY_EDGE_CDP_PORT ?? "9360", 10);
const devControlPort = Number.parseInt(process.env.RELAY_DEV_APP_CONTROL_PORT ?? "18412", 10);
const workspacePath = "/root/Relay_Agent";

// Text-only chain. Turns 5 & 8 probe memory of earlier turns — genuine thread
// continuity, not just DOM session stickiness.
const prompts = [
  "47 × 53 を計算して、結果だけ数字で答えてください。",
  "その結果を 2 倍した数を教えてください。",
  "前回の数を 10 進数から 16 進数にしてください。先頭に 0x は付けないでください。",
  "その 16 進数を英語アルファベットの小文字で読み上げるとどうなりますか。例: a b c。",
  "ここまでの会話で、最初に私が尋ねた掛け算の式は何でしたか。式だけ答えてください。",
  "その式の最初の因数に 100 を足すといくつになりますか。",
  "いま答えた合計を二進数で表してください。先頭に 0b は付けないでください。",
  "ここまで私が投げた質問は合計いくつでしたか。この質問も含めて数えてください。",
];

// Soft thresholds (warn-only). Live LLM latency varies; these catch outliers.
const TTFS_WARN_MS = 20_000;
const TURN_WALLTIME_WARN_MS = 90_000;
const DEGRADATION_MULTIPLIER = 2.5;

let tauriChild = null;
let xvfbChild = null;
let currentStage = "init";
let activeSessionId = null;

const turnRecords = [];

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
  return new Promise((r) => setTimeout(r, ms));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function latestSession(state) {
  if (!state || !Array.isArray(state.sessions) || state.sessions.length === 0) return null;
  if (state.latestSessionId) {
    return state.sessions.find((s) => s.sessionId === state.latestSessionId) ?? state.sessions[0];
  }
  return state.sessions[0];
}

function sessionById(state, sessionId) {
  if (!state || !Array.isArray(state.sessions)) return null;
  return state.sessions.find((s) => s.sessionId === sessionId) ?? null;
}

function summarizeThreadContinuity() {
  if (!existsSync(tauriLogPath)) {
    return {
      logPath: tauriLogPath,
      present: false,
      startNewChatCount: 0,
      forcedNewChatCount: 0,
      continueCurrentThreadCount: 0,
      verdict: "missing_log",
    };
  }
  const logText = readFileSync(tauriLogPath, "utf8");
  const startNewChatCount =
    (logText.match(/\[copilot:describe\] starting new chat\.\.\./gu) ?? []).length;
  const forcedNewChatCount =
    (logText.match(/\[copilot:describe\] repair replay continuing with forced new chat/gu) ?? [])
      .length;
  const continueCurrentThreadCount =
    (logText.match(/\[copilot:describe\] continuing in current Copilot thread \(no new chat click\)/gu) ?? [])
      .length;

  let verdict = "ok";
  if (startNewChatCount > 1 || forcedNewChatCount > 0) verdict = "unexpected_new_chat";
  else if (continueCurrentThreadCount > 0) verdict = "continued_current_thread";
  else if (startNewChatCount === 1) verdict = "single_initial_new_chat_only";

  return {
    logPath: tauriLogPath,
    present: true,
    startNewChatCount,
    forcedNewChatCount,
    continueCurrentThreadCount,
    verdict,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let json = null;
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Expected JSON from ${url}: ${error instanceof Error ? error.message : String(error)}\n${raw}`,
      );
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
  throw new Error(
    `Timed out waiting for dev control: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function postDevControl(path, body) {
  return fetchJson(`http://127.0.0.1:${devControlPort}${path}`, {
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
    if (result?.fatal) throw result.fatal;
    if (result?.done) return lastState;
    await sleep(1500);
  }
  if (lastState) writeJson(finalStatePath, lastState);
  throw new Error(`Timed out waiting for ${label}`);
}

function ensureSingleSession(state, expectedSessionId = activeSessionId) {
  const sessions = state?.sessions ?? [];
  if (sessions.length !== 1) {
    fail("session_continuity", `expected exactly one Relay session, found ${sessions.length}`, {
      sessionCount: sessions.length,
      latestSessionId: state?.latestSessionId ?? null,
    });
  }
  const session = expectedSessionId ? sessionById(state, expectedSessionId) : latestSession(state);
  if (!session) {
    fail("session_continuity", `expected Relay session ${expectedSessionId ?? "<latest>"} missing`, {
      latestSessionId: state?.latestSessionId ?? null,
      sessionIds: sessions.map((s) => s.sessionId),
    });
  }
  if (expectedSessionId && state?.latestSessionId && state.latestSessionId !== expectedSessionId) {
    fail("session_continuity", `latestSessionId changed from ${expectedSessionId} to ${state.latestSessionId}`, {
      expectedSessionId,
      latestSessionId: state.latestSessionId,
    });
  }
  return session;
}

function tryExtractJson(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(trimmed.slice(jsonStart));
  } catch {
    return null;
  }
}

function extractJsonFromOutput(stdout, stderr, description) {
  const fromStdout = tryExtractJson(stdout);
  if (fromStdout) return fromStdout;
  const fromStderr = tryExtractJson(stderr);
  if (fromStderr) return fromStderr;
  throw new Error(`${description} output did not contain parseable JSON`);
}

function runCommand(command, args, env) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function runDoctor(displayValue) {
  const env = { ...process.env };
  if (displayValue) env.DISPLAY = displayValue;
  // Direct cargo — `pnpm doctor` is shadowed by pnpm's builtin in pnpm ≥10.
  const cargoResult = runCommand(
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
    env,
  );
  const combinedStdout = cargoResult.stdout ?? "";
  const combinedStderr = cargoResult.stderr ?? "";
  const doctor = extractJsonFromOutput(combinedStdout, combinedStderr, "relay-agent-doctor");
  writeFileSync(doctorStdoutPath, combinedStdout, "utf8");
  writeFileSync(doctorStderrPath, combinedStderr, "utf8");
  writeJson(doctorJsonPath, doctor);
  return doctor;
}

function doctorPassesLiveGate(report) {
  const checks = new Map((report?.checks ?? []).map((c) => [c.id, c]));
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
  const env = { ...process.env, RELAY_EDGE_CDP_PORT: String(cdpPort) };
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
  if (xvfbChild) stopDetachedChild(xvfbChild);
}

async function sendTurn(text) {
  await postDevControl("/first-run-send", { text });
}

async function waitForFirstSession() {
  const state = await pollState("initial-session-created", 60_000, (s) => {
    if ((s?.sessions ?? []).length > 0) return { done: true };
    return { done: false };
  });
  const session = ensureSingleSession(state, null);
  activeSessionId = session.sessionId;
  return session;
}

async function runTurn(index, prompt, previousMessageCount) {
  const sendAtMs = Date.now();
  await sendTurn(prompt);

  const state = await pollState(`turn${index}-completed`, 300_000, (currentState) => {
    const session = ensureSingleSession(currentState);
    const pendingCount = session.pendingApprovals?.length ?? 0;
    if (pendingCount > 0) {
      return {
        fatal: new HarnessError(
          "unexpected_approval",
          `turn ${index} produced an approval prompt (text-only prompts should not gate tools)`,
          {
            toolNames: session.pendingApprovals.map((a) => a.toolName),
          },
        ),
      };
    }
    if (!session.running && session.messageCount > previousMessageCount) {
      if (session.lastStopReason === "completed") return { done: true };
      return {
        fatal: new HarnessError(
          "turn_stopped_unexpectedly",
          `turn ${index} stopped with ${session.lastStopReason ?? "unknown"}`,
          {
            runState: session.runState,
            lastStopReason: session.lastStopReason ?? null,
          },
        ),
      };
    }
    return { done: false };
  });

  const session = ensureSingleSession(state);
  const completedAtMs = Date.now();
  const firstStreamAtMs = session.firstStreamAtMs ?? null;
  const lastStreamAtMs = session.lastStreamAtMs ?? null;
  const record = {
    turn: index,
    prompt,
    sessionId: session.sessionId,
    sendAtMs,
    completedAtMs,
    firstStreamAtMs,
    lastStreamAtMs,
    timeToFirstStreamMs: firstStreamAtMs ? firstStreamAtMs - sendAtMs : null,
    streamDurationMs:
      firstStreamAtMs && lastStreamAtMs ? lastStreamAtMs - firstStreamAtMs : null,
    turnWallTimeMs: completedAtMs - sendAtMs,
    streamDeltaCount: session.streamDeltaCount ?? 0,
    messageCount: session.messageCount,
    lastStopReason: session.lastStopReason ?? null,
    runState: session.runState ?? null,
    assistantExcerpt: session.lastAssistantText ?? null,
    toolUseCounts: session.toolUseCounts ?? {},
    latencyWarnings: [],
  };
  if (record.timeToFirstStreamMs !== null && record.timeToFirstStreamMs > TTFS_WARN_MS) {
    record.latencyWarnings.push(
      `time-to-first-stream ${record.timeToFirstStreamMs}ms exceeds ${TTFS_WARN_MS}ms`,
    );
  }
  if (record.turnWallTimeMs > TURN_WALLTIME_WARN_MS) {
    record.latencyWarnings.push(
      `turn wall-time ${record.turnWallTimeMs}ms exceeds ${TURN_WALLTIME_WARN_MS}ms`,
    );
  }
  turnRecords.push(record);
  return record;
}

function summarizeLatency() {
  const ttfsValues = turnRecords
    .map((r) => r.timeToFirstStreamMs)
    .filter((v) => typeof v === "number");
  const wallTimes = turnRecords.map((r) => r.turnWallTimeMs);
  const streamDurations = turnRecords
    .map((r) => r.streamDurationMs)
    .filter((v) => typeof v === "number");

  const summary = {
    turnCount: turnRecords.length,
    ttfs: {
      samples: ttfsValues,
      median: median(ttfsValues),
      max: ttfsValues.length ? Math.max(...ttfsValues) : null,
      min: ttfsValues.length ? Math.min(...ttfsValues) : null,
    },
    turnWallTimeMs: {
      samples: wallTimes,
      median: median(wallTimes),
      max: wallTimes.length ? Math.max(...wallTimes) : null,
      min: wallTimes.length ? Math.min(...wallTimes) : null,
    },
    streamDurationMs: {
      samples: streamDurations,
      median: median(streamDurations),
      max: streamDurations.length ? Math.max(...streamDurations) : null,
      min: streamDurations.length ? Math.min(...streamDurations) : null,
    },
    warnings: [],
  };

  const medianTtfs = summary.ttfs.median;
  const maxTtfs = summary.ttfs.max;
  if (medianTtfs && maxTtfs && maxTtfs > medianTtfs * DEGRADATION_MULTIPLIER) {
    summary.warnings.push(
      `TTFS degradation: max ${maxTtfs}ms > ${DEGRADATION_MULTIPLIER}× median ${medianTtfs}ms`,
    );
  }
  for (const r of turnRecords) {
    for (const w of r.latencyWarnings) {
      summary.warnings.push(`turn ${r.turn}: ${w}`);
    }
  }
  return summary;
}

async function main() {
  const report = {
    status: "running",
    artifactsDir,
    appLocalDataDir,
    cdpPort,
    devControlPort,
    prompts,
    turnRecords,
    sessionId: null,
  };

  try {
    currentStage = "ensure_display";
    const displayValue = await ensureVirtualDisplay();
    report.display = displayValue;

    currentStage = "start_edge";
    startEdge(displayValue);

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

    currentStage = "preflight";
    const preflightState = await pollState("preflight-ready", 180_000, (state) => {
      const d = state?.relayDiagnostics ?? {};
      if (d.copilotBridgeConnected === true && d.copilotBridgeLoginRequired === false) {
        return { done: true };
      }
      return { done: false };
    });
    report.preflightState = preflightState;

    currentStage = "doctor";
    const doctor = runDoctor(displayValue);
    report.doctor = doctor;
    if (!doctorPassesLiveGate(doctor)) {
      fail("infrastructure", `doctor failed live-readiness gate with status ${doctor.status}`, {
        doctorStatus: doctor.status,
      });
    }

    currentStage = "turn1_send";
    const turn1SendAt = Date.now();
    await sendTurn(prompts[0]);

    currentStage = "turn1_session_created";
    const turn1Session = await waitForFirstSession();
    report.sessionId = turn1Session.sessionId;

    currentStage = "turn1_complete";
    const turn1State = await pollState("turn1-completed", 300_000, (s) => {
      const session = ensureSingleSession(s);
      const pending = session.pendingApprovals?.length ?? 0;
      if (pending > 0) {
        return {
          fatal: new HarnessError("unexpected_approval", "turn 1 produced an approval prompt", {
            toolNames: session.pendingApprovals.map((a) => a.toolName),
          }),
        };
      }
      if (!session.running) {
        if (session.lastStopReason === "completed") return { done: true };
        return {
          fatal: new HarnessError(
            "turn_stopped_unexpectedly",
            `turn 1 stopped with ${session.lastStopReason ?? "unknown"}`,
          ),
        };
      }
      return { done: false };
    });
    const turn1SessionCompleted = ensureSingleSession(turn1State);
    const turn1CompletedAt = Date.now();
    const t1Record = {
      turn: 1,
      prompt: prompts[0],
      sessionId: turn1SessionCompleted.sessionId,
      sendAtMs: turn1SendAt,
      completedAtMs: turn1CompletedAt,
      firstStreamAtMs: turn1SessionCompleted.firstStreamAtMs ?? null,
      lastStreamAtMs: turn1SessionCompleted.lastStreamAtMs ?? null,
      timeToFirstStreamMs: turn1SessionCompleted.firstStreamAtMs
        ? turn1SessionCompleted.firstStreamAtMs - turn1SendAt
        : null,
      streamDurationMs:
        turn1SessionCompleted.firstStreamAtMs && turn1SessionCompleted.lastStreamAtMs
          ? turn1SessionCompleted.lastStreamAtMs - turn1SessionCompleted.firstStreamAtMs
          : null,
      turnWallTimeMs: turn1CompletedAt - turn1SendAt,
      streamDeltaCount: turn1SessionCompleted.streamDeltaCount ?? 0,
      messageCount: turn1SessionCompleted.messageCount,
      lastStopReason: turn1SessionCompleted.lastStopReason ?? null,
      runState: turn1SessionCompleted.runState ?? null,
      assistantExcerpt: turn1SessionCompleted.lastAssistantText ?? null,
      toolUseCounts: turn1SessionCompleted.toolUseCounts ?? {},
      latencyWarnings: [],
    };
    if (t1Record.timeToFirstStreamMs !== null && t1Record.timeToFirstStreamMs > TTFS_WARN_MS) {
      t1Record.latencyWarnings.push(
        `time-to-first-stream ${t1Record.timeToFirstStreamMs}ms exceeds ${TTFS_WARN_MS}ms`,
      );
    }
    if (t1Record.turnWallTimeMs > TURN_WALLTIME_WARN_MS) {
      t1Record.latencyWarnings.push(
        `turn wall-time ${t1Record.turnWallTimeMs}ms exceeds ${TURN_WALLTIME_WARN_MS}ms`,
      );
    }
    turnRecords.push(t1Record);
    let previousMessageCount = turn1SessionCompleted.messageCount;

    for (let i = 1; i < prompts.length; i++) {
      currentStage = `turn${i + 1}`;
      const record = await runTurn(i + 1, prompts[i], previousMessageCount);
      if (record.messageCount <= previousMessageCount) {
        fail("session_continuity", `messageCount did not increase on turn ${i + 1}`, {
          previousMessageCount,
          messageCount: record.messageCount,
        });
      }
      previousMessageCount = record.messageCount;
    }

    currentStage = "final_assertions";
    const finalState = await getState();
    writeJson(finalStatePath, finalState);
    const finalSession = ensureSingleSession(finalState);

    const threadContinuity = summarizeThreadContinuity();
    report.threadContinuity = threadContinuity;
    if (threadContinuity.verdict === "unexpected_new_chat") {
      fail("session_continuity", "Copilot thread continuity evidence showed an extra new-chat transition", {
        threadContinuity,
      });
    }
    if (threadContinuity.startNewChatCount > 1) {
      fail("session_continuity", `startNewChatCount expected 1, got ${threadContinuity.startNewChatCount}`, {
        threadContinuity,
      });
    }
    if (threadContinuity.forcedNewChatCount !== 0) {
      fail("session_continuity", `forcedNewChatCount expected 0, got ${threadContinuity.forcedNewChatCount}`, {
        threadContinuity,
      });
    }

    const uniqueSessionIds = new Set(turnRecords.map((r) => r.sessionId));
    if (uniqueSessionIds.size !== 1) {
      fail("session_continuity", "sessionId changed across turns", {
        sessionIds: [...uniqueSessionIds],
      });
    }

    report.latencySummary = summarizeLatency();
    report.finalSession = finalSession;
    report.status = "passed";
    report.completedStage = currentStage;
    writeJson(reportPath, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    const threadContinuity = summarizeThreadContinuity();
    const failure = {
      status: "failed",
      stage: currentStage,
      artifactsDir,
      appLocalDataDir,
      cdpPort,
      devControlPort,
      prompts,
      sessionId: activeSessionId,
      turnRecords,
      threadContinuity,
      latencySummary: summarizeLatency(),
      error: {
        kind: error instanceof HarnessError ? error.kind : "infrastructure",
        message: error instanceof Error ? error.message : String(error),
        details: error instanceof HarnessError ? error.details : {},
      },
    };
    writeJson(reportPath, failure);
    process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    await cleanup();
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

await main();
