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
var INPUT_SELECTOR = '#m365-chat-editor-target-element, [data-lexical-editor="true"]';
var COMPOSER_WAIT_MS = 25e3;
var NEW_CHAT_BUTTON_SELECTOR = '[data-testid="newChatButton"]';
/** Any visible “stop generating” control (M365 UI varies by locale/build). */
var STREAMING_STOP_SELECTORS = [
  ".fai-SendButton__stopBackground",
  'button[aria-label*="生成を停止"]',
  'button[aria-label*="Stop generating"]',
  'button[aria-label*="Stop response"]',
  'button[data-testid="stopGeneratingButton"]'
];
var SEND_BUTTON_ANY_SELECTOR = '.fai-SendButton, button[aria-label*="Send"], button[aria-label*="\u9001\u4FE1"], button[aria-label="Reply"], button[data-testid="sendButton"]';
var ASSISTANT_REPLY_DOM_SELECTORS = [
  '[data-testid="markdown-reply"]',
  'div[data-message-type="Chat"]',
  'article[data-message-author-role="assistant"]',
  '[data-message-author-role="assistant"]',
  '[role="article"]',
  ".markdown-body"
];
var RESPONSE_URL_PATTERN = /substrate\.office\.com|copilot\.microsoft\.com|m365\.cloud\.microsoft|api\.bing\.microsoft\.com/i;
var RESPONSE_TIMEOUT_MS = 12e4;
var CDP_PROBE_TIMEOUT_MS = 2e3;
var CDP_COMMAND_TIMEOUT_MS = 5e3;
/** Runtime.evaluate can run long synchronous DOM work; default CDP timeout was killing large execCommand pastes. */
var CDP_RUNTIME_EVALUATE_TIMEOUT_MS = 90e3;
var EDGE_LAUNCH_TIMEOUT_MS = 45e3;
var EDGE_LAUNCH_POLL_INTERVAL_MS = 500;
var CDP_PORT_SCAN_RANGE = 20;
/** Written under the dedicated Edge profile dir so we reconnect to Relay's instance, not a manually debugged personal Edge on 9333. */
var RELAY_CDP_PORT_MARKER = ".relay-agent-cdp-port";

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
        await sleep(3500);
      }

      console.error("[copilot:describe] starting new chat...");
      await pageSession.click(NEW_CHAT_BUTTON_SELECTOR).catch(() => {});
      await sleep(1500);

      console.error("[copilot:describe] pasting prompt...");
      const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
      await pastePromptRaw(pageSession, fullPrompt);

      console.error("[copilot:describe] submitting prompt...");
      return await submitPromptRaw(pageSession, fullPrompt.length);
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

/**
 * Lexical often nests the real editor: outer #m365-chat-editor-target-element vs inner [contenteditable="true"].
 * CDP Input.insertText targets the focused node; focusing only the outer shell can paste "nowhere".
 */
async function focusComposer(session) {
  const r = await session.evaluate(`(() => {
    function visible(el) {
      return el && el.offsetParent !== null;
    }
    const roots = [
      document.querySelector('#m365-chat-editor-target-element'),
      document.querySelector('[data-lexical-editor="true"]')
    ].filter(Boolean);
    for (const root of roots) {
      if (!visible(root)) continue;
      const inner = root.querySelector('[contenteditable="true"]');
      const el = visible(inner) ? inner : root;
      try {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (_) {}
      el.click();
      el.focus();
      return true;
    }
    const fallbacks = [
      'div[role="textbox"][contenteditable="true"]',
      'div[role="textbox"]',
      '[contenteditable="true"]'
    ];
    for (const sel of fallbacks) {
      const el = document.querySelector(sel);
      if (visible(el)) {
        try {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
        } catch (_) {}
        el.click();
        el.focus();
        return true;
      }
    }
    return false;
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
    function lenOf(el) {
      if (!el) return 0;
      const raw = el.innerText || el.textContent || '';
      const t = raw.replace(new RegExp(String.fromCharCode(0x200b), 'g'), '');
      return t.trim().length;
    }
    const root = document.querySelector('#m365-chat-editor-target-element')
      ?? document.querySelector('[data-lexical-editor="true"]');
    if (root && root.offsetParent !== null) {
      const inner = root.querySelector('[contenteditable="true"]');
      const n = lenOf(inner && inner.offsetParent !== null ? inner : root);
      if (n > 0) return n;
    }
    const fb = document.querySelector('div[role="textbox"]');
    return lenOf(fb);
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
  if (fullLen > 4000 && visibleLen >= 720) {
    return true;
  }
  const target = Math.min(900, Math.max(140, Math.floor(fullLen * 0.035)));
  return visibleLen >= target;
}

/**
 * Lexical often ingests full payloads correctly from a single synthetic paste (one transaction).
 * Chunked CDP insertText / per-chunk execCommand+focus can leave only the last fragment visible.
 */
async function pasteViaSyntheticClipboard(session, text) {
  const maxPerPaste = 12e3;
  const parts = chunkByCodePoints(text, maxPerPaste);
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const r = await session.evaluate(`
      ((payload, isFirstPart) => {
        const root = document.querySelector('#m365-chat-editor-target-element')
          ?? document.querySelector('[data-lexical-editor="true"]');
        const inner = root?.querySelector('[contenteditable="true"]');
        const el = (inner && inner.offsetParent !== null ? inner : null)
          ?? root
          ?? document.querySelector('div[role="textbox"]');
        if (!el) return false;
        if (isFirstPart) {
          el.focus();
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (_) {}
        }
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', payload);
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
 */
async function insertTextViaCdp(session, text) {
  const chunks = chunkByCodePoints(text, 160);
  for (let i = 0; i < chunks.length; i++) {
    await session.send("Input.insertText", { text: chunks[i] });
    await sleep(chunks.length > 40 ? 35 : 28);
  }
}

/** Fallback: beforeinput + input with InputEvent (some React versions listen for this). Batched so one evaluate does not freeze the page. */
async function insertTextViaInputEvents(session, text) {
  const cap = 4e3;
  const txt = text.length > cap ? text.slice(0, cap) : text;
  if (txt.length < text.length) {
    console.error("[copilot:paste] InputEvent fallback truncated to", cap, "chars");
  }
  const batchSize = 48;
  const batches = chunkByCodePoints(txt, batchSize);
  for (const batch of batches) {
    await session.evaluate(`
      ((payload) => {
        const root = document.querySelector('#m365-chat-editor-target-element')
          ?? document.querySelector('[data-lexical-editor="true"]');
        const inner = root?.querySelector('[contenteditable="true"]');
        const el = (inner && inner.offsetParent !== null ? inner : null)
          ?? root
          ?? document.querySelector('div[role="textbox"]');
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
        const root = document.querySelector('#m365-chat-editor-target-element')
          ?? document.querySelector('[data-lexical-editor="true"]');
        const inner = root?.querySelector('[contenteditable="true"]');
        const el = (inner && inner.offsetParent !== null ? inner : null)
          ?? root
          ?? document.querySelector('div[role="textbox"]');
        if (!el) return false;
        if (isFirst) {
          el.focus();
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (_) {}
        }
        try {
          return document.execCommand('insertText', false, payload);
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
  await cdpInputEnable(session);
  await waitForComposer(session);
  await sleep(400);

  const preClearLen = await getComposerTextLength(session);
  if (preClearLen > 0) {
    await clearComposerViaKeyboard(session);
    await sleep(120);
  }
  await focusComposer(session);
  await sleep(120);

  console.error("[copilot:paste] trying synthetic Clipboard paste first…");
  let pasted = false;
  try {
    pasted = await pasteViaSyntheticClipboard(session, text);
  } catch (e) {
    console.error("[copilot:paste] synthetic paste failed:", e?.message || e);
  }
  await sleep(pasted ? 500 : 0);
  let len = await getComposerTextLength(session);

  let errInsert = null;
  const needMin = pasteNeedMinChars(text.length);
  if (!pasteLooksComplete(len, text.length)) {
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
  } else {
    console.error("[copilot:paste] synthetic paste looks complete, visible len:", len);
  }

  await sleep(200);
  len = await getComposerTextLength(session);

  if (len < needMin && text.length >= 20) {
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

  if (len < needMin && text.length >= 20) {
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

  if (len < needMin && text.length >= 20) {
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
    throw new Error(
      `Prompt did not reach Copilot composer (visible length ${len}, expected ~${text.length}).${hint}`
    );
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

async function trySubmitViaEnter(session) {
  await cdpInputEnable(session);
  await focusComposer(session);
  await sleep(100);
  for (const phase of ["keyDown", "keyUp"]) {
    await session.send("Input.dispatchKeyEvent", {
      type: phase,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
  }
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

async function submitPromptRaw(session, expectedPromptLen) {
  const minComposer = minComposerThresholdForSubmit(expectedPromptLen);

  // Until composer shows our text, Send often stays disabled
  const composeDeadline = Date.now() + 15e3;
  while (Date.now() < composeDeadline) {
    const n = await getComposerTextLength(session);
    if (n >= minComposer || expectedPromptLen < 20) break;
    await sleep(200);
  }

  const lenBefore = await getComposerTextLength(session);

  // Wait for send button to become visible and enabled
  const deadline = Date.now() + 45e3;
  let stableSince = 0;
  let sendClicked = false;
  while (Date.now() < deadline) {
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

  // Wait for response
  return await waitForDomResponse(session);
}

async function isCopilotGenerating(session) {
  const r = await session.evaluate(`(() => {
    const sels = ${JSON.stringify(STREAMING_STOP_SELECTORS)};
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        if (el && el.offsetParent !== null) return true;
      }
    }
    return false;
  })()`).catch(() => ({ value: false }));
  return r?.value === true;
}

/** Longest visible assistant-shaped block (aligns with cdp_copilot wait_for_response heuristics). */
async function extractAssistantReplyText(session) {
  const r = await session.evaluate(`(() => {
    const selectors = ${JSON.stringify(ASSISTANT_REPLY_DOM_SELECTORS)};
    let best = "";
    for (const s of selectors) {
      for (const el of document.querySelectorAll(s)) {
        if (!el || el.offsetParent === null) continue;
        const t = (el.innerText || "").trim();
        if (t.length > best.length) best = t;
      }
    }
    return best;
  })()`).catch(() => ({ value: "" }));
  return typeof r?.value === "string" ? r.value : "";
}

async function waitForDomResponse(session) {
  await sleep(2e3);
  const startLen = (await extractAssistantReplyText(session)).trim().length;
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let prev = (await extractAssistantReplyText(session)).trim().length;
  let stable = 0;
  let streamed = false;
  const minDoneLen = () => Math.max(30, startLen + 15);

  while (Date.now() < deadline) {
    await sleep(1e3);
    const generating = await isCopilotGenerating(session);
    const reply = (await extractAssistantReplyText(session)).trim();
    const len = reply.length;

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

    const grewEnough = streamed || len >= startLen + 12 || len >= 200;
    if (Math.abs(len - prev) <= 2 && len >= minDoneLen() && grewEnough) {
      stable++;
      if (stable >= 2) return reply;
    } else {
      stable = 0;
    }
    prev = len;
  }

  const fb = (await extractAssistantReplyText(session)).trim();
  if (fb) return fb;
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

/** Dedicated profile: do not attach to arbitrary CDP on 9333–9342 (user's manual Edge). */
async function ensureEdgeDedicated(edgePath, profileDir, cdpPort) {
  const marked = readCdpPortMarker(profileDir);
  if (marked != null && await probeCdpVersion(marked)) {
    globalOptions.cdpPort = marked;
    console.error("[copilot:ensureEdge] reusing Relay Edge (marker) on port", marked);
    return;
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
  const { spawn } = await import("node:child_process");
  const args = [
    `--remote-debugging-port=${actualPort}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--disable-restore-session-state",
    "--disable-features=EdgeEnclave,VbsEnclave,RendererCodeIntegrity",
    "--disable-gpu",
    "--disable-gpu-compositing",
    `--user-data-dir=${profileDir}`,
    COPILOT_URL
  ];
  const child = spawn(edgePath, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();

  const dl = Date.now() + EDGE_LAUNCH_TIMEOUT_MS;
  while (Date.now() < dl) {
    for (let port = cdpPort; port < cdpPort + CDP_PORT_SCAN_RANGE; port++) {
      if (!(await probeCdpVersion(port))) continue;
      // Prefer our launch port, or any CDP that was not already up before we spawned (avoids latching onto personal Edge on 9333).
      if (port === actualPort || !preExisting.has(port)) {
        globalOptions.cdpPort = port;
        writeCdpPortMarker(profileDir, port);
        console.error("[copilot:ensureEdge] CDP ready on port", port);
        return;
      }
    }
    await sleep(EDGE_LAUNCH_POLL_INTERVAL_MS);
  }
  throw new Error("Edgeのデバッグ接続が開始できません");
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
  const { spawn } = await import("node:child_process");
  const args = [
    `--remote-debugging-port=${actualPort}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--disable-restore-session-state",
    "--disable-features=EdgeEnclave,VbsEnclave,RendererCodeIntegrity",
    "--disable-gpu",
    "--disable-gpu-compositing",
    COPILOT_URL
  ];
  const child = spawn(edgePath, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();

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
if (!globalOptions.userDataDir && process.platform === "win32") {
  const d = defaultRelayEdgeProfileDir();
  if (d) globalOptions.userDataDir = d;
}

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
