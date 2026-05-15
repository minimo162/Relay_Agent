#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const token = "relay-ux-e2e-token";
const port = 17894;
const debugPort = 17994;
const dataDir = mkdtempSync(join(tmpdir(), "relay-ux-e2e-data-"));
const edgeProfile = mkdtempSync(join(tmpdir(), "relay-ux-e2e-edge-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-ux-e2e-workspace-"));
const artifactDir = join(process.cwd(), "dist", "e2e");
const edgePath = process.env.RELAY_E2E_EDGE ?? "/usr/bin/microsoft-edge";

mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(workspace, "seed.txt"), "部品売上 seed\n", "utf8");

const responses = [
  JSON.stringify({ action: "tool", tool: "rg_files", args: { contains: "seed", limit: 5 } }),
  JSON.stringify({ action: "final", answer: "検索は rg_files を使いました。" }),
  JSON.stringify({ action: "tool", tool: "write", args: { path: "approval.txt", content: "approved write" } }),
  JSON.stringify({ action: "final", answer: "承認済みの書き込みを実行しました。" }),
];

const sidecar = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSES_JSON: JSON.stringify(responses),
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
      if (response.ok) return;
    } catch {
      // Wait for Kestrel.
    }
    await sleep(250);
  }
  throw new Error(`sidecar did not become ready; stderr=${sidecarStderr}`);
}

async function waitForCdpTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
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
  throw new Error("Edge CDP target did not become ready");
}

function cdpSend(method, params = {}) {
  const id = nextId;
  nextId += 1;
  cdp.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

async function evaluate(expression, returnByValue = true) {
  const result = await cdpSend("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue,
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
      body: document.body?.innerText?.slice(0, 500) ?? "",
      readiness: document.querySelector('#readiness')?.textContent ?? null
    }))()`).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}; lastState=${JSON.stringify(lastState)}`);
}

async function setValue(selector, value) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error("missing selector: ${selector}");
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
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

async function runBrowserFlow() {
  edge = spawn(edgePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${edgeProfile}`,
    `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let edgeStderr = "";
  edge.stderr.on("data", (chunk) => {
    edgeStderr += chunk.toString();
  });

  const wsUrl = await waitForCdpTarget().catch((error) => {
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
  await waitForExpression("['Ready','Limited','Not ready'].includes(document.querySelector('#readiness')?.textContent)", 5000, "readiness status");

  const initialUx = await evaluate(`(() => ({
    title: document.querySelector('h1')?.textContent,
    detailsOpen: document.querySelector('.details')?.open,
    hasLegacyModes: document.body.textContent.includes('資料を探す') || document.body.textContent.includes('Officeファイルを編集する') || document.body.textContent.includes('コードを書く'),
    readiness: document.querySelector('#readiness')?.textContent,
    sendText: document.querySelector('#send')?.textContent,
    shellWidth: Math.round(document.querySelector('.shell')?.getBoundingClientRect().width ?? 0),
  }))()`);
  if (initialUx.title !== "Workbench") throw new Error(`unexpected title: ${JSON.stringify(initialUx)}`);
  if (initialUx.detailsOpen !== false) throw new Error(`details should be collapsed by default: ${JSON.stringify(initialUx)}`);
  if (initialUx.hasLegacyModes) throw new Error(`legacy mode labels should not be visible: ${JSON.stringify(initialUx)}`);
  if (!["Ready", "Limited"].includes(initialUx.readiness)) throw new Error(`Copilot-backed UX should be ready or limited: ${JSON.stringify(initialUx)}`);
  if (initialUx.sendText !== "送信") throw new Error(`unexpected send label: ${JSON.stringify(initialUx)}`);
  if (initialUx.shellWidth > 1100) throw new Error(`shell is too wide for focused workbench UX: ${JSON.stringify(initialUx)}`);

  await captureScreenshot("workbench-empty.png");

  await setValue("#workspace", workspace);
  await setValue("#instruction", "seed を探して");
  const searchStarted = Date.now();
  await click("#send");
  await waitForExpression("Array.from(document.querySelectorAll('#events li')).some((el) => el.textContent.includes('検索は rg_files を使いました。'))", 6000, "search final event");
  const searchMs = Date.now() - searchStarted;
  if (searchMs > 6000) throw new Error(`mock search UX took too long: ${searchMs}ms`);

  await captureScreenshot("workbench-completed.png");

  await setValue("#instruction", "approval.txt を作って");
  const approvalStarted = Date.now();
  await click("#send");
  await waitForExpression("document.querySelector('#approval') && !document.querySelector('#approval').hidden", 6000, "approval panel");
  const approvalMs = Date.now() - approvalStarted;
  if (approvalMs > 6000) throw new Error(`approval UX took too long: ${approvalMs}ms`);
  if (existsSync(join(workspace, "approval.txt"))) throw new Error("write executed before approval");

  await captureScreenshot("workbench-approval.png");
  await click("#approval button");
  await waitForExpression("Array.from(document.querySelectorAll('#events li')).some((el) => el.textContent.includes('承認済みの書き込みを実行しました。'))", 6000, "approval final event");
  if (readFileSync(join(workspace, "approval.txt"), "utf8") !== "approved write") {
    throw new Error("approved file content mismatch");
  }

  const finalUx = await evaluate(`(() => ({
    approvalHidden: document.querySelector('#approval')?.hidden,
    detailsOpen: document.querySelector('.details')?.open,
    eventCount: document.querySelectorAll('#events li').length,
  }))()`);
  if (finalUx.approvalHidden !== true) throw new Error(`approval panel should hide after completion: ${JSON.stringify(finalUx)}`);
  if (finalUx.detailsOpen !== false) throw new Error(`details should remain collapsed: ${JSON.stringify(finalUx)}`);
  if (finalUx.eventCount < 3) throw new Error(`expected visible event trace: ${JSON.stringify(finalUx)}`);

  return { searchMs, approvalMs, screenshots: ["workbench-empty.png", "workbench-completed.png", "workbench-approval.png"] };
}

try {
  await waitForStatus();
  const result = await runBrowserFlow();
  console.log(`[workbench-ux-e2e] ok search=${result.searchMs}ms approval=${result.approvalMs}ms screenshots=${result.screenshots.join(",")}`);
} finally {
  if (cdp) cdp.close();
  if (edge) edge.kill("SIGTERM");
  sidecar.kill("SIGTERM");
}
