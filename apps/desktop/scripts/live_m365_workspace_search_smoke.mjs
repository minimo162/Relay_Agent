#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const artifactsDir = mkdtempSync(join(tmpdir(), "relay-live-m365-workspace-search-"));
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
const fixtureRootRelative = "tests/live_search_fixture";
const fixtureDir = join(workspacePath, fixtureRootRelative);
const uniqueToken = "RELAY_SEARCH_TOKEN_7421";
const markdownToken = "RELAY_MARKDOWN_ONLY_TOKEN_8801";
const fixtureFiles = [
  {
    relativePath: "alpha-report.txt",
    content: [
      "Alpha workspace search fixture",
      `Unique token: ${uniqueToken}`,
      "This file should be found by grep_search only.",
      "",
    ].join("\n"),
  },
  {
    relativePath: "beta-notes.md",
    content: [
      "# Workspace Search Fixture Heading",
      "",
      `Markdown-only token: ${markdownToken}`,
      "",
    ].join("\n"),
  },
  {
    relativePath: "nested/gamma-search-target.txt",
    content: [
      "Gamma nested target",
      "This file exists for glob_search filename matching.",
      "",
    ].join("\n"),
  },
];
const prompts = {
  turn1: [
    "同じ Relay セッション内で、workspace 配下の tests/live_search_fixture からファイル名検索をしてください。",
    "glob_search だけを使い、pattern は **/*search-target*.txt、path は tests/live_search_fixture にしてください。",
    "返答は見つかったファイルパスを 1 つだけ。grep_search・read_file・bash・編集系ツールは禁止です。",
  ].join(" "),
  turn2: [
    "同じ Relay セッションのまま、tests/live_search_fixture 配下で内容検索をしてください。",
    `grep_search だけを使い、文字列 ${uniqueToken} を検索してください。`,
    "返答は一致したファイルパスを 1 つだけ。glob_search・read_file・bash・編集系ツールは禁止です。",
  ].join(" "),
  turn3: [
    "同じセッションのまま、tests/live_search_fixture 配下だけを対象に、Markdown ファイルから内容検索をしてください。",
    `grep_search だけを使い、glob を *.md に絞って文字列 ${markdownToken} を検索してください。`,
    "返答は一致した Markdown ファイルパスを 1 つだけ。glob_search・read_file・bash・編集系ツールは禁止です。",
  ].join(" "),
};
const expectedMatches = {
  turn1: ["nested/gamma-search-target.txt", "gamma-search-target.txt"],
  turn2: ["alpha-report.txt"],
  turn3: ["beta-notes.md"],
};

let tauriChild = null;
let xvfbChild = null;
let ownsXvfb = false;
let currentStage = "init";
let activeSessionId = null;

const turnArtifacts = [];
const validationFailures = [];
const fixtureFingerprints = [];
const toolUsageVerdicts = {
  turn1: "pending",
  turn2: "pending",
  turn3: "pending",
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

  const logText = requireFileText(tauriLogPath);
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

function requireFileText(path) {
  return readFileSync(path, "utf8");
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
  if (ownsXvfb && xvfbChild) stopDetachedChild(xvfbChild);
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

function toolDelta(currentSession, previousSession, bucket, name) {
  return sessionToolCount(currentSession, bucket, name) - sessionToolCount(previousSession, bucket, name);
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

function addValidationFailure(kind, message, details = {}) {
  validationFailures.push({ kind, message, details });
}

function fileFingerprint(path) {
  if (!existsSync(path)) {
    return { path, exists: false, size: 0, mtimeMs: null };
  }
  const stat = statSync(path);
  return {
    path,
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    relativePath: relative(workspacePath, path),
  };
}

function snapshotFixtureFingerprints(label) {
  fixtureFingerprints.push({
    label,
    files: fixtureFiles.map((entry) => fileFingerprint(join(fixtureDir, entry.relativePath))),
  });
}

function prepareFixture() {
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  for (const entry of fixtureFiles) {
    const absolutePath = join(fixtureDir, entry.relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, entry.content, "utf8");
  }
  snapshotFixtureFingerprints("before");
}

function cleanupFixture() {
  rmSync(fixtureDir, { recursive: true, force: true });
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

function verifyExpectedMatch(turn, assistantText) {
  const variants = expectedMatches[turn] ?? [];
  if (!variants.some((variant) => assistantText.includes(variant))) {
    addValidationFailure("search_result_mismatch", `${turn} assistant reply did not contain the expected file`, {
      expectedVariants: variants,
      assistantExcerpt: assistantText,
    });
    return false;
  }
  return true;
}

function verifyUnexpectedToolDeltas(turn, currentSession, previousSession, forbiddenToolNames) {
  const forbidden = [];
  for (const toolName of forbiddenToolNames) {
    const delta =
      toolDelta(currentSession, previousSession, "toolUseCounts", toolName) +
      toolDelta(currentSession, previousSession, "toolErrorCounts", toolName);
    if (delta > 0) {
      forbidden.push({ toolName, delta });
    }
  }
  if (forbidden.length > 0) {
    addValidationFailure("unexpected_tool_usage", `${turn} used unexpected tools`, {
      forbidden,
      toolUseCounts: currentSession.toolUseCounts,
      toolErrorCounts: currentSession.toolErrorCounts,
    });
    return false;
  }
  return true;
}

function validateTurn(turn, currentSession, previousSession, spec) {
  const requiredUseDelta = toolDelta(currentSession, previousSession, "toolUseCounts", spec.requiredTool);
  const requiredResultDelta = toolDelta(currentSession, previousSession, "toolResultCounts", spec.requiredTool);
  const requiredErrorDelta = toolDelta(currentSession, previousSession, "toolErrorCounts", spec.requiredTool);
  const assistantText = String(currentSession?.lastAssistantText ?? "");
  let ok = true;

  if (requiredUseDelta < 1) {
    ok = false;
    addValidationFailure("required_tool_missing", `${turn} did not use ${spec.requiredTool}`, {
      requiredTool: spec.requiredTool,
      requiredUseDelta,
      toolUseCounts: currentSession.toolUseCounts,
    });
  }
  if (requiredResultDelta < 1) {
    ok = false;
    addValidationFailure("required_tool_missing", `${turn} did not record a ${spec.requiredTool} result`, {
      requiredTool: spec.requiredTool,
      requiredResultDelta,
      toolResultCounts: currentSession.toolResultCounts,
    });
  }
  if (requiredErrorDelta !== 0) {
    ok = false;
    addValidationFailure("tool_error", `${turn} recorded a ${spec.requiredTool} error`, {
      requiredTool: spec.requiredTool,
      requiredErrorDelta,
      toolErrorCounts: currentSession.toolErrorCounts,
    });
  }

  if (!verifyUnexpectedToolDeltas(turn, currentSession, previousSession, spec.forbiddenTools)) {
    ok = false;
  }
  if (!verifyExpectedMatch(turn, assistantText)) {
    ok = false;
  }

  toolUsageVerdicts[turn] = ok ? "pass" : "fail";
}

async function main() {
  const report = {
    status: "running",
    artifactsDir,
    appLocalDataDir,
    workspacePath,
    fixtureDir,
    fixtureRootRelative,
    prompts,
    expectedMatches,
    toolUsageVerdicts,
    fixtureFingerprints,
    sessionId: null,
  };

  try {
    currentStage = "prepare_fixture";
    prepareFixture();

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
    validateTurn("turn1", turn1Session, turn1SessionCreated, {
      requiredTool: "glob_search",
      forbiddenTools: ["grep_search", "read_file", "write_file", "edit_file", "bash"],
    });

    currentStage = "turn2_send";
    await sendTurn(prompts.turn2);

    currentStage = "turn2_complete";
    const turn2Session = await waitForCompletedTurn("turn2-completed", turn1Session.messageCount);
    recordTurnArtifact("turn2", turn2Session, prompts.turn2, join(artifactsDir, "turn2-completed.json"));
    validateTurn("turn2", turn2Session, turn1Session, {
      requiredTool: "grep_search",
      forbiddenTools: ["glob_search", "read_file", "write_file", "edit_file", "bash"],
    });

    currentStage = "turn3_send";
    await sendTurn(prompts.turn3);

    currentStage = "turn3_complete";
    const turn3Session = await waitForCompletedTurn("turn3-completed", turn2Session.messageCount);
    recordTurnArtifact("turn3", turn3Session, prompts.turn3, join(artifactsDir, "turn3-completed.json"));
    validateTurn("turn3", turn3Session, turn2Session, {
      requiredTool: "grep_search",
      forbiddenTools: ["glob_search", "read_file", "write_file", "edit_file", "bash"],
    });

    snapshotFixtureFingerprints("after");
    writeJson(finalStatePath, await getState());
    writeJson(promptResponseExcerptsPath, turnArtifacts);

    const threadContinuity = summarizeThreadContinuity();
    report.threadContinuity = threadContinuity;
    if (threadContinuity.verdict === "unexpected_new_chat") {
      fail("session_continuity", "Copilot thread continuity evidence showed an extra new-chat transition", {
        threadContinuity,
      });
    }
    if (validationFailures.length > 0) {
      fail("validation_failed", "One or more workspace-search validations failed", {
        validationFailures,
      });
    }

    report.status = "passed";
    report.completedStage = currentStage;
    report.turnArtifacts = turnArtifacts;
    report.finalSession = turn3Session;
    writeJson(reportPath, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    snapshotFixtureFingerprints("after_failure");
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
      workspacePath,
      fixtureDir,
      fixtureRootRelative,
      prompts,
      expectedMatches,
      sessionId: activeSessionId,
      toolUsageVerdicts,
      validationFailures,
      fixtureFingerprints,
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
    cleanupFixture();
    await cleanup();
  }
}

process.on("exit", () => {
  stopDetachedChild(tauriChild);
  if (ownsXvfb && xvfbChild) stopDetachedChild(xvfbChild);
});

process.on("SIGINT", async () => {
  cleanupFixture();
  await cleanup();
  process.exit(130);
});

process.on("SIGTERM", async () => {
  cleanupFixture();
  await cleanup();
  process.exit(143);
});

await main();
