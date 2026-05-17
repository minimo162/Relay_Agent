#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

const token = "relay-live-project-e2e-token";
const port = 17897;
const workbenchDebugPort = 17997;
const copilotCdpPort = Number(process.env.RELAY_LIVE_COPILOT_CDP_PORT ?? process.env.RELAY_COPILOT_CDP_PORT ?? "9360");
const runStepTimeoutMs = Number(process.env.RELAY_LIVE_PROJECT_STEP_TIMEOUT_MS ?? "420000");
const edgePath = process.env.RELAY_E2E_EDGE ?? "/usr/bin/microsoft-edge";
const dataDir = mkdtempSync(join(tmpdir(), "relay-live-project-e2e-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-live-project-e2e-workspace-"));
const workbenchProfile = mkdtempSync(join(tmpdir(), "relay-live-project-e2e-edge-"));
const artifactDir = join(process.cwd(), "dist", "e2e", "live-project");
const stageResults = {
  createProject: { status: "not_started" },
  improveProject: { status: "not_started" },
  renderProject: { status: "not_started" },
};

mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(workspace, "seed.txt"), "Relay live project E2E workspace\n", "utf8");

const sidecar = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_COPILOT_CDP_PORT: String(copilotCdpPort),
    RELAY_COPILOT_FRESH_TARGET: "1",
    RELAY_COPILOT_REPLY_TIMEOUT_SECONDS: process.env.RELAY_LIVE_PROJECT_COPILOT_REPLY_TIMEOUT_SECONDS ?? "300",
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
      runState: document.querySelector('#run-state')?.getAttribute('data-status') ?? null,
      summary: document.querySelector('#summary-text')?.textContent?.slice(0, 1000) ?? "",
      events: document.querySelector('#events')?.innerText?.slice(-1200) ?? "",
      readiness: document.querySelector('#readiness')?.textContent ?? null
    }))()`).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    await sleep(300);
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

async function clickApproval() {
  await evaluate(`(() => {
    const panel = document.querySelector('#approval:not([hidden])');
    if (!panel) throw new Error('approval panel is not visible');
    const button = Array.from(panel.querySelectorAll('button')).find((el) => el.textContent?.includes('許可して続行'));
    if (!button) throw new Error('approval button is missing');
    button.click();
    return true;
  })()`);
}

async function captureScreenshot(name) {
  const screenshot = await cdpSend("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(artifactDir, name), Buffer.from(screenshot.data, "base64"));
}

async function readRawEvents() {
  const raw = await evaluate(`document.querySelector('#raw')?.textContent ?? '{}'`);
  try {
    return JSON.parse(raw).events ?? [];
  } catch (error) {
    throw new Error(`failed to parse Workbench raw events: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeAgUiEvents(prefix, events) {
  writeFileSync(join(artifactDir, `${prefix}-agui-events.json`), `${JSON.stringify(events, null, 2)}\n`, "utf8");
}

function writeStageResult(extra = {}) {
  writeFileSync(
    join(artifactDir, "stage-result.json"),
    `${JSON.stringify({ ...extra, stages: stageResults }, null, 2)}\n`,
    "utf8",
  );
}

async function dumpWorkbenchArtifacts(prefix) {
  if (!cdp) return;
  let parsedEvents = null;
  try {
    const raw = await evaluate(`document.querySelector('#raw')?.textContent ?? ''`);
    writeFileSync(join(artifactDir, `${prefix}-raw.json`), raw || "{}", "utf8");
    parsedEvents = JSON.parse(raw || "{}").events ?? [];
  } catch (error) {
    writeFileSync(join(artifactDir, `${prefix}-raw-error.txt`), error instanceof Error ? error.message : String(error), "utf8");
  }
  if (parsedEvents) {
    writeAgUiEvents(prefix, parsedEvents);
  }
  try {
    const state = await evaluate(`(() => ({
      href: location.href,
      readyState: document.readyState,
      runState: document.querySelector('#run-state')?.getAttribute('data-status') ?? null,
      summaryKind: document.querySelector('#summary')?.getAttribute('data-kind') ?? null,
      summaryText: document.querySelector('#summary-text')?.textContent ?? '',
      eventsText: document.querySelector('#events')?.innerText ?? '',
      approvalText: document.querySelector('#approval')?.innerText ?? ''
    }))()`);
    writeFileSync(join(artifactDir, `${prefix}-state.json`), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    writeFileSync(join(artifactDir, `${prefix}-state-error.txt`), error instanceof Error ? error.message : String(error), "utf8");
  }
  try {
    await captureScreenshot(`${prefix}.png`);
  } catch {
    // Best-effort diagnostics only.
  }
}

function collectToolNames(events) {
  return events
    .filter((event) => event.type === "TOOL_CALL_START")
    .map((event) => event.toolCallName)
    .filter(Boolean);
}

function assertNoLegacyTools(events, label) {
  const names = collectToolNames(events);
  for (const legacy of ["patch", "rg_files", "rg_search", "run_command", "office_search"]) {
    if (names.includes(legacy)) {
      throw new Error(`${label} exposed legacy tool ${legacy}: ${names.join(", ")}`);
    }
  }
}

function assertToolUsed(events, expected, label) {
  const names = collectToolNames(events);
  if (!expected.some((name) => names.includes(name))) {
    throw new Error(`${label} did not use expected tools ${expected.join("/")} (actual: ${names.join(", ")})`);
  }
}

function assertReadBeforeMutation(events, label) {
  const names = collectToolNames(events);
  const readIndex = names.indexOf("read");
  const mutationIndex = names.findIndex((name) => ["write", "edit", "apply_patch"].includes(name));
  if (readIndex < 0 || mutationIndex < 0 || readIndex > mutationIndex) {
    throw new Error(`${label} should read before mutating (actual: ${names.join(", ")})`);
  }
}

async function waitForTerminalOrApproval(timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await evaluate(`(() => ({
      status: document.querySelector('#run-state')?.getAttribute('data-status') ?? '',
      approvalVisible: !document.querySelector('#approval')?.hasAttribute('hidden'),
      summaryKind: document.querySelector('#summary')?.getAttribute('data-kind') ?? '',
      summaryText: document.querySelector('#summary-text')?.textContent ?? '',
      eventsText: document.querySelector('#events')?.innerText ?? '',
      rawErrorMessage: (() => {
        try {
          const events = JSON.parse(document.querySelector('#raw')?.textContent ?? '{}').events ?? [];
          return [...events].reverse().find((event) => event.type === 'RUN_ERROR')?.message ?? '';
        } catch {
          return '';
        }
      })()
    }))()`);
    if (state.status === "approval_required" && state.approvalVisible) return state;
    if (state.status === "failed") throw new Error(`${label} failed: ${JSON.stringify(state)}`);
    if (state.status === "completed" && state.summaryText.trim()) return state;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function runAndApproveUntilComplete(instruction, label, maxApprovals = 16) {
  await setValue("#instruction", instruction);
  await click("#send");
  let approvals = 0;

  while (true) {
    const state = await waitForTerminalOrApproval(runStepTimeoutMs, label);
    if (state.status === "completed") {
      await captureScreenshot(`${label}-completed.png`);
      const events = await readRawEvents();
      writeAgUiEvents(label, events);
      return { events, approvals, summary: state.summaryText };
    }

    approvals += 1;
    if (approvals > maxApprovals) {
      throw new Error(`${label} exceeded approval limit ${maxApprovals}`);
    }
    await clickApproval();
    await sleep(1200);
  }
}

function assertFile(path, includes = []) {
  if (!existsSync(path)) throw new Error(`expected file was not created: ${path}`);
  const text = readFileSync(path, "utf8");
  for (const token of includes) {
    if (!text.includes(token)) throw new Error(`${path} did not include ${JSON.stringify(token)}`);
  }
  return text;
}

function classifyLiveProjectFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/CDP is not reachable|does not look like Microsoft Edge|Copilot readiness failed|Edge CDP target|fetch failed|ECONNREFUSED/i.test(message)) return "environment";
  if (/quota|rate limit|request limit|number of requests per hour|上限/i.test(message)) return "copilot_quota";
  if (/provider_response_timeout|Timed out waiting for Copilot response/i.test(message)) return "provider_response_timeout";
  if (/Prompt did not reach|composer|visible length|input|send/i.test(message)) return "prompt_delivery";
  if (/invalid JSON|schema|tool projection|expected JSON|legacy tool/i.test(message)) return "schema_validation";
  if (/approval|tool|ripgrep|officecli|workspace|patch|write|read|execution/i.test(message)) return "tool_contract";
  if (/expected file|did not include|render/i.test(message)) return "generated_project";
  return "unknown";
}

async function openWorkbench() {
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
  await waitForExpression("['Ready','Limited'].includes(document.querySelector('#readiness')?.textContent)", 10000, "live project readiness");
  await setValue("#workspace", workspace);
}

async function verifyGeneratedApp() {
  const indexPath = join(workspace, "relay-task-planner", "src", "index.html");
  await cdpSend("Page.navigate", { url: pathToFileURL(indexPath).href });
  await waitForExpression("document.readyState === 'complete' && document.body && document.body.innerText.length > 20", 10000, "generated app render");
  const renderedText = await evaluate("document.body.innerText");
  if (!/Relay|Task|Clear completed|タスク/i.test(renderedText)) {
    throw new Error(`generated app render text was not plausible: ${renderedText.slice(0, 500)}`);
  }
  await captureScreenshot("generated-project-rendered.png");
}

async function runFlow() {
  await openWorkbench();

  const createInstruction = [
    "Live project E2Eです。選択中のローカルワークスペース内だけで作業してください。",
    "OpenCode互換のRelayローカルツールを使って、階層構造を持つ小さな静的Webプロジェクト `relay-task-planner` を作成してください。",
    "必須ファイル: `relay-task-planner/package.json`, `relay-task-planner/src/index.html`, `relay-task-planner/src/app.js`, `relay-task-planner/src/styles.css`, `relay-task-planner/docs/USAGE.md`。",
    "新規ファイル作成は `write` または `apply_patch` を使い、bashは使わないでください。",
    "アプリはタスク一覧を表示できる内容にしてください。完了後は日本語で短く要約してください。",
  ].join("\n");

  const create = await runAndApproveUntilComplete(createInstruction, "create-project");
  stageResults.createProject = {
    status: "completed",
    approvals: create.approvals,
    tools: collectToolNames(create.events),
    summary: create.summary,
  };
  writeStageResult();
  assertNoLegacyTools(create.events, "create-project");
  assertToolUsed(create.events, ["write", "apply_patch"], "create-project");

  const projectRoot = join(workspace, "relay-task-planner");
  assertFile(join(projectRoot, "package.json"), ["relay-task-planner"]);
  assertFile(join(projectRoot, "src", "index.html"));
  assertFile(join(projectRoot, "src", "app.js"));
  assertFile(join(projectRoot, "src", "styles.css"));
  assertFile(join(projectRoot, "docs", "USAGE.md"));

  const improveInstruction = [
    "`relay-task-planner` を読んだうえで改善してください。",
    "必ず既存の `src/index.html`, `src/app.js`, `docs/USAGE.md` を読んでから変更してください。",
    "`src/app.js` に完了済みタスクを消すボタンの処理を追加し、実装内に正確な検証マーカー `relay-clear-completed-e2e` を含めてください。",
    "`docs/USAGE.md` に完了済みタスクを消す操作の説明を追記し、正確な検証マーカー `relay-clear-completed-e2e` を含めてください。",
    "必要なら `src/index.html` と `src/styles.css` も更新してください。",
    "変更はOpenCode互換の `write`, `edit`, `apply_patch` のいずれかで行い、bashは使わないでください。",
  ].join("\n");

  await cdpSend("Page.navigate", { url: `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}` });
  await waitForExpression("document.readyState === 'complete'", 5000, "return to workbench");
  await setValue("#workspace", workspace);

  const improve = await runAndApproveUntilComplete(improveInstruction, "improve-project");
  stageResults.improveProject = {
    status: "completed",
    approvals: improve.approvals,
    tools: collectToolNames(improve.events),
    summary: improve.summary,
  };
  writeStageResult();
  assertNoLegacyTools(improve.events, "improve-project");
  assertReadBeforeMutation(improve.events, "improve-project");
  assertToolUsed(improve.events, ["write", "edit", "apply_patch"], "improve-project");

  assertFile(join(projectRoot, "src", "app.js"), ["relay-clear-completed-e2e"]);
  assertFile(join(projectRoot, "docs", "USAGE.md"), ["relay-clear-completed-e2e"]);
  await verifyGeneratedApp();
  stageResults.renderProject = { status: "completed" };
  writeStageResult();

  return {
    workspace,
    createApprovals: create.approvals,
    improveApprovals: improve.approvals,
    createTools: collectToolNames(create.events),
    improveTools: collectToolNames(improve.events),
  };
}

try {
  await assertCopilotCdpAvailable();
  await waitForStatus();
  const result = await runFlow();
  writeFileSync(join(artifactDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`[workbench-live-project-e2e] ok workspace=${result.workspace} createApprovals=${result.createApprovals} improveApprovals=${result.improveApprovals}`);
} catch (error) {
  await dumpWorkbenchArtifacts("failure").catch(() => {});
  writeFileSync(join(artifactDir, "sidecar-stderr.txt"), sidecarStderr, "utf8");
  writeFileSync(join(artifactDir, "workspace.txt"), `${workspace}\n`, "utf8");
  const classification = classifyLiveProjectFailure(error);
  const message = error instanceof Error ? error.message : String(error);
  const currentStage = Object.entries(stageResults).find(([, stage]) => stage.status !== "completed")?.[0] ?? "unknown";
  if (currentStage !== "unknown") {
    stageResults[currentStage] = { ...stageResults[currentStage], status: "failed", classification, message };
  }
  writeStageResult({ classification, message, currentStage });
  throw new Error(`[workbench-live-project-e2e:${classification}] ${message}`);
} finally {
  if (cdp) cdp.close();
  if (edge) edge.kill("SIGTERM");
  sidecar.kill("SIGTERM");
}
