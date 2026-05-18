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
  JSON.stringify({ action: "tool", tool: "glob", args: { pattern: "**/*seed*", limit: 5 } }),
  JSON.stringify({ action: "final", answer: "検索は glob を使いました。" }),
  JSON.stringify({ action: "tool", tool: "write", args: { file_path: "approval.txt", content: "approved write" } }),
  JSON.stringify({ action: "final", answer: "承認済みの書き込みを実行しました。" }),
  JSON.stringify({ action: "tool", tool: "write", args: { file_path: "rejected.txt", content: "should not write" } }),
  JSON.stringify({ action: "final", answer: "書き込みは実行しませんでした。" }),
  "{not valid json",
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
      body: document.body?.innerText?.slice(0, 900) ?? "",
      readiness: document.querySelector('#readiness')?.textContent ?? null,
      chatInput: Boolean(document.querySelector('[data-testid="copilot-chat-textarea"]')),
      sendButton: Boolean(document.querySelector('[data-testid="copilot-send-button"]')),
    }))()`).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}; lastState=${JSON.stringify(lastState)}`);
}

async function setValue(selector, value) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error(${JSON.stringify(`missing selector: ${selector}`)});
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (!setter) throw new Error(${JSON.stringify(`missing native value setter: ${selector}`)});
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function click(selector) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error(${JSON.stringify(`missing selector: ${selector}`)});
    el.click();
    return true;
  })()`);
}

async function clickVisible(selector, text = "") {
  await evaluate(`(() => {
    const candidates = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const el = candidates.find((node) =>
      node instanceof HTMLElement &&
      node.offsetParent !== null &&
      (!${JSON.stringify(text)} || node.textContent.includes(${JSON.stringify(text)}))
    );
    if (!el) throw new Error("missing visible selector: ${selector} ${text}");
    el.click();
    return true;
  })()`);
}

async function sendChat(message) {
  await setValue('[data-testid="copilot-chat-textarea"]', message);
  await waitForExpression(`!document.querySelector('[data-testid="copilot-send-button"]')?.disabled`, 2000, "CopilotKit send enabled");
  await click('[data-testid="copilot-send-button"]');
}

async function captureScreenshot(name) {
  const screenshot = await cdpSend("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(artifactDir, name), Buffer.from(screenshot.data, "base64"));
}

async function setViewport(width, height, mobile = false) {
  await cdpSend("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
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
  await setViewport(1440, 1000);
  await cdpSend("Page.navigate", { url: `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}` });

  await waitForExpression("document.readyState === 'complete'", 5000, "page load");
  await waitForExpression("document.querySelector('#readiness')?.textContent === 'Ready'", 6000, "automatic Ready readiness");

  const initialUx = await evaluate(`(() => ({
    title: document.querySelector('h1')?.textContent,
    detailsOpen: document.querySelector('.details')?.open,
    hasLegacyModes: document.body.textContent.includes('資料を探す') || document.body.textContent.includes('Officeファイルを編集する') || document.body.textContent.includes('コードを書く'),
    hasOldComposer: Boolean(document.querySelector('#instruction') || document.querySelector('#send') || document.querySelector('#events')),
    readiness: document.querySelector('#readiness')?.textContent,
    shellWidth: Math.round(document.querySelector('.shell')?.getBoundingClientRect().width ?? 0),
    workspaceChange: document.querySelector('#workspace-change')?.textContent,
    workspaceText: document.querySelector('#workspace')?.textContent,
    visibleWorkspaceInput: Boolean(document.querySelector('input.workspace-input')?.offsetParent),
    bodyWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))()`);
  if (initialUx.title !== "Chat") throw new Error(`unexpected title: ${JSON.stringify(initialUx)}`);
  if (initialUx.detailsOpen !== false) throw new Error(`details should be collapsed by default: ${JSON.stringify(initialUx)}`);
  if (initialUx.hasLegacyModes || initialUx.hasOldComposer) throw new Error(`legacy UI should not be visible: ${JSON.stringify(initialUx)}`);
  if (initialUx.readiness !== "Ready") throw new Error(`readiness should be Ready: ${JSON.stringify(initialUx)}`);
  if (!initialUx.workspaceChange?.includes("フォルダを選択")) throw new Error(`workspace picker action is missing: ${JSON.stringify(initialUx)}`);
  if (initialUx.workspaceText !== "未選択") throw new Error(`workspace should start as unselected: ${JSON.stringify(initialUx)}`);
  if (initialUx.visibleWorkspaceInput) throw new Error(`manual workspace path input should not be visible: ${JSON.stringify(initialUx)}`);
  if (initialUx.shellWidth > 1100) throw new Error(`shell is too wide for chatbot UX: ${JSON.stringify(initialUx)}`);
  if (initialUx.bodyWidth > initialUx.viewportWidth) throw new Error(`initial UI has horizontal overflow: ${JSON.stringify(initialUx)}`);

  await captureScreenshot("workbench-chat-empty.png");

  await click("#workspace-change");
  await waitForExpression(`document.querySelector('#workspace-path')?.value === ${JSON.stringify(workspace)}`, 4000, "workspace picker selection");
  await waitForExpression("Boolean(document.querySelector('[data-testid=\"copilot-chat-textarea\"]'))", 5000, "CopilotKit textarea");
  await waitForExpression("Boolean(document.querySelector('[data-testid=\"copilot-send-button\"]'))", 5000, "CopilotKit send button");

  const searchStarted = Date.now();
  await sendChat("seed を探して");
  await waitForExpression("document.body.innerText.includes('検索は glob を使いました。')", 8000, "search final answer");
  const searchMs = Date.now() - searchStarted;
  if (searchMs > 8000) throw new Error(`mock search UX took too long: ${searchMs}ms`);

  const resultUx = await evaluate(`(() => ({
    hasFinal: document.body.innerText.includes('検索は glob を使いました。'),
    hasTool: document.body.innerText.includes('glob'),
    rawPrimaryText: document.querySelector('.chat-card')?.innerText ?? '',
  }))()`);
  if (!resultUx.hasFinal || !resultUx.hasTool) {
    throw new Error(`final answer/tool card should be visible in chat: ${JSON.stringify(resultUx)}`);
  }
  if (resultUx.rawPrimaryText.includes('"toolCallId"') || resultUx.rawPrimaryText.includes('"threadId"')) {
    throw new Error(`primary chat should not expose raw AG-UI JSON: ${JSON.stringify(resultUx)}`);
  }

  await captureScreenshot("workbench-chat-completed.png");

  await sendChat("approval.txt を作って");
  await waitForExpression(`
    Array.from(document.querySelectorAll('.approval-card')).some((card) =>
      card.textContent.includes('approval.txt') &&
      Array.from(card.querySelectorAll('button')).some((button) => button.textContent.includes('実行する')) &&
      Array.from(card.querySelectorAll('button')).some((button) => button.textContent.includes('実行しない'))
    )
  `, 8000, "approval card");
  if (existsSync(join(workspace, "approval.txt"))) throw new Error("write executed before approval");

  const approvalUx = await evaluate(`(() => ({
    hasApprove: Array.from(document.querySelectorAll('.approval-card button')).some((button) => button.textContent.includes('実行する')),
    hasReject: Array.from(document.querySelectorAll('.approval-card button')).some((button) => button.textContent.includes('実行しない')),
    targetText: Array.from(document.querySelectorAll('.approval-card')).find((card) => card.textContent.includes('approval.txt'))?.textContent ?? '',
  }))()`);
  if (approvalUx.hasApprove !== true || approvalUx.hasReject !== true || !approvalUx.targetText.includes("approval.txt")) {
    throw new Error(`approval UX is incomplete: ${JSON.stringify(approvalUx)}`);
  }

  await captureScreenshot("workbench-chat-approval.png");
  await clickVisible(".approval-card .primary-button", "実行する");
  await waitForExpression("document.body.innerText.includes('承認済みの書き込みを実行しました。')", 8000, "approval final answer");
  if (readFileSync(join(workspace, "approval.txt"), "utf8") !== "approved write") {
    throw new Error("approved file content mismatch");
  }

  await sendChat("rejected.txt を作って");
  await waitForExpression(`
    Array.from(document.querySelectorAll('.approval-card')).some((card) =>
      card.textContent.includes('rejected.txt') &&
      Array.from(card.querySelectorAll('button')).some((button) => button.textContent.includes('実行しない'))
    )
  `, 8000, "rejection approval card");
  await clickVisible(".approval-card .secondary-button", "実行しない");
  await waitForExpression("document.body.innerText.includes('書き込みは実行しませんでした。')", 8000, "rejection final answer");
  if (existsSync(join(workspace, "rejected.txt"))) throw new Error("rejected write executed unexpectedly");

  await sendChat("壊れた応答を確認して");
  await waitForExpression("document.body.innerText.includes('invalid') || document.body.innerText.includes('失敗') || document.body.innerText.includes('error')", 8000, "visible failure state");

  const finalUx = await evaluate(`(() => ({
    detailsOpen: document.querySelector('.details')?.open,
    bodyWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))()`);
  if (finalUx.detailsOpen !== false) throw new Error(`details should remain collapsed: ${JSON.stringify(finalUx)}`);
  if (finalUx.bodyWidth > finalUx.viewportWidth) throw new Error(`desktop UI has horizontal overflow: ${JSON.stringify(finalUx)}`);

  await setViewport(390, 900, true);
  await waitForExpression("Boolean(document.querySelector('.chat-card') && document.querySelector('[data-testid=\"copilot-send-button\"]'))", 2000, "mobile layout");
  const mobileUx = await evaluate(`(() => ({
    bodyWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    chatWidth: Math.round(document.querySelector('.chat-card')?.getBoundingClientRect().width ?? 0),
    detailsOpen: document.querySelector('.details')?.open,
  }))()`);
  if (mobileUx.bodyWidth > mobileUx.viewportWidth) throw new Error(`mobile UI has horizontal overflow: ${JSON.stringify(mobileUx)}`);
  if (mobileUx.chatWidth < 320) throw new Error(`mobile chat is too cramped: ${JSON.stringify(mobileUx)}`);
  if (mobileUx.detailsOpen !== false) throw new Error(`details should remain collapsed on mobile: ${JSON.stringify(mobileUx)}`);
  await captureScreenshot("workbench-chat-mobile.png");

  for (const [width, height] of [[768, 920], [1024, 900]]) {
    await setViewport(width, height, false);
    await waitForExpression("Boolean(document.querySelector('.chat-card') && document.querySelector('[data-testid=\"copilot-chat-textarea\"]'))", 2000, `responsive layout ${width}`);
    const viewportUx = await evaluate(`(() => ({
      bodyWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      chatWidth: Math.round(document.querySelector('.chat-card')?.getBoundingClientRect().width ?? 0),
      detailsOpen: document.querySelector('.details')?.open,
      legacyModes: document.body.textContent.includes('資料を探す') || document.body.textContent.includes('Officeファイルを編集する') || document.body.textContent.includes('コードを書く')
    }))()`);
    if (viewportUx.bodyWidth > viewportUx.viewportWidth) {
      throw new Error(`responsive UI has horizontal overflow at ${width}: ${JSON.stringify(viewportUx)}`);
    }
    if (viewportUx.chatWidth < Math.min(560, width - 48)) {
      throw new Error(`chat is too cramped at ${width}: ${JSON.stringify(viewportUx)}`);
    }
    if (viewportUx.detailsOpen !== false || viewportUx.legacyModes) {
      throw new Error(`responsive minimal UX regression at ${width}: ${JSON.stringify(viewportUx)}`);
    }
  }

  return {
    searchMs,
    screenshots: [
      "workbench-chat-empty.png",
      "workbench-chat-completed.png",
      "workbench-chat-approval.png",
      "workbench-chat-mobile.png",
    ],
  };
}

try {
  await waitForStatus();
  const result = await runBrowserFlow();
  console.log(`[workbench-ux-e2e] ok search=${result.searchMs}ms screenshots=${result.screenshots.join(",")}`);
} finally {
  if (cdp) cdp.close();
  if (edge) edge.kill("SIGTERM");
  sidecar.kill("SIGTERM");
}
