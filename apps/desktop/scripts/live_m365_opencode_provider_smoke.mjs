#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const opencodeRepo = process.env.OPENCODE_REPO || "/root/opencode";
const bunPath = process.env.BUN_BIN || "/root/.bun/bin/bun";
const artifactsDir = mkdtempSync(join(tmpdir(), "relay-live-m365-opencode-provider-"));
const xvfbLogPath = join(artifactsDir, "xvfb.log");
const edgeLogPath = join(artifactsDir, "edge-start.log");
const copilotLogPath = join(artifactsDir, "copilot-server.log");
const opencodeTextStdoutPath = join(artifactsDir, "opencode-text.stdout.log");
const opencodeTextStderrPath = join(artifactsDir, "opencode-text.stderr.log");
const opencodeToolStdoutPath = join(artifactsDir, "opencode-tool.stdout.log");
const opencodeToolStderrPath = join(artifactsDir, "opencode-tool.stderr.log");
const toolRepairArtifactDir = join(artifactsDir, "tool-repair-artifacts");
const statusPath = join(artifactsDir, "copilot-status.json");
const reportPath = join(artifactsDir, "report.json");

const cdpPort = Number.parseInt(process.env.RELAY_EDGE_CDP_PORT || "9360", 10);
const providerPort = Number.parseInt(process.env.RELAY_OPENCODE_PROVIDER_PORT || "18180", 10);
const token = process.env.RELAY_AGENT_API_KEY || randomUUID();
const expected = process.env.RELAY_OPENCODE_LIVE_EXPECTED || "OPEN_CODE_M365_PROVIDER_OK";
const toolExpected = process.env.RELAY_OPENCODE_LIVE_TOOL_EXPECTED || "OPEN_CODE_M365_TOOL_OK";
const toolMarker = process.env.RELAY_OPENCODE_LIVE_TOOL_MARKER || toolExpected;
const textTimeoutMs = Number.parseInt(process.env.RELAY_OPENCODE_LIVE_TIMEOUT_MS || "420000", 10);
const toolTimeoutMs = Number.parseInt(
  process.env.RELAY_OPENCODE_LIVE_TOOL_TIMEOUT_MS || process.env.RELAY_OPENCODE_LIVE_TIMEOUT_MS || "720000",
  10,
);

let xvfbChild = null;
let copilotChild = null;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stopDetachedChild(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

async function cleanup() {
  stopDetachedChild(copilotChild);
  if (xvfbChild) stopDetachedChild(xvfbChild);
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const { response, text } = await fetchText(url, options);
  let json = null;
  if (text.trim()) {
    json = JSON.parse(text);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 1000)}`);
  }
  return json;
}

async function waitForHttpJson(url, timeoutMs, options = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function ensureVirtualDisplay() {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    return process.env.DISPLAY ?? null;
  }
  const preferred = process.env.RELAY_LIVE_XVFB_DISPLAY || ":99";
  if (displaySocketExists(preferred)) {
    return preferred;
  }
  const displayValue = firstAvailableDisplay(preferred);
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
    throw new Error(`Xvfb exited early with code ${xvfbChild.exitCode}. See ${xvfbLogPath}`);
  }
  return displayValue;
}

function displaySocketExists(displayValue) {
  const match = String(displayValue || "").match(/^:(\d+)$/);
  if (!match) return false;
  return existsSync(`/tmp/.X11-unix/X${match[1]}`);
}

function firstAvailableDisplay(preferred) {
  if (!displaySocketExists(preferred)) return preferred;
  for (let index = 90; index <= 120; index++) {
    const candidate = `:${index}`;
    if (!displaySocketExists(candidate)) return candidate;
  }
  throw new Error("No free Xvfb display found in :90-:120");
}

function startEdge(displayValue) {
  const env = {
    ...process.env,
    RELAY_EDGE_CDP_PORT: String(cdpPort),
    RELAY_OPENAI_TOOL_REPAIR_ARTIFACT_DIR:
      process.env.RELAY_OPENAI_TOOL_REPAIR_ARTIFACT_DIR || toolRepairArtifactDir,
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

async function startCopilotServer(displayValue) {
  const scriptPath = join(appRoot, "src-tauri/binaries/copilot_server.js");
  const logStream = createWriteStream(copilotLogPath, { flags: "a" });
  const env = {
    ...process.env,
    RELAY_EDGE_CDP_PORT: String(cdpPort),
  };
  if (displayValue) env.DISPLAY = displayValue;
  copilotChild = spawn(
    process.execPath,
    [
      "--no-warnings",
      scriptPath,
      "--port",
      String(providerPort),
      "--cdp-port",
      String(cdpPort),
      "--boot-token",
      token,
      "--instance-id",
      randomUUID(),
    ],
    {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  copilotChild.stdout?.pipe(logStream);
  copilotChild.stderr?.pipe(logStream);
  copilotChild.unref();
  await waitForHttpJson(`http://127.0.0.1:${providerPort}/health`, 60_000);
}

async function runOpenCode(baseURL, workspace, xdg, prompt, stdoutPath, stderrPath, timeoutMs) {
  return await new Promise((resolveRun) => {
    const child = spawn(
      bunPath,
      [
        "dev",
        "run",
        "--pure",
        "--print-logs",
        "--log-level",
        "DEBUG",
        "--format",
        "json",
        "--model",
        "relay-agent/m365-copilot",
        "--dir",
        workspace,
        prompt,
      ],
      {
        cwd: opencodeRepo,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${dirname(bunPath)}:${process.env.PATH || ""}`,
          RELAY_AGENT_API_KEY: token,
          XDG_CONFIG_HOME: xdg.config,
          XDG_DATA_HOME: xdg.data,
          XDG_STATE_HOME: xdg.state,
          XDG_CACHE_HOME: xdg.cache,
          OPENCODE_DISABLE_UPDATE_CHECK: "1",
        },
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      writeFileSync(stdoutPath, stdout, "utf8");
      writeFileSync(stderrPath, stderr, "utf8");
      resolveRun({ code, signal, stdout, stderr, baseURL });
    });
  });
}

function parseJsonLines(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function summarizeOpenCodeResult(result) {
  const events = parseJsonLines(result.stdout);
  const errorEvents = events.filter((event) => event.type === "error");
  const toolEvents = events.filter((event) => event.type === "tool_use" || event.part?.type === "tool");
  const assistantText = events
    .flatMap((event) => [
      event.part?.text,
      event.part?.content,
      event.message?.content,
      event.message?.text,
    ])
    .filter((value) => typeof value === "string")
    .join("\n");
  return {
    events,
    errorEvents,
    toolEvents,
    assistantText,
  };
}

async function main() {
  const displayValue = await ensureVirtualDisplay();
  startEdge(displayValue);
  await startCopilotServer(displayValue);

  const baseURL = `http://127.0.0.1:${providerPort}/v1`;
  const status = await fetchJson(`http://127.0.0.1:${providerPort}/status`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 120_000,
  });
  writeJson(statusPath, status);
  if (status?.connected !== true) {
    throw new Error(`Relay provider is not connected to M365 Copilot: ${status?.error || "unknown status error"}. See ${statusPath} and ${copilotLogPath}`);
  }
  if (status?.loginRequired) {
    throw new Error(`M365 Copilot login is required. See ${statusPath} and ${copilotLogPath}`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "relay-live-opencode-provider-workspace-"));
  const workspace = join(tempRoot, "workspace");
  const xdg = {
    config: join(tempRoot, "xdg-config"),
    data: join(tempRoot, "xdg-data"),
    state: join(tempRoot, "xdg-state"),
    cache: join(tempRoot, "xdg-cache"),
  };
  mkdirSync(workspace, { recursive: true });
  mkdirSync(xdg.config, { recursive: true });
  mkdirSync(xdg.data, { recursive: true });
  mkdirSync(xdg.state, { recursive: true });
  mkdirSync(xdg.cache, { recursive: true });
  mkdirSync(toolRepairArtifactDir, { recursive: true });
  const toolFixturePath = join(workspace, "relay_live_tool_fixture.txt");
  writeFileSync(toolFixturePath, `${toolMarker}\n`, "utf8");
  writeFileSync(
    join(workspace, "opencode.json"),
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        enabled_providers: ["relay-agent"],
        provider: {
          "relay-agent": {
            npm: "@ai-sdk/openai-compatible",
            name: "Relay Agent / M365 Copilot",
            options: {
              baseURL,
              apiKey: "{env:RELAY_AGENT_API_KEY}",
            },
            models: {
              "m365-copilot": {
                name: "M365 Copilot",
                limit: {
                  context: 128000,
                  output: 8192,
                },
              },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const textResult = await runOpenCode(
    baseURL,
    workspace,
    xdg,
    `Reply with exactly this text and no extra words: ${expected}`,
    opencodeTextStdoutPath,
    opencodeTextStderrPath,
    textTimeoutMs,
  );
  const toolResult = await runOpenCode(
    baseURL,
    workspace,
    xdg,
    `Use the read tool to read ${toolFixturePath}. After the tool result is available, reply exactly ${toolExpected} and no extra words.`,
    opencodeToolStdoutPath,
    opencodeToolStderrPath,
    toolTimeoutMs,
  );
  const textCombined = `${textResult.stdout}\n${textResult.stderr}`;
  const toolCombined = `${toolResult.stdout}\n${toolResult.stderr}`;
  const textSummary = summarizeOpenCodeResult(textResult);
  const toolSummary = summarizeOpenCodeResult(toolResult);
  const readToolCompleted = toolSummary.toolEvents.some((event) => {
    const part = event.part || {};
    const state = part.state || {};
    return (
      part.tool === "read" &&
      state.status === "completed" &&
      String(state.output || "").includes(toolMarker)
    );
  });
  const textPassed =
    textResult.code === 0 &&
    textSummary.errorEvents.length === 0 &&
    (textSummary.assistantText.includes(expected) || textCombined.includes(expected));
  const toolPassed =
    toolResult.code === 0 &&
    toolSummary.errorEvents.length === 0 &&
    readToolCompleted &&
    (toolSummary.assistantText.includes(toolExpected) || toolCombined.includes(toolExpected));
  const passed = textPassed && toolPassed;
  const report = {
    result: passed ? "passed" : "failed",
    artifactsDir,
    display: displayValue,
    cdpPort,
    providerPort,
    providerBaseURL: baseURL,
    workspace,
    toolFixturePath,
    timeouts: {
      textTimeoutMs,
      toolTimeoutMs,
    },
    copilotStatus: status,
    opencode: {
      text: {
        result: textPassed ? "passed" : "failed",
        exitCode: textResult.code,
        signal: textResult.signal,
        stdoutPath: opencodeTextStdoutPath,
        stderrPath: opencodeTextStderrPath,
        stdoutTail: textResult.stdout.slice(-2000),
        stderrTail: textResult.stderr.slice(-2000),
        errorEvents: textSummary.errorEvents,
        assistantText: textSummary.assistantText.slice(-2000),
      },
      tool: {
        result: toolPassed ? "passed" : "failed",
        exitCode: toolResult.code,
        signal: toolResult.signal,
        stdoutPath: opencodeToolStdoutPath,
        stderrPath: opencodeToolStderrPath,
        stdoutTail: toolResult.stdout.slice(-2000),
        stderrTail: toolResult.stderr.slice(-2000),
        errorEvents: toolSummary.errorEvents,
        assistantText: toolSummary.assistantText.slice(-2000),
        readToolCompleted,
        toolEvents: toolSummary.toolEvents,
      },
    },
    copilotLogPath,
    edgeLogPath,
    toolRepairArtifactDir,
    expected,
    toolExpected,
    toolMarker,
  };
  writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
  if (process.env.RELAY_KEEP_OPENCODE_LIVE_SMOKE_DIR !== "1") {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

process.on("exit", () => {
  stopDetachedChild(copilotChild);
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

try {
  await main();
} finally {
  await cleanup();
}
