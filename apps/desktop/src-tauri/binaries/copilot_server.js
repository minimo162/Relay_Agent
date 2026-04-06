// copilot_server.js — pure CDP (HTTP + WebSocket), no Playwright
// Works in VBS-restricted corporate environments where Playwright connectOverCDP hangs.
import * as fs from "node:fs";
import * as http from "node:http";

// Use Node 22+ built-in WebSocket. If unavailable, fall back to bare-net via http upgrade.
const WS = globalThis.WebSocket ?? globalThis.ws;
if (!WS) throw new Error("WebSocket is not available. Use Node.js 22+ or install the 'ws' package.");

var DEFAULT_PORT = 18080;
var DEFAULT_CDP_PORT = 9333;
var COPILOT_URL = "https://m365.cloud.microsoft/chat/";
var INPUT_SELECTOR = '#m365-chat-editor-target-element, [data-lexical-editor="true"]';
var NEW_CHAT_BUTTON_SELECTOR = '[data-testid="newChatButton"]';
var STOP_BUTTON_SELECTOR = ".fai-SendButton__stopBackground";
var SEND_BUTTON_ANY_SELECTOR = '.fai-SendButton, button[aria-label*="Send"], button[aria-label*="\u9001\u4FE1"]';
var RESPONSE_SELECTORS = [
  '[data-testid="markdown-reply"]',
  'div[data-message-type="Chat"]',
  'article[data-message-author-role="assistant"]'
];
var RESPONSE_URL_PATTERN = /substrate\.office\.com|copilot\.microsoft\.com|m365\.cloud\.microsoft|api\.bing\.microsoft\.com/i;
var RESPONSE_TIMEOUT_MS = 12e4;
var CDP_PROBE_TIMEOUT_MS = 2e3;
var CDP_COMMAND_TIMEOUT_MS = 5e3;
var EDGE_LAUNCH_TIMEOUT_MS = 15e3;
var EDGE_LAUNCH_POLL_INTERVAL_MS = 500;
var CDP_PORT_SCAN_RANGE = 10;

var CopilotLoginRequiredError = class extends Error {};

/* ─── Raw CDP session ─── */

class CdpSession {
  #ws;
  #id = 0;
  #pending = new Map();
  #listeners = new Map();

  constructor(wsUrl) {
    this.#ws = new WS(wsUrl);
    this.#ws.onmessage = (e) => this._handle(typeof e.data === "string" ? e.data : String(e.data));
  }

  get ready() {
    return new Promise((resolve, reject) => {
      if (this.#ws.readyState === WS.OPEN) return resolve();
      const t = setTimeout(() => reject(new Error("CDP WebSocket timeout")), 10e3);
      this.#ws.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
      this.#ws.addEventListener("error", (e) => { clearTimeout(t); reject(e.error ?? e); }, { once: true });
    });
  }

  close() { this.#ws.close(); }

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(fn);
  }
  off(event, fn) { this.#listeners.get(event)?.delete(fn); }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.#id;
      const t = setTimeout(() => { this.#pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, CDP_COMMAND_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer: t });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  _handle(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id !== null && msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        this.#pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result ?? {});
      }
    } else if (msg.method) {
      for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params);
    }
  }

  _onMessage = (raw) => this._handle(raw);
  _onError = () => { /* errors logged at call site */ }

  /** Run JS in the target page and return the result */
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result;
  }

  /** Returns { url, id } for each page */
  async listPages() {
    const { targetInfos } = await this.send("Target.getTargets");
    return targetInfos
      .filter((t) => t.type === "page")
      .map((t) => ({ targetId: t.targetId, url: t.url, title: t.title }));
  }

  // Navigate page
  async navigate(targetId, url) {
    const { frameId } = await this.send("Target.createTarget", { url });
    return frameId;
  }

  async navigateExisting(targetId, url) {
    await this.send("Page.navigate", { url }, true);
  }

  async closeTarget(targetId) {
    return this.send("Target.closeTarget", { targetId });
  }

  // DOM: wait for selector to be visible
  async waitForSelector(selector, timeoutMs = 1e4) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const visible = await this.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? el.offsetParent !== null : false;
      })()`);
      if (visible.value !== false) return;
      await sleep(200);
    }
    throw new Error(`waitForSelector timed out: ${selector}`);
  }

  async click(selector) {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) el.click();
    })()`);
  }

  async fillText(selector, text) {
    await this.evaluate(`((sel, txt) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.focus();
      el.textContent = '';
      const dt = new DataTransfer();
      dt.setData('text/plain', txt);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    })()`, [selector, text]);
    await sleep(300);
  }

  async getText(selector) {
    const r = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      return el ? el.innerText : '';
    })()`);
    return r.value ?? "";
  }
}

function normalizeWebSocketUrl(url) {
  if (!url) return url;
  return url.replace(/0\.0\.36\.6/g, "127.0.0.1");
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ─── Copilot session ─── */

class CopilotSession {
  cdpTargetId = null;
  cdpSession = null;
  cdpPort = null;
  lock = false;

  async _getBrowserWsUrl(port) {
    // /json/version → webSocketDebuggerUrl (browser-level)
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(CDP_PROBE_TIMEOUT_MS)
    });
    if (!resp.ok) return null;
    const info = await resp.json();
    return info.webSocketDebuggerUrl ? normalizeWebSocketUrl(info.webSocketDebuggerUrl) : null;
  }

  async connect(cdpPort) {
    console.error("[copilot:connect] ensuring Edge is ready on CDP port", cdpPort);
    await ensureEdgeConnected(cdpPort);
    const actualPort = globalOptions.cdpPort;

    if (actualPort !== this.cdpPort) {
      if (this.cdpSession) { this.cdpSession.close(); this.cdpSession = null; }
      this.cdpPort = actualPort;

      console.error("[copilot:connect] fetching browser WebSocket URL...");
      const wsUrl = await this._getBrowserWsUrl(actualPort);
      if (!wsUrl) throw new Error(`Cannot get browser WebSocket URL from CDP port ${actualPort}`);
      console.error("[copilot:connect] browser WS URL:", wsUrl);

      // Create browser-level CDP session
      this.cdpSession = new CdpSession(wsUrl);
      await this.cdpSession.ready;
      console.error("[copilot:connect] CDP session established");
    }
  }

  async findOrCreatePage() {
    const session = this.cdpSession;

    // List existing pages and find the Copilot one
    const pages = await session.listPages();
    let copilotPage = pages.find((p) => p.url.includes("m365.cloud.microsoft/chat"));

    // If no copilot page, try login page
    if (!copilotPage) {
      copilotPage = pages.find((p) =>
        p.url.includes("login.microsoftonline.com") || p.url.includes("login.live.com")
      );
    }

    if (!copilotPage) {
      // No copilot page — create one via Target.createTarget
      console.error("[copilot] no copilot page found, creating one...");
      const result = await session.send("Target.createTarget", {
        url: COPILOT_URL
      });
      this.cdpTargetId = result.targetId;
      return { targetId: result.targetId, url: COPILOT_URL };
    }

    this.cdpTargetId = copilotPage.targetId;
    return copilotPage;
  }

  async navigateToPage(page) {
    const session = this.cdpSession;

    // Create a page-level CDP session
    const info = await session.send("Target.attachToTarget", {
      targetId: page.targetId,
      flatten: true
    });

    // Return a new CdpSession for the page target
    const pageWsUrl = info.sessionId
      ? normalizeWebSocketUrl(info.webSocketDebuggerUrl || `ws://127.0.0.1:${this.cdpPort}/devtools/page/${page.targetId}`)
      : `ws://127.0.0.1:${this.cdpPort}/devtools/page/${page.targetId}`;

    const pageSession = new CdpSession(pageWsUrl);
    await pageSession.ready;
    return pageSession;
  }

  async inspectStatus() {
    try {
      await this.connect(globalOptions.cdpPort);
      const page = await this.findOrCreatePage();
      if (!page) {
        return { connected: false, loginRequired: false, error: "Copilot page not available" };
      }
      return {
        connected: true,
        loginRequired: isLoginUrl(page.url),
        url: page.url
      };
    } catch (error) {
      return {
        connected: false,
        loginRequired: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async describe(systemPrompt, userPrompt, imageB64) {
    if (this.lock) throw new Error("Copilot session is busy");
    this.lock = true;
    let pageSession = null;
    try {
      console.error("[copilot:describe] connecting...");
      await this.connect(globalOptions.cdpPort);
      console.error("[copilot:describe] finding copilot page...");
      const page = await this.findOrCreatePage();
      console.error("[copilot:describe] page:", JSON.stringify(page));

      if (isLoginUrl(page.url)) {
        throw new CopilotLoginRequiredError(
          "Copilot にログインしてください。Edge の画面を確認してください。"
        );
      }

      pageSession = await this.navigateToPage(page);

      if (!isCopilotUrl(page.url)) {
        console.error("[copilot:describe] navigating to Copilot URL...");
        await pageSession.send("Page.navigate", { url: COPILOT_URL });
        await sleep(2000);
      }

      console.error("[copilot:describe] starting new chat...");
      await pageSession.click(NEW_CHAT_BUTTON_SELECTOR).catch(() => {});
      await sleep(500);

      console.error("[copilot:describe] pasting prompt...");
      const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
      await pastePromptRaw(pageSession, fullPrompt);

      console.error("[copilot:describe] submitting prompt...");
      return await submitPromptRaw(pageSession);
    } finally {
      if (pageSession) { pageSession.close(); }
      this.lock = false;
    }
  }
}

function isCopilotUrl(url) { return url?.includes("m365.cloud.microsoft/chat"); }
function isLoginUrl(url) {
  return url?.includes("login.microsoftonline.com") || url?.includes("login.live.com") || url?.includes("microsoft.com/fwlink");
}

async function pastePromptRaw(session, text) {
  console.error("[copilot:paste] focusing input...");
  await session.click(INPUT_SELECTOR).catch(() => {});
  await sleep(200);

  // Lexical (M365 Copilot's editor) doesn't respond to paste events.
  // Use Input.dispatchKeyEvent to type the text character by character.
  // For long text, we can set the content directly on contentEditable elements
  // and dispatch the right DOM events so the React/Lexical state updates.
  console.error("[copilot:paste] setting text via DOM mutation (", text.length, "chars )");

  await session.evaluate(`
    ((txt) => {
      // Target #m365-chat-editor-target-element (the Lexical contentEditable)
      const el = document.querySelector('#m365-chat-editor-target-element')
        ?? document.querySelector('[data-lexical-editor="true"]');
      if (!el) { console.error('[copilot] input element not found'); return; }
      el.focus();
      el.textContent = '';
      el.innerText = txt;
      // Dispatch input events so React/Lexical picks up the change
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })(${JSON.stringify(text)})
  `);
  await sleep(1e3);
}

async function submitPromptRaw(session) {
  // Wait for send button to become visible and enabled
  const deadline = Date.now() + 3e4;
  let stableSince = 0;
  while (Date.now() < deadline) {
    const btnVisible = await session.evaluate(`(() => {
      const el = document.querySelector('.fai-SendButton')
        ?? document.querySelector('button[aria-label*="Send"]')
        ?? document.querySelector('button[aria-label*="送信"]');
      return el ? (el.offsetParent !== null && !el.disabled) : false;
    })()`).catch(() => ({ value: false }));

    if (btnVisible.value) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 750) {
        await session.click(SEND_BUTTON_ANY_SELECTOR).catch(() => {});
        break;
      }
    } else {
      stableSince = 0;
    }
    await sleep(250);
  }

  // Wait for response
  return await waitForDomResponse(session);
}

async function waitForDomResponse(session) {
  // Wait for stop button to appear (generating), then disappear (done)
  await session.waitForSelector(STOP_BUTTON_SELECTOR, 15e3).catch(() => {});
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;

  let waitCount = 0;
  while (Date.now() < deadline) {
    // Check if stop button is gone (response complete)
    const stopVisible = await session.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(STOP_BUTTON_SELECTOR)});
      return el ? el.offsetParent !== null : false;
    })()`).catch(() => ({ value: false }));

    if (waitCount > 0 && !stopVisible.value) {
      // Try to get the response text
      for (const selector of RESPONSE_SELECTORS) {
        const text = await session.getText(selector).catch(() => "");
        if (text && text.trim()) {
          return text.trim();
        }
      }
    }

    waitCount++;
    await sleep(1e3);
  }

  // Timeout — return whatever text we can find
  for (const selector of RESPONSE_SELECTORS) {
    const text = await session.getText(selector).catch(() => "");
    if (text && text.trim()) return text.trim();
  }
  throw new Error("Copilot response not found in DOM");
}

/* ─── Edge management ─── */

async function ensureEdgeConnected(cdpPort) {
  console.error("[copilot:ensureEdge] probing CDP port", cdpPort);
  const existing = await probeCdpVersion(cdpPort);
  if (existing) {
    console.error("[copilot:ensureEdge] already connected via CDP port", cdpPort);
    return;
  }

  // Scan nearby ports
  for (let port = cdpPort; port < cdpPort + CDP_PORT_SCAN_RANGE; port++) {
    const probe = await probeCdpVersion(port);
    if (probe) {
      globalOptions.cdpPort = port;
      console.error("[copilot:ensureEdge] found existing Edge on port", port);
      return;
    }
  }

  // No existing Edge found
  const edgePath = findEdgePath();
  if (!edgePath) throw new Error("Microsoft Edgeが見つかりません。Edgeをインストールしてください。");

  // Find a free port
  let actualPort = cdpPort;
  for (let port = cdpPort; port < cdpPort + CDP_PORT_SCAN_RANGE; port++) {
    if (!await probeCdpVersion(port)) {
      actualPort = port;
      break;
    }
    if (port === cdpPort + CDP_PORT_SCAN_RANGE - 1) {
      throw new Error(`CDPポート ${cdpPort}〜${port} は使用中です`);
    }
  }
  if (actualPort !== cdpPort) console.error(`[copilot] CDP port ${cdpPort} occupied, using ${actualPort}`);
  globalOptions.cdpPort = actualPort;

  console.error("[copilot:ensureEdge] launching Edge on port", actualPort);
  const { spawn } = await import("node:child_process");
  const args = [
    `--remote-debugging-port=${actualPort}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=EdgeEnclave,VbsEnclave,RendererCodeIntegrity",
    "--disable-gpu",
    "--disable-gpu-compositing"
  ];
  if (globalOptions.userDataDir) {
    args.push(`--user-data-dir=${globalOptions.userDataDir}`);
  }
  args.push(COPILOT_URL);
  const child = spawn(edgePath, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();

  // Wait for CDP to be ready
  const dl = Date.now() + EDGE_LAUNCH_TIMEOUT_MS;
  while (Date.now() < dl) {
    if (await probeCdpVersion(actualPort)) {
      console.error("[copilot:ensureEdge] CDP ready on port", actualPort);
      return;
    }
    await sleep(EDGE_LAUNCH_POLL_INTERVAL_MS);
  }
  throw new Error("Edgeのデバッグ接続が開始できません");
}

async function probeCdpVersion(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(CDP_PROBE_TIMEOUT_MS)
    });
    if (!r.ok) return null;
    const info = await r.json();
    return info;
  } catch {
    return null;
  }
}

function findEdgePath() {
  if (process.platform !== "win32") return null;
  for (const root of [process.env["PROGRAMFILES(X86)"], process.env.PROGRAMFILES].filter(Boolean)) {
    const p = `${root}\\Microsoft\\Edge\\Application\\msedge.exe`;
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* ─── HTTP server ─── */

function createServer(session) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return writeJson(res, 200, { status: "ok" });
      }
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && reqUrl.pathname === "/status") {
        const status = await session.inspectStatus();
        return writeJson(res, 200, status);
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const payload = await readJsonBody(req);
        const prompt = parseOpenAiRequest(payload);
        const description = await session.describe(
          prompt.systemPrompt, prompt.userPrompt, prompt.imageB64
        );
        return writeJson(res, 200, {
          choices: [{ message: { role: "assistant", content: description } }]
        });
      }
      return writeJson(res, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[copilot] request failed:", error);
      if (error instanceof CopilotLoginRequiredError) {
        return writeJson(res, 401, { error: "login_required", message });
      }
      return writeJson(res, 500, { error: message });
    }
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
  const body = Buffer.concat(chunks).toString("utf8");
  return body.trim() ? JSON.parse(body) : {};
}

function parseOpenAiRequest(payload) {
  const msgs = payload.messages ?? [];
  const systemPrompt = msgs.filter((m) => m.role === "system").map((m) => m.content?.trim()).filter(Boolean).join("\n\n");
  let userPrompt = "";
  let imageB64;
  for (const m of msgs) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") { userPrompt = `${userPrompt}\n${m.content}`.trim(); continue; }
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === "text") userPrompt = `${userPrompt}\n${p.text}`.trim();
        if (p.type === "image_url" && p.image_url?.url) imageB64 = extractBase64(p.image_url.url);
      }
    }
  }
  if (!userPrompt.trim()) throw new Error("User prompt is empty");
  return { systemPrompt, userPrompt, imageB64 };
}

function extractBase64(url) { const m = url.match(/^data:[^;]+;base64,(.+)$/); return m ? m[1] : url; }

function writeJson(res, code, body) {
  const p = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(p) });
  res.end(p);
}

/* ─── Entry ─── */

function parseArgs(argv) {
  let port = DEFAULT_PORT, cdpPort = DEFAULT_CDP_PORT, userDataDir = null, help = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") { help = true; continue; }
    if (argv[i] === "--port") { port = Number(argv[++i]); continue; }
    if (argv[i] === "--cdp-port") { cdpPort = Number(argv[++i]); continue; }
    if (argv[i] === "--user-data-dir") { userDataDir = argv[++i] ?? null; continue; }
  }
  return { port, cdpPort, userDataDir, help };
}

var globalOptions = parseArgs(process.argv.slice(2));

async function main() {
  if (globalOptions.help) {
    console.error("Usage: node copilot_server.js [--port 18080] [--cdp-port 9333] [--user-data-dir <path>]");
    return;
  }
  const session = new CopilotSession();
  const server = createServer(session);
  server.listen(globalOptions.port, "127.0.0.1", () => {
    console.error(`[copilot] listening on http://127.0.0.1:${globalOptions.port} (cdp:${globalOptions.cdpPort})`);
  });
  const shutdown = async () => { server.close(); process.exit(0); };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error("[copilot] fatal:", error);
  process.exit(1);
});
