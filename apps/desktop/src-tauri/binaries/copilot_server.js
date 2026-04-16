// copilot_server.js — pure CDP (HTTP + WebSocket), no Playwright
// Works in VBS-restricted corporate environments where Playwright connectOverCDP hangs.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import {
  COMPOSER_ANCESTOR_CLOSEST,
  RESPONSE_TIMEOUT_MS,
  CHATHUB_ASSISTANT_MIN_CHARS,
  copilotDomGeneratingIifeExpression,
} from "./copilot_dom_poll.mjs";
import { domExtractLooksLikeSubmittedPrompt, waitForDomResponse } from "./copilot_wait_dom_response.mjs";

async function isCopilotGenerating(session) {
  const r = await session.evaluate(copilotDomGeneratingIifeExpression()).catch(() => ({ value: false }));
  return r?.value === true;
}

// Use Node 22+ built-in WebSocket. If unavailable, fall back to bare-net via http upgrade.
const WS = globalThis.WebSocket ?? globalThis.ws;
if (!WS) throw new Error("WebSocket is not available. Use Node.js 22+ or install the 'ws' package.");

var DEFAULT_PORT = 18080;
var DEFAULT_CDP_PORT = 9360;
var COPILOT_URL = "https://m365.cloud.microsoft/chat/";

/**
 * When RELAY_COPILOT_NO_WINDOW_FOCUS=1, skip CDP Target.activateTarget / Page.bringToFront
 * so Edge does not steal OS focus. In-page focus()/click() for Lexical is unchanged.
 */
function copilotWindowFocusAllowed() {
  return process.env.RELAY_COPILOT_NO_WINDOW_FOCUS !== "1";
}

/**
 * Composer boundary for focus/paste and for excluding transcript nodes (inComposer).
 * Aligns with agent-browser accessibility snapshot on M365 Copilot (ja): textbox
 * "Copilot にメッセージを送信する" (e.g. ref e110); EN uses "Send a message…" on role=textbox.
 */
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
var SEND_BUTTON_ANY_SELECTOR = '.fai-SendButton, button[aria-label*="Send"], button[aria-label*="\u9001\u4FE1"], button[aria-label="Reply"], button[data-testid="sendButton"]';
/** Kiroku / M365: reveal upload UI before file input appears. */
var PLUS_BUTTON_SELECTORS = [
  '[data-testid="PlusMenuButton"]',
  'button[aria-label*="Add"]',
  'button[aria-label*="Upload"]',
  'button[aria-label*="添付"]',
  'button[aria-label*="アップロード"]',
];
var FILE_INPUT_SELECTORS = [
  '[data-testid="uploadFileDialogInput"]',
  'input[type="file"][accept*="image"]',
  'input[type="file"]',
];
var ATTACHMENT_READY_SELECTORS = [
  '[data-testid*="attachment"]',
  '[data-testid*="upload"]',
  '[data-testid*="image"]',
  '[aria-label*="Remove attachment"]',
  '[aria-label*="添付を削除"]',
];
var ATTACHMENT_PENDING_SELECTORS = [
  '[role="progressbar"]',
  '[aria-busy="true"]',
  '[data-testid*="progress"]',
  '[data-testid*="loading"]',
];
var SEND_BUTTON_STABLE_MS_DEFAULT = 500;
var SEND_BUTTON_STABLE_MS_AFTER_ATTACH = 750;
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
/** Override with RELAY_CDP_PROBE_TIMEOUT_MS (500–120000). Win32 default is higher for slow CDP bind. */
var CDP_PROBE_TIMEOUT_MS = (() => {
  const raw = process.env.RELAY_CDP_PROBE_TIMEOUT_MS;
  if (raw) {
    const n = Number.parseInt(String(raw).trim(), 10);
    if (Number.isFinite(n) && n >= 500 && n <= 120_000) return n;
  }
  return process.platform === "win32" ? 8e3 : 2e3;
})();
var CDP_COMMAND_TIMEOUT_MS = 5e3;
/** Runtime.evaluate can run long synchronous DOM work; default CDP timeout was killing large execCommand pastes. */
var CDP_RUNTIME_EVALUATE_TIMEOUT_MS = 90e3;
var EDGE_LAUNCH_TIMEOUT_MS = 45e3;
var EDGE_LAUNCH_POLL_INTERVAL_MS = 500;
var CDP_PORT_SCAN_RANGE = 20;
var LONG_CONTINUATION_RETRY_CHARS = 32_000;
/** Written under the dedicated Edge profile dir so we reconnect to Relay's instance, not an arbitrary manual CDP port. */
var RELAY_CDP_PORT_MARKER = ".relay-agent-cdp-port";
/**
 * Chathub / author=bot strings only (JS String.length). "こんにちは" = 5; "Hi" = 2.
 * Emoji can add UTF-16 units. HTTP JSON scanning keeps a higher minimum separately.
 */

var CopilotLoginRequiredError = class extends Error {};

/* ─── Raw CDP session ─── */

class CdpSession {
  #ws;
  #id = 0;
  #pending = new Map();
  #listeners = new Map();
  #terminalError = null;

  constructor(wsUrl) {
    this.#ws = new WS(wsUrl);
    this.#ws.onmessage = (e) => this._handle(typeof e.data === "string" ? e.data : String(e.data));
    this.#ws.onerror = (e) => {
      const message = e?.error?.message || e?.message || "CDP WebSocket error";
      this._failPending(new Error(message));
    };
    this.#ws.onclose = (e) => {
      const suffix = e?.code ? ` (code ${e.code})` : "";
      this._failPending(new Error(`CDP WebSocket closed${suffix}`));
    };
  }

  get ready() {
    return new Promise((resolve, reject) => {
      if (this.#ws.readyState === WS.OPEN) return resolve();
      const t = setTimeout(() => reject(new Error("CDP WebSocket timeout")), 10e3);
      this.#ws.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
      this.#ws.addEventListener("error", (e) => { clearTimeout(t); reject(e.error ?? e); }, { once: true });
    });
  }

  close() {
    this._failPending(new Error("CDP WebSocket closed by caller"));
    this.#ws.close();
  }

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(fn);
  }
  off(event, fn) { this.#listeners.get(event)?.delete(fn); }

  send(method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (this.#terminalError) {
        reject(this.#terminalError);
        return;
      }
      if (this.#ws.readyState !== WS.OPEN) {
        reject(new Error(`CDP WebSocket is not open (state=${this.#ws.readyState})`));
        return;
      }
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

  _failPending(error) {
    if (this.#terminalError) return;
    this.#terminalError = error instanceof Error ? error : new Error(String(error));
    for (const [id, pending] of this.#pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(this.#terminalError);
      this.#pending.delete(id);
    }
  }

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

/** When truthy, every /v1/chat/completions runs clickNewChatDeep before paste (legacy; default off). */
function envNewChatEachTurn() {
  const v = process.env.RELAY_COPILOT_NEW_CHAT_EACH_TURN;
  if (!v) return false;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/* ─── Copilot session ─── */

class CopilotSession {
  cdpSession = null;
  cdpPort = null;
  /** Serialize /v1/chat/completions — overlapping POSTs (e.g. Rust retry while Copilot still runs) must wait, not 500 "busy". */
  _describeChain = Promise.resolve();
  relaySessions = new Map();
  inflightRequests = new Map();
  completedRequests = new Map();
  repairStageStats = new Map();
  lastBridgeFailure = null;

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

  _getRelaySessionState(relaySessionId) {
    let state = this.relaySessions.get(relaySessionId);
    if (!state) {
      state = { relaySessionId, cdpTargetId: null, initialized: false, probeMode: false };
      this.relaySessions.set(relaySessionId, state);
    }
    return state;
  }

  _newProgressSnapshot(relaySessionId, relayRequestId) {
    return {
      relaySessionId,
      relayRequestId,
      visibleText: "",
      done: false,
      phase: "queued",
      updatedAt: Date.now(),
    };
  }

  _updateRequestProgress(requestState, patch = {}) {
    const current = requestState.progressSnapshot || this._newProgressSnapshot(
      requestState.relaySessionId,
      requestState.relayRequestId,
    );
    const next = {
      ...current,
      ...patch,
      updatedAt: Number.isFinite(patch.updatedAt) ? patch.updatedAt : Date.now(),
    };
    requestState.progressSnapshot = next;
    return next;
  }

  getRequestProgress(relaySessionId, relayRequestId) {
    const completed = this.completedRequests.get(relayRequestId);
    if (completed && completed.relaySessionId === relaySessionId) {
      return completed.progressSnapshot || null;
    }
    const inflight = this.inflightRequests.get(relayRequestId);
    if (inflight && inflight.relaySessionId === relaySessionId) {
      return inflight.requestState.progressSnapshot || null;
    }
    return null;
  }

  _claimedTargetIds(exceptRelaySessionId = null) {
    const claimed = new Set();
    for (const [relaySessionId, state] of this.relaySessions.entries()) {
      if (relaySessionId === exceptRelaySessionId) continue;
      if (state?.cdpTargetId) claimed.add(state.cdpTargetId);
    }
    return claimed;
  }

  _pruneCompletedRequests() {
    while (this.completedRequests.size > 128) {
      const firstKey = this.completedRequests.keys().next().value;
      if (firstKey == null) break;
      this.completedRequests.delete(firstKey);
    }
  }

  _recordRepairStageTrace(trace, success) {
    if (!isRepairStageLabel(trace?.stageLabel)) return;
    let entry = this.repairStageStats.get(trace.stageLabel);
    if (!entry) {
      entry = {
        stageLabel: trace.stageLabel,
        attempts: 0,
        successCount: 0,
        newChatReadyCount: 0,
        pasteCount: 0,
        submitCount: 0,
        networkSeedCount: 0,
        domWaitStartedCount: 0,
        domWaitFinishedCount: 0,
        failureCounts: new Map(),
        lastRequestChain: null,
        lastFailureClass: null,
        lastTotalElapsedMs: null,
      };
      this.repairStageStats.set(trace.stageLabel, entry);
    }
    entry.attempts += 1;
    if (success) entry.successCount += 1;
    if (trace.newChatReady) entry.newChatReadyCount += 1;
    if (trace.pasteDone) entry.pasteCount += 1;
    if (trace.submitObserved) entry.submitCount += 1;
    if (trace.networkSeedSeen) entry.networkSeedCount += 1;
    if (trace.domWaitStarted) entry.domWaitStartedCount += 1;
    if (trace.domWaitFinished) entry.domWaitFinishedCount += 1;
    if (!success) {
      const failureClass = trace.failureClass || "__unclassified__";
      entry.failureCounts.set(failureClass, (entry.failureCounts.get(failureClass) || 0) + 1);
      entry.lastFailureClass = failureClass;
    } else {
      entry.lastFailureClass = null;
    }
    entry.lastRequestChain = trace.requestChain || null;
    entry.lastTotalElapsedMs = Number.isFinite(trace.totalElapsedMs) ? trace.totalElapsedMs : null;
  }

  _serializeRepairStageStats() {
    return Array.from(this.repairStageStats.values())
      .sort((a, b) => String(a.stageLabel).localeCompare(String(b.stageLabel)))
      .map((entry) => ({
        stageLabel: entry.stageLabel,
        attempts: entry.attempts,
        successCount: entry.successCount,
        newChatReadyCount: entry.newChatReadyCount,
        pasteCount: entry.pasteCount,
        submitCount: entry.submitCount,
        networkSeedCount: entry.networkSeedCount,
        domWaitStartedCount: entry.domWaitStartedCount,
        domWaitFinishedCount: entry.domWaitFinishedCount,
        failureCounts: Array.from(entry.failureCounts.entries())
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
          .map(([failureClass, count]) => ({ failureClass, count })),
        lastRequestChain: entry.lastRequestChain,
        lastFailureClass: entry.lastFailureClass,
        lastTotalElapsedMs: entry.lastTotalElapsedMs,
      }));
  }

  async _waitForPages() {
    const session = this.cdpSession;
    let pages = await session.listPages();
    const emptyPollDeadline = Date.now() + 3e3;
    while (pages.length === 0 && Date.now() < emptyPollDeadline) {
      await sleep(200);
      pages = await session.listPages();
    }
    return pages;
  }

  _lookupPageByTargetId(pages, targetId) {
    if (!targetId) return null;
    return pages.find((page) => page.targetId === targetId) || null;
  }

  _invalidateRelaySession(relaySession, reason) {
    if (reason) {
      console.error("[copilot] invalidating relay session target:", relaySession.relaySessionId, reason);
    }
    relaySession.cdpTargetId = null;
    relaySession.initialized = false;
  }

  async _closeRelayTargetIfKnown(relaySession, reason) {
    const targetId = relaySession?.cdpTargetId;
    if (!targetId || !this.cdpSession) return false;
    try {
      console.error("[copilot] closing relay session target:", relaySession.relaySessionId, reason || "(no reason)");
      await this.cdpSession.send("Target.closeTarget", { targetId }, 3e3);
      return true;
    } catch (error) {
      console.error("[copilot] Target.closeTarget failed:", error?.message || error);
      return false;
    }
  }

  async findStatusPage() {
    const session = this.cdpSession;
    const pages = await this._waitForPages();
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

    return copilotPage;
  }

  async findOrCreateRelayPage(relaySessionId, relaySession) {
    const session = this.cdpSession;
    const pages = await this._waitForPages();
    const claimedTargets = this._claimedTargetIds(relaySessionId);
    const dedicatedOnly = relaySession?.probeMode === true;

    const existing = this._lookupPageByTargetId(pages, relaySession.cdpTargetId);
    if (relaySession.cdpTargetId && !existing) {
      this._invalidateRelaySession(relaySession, "tracked tab disappeared");
    } else if (existing) {
      return existing;
    }

    if (dedicatedOnly) {
      console.error("[copilot] probe mode: creating dedicated Copilot tab for", relaySessionId);
      const result = await session.send("Target.createTarget", {
        url: COPILOT_URL
      });
      relaySession.cdpTargetId = result.targetId;
      relaySession.initialized = false;
      return { targetId: result.targetId, url: COPILOT_URL };
    }

    const unclaimedCopilot = pages.filter(
      (page) => !claimedTargets.has(page.targetId) && isCopilotUrl(page.url),
    );
    if (unclaimedCopilot.length > 0) {
      const page = unclaimedCopilot[unclaimedCopilot.length - 1];
      relaySession.cdpTargetId = page.targetId;
      return page;
    }

    const unclaimedLogin = pages.filter(
      (page) => !claimedTargets.has(page.targetId) && isLoginUrl(page.url),
    );
    if (unclaimedLogin.length > 0) {
      const page = unclaimedLogin[unclaimedLogin.length - 1];
      relaySession.cdpTargetId = page.targetId;
      return page;
    }

    const unclaimedDisposable = pages.filter(
      (page) => !claimedTargets.has(page.targetId) && isDisposableStartUrl(page.url),
    );
    if (unclaimedDisposable.length > 0) {
      const page = unclaimedDisposable[unclaimedDisposable.length - 1];
      console.error(
        "[copilot] no Copilot URL yet — reusing unclaimed tab for relay session",
        relaySessionId,
        page.url?.slice(0, 120) || "(empty)",
      );
      relaySession.cdpTargetId = page.targetId;
      return page;
    }

    console.error("[copilot] no unclaimed page targets — creating dedicated Copilot tab for", relaySessionId);
    const result = await session.send("Target.createTarget", {
      url: COPILOT_URL
    });
    relaySession.cdpTargetId = result.targetId;
    relaySession.initialized = false;
    return { targetId: result.targetId, url: COPILOT_URL };
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

  async ensureTargetUrl(pageSession, page, targetId, allowLogin, logPrefix) {
    let currentUrl = page.url || "";
    if (!isCopilotUrl(currentUrl) && !(allowLogin && isLoginUrl(currentUrl))) {
      console.error(logPrefix, "navigating to Copilot URL from:", currentUrl?.slice(0, 140) || "(empty)");
      await pageSession.send("Page.navigate", { url: COPILOT_URL });
      try {
        currentUrl = await waitForTargetUrl(
          this.cdpSession,
          targetId,
          (url) => isCopilotUrl(url) || (allowLogin && isLoginUrl(url)),
          45e3,
        );
        console.error(logPrefix, "target URL reached:", currentUrl?.slice(0, 120));
      } catch (e) {
        console.error(logPrefix, "navigate wait failed, retrying once:", e?.message || e);
        await pageSession.send("Page.navigate", { url: COPILOT_URL });
        currentUrl = await waitForTargetUrl(
          this.cdpSession,
          targetId,
          (url) => isCopilotUrl(url) || (allowLogin && isLoginUrl(url)),
          30e3,
        );
        console.error(logPrefix, "target URL after retry:", currentUrl?.slice(0, 120));
      }
      await sleep(700);
    }

    const pages = await this.cdpSession.listPages();
    const refreshed = pages.find((entry) => entry.targetId === targetId);
    const finalUrl = refreshed?.url || currentUrl;
    if (!isCopilotUrl(finalUrl) && !(allowLogin && isLoginUrl(finalUrl))) {
      throw new Error("Copilot tab could not be resolved on the Relay Edge session");
    }
    return { currentUrl: finalUrl, page: refreshed || page };
  }

  async inspectStatus() {
    const pending = this._describeChain.then(() => this.inspectStatusImpl());
    this._describeChain = pending.catch(() => {});
    return pending;
  }

  async inspectStatusImpl() {
    let pageSession = null;
    try {
      await this.connect(globalOptions.cdpPort);
      const page = await this.findStatusPage();
      if (!page) {
        return {
          connected: false,
          loginRequired: false,
          error: "Copilot page not available",
          lastBridgeFailure: this.lastBridgeFailure,
          repairStageStats: this._serializeRepairStageStats(),
        };
      }
      if (copilotWindowFocusAllowed()) {
        await this.cdpSession.send("Target.activateTarget", { targetId: page.targetId }).catch(() => {});
      }
      pageSession = await this.navigateToPage(page);
      await pageSession.send("Page.enable", {}).catch(() => {});
      if (copilotWindowFocusAllowed()) {
        await pageSession.send("Page.bringToFront", {}).catch(() => {});
      }

      const { currentUrl: finalUrl } = await this.ensureTargetUrl(
        pageSession,
        page,
        page.targetId,
        true,
        "[copilot:status]",
      );
      const login = isLoginUrl(finalUrl);
      return {
        connected: !login,
        loginRequired: login,
        url: finalUrl,
        lastBridgeFailure: this.lastBridgeFailure,
        repairStageStats: this._serializeRepairStageStats(),
      };
    } catch (error) {
      return {
        connected: false,
        loginRequired: false,
        error: error instanceof Error ? error.message : String(error),
        lastBridgeFailure: this.lastBridgeFailure,
        repairStageStats: this._serializeRepairStageStats(),
      };
    } finally {
      if (pageSession) pageSession.close();
    }
  }

  async startOrJoinDescribe(params) {
    const relaySessionId = String(params.relaySessionId || "").trim();
    const relayRequestId = String(params.relayRequestId || "").trim();
    if (!relaySessionId) throw new Error("relay_session_id is required");
    if (!relayRequestId) throw new Error("relay_request_id is required");

    const completed = this.completedRequests.get(relayRequestId);
    if (completed) {
      if (completed.relaySessionId !== relaySessionId) {
        return {
          status: 409,
          body: { error: "relay_request_id already belongs to another Relay session" },
        };
      }
      return completed.record;
    }

    const inflight = this.inflightRequests.get(relayRequestId);
    if (inflight) {
      if (inflight.relaySessionId !== relaySessionId) {
        return {
          status: 409,
          body: { error: "relay_request_id already belongs to another Relay session" },
        };
      }
      return await inflight.promise;
    }

    const requestState = {
      relaySessionId,
      relayRequestId,
      aborted: false,
      probeMode: params.relayProbeMode === true,
      progressSnapshot: this._newProgressSnapshot(relaySessionId, relayRequestId),
    };

    const execute = async () => {
      try {
        const description = await this.describeImpl(params, requestState);
        this._updateRequestProgress(requestState, {
          visibleText: String(description || "").trim(),
          done: true,
          phase: "completed",
        });
        return {
          status: 200,
          body: { choices: [{ message: { role: "assistant", content: description } }] },
        };
      } catch (error) {
        this._updateRequestProgress(requestState, {
          done: true,
          phase:
            requestState.aborted || String(error?.message || error).includes("relay_copilot_aborted")
              ? "aborted"
              : "error",
        });
        return responseRecordFromError(error);
      }
    };

    const promise = this._describeChain
      .then(execute)
      .then((record) => {
        this.completedRequests.set(relayRequestId, {
          relaySessionId,
          record,
          progressSnapshot: requestState.progressSnapshot || this._newProgressSnapshot(relaySessionId, relayRequestId),
        });
        this._pruneCompletedRequests();
        this.inflightRequests.delete(relayRequestId);
        return record;
      });
    this._describeChain = promise.catch(() => {});
    this.inflightRequests.set(relayRequestId, {
      relaySessionId,
      requestState,
      promise,
    });

    return await promise;
  }

  abortRequest(relaySessionId, relayRequestId) {
    const inflight = this.inflightRequests.get(relayRequestId);
    if (!inflight || inflight.relaySessionId !== relaySessionId) return false;
    inflight.requestState.aborted = true;
    this._updateRequestProgress(inflight.requestState, { done: true, phase: "aborted" });
    return true;
  }

  async describeImpl(params, requestState) {
    const relaySessionId = requestState.relaySessionId;
    const relaySession = this._getRelaySessionState(relaySessionId);
    relaySession.probeMode = requestState.probeMode === true;
    this._updateRequestProgress(requestState, { phase: "connecting", done: false, visibleText: "" });
    const requestChain = String(params.relayRequestChain || requestState.relayRequestId || "").trim() || requestState.relayRequestId;
    const requestAttempt =
      Number.isFinite(params.relayRequestAttempt) && params.relayRequestAttempt >= 1
        ? params.relayRequestAttempt
        : 1;
    const stageLabel = String(params.relayStageLabel || "original").trim() || "original";
    const repairStage = isRepairStageLabel(stageLabel);
    let recoverableAttempt = 0;
    let repairReplayUsed = false;

    while (true) {
      let pageSession = null;
      let attachmentTempFiles = [];
      const describeStartedAt = Date.now();
      const trace = {
        requestChain,
        stageLabel,
        requestAttempt,
        transportAttempt: recoverableAttempt + 1,
        repairReplayAttempt: repairReplayUsed ? 2 : 1,
        wantNewChat: false,
        newChatReady: false,
        pasteDone: false,
        submitObserved: false,
        networkSeedSeen: false,
        domWaitStarted: false,
        domWaitFinished: false,
        failureClass: null,
        newChatReadyElapsedMs: null,
        pasteElapsedMs: null,
        waitResponseElapsedMs: null,
        totalElapsedMs: null,
      };
      try {
        logDescribeTrace("[copilot:describe] connecting", trace, {
          recoverable_retry: recoverableAttempt > 0,
        });
        this._updateRequestProgress(requestState, { phase: "connecting", done: false });
        await this.connect(globalOptions.cdpPort);
        console.error(
          "[copilot:describe] finding copilot page for relay session",
          relaySessionId,
          "request_chain=",
          requestChain,
          "stage_label=",
          stageLabel,
        );
        const page = await this.findOrCreateRelayPage(relaySessionId, relaySession);
        console.error("[copilot:describe] page:", JSON.stringify(page));

        if (isLoginUrl(page.url)) {
          throw new CopilotLoginRequiredError(
            "Copilot にログインしてください。Edge の画面を確認してください。"
          );
        }

        if (copilotWindowFocusAllowed()) {
          await this.cdpSession.send("Target.activateTarget", { targetId: page.targetId }).catch((e) => {
            console.error("[copilot:describe] Target.activateTarget:", e?.message || e);
          });
        }

        pageSession = await this.navigateToPage(page);
        await pageSession.send("Page.enable", {}).catch(() => {});
        if (copilotWindowFocusAllowed()) {
          await pageSession.send("Page.bringToFront", {}).catch((e) => {
            console.error("[copilot:describe] Page.bringToFront:", e?.message || e);
          });
        }

        const { currentUrl } = await this.ensureTargetUrl(
          pageSession,
          page,
          page.targetId,
          false,
          "[copilot:describe]",
        );
        if (!isCopilotUrl(currentUrl)) {
          this._invalidateRelaySession(relaySession, "target stopped resolving to Copilot");
          throw new Error("Copilot tab could not be resolved for the Relay session");
        }
        await assertCopilotPageResponsive(pageSession, "[copilot:describe]");
        console.error(
          "[copilot:describe] page ready in",
          Date.now() - describeStartedAt,
          "ms for relay session",
          relaySessionId,
        );

        const netCapture = createCopilotNetworkCapture(pageSession);
        await netCapture.enable();

        let hadAttachments = false;
        try {
          const forceRepairNewChat = repairStage && repairReplayUsed;
          const wantNewChat =
            requestState.probeMode ||
            forceRepairNewChat ||
            !relaySession.initialized ||
            envNewChatEachTurn() ||
            params.relayNewChat === true;
          const envEach = envNewChatEachTurn();
          trace.wantNewChat = wantNewChat;
          console.error(
            "[copilot:describe] wantNewChat=",
            wantNewChat,
            "initialized=",
            relaySession.initialized,
            "RELAY_COPILOT_NEW_CHAT_EACH_TURN=",
            envEach ? "on" : "off",
            "relayNewChat=",
            params.relayNewChat === true,
            "relaySessionId=",
            relaySessionId,
            "request_chain=",
            requestChain,
            "stage_label=",
            stageLabel,
            "request_attempt=",
            requestAttempt,
            "repair_replay_attempt=",
            trace.repairReplayAttempt,
          );
          if (wantNewChat) {
            console.error("[copilot:describe] starting new chat...");
            let newChatOk = await clickNewChatDeep(pageSession);
            if (!newChatOk) {
              console.error("[copilot:describe] new chat not found (css+shadow+a11y); last-chance CDP click");
              await pageSession.click(NEW_CHAT_BUTTON_SELECTORS[0]).then(() => {
                newChatOk = true;
              }).catch(() => {});
            }
            if (!newChatOk) {
              throw new Error("Copilot new chat could not be started");
            }
            await sleep(1600);
            relaySession.initialized = true;
            trace.newChatReady = true;
            trace.newChatReadyElapsedMs = Date.now() - describeStartedAt;
            console.error(
              "[copilot:describe] new chat ready after",
              trace.newChatReadyElapsedMs,
              "ms",
            );
          } else {
            console.error("[copilot:describe] continuing in current Copilot thread (no new chat click)");
            await sleep(500);
          }

          const uploadStartedAt = Date.now();
          const upload = await uploadCopilotAttachments(pageSession, params.attachmentPaths || [], params.imageB64);
          attachmentTempFiles = upload.tempFiles;
          hadAttachments = upload.hadAttachments;
          console.error(
            "[copilot:describe] attachments prepared in",
            Date.now() - uploadStartedAt,
            "ms",
            "hadAttachments=",
            hadAttachments,
          );

          const fullPrompt = params.systemPrompt ? `${params.systemPrompt}\n\n${params.userPrompt}` : params.userPrompt;
          let continuationRetryUsed = false;
          while (true) {
            let phase = "paste";
            let phaseStartedAt = Date.now();
            try {
              this._updateRequestProgress(requestState, { phase: "pasting", done: false });
              console.error(
                "[copilot:describe] phase=paste begin prompt_chars=",
                fullPrompt.length,
                continuationRetryUsed ? "(continuation retry)" : "",
                "request_chain=",
                requestChain,
                "stage_label=",
                stageLabel,
              );
              await pastePromptRaw(pageSession, fullPrompt);
              trace.pasteDone = true;
              trace.pasteElapsedMs = Date.now() - phaseStartedAt;
              console.error(
                "[copilot:describe] phase=paste done elapsed_ms=",
                trace.pasteElapsedMs,
                "prompt_chars=",
                fullPrompt.length,
              );

              phase = "submit";
              phaseStartedAt = Date.now();
              this._updateRequestProgress(requestState, { phase: "waiting", done: false });
              console.error("[copilot:describe] phase=submit begin");
              const responseText = await submitPromptRaw(pageSession, fullPrompt.length, netCapture, {
                hadAttachments,
                abortCheck: () => requestState.aborted === true,
                trace,
                responseTimeoutMs: bridgeResponseTimeoutMs(stageLabel, requestState.probeMode),
                onProgress: (snapshot) => {
                  this._updateRequestProgress(requestState, snapshot);
                },
              });
              trace.networkSeedSeen = !!netCapture?.sawAnySeed?.();
              trace.waitResponseElapsedMs = Date.now() - phaseStartedAt;
              trace.totalElapsedMs = Date.now() - describeStartedAt;
              console.error(
                "[copilot:describe] phase=wait_response done elapsed_ms=",
                trace.waitResponseElapsedMs,
                "response_chars=",
                responseText.length,
                "total_elapsed_ms=",
                trace.totalElapsedMs,
              );
              if (repairStage && !repairReplayUsed && responseLooksLikeRepairRefusal(responseText)) {
                trace.failureClass = "copilot_refusal_after_send";
                logDescribeTrace("[copilot:describe] repair fresh-chat replay requested", trace, {
                  response_excerpt: String(responseText).trim().slice(0, 240),
                });
                this.lastBridgeFailure = attachFailureMeta(new Error("relay_repair_replay"), trace).relayFailureMeta;
                this._recordRepairStageTrace(trace, false);
                const replayError = new Error("relay_repair_replay");
                replayError.repairReplayReason = trace.failureClass;
                throw replayError;
              }
              this.lastBridgeFailure = null;
              this._recordRepairStageTrace(trace, true);
              return responseText;
            } catch (error) {
              if (
                !continuationRetryUsed &&
                isRecoverableLongContinuationFailure(error, fullPrompt.length, phase)
              ) {
                continuationRetryUsed = true;
                const health = await inspectCopilotPageHealth(pageSession).catch(() => null);
                if (health) {
                  console.error(
                    "[copilot:describe] long continuation retry health:",
                    JSON.stringify({
                      title: (health.title || "").slice(0, 80),
                      href: (health.href || "").slice(0, 120),
                    }),
                  );
                }
                if (health && copilotPageLooksCrashed(health)) {
                  throw error;
                }
                console.error(
                  "[copilot:describe] long continuation retry after phase=",
                  phase,
                  "elapsed_ms=",
                  Date.now() - phaseStartedAt,
                  "error=",
                  error?.message || error,
                );
                await assertCopilotPageResponsive(pageSession, "[copilot:describe]");
                await focusComposer(pageSession).catch(() => {});
                await clearComposerViaKeyboard(pageSession).catch(() => {});
                await sleep(250);
                continue;
              }
              trace.networkSeedSeen = !!netCapture?.sawAnySeed?.();
              trace.totalElapsedMs = Date.now() - describeStartedAt;
              throw error;
            }
          }
        } finally {
          await netCapture.disable().catch(() => {});
        }
      } catch (error) {
        if (requestState.aborted || error?.message === "relay_copilot_aborted") {
          throw new Error("relay_copilot_aborted");
        }
        if (error instanceof CopilotLoginRequiredError) {
          throw error;
        }
        const message = error?.message || String(error);
        if (error?.repairReplayReason && repairStage && !repairReplayUsed) {
          trace.totalElapsedMs = Date.now() - describeStartedAt;
          this.lastBridgeFailure = attachFailureMeta(error, trace, { message }).relayFailureMeta;
          this._recordRepairStageTrace(trace, false);
          repairReplayUsed = true;
          logDescribeTrace("[copilot:describe] repair replay continuing with forced new chat", trace, {
            classified_reason: error.repairReplayReason,
          });
          await sleep(750);
          continue;
        }
        trace.failureClass = classifyDescribeFailure(trace);
        trace.totalElapsedMs = Date.now() - describeStartedAt;
        logDescribeTrace("[copilot:describe] classified failure", trace, {
          error: message,
        });
        this.lastBridgeFailure = attachFailureMeta(error, trace, { message }).relayFailureMeta;
        this._recordRepairStageTrace(trace, false);
        if (
          repairStage &&
          !repairReplayUsed &&
          ["network_seed_missing", "dom_response_timeout"].includes(trace.failureClass)
        ) {
          repairReplayUsed = true;
          console.error(
            "[copilot:describe] repair stage forcing fresh-chat replay after classified failure=",
            trace.failureClass,
          );
          await sleep(750);
          continue;
        }
        const recoverable = recoverableAttempt === 0 && isRecoverableCopilotTabFailure(error);
        if (isRecoverableCopilotTabFailure(error)) {
          await this._closeRelayTargetIfKnown(relaySession, message).catch(() => {});
        }
        this._invalidateRelaySession(relaySession, message);
        if (recoverable) {
          recoverableAttempt += 1;
          console.error("[copilot:describe] recoverable CDP/tab failure; retrying once:", message);
          await sleep(750);
          continue;
        }
        throw attachFailureMeta(error, trace, { message });
      } finally {
        for (const tf of attachmentTempFiles) {
          setTimeout(() => {
            fs.promises.unlink(tf).catch(() => {});
          }, 5000);
        }
        if (pageSession) {
          pageSession.close();
        }
      }
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

function normalizeTextContent(content) {
  if (typeof content === "string") return (content || "").trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text" && part.text)
    .map((part) => String(part.text || "").trim())
    .filter(Boolean)
    .join("\n");
}

/** Kiroku: ClipboardEvent("paste") on outer Lexical shell only (no beforeinput). */
async function pasteViaKirokuOuterClipboardOnly(session, text) {
  const r = await session.evaluate(`((fullText) => {
    const el =
      document.querySelector("#m365-chat-editor-target-element") ??
      document.querySelector('[data-lexical-editor="true"]');
    if (!el) return false;
    try {
      el.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", fullText);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  })(${JSON.stringify(text)})`);
  return r.value === true;
}

async function copilotAttachmentStillPending(session) {
  const r = await session.evaluate(`(() => {
    const sels = ${JSON.stringify(ATTACHMENT_PENDING_SELECTORS)};
    for (let i = 0; i < sels.length; i++) {
      let els;
      try {
        els = document.querySelectorAll(sels[i]);
      } catch (_) {
        continue;
      }
      for (let j = 0; j < els.length; j++) {
        const el = els[j];
        if (el && el.offsetParent !== null) return true;
      }
    }
    return false;
  })()`);
  return r.value === true;
}

async function clickPlusMenuForUpload(session) {
  for (let i = 0; i < PLUS_BUTTON_SELECTORS.length; i++) {
    if (await clickFirstVisibleDeep(session, PLUS_BUTTON_SELECTORS[i])) return true;
  }
  return false;
}

async function setCopilotFileInputFilesViaDom(session, absolutePaths) {
  await session.send("DOM.enable", {}).catch(() => {});
  const docRes = await session.send("DOM.getDocument", { depth: -1, pierce: true }, 30e3);
  const rootId = docRes.root?.nodeId;
  if (!rootId) throw new Error("DOM.getDocument missing root nodeId");
  for (let si = 0; si < FILE_INPUT_SELECTORS.length; si++) {
    const sel = FILE_INPUT_SELECTORS[si];
    let q;
    try {
      q = await session.send("DOM.querySelector", { nodeId: rootId, selector: sel }, 10e3);
    } catch {
      continue;
    }
    const nodeId = q.nodeId;
    if (!nodeId || nodeId === 0) continue;
    try {
      await session.send("DOM.setFileInputFiles", { nodeId, files: absolutePaths }, 30e3);
      return sel;
    } catch (e) {
      console.error("[copilot:attach] DOM.setFileInputFiles failed for", sel, e?.message || e);
    }
  }
  throw new Error("Copilot file input not found or setFileInputFiles failed");
}

async function waitForCopilotAttachmentReady(session, fileNameHint, timeoutMs = 18e3) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await session.evaluate(
      `((hint) => {
        function vis(el) {
          return el && el.offsetParent !== null;
        }
        if (hint) {
          const body = document.body;
          const t = (body && (body.innerText || body.textContent)) || "";
          if (t.includes(hint)) return true;
        }
        const sels = ${JSON.stringify(ATTACHMENT_READY_SELECTORS)};
        for (let i = 0; i < sels.length; i++) {
          const el = document.querySelector(sels[i]);
          if (vis(el)) return true;
        }
        return false;
      })(${JSON.stringify(fileNameHint || "")})`,
    );
    if (ok.value === true) return;
    await sleep(250);
  }
  throw new Error("Copilot attachment could not be confirmed");
}

/**
 * Kiroku-style uploads: one local file per pick (M365 often replaces prior attachment).
 * @returns {{ tempFiles: string[], hadAttachments: boolean }}
 */
async function uploadCopilotAttachments(session, attachmentPaths, imageB64) {
  const tempFiles = [];
  const toUpload = [];
  if (imageB64) {
    const tmpPng = path.join(
      os.tmpdir(),
      `relay-copilot-${Date.now()}-${Math.random().toString(16).slice(2)}.png`,
    );
    await fs.promises.writeFile(tmpPng, Buffer.from(imageB64, "base64"));
    tempFiles.push(tmpPng);
    toUpload.push(path.resolve(tmpPng));
  }
  const extra = Array.isArray(attachmentPaths) ? attachmentPaths : [];
  for (let i = 0; i < extra.length; i++) {
    const p = path.resolve(String(extra[i]));
    if (!fs.existsSync(p)) throw new Error(`Attachment not found: ${p}`);
    toUpload.push(p);
  }
  if (toUpload.length === 0) return { tempFiles, hadAttachments: false };

  for (let i = 0; i < toUpload.length; i++) {
    const abs = toUpload[i];
    await clickPlusMenuForUpload(session);
    await sleep(350);
    await setCopilotFileInputFilesViaDom(session, [abs]);
    await waitForCopilotAttachmentReady(session, path.basename(abs), 18e3);
    await sleep(200);
  }
  return { tempFiles, hadAttachments: true };
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
  if (copilotWindowFocusAllowed()) {
    await session.send("Page.bringToFront", {}).catch(() => {});
  }
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

/** Poll composer `innerText` length until `pasteLooksComplete` or `maxPollMs`, then optional `fallbackMs` sleep (Lexical is often a tick late). */
var COMPOSER_PASTE_SETTLE_POLL_MS = 42;
var COMPOSER_PASTE_SETTLE_KIROKU_POLL_MAX_MS = 380;
var COMPOSER_PASTE_SETTLE_KIROKU_FALLBACK_MS = 240;
var COMPOSER_PASTE_SETTLE_EXEC_POLL_MAX_MS = 440;
var COMPOSER_PASTE_SETTLE_EXEC_FALLBACK_MS = 360;
var LONG_PROMPT_SKIP_SYNC_IN_PAGE_CHARS = 12_000;

async function waitForComposerPasteSettle(session, fullLen, options = {}) {
  const intervalMs = options.intervalMs ?? COMPOSER_PASTE_SETTLE_POLL_MS;
  const maxPollMs = options.maxPollMs ?? 400;
  const fallbackMs = options.fallbackMs ?? 0;
  let len = await getComposerTextLength(session);
  if (pasteLooksComplete(len, fullLen)) return len;
  const deadline = Date.now() + maxPollMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    len = await getComposerTextLength(session);
    if (pasteLooksComplete(len, fullLen)) return len;
  }
  if (fallbackMs > 0) {
    await sleep(fallbackMs);
    len = await getComposerTextLength(session);
  }
  return len;
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
  await sleep(420);

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
  const skipSyncInPage = text.length > LONG_PROMPT_SKIP_SYNC_IN_PAGE_CHARS;

  let skipBulkFallbacks = false;
  if (text.length <= 16_000) {
    const kOuter = await pasteViaKirokuOuterClipboardOnly(session, text);
    if (kOuter) {
      len = await waitForComposerPasteSettle(session, text.length, {
        maxPollMs: COMPOSER_PASTE_SETTLE_KIROKU_POLL_MAX_MS,
        fallbackMs: COMPOSER_PASTE_SETTLE_KIROKU_FALLBACK_MS,
      });
      if (pasteLooksComplete(len, text.length)) {
        skipBulkFallbacks = true;
        console.error("[copilot:paste] kiroku outer ClipboardEvent satisfied pasteLooksComplete");
      }
    }
  }
  if (!skipBulkFallbacks && !skipSyncInPage) {
    try {
      console.error("[copilot:paste] trying sync in-page execCommand (single evaluate, ~1200 code units/step)…");
      const syncRes = await pasteViaSyncBrowserExecCommand(session, text);
      console.error("[copilot:paste] sync in-page execCommand result:", JSON.stringify(syncRes));
    } catch (e) {
      console.error("[copilot:paste] sync in-page execCommand threw:", e?.message || e);
    }
    len = await waitForComposerPasteSettle(session, text.length, {
      maxPollMs: COMPOSER_PASTE_SETTLE_EXEC_POLL_MAX_MS,
      fallbackMs: COMPOSER_PASTE_SETTLE_EXEC_FALLBACK_MS,
    });
    console.error("[copilot:paste] visible len after sync in-page:", len);
    if (pasteLooksComplete(len, text.length)) {
      skipBulkFallbacks = true;
      console.error("[copilot:paste] pasteLooksComplete after sync in-page");
    }
  } else if (skipSyncInPage) {
    console.error(
      "[copilot:paste] long prompt — skipping sync in-page execCommand and using CDP-first path",
      text.length,
      "chars",
    );
  }

  /** Very long prompts: synthetic multi-part paste often drops text; stream via CDP first. */
  if (!skipBulkFallbacks && text.length > LONG_PROMPT_SKIP_SYNC_IN_PAGE_CHARS) {
    console.error("[copilot:paste] long prompt — CDP Input.insertText first (", text.length, "chars )");
    try {
      await insertTextViaCdp(session, text);
      len = await waitForComposerPasteSettle(session, text.length, {
        maxPollMs: 480,
        fallbackMs: 400,
      });
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
    if (pasted) {
      len = await waitForComposerPasteSettle(session, text.length, {
        maxPollMs: 420,
        fallbackMs: 380,
      });
    } else {
      len = await getComposerTextLength(session);
    }
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
    len = await waitForComposerPasteSettle(session, text.length, {
      maxPollMs: 360,
      fallbackMs: 320,
    });
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
    len = await waitForComposerPasteSettle(session, text.length, {
      maxPollMs: 340,
      fallbackMs: 300,
    });
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
    len = await waitForComposerPasteSettle(session, text.length, {
      maxPollMs: 340,
      fallbackMs: 300,
    });
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
    len = await waitForComposerPasteSettle(session, text.length, {
      maxPollMs: 400,
      fallbackMs: 420,
    });
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
  await sleep(220);
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

async function submitPromptRaw(session, expectedPromptLen, netCapture = null, opts = {}) {
  const hadAttachments = opts.hadAttachments === true;
  const abortCheck = typeof opts.abortCheck === "function" ? opts.abortCheck : null;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const trace = opts.trace || null;
  const responseTimeoutMs =
    Number.isFinite(opts.responseTimeoutMs) && opts.responseTimeoutMs > 0
      ? opts.responseTimeoutMs
      : RESPONSE_TIMEOUT_MS;
  const stableMs = hadAttachments ? SEND_BUTTON_STABLE_MS_AFTER_ATTACH : SEND_BUTTON_STABLE_MS_DEFAULT;

  const minComposer = minComposerThresholdForSubmit(expectedPromptLen);

  // Until composer shows our text, Send often stays disabled
  const composeDeadline = Date.now() + 15e3;
  while (Date.now() < composeDeadline) {
    if (abortCheck && abortCheck()) {
      throw new Error("relay_copilot_aborted");
    }
    if (await copilotAttachmentStillPending(session)) {
      await sleep(200);
      continue;
    }
    const n = await getComposerTextLength(session);
    if (n >= minComposer || expectedPromptLen < 20) break;
    await sleep(200);
  }

  const lenBefore = await getComposerTextLength(session);

  // Prefer keyboard submit first (fewer brittle send-button selectors / layout deps).
  console.error("[copilot:submit] trying keyboard (Enter)");
  let sendClicked = false;
  try {
    await trySubmitViaEnter(session);
    sendClicked = await composerSubmitLooksSent(session, lenBefore);
  } catch (error) {
    console.error("[copilot:submit] Enter failed:", error?.message || error);
  }
  if (!sendClicked) {
    console.error("[copilot:submit] Enter not confirmed; trying Ctrl+Enter");
    try {
      await trySubmitViaCtrlEnter(session);
      sendClicked = await composerSubmitLooksSent(session, lenBefore);
    } catch (error) {
      console.error("[copilot:submit] Ctrl+Enter failed:", error?.message || error);
    }
  }

  // Wait for send button to become visible and enabled
  const deadline = Date.now() + 45e3;
  let stableSince = 0;
  while (!sendClicked && Date.now() < deadline) {
    if (abortCheck && abortCheck()) {
      throw new Error("relay_copilot_aborted");
    }
    const pos = await findSendButtonCenter(session);
    const pending = await copilotAttachmentStillPending(session);
    if (pos.ok && !pending) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= stableMs) {
        console.error("[copilot:submit] clicking send (DOM)");
        const domOk = await clickSendViaDom(session);
        if (!domOk) {
          await session.click(SEND_BUTTON_ANY_SELECTOR).catch(() => {});
        }
        await sleep(520);
        let { generating, len: lenNow } = await getComposerLenAndCopilotGenerating(session);
        let looksSent = generating || lenNow + 25 < lenBefore;
        if (!looksSent) {
          console.error("[copilot:submit] DOM click did not dispatch; trying CDP mouse");
          await clickSendViaCdpMouse(session);
          await sleep(520);
          ({ generating, len: lenNow } = await getComposerLenAndCopilotGenerating(session));
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
    const { generating, len: lenAfter } = await getComposerLenAndCopilotGenerating(session);
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
    const { generating: generating2, len: lenAfter2 } = await getComposerLenAndCopilotGenerating(session);
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

  if (trace) {
    trace.submitObserved = true;
    trace.networkSeedSeen = !!netCapture?.sawAnySeed?.();
    trace.domWaitStarted = true;
  }
  console.error(
    "[copilot:describe] phase=wait_response begin send_ok=true timeout_s",
    responseTimeoutMs / 1000,
  );
  console.error(
    "[copilot:describe] send OK; waiting for Copilot reply (DOM/network, timeout",
    responseTimeoutMs / 1000,
    "s)…",
  );
  try {
    const response = await waitForDomResponse(session, netCapture, expectedPromptLen, abortCheck, {
      onProgress,
      timeoutMs: responseTimeoutMs,
    });
    if (trace) {
      trace.domWaitFinished = true;
      trace.networkSeedSeen = !!netCapture?.sawAnySeed?.();
    }
    return response;
  } catch (error) {
    if (trace) {
      trace.networkSeedSeen = !!netCapture?.sawAnySeed?.();
    }
    throw error;
  }
}

function isRecoverableCopilotTabFailure(error) {
  const message = String(error?.message || error || "");
  return (
    /CDP (?:Input\.dispatchKeyEvent|Runtime\.evaluate|Network\.enable|Page\.navigate|Target\.activateTarget|Page\.bringToFront) timed out/i.test(
      message,
    ) ||
    /CDP WebSocket (?:closed|error|timeout|is not open)/i.test(message) ||
    /Copilot send failed \(no clickable send within 45s/i.test(message) ||
    /Session closed|Target closed|Target detached|No session with given id|Cannot find context with specified id|Execution context was destroyed/i.test(
      message,
    ) ||
    /tab crash page visible|SIGTRAP|Aw,\s*Snap|This page is having a problem/i.test(message)
  );
}

function isRecoverableLongContinuationFailure(error, promptLen, phase) {
  if (promptLen < LONG_CONTINUATION_RETRY_CHARS) return false;
  const message = String(error?.message || error || "");
  if (!["paste", "submit", "wait_response"].includes(phase)) return false;
  return (
    /timed out|timeout/i.test(message) ||
    /error sending request/i.test(message) ||
    /response wait/i.test(message) ||
    /CDP WebSocket (?:closed|error|timeout|is not open)/i.test(message) ||
    /Copilot send failed/i.test(message)
  );
}

function isRepairStageLabel(stageLabel) {
  return stageLabel === "repair1" || stageLabel === "repair2";
}

function bridgeResponseTimeoutMs(stageLabel, probeMode) {
  if (probeMode) return 30_000;
  return isRepairStageLabel(stageLabel) ? 30_000 : RESPONSE_TIMEOUT_MS;
}

function responseLooksLikeRepairRefusal(text) {
  const lower = String(text || "").trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("sorry, it looks like i can’t respond") ||
    lower.includes("sorry, it looks like i can't respond") ||
    lower.includes("cannot respond to this") ||
    lower.includes("can't respond to this") ||
    lower.includes("let’s try a different topic") ||
    lower.includes("let's try a different topic") ||
    (lower.includes("different topic") && lower.includes("new chat"))
  );
}

function classifyDescribeFailure(trace) {
  if (trace.failureClass) return trace.failureClass;
  if (trace.wantNewChat && !trace.newChatReady) return "new_chat_not_ready";
  if (!trace.submitObserved) return "submit_not_observed";
  if (trace.submitObserved && !trace.networkSeedSeen) return "network_seed_missing";
  if (trace.domWaitStarted && !trace.domWaitFinished) return "dom_response_timeout";
  return "dom_response_timeout";
}

function logDescribeTrace(prefix, trace, extras = {}) {
  console.error(
    prefix,
    JSON.stringify({
      request_chain: trace.requestChain,
      stage_label: trace.stageLabel,
      request_attempt: trace.requestAttempt,
      transport_attempt: trace.transportAttempt,
      repair_replay_attempt: trace.repairReplayAttempt,
      want_new_chat: trace.wantNewChat,
      new_chat_ready: trace.newChatReady,
      paste_done: trace.pasteDone,
      submit_observed: trace.submitObserved,
      network_seed_seen: trace.networkSeedSeen,
      dom_wait_started: trace.domWaitStarted,
      dom_wait_finished: trace.domWaitFinished,
      new_chat_ready_elapsed_ms: trace.newChatReadyElapsedMs ?? null,
      paste_elapsed_ms: trace.pasteElapsedMs ?? null,
      wait_response_elapsed_ms: trace.waitResponseElapsedMs ?? null,
      total_elapsed_ms: trace.totalElapsedMs ?? null,
      failure_class: trace.failureClass || null,
      ...extras,
    }),
  );
}

function attachFailureMeta(error, trace, extras = {}) {
  const target = error instanceof Error ? error : new Error(String(error || "unknown error"));
  target.relayFailureMeta = {
    failureClass: trace.failureClass || null,
    stageLabel: trace.stageLabel,
    requestChain: trace.requestChain,
    requestAttempt: trace.requestAttempt,
    transportAttempt: trace.transportAttempt,
    repairReplayAttempt: trace.repairReplayAttempt,
    wantNewChat: trace.wantNewChat,
    newChatReady: trace.newChatReady,
    pasteDone: trace.pasteDone,
    submitObserved: trace.submitObserved,
    networkSeedSeen: trace.networkSeedSeen,
    domWaitStarted: trace.domWaitStarted,
    domWaitFinished: trace.domWaitFinished,
    newChatReadyElapsedMs: trace.newChatReadyElapsedMs ?? null,
    pasteElapsedMs: trace.pasteElapsedMs ?? null,
    waitResponseElapsedMs: trace.waitResponseElapsedMs ?? null,
    totalElapsedMs: trace.totalElapsedMs ?? null,
    ...extras,
  };
  return target;
}

async function inspectCopilotPageHealth(session) {
  const result = await session.evaluate(
    `(() => ({
      title: document.title || "",
      href: location.href || "",
      bodyText: ((document.body && (document.body.innerText || document.body.textContent)) || "").slice(0, 600)
    }))()`,
    6e3,
  );
  const value = result?.value || {};
  const title = String(value.title || "");
  const href = String(value.href || "");
  const bodyText = String(value.bodyText || "");
  return { title, href, bodyText };
}

function copilotPageLooksCrashed(health) {
  const combined = `${health?.title || ""}\n${health?.bodyText || ""}`;
  return /this page is having a problem|aw,\s*snap|sigtrap|status_(?:access_violation|breakpoint)|problem loading page|ページ.*問題|問題が発生|クラッシュ/i.test(
    combined,
  );
}

async function assertCopilotPageResponsive(session, logPrefix) {
  const health = await inspectCopilotPageHealth(session);
  if (copilotPageLooksCrashed(health)) {
    const snippet = `${health.title} ${health.bodyText}`.replace(/\s+/g, " ").trim().slice(0, 220);
    throw new Error(`Copilot tab crash page visible: ${snippet}`);
  }
  console.error(logPrefix, "page healthy:", JSON.stringify({
    title: health.title.slice(0, 80),
    href: health.href.slice(0, 120),
  }));
}



/** One CDP evaluate: visible composer length + same `generating` scan as submit confirmation (avoids back-to-back evaluate). */
function copilotDomComposerLenAndGeneratingExpression() {
  return `(() => {
    ${COMPOSER_DOM_HELPERS}
    function lenOf(el) {
      if (!el) return 0;
      const raw = el.innerText || el.textContent || "";
      const t = raw.replace(new RegExp(String.fromCharCode(0x200b), "g"), "");
      return t.trim().length;
    }
    const cEl = __raFindComposerEditable();
    const len = lenOf(cEl);
    const generating = ${copilotDomGeneratingIifeExpression()};
    return { len, generating };
  })()`;
}

async function getComposerLenAndCopilotGenerating(session) {
  const r = await session.evaluate(copilotDomComposerLenAndGeneratingExpression()).catch(() => ({
    value: { len: 0, generating: false },
  }));
  const v = r?.value;
  return {
    len: Number(v?.len) || 0,
    generating: v?.generating === true,
  };
}

/** Last assistant turn by ARIA role only (avoids picking user text from generic markdown selectors). */

/**
 * M365 often omits role="assistant" on the visible node; try Copilot / Fluent / cib patterns.
 * Returns the *last* substantial match in document order (reply is usually below the user prompt).
 */

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
    sawAnySeed() {
      return metas.length > 0 || chathubRequestIds.size > 0 || chathubFramePayloads.length > 0;
    },
    sawChathubSeed() {
      return chathubRequestIds.size > 0 || chathubFramePayloads.length > 0;
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


/**
 * If loose text is prompt-sized garbage, require a shorter role=assistant extract or refuse to return
 * (prevents agent-loop feedback that doubles prompt size every turn).
 */


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

/** Match `cdp_copilot::launch_dedicated_edge` / `start-relay-edge-cdp.sh` so Node-spawned Edge exposes CDP reliably (esp. Linux). */
function relayEdgeChromiumHardeningArgv() {
  const out = [
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-hang-monitor",
    "--disable-breakpad",
    "--disable-crashpad",
  ];
  // `--disable-site-isolation-trials` is unsupported on Windows Edge (warning) and omitted on macOS; keep on Linux only.
  if (process.platform === "linux") {
    out.splice(3, 0, "--disable-site-isolation-trials");
  }
  // Edge on Windows/macOS often reports `--no-sandbox` as unsupported; Chromium on Linux still benefits (CI/containers).
  if (process.platform === "linux" || process.env.RELAY_EDGE_FORCE_NO_SANDBOX === "1") {
    out.unshift("--no-sandbox");
  }
  if (process.platform === "linux") out.push("--disable-dev-shm-usage");
  return out;
}

/** Log file for Edge stderr/stdout from Node spawns; empty string or `0` disables. */
function defaultRelayEdgeLogPath() {
  const fromEnv = process.env.RELAY_EDGE_LOG;
  if (fromEnv === "" || fromEnv === "0") return null;
  if (fromEnv) return fromEnv;
  const home =
    process.platform === "win32"
      ? process.env.USERPROFILE || process.env.HOME
      : process.env.HOME;
  if (!home) return null;
  return path.join(home, ".local", "log", "relay-edge-copilot.log");
}

function readDevToolsActivePortSync(profileDir) {
  try {
    const fp = path.join(profileDir, "DevToolsActivePort");
    const data = fs.readFileSync(fp, "utf8");
    const line = (data.split(/\r?\n/)[0] ?? "").trim();
    const n = Number.parseInt(line, 10);
    if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
  } catch {
    /* ignore */
  }
  return null;
}

async function waitForDevToolsActivePort(profileDir, maxWaitMs) {
  const interval = 100;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const p = readDevToolsActivePortSync(profileDir);
    if (p != null) return p;
    await sleep(interval);
  }
  return null;
}

/** Parse `process.env[name]` as milliseconds; clamp to `[minMs, maxMs]`. Empty/unset uses `defaultVal`. */
function relayEnvPositiveIntMs(name, defaultVal, minMs, maxMs) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return defaultVal;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return defaultVal;
  return Math.min(maxMs, Math.max(minMs, n));
}

const EXISTING_CDP_POLL_MS = 300;
const EXISTING_CDP_WAIT_MS = relayEnvPositiveIntMs(
  "RELAY_EXISTING_CDP_WAIT_MS",
  process.platform === "win32" ? 10_000 : 30_000,
  1_000,
  120_000,
);

/**
 * After an immediate probe miss, poll so prestart/Chromium can finish binding CDP
 * (avoids spawning a second Edge on the same profile).
 */
async function pollForExistingDedicatedCdp(profileDir, preferredPort) {
  const deadline = Date.now() + EXISTING_CDP_WAIT_MS;
  while (Date.now() < deadline) {
    const ports = new Set([preferredPort]);
    const fromFile = readDevToolsActivePortSync(profileDir);
    if (fromFile != null) ports.add(fromFile);
    for (const port of ports) {
      const info = await probeCdpVersion(port);
      if (info && cdpDedicatedRelayProfileCdpOk(info)) {
        return port;
      }
    }
    await sleep(EXISTING_CDP_POLL_MS);
  }
  return null;
}

/** No trailing Copilot URL — passing it here plus Target.createTarget produced duplicate m365 tabs on cold CDP. */
function relayDedicatedEdgeBaseArgv(profileDir) {
  return [
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--disable-infobars",
    "--disable-restore-session-state",
    "--disable-session-crashed-bubble",
    "--disable-features=EdgeEnclave,VbsEnclave,RendererCodeIntegrity",
    ...relayEdgeChromiumHardeningArgv(),
    `--user-data-dir=${profileDir}`,
  ];
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

/** Best-effort kill of Edge and subprocesses so a failed port=0 trial does not leave a second Copilot window. */
async function terminateEdgeProcessTree(pid) {
  if (pid == null || pid <= 0) return;
  try {
    if (process.platform === "win32") {
      const { execFile } = await import("node:child_process");
      await new Promise((resolve) => {
        execFile(
          "taskkill",
          ["/F", "/T", "/PID", String(pid)],
          { windowsHide: true },
          () => resolve(),
        );
      });
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* ESRCH etc. */
      }
      await sleep(500);
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.error("[copilot:ensureEdge] terminateEdgeProcessTree:", e?.message || e);
  }
}

/**
 * Detached msedge — reliable under Tauri; `cmd start` can hang without invoking the execFile callback on some PCs.
 * @param {string | null} [logPath] — override log target; `null` disables file logging.
 * @param {{ retainChild?: boolean }} [opts] — if `retainChild`, skip `unref()` and return the child for cleanup or later `unref()`.
 * @returns {Promise<import("node:child_process").ChildProcess | undefined>}
 */
async function spawnEdgeDetached(edgePath, argv, tag = "", logPath, opts = {}) {
  const retainChild = opts.retainChild === true;
  const { spawn } = await import("node:child_process");
  const t = tag ? ` (${tag})` : "";
  const resolvedLog = logPath === undefined ? defaultRelayEdgeLogPath() : logPath;
  console.error("[copilot:ensureEdge] spawn msedge" + t + "…");
  let logFd = null;
  let stdio = "ignore";
  if (resolvedLog) {
    try {
      fs.mkdirSync(path.dirname(resolvedLog), { recursive: true });
      logFd = fs.openSync(resolvedLog, "a");
      const banner = `\n--- [copilot ${new Date().toISOString()}] spawn${t} ${edgePath} ---\n`;
      fs.writeSync(logFd, banner);
      stdio = ["ignore", logFd, logFd];
    } catch (e) {
      console.error("[copilot:ensureEdge] log open failed:", resolvedLog, e?.message || e);
      stdio = "ignore";
    }
  }
  const child = spawn(edgePath, argv, {
    detached: true,
    stdio,
    windowsHide: false,
  });
  child.on("error", (err) => {
    console.error("[copilot:ensureEdge] spawn error" + t + ":", err?.message || err);
  });
  const fdToClose = logFd;
  child.once("exit", (code, signal) => {
    if (fdToClose != null) {
      try {
        fs.closeSync(fdToClose);
      } catch {
        /* ignore */
      }
    }
    if (code != null && code !== 0) {
      console.error(
        "[copilot:ensureEdge] Edge child exited early" + t + ": code=",
        code,
        "signal=",
        signal,
        resolvedLog ? `(stderr log: ${resolvedLog})` : "",
      );
    }
  });
  if (!retainChild) {
    child.unref();
  }
  console.error("[copilot:ensureEdge] spawn issued" + t + " pid=", child.pid ?? "(none)");
  await sleep(400);
  return retainChild ? child : undefined;
}

/**
 * Win32: optional cmd /c start first; always ends in spawnEdgeDetached for resilience.
 * @param {{ retainChild?: boolean }} [opts] — port=0 trial: retain child PID so we can kill the tree if CDP fallback runs.
 * @returns {Promise<import("node:child_process").ChildProcess | undefined>}
 */
async function spawnEdgeForDedicated(edgePath, argv, tag, opts = {}) {
  const retainChild = opts.retainChild === true;
  if (process.platform === "win32") {
    const useCmdStart = process.env.RELAY_COPILOT_WIN32_CMD_START === "1";
    if (useCmdStart && retainChild) {
      console.error(
        "[copilot:ensureEdge] retainChild: skipping RELAY_COPILOT_WIN32_CMD_START so port=0 Edge pid can be tracked",
      );
    } else if (useCmdStart) {
      console.error("[copilot:ensureEdge] RELAY_COPILOT_WIN32_CMD_START=1 — trying cmd /c start (12s cap)…");
      try {
        await withTimeout(launchEdgeMsedgeWin32(edgePath, argv), 12e3, `${tag} cmd start`);
        console.error("[copilot:ensureEdge] Win32 cmd start returned OK");
        return undefined;
      } catch (e) {
        console.error("[copilot:ensureEdge] cmd start failed or timed out:", e?.message || e);
      }
    } else {
      console.error(
        "[copilot:ensureEdge] default: spawn() (set RELAY_COPILOT_WIN32_CMD_START=1 to use cmd start first)",
      );
    }
  }
  return await spawnEdgeDetached(edgePath, argv, tag, undefined, { retainChild });
}

async function waitUntilDedicatedCdpResponds(actualPort, profileDir, timeoutMs = EDGE_LAUNCH_TIMEOUT_MS) {
  const dl = Date.now() + timeoutMs;
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
    if (info && cdpDedicatedRelayProfileCdpOk(info)) {
      globalOptions.cdpPort = actualPort;
      writeCdpPortMarker(profileDir, actualPort);
      console.error(
        "[copilot:ensureEdge] CDP ready on port",
        actualPort,
        "after ~",
        Math.round((Date.now() - edgeWaitStarted) / 1000),
        "s",
      );
      return true;
    }
    if (info && !loggedMismatch && Date.now() > dl - 12e3) {
      loggedMismatch = true;
      console.error(
        "[copilot:ensureEdge] port",
        actualPort,
        "responds but not accepted as Relay dedicated CDP yet:",
        JSON.stringify({ Browser: info.Browser, UserAgent: info["User-Agent"] }).slice(0, 400),
      );
    }
    await sleep(EDGE_LAUNCH_POLL_INTERVAL_MS);
  }
  return false;
}

/** Rust-aligned: OS-assigned CDP port via DevToolsActivePort (remote-debugging-port=0). */
async function tryDedicatedLaunchPortZero(edgePath, profileDir) {
  const port0CdpWaitMs = relayEnvPositiveIntMs(
    "RELAY_EDGE_PORT0_CDP_WAIT_MS",
    12_000,
    2_000,
    120_000,
  );
  const argv = ["--remote-debugging-port=0", ...relayDedicatedEdgeBaseArgv(profileDir)];
  console.error("[copilot:ensureEdge] trying remote-debugging-port=0 + DevToolsActivePort (Rust-aligned)…");
  const child = await spawnEdgeForDedicated(edgePath, argv, "dedicated-port0", { retainChild: true });

  const cleanupAbandonedPort0 = async () => {
    const pid = child?.pid;
    if (pid != null) {
      console.error(
        "[copilot:ensureEdge] terminating abandoned port=0 Edge pid=",
        pid,
        "before fixed-port launch",
      );
      await terminateEdgeProcessTree(pid);
      await sleep(400);
    }
  };

  try {
    const discovered = await waitForDevToolsActivePort(profileDir, 30_000);
    if (discovered == null) {
      console.error("[copilot:ensureEdge] DevToolsActivePort missing after port=0 launch; using fixed-port fallback");
      await cleanupAbandonedPort0();
      return false;
    }
    console.error("[copilot:ensureEdge] DevToolsActivePort reports port", discovered);
    if (await waitUntilDedicatedCdpResponds(discovered, profileDir, port0CdpWaitMs)) {
      if (child) child.unref();
      return true;
    }
    console.error("[copilot:ensureEdge] CDP on DevToolsActivePort port did not become ready; using fixed-port fallback");
    await cleanupAbandonedPort0();
    return false;
  } catch (e) {
    await cleanupAbandonedPort0();
    throw e;
  }
}

/** Legacy: scan cdpPort..cdpPort+range for a free TCP listener slot, fixed --remote-debugging-port. */
async function launchDedicatedFixedPortScan(edgePath, profileDir, cdpPort) {
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
        `CDPポート ${cdpPort}〜${port} はすべて使用中です。手動デバッグの Edge を閉じるか、別のポート範囲を空けてください。`,
      );
    }
  }
  if (actualPort !== cdpPort) {
    console.error(`[copilot:ensureEdge] port ${cdpPort} has foreign CDP; launching Relay Edge on ${actualPort}`);
  }

  globalOptions.cdpPort = actualPort;
  console.error("[copilot:ensureEdge] launching Relay Edge (isolated profile) on port", actualPort);
  const args = [`--remote-debugging-port=${actualPort}`, ...relayDedicatedEdgeBaseArgv(profileDir)];
  console.error("[copilot:ensureEdge] starting Edge process (fixed port)…");
  await spawnEdgeForDedicated(edgePath, args, "dedicated-fixed");

  if (await waitUntilDedicatedCdpResponds(actualPort, profileDir)) return;

  throw new Error(
    `Edgeのデバッグ接続が開始できません (port ${actualPort})。msedge の起動ブロック、プロファイルロック、または企業ポリシーを確認してください。`,
  );
}

/** Dedicated profile: do not attach to arbitrary CDP in [cdpPort, cdpPort+scan) outside our launch/marker path. */
async function ensureEdgeDedicated(edgePath, profileDir, cdpPort) {
  if (process.env.RELAY_COPILOT_ALWAYS_LAUNCH_EDGE === "1") {
    clearCdpPortMarker(profileDir);
    console.error(
      "[copilot:ensureEdge] RELAY_COPILOT_ALWAYS_LAUNCH_EDGE=1 — CDP marker cleared (always spawn Edge)",
    );
  }
  const marked = readCdpPortMarker(profileDir);
  const markedProbe = marked != null ? await probeCdpVersion(marked) : null;
  if (marked != null && markedProbe && cdpDedicatedRelayProfileCdpOk(markedProbe)) {
    globalOptions.cdpPort = marked;
    console.error("[copilot:ensureEdge] reusing Relay Edge (marker) on port", marked);
    if (process.platform === "win32" && process.env.RELAY_COPILOT_NUDGE_EDGE === "1") {
      /** No trailing URL — passing COPILOT_URL here opened a duplicate Copilot tab on every reuse. */
      const nudgeArgs = [
        `--remote-debugging-port=${marked}`,
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--disable-infobars",
        "--disable-restore-session-state",
        "--disable-session-crashed-bubble",
        "--disable-features=EdgeEnclave,VbsEnclave,RendererCodeIntegrity",
        ...relayEdgeChromiumHardeningArgv(),
        `--user-data-dir=${profileDir}`,
      ];
      try {
        await withTimeout(launchEdgeMsedgeWin32(edgePath, nudgeArgs), 12e3, "nudge cmd start");
        console.error("[copilot:ensureEdge] Win32: nudge start dispatched (foreground existing Edge)");
      } catch (e) {
        // Do not spawn a second msedge here — same profile often opens an extra blank window;
        // CDP reuse is already valid without a nudge.
        console.error("[copilot:ensureEdge] nudge cmd start skipped/failed (continuing with CDP reuse):", e?.message || e);
      }
    }
    return;
  }
  if (marked != null && markedProbe && !cdpDedicatedRelayProfileCdpOk(markedProbe)) {
    console.error(
      "[copilot:ensureEdge] marker port",
      marked,
      "has CDP Relay will not attach to — clearing marker and launching Edge",
    );
  }
  if (marked != null) clearCdpPortMarker(profileDir);

  // 手動スクリプトで固定ポートだけ付けて起動した Edge は
  // .relay-agent-cdp-port を書かない。既に CDP が Edge なら追加起動せず再利用する。
  const preferredProbe = await probeCdpVersion(cdpPort);
  if (preferredProbe && cdpDedicatedRelayProfileCdpOk(preferredProbe)) {
    globalOptions.cdpPort = cdpPort;
    writeCdpPortMarker(profileDir, cdpPort);
    console.error(
      "[copilot:ensureEdge] reusing existing Edge CDP on requested port",
      cdpPort,
    );
    return;
  }

  const polled = await pollForExistingDedicatedCdp(profileDir, cdpPort);
  if (polled != null) {
    globalOptions.cdpPort = polled;
    writeCdpPortMarker(profileDir, polled);
    console.error(
      "[copilot:ensureEdge] reusing Edge CDP on port",
      polled,
      "(after race wait; DevToolsActivePort / preferred port)",
    );
    return;
  }

  if (await tryReuseDevtoolsPortBeforePortZero(profileDir, cdpPort)) return;

  const tryPortZero =
    process.platform !== "win32" || process.env.RELAY_COPILOT_TRY_PORT_ZERO === "1";
  if (!tryPortZero) {
    console.error(
      "[copilot:ensureEdge] skipping port=0 trial on win32 (set RELAY_COPILOT_TRY_PORT_ZERO=1 to enable)",
    );
  } else if (await tryDedicatedLaunchPortZero(edgePath, profileDir)) {
    return;
  }
  await launchDedicatedFixedPortScan(edgePath, profileDir, cdpPort);
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
    "--password-store=basic",
    "--disable-infobars",
    "--disable-restore-session-state",
    "--disable-session-crashed-bubble",
    "--disable-features=EdgeEnclave,VbsEnclave,RendererCodeIntegrity",
    ...relayEdgeChromiumHardeningArgv(),
  ];
  await spawnEdgeForDedicated(edgePath, args, "legacy");

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

/** True when /json/version clearly indicates Google Chrome (not Edge) — used to reject wrong browser on marker port. */
function cdpDefinitelyGoogleChromeOnly(info) {
  if (!info) return false;
  const b = `${info.Browser || ""} ${info["User-Agent"] || ""}`.toLowerCase();
  if (b.includes("edg")) return false;
  if (b.includes("microsoft edge")) return false;
  if (b.includes("google chrome")) return true;
  if (/\bchrome\/[\d.]/.test(b)) return true;
  return false;
}

/**
 * Accept CDP for Relay's dedicated Edge profile: strict Edge match, or any Chromium with a debugger WS
 * that is not clearly stock Chrome (Windows Edge sometimes omits strings our strict check expects).
 */
function cdpDedicatedRelayProfileCdpOk(info) {
  if (!info) return false;
  if (cdpVersionLooksLikeEdge(info)) return true;
  if (!info.webSocketDebuggerUrl) return false;
  return !cdpDefinitelyGoogleChromeOnly(info);
}

async function cdpPortUsableRelayDedicated(port) {
  const info = await probeCdpVersion(port);
  return !!(info && cdpDedicatedRelayProfileCdpOk(info));
}

async function tryReuseDevtoolsPortBeforePortZero(profileDir, preferredPort) {
  const fromFile = readDevToolsActivePortSync(profileDir);
  const candidates = new Set(
    [preferredPort, fromFile].filter((p) => p != null && p >= 1 && p <= 65535),
  );
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const port of candidates) {
      if (await cdpPortUsableRelayDedicated(port)) {
        globalOptions.cdpPort = port;
        writeCdpPortMarker(profileDir, port);
        console.error(
          "[copilot:ensureEdge] reusing existing CDP before port=0 spawn, port",
          port,
          attempt > 0 ? `(retry ${attempt})` : "",
        );
        return true;
      }
    }
    await sleep(400);
  }
  return false;
}

async function cdpPortIsMicrosoftEdge(port) {
  const info = await probeCdpVersion(port);
  return cdpVersionLooksLikeEdge(info);
}

function defaultRelayEdgeProfileDir() {
  const home = process.platform === "win32" ? process.env.USERPROFILE || process.env.HOME : process.env.HOME;
  if (!home) return null;
  return path.join(home, "RelayAgentEdgeProfile");
}

function findEdgePath() {
  const envExe = process.env.RELAY_EDGE_EXECUTABLE?.trim();
  if (envExe && fs.existsSync(envExe)) return envExe;

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    const candidates = [];
    if (local) candidates.push(`${local}\\Microsoft\\Edge\\Application\\msedge.exe`);
    for (const root of [process.env["PROGRAMFILES(X86)"], process.env.PROGRAMFILES].filter(Boolean)) {
      candidates.push(
        `${root}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${root}\\Microsoft\\Edge Beta\\Application\\msedge.exe`,
        `${root}\\Microsoft\\Edge Dev\\Application\\msedge.exe`,
      );
    }
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
    return null;
  }
  if (process.platform === "darwin") {
    const p = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    return fs.existsSync(p) ? p : null;
  }
  // Linux / BSD: match Rust `cdp_copilot::find_edge_path` behavior
  const home = process.env.HOME || "";
  const linuxCandidates = [
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/microsoft-edge",
    "/opt/microsoft/msedge/microsoft-edge",
    home && path.join(home, ".local/share/flatpak/exports/bin/com.microsoft.Edge"),
    "/var/lib/flatpak/exports/bin/com.microsoft.Edge",
  ].filter(Boolean);
  for (const p of linuxCandidates) {
    if (p && fs.existsSync(p)) return p;
  }
  for (const name of [
    "microsoft-edge-stable",
    "microsoft-edge",
    "microsoft-edge-dev",
    "microsoft-edge-beta",
    "msedge",
  ]) {
    try {
      const out = execFileSync("which", [name], { encoding: "utf8" }).trim();
      if (out && fs.existsSync(out)) return out;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/* ─── HTTP server ─── */
const RELAY_COPILOT_SERVICE_NAME = "relay_copilot_server";

function requireBridgeAuth(req, res) {
  if (!globalOptions.bootToken) return true;
  const header = req.headers["x-relay-boot-token"];
  const token = Array.isArray(header) ? header[0] : header;
  if (token === globalOptions.bootToken) return true;
  writeJson(res, 401, { error: "unauthorized" });
  return false;
}

function responseRecordFromError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const meta =
    error && typeof error === "object" && error.relayFailureMeta && typeof error.relayFailureMeta === "object"
      ? error.relayFailureMeta
      : null;
  console.error("[copilot] request failed:", error);
  if (error instanceof CopilotLoginRequiredError) {
    return { status: 401, body: { error: "login_required", message } };
  }
  if (message === "relay_copilot_aborted") {
    return { status: 499, body: { error: "relay_copilot_aborted" } };
  }
  if (/\bis required\b/i.test(message) || /User prompt is empty/i.test(message)) {
    return { status: 400, body: { error: message } };
  }
  return { status: 500, body: { error: message, ...(meta || {}) } };
}

function createServer(session) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return writeJson(res, 200, {
          status: "ok",
          service: RELAY_COPILOT_SERVICE_NAME,
          instanceId: globalOptions.instanceId || null,
        });
      }
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && reqUrl.pathname === "/status") {
        if (!requireBridgeAuth(req, res)) return;
        const status = await session.inspectStatus();
        return writeJson(res, 200, status);
      }
      if (req.method === "POST" && reqUrl.pathname === "/v1/chat/abort") {
        if (!requireBridgeAuth(req, res)) return;
        const payload = await readJsonBody(req);
        const relaySessionId = String(payload.relay_session_id || "").trim();
        const relayRequestId = String(payload.relay_request_id || "").trim();
        if (!relaySessionId || !relayRequestId) {
          return writeJson(res, 400, { error: "relay_session_id and relay_request_id are required" });
        }
        const aborted = session.abortRequest(relaySessionId, relayRequestId);
        console.error("[copilot:http] POST /v1/chat/abort relaySessionId=", relaySessionId, "relayRequestId=", relayRequestId, "aborted=", aborted);
        return writeJson(res, 200, { ok: true, aborted });
      }
      if (req.method === "POST" && reqUrl.pathname === "/v1/chat/completions") {
        if (!requireBridgeAuth(req, res)) return;
        const payload = await readJsonBody(req);
        const prompt = parseOpenAiRequest(payload);
        console.error(
          "[copilot:http] POST /v1/chat/completions user_chars=",
          (prompt.userPrompt || "").length,
          "system_chars=",
          (prompt.systemPrompt || "").length,
          "relay_session_id=",
          prompt.relaySessionId,
          "relay_request_id=",
          prompt.relayRequestId,
          "relay_request_chain=",
          prompt.relayRequestChain,
          "relay_request_attempt=",
          prompt.relayRequestAttempt,
          "relay_stage_label=",
          prompt.relayStageLabel,
        );
        const record = await session.startOrJoinDescribe(prompt);
        return writeJson(res, record.status, record.body);
      }
      if (req.method === "GET" && reqUrl.pathname === "/v1/chat/progress") {
        if (!requireBridgeAuth(req, res)) return;
        const relaySessionId = String(reqUrl.searchParams.get("relay_session_id") || "").trim();
        const relayRequestId = String(reqUrl.searchParams.get("relay_request_id") || "").trim();
        if (!relaySessionId || !relayRequestId) {
          return writeJson(res, 400, { error: "relay_session_id and relay_request_id are required" });
        }
        const snapshot = session.getRequestProgress(relaySessionId, relayRequestId);
        if (!snapshot) {
          return writeJson(res, 404, { error: "progress_not_found" });
        }
        return writeJson(res, 200, snapshot);
      }
      return writeJson(res, 404, { error: "Not found" });
    } catch (error) {
      const record = responseRecordFromError(error);
      return writeJson(res, record.status, record.body);
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
  const systemPrompt = msgs
    .filter((m) => m.role === "system")
    .map((m) => normalizeTextContent(m.content))
    .filter(Boolean)
    .join("\n\n");
  let userPrompt = "";
  let imageB64;
  for (const m of msgs) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") {
      userPrompt = `${userPrompt}\n${m.content}`.trim();
      continue;
    }
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === "text" && p.text) userPrompt = `${userPrompt}\n${p.text}`.trim();
        if (p.type === "image_url" && p.image_url?.url) imageB64 = extractBase64(p.image_url.url);
      }
    }
  }
  const ra = payload.relay_attachments;
  const attachmentPaths = Array.isArray(ra) ? ra.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (!userPrompt.trim()) throw new Error("User prompt is empty");
  const relaySessionId = String(payload.relay_session_id || "").trim();
  const relayRequestId = String(payload.relay_request_id || "").trim();
  if (!relaySessionId) throw new Error("relay_session_id is required");
  if (!relayRequestId) throw new Error("relay_request_id is required");
  const relayRequestChain = String(payload.relay_request_chain || relayRequestId).trim() || relayRequestId;
  const relayRequestAttemptRaw = Number.parseInt(String(payload.relay_request_attempt || "1"), 10);
  const relayRequestAttempt =
    Number.isFinite(relayRequestAttemptRaw) && relayRequestAttemptRaw >= 1 ? relayRequestAttemptRaw : 1;
  const relayStageLabel = String(payload.relay_stage_label || "original").trim() || "original";
  const relayProbeMode = payload.relay_probe_mode === true;
  const relayNewChat = payload.relay_new_chat === true;
  return {
    systemPrompt,
    userPrompt,
    imageB64,
    attachmentPaths,
    relayNewChat,
    relaySessionId,
    relayRequestId,
    relayRequestChain,
    relayRequestAttempt,
    relayStageLabel,
    relayProbeMode,
  };
}

function extractBase64(url) { const m = url.match(/^data:[^;]+;base64,(.+)$/); return m ? m[1] : url; }

function writeJson(res, code, body) {
  const p = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(p) });
  res.end(p);
}

/* ─── Entry ─── */

function parseArgs(argv) {
  let port = DEFAULT_PORT, cdpPort = DEFAULT_CDP_PORT, userDataDir = null, bootToken = null, instanceId = null, help = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") { help = true; continue; }
    if (argv[i] === "--port") { port = Number(argv[++i]); continue; }
    if (argv[i] === "--cdp-port") { cdpPort = Number(argv[++i]); continue; }
    if (argv[i] === "--user-data-dir") { userDataDir = argv[++i] ?? null; continue; }
    if (argv[i] === "--boot-token") { bootToken = argv[++i] ?? null; continue; }
    if (argv[i] === "--instance-id") { instanceId = argv[++i] ?? null; continue; }
  }
  return { port, cdpPort, userDataDir, bootToken, instanceId, help };
}

var globalOptions = parseArgs(process.argv.slice(2));
if (!globalOptions.userDataDir) {
  const d = defaultRelayEdgeProfileDir();
  if (d) globalOptions.userDataDir = d;
}

async function main() {
  if (globalOptions.help) {
    console.error("Usage: node copilot_server.js [--port 18080] [--cdp-port 9360] [--user-data-dir <path>] [--boot-token <uuid>] [--instance-id <uuid>]");
    return;
  }
  const session = new CopilotSession();
  const server = createServer(session);
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(
        `[copilot] EADDRINUSE 127.0.0.1:${globalOptions.port} — port held (orphan node or other process). Desktop reclaims stale listeners before spawn unless RELAY_COPILOT_RECLAIM_STALE_HTTP=0.`
      );
      process.exit(1);
    }
    throw err;
  });
  server.listen(globalOptions.port, "127.0.0.1", () => {
    console.error(`[copilot] listening on http://127.0.0.1:${globalOptions.port} (cdp:${globalOptions.cdpPort}, instance:${globalOptions.instanceId || "none"})`);
  });
  const shutdown = async () => { server.close(); process.exit(0); };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error("[copilot] fatal:", error);
  process.exit(1);
});
