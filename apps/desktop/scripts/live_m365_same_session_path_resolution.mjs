#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const artifactsDir = mkdtempSync(join(tmpdir(), "relay-live-m365-path-resolution-"));
const tauriLogPath = join(artifactsDir, "tauri-dev.log");
const xvfbLogPath = join(artifactsDir, "xvfb.log");
const edgeLogPath = join(artifactsDir, "edge-start.log");
const doctorBeforeTauriStdoutPath = join(artifactsDir, "doctor-before-tauri.stdout.log");
const doctorBeforeTauriStderrPath = join(artifactsDir, "doctor-before-tauri.stderr.log");
const doctorBeforeTauriJsonPath = join(artifactsDir, "doctor-before-tauri.json");
const doctorStdoutPath = join(artifactsDir, "doctor.stdout.log");
const doctorStderrPath = join(artifactsDir, "doctor.stderr.log");
const doctorJsonPath = join(artifactsDir, "doctor.json");
const finalStatePath = join(artifactsDir, "final-state.json");
const promptResponseExcerptsPath = join(artifactsDir, "prompt-response-excerpts.json");
const reportPath = join(artifactsDir, "report.json");
const appLocalDataDir = join(artifactsDir, "app-local-data");

const cdpPort = 9360;
const devControlPort = Number.parseInt(process.env.RELAY_DEV_APP_CONTROL_PORT ?? "18411", 10);
const workspacePath = "/root/Relay_Agent";
const fixturePath = join(repoRoot, "tests/fixtures/tetris_grounding.html");
const liveCopyPath = join(workspacePath, "tetris_grounding_live_copy.html");
const forbiddenTokens = ["x_size", "y_size", "bag.length0"];
const prompts = {
  turn1:
    "/root/Relay_Agent/tests/fixtures/tetris_grounding.html を read_file で読み、このファイル内に実在する文字列だけを根拠に、title 要素の文字列と、script 内の定数を 1 つだけ挙げてください。推測や一般論は禁止です。まだ編集しないでください。",
  turn2:
    "同じ Relay セッションのまま、今度は tests/fixtures/tetris_grounding.html を read_file で読み、body 内に実在する表示文言を 2 つだけ挙げてください。まだ編集しないでください。存在しない識別子は挙げないでください。",
  turn3:
    "同じセッションのまま、tetris_grounding_live_copy.html を read_file で読み、head 内にある要素を 2 つだけ挙げてください。まだ編集しないでください。",
};
const turn3HeadElementGroups = [
  {
    id: "meta",
    variants: ['<meta charset="utf-8" />', '<meta charset="utf-8">', 'meta charset="utf-8"'],
  },
  {
    id: "title",
    variants: [
      "<title>Relay grounding — Tetris mini</title>",
      'title 要素の文字列: Relay grounding — Tetris mini',
      'title: Relay grounding — Tetris mini',
    ],
  },
  {
    id: "style",
    variants: ["<style>", "style 要素", "style element"],
  },
];

let tauriChild = null;
let xvfbChild = null;
let currentStage = "init";
let activeSessionId = null;

const turnArtifacts = [];
const pathResolution = {
  absolutePath: "pending",
  fixtureRelative: "pending",
  workspaceRootRelative: "pending",
};
const grounding = {
  turn1: "pending",
  turn2: "pending",
  turn3: "pending",
};
const validationFailures = [];
const fileHashes = {
  fixtureBefore: null,
  liveCopyBefore: null,
  fixtureAfter: null,
  liveCopyAfter: null,
};

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

function fileFingerprint(path) {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      sha256: null,
      size: 0,
    };
  }
  const content = readFileSync(path);
  return {
    path,
    exists: true,
    sha256: sha256Text(content),
    size: statSync(path).size,
  };
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
  const startNewChatCount = (logText.match(/\[copilot:describe\] starting new chat\.\.\./gu) ?? []).length;
  const forcedNewChatCount =
    (logText.match(/\[copilot:describe\] repair replay continuing with forced new chat/gu) ?? []).length;
  const continueCurrentThreadCount =
    (logText.match(/\[copilot:describe\] continuing in current Copilot thread \(no new chat click\)/gu) ?? [])
      .length;

  let verdict = "ok";
  if (startNewChatCount > 1 || forcedNewChatCount > 0) {
    verdict = "unexpected_new_chat";
  } else if (continueCurrentThreadCount > 0) {
    verdict = "continued_current_thread";
  } else if (startNewChatCount === 1) {
    verdict = "single_initial_new_chat_only";
  }

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
  throw new Error(
    `Timed out waiting for dev control: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
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
      throw result.fatal;
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
  const trimmedStdout = (stdout ?? "").trim();
  const trimmedStderr = (stderr ?? "").trim();
  if (!trimmedStdout && !trimmedStderr) {
    throw new Error(`${description} produced no JSON output`);
  }
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

function runDoctor(displayValue, paths = {}) {
  const stdoutPath = paths.stdoutPath ?? doctorStdoutPath;
  const stderrPath = paths.stderrPath ?? doctorStderrPath;
  const jsonPath = paths.jsonPath ?? doctorJsonPath;
  const noAutoLaunchEdge = paths.noAutoLaunchEdge ?? true;
  const env = { ...process.env };
  if (displayValue) env.DISPLAY = displayValue;
  const doctorArgs = ["doctor", "--", "--json", "--cdp-port", String(cdpPort)];
  if (noAutoLaunchEdge) {
    doctorArgs.push("--no-auto-launch-edge");
  }
  const pnpmResult = runCommand("pnpm", doctorArgs, env);
  let combinedStdout = `[pnpm doctor]\n${pnpmResult.stdout ?? ""}`;
  let combinedStderr = `[pnpm doctor]\n${pnpmResult.stderr ?? ""}`;
  let doctor = tryExtractJson(pnpmResult.stdout ?? "") ?? tryExtractJson(pnpmResult.stderr ?? "");
  let parsedFrom = "pnpm";
  let fallbackExitCode = null;

  if (!doctor) {
    const cargoArgs = [
      "run",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "--bin",
      "relay-agent-doctor",
      "--",
      "--json",
      "--cdp-port",
      String(cdpPort),
    ];
    if (noAutoLaunchEdge) {
      cargoArgs.push("--no-auto-launch-edge");
    }
    const cargoResult = runCommand("cargo", cargoArgs, env);
    combinedStdout += `\n[cargo run fallback]\n${cargoResult.stdout ?? ""}`;
    combinedStderr += `\n[cargo run fallback]\n${cargoResult.stderr ?? ""}`;
    doctor = extractJsonFromOutput(cargoResult.stdout ?? "", cargoResult.stderr ?? "", "doctor fallback");
    parsedFrom = "cargo_fallback";
    fallbackExitCode = cargoResult.status ?? 1;
  }

  writeFileSync(stdoutPath, combinedStdout, "utf8");
  writeFileSync(stderrPath, combinedStderr, "utf8");
  writeJson(jsonPath, doctor);
  return {
    exitCode: fallbackExitCode ?? (pnpmResult.status ?? 1),
    primaryExitCode: pnpmResult.status ?? 1,
    fallbackExitCode,
    parsedFrom,
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
    fail("session_continuity", `expected Relay session ${expectedSessionId ?? "<latest>"} was not found`, {
      latestSessionId: state?.latestSessionId ?? null,
      sessionIds: sessions.map((entry) => entry.sessionId),
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

function ensureSessionWorkspace(session, label) {
  if ((session?.cwd ?? null) !== workspacePath) {
    fail("workspace_path", `${label} session cwd did not match workspace`, {
      expectedCwd: workspacePath,
      actualCwd: session?.cwd ?? null,
      sessionId: session?.sessionId ?? null,
    });
  }
}

function sessionToolCount(session, bucket, name) {
  return Number.parseInt(String(session?.[bucket]?.[name] ?? 0), 10) || 0;
}

function recordTurnArtifact(turn, session, prompt, statePath) {
  turnArtifacts.push({
    turn,
    prompt,
    assistantExcerpt: session?.lastAssistantText ?? null,
    statePath,
    sessionId: session?.sessionId ?? null,
    cwd: session?.cwd ?? null,
    runState: session?.runState ?? null,
    lastStopReason: session?.lastStopReason ?? null,
    toolUseCounts: session?.toolUseCounts ?? {},
    toolResultCounts: session?.toolResultCounts ?? {},
    toolErrorCounts: session?.toolErrorCounts ?? {},
  });
}

function containsForbiddenToken(text) {
  const haystack = String(text ?? "");
  return forbiddenTokens.find((token) => haystack.includes(token)) ?? null;
}

function addValidationFailure(kind, message, details = {}) {
  validationFailures.push({ kind, message, details });
}

function includesAny(text, variants) {
  const haystack = String(text ?? "");
  return variants.some((variant) => haystack.includes(variant));
}

function validateGroundedReply(turn, session) {
  const assistantText = String(session?.lastAssistantText ?? "");
  const forbiddenToken = containsForbiddenToken(assistantText);
  if (forbiddenToken) {
    grounding[turn] = "fail";
    addValidationFailure("grounding_regression", `${turn} assistant reply cited forbidden token ${forbiddenToken}`, {
      assistantExcerpt: assistantText,
    });
    return;
  }

  if (turn === "turn1") {
    if (!assistantText.includes("Relay grounding — Tetris mini")) {
      grounding.turn1 = "fail";
      addValidationFailure("grounding_regression", "Turn 1 reply did not include the real title string", {
        assistantExcerpt: assistantText,
      });
      return;
    }
    if (!includesAny(assistantText, ["const COLS = 10", "COLS = 10"])) {
      grounding.turn1 = "fail";
      addValidationFailure("grounding_regression", "Turn 1 reply did not include the real script constant", {
        assistantExcerpt: assistantText,
      });
      return;
    }
    grounding.turn1 = "pass";
    return;
  }

  if (turn === "turn2") {
    if (!assistantText.includes("Score:")) {
      grounding.turn2 = "fail";
      addValidationFailure("grounding_regression", "Turn 2 reply did not include the real Score label", {
        assistantExcerpt: assistantText,
      });
      return;
    }
    if (!assistantText.includes("←/→ move · ↓ soft · Space hard")) {
      grounding.turn2 = "fail";
      addValidationFailure("grounding_regression", "Turn 2 reply did not include the real controls label", {
        assistantExcerpt: assistantText,
      });
      return;
    }
    grounding.turn2 = "pass";
    return;
  }

  if (turn === "turn3") {
    const matchedGroups = turn3HeadElementGroups.filter((group) => includesAny(assistantText, group.variants));
    if (matchedGroups.length < 2) {
      grounding.turn3 = "fail";
      addValidationFailure("grounding_regression", "Turn 3 reply did not include two real head elements", {
        assistantExcerpt: assistantText,
        matchedGroups: matchedGroups.map((group) => group.id),
      });
      return;
    }
    grounding.turn3 = "pass";
  }
}

function prepareLiveCopy() {
  if (!existsSync(fixturePath)) {
    throw new Error(`fixture missing: ${fixturePath}`);
  }
  rmSync(liveCopyPath, { force: true });
  copyFileSync(fixturePath, liveCopyPath);
  fileHashes.fixtureBefore = fileFingerprint(fixturePath);
  fileHashes.liveCopyBefore = fileFingerprint(liveCopyPath);
  if (!fileHashes.liveCopyBefore.exists) {
    throw new Error(`live copy was not created: ${liveCopyPath}`);
  }
}

function finalizeFingerprints() {
  fileHashes.fixtureAfter = fileFingerprint(fixturePath);
  fileHashes.liveCopyAfter = fileFingerprint(liveCopyPath);
}

async function sendTurn(text) {
  await postDevControl("/first-run-send", { text });
}

async function waitForTurn1Session() {
  const createdState = await pollState("turn1-session-created", 60_000, (state) => {
    if ((state?.sessions ?? []).length > 0) {
      return { done: true };
    }
    return { done: false };
  });
  const session = ensureSingleSession(createdState, null);
  ensureSessionWorkspace(session, "turn1-session-created");
  activeSessionId = session.sessionId;
  return session;
}

async function waitForCompletedTurn(label, previousMessageCount) {
  const state = await pollState(label, 300_000, (currentState) => {
    const session = ensureSingleSession(currentState);
    ensureSessionWorkspace(session, label);
    const pendingCount = session?.pendingApprovals?.length ?? 0;
    if (pendingCount > 0) {
      return {
        fatal: new HarnessError("approval_unexpected", `${label} reached unexpected approval state`, {
          pendingCount,
          pendingTools: session.pendingApprovals.map((approval) => approval.toolName),
        }),
      };
    }
    if (!session.running) {
      if (session.messageCount > previousMessageCount && session.lastStopReason === "completed") {
        return { done: true };
      }
      return {
        fatal: new HarnessError(
          "session_continuity",
          `${label} stopped before producing a new completed assistant turn`,
          {
            previousMessageCount,
            messageCount: session.messageCount,
            runState: session.runState,
            lastStopReason: session.lastStopReason ?? null,
            assistantExcerpt: session.lastAssistantText ?? null,
          },
        ),
      };
    }
    return { done: false };
  });
  return ensureSingleSession(state);
}

function validateReadFileCounts(session, expectedUseCount, turnLabel, resolutionKey) {
  let ok = true;
  if (sessionToolCount(session, "toolUseCounts", "read_file") < expectedUseCount) {
    ok = false;
    addValidationFailure("grounding_regression", `${turnLabel} did not record enough read_file tool uses`, {
      expectedUseCount,
      toolUseCounts: session.toolUseCounts,
    });
  }
  if (sessionToolCount(session, "toolResultCounts", "read_file") < expectedUseCount) {
    ok = false;
    addValidationFailure("grounding_regression", `${turnLabel} did not record enough read_file tool results`, {
      expectedUseCount,
      toolResultCounts: session.toolResultCounts,
    });
  }
  if (sessionToolCount(session, "toolErrorCounts", "read_file") !== 0) {
    ok = false;
    addValidationFailure("grounding_regression", `${turnLabel} read_file produced an error`, {
      toolErrorCounts: session.toolErrorCounts,
      assistantExcerpt: session.lastAssistantText,
    });
  }
  pathResolution[resolutionKey] = ok ? "pass" : "fail";
}

async function main() {
  const report = {
    status: "running",
    artifactsDir,
    appLocalDataDir,
    fixturePath,
    liveCopyPath,
    prompts,
    pathResolution,
    grounding,
    fileHashes,
    sessionId: null,
  };

  try {
    currentStage = "prepare_live_copy";
    prepareLiveCopy();

    currentStage = "ensure_display";
    const displayValue = await ensureVirtualDisplay();
    report.display = displayValue;

    currentStage = "start_edge";
    startEdge(displayValue);

    currentStage = "doctor_before_tauri";
    report.doctorBeforeTauri = runDoctor(displayValue, {
      stdoutPath: doctorBeforeTauriStdoutPath,
      stderrPath: doctorBeforeTauriStderrPath,
      jsonPath: doctorBeforeTauriJsonPath,
      noAutoLaunchEdge: true,
    });

    currentStage = "start_tauri";
    startTauri(displayValue);
    await waitForDevControl(180_000);

    currentStage = "configure";
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

    currentStage = "preflight";
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
    report.preflightState = preflightState;

    currentStage = "doctor";
    const doctor = runDoctor(displayValue, { noAutoLaunchEdge: false });
    report.doctor = doctor;
    if (!doctorPassesLiveGate(doctor.report)) {
      fail("infrastructure", `doctor failed live-readiness gate with status ${doctor.report.status}`, {
        doctorStatus: doctor.report.status,
      });
    }

    currentStage = "turn1_send";
    await sendTurn(prompts.turn1);

    currentStage = "turn1_session_created";
    const turn1SessionCreated = await waitForTurn1Session();
    report.sessionId = turn1SessionCreated.sessionId;

    currentStage = "turn1_complete";
    const turn1Session = await waitForCompletedTurn("turn1-completed", turn1SessionCreated.messageCount);
    recordTurnArtifact("turn1", turn1Session, prompts.turn1, join(artifactsDir, "turn1-completed.json"));
    validateReadFileCounts(turn1Session, 1, "Turn 1", "absolutePath");
    validateGroundedReply("turn1", turn1Session);

    currentStage = "turn2_send";
    const turn1MessageCount = turn1Session.messageCount;
    await sendTurn(prompts.turn2);

    currentStage = "turn2_complete";
    const turn2Session = await waitForCompletedTurn("turn2-completed", turn1MessageCount);
    recordTurnArtifact("turn2", turn2Session, prompts.turn2, join(artifactsDir, "turn2-completed.json"));
    validateReadFileCounts(turn2Session, 1, "Turn 2", "fixtureRelative");
    validateGroundedReply("turn2", turn2Session);

    currentStage = "turn3_send";
    const turn2MessageCount = turn2Session.messageCount;
    await sendTurn(prompts.turn3);

    currentStage = "turn3_complete";
    const turn3Session = await waitForCompletedTurn("turn3-completed", turn2MessageCount);
    recordTurnArtifact("turn3", turn3Session, prompts.turn3, join(artifactsDir, "turn3-completed.json"));
    validateReadFileCounts(turn3Session, 1, "Turn 3", "workspaceRootRelative");
    validateGroundedReply("turn3", turn3Session);
    writeJson(finalStatePath, await getState());

    currentStage = "final_assertions";
    finalizeFingerprints();
    writeJson(promptResponseExcerptsPath, turnArtifacts);

    if (fileHashes.fixtureBefore?.sha256 !== fileHashes.fixtureAfter?.sha256) {
      fail("grounding_regression", "source fixture changed during live run", {
        fixtureBefore: fileHashes.fixtureBefore,
        fixtureAfter: fileHashes.fixtureAfter,
      });
    }
    if (fileHashes.liveCopyBefore?.sha256 !== fileHashes.liveCopyAfter?.sha256) {
      fail("grounding_regression", "live copy changed during path-resolution run", {
        liveCopyBefore: fileHashes.liveCopyBefore,
        liveCopyAfter: fileHashes.liveCopyAfter,
      });
    }

    const threadContinuity = summarizeThreadContinuity();
    report.threadContinuity = threadContinuity;
    if (threadContinuity.verdict === "unexpected_new_chat") {
      fail("session_continuity", "Copilot thread continuity evidence showed an extra new-chat transition", {
        threadContinuity,
      });
    }
    if (validationFailures.length > 0) {
      fail("validation_failed", "One or more path-resolution validations failed", {
        validationFailures,
      });
    }

    report.status = "passed";
    report.completedStage = currentStage;
    report.turnArtifacts = turnArtifacts;
    report.fileHashes = fileHashes;
    report.finalSession = turn3Session;
    writeJson(reportPath, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    finalizeFingerprints();
    try {
      writeJson(finalStatePath, await getState());
    } catch {
      /* ignore final-state fetch failures during teardown */
    }
    writeJson(promptResponseExcerptsPath, turnArtifacts);
    const threadContinuity = summarizeThreadContinuity();
    const failure = {
      status: "failed",
      stage: currentStage,
      artifactsDir,
      appLocalDataDir,
      fixturePath,
      liveCopyPath,
      prompts,
      sessionId: activeSessionId,
      pathResolution,
      grounding,
      validationFailures,
      fileHashes,
      turnArtifacts,
      threadContinuity,
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
