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
const artifactsDir = mkdtempSync(join(tmpdir(), "relay-live-m365-grounding-approval-"));
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
    "tests/fixtures/tetris_grounding.html を読み、このファイルに対して行える最小の可読性改善を 3 つだけ挙げてください。まだファイルは編集しないでください。各指摘は、このファイル内に実在する識別子・文字列・構造だけを根拠にしてください。存在しない識別子やバグ名を推測で挙げないでください。",
  turn2:
    "いま挙げた 3 つのうち 1 つだけを /root/Relay_Agent/tetris_grounding_live_copy.html に適用してください。元の tests/fixtures/tetris_grounding.html は変更しないでください。",
  turn3:
    "同じファイルに、残りの改善を 1 つだけ追加で適用してください。今回も元の fixture は変更しないでください。",
};

let tauriChild = null;
let xvfbChild = null;
let currentStage = "init";
let activeSessionId = null;

const turnArtifacts = [];
const approvalObservations = {
  turn2Shown: false,
  turn2ApprovalCount: 0,
  turn2ApprovalTool: null,
  turn2RememberedForSession: true,
  turn3Shown: false,
  turn3ApprovalCount: 0,
};
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
  const pnpmResult = runCommand(
    "pnpm",
    doctorArgs,
    env,
  );
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
    runState: session?.runState ?? null,
    lastStopReason: session?.lastStopReason ?? null,
    toolUseCounts: session?.toolUseCounts ?? {},
    toolResultCounts: session?.toolResultCounts ?? {},
  });
}

function containsForbiddenToken(text) {
  const lower = String(text ?? "");
  return forbiddenTokens.find((token) => lower.includes(token)) ?? null;
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
  activeSessionId = session.sessionId;
  return session;
}

async function waitForCompletedTurn(label, kindOnFailure) {
  const state = await pollState(label, 300_000, (currentState) => {
    const session = ensureSingleSession(currentState);
    const pendingCount = session?.pendingApprovals?.length ?? 0;
    if (pendingCount > 0) {
      return {
        fatal: new HarnessError(kindOnFailure, `${label} reached unexpected approval state`, {
          pendingCount,
          pendingTools: session.pendingApprovals.map((approval) => approval.toolName),
        }),
      };
    }
    if (!session.running) {
      if (session.lastStopReason === "completed") {
        return { done: true };
      }
      return {
        fatal: new HarnessError(
          kindOnFailure,
          `${label} stopped with ${session.lastStopReason ?? "unknown"}`,
          {
            runState: session.runState,
            lastStopReason: session.lastStopReason ?? null,
          },
        ),
      };
    }
    return { done: false };
  });
  return ensureSingleSession(state);
}

async function main() {
  const report = {
    status: "running",
    artifactsDir,
    appLocalDataDir,
    fixturePath,
    liveCopyPath,
    prompts,
    approvalObservations,
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
    const turn1Session = await waitForCompletedTurn("turn1-completed", "grounding_regression");
    recordTurnArtifact("turn1", turn1Session, prompts.turn1, join(artifactsDir, "turn1-completed.json"));
    if (sessionToolCount(turn1Session, "toolResultCounts", "read_file") < 1) {
      fail("grounding_regression", "Turn 1 completed without a read_file tool result", {
        toolResultCounts: turn1Session.toolResultCounts,
      });
    }
    if (sessionToolCount(turn1Session, "toolErrorCounts", "read_file") > 0) {
      fail("grounding_regression", "Turn 1 read_file failed instead of grounding on the requested fixture", {
        toolErrorCounts: turn1Session.toolErrorCounts,
        assistantExcerpt: turn1Session.lastAssistantText,
      });
    }
    const forbiddenTurn1 = containsForbiddenToken(turn1Session.lastAssistantText);
    if (forbiddenTurn1) {
      fail("grounding_regression", `Turn 1 assistant reply cited forbidden token ${forbiddenTurn1}`, {
        assistantExcerpt: turn1Session.lastAssistantText,
      });
    }
    const turn1MessageCount = turn1Session.messageCount;

    currentStage = "turn2_send";
    await sendTurn(prompts.turn2);

    currentStage = "turn2_wait_approval";
    const turn2ApprovalState = await pollState("turn2-approval-needed", 300_000, (state) => {
      const session = ensureSingleSession(state);
      const pendingApprovals = session.pendingApprovals ?? [];
      if (pendingApprovals.length === 1) {
        const toolName = pendingApprovals[0]?.toolName ?? null;
        if (!["write_file", "edit_file"].includes(toolName)) {
          return {
            fatal: new HarnessError("tool_protocol_confusion", `Turn 2 approval targeted ${toolName}`, {
              toolName,
            }),
          };
        }
        return { done: true };
      }
      if (pendingApprovals.length > 1) {
        return {
          fatal: new HarnessError("tool_protocol_confusion", "Turn 2 produced multiple approvals", {
            pendingApprovals,
          }),
        };
      }
      if (!session.running && session.lastStopReason && session.messageCount > turn1MessageCount) {
        return {
          fatal: new HarnessError(
            "tool_protocol_confusion",
            `Turn 2 stopped before approval with ${session.lastStopReason}`,
            {
              runState: session.runState,
              lastStopReason: session.lastStopReason,
            },
          ),
        };
      }
      return { done: false };
    });
    const turn2ApprovalSession = ensureSingleSession(turn2ApprovalState);
    const turn2Approval = turn2ApprovalSession.pendingApprovals[0];
    approvalObservations.turn2Shown = true;
    approvalObservations.turn2ApprovalCount = turn2ApprovalSession.pendingApprovals.length;
    approvalObservations.turn2ApprovalTool = turn2Approval.toolName;

    currentStage = "turn2_approve";
    await postDevControl("/approve", {
      sessionId: activeSessionId,
      approvalId: turn2Approval.approvalId,
      approved: true,
      rememberForSession: true,
    });

    currentStage = "turn2_complete";
    const turn2Session = await waitForCompletedTurn("turn2-completed", "tool_protocol_confusion");
    recordTurnArtifact("turn2", turn2Session, prompts.turn2, join(artifactsDir, "turn2-completed.json"));
    const turn2MessageCount = turn2Session.messageCount;

    currentStage = "turn3_send";
    await sendTurn(prompts.turn3);

    currentStage = "turn3_complete";
    const turn3State = await pollState("turn3-completed", 300_000, (state) => {
      const session = ensureSingleSession(state);
      const pendingCount = session.pendingApprovals?.length ?? 0;
      approvalObservations.turn3ApprovalCount = pendingCount;
      if (pendingCount > 0) {
        approvalObservations.turn3Shown = true;
        return {
          fatal: new HarnessError("approval_memory", "Turn 3 requested another file approval", {
            pendingApprovals: session.pendingApprovals,
          }),
        };
      }
      if (!session.running && session.messageCount > turn2MessageCount) {
        if (session.lastStopReason === "completed") {
          return { done: true };
        }
        return {
          fatal: new HarnessError("tool_protocol_confusion", `Turn 3 stopped with ${session.lastStopReason}`, {
            runState: session.runState,
            lastStopReason: session.lastStopReason ?? null,
          }),
        };
      }
      return { done: false };
    });
    const turn3Session = ensureSingleSession(turn3State);
    recordTurnArtifact("turn3", turn3Session, prompts.turn3, join(artifactsDir, "turn3-completed.json"));
    writeJson(finalStatePath, turn3State);

    currentStage = "final_assertions";
    finalizeFingerprints();
    writeJson(promptResponseExcerptsPath, turnArtifacts);

    if (approvalObservations.turn2ApprovalCount !== 1) {
      fail("approval_memory", `expected one Turn 2 approval, saw ${approvalObservations.turn2ApprovalCount}`, {
        approvalObservations,
      });
    }
    if (approvalObservations.turn3ApprovalCount !== 0) {
      fail("approval_memory", `expected zero Turn 3 approvals, saw ${approvalObservations.turn3ApprovalCount}`, {
        approvalObservations,
      });
    }
    if (fileHashes.fixtureBefore?.sha256 !== fileHashes.fixtureAfter?.sha256) {
      fail("grounding_regression", "source fixture changed during live run", {
        fixtureBefore: fileHashes.fixtureBefore,
        fixtureAfter: fileHashes.fixtureAfter,
      });
    }
    if (fileHashes.liveCopyBefore?.sha256 === fileHashes.liveCopyAfter?.sha256) {
      fail("grounding_regression", "live copy hash did not change after edit turns", {
        liveCopyBefore: fileHashes.liveCopyBefore,
        liveCopyAfter: fileHashes.liveCopyAfter,
      });
    }

    if (sessionToolCount(turn3Session, "toolUseCounts", "read_file") < 1) {
      fail("grounding_regression", "final session state did not record read_file usage", {
        toolUseCounts: turn3Session.toolUseCounts,
      });
    }
    const totalWriteTools =
      sessionToolCount(turn3Session, "toolUseCounts", "write_file") +
      sessionToolCount(turn3Session, "toolUseCounts", "edit_file");
    if (totalWriteTools < 2) {
      fail("tool_protocol_confusion", "final session state recorded fewer than two file mutation tool uses", {
        toolUseCounts: turn3Session.toolUseCounts,
      });
    }
    if (turn3Session.lastStopReason !== "completed") {
      fail("session_continuity", `expected completed final stop reason, got ${turn3Session.lastStopReason}`, {
        lastStopReason: turn3Session.lastStopReason,
      });
    }

    const threadContinuity = summarizeThreadContinuity();
    report.threadContinuity = threadContinuity;
    if (threadContinuity.verdict === "unexpected_new_chat") {
      fail("session_continuity", "Copilot thread continuity evidence showed an extra new-chat transition", {
        threadContinuity,
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
      approvalObservations,
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
