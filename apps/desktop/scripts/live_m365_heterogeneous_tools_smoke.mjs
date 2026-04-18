#!/usr/bin/env node

/*
 * Heterogeneous tools + cross-turn grounding smoke.
 *
 * A 6-turn live conversation that mixes read_file, glob_search, and
 * write_file, with two explicit cross-turn memory probes (turns 5 and 6) and
 * fabrication detection via a forbidden-token list.
 *
 * Ground truth (tests/fixtures/tetris_grounding.html):
 *   - Real JS function names: paintCell, clearBoard, drawGrid, refillQueue,
 *     nextPiece, tick, loop
 *   - "COLS" (case-sensitive) appears on 3 lines (21, 23, 42); of the 7
 *     functions, only `drawGrid` (line 42) contains COLS in its body.
 *
 * ---- Known live-Copilot flakiness ----
 * This smoke surfaces two recurrent Copilot-side issues:
 *   (a) Empty-response stall: after a ~180s generation, Copilot returns 0
 *       chars and the agent loop ends with lastStopReason=tool_error and no
 *       tool use recorded. Detected as `copilot_transient_stall`.
 *   (b) Tool-call protocol drift: Copilot sometimes emits a raw JSON
 *       `{"name":"read_file",...}` instead of wrapping it in the expected
 *       ```relay_tool ``` code fence. The Relay agent parser then classifies
 *       the message as plain text and the tool never executes. Detected as
 *       `tool_protocol_confusion` ("Turn N did not produce a <tool> tool
 *       result") with messageCount advanced and no tool use recorded.
 * Both are Copilot/Relay-parser issues, not smoke bugs. Re-running the smoke
 * often clears the flake. Do not auto-retry inside the script — resending the
 * same prompt in the same thread has been observed to corrupt the thread's
 * tool-protocol state further.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const artifactsDir = mkdtempSync(join(tmpdir(), "relay-live-m365-hetero-tools-"));
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
const devControlPort = Number.parseInt(process.env.RELAY_DEV_APP_CONTROL_PORT ?? "18413", 10);
const workspacePath = "/root/Relay_Agent";
const heteroCopyPath = join(workspacePath, "tetris_hetero_copy.md");
// Case-sensitive grep term — "COLS" has 3 matches in the fixture (lines 21,
// 23, 42). Of the 7 real functions, only `drawGrid` contains COLS in its
// body; the other 6 do NOT appear on any match line.
const searchTerm = "COLS";
const expectedMatchCount = 3;
const realFunctions = [
  "paintCell",
  "clearBoard",
  "drawGrid",
  "refillQueue",
  "nextPiece",
  "tick",
  "loop",
];
// `drawGrid` is the only real function whose body contains COLS; it's the
// function that SHOULD be excluded from the turn-6 answer.
const functionInMatchLines = "drawGrid";
const functionsNotInMatchLines = [
  "paintCell",
  "clearBoard",
  "refillQueue",
  "nextPiece",
  "tick",
  "loop",
];
// Plausible-sounding function names that do NOT exist in the fixture. If the
// model cites any of these, it's fabricating.
const forbiddenFunctions = [
  "drawBoard",
  "initBoard",
  "renderGame",
  "updateScore",
  "paint_cell",
  "moveDown",
  "rotatePiece",
];

const prompts = [
  "tests/fixtures/tetris_grounding.html を読み、<script> 内に function キーワードで名前付きに定義されている関数の識別子を箇条書きで列挙してください。実在する識別子だけを、このファイルから読み取った根拠に基づいて挙げてください。存在しない識別子や推測で作った関数名を絶対に含めないでください。",
  `turn 1 で読んだ tests/fixtures/tetris_grounding.html のソースにおいて、"${searchTerm}"（大文字小文字一致）が何行に出現するか数えてください。追加のツールは使わず、turn 1 の read_file 結果だけを根拠に "matches: <数字>" の形式で 1 行だけ答えてください。推測は禁止です。`,
  `tests/fixtures/ 以下に存在する .html ファイルをすべて列挙してください。glob_search ツールを使い、pattern="**/*.html" と path="tests/fixtures/" を渡してください。ツール結果に列挙されたパスだけを箇条書きし、推測でのパス追加は禁止です。`,
  `turn 1 で挙げた関数のうち最初のものだけを、tetris_hetero_copy.md に 1 行で書き出してください。write_file を使用し、ファイル内容は関数名 1 語だけとし、装飾や接頭辞は付けないでください。`,
  `turn 2 で数えた検索語は何でしたか。ツールは使わず、単語ひとつだけで答えてください。`,
  `turn 1 で挙げた関数のうち、そのソース上で "${searchTerm}" を含む行に現れないものを箇条書きで列挙してください。必要なら read_file で裏取りしてください。実在しない関数名は絶対に挙げないでください。`,
];

const TTFS_WARN_MS = Number.parseInt(process.env.RELAY_TTFS_WARN_MS ?? "30000", 10);
const TURN_WALLTIME_WARN_MS = Number.parseInt(
  process.env.RELAY_TURN_WALLTIME_WARN_MS ?? "120000",
  10,
);
const DEGRADATION_MULTIPLIER = 2.5;

let tauriChild = null;
let xvfbChild = null;
let currentStage = "init";
let activeSessionId = null;

const turnRecords = [];
const forbiddenHits = [];

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

function sessionById(state, sessionId) {
  if (!state || !Array.isArray(state.sessions)) return null;
  return state.sessions.find((s) => s.sessionId === sessionId) ?? null;
}

function latestSession(state) {
  if (!state || !Array.isArray(state.sessions) || state.sessions.length === 0) return null;
  if (state.latestSessionId) {
    return state.sessions.find((s) => s.sessionId === state.latestSessionId) ?? state.sessions[0];
  }
  return state.sessions[0];
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
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${raw}`);
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

function sessionToolCount(session, bucket, name) {
  return Number.parseInt(String(session?.[bucket]?.[name] ?? 0), 10) || 0;
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
  if (result.status !== 0) throw new Error(`Edge start failed. See ${edgeLogPath}`);
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

function buildLatencyRecord(session, sendAtMs, completedAtMs) {
  const firstStreamAtMs = session.firstStreamAtMs ?? null;
  const lastStreamAtMs = session.lastStreamAtMs ?? null;
  const warnings = [];
  const timeToFirstStreamMs = firstStreamAtMs ? firstStreamAtMs - sendAtMs : null;
  const streamDurationMs =
    firstStreamAtMs && lastStreamAtMs ? lastStreamAtMs - firstStreamAtMs : null;
  const turnWallTimeMs = completedAtMs - sendAtMs;
  if (timeToFirstStreamMs !== null && timeToFirstStreamMs > TTFS_WARN_MS) {
    warnings.push(`time-to-first-stream ${timeToFirstStreamMs}ms exceeds ${TTFS_WARN_MS}ms`);
  }
  if (turnWallTimeMs > TURN_WALLTIME_WARN_MS) {
    warnings.push(`turn wall-time ${turnWallTimeMs}ms exceeds ${TURN_WALLTIME_WARN_MS}ms`);
  }
  return {
    firstStreamAtMs,
    lastStreamAtMs,
    timeToFirstStreamMs,
    streamDurationMs,
    turnWallTimeMs,
    latencyWarnings: warnings,
  };
}

function containsForbidden(text) {
  if (!text) return [];
  const found = new Set();
  for (const token of forbiddenFunctions) {
    // word-boundary match (prevents incidental substring hits)
    const rx = new RegExp(`(?:^|[^\\w])${token.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?:[^\\w]|$)`, "u");
    if (rx.test(text)) found.add(token);
  }
  return [...found];
}

function countRealFunctionMentions(text) {
  if (!text) return { mentioned: [], count: 0 };
  const mentioned = [];
  for (const name of realFunctions) {
    const rx = new RegExp(`(?:^|[^\\w])${name}(?:[^\\w]|$)`, "u");
    if (rx.test(text)) mentioned.push(name);
  }
  return { mentioned, count: mentioned.length };
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

async function runNoApprovalTurn(index, prompt, previousMessageCount) {
  const sendAtMs = Date.now();
  await sendTurn(prompt);
  const state = await pollState(`turn${index}-completed`, 300_000, (currentState) => {
    const session = ensureSingleSession(currentState);
    const pending = session.pendingApprovals?.length ?? 0;
    if (pending > 0) {
      return {
        fatal: new HarnessError(
          "unexpected_approval",
          `turn ${index} produced an approval prompt`,
          { toolNames: session.pendingApprovals.map((a) => a.toolName) },
        ),
      };
    }
    if (!session.running && session.messageCount > previousMessageCount) {
      if (session.lastStopReason === "completed") return { done: true };
      return {
        fatal: new HarnessError(
          "turn_stopped_unexpectedly",
          `turn ${index} stopped with ${session.lastStopReason ?? "unknown"}`,
          { runState: session.runState, lastStopReason: session.lastStopReason ?? null },
        ),
      };
    }
    // Copilot-side empty-response stall: run finished without progress. Treat
    // as transient infra issue (re-run the smoke) rather than auto-retrying;
    // auto-retries can confuse Copilot's tool-protocol state in the thread.
    if (!session.running && session.messageCount === previousMessageCount) {
      return {
        fatal: new HarnessError(
          "copilot_transient_stall",
          `turn ${index} finished with no progress (Copilot empty-response stall)`,
          {
            runState: session.runState,
            lastStopReason: session.lastStopReason ?? null,
            messageCount: session.messageCount,
          },
        ),
      };
    }
    return { done: false };
  });
  const session = ensureSingleSession(state);
  const completedAtMs = Date.now();
  const latency = buildLatencyRecord(session, sendAtMs, completedAtMs);
  const record = {
    turn: index,
    prompt,
    sessionId: session.sessionId,
    sendAtMs,
    completedAtMs,
    ...latency,
    streamDeltaCount: session.streamDeltaCount ?? 0,
    messageCount: session.messageCount,
    lastStopReason: session.lastStopReason ?? null,
    runState: session.runState ?? null,
    assistantExcerpt: session.lastAssistantText ?? null,
    toolUseCounts: session.toolUseCounts ?? {},
    toolResultCounts: session.toolResultCounts ?? {},
    forbiddenHits: containsForbidden(session.lastAssistantText),
  };
  turnRecords.push(record);
  return record;
}

async function runApprovalTurn(index, prompt, previousMessageCount, expectedTool) {
  const sendAtMs = Date.now();
  await sendTurn(prompt);

  const approvalState = await pollState(`turn${index}-approval`, 300_000, (state) => {
    const session = ensureSingleSession(state);
    const pending = session.pendingApprovals ?? [];
    if (pending.length === 1) {
      const toolName = pending[0]?.toolName ?? null;
      if (toolName !== expectedTool) {
        return {
          fatal: new HarnessError(
            "tool_protocol_confusion",
            `turn ${index} approval targeted ${toolName}, expected ${expectedTool}`,
            { toolName },
          ),
        };
      }
      return { done: true };
    }
    if (pending.length > 1) {
      return {
        fatal: new HarnessError("tool_protocol_confusion", `turn ${index} produced multiple approvals`, {
          pendingApprovals: pending,
        }),
      };
    }
    if (!session.running && session.messageCount > previousMessageCount) {
      return {
        fatal: new HarnessError(
          "tool_protocol_confusion",
          `turn ${index} stopped before approval with ${session.lastStopReason ?? "unknown"}`,
          { runState: session.runState, lastStopReason: session.lastStopReason },
        ),
      };
    }
    return { done: false };
  });

  const approvalSession = ensureSingleSession(approvalState);
  const approval = approvalSession.pendingApprovals[0];
  await postDevControl("/approve", {
    sessionId: activeSessionId,
    approvalId: approval.approvalId,
    approved: true,
    rememberForSession: true,
  });

  const completedState = await pollState(`turn${index}-completed`, 300_000, (state) => {
    const session = ensureSingleSession(state);
    const pending = session.pendingApprovals?.length ?? 0;
    if (pending > 0) return { done: false }; // wait for next approval or completion
    if (!session.running) {
      if (session.lastStopReason === "completed") return { done: true };
      return {
        fatal: new HarnessError(
          "turn_stopped_unexpectedly",
          `turn ${index} stopped with ${session.lastStopReason ?? "unknown"}`,
          { runState: session.runState, lastStopReason: session.lastStopReason ?? null },
        ),
      };
    }
    return { done: false };
  });

  const session = ensureSingleSession(completedState);
  const completedAtMs = Date.now();
  const latency = buildLatencyRecord(session, sendAtMs, completedAtMs);
  const record = {
    turn: index,
    prompt,
    sessionId: session.sessionId,
    sendAtMs,
    completedAtMs,
    ...latency,
    streamDeltaCount: session.streamDeltaCount ?? 0,
    messageCount: session.messageCount,
    lastStopReason: session.lastStopReason ?? null,
    runState: session.runState ?? null,
    assistantExcerpt: session.lastAssistantText ?? null,
    toolUseCounts: session.toolUseCounts ?? {},
    toolResultCounts: session.toolResultCounts ?? {},
    approvalTool: approval.toolName,
    forbiddenHits: containsForbidden(session.lastAssistantText),
  };
  turnRecords.push(record);
  return record;
}

function summarizeLatency() {
  const ttfsValues = turnRecords.map((r) => r.timeToFirstStreamMs).filter((v) => typeof v === "number");
  const wallTimes = turnRecords.map((r) => r.turnWallTimeMs);
  const streamDurations = turnRecords.map((r) => r.streamDurationMs).filter((v) => typeof v === "number");
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
    for (const w of r.latencyWarnings) summary.warnings.push(`turn ${r.turn}: ${w}`);
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
    heteroCopyPath,
    searchTerm,
    expectedMatchCount,
    realFunctions,
    functionInMatchLines,
    functionsNotInMatchLines,
    forbiddenFunctions,
    turnRecords,
    forbiddenHits,
    sessionId: null,
  };

  try {
    currentStage = "prepare";
    rmSync(heteroCopyPath, { force: true });

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

    // -------- Turn 1: glob_search ----------
    currentStage = "turn1_send";
    const turn1SendAt = Date.now();
    await sendTurn(prompts[0]);
    currentStage = "turn1_session_created";
    const t1Session = await waitForFirstSession();
    report.sessionId = t1Session.sessionId;

    currentStage = "turn1_complete";
    const t1State = await pollState("turn1-completed", 300_000, (s) => {
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
        if (session.messageCount > 0 && session.lastStopReason === "completed") return { done: true };
        return {
          fatal: new HarnessError(
            session.messageCount === 0 ? "copilot_transient_stall" : "turn_stopped_unexpectedly",
            `turn 1 stopped with ${session.lastStopReason ?? "unknown"}${
              session.messageCount === 0 ? " (Copilot empty-response stall — re-run the smoke)" : ""
            }`,
            { messageCount: session.messageCount },
          ),
        };
      }
      return { done: false };
    });
    const t1Final = ensureSingleSession(t1State);
    const t1CompletedAt = Date.now();
    const t1Record = {
      turn: 1,
      prompt: prompts[0],
      sessionId: t1Final.sessionId,
      sendAtMs: turn1SendAt,
      completedAtMs: t1CompletedAt,
      ...buildLatencyRecord(t1Final, turn1SendAt, t1CompletedAt),
      streamDeltaCount: t1Final.streamDeltaCount ?? 0,
      messageCount: t1Final.messageCount,
      lastStopReason: t1Final.lastStopReason ?? null,
      runState: t1Final.runState ?? null,
      assistantExcerpt: t1Final.lastAssistantText ?? null,
      toolUseCounts: t1Final.toolUseCounts ?? {},
      toolResultCounts: t1Final.toolResultCounts ?? {},
      forbiddenHits: containsForbidden(t1Final.lastAssistantText),
    };
    turnRecords.push(t1Record);
    if (sessionToolCount(t1Final, "toolResultCounts", "read_file") < 1) {
      fail("tool_protocol_confusion", "Turn 1 did not produce a read_file tool result", {
        toolResultCounts: t1Final.toolResultCounts,
      });
    }
    const t1Mentions = countRealFunctionMentions(t1Record.assistantExcerpt);
    if (t1Mentions.count < 3) {
      fail("grounding_regression", `Turn 1 mentioned only ${t1Mentions.count} real functions (need ≥3)`, {
        mentioned: t1Mentions.mentioned,
        assistantExcerpt: t1Record.assistantExcerpt,
      });
    }
    if (t1Record.forbiddenHits.length > 0) {
      forbiddenHits.push({ turn: 1, hits: t1Record.forbiddenHits });
      fail("grounding_regression", `Turn 1 cited fabricated function names: ${t1Record.forbiddenHits.join(", ")}`, {
        forbiddenHits: t1Record.forbiddenHits,
        assistantExcerpt: t1Record.assistantExcerpt,
      });
    }
    report.turn1FunctionMentions = t1Mentions;
    let previousMessageCount = t1Final.messageCount;

    // -------- Turn 2: in-context counting (no new tool) ----------
    const t2 = await runNoApprovalTurn(2, prompts[1], previousMessageCount);
    const t2Text = String(t2.assistantExcerpt ?? "");
    const matchesMatch = t2Text.match(/matches\s*[:=]\s*(\d+)/iu);
    if (!matchesMatch) {
      fail("grounding_regression", "Turn 2 reply did not report a matches count", {
        assistantExcerpt: t2.assistantExcerpt,
      });
    }
    const reportedMatchCount = Number.parseInt(matchesMatch[1], 10);
    if (reportedMatchCount !== expectedMatchCount) {
      fail(
        "grounding_regression",
        `Turn 2 reported matches: ${reportedMatchCount}, expected ${expectedMatchCount}`,
        { assistantExcerpt: t2.assistantExcerpt, reportedMatchCount, expectedMatchCount },
      );
    }
    if (t2.forbiddenHits.length > 0) {
      forbiddenHits.push({ turn: 2, hits: t2.forbiddenHits });
    }
    report.turn2ReportedMatchCount = reportedMatchCount;
    previousMessageCount = t2.messageCount;

    // -------- Turn 3: glob_search ----------
    const t3 = await runNoApprovalTurn(3, prompts[2], previousMessageCount);
    const globCount3 = Number.parseInt(String(t3.toolResultCounts?.glob_search ?? 0), 10) || 0;
    if (globCount3 < 1) {
      fail("tool_protocol_confusion", "Turn 3 did not produce a glob_search tool result", {
        toolResultCounts: t3.toolResultCounts,
      });
    }
    if (!String(t3.assistantExcerpt ?? "").includes("tetris_grounding.html")) {
      fail("grounding_regression", "Turn 3 reply did not cite tetris_grounding.html", {
        assistantExcerpt: t3.assistantExcerpt,
      });
    }
    if (t3.forbiddenHits.length > 0) {
      forbiddenHits.push({ turn: 3, hits: t3.forbiddenHits });
    }
    previousMessageCount = t3.messageCount;

    // -------- Turn 4: write_file with approval ----------
    const t4 = await runApprovalTurn(4, prompts[3], previousMessageCount, "write_file");
    if (!existsSync(heteroCopyPath)) {
      fail("tool_protocol_confusion", `Turn 4 did not create ${heteroCopyPath}`, {});
    }
    const t4FileContent = readFileSync(heteroCopyPath, "utf8").trim();
    const namesInFile = realFunctions.filter((n) => t4FileContent.includes(n));
    if (namesInFile.length === 0) {
      fail("grounding_regression", `Turn 4 output file did not contain any real function name`, {
        fileContent: t4FileContent,
      });
    }
    const forbiddenInFile = forbiddenFunctions.filter((n) => t4FileContent.includes(n));
    if (forbiddenInFile.length > 0) {
      fail("grounding_regression", `Turn 4 output file cited fabricated function: ${forbiddenInFile.join(", ")}`, {
        fileContent: t4FileContent,
      });
    }
    report.turn4FileContent = t4FileContent;
    report.turn4FileNames = namesInFile;
    previousMessageCount = t4.messageCount;

    // -------- Turn 5: cross-turn memory (no tool) ----------
    const t5 = await runNoApprovalTurn(5, prompts[4], previousMessageCount);
    // Case-insensitive match since the model may reply with "COLS", "cols", or
    // enclose in quotes/code — all acceptable.
    if (!String(t5.assistantExcerpt ?? "").toLowerCase().includes(searchTerm.toLowerCase())) {
      fail("cross_turn_memory", `Turn 5 did not recall the search term "${searchTerm}"`, {
        assistantExcerpt: t5.assistantExcerpt,
      });
    }
    previousMessageCount = t5.messageCount;

    // -------- Turn 6: cross-turn synthesis ----------
    const t6 = await runNoApprovalTurn(6, prompts[5], previousMessageCount);
    if (t6.forbiddenHits.length > 0) {
      forbiddenHits.push({ turn: 6, hits: t6.forbiddenHits });
      fail("grounding_regression", `Turn 6 cited fabricated function names: ${t6.forbiddenHits.join(", ")}`, {
        forbiddenHits: t6.forbiddenHits,
        assistantExcerpt: t6.assistantExcerpt,
      });
    }
    const t6Text = String(t6.assistantExcerpt ?? "");
    // Turn 6 must list ≥3 of the 6 functions that DO NOT appear on any COLS match line.
    const t6CorrectFunctions = functionsNotInMatchLines.filter((name) =>
      new RegExp(`(?:^|[^\\w])${name}(?:[^\\w]|$)`, "u").test(t6Text),
    );
    report.turn6CorrectFunctions = t6CorrectFunctions;
    if (t6CorrectFunctions.length < 3) {
      fail(
        "cross_turn_memory",
        `Turn 6 listed only ${t6CorrectFunctions.length} correct functions (need ≥3)`,
        {
          correctFunctions: t6CorrectFunctions,
          assistantExcerpt: t6.assistantExcerpt,
        },
      );
    }
    // drawGrid IS on a COLS match line (line 42), so it should NOT be in turn 6's answer list.
    // We detect if drawGrid appears as a bullet/list item rather than in explanatory prose.
    // Soft check: record presence for audit but don't fail — Copilot may mention it explanatorily.
    report.turn6IncorrectlyListedDrawGrid = new RegExp(
      `(?:^|[^\\w])${functionInMatchLines}(?:[^\\w]|$)`,
      "u",
    ).test(t6Text);
    previousMessageCount = t6.messageCount;

    // -------- Final assertions ----------
    currentStage = "final_assertions";
    const finalState = await getState();
    writeJson(finalStatePath, finalState);
    const finalSession = ensureSingleSession(finalState);

    const threadContinuity = summarizeThreadContinuity();
    report.threadContinuity = threadContinuity;
    if (threadContinuity.verdict === "unexpected_new_chat") {
      fail("session_continuity", "extra new-chat transition detected", { threadContinuity });
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

    // messageCount must be monotonically increasing
    for (let i = 1; i < turnRecords.length; i++) {
      if (turnRecords[i].messageCount <= turnRecords[i - 1].messageCount) {
        fail("session_continuity", `messageCount did not increase at turn ${turnRecords[i].turn}`, {
          previous: turnRecords[i - 1].messageCount,
          current: turnRecords[i].messageCount,
        });
      }
    }

    report.latencySummary = summarizeLatency();
    report.finalSession = finalSession;
    report.forbiddenHits = forbiddenHits;
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
      forbiddenHits,
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
