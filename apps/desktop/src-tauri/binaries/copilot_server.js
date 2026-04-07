// copilot_server.js — pure CDP (HTTP + WebSocket), no Playwright
// Works in VBS-restricted corporate environments where Playwright connectOverCDP hangs.
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

// Use Node 22+ built-in WebSocket. If unavailable, fall back to bare-net via http upgrade.
const WS = globalThis.WebSocket ?? globalThis.ws;
if (!WS) throw new Error("WebSocket is not available. Use Node.js 22+ or install the 'ws' package.");

var DEFAULT_PORT = 18080;
var DEFAULT_CDP_PORT = 9333;
var COPILOT_URL = "https://m365.cloud.microsoft/chat/";
/**
 * Composer boundary for focus/paste and for excluding transcript nodes (inComposer).
 * Aligns with agent-browser accessibility snapshot on M365 Copilot (ja): textbox
 * "Copilot にメッセージを送信する" (e.g. ref e110); EN uses "Send a message…" on role=textbox.
 */
var COMPOSER_ANCESTOR_CLOSEST =
  '#m365-chat-editor-target-element, [data-lexical-editor="true"], [role="textbox"][aria-label*="メッセージを送信"], [role="textbox"][aria-label*="Send a message"], [role="textbox"][aria-label*="Message"], [role="textbox"][aria-label*="message"], [role="textbox"][aria-label*="Copilot"]';
var INPUT_SELECTOR = COMPOSER_ANCESTOR_CLOSEST;
var COMPOSER_WAIT_MS = 25e3;
/** Prefer single selectors: `clickFirstVisibleDeep` walks shadow roots per selector. */
var NEW_CHAT_BUTTON_SELECTORS = [
  '[data-testid="newChatButton"]',
  'button[aria-label*="新しいチャット"]',
  'button[aria-label*="New chat"]',
  'button[aria-label*="New conversation"]',
  '[role="button"][aria-label*="New chat"]',
  '[role="button"][aria-label*="新しいチャット"]',
  'a[aria-label*="New chat"]',
  '[role="menuitem"][aria-label*="New chat"]',
  '[role="menuitem"][aria-label*="新しいチャット"]',
];
/** Lowercase substrings against combined accessible name (label + labelledby text + title). */
var NEW_CHAT_A11Y_HINTS = [
  "new chat",
  "new conversation",
  "start new conversation",
  "create new chat",
  "another chat",
  "新しいチャット",
  "新規のチャット",
  "新規チャット",
  "別のチャット",
  "チャットを開始",
  "nouvelle conversation",
  "neuer chat",
  "nuevo chat",
];
var NEW_CHAT_A11Y_EXCLUDE = [
  "feedback",
  "フィードバック",
  "settings",
  "設定",
  "help",
  "ヘルプ",
  "support",
  "サポート",
];
/** Any visible “stop generating” control (M365 UI varies by locale/build). */
var STREAMING_STOP_SELECTORS = [
  ".fai-SendButton__stopBackground",
  'button[aria-label*="生成を停止"]',
  'button[aria-label*="Stop generating"]',
  'button[aria-label*="Stop response"]',
  'button[aria-label*="停止"]',
  'button[data-testid="stopGeneratingButton"]',
  'button[data-testid*="stop"]',
  '[data-testid*="StopGenerating"]',
  '[class*="StopGenerating"]',
  '[class*="stopGenerating"]'
];
var SEND_BUTTON_ANY_SELECTOR = '.fai-SendButton, button[aria-label*="Send"], button[aria-label*="\u9001\u4FE1"], button[aria-label="Reply"], button[data-testid="sendButton"]';
var ASSISTANT_REPLY_DOM_SELECTORS = [
  '[data-testid="markdown-reply"]',
  '[data-testid*="message-content"]',
  '[data-testid*="message-body"]',
  '[data-testid*="assistant"]',
  '[data-message-author-role="assistant"]',
  'article[data-message-author-role="assistant"]',
  'div[data-message-type="Chat"]',
  '[role="article"]',
  ".markdown-body",
  ".fui-ChatMessageBody",
  '[class*="ChatMessage"]',
  '[class*="MessageBody"]',
  '[class*="message-body"]',
  "cib-message[type='response']",
  "cib-message .content",
  "cib-serp",
  "cib-rich-card"
];
var RESPONSE_URL_PATTERN =
  /substrate\.office\.com|copilot\.microsoft\.com|m365\.cloud\.microsoft|api\.bing\.microsoft\.com|services\.actions\.ms|graph\.microsoft\.com|teams\.live\.com/i;

/**
 * Paths we never treat as chat model output (telemetry, shell assets, metrics).
 * Used by allowlist mode; legacy broad capture uses a separate deny regex.
 */
var NON_CHAT_NETWORK_PATH_RE =
  /pacman\/api\/|\/clientevents|search\/api\/v\d+\/events|\/events\?scenario=|\/telemetry|onecollector|browserpipe|clarity(\.ms)?|favicon|\.png(\?|$)|\.gif(\?|$)|\.woff2?(\?|$)|\.svg(\?|$)|\/webpack|\/resources\/icons\/|\/chunk\.|\/static\/|\/metrics(\/|\?|$)/i;

/**
 * Default: only capture responses whose URL plausibly carries assistant text.
 * Broad host match + string heuristics (JWT, UUID, Pacman JSON, …) is endless;
 * extend these patterns from DevTools → Network when M365 adds endpoints.
 *
 * Set RELAY_COPILOT_LEGACY_BROAD_NETWORK=1 to restore pre-allowlist behavior (debug only).
 */
function isAllowedChatNetworkUrl(url) {
  const low = (url || "").toLowerCase();
  if (NON_CHAT_NETWORK_PATH_RE.test(low)) return false;
  let pathQ = low;
  try {
    const u = new URL(url);
    pathQ = (u.pathname + u.search).toLowerCase();
  } catch {
    /* keep low */
  }
  if (/\/harmony\//i.test(pathQ) && /\/events/i.test(pathQ)) return false;
  const pathHints = [
    /\/m365copilot\/chathub\//i,
    /\/chat\/completions/,
    /\/completions(?:\/|\?|$)/,
    /\/openai\//,
    /\/deployments\/[^/]+\/chat\/completions/,
    /\/deployments\/[^/]+\/completions/,
    /\/chats\/[^/]+\/messages/,
    /\/teams\/[^/]+\/channels\/[^/]+\/messages/,
    /\/conversation[s]?\/[^/]+\/messages/i,
    /\/harmony\/[^?]*(?:chat|message|completion|stream|turn|infer|orchestrat|dialog)/i,
    /\/sydney\//i,
    /\/m365chat\//i,
  ];
  const fullUrlHints = [
    /m365\.cloud\.microsoft[^?]*\/api\/v\d+\/[^?]*(chat|conversation|message|copilot|harmony)/i,
    /substrate\.office\.com[^?]*\/api\/[^?]*(chat|conversation|message|completion|harmony|sydney|orchestrat)/i,
    /copilot\.microsoft\.com[^?]*(?:chat|conversation|message|completion|turn)/i,
    /api\.bing\.microsoft\.com[^?]*(?:chat|conversation|sydney|message|completion)/i,
  ];
  if (pathHints.some((re) => re.test(pathQ))) return true;
  return fullUrlHints.some((re) => re.test(low));
}
var RESPONSE_TIMEOUT_MS = 18e4;
var CDP_PROBE_TIMEOUT_MS = 2e3;
var CDP_COMMAND_TIMEOUT_MS = 5e3;
/** Runtime.evaluate can run long synchronous DOM work; default CDP timeout was killing large execCommand pastes. */
var CDP_RUNTIME_EVALUATE_TIMEOUT_MS = 90e3;
var EDGE_LAUNCH_TIMEOUT_MS = 45e3;
var EDGE_LAUNCH_POLL_INTERVAL_MS = 500;
var CDP_PORT_SCAN_RANGE = 20;
/** Written under the dedicated Edge profile dir so we reconnect to Relay's instance, not a manually debugged personal Edge on 9333. */
var RELAY_CDP_PORT_MARKER = ".relay-agent-cdp-port";
/**
 * Chathub / author=bot strings only (JS String.length). "こんにちは" = 5; "Hi" = 2.
 * Emoji can add UTF-16 units. HTTP JSON scanning keeps a higher minimum separately.
 */
var CHATHUB_ASSISTANT_MIN_CHARS = 2;

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

  send(method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = ++this.#id;
      const t = setTimeout(() => { this.#pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, timeoutMs);
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
  async evaluate(expression, evaluateTimeoutMs = CDP_RUNTIME_EVALUATE_TIMEOUT_MS) {
    const r = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      evaluateTimeoutMs
    );
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
    await this.send("Page.navigate", { url });
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

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/* ─── Copilot session ─── */

class CopilotSession {
  cdpTargetId = null;
  cdpSession = null;
  cdpPort = null;
  /** Serialize /v1/chat/completions — overlapping POSTs (e.g. Rust retry while Copilot still runs) must wait, not 500 "busy". */
  _describeChain = Promise.resolve();

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

    const needWs = actualPort !== this.cdpPort || !this.cdpSession;
    if (needWs) {
      if (this.cdpSession) {
        this.cdpSession.close();
        this.cdpSession = null;
      }
      this.cdpPort = actualPort;

      console.error("[copilot:connect] fetching browser WebSocket URL...");
      const wsUrl = await this._getBrowserWsUrl(actualPort);
      if (!wsUrl) throw new Error(`Cannot get browser WebSocket URL from CDP port ${actualPort}`);
      console.error("[copilot:connect] browser WS URL:", wsUrl);

      this.cdpSession = new CdpSession(wsUrl);
      await this.cdpSession.ready;
      console.error("[copilot:connect] CDP session established");
    }
  }

  async findOrCreatePage() {
    const session = this.cdpSession;

    // List existing pages and find the Copilot one. Prefer the *last* match so CDP attaches to the
    // newest chat tab (a duplicate m365 tab from an extra Edge launch would otherwise stay stale).
    const pages = await session.listPages();
    const copilots = pages.filter((p) => p.url.includes("m365.cloud.microsoft/chat"));
    let copilotPage = copilots.length ? copilots[copilots.length - 1] : undefined;
    if (copilots.length > 1) {
      console.error(
        "[copilot] multiple Copilot tabs (",
        copilots.length,
        ") — using last in CDP list",
      );
    }

    // If no copilot page, try login page (last match: same reasoning as above)
    if (!copilotPage) {
      const logins = pages.filter(
        (p) =>
          p.url.includes("login.microsoftonline.com") || p.url.includes("login.live.com"),
      );
      copilotPage = logins.length ? logins[logins.length - 1] : undefined;
    }

    if (!copilotPage) {
      const disposables = pages.filter((p) => isDisposableStartUrl(p.url));
      const reuse =
        disposables.length > 0 ? disposables[disposables.length - 1] : pages.length > 0 ? pages[pages.length - 1] : null;
      if (reuse) {
        console.error(
          "[copilot] no Copilot URL yet — reusing existing tab (navigate in describe):",
          reuse.url?.slice(0, 120) || "(empty)",
        );
        this.cdpTargetId = reuse.targetId;
        return reuse;
      }
      console.error("[copilot] no page targets — creating Copilot tab via Target.createTarget");
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
    const pending = this._describeChain.then(() =>
      this.describeImpl(systemPrompt, userPrompt, imageB64),
    );
    this._describeChain = pending.catch(() => {});
    return pending;
  }

  async describeImpl(systemPrompt, userPrompt, imageB64) {
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

      await this.cdpSession.send("Target.activateTarget", { targetId: page.targetId }).catch((e) => {
        console.error("[copilot:describe] Target.activateTarget:", e?.message || e);
      });

      pageSession = await this.navigateToPage(page);
      await pageSession.send("Page.enable", {}).catch(() => {});
      await pageSession.send("Page.bringToFront", {}).catch((e) => {
        console.error("[copilot:describe] Page.bringToFront:", e?.message || e);
      });

      let currentUrl = page.url || "";
      if (!isCopilotUrl(currentUrl)) {
        console.error("[copilot:describe] navigating to Copilot URL from:", currentUrl?.slice(0, 140) || "(empty)");
        await pageSession.send("Page.navigate", { url: COPILOT_URL });
        try {
          currentUrl = await waitForTargetUrl(this.cdpSession, page.targetId, isCopilotUrl, 45e3);
          console.error("[copilot:describe] Copilot URL reached:", currentUrl?.slice(0, 120));
        } catch (e) {
          console.error("[copilot:describe] navigate wait failed, retrying once:", e?.message || e);
          await pageSession.send("Page.navigate", { url: COPILOT_URL });
          currentUrl = await waitForTargetUrl(this.cdpSession, page.targetId, isCopilotUrl, 30e3);
          console.error("[copilot:describe] Copilot URL after retry:", currentUrl?.slice(0, 120));
        }
        await sleep(1200);
      }

      const netCapture = createCopilotNetworkCapture(pageSession);
      await netCapture.enable();

      try {
        console.error("[copilot:describe] starting new chat...");
        const newChatOk = await clickNewChatDeep(pageSession);
        if (!newChatOk) {
          console.error("[copilot:describe] new chat not found (css+shadow+a11y); last-chance CDP click");
          await pageSession.click(NEW_CHAT_BUTTON_SELECTORS[0]).catch(() => {});
        }
        await sleep(2800);

        console.error("[copilot:describe] pasting prompt...");
        const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
        await pastePromptRaw(pageSession, fullPrompt);

        console.error("[copilot:describe] submitting prompt...");
        return await submitPromptRaw(pageSession, fullPrompt.length, netCapture);
      } finally {
        await netCapture.disable().catch(() => {});
      }
    } finally {
      if (pageSession) { pageSession.close(); }
    }
  }
}

function isCopilotUrl(url) { return url?.includes("m365.cloud.microsoft/chat"); }
function isLoginUrl(url) {
  return url?.includes("login.microsoftonline.com") || url?.includes("login.live.com") || url?.includes("microsoft.com/fwlink");
}

/** Prefer navigating these instead of Target.createTarget (avoids a second tab next to msedge's startup URL). */
function isDisposableStartUrl(url) {
  if (!url) return true;
  const u = url.toLowerCase();
  return (
    u.startsWith("about:") ||
    u.startsWith("edge://") ||
    u.startsWith("chrome://") ||
    u.includes("newtab") ||
    u.includes("ntp.msn") ||
    u.includes("msn.com") ||
    u.includes("microsoftstart.com") ||
    u.includes("bing.com") ||
    u === "data:," ||
    u.startsWith("data:text/html")
  );
}

/** Poll Target list until the page target's URL matches (navigation committed). */
async function waitForTargetUrl(browserSession, targetId, testFn, timeoutMs = 45e3) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pages = await browserSession.listPages();
    const p = pages.find((x) => x.targetId === targetId);
    if (p && testFn(p.url || "")) return p.url || "";
    await sleep(400);
  }
  const pages = await browserSession.listPages();
  const p = pages.find((x) => x.targetId === targetId);
  const last = p?.url || "";
  throw new Error(`Timeout waiting for target URL (${timeoutMs}ms); last=${last.slice(0, 200)}`);
}

/**
 * Injected into composer-related Runtime.evaluate calls. Chat surface is often inside nested same-origin iframes.
 */
var COMPOSER_DOM_HELPERS = `
  function __raVis(el) {
    return el && el.offsetParent !== null;
  }
  function __raComposerLabelHints(el) {
    if (!el || el.nodeType !== 1) return false;
    const lab = (
      (el.getAttribute("aria-label") || "") +
      " " +
      (el.getAttribute("placeholder") || "") +
      " " +
      (el.getAttribute("data-placeholder") || "")
    ).toLowerCase();
    if (!lab.trim()) return false;
    const hints = [
      "send a message",
      "message to copilot",
      "copilot",
      "メッセージ",
      "返信",
      "type a message",
      "reply",
      "ask copilot",
      "compose",
      "prompt"
    ];
    for (let i = 0; i < hints.length; i++) {
      if (lab.includes(hints[i])) return true;
    }
    return false;
  }
  function __raBestInnerTextbox(root) {
    if (!root || !__raVis(root)) return null;
    const inner = root.querySelector('[contenteditable="true"]');
    return __raVis(inner) ? inner : root;
  }
  function __raWalkFindComposerLabeled(root, depth) {
    if (!root || depth > 18) return null;
    if (root.nodeType === 1) {
      try {
        if (
          root.matches &&
          root.matches('[role="textbox"]') &&
          __raComposerLabelHints(root) &&
          __raVis(root)
        ) {
          const el = __raBestInnerTextbox(root);
          if (el) return el;
        }
      } catch (_) {}
      const kids = root.children || [];
      for (let i = 0; i < kids.length; i++) {
        const f = __raWalkFindComposerLabeled(kids[i], depth + 1);
        if (f) return f;
      }
      if (root.shadowRoot) {
        const f = __raWalkFindComposerLabeled(root.shadowRoot, depth + 1);
        if (f) return f;
      }
    }
    return null;
  }
  function __raFindComposerEditable() {
    function inDoc(doc, depth) {
      if (!doc || depth > 14) return null;
      const roots = [
        doc.querySelector("#m365-chat-editor-target-element"),
        doc.querySelector('[data-lexical-editor="true"]'),
        doc.querySelector('[role="textbox"][aria-label*="メッセージを送信"]'),
        doc.querySelector('[role="textbox"][aria-label*="Send a message"]'),
        doc.querySelector('main [role="textbox"]'),
        doc.querySelector('[role="main"] [role="textbox"]'),
        doc.querySelector('[role="textbox"][aria-label*="Copilot"]'),
      ].filter(Boolean);
      const seen = new Set();
      for (const root of roots) {
        if (!root || seen.has(root)) continue;
        seen.add(root);
        if (!__raVis(root)) continue;
        const inner = root.querySelector('[contenteditable="true"]');
        const el = __raVis(inner) ? inner : root;
        try {
          if (doc.defaultView) doc.defaultView.focus();
        } catch (_) {}
        return el;
      }
      try {
        const labeled = Array.from(doc.querySelectorAll('[role="textbox"]')).filter(
          (n) => __raComposerLabelHints(n) && __raVis(n)
        );
        for (let i = 0; i < labeled.length; i++) {
          const el = __raBestInnerTextbox(labeled[i]);
          if (el) {
            try {
              if (doc.defaultView) doc.defaultView.focus();
            } catch (_) {}
            return el;
          }
        }
      } catch (_) {}
      const walked = __raWalkFindComposerLabeled(doc.body || doc.documentElement, 0);
      if (walked) {
        try {
          if (doc.defaultView) doc.defaultView.focus();
        } catch (_) {}
        return walked;
      }
      const scope =
        doc.querySelector("main") || doc.querySelector('[role="main"]') || doc.body || doc.documentElement;
      const fallbacks = [
        'div[role="textbox"][contenteditable="true"]',
        'div[role="textbox"]',
        '[contenteditable="true"]'
      ];
      for (const sel of fallbacks) {
        let el = null;
        try {
          el = scope.querySelector(sel);
        } catch (_) {
          el = null;
        }
        if (__raVis(el)) {
          try {
            if (doc.defaultView) doc.defaultView.focus();
          } catch (_) {}
          return el;
        }
      }
      let frames;
      try {
        frames = doc.querySelectorAll("iframe");
      } catch (_) {
        return null;
      }
      for (let i = 0; i < frames.length; i++) {
        try {
          const c = frames[i].contentDocument;
          const found = inDoc(c, depth + 1);
          if (found) return found;
        } catch (_) {}
      }
      return null;
    }
    return inDoc(document, 0);
  }
`;

/** Shared in-page helpers: accessible name + shadow-safe activatable click (new chat, etc.). */
var A11Y_CONTROL_HELPERS = `
  function __raNameFromLabelledBy(el) {
    try {
      const id = el.getAttribute("aria-labelledby");
      if (!id) return "";
      const doc = el.ownerDocument || document;
      const parts = id.split(/\\s+/).map((x) => x.trim()).filter(Boolean);
      let t = "";
      for (let i = 0; i < parts.length; i++) {
        const ref = doc.getElementById(parts[i]);
        if (ref) t += " " + (ref.textContent || "").trim();
      }
      return t;
    } catch (_) {
      return "";
    }
  }
  function __raActivAccessibleName(el) {
    if (!el || el.nodeType !== 1) return "";
    return (
      (el.getAttribute("aria-label") || "") +
      " " +
      __raNameFromLabelledBy(el) +
      " " +
      (el.getAttribute("title") || "") +
      " " +
      (el.getAttribute("name") || "")
    )
      .replace(/\\s+/g, " ")
      .trim();
  }
  function __raActivOk(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    return r.bottom > 1 && r.right > 1 && r.top < innerHeight - 1 && r.left < innerWidth - 1;
  }
  function __raIsActivatable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "BUTTON") return true;
    if (tag === "A" && el.getAttribute("href")) return true;
    const role = el.getAttribute("role");
    if (role === "button" || role === "menuitem" || role === "tab") return true;
    return false;
  }
  function __raHintsMatch(nameLow, hints) {
    for (let i = 0; i < hints.length; i++) {
      if (nameLow.includes(hints[i])) return true;
    }
    return false;
  }
  function __raExcludesMatch(nameLow, ex) {
    for (let i = 0; i < ex.length; i++) {
      if (nameLow.includes(ex[i])) return true;
    }
    return false;
  }
  function __raWalkClickMatching(root, hints, excludes, depth) {
    if (!root || depth > 22) return false;
    if (root.nodeType === 1) {
      if (__raIsActivatable(root)) {
        const nameLow = __raActivAccessibleName(root).toLowerCase();
        if (nameLow && __raHintsMatch(nameLow, hints) && !__raExcludesMatch(nameLow, excludes)) {
          if (__raActivOk(root)) {
            try { root.scrollIntoView({ block: "center", inline: "nearest" }); } catch (_) {}
            root.click();
            return true;
          }
        }
      }
      const kids = root.children || [];
      for (let i = 0; i < kids.length; i++) {
        if (__raWalkClickMatching(kids[i], hints, excludes, depth + 1)) return true;
      }
      if (root.shadowRoot) {
        if (__raWalkClickMatching(root.shadowRoot, hints, excludes, depth + 1)) return true;
      }
    } else if (root.nodeType === 11) {
      const kids = root.childNodes || [];
      for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        if (n && (n.nodeType === 1 || n.nodeType === 11)) {
          if (__raWalkClickMatching(n, hints, excludes, depth + 1)) return true;
        }
      }
    } else if (root.nodeType === 9) {
      if (__raWalkClickMatching(root.documentElement, hints, excludes, depth + 1)) return true;
    }
    return false;
  }
`;

/**
 * Click first matching visible element (open shadow roots included) in the document or same-origin iframes.
 * `selector` may be a comma-separated list (tried as separate selectors, first match wins in tree order).
 */
async function clickFirstVisibleDeep(session, selector) {
  const parts =
    typeof selector === "string"
      ? selector
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : Array.isArray(selector)
        ? selector
        : [String(selector)];
  const r = await session.evaluate(`((selectors) => {
    function vis(el) {
      return el && el.offsetParent !== null;
    }
    function walkShadowTree(root, visit, depth) {
      if (!root || depth > 22) return;
      if (root.nodeType === 1) {
        visit(root);
        const kids = root.children || [];
        for (let i = 0; i < kids.length; i++) walkShadowTree(kids[i], visit, depth + 1);
        if (root.shadowRoot) walkShadowTree(root.shadowRoot, visit, depth + 1);
      } else if (root.nodeType === 11) {
        const kids = root.childNodes || [];
        for (let i = 0; i < kids.length; i++) {
          const n = kids[i];
          if (n && (n.nodeType === 1 || n.nodeType === 11)) walkShadowTree(n, visit, depth + 1);
        }
      } else if (root.nodeType === 9) {
        walkShadowTree(root.documentElement, visit, depth);
      }
    }
    function firstVisibleMatch(doc, sels) {
      const top = doc.documentElement || doc.body;
      if (!top) return null;
      let found = null;
      walkShadowTree(
        top,
        (el) => {
          if (found || el.nodeType !== 1) return;
          for (let i = 0; i < sels.length; i++) {
            try {
              if (el.matches && el.matches(sels[i]) && vis(el)) {
                found = el;
                return;
              }
            } catch (_) {}
          }
        },
        0,
      );
      return found;
    }
    function walk(doc, depth) {
      if (!doc || depth > 14) return false;
      const el = firstVisibleMatch(doc, selectors);
      if (el) {
        try {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        } catch (_) {}
        el.click();
        return true;
      }
      let frames;
      try {
        frames = doc.querySelectorAll("iframe");
      } catch (_) {
        return false;
      }
      for (let i = 0; i < frames.length; i++) {
        try {
          const c = frames[i].contentDocument;
          if (walk(c, depth + 1)) return true;
        } catch (_) {}
      }
      return false;
    }
    return walk(document, 0);
  })(${JSON.stringify(parts)})`);
  return r?.value === true;
}

/** Click first control whose accessible name matches hint substrings (shadow + iframes). */
async function clickLabeledControlDeep(session, hintsLower, excludeLower) {
  const r = await session.evaluate(`((hints, excludes) => {
    ${A11Y_CONTROL_HELPERS}
    function tryDoc(doc, depth) {
      if (!doc || depth > 14) return false;
      const top = doc.documentElement || doc.body;
      if (top && __raWalkClickMatching(top, hints, excludes, 0)) return true;
      let frames;
      try {
        frames = doc.querySelectorAll("iframe");
      } catch (_) {
        return false;
      }
      for (let i = 0; i < frames.length; i++) {
        try {
          const c = frames[i].contentDocument;
          if (c && tryDoc(c, depth + 1)) return true;
        } catch (_) {}
      }
      return false;
    }
    return tryDoc(document, 0);
  })(${JSON.stringify(hintsLower)}, ${JSON.stringify(excludeLower)})`);
  return r?.value === true;
}

async function clickNewChatDeep(session) {
  for (let i = 0; i < NEW_CHAT_BUTTON_SELECTORS.length; i++) {
    const sel = NEW_CHAT_BUTTON_SELECTORS[i];
    if (await clickFirstVisibleDeep(session, sel)) return true;
  }
  return await clickLabeledControlDeep(session, NEW_CHAT_A11Y_HINTS, NEW_CHAT_A11Y_EXCLUDE);
}

/**
 * Lexical often nests the real editor: outer #m365-chat-editor-target-element vs inner [contenteditable="true"].
 * CDP Input.insertText targets the focused node; focusing only the outer shell can paste "nowhere".
 */
async function focusComposer(session) {
  const r = await session.evaluate(`(() => {
    ${COMPOSER_DOM_HELPERS}
    const el = __raFindComposerEditable();
    if (!el) return false;
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch (_) {}
    el.click();
    el.focus();
    return true;
  })()`);
  return r.value === true;
}

async function waitForComposer(session) {
  const start = Date.now();
  while (Date.now() - start < COMPOSER_WAIT_MS) {
    if (await focusComposer(session)) return;
    await sleep(250);
  }
  throw new Error("Copilot composer not found or not visible");
}

/** Approximate visible character count in composer (Lexical exposes innerText on root). */
async function getComposerTextLength(session) {
  const r = await session.evaluate(`(() => {
    ${COMPOSER_DOM_HELPERS}
    function lenOf(el) {
      if (!el) return 0;
      const raw = el.innerText || el.textContent || '';
      const t = raw.replace(new RegExp(String.fromCharCode(0x200b), 'g'), '');
      return t.trim().length;
    }
    const el = __raFindComposerEditable();
    return lenOf(el);
  })()`).catch(() => ({ value: 0 }));
  return Number(r.value) || 0;
}

async function cdpInputEnable(session) {
  await session.send("Page.bringToFront", {}).catch(() => {});
  await session.send("Input.enable", {}).catch(() => {});
}

/** Unicode-safe chunking (avoid splitting surrogate pairs with string.slice byte indices). */
function chunkByCodePoints(text, size) {
  const units = Array.from(text);
  const out = [];
  for (let i = 0; i < units.length; i += size) {
    out.push(units.slice(i, i + size).join(""));
  }
  return out;
}

function pasteNeedMinChars(textLen) {
  if (textLen < 20) return 1;
  let n = Math.min(120, Math.max(12, Math.floor(textLen * 0.06)));
  if (textLen > 5000) n = Math.min(n, 96);
  return n;
}

/** Reject “success” when only a short tail (e.g. fenced relay_tool example) is visible in a long prompt. */
function pasteLooksComplete(visibleLen, fullLen) {
  if (fullLen < 20) return visibleLen >= 1;
  if (fullLen <= 400) {
    return visibleLen >= Math.max(1, Math.floor(fullLen * 0.82));
  }
  if (fullLen <= 2500) {
    return visibleLen >= Math.max(80, Math.floor(fullLen * 0.22));
  }
  if (fullLen <= 8000) {
    return visibleLen >= Math.max(200, Math.min(1800, Math.floor(fullLen * 0.18)));
  }
  // 10k+ tool catalogs: never treat ~720 chars as “complete” (old bug skipped real CDP insert).
  const need = Math.max(900, Math.min(3200, Math.floor(fullLen * 0.065)));
  return visibleLen >= need;
}

/**
 * Single Runtime.evaluate: run many execCommand("insertText") slices in one synchronous turn.
 * Often works when CDP Input.insertText never reaches Lexical (focus/session quirks on M365).
 */
async function pasteViaSyncBrowserExecCommand(session, text) {
  const res = await session.evaluate(
    `((fullText) => {
      ${COMPOSER_DOM_HELPERS}
      function lenOf(el) {
        if (!el) return 0;
        const raw = el.innerText || el.textContent || "";
        const t = raw.replace(new RegExp(String.fromCharCode(0x200b), "g"), "");
        return t.trim().length;
      }
      const el = __raFindComposerEditable();
      if (!el) return { ok: false, reason: "no_composer", visibleLen: 0 };
      el.focus();
      const doc = el.ownerDocument;
      try {
        doc.defaultView && doc.defaultView.focus();
      } catch (_) {}
      try {
        const sel = doc.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
      const units = Array.from(fullText);
      const step = 1200;
      let execTrue = 0;
      for (let i = 0; i < units.length; i += step) {
        const slice = units.slice(i, i + step).join("");
        try {
          if (doc.execCommand("insertText", false, slice)) execTrue++;
        } catch (e) {
          return { ok: false, reason: String(e && e.message ? e.message : e), visibleLen: lenOf(el), execTrue };
        }
      }
      return {
        ok: true,
        visibleLen: lenOf(el),
        codeUnits: units.length,
        execTrue,
      };
    })(${JSON.stringify(text)})`,
    120e3,
  );
  const v = res?.value;
  return v && typeof v === "object" ? v : { ok: false, reason: "bad_eval_return", raw: v };
}

/**
 * Lexical often ingests full payloads correctly from a single synthetic paste (one transaction).
 * Chunked CDP Input.insertText / per-chunk execCommand+focus can leave only the last fragment visible.
 */
async function pasteViaSyntheticClipboard(session, text) {
  const maxPerPaste = 12e3;
  const parts = chunkByCodePoints(text, maxPerPaste);
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const r = await session.evaluate(`
      ((payload, isFirstPart) => {
        ${COMPOSER_DOM_HELPERS}
        const el = __raFindComposerEditable();
        if (!el) return false;
        if (isFirstPart) {
          el.focus();
          try {
            const sel = el.ownerDocument.getSelection();
            const range = el.ownerDocument.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (_) {}
        }
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', payload);
          el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertFromPaste',
            data: payload
          }));
          el.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true
          }));
          return true;
        } catch (_) {
          return false;
        }
      })(${JSON.stringify(part)}, ${pi === 0})
    `);
    if (r.value !== true) return false;
    await sleep(parts.length > 1 ? 120 : 80);
  }
  return true;
}

/** Clear composer via keyboard so Lexical updates internal state. */
async function clearComposerViaKeyboard(session) {
  const mod = process.platform === "darwin" ? 4 : 2; // Meta vs Ctrl (select all)
  await session.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: mod
  });
  await session.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: mod
  });
  await sleep(40);
  await session.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8
  });
  await session.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8
  });
  await sleep(80);
}

/**
 * Insert text using Chromium CDP Input.insertText (IME-style). Lexical ignores innerText + generic input events.
 * Code-point chunks; do not refocus mid-loop (refocus can reset selection so only the last chunk remains).
 * Slightly larger chunks + pacing for 10k+ prompts (fewer CDP round-trips).
 */
async function insertTextViaCdp(session, text) {
  const chunkSize = text.length > 8000 ? 380 : 200;
  const chunks = chunkByCodePoints(text, chunkSize);
  const pause = chunks.length > 50 ? 42 : 30;
  for (let i = 0; i < chunks.length; i++) {
    await session.send("Input.insertText", { text: chunks[i] });
    await sleep(pause);
  }
}

/** Fallback: beforeinput + input with InputEvent (some React versions listen for this). Batched so one evaluate does not freeze the page. */
async function insertTextViaInputEvents(session, text) {
  const cap = 4e3;
  const segments = chunkByCodePoints(text, cap);
  if (segments.length > 1) {
    console.error("[copilot:paste] InputEvent fallback in", segments.length, "segments (", text.length, "chars )");
  }
  const batchSize = 48;
  for (let si = 0; si < segments.length; si++) {
    const txt = segments[si];
    const batches = chunkByCodePoints(txt, batchSize);
    for (const batch of batches) {
      await session.evaluate(`
      ((payload) => {
        ${COMPOSER_DOM_HELPERS}
        const el = __raFindComposerEditable();
        if (!el) return false;
        el.focus();
        for (const c of payload) {
          el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, inputType: 'insertText', data: c
          }));
          el.dispatchEvent(new InputEvent('input', {
            bubbles: true, inputType: 'insertText', data: c
          }));
        }
        return true;
      })(${JSON.stringify(batch)})
    `);
      await sleep(12);
    }
    if (si < segments.length - 1) await sleep(80);
  }
}

/**
 * Lexical often accepts execCommand insertText when CDP Input.insertText does not update the tree.
 * Focus + collapse selection only on the first chunk; repeating focus() each tick often replaces the whole composer.
 */
async function insertTextViaExecCommand(session, text) {
  const chunks = chunkByCodePoints(text, 180);
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const isFirst = ci === 0;
    await session.evaluate(`
      ((payload, isFirst) => {
        ${COMPOSER_DOM_HELPERS}
        const el = __raFindComposerEditable();
        if (!el) return false;
        if (isFirst) {
          el.focus();
          try {
            const sel = el.ownerDocument.getSelection();
            const range = el.ownerDocument.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (_) {}
        }
        try {
          return el.ownerDocument.execCommand('insertText', false, payload);
        } catch (_) {
          return false;
        }
      })(${JSON.stringify(chunk)}, ${isFirst})
    `);
    await sleep(14);
  }
}

/** Last resort: synthetic key events with "text" (slower; works when insertText is blocked). */
async function insertTextViaKeyChars(session, text) {
  const maxChars = 12e3;
  const units = Array.from(text);
  const slice = units.length > maxChars ? units.slice(0, maxChars).join("") : text;
  if (units.length > maxChars) {
    console.error("[copilot:paste] truncating prompt to", maxChars, "chars for keyChar fallback");
  }
  for (const ch of slice) {
    if (ch === "\n") {
      await session.send("Input.dispatchKeyEvent", {
        type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
      });
      await session.send("Input.dispatchKeyEvent", {
        type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
      });
    } else {
      await session.send("Input.dispatchKeyEvent", { type: "char", text: ch });
    }
  }
}

async function pastePromptRaw(session, text) {
  console.error("[copilot:paste] begin (", text.length, "chars )");
  await session.send("Runtime.enable", {}).catch(() => {});
  await session.send("DOM.enable", {}).catch(() => {});
  await cdpInputEnable(session);
  await waitForComposer(session);
  await sleep(550);

  const preClearLen = await getComposerTextLength(session);
  if (preClearLen > 0) {
    await clearComposerViaKeyboard(session);
    await sleep(120);
  }
  await focusComposer(session);
  await sleep(120);

  let errInsert = null;
  let len = 0;
  let pasted = false;
  const needMin = pasteNeedMinChars(text.length);

  let skipBulkFallbacks = false;
  try {
    console.error("[copilot:paste] trying sync in-page execCommand (single evaluate, ~1200 code units/step)…");
    const syncRes = await pasteViaSyncBrowserExecCommand(session, text);
    console.error("[copilot:paste] sync in-page execCommand result:", JSON.stringify(syncRes));
  } catch (e) {
    console.error("[copilot:paste] sync in-page execCommand threw:", e?.message || e);
  }
  await sleep(450);
  len = await getComposerTextLength(session);
  console.error("[copilot:paste] visible len after sync in-page:", len);
  if (pasteLooksComplete(len, text.length)) {
    skipBulkFallbacks = true;
    console.error("[copilot:paste] pasteLooksComplete after sync in-page");
  }

  /** Very long prompts: synthetic multi-part paste often drops text; stream via CDP first. */
  if (!skipBulkFallbacks && text.length > 12_000) {
    console.error("[copilot:paste] long prompt — CDP Input.insertText first (", text.length, "chars )");
    try {
      await insertTextViaCdp(session, text);
      await sleep(500);
      len = await getComposerTextLength(session);
      console.error("[copilot:paste] after CDP-first, visible len:", len);
      if (pasteLooksComplete(len, text.length)) {
        console.error("[copilot:paste] CDP-first satisfied pasteLooksComplete");
      } else {
        console.error("[copilot:paste] CDP-first incomplete vs heuristic, clearing and trying synthetic…");
        if (len > 0) {
          await clearComposerViaKeyboard(session);
          await sleep(120);
          await focusComposer(session);
          await sleep(80);
        }
        errInsert = null;
      }
    } catch (e) {
      errInsert = e;
      console.error("[copilot:paste] CDP-first failed:", e?.message || e);
    }
  }

  if (!skipBulkFallbacks && !pasteLooksComplete(len, text.length)) {
    console.error("[copilot:paste] trying synthetic Clipboard paste…");
    try {
      pasted = await pasteViaSyntheticClipboard(session, text);
    } catch (e) {
      console.error("[copilot:paste] synthetic paste failed:", e?.message || e);
    }
    await sleep(pasted ? 500 : 0);
    len = await getComposerTextLength(session);
    if (pasteLooksComplete(len, text.length)) skipBulkFallbacks = true;
  }

  if (!skipBulkFallbacks && !pasteLooksComplete(len, text.length)) {
    if (pasted && len > 0) {
      console.error("[copilot:paste] incomplete after synthetic (visible", len, "), clear + CDP Input.insertText");
      await clearComposerViaKeyboard(session);
      await sleep(100);
      await focusComposer(session);
      await sleep(80);
    }
    console.error("[copilot:paste] CDP Input.insertText (", text.length, "chars )");
    try {
      await insertTextViaCdp(session, text);
    } catch (e) {
      errInsert = e;
      console.error("[copilot:paste] Input.insertText failed:", e?.message || e);
    }
    await sleep(400);
    len = await getComposerTextLength(session);
    if (pasteLooksComplete(len, text.length)) skipBulkFallbacks = true;
  } else if (skipBulkFallbacks) {
    /* already satisfied */
  } else {
    console.error("[copilot:paste] pasteLooksComplete OK, visible len:", len);
  }

  await sleep(200);
  len = await getComposerTextLength(session);

  if (!skipBulkFallbacks && len < needMin && text.length >= 20) {
    console.error("[copilot:paste] composer still short (", len, "), trying execCommand insertText");
    await focusComposer(session);
    if ((await getComposerTextLength(session)) > 0) {
      await clearComposerViaKeyboard(session);
      await sleep(100);
    }
    await focusComposer(session);
    await sleep(100);
    await insertTextViaExecCommand(session, text);
    await sleep(400);
    len = await getComposerTextLength(session);
  }

  if (!skipBulkFallbacks && len < needMin && text.length >= 20) {
    console.error("[copilot:paste] composer still short (", len, "), trying InputEvent fallback");
    await focusComposer(session);
    if ((await getComposerTextLength(session)) > 0) {
      await clearComposerViaKeyboard(session);
      await sleep(100);
    }
    await focusComposer(session);
    await sleep(80);
    await insertTextViaInputEvents(session, text);
    await sleep(400);
    len = await getComposerTextLength(session);
  }

  if (!skipBulkFallbacks && len < needMin && text.length >= 20) {
    console.error("[copilot:paste] composer still short (", len, "), trying keyChar fallback");
    await focusComposer(session);
    if ((await getComposerTextLength(session)) > 0) {
      await clearComposerViaKeyboard(session);
      await sleep(100);
    }
    await focusComposer(session);
    await sleep(80);
    await insertTextViaKeyChars(session, text);
    await sleep(500);
    len = await getComposerTextLength(session);
  }

  if (text.length >= 20 && !pasteLooksComplete(len, text.length)) {
    const hint = errInsert ? ` CDP insertText error: ${errInsert.message}` : "";
    const floorLong = Math.min(2200, Math.floor(text.length * 0.045));
    if (text.length > 8000 && len >= 700 && len >= floorLong) {
      console.error(
        "[copilot:paste] continuing despite strict pasteLooksComplete (long prompt; innerText may cap) visible_len=",
        len,
        "floorLong=",
        floorLong,
      );
    } else {
      throw new Error(
        `Prompt did not reach Copilot composer (visible length ${len}, expected ~${text.length}).${hint}`
      );
    }
  }

  console.error("[copilot:paste] composer length OK:", len);
  await sleep(300);
}

/** Lexical often does not expose the full prompt in innerText — cap so we do not spin 15s waiting. */
function minComposerThresholdForSubmit(expectedPromptLen) {
  const raw = Math.min(
    Math.max(8, Math.floor(expectedPromptLen * 0.15)),
    Math.floor(expectedPromptLen * 0.85)
  );
  return Math.min(raw, 400);
}

async function dispatchEnterKey(session, modifiers = 0) {
  for (const phase of ["keyDown", "keyUp"]) {
    await session.send("Input.dispatchKeyEvent", {
      type: phase,
      key: "Enter",
      code: "Enter",
      modifiers,
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
  }
}

async function trySubmitViaEnter(session) {
  await cdpInputEnable(session);
  await focusComposer(session);
  await sleep(100);
  await dispatchEnterKey(session, 0);
}

/** Some builds use Ctrl+Enter to send while Enter inserts a newline. */
async function trySubmitViaCtrlEnter(session) {
  await cdpInputEnable(session);
  await focusComposer(session);
  await sleep(100);
  await dispatchEnterKey(session, 2);
}

async function composerSubmitLooksSent(session, lenBefore) {
  await sleep(700);
  const generating = await isCopilotGenerating(session);
  const lenNow = await getComposerTextLength(session);
  return generating || lenNow + 25 < lenBefore;
}

/**
 * Find a visible, enabled primary send control (avoid "Send feedback" etc.).
 * Returns { ok, x, y } viewport center for CDP mouse fallback, or { ok: false }.
 */
async function findSendButtonCenter(session) {
  const r = await session.evaluate(`(() => {
    function visible(el) {
      return el && el.offsetParent !== null;
    }
    function clickable(el) {
      if (!visible(el)) return false;
      if (el.disabled) return false;
      if (el.getAttribute("aria-disabled") === "true") return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      return true;
    }
    function badLabel(label) {
      if (!label) return true;
      return /send feedback|送信する場所|settings|設定|share|共有/i.test(label);
    }
    function tryEl(el) {
      if (!clickable(el)) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    const bySelector = [
      'button[data-testid="sendButton"]',
      'button[data-testid^="send"]',
      '[data-testid="sendButton"]',
      ".fai-SendButton",
      'button.fai-SendButton',
      'div[role="button"][data-testid="sendButton"]'
    ];
    for (const sel of bySelector) {
      for (const el of document.querySelectorAll(sel)) {
        const p = tryEl(el);
        if (p) return { ok: true, ...p };
      }
    }
    for (const el of document.querySelectorAll("button, [role='button']")) {
      const label = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
      if (badLabel(label)) continue;
      if (
        /送信(?!.*フィードバック)/.test(label) ||
        /^send$/i.test(label) ||
        /send message/i.test(label) ||
        (label.includes("Send") && !/sending|sender/i.test(label)) ||
        /^reply$/i.test(label)
      ) {
        const p = tryEl(el);
        if (p) return { ok: true, ...p };
      }
    }
    return { ok: false };
  })()`).catch(() => ({ value: { ok: false } }));
  const v = r.value;
  if (v && v.ok) return v;
  return { ok: false };
}

async function clickSendViaDom(session) {
  const r = await session.evaluate(`(() => {
    function visible(el) {
      return el && el.offsetParent !== null;
    }
    function clickable(el) {
      if (!visible(el)) return false;
      if (el.disabled) return false;
      if (el.getAttribute("aria-disabled") === "true") return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      return true;
    }
    function badLabel(label) {
      if (!label) return true;
      return /send feedback|送信する場所|settings|設定/i.test(label);
    }
    const bySelector = [
      'button[data-testid="sendButton"]',
      'button[data-testid^="send"]',
      ".fai-SendButton",
      'button.fai-SendButton'
    ];
    for (const sel of bySelector) {
      for (const el of document.querySelectorAll(sel)) {
        if (clickable(el)) {
          el.click();
          return true;
        }
      }
    }
    for (const el of document.querySelectorAll("button, [role='button']")) {
      const label = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
      if (badLabel(label)) continue;
      if (
        /送信(?!.*フィードバック)/.test(label) ||
        /^send$/i.test(label) ||
        /send message/i.test(label) ||
        (label.includes("Send") && !/sending|sender/i.test(label)) ||
        /^reply$/i.test(label)
      ) {
        if (clickable(el)) {
          el.click();
          return true;
        }
      }
    }
    return false;
  })()`).catch(() => ({ value: false }));
  return r.value === true;
}

async function clickSendViaCdpMouse(session) {
  const pos = await findSendButtonCenter(session);
  if (!pos.ok) return false;
  const { x, y } = pos;
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y
  }).catch(() => {});
  await sleep(40);
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1
  }).catch(() => {});
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1
  }).catch(() => {});
  return true;
}

async function submitPromptRaw(session, expectedPromptLen, netCapture = null) {
  const minComposer = minComposerThresholdForSubmit(expectedPromptLen);

  // Until composer shows our text, Send often stays disabled
  const composeDeadline = Date.now() + 15e3;
  while (Date.now() < composeDeadline) {
    const n = await getComposerTextLength(session);
    if (n >= minComposer || expectedPromptLen < 20) break;
    await sleep(200);
  }

  const lenBefore = await getComposerTextLength(session);

  // Prefer keyboard submit first (fewer brittle send-button selectors / layout deps).
  console.error("[copilot:submit] trying keyboard (Enter)");
  await trySubmitViaEnter(session);
  let sendClicked = await composerSubmitLooksSent(session, lenBefore);
  if (!sendClicked) {
    console.error("[copilot:submit] Enter not confirmed; trying Ctrl+Enter");
    await trySubmitViaCtrlEnter(session);
    sendClicked = await composerSubmitLooksSent(session, lenBefore);
  }

  // Wait for send button to become visible and enabled
  const deadline = Date.now() + 45e3;
  let stableSince = 0;
  while (!sendClicked && Date.now() < deadline) {
    const pos = await findSendButtonCenter(session);
    if (pos.ok) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 500) {
        console.error("[copilot:submit] clicking send (DOM)");
        const domOk = await clickSendViaDom(session);
        if (!domOk) {
          await session.click(SEND_BUTTON_ANY_SELECTOR).catch(() => {});
        }
        await sleep(700);
        let generating = await isCopilotGenerating(session);
        let lenNow = await getComposerTextLength(session);
        let looksSent = generating || lenNow + 25 < lenBefore;
        if (!looksSent) {
          console.error("[copilot:submit] DOM click did not dispatch; trying CDP mouse");
          await clickSendViaCdpMouse(session);
          await sleep(700);
          generating = await isCopilotGenerating(session);
          lenNow = await getComposerTextLength(session);
          looksSent = generating || lenNow + 25 < lenBefore;
        }
        if (looksSent) {
          sendClicked = true;
          break;
        }
        console.error("[copilot:submit] send not confirmed; waiting for UI again");
        stableSince = 0;
        await sleep(500);
      }
    } else {
      stableSince = 0;
    }
    await sleep(200);
  }

  if (!sendClicked) {
    console.error("[copilot:submit] no send button; trying Enter");
    await trySubmitViaEnter(session);
    await sleep(2200);
    const generating = await isCopilotGenerating(session);
    const lenAfter = await getComposerTextLength(session);
    if (generating || lenAfter + 30 < lenBefore) {
      sendClicked = true;
    }
  }

  if (!sendClicked) {
    console.error("[copilot:submit] retry Enter + mouse");
    await trySubmitViaEnter(session);
    await sleep(300);
    await clickSendViaCdpMouse(session).catch(() => {});
    await sleep(2000);
    const generating2 = await isCopilotGenerating(session);
    const lenAfter2 = await getComposerTextLength(session);
    if (generating2 || lenAfter2 + 30 < lenBefore) {
      sendClicked = true;
    }
  }

  if (!sendClicked) {
    const n = await getComposerTextLength(session);
    throw new Error(
      `Copilot send failed (no clickable send within 45s, Enter did not start stream; composer visible length=${n}).`
    );
  }

  console.error(
    "[copilot:describe] send OK; waiting for Copilot reply (DOM/network, timeout",
    RESPONSE_TIMEOUT_MS / 1000,
    "s)…",
  );
  return await waitForDomResponse(session, netCapture, expectedPromptLen);
}

async function isCopilotGenerating(session) {
  const r = await session.evaluate(`(() => {
    function reallyVisible(el) {
      if (!el || el.offsetParent === null) return false;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) return false;
      return r.bottom > 2 && r.right > 2 && r.top < innerHeight - 2 && r.left < innerWidth - 2;
    }
    function walkElements(root, visit) {
      if (!root) return;
      if (root.nodeType === 1) visit(root);
      const tree = root.nodeType === 9 ? root.documentElement : root;
      if (!tree) return;
      const kids = tree.children || [];
      for (let i = 0; i < kids.length; i++) walkElements(kids[i], visit);
      if (tree.shadowRoot) walkElements(tree.shadowRoot, visit);
    }
    function queryDeepAll(selector, doc) {
      const top = doc.documentElement || doc.body;
      if (!top) return [];
      const out = [];
      walkElements(top, (el) => {
        try {
          if (el.matches && el.matches(selector)) out.push(el);
        } catch (_) {}
      });
      return out;
    }
    function isGeneratingInDoc(doc) {
      const sels = ${JSON.stringify(STREAMING_STOP_SELECTORS)};
      for (const s of sels) {
        for (const el of queryDeepAll(s, doc)) {
          if (reallyVisible(el)) return true;
        }
      }
      for (const b of queryDeepAll("button, [role='button'], [role='menuitem']", doc)) {
        if (!reallyVisible(b)) continue;
        const a = (b.getAttribute("aria-label") || b.getAttribute("title") || "").toLowerCase();
        if (!a) continue;
        if (/\\bstop\\b/.test(a) && /generat|stream|response|応答|生成|回答|作成/.test(a)) return true;
        if (/\\bcancel\\b/.test(a) && /response|応答|生成|回答|stream/.test(a)) return true;
        if (
          /arrêt|arret|interromp|interrupt|detener|detén|abbrechen/.test(a) &&
          /génér|genér|generat|réponse|response|respuesta|stream|flux|応答|生成/.test(a)
        )
          return true;
      }
      return false;
    }
    function scanDocs(doc, depth) {
      if (isGeneratingInDoc(doc)) return true;
      if (depth > 8) return false;
      let frames;
      try {
        frames = doc.querySelectorAll("iframe");
      } catch (_) {
        return false;
      }
      for (const f of frames) {
        try {
          const c = f.contentDocument;
          if (c && scanDocs(c, depth + 1)) return true;
        } catch (_) {}
      }
      return false;
    }
    return scanDocs(document, 0);
  })()`).catch(() => ({ value: false }));
  return r?.value === true;
}

/**
 * Prefer the outermost last assistant *turn*. Walks open shadow roots and same-origin iframes
 * (M365 often hosts the transcript in an embedded frame).
 */
async function extractAssistantReplyText(session) {
  const r = await session.evaluate(`(() => {
    function visible(el) {
      return el && el.offsetParent !== null;
    }
    function inComposer(el) {
      return !!(el && el.closest(${JSON.stringify(COMPOSER_ANCESTOR_CLOSEST)}));
    }
    /** User bubbles often match generic markdown/article selectors — never treat as assistant reply. */
    function inUserTurn(el) {
      if (!el) return false;
      try {
        if (el.closest('[data-message-author-role="user"]')) return true;
        if (el.closest('[data-message-author-role="User"]')) return true;
        if (el.closest('[data-testid="userMessage"]')) return true;
        if (el.closest('[data-testid*="user-message"]')) return true;
        if (el.closest('[data-testid*="UserMessage"]')) return true;
        if (el.matches && el.matches('cib-message[type="user"]')) return true;
        if (el.closest('[aria-label*="Your message"]')) return true;
        if (el.closest('[aria-label*="your message"]')) return true;
        if (el.closest('[aria-label*="送信した"]')) return true;
        if (el.closest('[aria-label*="自分のメッセージ"]')) return true;
      } catch (_) {}
      return false;
    }
    function nodeText(el) {
      const t = (el.innerText || el.textContent || "").trim();
      return t;
    }
    function walkElements(root, visit) {
      if (!root) return;
      if (root.nodeType === 1) visit(root);
      const tree = root.nodeType === 9 ? root.documentElement : root;
      if (!tree) return;
      const kids = tree.children || [];
      for (let i = 0; i < kids.length; i++) walkElements(kids[i], visit);
      if (tree.shadowRoot) walkElements(tree.shadowRoot, visit);
    }
    function queryDeepAll(selector, doc) {
      const top = doc.documentElement || doc.body;
      if (!top) return [];
      const out = [];
      walkElements(top, (el) => {
        try {
          if (el.matches && el.matches(selector)) out.push(el);
        } catch (_) {}
      });
      return out;
    }
    function extractFromDoc(doc) {
      const byRole = [...new Set([
        ...queryDeepAll('[data-message-author-role="assistant"]', doc),
        ...queryDeepAll('article[data-message-author-role="assistant"]', doc)
      ])];
      const roots = [];
      for (const el of byRole) {
        if (!visible(el) || inComposer(el) || inUserTurn(el)) continue;
        const inner = byRole.some((other) => other !== el && other.contains(el));
        if (inner) continue;
        roots.push(el);
      }
      roots.sort((a, b) => {
        const p = a.compareDocumentPosition(b);
        if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      if (roots.length) {
        const lastTurn = roots[roots.length - 1];
        const t = nodeText(lastTurn);
        if (t.length > 0) return t;
      }

      const selectors = ${JSON.stringify(ASSISTANT_REPLY_DOM_SELECTORS)};
      const dedup = new Set();
      const els = [];
      for (const s of selectors) {
        for (const el of queryDeepAll(s, doc)) {
          if (!el || dedup.has(el)) continue;
          dedup.add(el);
          if (!visible(el) || inComposer(el) || inUserTurn(el)) continue;
          const t = nodeText(el);
          if (!t) continue;
          els.push(el);
        }
      }
      if (!els.length) return "";
      els.sort((a, b) => {
        const p = a.compareDocumentPosition(b);
        if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      const tail = els.slice(-8);
      let best = "";
      for (const el of tail) {
        const t = nodeText(el);
        if (t.length > best.length) best = t;
      }
      return best;
    }
    function bestAcrossIframes(doc, depth) {
      let best = extractFromDoc(doc);
      if (depth > 8) return best;
      let frames;
      try {
        frames = doc.querySelectorAll("iframe");
      } catch (_) {
        return best;
      }
      for (const f of frames) {
        try {
          const c = f.contentDocument;
          if (c) {
            const inner = bestAcrossIframes(c, depth + 1);
            if (inner.length > best.length) best = inner;
          }
        } catch (_) {}
      }
      return best;
    }
    return bestAcrossIframes(document, 0);
  })()`).catch(() => ({ value: "" }));
  return typeof r?.value === "string" ? r.value : "";
}

/** Last assistant turn by ARIA role only (avoids picking user text from generic markdown selectors). */
async function extractAssistantReplyStrict(session) {
  const r = await session.evaluate(`(() => {
    function visible(el) {
      return el && el.offsetParent !== null;
    }
    function inComposer(el) {
      return !!(el && el.closest(${JSON.stringify(COMPOSER_ANCESTOR_CLOSEST)}));
    }
    function inUserTurn(el) {
      if (!el) return false;
      try {
        if (el.closest('[data-message-author-role="user"]')) return true;
        if (el.closest('[data-message-author-role="User"]')) return true;
        if (el.closest('[data-testid="userMessage"]')) return true;
        if (el.closest('[data-testid*="user-message"]')) return true;
        if (el.closest('[data-testid*="UserMessage"]')) return true;
        if (el.matches && el.matches('cib-message[type="user"]')) return true;
        if (el.closest('[aria-label*="Your message"]')) return true;
        if (el.closest('[aria-label*="your message"]')) return true;
        if (el.closest('[aria-label*="送信した"]')) return true;
        if (el.closest('[aria-label*="自分のメッセージ"]')) return true;
      } catch (_) {}
      return false;
    }
    function extractFromDoc(doc) {
      const byRole = [
        ...doc.querySelectorAll('[data-message-author-role="assistant"]'),
        ...doc.querySelectorAll('article[data-message-author-role="assistant"]'),
      ];
      const roots = [];
      for (const el of byRole) {
        if (!visible(el) || inComposer(el) || inUserTurn(el)) continue;
        const inner = byRole.some((other) => other !== el && other.contains(el));
        if (inner) continue;
        roots.push(el);
      }
      roots.sort((a, b) => {
        const p = a.compareDocumentPosition(b);
        if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      if (!roots.length) return "";
      const lastTurn = roots[roots.length - 1];
      return (lastTurn.innerText || lastTurn.textContent || "").trim();
    }
    function bestAcrossIframes(doc, depth) {
      let best = extractFromDoc(doc);
      if (depth > 8) return best;
      let frames;
      try {
        frames = doc.querySelectorAll("iframe");
      } catch (_) {
        return best;
      }
      for (const f of frames) {
        try {
          const c = f.contentDocument;
          if (c) {
            const inner = bestAcrossIframes(c, depth + 1);
            if (inner.length > best.length) best = inner;
          }
        } catch (_) {}
      }
      return best;
    }
    return bestAcrossIframes(document, 0);
  })()`).catch(() => ({ value: "" }));
  return typeof r?.value === "string" ? r.value : "";
}

/**
 * M365 often omits role="assistant" on the visible node; try Copilot / Fluent / cib patterns.
 * Returns the *last* substantial match in document order (reply is usually below the user prompt).
 */
async function extractAssistantReplyHeuristic(session) {
  const r = await session.evaluate(`(() => {
    function visible(el) {
      return el && el.offsetParent !== null;
    }
    function inComposer(el) {
      return !!(el && el.closest(${JSON.stringify(COMPOSER_ANCESTOR_CLOSEST)}));
    }
    function inUserTurn(el) {
      if (!el) return false;
      try {
        if (el.closest('[data-message-author-role="user"]')) return true;
        if (el.closest('[data-message-author-role="User"]')) return true;
        if (el.closest('[data-testid="userMessage"]')) return true;
        if (el.closest('[data-testid*="user-message"]')) return true;
        if (el.closest('[data-testid*="UserMessage"]')) return true;
        if (el.matches && el.matches('cib-message[type="user"]')) return true;
        if (el.closest('[aria-label*="Your message"]')) return true;
        if (el.closest('[aria-label*="your message"]')) return true;
        if (el.closest('[aria-label*="送信した"]')) return true;
        if (el.closest('[aria-label*="自分のメッセージ"]')) return true;
      } catch (_) {}
      return false;
    }
    function nodeText(el) {
      return (el.innerText || el.textContent || "").trim();
    }
    function walkElements(root, visit) {
      if (!root) return;
      if (root.nodeType === 1) visit(root);
      const tree = root.nodeType === 9 ? root.documentElement : root;
      if (!tree) return;
      const kids = tree.children || [];
      for (let i = 0; i < kids.length; i++) walkElements(kids[i], visit);
      if (tree.shadowRoot) walkElements(tree.shadowRoot, visit);
    }
    function queryDeepAll(selector, doc) {
      const top = doc.documentElement || doc.body;
      if (!top) return [];
      const out = [];
      walkElements(top, (el) => {
        try {
          if (el.matches && el.matches(selector)) out.push(el);
        } catch (_) {}
      });
      return out;
    }
    const selectors = [
      '[data-testid*="assistant-message"]',
      '[data-testid*="AssistantMessage"]',
      '[data-testid*="bot-message"]',
      '[data-conversation-role="assistant"]',
      '[data-participant="assistant"]',
      'cib-message[type="response"]',
      'cib-message[conversation="response"]',
      'cib-turn[type="response"]',
      '[class*="assistantMessage"]',
      '[class*="BotMessage"]',
    ];
    function extractFromDoc(doc) {
      const dedup = new Set();
      const candidates = [];
      for (const s of selectors) {
        for (const el of queryDeepAll(s, doc)) {
          if (!el || dedup.has(el)) continue;
          dedup.add(el);
          if (!visible(el) || inComposer(el) || inUserTurn(el)) continue;
          const t = nodeText(el);
          if (t.length < 12) continue;
          candidates.push(el);
        }
      }
      if (!candidates.length) return "";
      candidates.sort((a, b) => {
        const p = a.compareDocumentPosition(b);
        if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      const last = candidates[candidates.length - 1];
      return nodeText(last);
    }
    function bestAcrossIframes(doc, depth) {
      let best = extractFromDoc(doc);
      if (depth > 8) return best;
      let frames;
      try {
        frames = doc.querySelectorAll("iframe");
      } catch (_) {
        return best;
      }
      for (const f of frames) {
        try {
          const c = f.contentDocument;
          if (c) {
            const inner = bestAcrossIframes(c, depth + 1);
            if (inner.length > best.length) best = inner;
          }
        } catch (_) {}
      }
      return best;
    }
    return bestAcrossIframes(document, 0);
  })()`).catch(() => ({ value: "" }));
  return typeof r?.value === "string" ? r.value : "";
}

/** Whether to buffer a response body for assistant-text extraction (CDP Network). */
function shouldCaptureNetworkUrl(url) {
  if (!url || !RESPONSE_URL_PATTERN.test(url)) return false;
  if (process.env.RELAY_COPILOT_LEGACY_BROAD_NETWORK === "1") {
    const low = url.toLowerCase();
    if (NON_CHAT_NETWORK_PATH_RE.test(low)) return false;
    if (
      /telemetry|metrics|favicon|onecollector|browserpipe|clientevents|pacman\/api\/clientevents|search\/api\/v\d+\/events|\/events\?scenario=|chunk\.|webpack/i.test(
        low,
      )
    ) {
      return false;
    }
    return true;
  }
  return isAllowedChatNetworkUrl(url);
}

function clipNetworkText(s, max = 120_000) {
  const t = (s || "").trim();
  return t.length <= max ? t : t.slice(0, max);
}

function decodeJwtSegmentBase64Url(seg) {
  if (!seg || typeof seg !== "string") return "";
  try {
    const pad = (x) => x + "=".repeat((4 - (x.length % 4)) % 4);
    const b64 = pad(seg.replace(/-/g, "+").replace(/_/g, "/"));
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Detect JWS / OAuth access tokens so they are never shown as Copilot reply text.
 * Uses segment shape plus decoded header/payload heuristics (AAD / M365 issuers).
 */
function stringLooksLikeJwt(t) {
  const s = String(t || "").trim();
  const parts = s.split(".");
  if (parts.length !== 3) return false;
  const [h, p, sig] = parts;
  if (h.length < 10 || p.length < 40 || sig.length < 10) return false;
  if (!parts.every((x) => /^[A-Za-z0-9_-]+$/.test(x))) return false;
  if (s.length < 100) return false;
  const header = decodeJwtSegmentBase64Url(h);
  const payload = decodeJwtSegmentBase64Url(p);
  if (header && /"alg"\s*:/.test(header) && /"(typ|kid)"\s*:/.test(header)) {
    if (/"typ"\s*:\s*"JWT"/i.test(header) || /"typ"\s*:\s*"at\+jwt"/i.test(header)) return true;
  }
  if (payload && payload.startsWith("{")) {
    if (
      /"(aud|iss|exp|iat|nbf|sub|oid|tid)"\s*:/.test(payload) &&
      (/"iss"\s*:\s*"https:\/\/(sts\.windows\.net|login\.microsoftonline\.com)/i.test(payload) ||
        /substrate\.office\.com/i.test(payload) ||
        /graph\.microsoft\.com/i.test(payload))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Substrate Pacman clientevents / card-render bundles (not chat prose).
 * Matches telemetry JSON like browserName + SubstrateTraceId + cardCount.
 */
function stringLooksLikeM365ClientTelemetry(text) {
  const t = String(text || "").trim();
  if (t.length < 50) return false;
  let score = 0;
  if (/SubstrateTraceId/i.test(t)) score += 2;
  if (/SubstrateLogicalId/i.test(t)) score += 2;
  if (/browserName/i.test(t) && /browserVersion/i.test(t)) score += 2;
  if (/cardCount/i.test(t)) score += 1;
  if (/cardReferenceIds/i.test(t) || /cardIds/i.test(t)) score += 1;
  if (/substrateLatency/i.test(t)) score += 1;
  if (/renderLatency/i.test(t)) score += 1;
  if (/isFallbackCards/i.test(t)) score += 1;
  if (/hasGptSelected/i.test(t)) score += 1;
  if (/displayType/i.test(t) && /"value"\s*:\s*"(grid|list)"/i.test(t)) score += 1;
  return score >= 4;
}

/** Correlation / trace / event IDs from telemetry APIs — not user-visible Copilot text. */
function stringLooksLikeBareUuidOrHexId(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  /** 8-4-4-4-12 hex (incl. non-RFC correlation IDs from M365 telemetry). */
  const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidShape.test(t)) return true;
  if (/^[0-9a-f]{32}$/i.test(t)) return true;
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines.every((l) => uuidShape.test(l) || /^[0-9a-f]{32}$/i.test(l))) return true;
  const parts = t.split(/,\s*/).map((l) => l.trim()).filter(Boolean);
  if (
    parts.length >= 1 &&
    parts.length <= 6 &&
    parts.every((l) => uuidShape.test(l) || /^[0-9a-f]{32}$/i.test(l))
  )
    return true;
  if (t.startsWith("{") && t.length < 280) {
    if (
      /"(trace|correlation|event|request|session|logical)?id"\s*:\s*"[0-9a-f-]{32,36}"/i.test(t) &&
      !/"(text|content|message|markdown|answer)"\s*:/i.test(t)
    ) {
      return true;
    }
  }
  return false;
}

/** Longest usable string from network JSON/SSE; skips JWTs, garbage, and token-shaped blobs. */
function pickBestAssistantStringFromCandidates(candidates) {
  const sorted = [...candidates].sort((a, b) => String(b).length - String(a).length);
  for (const c of sorted) {
    const t = String(c || "").trim();
    if (t.length < 8) continue;
    if (stringLooksLikeJwt(t)) continue;
    if (stringLooksLikeM365ClientTelemetry(t)) continue;
    if (stringLooksLikeBareUuidOrHexId(t)) continue;
    if (networkExtractLooksLikeGarbage(t)) continue;
    return t;
  }
  return "";
}

/** HTML shell / static assets — not chat API bodies; scanning them yields huge junk (e.g. embedded base64). */
function skipNetworkBodyForAssistantExtraction(url, mimeType) {
  const m = (mimeType || "").toLowerCase();
  const low = (url || "").toLowerCase();
  if (/pacman\/api\/clientevents|\/clientevents\?/i.test(low)) return true;
  if (/search\/api\/v\d+\/events|\/events\?scenario=/i.test(low)) return true;
  if (m.startsWith("text/html")) return true;
  if (m.includes("javascript") || m.startsWith("text/css")) return true;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
    if (
      (host === "m365.cloud.microsoft" || host.endsWith(".m365.cloud.microsoft")) &&
      path === "/chat"
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Network extract that is not usable assistant prose (images, minified data URLs, near-pure base64).
 */
function networkExtractLooksLikeGarbage(text) {
  const t = (text || "").trim();
  if (t.length < 1) return true;
  if (stringLooksLikeJwt(t)) return true;
  if (stringLooksLikeM365ClientTelemetry(t)) return true;
  if (stringLooksLikeBareUuidOrHexId(t)) return true;
  if (/data:image\/[^;]+;base64,/i.test(t)) return true;
  if (t.length > 6_000) {
    const sample = t.slice(0, 12_000);
    let b64ish = 0;
    for (let i = 0; i < sample.length; i++) {
      const c = sample.charCodeAt(i);
      if (
        (c >= 65 && c <= 90) ||
        (c >= 97 && c <= 122) ||
        (c >= 48 && c <= 57) ||
        c === 43 ||
        c === 47 ||
        c === 61
      ) {
        b64ish++;
      }
    }
    if (b64ish / sample.length > 0.9) return true;
  }
  return false;
}

/** BizChat / M365 Copilot assistant stream (SignalR over WebSocket). */
function isM365ChathubWebSocketUrl(url) {
  const u = (url || "").toLowerCase();
  return (
    (u.startsWith("wss://") || u.startsWith("ws://")) &&
    /substrate\.office\.com\/m365copilot\/chathub\//i.test(u)
  );
}

function deepExtractTextBlocksFromAdaptive(card, depth) {
  if (depth > 14 || !card || typeof card !== "object") return [];
  const out = [];
  if (card.type === "TextBlock" && typeof card.text === "string") {
    const t = card.text.trim();
    if (t.length >= 2) out.push(t);
  }
  if (Array.isArray(card.body)) {
    for (const b of card.body) out.push(...deepExtractTextBlocksFromAdaptive(b, depth + 1));
  }
  return out;
}

function collectBotTextsFromChathubMessage(m) {
  if (!m || typeof m !== "object") return [];
  const out = [];
  const auth = String(m.author || "").toLowerCase();
  if ((auth === "bot" || auth === "assistant") && typeof m.text === "string") {
    const t = m.text.trim();
    if (t.length >= 2 && !stringLooksLikeJwt(t) && !stringLooksLikeBareUuidOrHexId(t)) out.push(t);
  }
  if (Array.isArray(m.adaptiveCards)) {
    for (const c of m.adaptiveCards) out.push(...deepExtractTextBlocksFromAdaptive(c, 0));
  }
  return out;
}

function collectBotTextsFromChathubJson(v, depth) {
  if (depth > 28 || v == null) return [];
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) out.push(...collectBotTextsFromChathubJson(x, depth + 1));
    return out;
  }
  if (typeof v !== "object") return [];
  const out = [];
  if (v.result && typeof v.result === "object" && typeof v.result.message === "string") {
    const t = v.result.message.trim();
    if (t.length >= 2 && !stringLooksLikeJwt(t)) out.push(t);
  }
  if (Array.isArray(v.messages)) {
    for (const m of v.messages) out.push(...collectBotTextsFromChathubMessage(m));
  }
  if (Array.isArray(v.arguments)) {
    for (const arg of v.arguments) out.push(...collectBotTextsFromChathubJson(arg, depth + 1));
  }
  for (const k of Object.keys(v)) {
    if (k === "arguments") continue;
    out.push(...collectBotTextsFromChathubJson(v[k], depth + 1));
  }
  return out;
}

/**
 * Merge ordered bot text chunks (streaming deltas or multi-record frames).
 * Prefer monotonic prefix extension; otherwise append (SignalR often sends growing `text`).
 */
function mergeChathubBotTextPieces(pieces) {
  const arr = pieces.map((p) => String(p || "").trim()).filter((p) => p.length >= 1);
  if (!arr.length) return "";
  let cur = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const p = arr[i];
    if (p.startsWith(cur)) {
      cur = p;
      continue;
    }
    if (cur.startsWith(p)) continue;
    if (p.length > cur.length && p.includes(cur)) {
      cur = p;
      continue;
    }
    cur += p;
  }
  return cur;
}

/**
 * One or more SignalR JSON records separated by ASCII RS (\\u001e).
 */
function extractAssistantFromChathubWsFramePayload(raw) {
  const s = typeof raw === "string" ? raw : "";
  if (!s) return "";
  const parts = s.split("\x1e");
  const collected = [];
  let bestSingle = "";
  for (const chunk of parts) {
    const part = chunk.trim();
    if (!part) continue;
    let j;
    try {
      j = JSON.parse(part);
    } catch {
      continue;
    }
    for (const t of collectBotTextsFromChathubJson(j, 0)) {
      const u = String(t || "").trim();
      if (!u) continue;
      collected.push(u);
      if (u.length > bestSingle.length) bestSingle = u;
    }
  }
  if (!collected.length) return "";
  const merged = mergeChathubBotTextPieces(collected);
  if (merged.length > bestSingle.length) return merged;
  return bestSingle;
}

function deepExtractAssistantStrings(v, depth) {
  if (depth > 14) return [];
  if (typeof v === "string") {
    const t = v.trim();
    if (t.length < 8) return [];
    if (/^[\d.,\s\-:+TZ]+$/.test(t)) return [];
    if (stringLooksLikeJwt(t)) return [];
    if (stringLooksLikeBareUuidOrHexId(t)) return [];
    return [t];
  }
  if (!v || typeof v !== "object") return [];
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) out.push(...deepExtractAssistantStrings(x, depth + 1));
    return out;
  }
  const keys = [
    "text",
    "content",
    "message",
    "answer",
    "body",
    "value",
    "markdown",
    "plainText",
    "spokenText",
    "result",
    "output",
  ];
  const out = [];
  for (const k of keys) {
    if (v[k] != null) out.push(...deepExtractAssistantStrings(v[k], depth + 1));
  }
  if (!out.length) {
    for (const k of Object.keys(v)) {
      if (k === "headers" || k === "cookies") continue;
      if (/^(access|id|refresh)(_|)?token$/i.test(k)) continue;
      if (/authorization|client_secret|password|credential|bearer$/i.test(k)) continue;
      out.push(...deepExtractAssistantStrings(v[k], depth + 1));
    }
  }
  return out;
}

function extractAssistantFromNetworkPayload(raw) {
  const rawTrim = (raw || "").trim();
  if (!rawTrim) return "";
  if (rawTrim.includes("\ndata:") || rawTrim.startsWith("data:")) {
    let acc = "";
    for (const line of rawTrim.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const parts = deepExtractAssistantStrings(j, 0);
        const best = pickBestAssistantStringFromCandidates(parts);
        if (best) acc += `${best}\n`;
      } catch {
        if (!stringLooksLikeJwt(payload)) acc += `${payload}\n`;
      }
    }
    return clipNetworkText(acc.replace(/\n+$/, ""));
  }
  try {
    const j = JSON.parse(rawTrim);
    const parts = deepExtractAssistantStrings(j, 0);
    const best = pickBestAssistantStringFromCandidates(parts);
    return best ? clipNetworkText(best) : "";
  } catch {
    return "";
  }
}

/**
 * Listens for Copilot-related HTTP responses; after DOM wait, pulls response bodies via CDP.
 * @param {CdpSession} session
 */
function createCopilotNetworkCapture(session) {
  const metas = [];
  const chathubRequestIds = new Set();
  const chathubFramePayloads = [];
  const maxChathubBufferChars = 2_500_000;

  const pickAssistantFromChathubWsSync = () => {
    const allPieces = [];
    for (let i = 0; i < chathubFramePayloads.length; i++) {
      const raw = chathubFramePayloads[i];
      const s = typeof raw === "string" ? raw : "";
      for (const chunk of s.split("\x1e")) {
        const part = chunk.trim();
        if (!part) continue;
        let j;
        try {
          j = JSON.parse(part);
        } catch {
          continue;
        }
        for (const piece of collectBotTextsFromChathubJson(j, 0)) {
          const u = String(piece || "").trim();
          if (u) allPieces.push(u);
        }
      }
    }
    if (!allPieces.length) return "";
    const merged = mergeChathubBotTextPieces(allPieces).trim();
    const bestSingle = allPieces.reduce((a, b) => (b.length > a.length ? b : a), "");
    const cand = merged.length >= bestSingle.length ? merged : bestSingle;
    if (!cand || networkExtractLooksLikeGarbage(cand)) return "";
    return cand;
  };

  const trimChathubBuffer = () => {
    let total = 0;
    for (const x of chathubFramePayloads) total += x.length;
    while (total > maxChathubBufferChars && chathubFramePayloads.length > 2) {
      const rm = chathubFramePayloads.shift();
      total -= rm.length;
    }
  };

  const onResponse = (params) => {
    const r = params.response;
    if (!r || r.status < 200 || r.status >= 400) return;
    const u = r.url || "";
    if (!shouldCaptureNetworkUrl(u)) return;
    metas.push({
      requestId: params.requestId,
      url: u,
      mimeType: String(r.mimeType || "")
        .split(";")[0]
        .trim(),
    });
  };

  const onWebSocketCreated = (params) => {
    const u = params.url || "";
    if (isM365ChathubWebSocketUrl(u)) {
      chathubRequestIds.add(params.requestId);
      console.error("[copilot:network] M365 Chathub WebSocket:", u.split("?")[0].slice(0, 120));
    }
  };

  const onWebSocketFrameReceived = (params) => {
    if (!chathubRequestIds.has(params.requestId)) return;
    const r = params.response;
    if (!r || r.opcode !== 1) return;
    const data = r.payloadData;
    if (typeof data !== "string" || !data.length) return;
    chathubFramePayloads.push(data);
    trimChathubBuffer();
  };

  return {
    async enable() {
      session.on("Network.responseReceived", onResponse);
      session.on("Network.webSocketCreated", onWebSocketCreated);
      session.on("Network.webSocketFrameReceived", onWebSocketFrameReceived);
      await session.send("Page.enable", {}).catch(() => {});
      await session
        .send("Network.enable", {
          maxTotalBufferSize: 100_000_000,
          maxResourceBufferSize: 50_000_000,
        })
        .catch((e) => {
          console.error("[copilot:network] Network.enable failed:", e?.message || e);
        });
      await session.send("Network.setCacheDisabled", { cacheDisabled: true }).catch(() => {});
    },
    /**
     * After Copilot has responded, try to beat DOM extraction using API / SSE payloads.
     * @param {string} domText
     * @param {number} [submittedPromptLen] when set, skip HTTP bodies whose length matches pasted prompt (user echo from REST).
     */
    async pickBestOver(domText, submittedPromptLen = 0) {
      const dom = (domText || "").trim();
      let best = dom;
      const ch = pickAssistantFromChathubWsSync().trim();
      if (
        ch.length > best.length &&
        ch.length >= CHATHUB_ASSISTANT_MIN_CHARS &&
        !networkExtractLooksLikeGarbage(ch)
      ) {
        best = ch;
        console.error("[copilot:network] Chathub WS seed pickBestOver len=", ch.length);
      }
      await sleep(1500);
      const recent = metas.slice(-35);
      if (dom.length < 20 && metas.length) {
        console.error("[copilot:network] captured responses=", metas.length, "scanning last", recent.length);
      }
      for (let i = recent.length - 1; i >= 0; i--) {
        const { requestId, url, mimeType } = recent[i];
        if (skipNetworkBodyForAssistantExtraction(url, mimeType)) continue;
        try {
          const rb = await session.send(
            "Network.getResponseBody",
            { requestId },
            12e3,
          );
          const raw = rb.base64Encoded
            ? Buffer.from(rb.body, "base64").toString("utf8")
            : rb.body;
          const t = extractAssistantFromNetworkPayload(raw).trim();
          if (networkExtractLooksLikeGarbage(t)) {
            console.error(
              "[copilot:network] skip garbage extract len=",
              t.length,
              "url=",
              url.slice(0, 120),
            );
            continue;
          }
          if (
            submittedPromptLen >= 1200 &&
            domExtractLooksLikeSubmittedPrompt(t.length, submittedPromptLen)
          ) {
            console.error(
              "[copilot:network] skip HTTP extract in submitted-prompt length band len=",
              t.length,
              "url=",
              url.slice(0, 100),
            );
            continue;
          }
          if (t.length > best.length && t.length >= 8) {
            console.error(
              "[copilot:network] candidate len=",
              t.length,
              "url=",
              url.slice(0, 140),
            );
            best = t;
          }
        } catch {
          /* not load-complete, binary, or CDP error */
        }
        if (best.length > 12_000) break;
      }
      const chEnd = pickAssistantFromChathubWsSync().trim();
      if (chEnd.length >= CHATHUB_ASSISTANT_MIN_CHARS && !networkExtractLooksLikeGarbage(chEnd)) {
        if (networkExtractLooksLikeGarbage(best) || chEnd.length > best.length) {
          best = chEnd;
          console.error("[copilot:network] Chathub WS final pickBestOver len=", chEnd.length);
        }
      }
      if (best.length > dom.length) {
        console.error("[copilot:network] using network text over DOM (dom len=", dom.length, ")");
      }
      return best;
    },
    /**
     * DOM is prompt-echo sized; pick the longest extracted network string that is NOT in that length band.
     * (pickBestOver only replaces when network is longer than dom, so short replies never win over a 15k echo.)
     */
    async pickBestShortAssistant(domEchoLen, submittedLen) {
      await sleep(500);
      const ch = pickAssistantFromChathubWsSync().trim();
      if (ch.length >= CHATHUB_ASSISTANT_MIN_CHARS && !networkExtractLooksLikeGarbage(ch)) {
        if (!(submittedLen >= 1200 && domExtractLooksLikeSubmittedPrompt(ch.length, submittedLen))) {
          console.error("[copilot:network] Chathub WS assistant (short path) len=", ch.length);
          return ch;
        }
      }
      const recent = metas.slice(-50);
      let best = "";
      const low = submittedLen ? submittedLen * 0.68 : domEchoLen * 0.8;
      const high = submittedLen ? submittedLen * 1.18 : domEchoLen * 1.05;
      for (let i = recent.length - 1; i >= 0; i--) {
        const { requestId, url, mimeType } = recent[i];
        if (skipNetworkBodyForAssistantExtraction(url, mimeType)) continue;
        try {
          const rb = await session.send(
            "Network.getResponseBody",
            { requestId },
            12e3,
          );
          const raw = rb.base64Encoded
            ? Buffer.from(rb.body, "base64").toString("utf8")
            : rb.body;
          const t = extractAssistantFromNetworkPayload(raw).trim();
          if (networkExtractLooksLikeGarbage(t)) continue;
          if (t.length < 16) continue;
          if (t.length >= low && t.length <= high) continue;
          if (t.length >= domEchoLen * 0.94) continue;
          if (t.length > best.length) {
            console.error(
              "[copilot:network] short-assistant candidate len=",
              t.length,
              "url=",
              url.slice(0, 120),
            );
            best = t;
          }
        } catch {
          /* ignore */
        }
        if (best.length > 8_000) break;
      }
      return best;
    },
    /** Best-effort assistant prose from M365 Chathub WebSocket frames (SignalR). */
    pickAssistantFromChathubWs: pickAssistantFromChathubWsSync,
    async disable() {
      session.off("Network.responseReceived", onResponse);
      session.off("Network.webSocketCreated", onWebSocketCreated);
      session.off("Network.webSocketFrameReceived", onWebSocketFrameReceived);
      chathubRequestIds.clear();
      chathubFramePayloads.length = 0;
      await session.send("Network.disable", {}).catch(() => {});
    },
  };
}

/** Loose DOM extract length ≈ pasted prompt → still showing user wall, not a real assistant reply. */
function domExtractLooksLikeSubmittedPrompt(textLen, submittedLen) {
  if (!submittedLen || submittedLen < 1200) return false;
  const low = submittedLen * 0.72;
  const high = submittedLen * 1.2;
  return textLen >= low && textLen <= high;
}

/**
 * If loose text is prompt-sized garbage, require a shorter role=assistant extract or refuse to return
 * (prevents agent-loop feedback that doubles prompt size every turn).
 */
async function resolveAssistantReplyForReturn(session, looseText, submittedPromptLen, netCapture = null) {
  const loose = (looseText || "").trim();
  if (!domExtractLooksLikeSubmittedPrompt(loose.length, submittedPromptLen)) return loose;
  const strict = (await extractAssistantReplyStrict(session)).trim();
  if (strict.length >= 20 && strict.length < loose.length * 0.88) {
    console.error(
      "[copilot:response] prefer strict assistant over prompt-length loose extract strictLen=",
      strict.length,
      "looseLen=",
      loose.length,
      "submittedPromptLen=",
      submittedPromptLen,
    );
    return strict;
  }
  const heur = (await extractAssistantReplyHeuristic(session)).trim();
  if (heur.length >= 15) {
    if (!domExtractLooksLikeSubmittedPrompt(heur.length, submittedPromptLen)) {
      console.error("[copilot:response] prefer heuristic assistant extract len=", heur.length);
      return heur;
    }
    if (heur.length < submittedPromptLen * 0.38) {
      console.error(
        "[copilot:response] heuristic assistant short vs submitted — accepting len=",
        heur.length,
      );
      return heur;
    }
  }
  if (netCapture) {
    try {
      if (typeof netCapture.pickAssistantFromChathubWs === "function") {
        const chw = netCapture.pickAssistantFromChathubWs().trim();
        if (chw.length >= CHATHUB_ASSISTANT_MIN_CHARS && !networkExtractLooksLikeGarbage(chw)) {
          console.error("[copilot:response] M365 Chathub WebSocket assistant len=", chw.length);
          return chw;
        }
      }
      const shortN = (await netCapture.pickBestShortAssistant(loose.length, submittedPromptLen)).trim();
      if (shortN.length >= 20) {
        console.error("[copilot:response] network short-assistant len=", shortN.length);
        return shortN;
      }
      const nw = (await netCapture.pickBestOver("", submittedPromptLen)).trim();
      if (
        nw.length >= CHATHUB_ASSISTANT_MIN_CHARS &&
        !networkExtractLooksLikeGarbage(nw) &&
        (!domExtractLooksLikeSubmittedPrompt(nw.length, submittedPromptLen) || nw.length < loose.length * 0.88)
      ) {
        console.error("[copilot:response] network pickBestOver(\"\") len=", nw.length);
        return nw;
      }
    } catch (e) {
      console.error("[copilot:response] network extract error:", e?.message || e);
    }
  }
  return null;
}

async function waitForDomResponse(session, netCapture = null, submittedPromptLen = 0) {
  const wire = async (s) =>
    netCapture ? await netCapture.pickBestOver(s, submittedPromptLen) : s;

  await sleep(2e3);
  let baselineLen = (await extractAssistantReplyText(session)).trim().length;
  /** If we captured the user's long prompt as "assistant", minDoneLen becomes unreachable (baseline+2 > len forever). */
  if (baselineLen > 12_000) {
    console.error(
      "[copilot:response] baseline assistant extract is huge (likely user bubble); resetting baseline for completion logic, was",
      baselineLen,
    );
    baselineLen = 0;
  }
  const waitStarted = Date.now();
  const deadline = waitStarted + RESPONSE_TIMEOUT_MS;
  let prev = baselineLen;
  let stable = 0;
  let streamed = false;
  let lastDiag = 0;
  /** Consecutive polls with generating=false; used to finish sooner when the UI is idle but ticks were high. */
  let quietGen = 0;
  /** Phantom “stop generating” in DOM keeps this true forever — ignore after N seconds. */
  let genStreak = 0;
  const minDoneLen = () =>
    Math.max(streamed ? 6 : 22, baselineLen + (streamed ? 2 : 14));

  while (Date.now() < deadline) {
    await sleep(1e3);
    const generatingRaw = await isCopilotGenerating(session);
    const reply = (await extractAssistantReplyText(session)).trim();
    const len = reply.length;

    if (generatingRaw) {
      genStreak++;
    } else {
      genStreak = 0;
    }
    const ignorePhantomStop = genStreak >= 55;
    const generating = generatingRaw && !ignorePhantomStop;
    if (generating) quietGen = 0;
    else quietGen++;
    if (ignorePhantomStop && genStreak === 55) {
      console.error(
        "[copilot:response] stop-button heuristic stuck ~55s; ignoring so completion can be detected",
      );
    }

    if (Date.now() - lastDiag > 12e3) {
      lastDiag = Date.now();
      let bodyLen = 0;
      try {
        const br = await session.evaluate(
          `(() => (document.body && document.body.innerText) ? document.body.innerText.length : 0)()`,
        );
        bodyLen = Number(br.value) || 0;
      } catch {
        /* ignore */
      }
      console.error("[copilot:response] poll", {
        elapsedSec: Math.floor((Date.now() - waitStarted) / 1000),
        timeoutInSec: Math.max(0, Math.floor((deadline - Date.now()) / 1000)),
        len,
        bodyLen,
        generating,
        generatingRaw,
        genStreak,
        streamed,
        stable,
        baselineLen,
      });
    }

    if (prev > 400 && len < prev * 0.15 && len < 800) {
      console.error("[copilot:response] baseline reset (new assistant bubble), prev=", prev, "len=", len);
      baselineLen = len;
      streamed = true;
      stable = 0;
      prev = len;
      continue;
    }

    if (len > baselineLen + 18) streamed = true;

    if (generating) {
      streamed = true;
      stable = 0;
      prev = len;
      continue;
    }

    if (len > prev + 5) {
      stable = 0;
      prev = len;
      continue;
    }

    const grewEnough =
      streamed ||
      len >= baselineLen + 10 ||
      len >= 120 ||
      len >= minDoneLen();
    const settled = Math.abs(len - prev) <= 12;
    let needStableTicks = len > 220 ? 2 : len < 550 ? 4 : 3;
    if (
      !generating &&
      quietGen >= 8 &&
      len >= Math.max(baselineLen + 6, 18) &&
      (streamed || len >= baselineLen + 8)
    ) {
      needStableTicks = Math.min(needStableTicks, 2);
    }
    if (settled && len >= minDoneLen() && grewEnough) {
      stable++;
      if (stable >= needStableTicks) {
        await sleep(2800);
        const replyLate = (await extractAssistantReplyText(session)).trim();
        if (replyLate.length > len + 40) {
          console.error("[copilot:response] post-stable growth, keep waiting", len, "->", replyLate.length);
          stable = 0;
          prev = len;
          continue;
        }
        const candidate = replyLate.length >= len ? replyLate : reply;
        const out = await resolveAssistantReplyForReturn(session, candidate, submittedPromptLen, netCapture);
        if (out == null) {
          console.error(
            "[copilot:response] refuse false done: loose extract matches submitted prompt length but no strict assistant yet (submitted=",
            submittedPromptLen,
            "loose=",
            candidate.length,
            ")",
          );
          stable = 0;
          prev = len;
          continue;
        }
        console.error("[copilot:response] done, len=", out.length, "stable=", stable);
        return await wire(out);
      }
    } else {
      stable = 0;
    }

    /** Generation ended long ago but len stayed at a huge false positive — finish and return best strict assistant extract. */
    if (streamed && !generating && quietGen >= 14 && len > 8_000) {
      const strict = await extractAssistantReplyStrict(session);
      if (
        strict.length >= 12 &&
        strict.length < len * 0.85 &&
        (!domExtractLooksLikeSubmittedPrompt(strict.length, submittedPromptLen) || strict.length < len * 0.25)
      ) {
        console.error(
          "[copilot:response] done (quiet + strict assistant shorter than bogus len)",
          "strictLen=",
          strict.length,
          "domLen=",
          len,
        );
        return await wire(strict);
      }
    }

    /** DOM still looks like prompt echo — retry network/heuristic while Copilot has finished streaming. */
    if (
      netCapture &&
      streamed &&
      !generating &&
      domExtractLooksLikeSubmittedPrompt(len, submittedPromptLen) &&
      quietGen >= 4 &&
      quietGen % 4 === 0
    ) {
      const early = await resolveAssistantReplyForReturn(session, reply, submittedPromptLen, netCapture);
      if (early != null) {
        console.error("[copilot:response] done (resolved during echo wait) len=", early.length);
        return await wire(early);
      }
    }

    prev = len;
  }

  const fbLoose = (await extractAssistantReplyText(session)).trim();
  const fbResolved = await resolveAssistantReplyForReturn(session, fbLoose, submittedPromptLen, netCapture);
  if (fbResolved != null) {
    console.error("[copilot:response] timeout, using resolved assistant len=", fbResolved.length);
    return await wire(fbResolved);
  }
  if (fbLoose.length >= 12 && !domExtractLooksLikeSubmittedPrompt(fbLoose.length, submittedPromptLen)) {
    console.error("[copilot:response] timeout, returning partial len=", fbLoose.length);
    return await wire(fbLoose);
  }
  if (fbLoose.length >= 12) {
    console.error(
      "[copilot:response] timeout, skipping prompt-echo loose extract (len=",
      fbLoose.length,
      ") — trying body/network",
    );
  }
  const bodyFb = await session.evaluate(`(() => {
    const raw = (document.body && document.body.innerText) ? document.body.innerText.trim() : "";
    if (raw.length < 80) return "";
    const nl = String.fromCharCode(10);
    const lines = raw.split(nl).map((l) => l.trim()).filter(Boolean);
    const tail = lines.slice(-40).join(nl);
    return tail.length > 200 ? tail.slice(-12e3) : "";
  })()`).catch(() => ({ value: "" }));
  const bodyStr = typeof bodyFb?.value === "string" ? bodyFb.value : "";
  if (bodyStr.length >= 80) {
    console.error("[copilot:response] timeout body tail fallback len=", bodyStr.length);
    return await wire(bodyStr);
  }
  if (netCapture) {
    const sn = (await netCapture.pickBestShortAssistant(fbLoose.length, submittedPromptLen)).trim();
    if (sn.length >= CHATHUB_ASSISTANT_MIN_CHARS) {
      console.error("[copilot:response] DOM empty; using network short-assistant len=", sn.length);
      return await wire(sn);
    }
    const nw = await netCapture.pickBestOver("", submittedPromptLen);
    const nwTrim = nw.trim();
    if (nwTrim.length >= CHATHUB_ASSISTANT_MIN_CHARS && !networkExtractLooksLikeGarbage(nwTrim)) {
      console.error("[copilot:response] DOM empty; using network-only len=", nwTrim.length);
      return await wire(nwTrim);
    }
  }
  throw new Error("Copilot response not found in DOM");
}

/* ─── Edge management ─── */

function relayEdgeProfileDir() {
  return globalOptions.userDataDir || defaultRelayEdgeProfileDir();
}

function cdpMarkerFile(profileDir) {
  return path.join(profileDir, RELAY_CDP_PORT_MARKER);
}

function readCdpPortMarker(profileDir) {
  try {
    const raw = fs.readFileSync(cdpMarkerFile(profileDir), "utf8").trim();
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 65535) return n;
  } catch { /* ignore */ }
  return null;
}

function writeCdpPortMarker(profileDir, port) {
  try {
    fs.writeFileSync(cdpMarkerFile(profileDir), String(port), "utf8");
  } catch { /* ignore */ }
}

function clearCdpPortMarker(profileDir) {
  try { fs.unlinkSync(cdpMarkerFile(profileDir)); } catch { /* ignore */ }
}

/**
 * Launch msedge with a visible window from Node spawned under Tauri.
 * Raw `spawn(msedge)` can leave the browser off-screen or in the wrong session on Windows.
 */
async function launchEdgeMsedgeWin32(edgePath, argv) {
  const { execFile } = await import("node:child_process");
  const comspec = process.env.ComSpec || "cmd.exe";
  /** `start "" app` — first quoted arg is window title; `""` = empty title (two quote chars). */
  const startArgs = ["/d", "/c", "start", '""', edgePath, ...argv];
  console.error("[copilot:ensureEdge] Win32 cmd /c start… (execFile, 15s timeout)");
  await new Promise((resolve, reject) => {
    execFile(
      comspec,
      startArgs,
      {
        windowsHide: false,
        cwd: path.dirname(edgePath),
        env: process.env,
        timeout: 15_000,
      },
      (err, _stdout, stderr) => {
        if (stderr && String(stderr).trim()) {
          console.error("[copilot:ensureEdge] start stderr:", String(stderr).trim().slice(0, 500));
        }
        if (err) reject(err);
        else resolve();
      },
    );
  });
  console.error("[copilot:ensureEdge] Win32 cmd /c start execFile callback returned");
}

/** Detached msedge — reliable under Tauri; `cmd start` can hang without invoking the execFile callback on some PCs. */
async function spawnEdgeDetached(edgePath, argv, tag = "") {
  const { spawn } = await import("node:child_process");
  const t = tag ? ` (${tag})` : "";
  console.error("[copilot:ensureEdge] spawn msedge" + t + "…");
  const child = spawn(edgePath, argv, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.on("error", (err) => {
    console.error("[copilot:ensureEdge] spawn error" + t + ":", err?.message || err);
  });
  child.unref();
  console.error("[copilot:ensureEdge] spawn issued" + t + " pid=", child.pid ?? "(none)");
  await sleep(400);
}

/** Dedicated profile: do not attach to arbitrary CDP on 9333–9342 (user's manual Edge). */
async function ensureEdgeDedicated(edgePath, profileDir, cdpPort) {
  if (process.env.RELAY_COPILOT_ALWAYS_LAUNCH_EDGE === "1") {
    clearCdpPortMarker(profileDir);
    console.error(
      "[copilot:ensureEdge] RELAY_COPILOT_ALWAYS_LAUNCH_EDGE=1 — CDP marker cleared (always spawn Edge)",
    );
  }
  const marked = readCdpPortMarker(profileDir);
  if (marked != null && (await probeCdpVersion(marked)) && (await cdpPortIsMicrosoftEdge(marked))) {
    globalOptions.cdpPort = marked;
    console.error("[copilot:ensureEdge] reusing Relay Edge (marker) on port", marked);
    if (
      process.platform === "win32" &&
      process.env.RELAY_COPILOT_NUDGE_EDGE !== "0"
    ) {
      /** No trailing URL — passing COPILOT_URL here opened a duplicate Copilot tab on every reuse. */
      const nudgeArgs = [
        `--remote-debugging-port=${marked}`,
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        "--disable-restore-session-state",
        "--disable-features=EdgeEnclave,VbsEnclave,RendererCodeIntegrity",
        `--user-data-dir=${profileDir}`,
      ];
      try {
        await withTimeout(launchEdgeMsedgeWin32(edgePath, nudgeArgs), 12e3, "nudge cmd start");
        console.error("[copilot:ensureEdge] Win32: nudge start dispatched (foreground existing Edge)");
      } catch (e) {
        console.error("[copilot:ensureEdge] nudge cmd start skipped/failed (continuing with CDP reuse):", e?.message || e);
        try {
          await spawnEdgeDetached(edgePath, nudgeArgs, "nudge-spawn");
        } catch (e2) {
          console.error("[copilot:ensureEdge] nudge spawn failed:", e2?.message || e2);
        }
      }
    }
    return;
  }
  if (marked != null && (await probeCdpVersion(marked)) && !(await cdpPortIsMicrosoftEdge(marked))) {
    console.error(
      "[copilot:ensureEdge] marker port",
      marked,
      "has CDP but is not Microsoft Edge — clearing marker and launching Edge",
    );
  }
  if (marked != null) clearCdpPortMarker(profileDir);

  const preExisting = new Set();
  for (let port = cdpPort; port < cdpPort + CDP_PORT_SCAN_RANGE; port++) {
    if (await probeCdpVersion(port)) preExisting.add(port);
  }

  let actualPort = cdpPort;
  for (let port = cdpPort; port < cdpPort + CDP_PORT_SCAN_RANGE; port++) {
    if (!preExisting.has(port)) {
      actualPort = port;
      break;
    }
    if (port === cdpPort + CDP_PORT_SCAN_RANGE - 1) {
      throw new Error(
        `CDPポート ${cdpPort}〜${port} はすべて使用中です。手動デバッグの Edge を閉じるか、別のポート範囲を空けてください。`
      );
    }
  }
  if (actualPort !== cdpPort) {
    console.error(`[copilot:ensureEdge] port ${cdpPort} has foreign CDP; launching Relay Edge on ${actualPort}`);
  }

  globalOptions.cdpPort = actualPort;
  console.error("[copilot:ensureEdge] launching Relay Edge (isolated profile) on port", actualPort);
  /** Open Copilot immediately so the window is not stuck on NTP/home; describeImpl still normalizes URL. */
  const args = [
    `--remote-debugging-port=${actualPort}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--disable-restore-session-state",
    "--disable-features=EdgeEnclave,VbsEnclave,RendererCodeIntegrity",
    `--user-data-dir=${profileDir}`,
    COPILOT_URL,
  ];
  console.error("[copilot:ensureEdge] starting Edge process…");
  if (process.platform === "win32") {
    const useCmdStart = process.env.RELAY_COPILOT_WIN32_CMD_START === "1";
    if (useCmdStart) {
      console.error("[copilot:ensureEdge] RELAY_COPILOT_WIN32_CMD_START=1 — trying cmd /c start (12s cap)…");
      try {
        await withTimeout(launchEdgeMsedgeWin32(edgePath, args), 12e3, "dedicated cmd start");
        console.error("[copilot:ensureEdge] Win32 cmd start returned OK");
      } catch (e) {
        console.error("[copilot:ensureEdge] cmd start failed or timed out:", e?.message || e);
        await spawnEdgeDetached(edgePath, args, "after-cmd-timeout");
      }
    } else {
      console.error(
        "[copilot:ensureEdge] default: spawn() (set RELAY_COPILOT_WIN32_CMD_START=1 to use cmd start first)",
      );
      await spawnEdgeDetached(edgePath, args, "dedicated-primary");
    }
  } else {
    await spawnEdgeDetached(edgePath, args, "non-win32");
  }

  const dl = Date.now() + EDGE_LAUNCH_TIMEOUT_MS;
  const edgeWaitStarted = Date.now();
  let loggedMismatch = false;
  let lastProgressLog = Date.now() - 4e3;
  console.error("[copilot:ensureEdge] polling for CDP /json/version on port", actualPort, "…");
  while (Date.now() < dl) {
    if (Date.now() - lastProgressLog >= 2e3) {
      console.error(
        "[copilot:ensureEdge] waiting for Edge CDP on port",
        actualPort,
        "…",
        Math.ceil((dl - Date.now()) / 1000),
        "s left (started",
        Math.round((Date.now() - edgeWaitStarted) / 1000),
        "s ago)",
      );
      lastProgressLog = Date.now();
    }
    const info = await probeCdpVersion(actualPort);
    if (info && cdpVersionLooksLikeEdge(info)) {
      globalOptions.cdpPort = actualPort;
      writeCdpPortMarker(profileDir, actualPort);
      console.error(
        "[copilot:ensureEdge] CDP ready on port",
        actualPort,
        "after ~",
        Math.round((Date.now() - edgeWaitStarted) / 1000),
        "s",
      );
      return;
    }
    if (info && !loggedMismatch && Date.now() > dl - 12e3) {
      loggedMismatch = true;
      console.error(
        "[copilot:ensureEdge] port",
        actualPort,
        "responds but not classified as Edge yet:",
        JSON.stringify({ Browser: info.Browser, UserAgent: info["User-Agent"] }).slice(0, 400),
      );
    }
    await sleep(EDGE_LAUNCH_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Edgeのデバッグ接続が開始できません (port ${actualPort})。msedge の起動ブロック、プロファイルロック、または企業ポリシーを確認してください。`,
  );
}

/** No dedicated profile: keep legacy attach-to-any-CDP-in-range behavior. */
async function ensureEdgeLegacyAttach(edgePath, cdpPort) {
  console.error("[copilot:ensureEdge] probing CDP port", cdpPort);
  const existing = await probeCdpVersion(cdpPort);
  if (existing) {
    globalOptions.cdpPort = cdpPort;
    console.error("[copilot:ensureEdge] already connected via CDP port", cdpPort);
    return;
  }
  for (let port = cdpPort; port < cdpPort + CDP_PORT_SCAN_RANGE; port++) {
    const probe = await probeCdpVersion(port);
    if (probe) {
      globalOptions.cdpPort = port;
      console.error("[copilot:ensureEdge] found existing Edge on port", port);
      return;
    }
  }

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
  const args = [
    `--remote-debugging-port=${actualPort}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--disable-restore-session-state",
    "--disable-features=EdgeEnclave,VbsEnclave,RendererCodeIntegrity",
    COPILOT_URL,
  ];
  if (process.platform === "win32") {
    const useCmdStart = process.env.RELAY_COPILOT_WIN32_CMD_START === "1";
    if (useCmdStart) {
      try {
        await withTimeout(launchEdgeMsedgeWin32(edgePath, args), 12e3, "legacy cmd start");
      } catch (e) {
        console.error("[copilot:ensureEdge] legacy cmd start failed:", e?.message || e);
        await spawnEdgeDetached(edgePath, args, "legacy-after-cmd");
      }
    } else {
      await spawnEdgeDetached(edgePath, args, "legacy-primary");
    }
  } else {
    await spawnEdgeDetached(edgePath, args, "legacy-non-win32");
  }

  const dl = Date.now() + EDGE_LAUNCH_TIMEOUT_MS;
  const legacyWaitStarted = Date.now();
  let lastLegacyLog = Date.now() - 4e3;
  while (Date.now() < dl) {
    if (Date.now() - lastLegacyLog >= 2e3) {
      console.error(
        "[copilot:ensureEdge] legacy: waiting for CDP on port",
        actualPort,
        "…",
        Math.ceil((dl - Date.now()) / 1000),
        "s left",
      );
      lastLegacyLog = Date.now();
    }
    if ((await probeCdpVersion(actualPort)) && (await cdpPortIsMicrosoftEdge(actualPort))) {
      console.error(
        "[copilot:ensureEdge] CDP ready on port",
        actualPort,
        "after ~",
        Math.round((Date.now() - legacyWaitStarted) / 1000),
        "s",
      );
      return;
    }
    await sleep(EDGE_LAUNCH_POLL_INTERVAL_MS);
  }
  throw new Error("Edgeのデバッグ接続が開始できません");
}

async function ensureEdgeConnected(cdpPort) {
  const edgePath = findEdgePath();
  if (!edgePath) throw new Error("Microsoft Edgeが見つかりません。Edgeをインストールしてください。");

  const profileDir = relayEdgeProfileDir();
  if (profileDir) {
    try { fs.mkdirSync(profileDir, { recursive: true }); } catch { /* ignore */ }
    await ensureEdgeDedicated(edgePath, profileDir, cdpPort);
    return;
  }

  await ensureEdgeLegacyAttach(edgePath, cdpPort);
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

/**
 * Edge often puts `Chrome/…` in `Browser` and `Edg/…` only in `User-Agent` — must merge both.
 */
function cdpVersionLooksLikeEdge(info) {
  if (!info) return false;
  const b = `${info.Browser || ""} ${info["User-Agent"] || ""}`.toLowerCase();
  if (b.includes("edg")) return true;
  if (b.includes("microsoft edge")) return true;
  if (b.includes("google chrome")) return false;
  if (b.includes("chrome/") && !b.includes("edg")) return false;
  return true;
}

async function cdpPortIsMicrosoftEdge(port) {
  const info = await probeCdpVersion(port);
  return cdpVersionLooksLikeEdge(info);
}

function defaultRelayEdgeProfileDir() {
  if (process.platform !== "win32") return null;
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return null;
  return path.join(home, "RelayAgentEdgeProfile");
}

function findEdgePath() {
  if (process.platform !== "win32") return null;
  const local = process.env.LOCALAPPDATA;
  const candidates = [];
  if (local) candidates.push(`${local}\\Microsoft\\Edge\\Application\\msedge.exe`);
  for (const root of [process.env["PROGRAMFILES(X86)"], process.env.PROGRAMFILES].filter(Boolean)) {
    candidates.push(`${root}\\Microsoft\\Edge\\Application\\msedge.exe`);
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/* ─── HTTP server ─── */

function createServer(session) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        const body = { status: "ok" };
        if (globalOptions.bootToken) body.bootToken = globalOptions.bootToken;
        return writeJson(res, 200, body);
      }
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && reqUrl.pathname === "/status") {
        const status = await session.inspectStatus();
        return writeJson(res, 200, status);
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const payload = await readJsonBody(req);
        const prompt = parseOpenAiRequest(payload);
        console.error(
          "[copilot:http] POST /v1/chat/completions user_chars=",
          (prompt.userPrompt || "").length,
          "system_chars=",
          (prompt.systemPrompt || "").length,
        );
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
  let port = DEFAULT_PORT, cdpPort = DEFAULT_CDP_PORT, userDataDir = null, bootToken = null, help = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") { help = true; continue; }
    if (argv[i] === "--port") { port = Number(argv[++i]); continue; }
    if (argv[i] === "--cdp-port") { cdpPort = Number(argv[++i]); continue; }
    if (argv[i] === "--user-data-dir") { userDataDir = argv[++i] ?? null; continue; }
    if (argv[i] === "--boot-token") { bootToken = argv[++i] ?? null; continue; }
  }
  return { port, cdpPort, userDataDir, bootToken, help };
}

var globalOptions = parseArgs(process.argv.slice(2));
if (!globalOptions.userDataDir && process.platform === "win32") {
  const d = defaultRelayEdgeProfileDir();
  if (d) globalOptions.userDataDir = d;
}

async function main() {
  if (globalOptions.help) {
    console.error("Usage: node copilot_server.js [--port 18080] [--cdp-port 9333] [--user-data-dir <path>] [--boot-token <uuid>]");
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
