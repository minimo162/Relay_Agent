#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { ensureCopilotCdp } from "./lib/copilot-cdp.mjs";

const token = "relay-live-copilot-e2e-token";
const port = 17895;
const workbenchDebugPort = 17995;
let copilotCdpPort = Number(process.env.RELAY_LIVE_COPILOT_CDP_PORT ?? process.env.RELAY_COPILOT_CDP_PORT ?? "9360");
const edgePath = process.env.RELAY_E2E_EDGE ?? "/usr/bin/microsoft-edge";
const dataDir = mkdtempSync(join(tmpdir(), "relay-live-copilot-e2e-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-live-copilot-e2e-workspace-"));
const workbenchProfile = mkdtempSync(join(tmpdir(), "relay-live-copilot-e2e-edge-"));
const artifactDir = join(process.cwd(), "dist", "e2e");
const expected = "live copilot ok";

mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(workspace, "seed.txt"), "live Copilot E2E workspace\n", "utf8");

async function assertCopilotCdpAvailable() {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${copilotCdpPort}/json/version`);
  } catch (error) {
    throw new Error(`Copilot Edge CDP is not reachable on ${copilotCdpPort}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`Copilot Edge CDP is not reachable on ${copilotCdpPort}: ${response.status}`);
  const version = await response.json();
  if (!String(version.Browser ?? "").toLowerCase().includes("edg")) {
    throw new Error(`CDP port ${copilotCdpPort} does not look like Microsoft Edge: ${JSON.stringify(version)}`);
  }
}

const sidecar = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_WORKSPACE_PICKER_MOCK_PATH: workspace,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let sidecarStderr = "";
sidecar.stderr.on("data", (chunk) => {
  sidecarStderr += chunk.toString();
});

let edge;
let cdp;
let nextId = 1;
const pending = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        return status;
      }
    } catch (error) {
      if (attempt > 20 && error instanceof Error && error.message.includes("Copilot readiness failed")) throw error;
    }
    await sleep(250);
  }
  throw new Error(`sidecar did not become ready; stderr=${sidecarStderr}`);
}

async function waitForWorkbenchCdpTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
      body: document.body?.innerText?.slice(0, 1000) ?? "",
      raw: document.querySelector('#raw')?.textContent?.slice(0, 2000) ?? "",
      summary: document.querySelector('#summary-text')?.textContent?.slice(0, 1000) ?? "",
      errorText: Array.from(document.querySelectorAll('#events li.event-error')).map((el) => el.textContent).join('\\n').slice(0, 1000),
      readiness: document.querySelector('#readiness')?.textContent ?? null
    }))()`).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}; lastState=${JSON.stringify(lastState)}`);
}

async function setValue(selector, value) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error("missing selector: ${selector}");
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (!setter) throw new Error("missing native value setter: ${selector}");
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
    if (!el) throw new Error("missing selector: ${selector}");
    el.click();
    return true;
  })()`);
}

async function captureScreenshot(name) {
  const screenshot = await cdpSend("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(artifactDir, name), Buffer.from(screenshot.data, "base64"));
}

function classifyLiveCopilotFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/CDP is not reachable|does not look like Microsoft Edge|Copilot readiness failed|Edge CDP target|fetch failed|ECONNREFUSED/i.test(message)) {
    return "environment";
  }
  if (/copilot_quota_limited|request limit|hourly request limit/i.test(message)) {
    return "copilot_quota";
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
  if (/tool|officecli|ripgrep|approval|workspace|execution/i.test(message)) {
    return "tool_execution";
  }
  return "unknown";
}

async function runBrowserFlow() {
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
  await waitForExpression("['Ready','Connecting'].includes(document.querySelector('#readiness')?.textContent)", 10000, "live Copilot readiness");

  const instruction = `Live E2E test. Do not use local tools. Return exactly this JSON object and nothing else: {"action":"final","answer":"${expected}"}`;
  await click("#workspace-change");
  await waitForExpression(`document.querySelector('#workspace-path')?.value === ${JSON.stringify(workspace)}`, 5000, "workspace picker selection");
  await setValue("#instruction", instruction);

  const started = Date.now();
  await click("#send");
  await waitForExpression(`Array.from(document.querySelectorAll('#events li')).some((el) => el.textContent.includes(${JSON.stringify(expected)}))`, 120000, "live Copilot final answer");
  const elapsedMs = Date.now() - started;
  await captureScreenshot("workbench-live-copilot-completed.png");

  const ux = await evaluate(`(() => ({
    detailsOpen: document.querySelector('.details')?.open,
    errorText: Array.from(document.querySelectorAll('#events li.event-error')).map((el) => el.textContent).join('\\n'),
    eventText: document.querySelector('#events')?.innerText ?? '',
    readiness: document.querySelector('#readiness')?.textContent ?? null
  }))()`);
  if (ux.detailsOpen !== false) throw new Error(`details should remain collapsed: ${JSON.stringify(ux)}`);
  if (ux.errorText) throw new Error(`live run showed an error: ${JSON.stringify(ux)}`);

  return { elapsedMs, readiness: ux.readiness };
}

try {
  const cdpLease = await ensureCopilotCdp({ preferredPort: copilotCdpPort, artifactDir });
  copilotCdpPort = cdpLease.port;
  globalThis.__relayLiveCopilotCdpLease = cdpLease;
  await waitForStatus();
  const result = await runBrowserFlow();
  console.log(`[workbench-live-copilot-e2e] ok elapsed=${result.elapsedMs}ms readiness=${result.readiness} cdp=${copilotCdpPort}`);
} catch (error) {
  const classification = classifyLiveCopilotFailure(error);
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`[workbench-live-copilot-e2e:${classification}] ${message}`);
} finally {
  if (cdp) cdp.close();
  if (edge) edge.kill("SIGTERM");
  sidecar.kill("SIGTERM");
  globalThis.__relayLiveCopilotCdpLease?.cleanup?.();
}
