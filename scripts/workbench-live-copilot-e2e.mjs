#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { ensureCopilotCdp } from "./lib/copilot-cdp.mjs";

const root = resolve(import.meta.dirname, "..");
const token = "relay-live-copilot-e2e-token";
const port = Number(process.env.RELAY_LIVE_COPILOT_SIDECAR_PORT ?? "17895");
const workbenchDebugPort = Number(process.env.RELAY_LIVE_COPILOT_WORKBENCH_CDP_PORT ?? "17995");
let copilotCdpPort = Number(process.env.RELAY_LIVE_COPILOT_CDP_PORT ?? process.env.RELAY_COPILOT_CDP_PORT ?? "9360");
const edgePath = process.env.RELAY_E2E_EDGE ?? "/usr/bin/microsoft-edge-stable";
const dataDir = mkdtempSync(join(tmpdir(), "relay-live-copilot-e2e-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-live-copilot-e2e-workspace-"));
const workbenchProfile = mkdtempSync(join(tmpdir(), "relay-live-copilot-e2e-edge-"));
const artifactDir = join(root, "dist", "e2e", "live-copilot");
const expected = "live copilot ok";

mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(workspace, "seed.txt"), "Relay live Copilot bridge workspace\n", "utf8");

const appServerCommand = await ensureAppServerRuntime();
const cdpLease = await ensureCopilotCdp({ preferredPort: copilotCdpPort, artifactDir });
copilotCdpPort = cdpLease.port;

const sidecar = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: root,
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(root, "apps/sidecar/wwwroot"),
    RELAY_WORKSPACE_PICKER_MOCK_PATH: workspace,
    RELAY_COPILOT_CDP_PORT: String(copilotCdpPort),
    RELAY_COPILOT_FRESH_TARGET: "1",
    RELAY_COPILOT_REPLY_TIMEOUT_SECONDS: process.env.RELAY_LIVE_COPILOT_REPLY_TIMEOUT_SECONDS ?? "120",
    RELAY_COPILOT_PROMPT_DUMP_DIR: join(artifactDir, "prompts"),
    RELAY_COPILOT_RESPONSE_DUMP_DIR: join(artifactDir, "responses"),
    RELAY_APP_SERVER_COMMAND: appServerCommand,
    RELAY_APP_SERVER_ARGS_JSON: JSON.stringify(["app-server"]),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let sidecarStdout = "";
let sidecarStderr = "";
sidecar.stdout.on("data", (chunk) => {
  sidecarStdout += chunk.toString();
  if (sidecarStdout.length > 20000) sidecarStdout = sidecarStdout.slice(-20000);
});
sidecar.stderr.on("data", (chunk) => {
  sidecarStderr += chunk.toString();
  if (sidecarStderr.length > 20000) sidecarStderr = sidecarStderr.slice(-20000);
});

let edge;
let cdp;
let nextId = 1;
const pending = new Map();

try {
  await waitForStatus();
  const result = await runWorkbenchFlow();
  writeFileSync(join(artifactDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`[workbench-live-copilot-e2e] ok elapsed=${result.elapsedMs}ms readiness=${result.readiness} cdp=${copilotCdpPort}`);
} catch (error) {
  await dumpFailureArtifacts(error).catch(() => undefined);
  const classification = classifyLiveCopilotFailure(error);
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`[workbench-live-copilot-e2e:${classification}] ${message}`);
} finally {
  if (cdp) cdp.close();
  if (edge) edge.kill("SIGTERM");
  sidecar.kill("SIGTERM");
  cdpLease.cleanup?.();
}

async function ensureAppServerRuntime() {
  const rid = process.platform === "win32" ? "win-x64" : process.platform === "linux" ? "linux-x64" : null;
  if (!rid) throw new Error(`unsupported platform for bundled app-server live E2E: ${process.platform}`);
  const executable = join(root, "tools", "codex-app-server", rid, process.platform === "win32" ? "codex.exe" : "codex");
  if (!existsSync(executable)) {
    const script = rid === "win-x64" ? "appserver:fetch:windows" : "appserver:fetch:linux";
    const result = spawnSync("pnpm", [script], { cwd: root, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`${script} failed with ${result.status}`);
  }
  if (!existsSync(executable)) throw new Error(`Codex app-server executable is missing: ${executable}`);
  return executable;
}

async function waitForStatus() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`, {
        headers: { "X-Relay-Token": token },
      });
      if (response.ok) {
        const status = await response.json();
        const copilot = status.checks?.find((check) => check.name === "copilot-cdp");
        if (copilot?.ready) return status;
        if (attempt > 30) {
          throw new Error(`Copilot readiness failed: ${JSON.stringify(status)}`);
        }
      }
    } catch (error) {
      if (attempt > 30 && error instanceof Error && error.message.includes("Copilot readiness failed")) throw error;
    }
    await sleep(250);
  }
  throw new Error(`sidecar did not become ready; stdout=${sidecarStdout}; stderr=${sidecarStderr}`);
}

async function runWorkbenchFlow() {
  edge = spawn(edgePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--remote-debugging-port=${workbenchDebugPort}`,
    `--user-data-dir=${workbenchProfile}`,
    `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let edgeStderr = "";
  edge.stderr.on("data", (chunk) => {
    edgeStderr += chunk.toString();
    if (edgeStderr.length > 20000) edgeStderr = edgeStderr.slice(-20000);
  });

  const wsUrl = await waitForWorkbenchCdpTarget().catch((error) => {
    throw new Error(`${error.message}; edge stderr=${edgeStderr}`);
  });

  cdp = new WebSocket(wsUrl);
  cdp.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
  });
  await new Promise((resolve, reject) => {
    cdp.once("open", resolve);
    cdp.once("error", reject);
  });

  await cdpSend("Runtime.enable");
  await cdpSend("Page.enable");
  await cdpSend("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdpSend("Page.navigate", { url: `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}` });

  await waitForExpression("document.readyState === 'complete'", 5000, "page load");
  await waitForExpression("['Ready','Bridge starting'].some((label) => document.querySelector('#readiness')?.textContent?.includes(label))", 20000, "bridge readiness");
  await click("#workspace-change");
  await waitForExpression(`document.querySelector('#workspace')?.textContent === ${JSON.stringify(workspace)}`, 5000, "workspace picker selection");

  const instruction = [
    "Live Relay Bridge E2Eです。",
    "ローカルツールは不要です。",
    `最終回答本文として ${expected} とだけ返してください。`,
    "余計な説明、Markdown、JSONは不要です。",
  ].join("\n");
  await setValue("#instruction", instruction);

  const started = Date.now();
  await click("#send");
  await waitForExpression(
    `Array.from(document.querySelectorAll('.message.assistant')).some((el) => el.textContent?.includes(${JSON.stringify(expected)}))`,
    180000,
    "live Copilot final answer",
  );
  const elapsedMs = Date.now() - started;
  await captureScreenshot("workbench-live-copilot-completed.png");
  const state = await evaluate(`(() => ({
    readiness: document.querySelector('#readiness')?.textContent ?? null,
    workspace: document.querySelector('#workspace')?.textContent ?? null,
    messages: document.querySelector('#messages')?.innerText ?? '',
    activity: document.querySelector('#events')?.innerText ?? '',
    error: document.querySelector('[role="alert"]')?.textContent ?? ''
  }))()`);
  if (state.error) throw new Error(`Workbench showed an error: ${JSON.stringify(state)}`);
  return { elapsedMs, readiness: state.readiness, workspace: state.workspace, activity: state.activity };
}

async function waitForWorkbenchCdpTarget() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${workbenchDebugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) =>
          target.type === "page" &&
          target.webSocketDebuggerUrl &&
          String(target.url ?? "").includes(`127.0.0.1:${port}`),
        ) ?? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Wait for Edge.
    }
    await sleep(250);
  }
  throw new Error("Workbench Edge CDP target did not become ready");
}

function cdpSend(method, params = {}) {
  const id = nextId;
  nextId += 1;
  cdp.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

async function evaluate(expression) {
  const result = await cdpSend("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result?.value;
}

async function waitForExpression(expression, timeoutMs, label) {
  const started = Date.now();
  let lastState = undefined;
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(expression).catch(() => false);
    if (value) return value;
    lastState = await evaluate(`(() => ({
      href: location.href,
      readyState: document.readyState,
      readiness: document.querySelector('#readiness')?.textContent ?? null,
      workspace: document.querySelector('#workspace')?.textContent ?? null,
      messages: document.querySelector('#messages')?.innerText?.slice(-1200) ?? '',
      activity: document.querySelector('#events')?.innerText?.slice(-1200) ?? '',
      error: document.querySelector('[role="alert"]')?.textContent ?? ''
    }))()`).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}; lastState=${JSON.stringify(lastState)}`);
}

async function setValue(selector, value) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error(${JSON.stringify(`missing selector: ${selector}`)});
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error(${JSON.stringify(`missing native value setter: ${selector}`)});
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(250);
}

async function click(selector) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error(${JSON.stringify(`missing selector: ${selector}`)});
    el.click();
    return true;
  })()`);
  await sleep(250);
}

async function captureScreenshot(name) {
  const screenshot = await cdpSend("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(artifactDir, name), Buffer.from(screenshot.data, "base64"));
}

async function dumpFailureArtifacts(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(join(artifactDir, "failure.txt"), message, "utf8");
  writeFileSync(join(artifactDir, "sidecar-stdout.txt"), sidecarStdout, "utf8");
  writeFileSync(join(artifactDir, "sidecar-stderr.txt"), sidecarStderr, "utf8");
  writeFileSync(join(artifactDir, "workspace.txt"), `${workspace}\n`, "utf8");
  if (cdp) {
    try {
      const state = await evaluate(`(() => ({
        href: location.href,
        body: document.body?.innerText ?? '',
        readiness: document.querySelector('#readiness')?.textContent ?? null,
        workspace: document.querySelector('#workspace')?.textContent ?? null,
        error: document.querySelector('[role="alert"]')?.textContent ?? ''
      }))()`);
      writeFileSync(join(artifactDir, "failure-state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
      await captureScreenshot("workbench-live-copilot-failure.png");
    } catch {
      // Best-effort diagnostics.
    }
  }
}

function classifyLiveCopilotFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/CDP|Microsoft Edge was not found|not reachable|does not look like Microsoft Edge|Copilot readiness failed|Edge CDP target|fetch failed|ECONNREFUSED/i.test(message)) {
    return "environment";
  }
  if (/copilot_quota_limited|request limit|hourly request limit|quota|rate limit/i.test(message)) {
    return "copilot_quota";
  }
  if (/provider_response_timeout|Timed out waiting for Copilot response|Copilot response timed out/i.test(message)) {
    return "provider_response_timeout";
  }
  if (/Prompt did not reach|composer|visible length|input|send/i.test(message)) {
    return "prompt_delivery";
  }
  if (/Timed out waiting for live Copilot final answer|response completed|extract|final answer/i.test(message)) {
    return "response_extraction";
  }
  if (/invalid JSON|schema|tool projection|expected JSON|unavailable tool/i.test(message)) {
    return "schema_validation";
  }
  if (/tool|approval|workspace|execution|app-server|bridge/i.test(message)) {
    return "tool_execution";
  }
  return "unknown";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
