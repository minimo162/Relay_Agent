#!/usr/bin/env node
/**
 * Playwright + CDP: dump M365 Copilot chat DOM hints for copilot_server.js tuning.
 *
 *   CDP_HTTP=http://127.0.0.1:9360 node scripts/inspect-copilot-dom.mjs
 *
 * Requires Edge (or Chrome) with --remote-debugging-port and an open m365.cloud.microsoft/chat tab.
 * The browser profile must already be signed in to M365 (same as Relay / `m365-cdp-chat` E2E).
 */
import { chromium } from "playwright";
import { ASSISTANT_REPLY_DOM_SELECTORS } from "../src-tauri/binaries/copilot_dom_poll.mjs";
import {
  extractAssistantReplyHeuristic,
  extractAssistantReplyStrict,
  extractAssistantReplyText,
  normalizeCopilotVisibleText,
  resolveAssistantReplyForReturn,
} from "../src-tauri/binaries/copilot_wait_dom_response.mjs";

const CDP = process.env.CDP_HTTP || "http://127.0.0.1:9360";
const CDP_CONNECT_TIMEOUT_MS = Number.parseInt(process.env.CDP_CONNECT_TIMEOUT_MS || "120000", 10);

const PROBE_JS = `(() => {
  function walk(root, visit, depth = 0) {
    if (!root || depth > 14) return;
    if (root.nodeType === 1) visit(root);
    const tree = root.nodeType === 9 ? root.documentElement : root;
    if (!tree) return;
    for (const c of tree.children || []) walk(c, visit, depth + 1);
    if (tree.shadowRoot) walk(tree.shadowRoot, visit, depth + 1);
  }
  function queryDeepAll(selector, doc) {
    const out = [];
    walk(doc.documentElement || doc.body, (el) => {
      try {
        if (el.matches && el.matches(selector)) out.push(el);
      } catch (_) {}
    });
    return out;
  }
  function sampleText(el, max = 200) {
    const t = (el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ");
    return t.length > max ? t.slice(0, max) + "…" : t;
  }
  const roles = {};
  for (const el of queryDeepAll("[data-message-author-role]", document)) {
    const r = el.getAttribute("data-message-author-role") || "?";
    roles[r] = (roles[r] || 0) + 1;
  }
  const articles = queryDeepAll("article", document).filter(
    (e) => e.offsetParent !== null,
  );
  const articleHints = articles.slice(-6).map((a) => ({
    role: a.getAttribute("data-message-author-role"),
    testid: a.getAttribute("data-testid"),
    class: (a.className && String(a.className).slice(0, 80)) || "",
    text: sampleText(a, 160),
  }));
  const testids = {};
  walk(document.documentElement, (el) => {
    const t = el.getAttribute && el.getAttribute("data-testid");
    if (t && /message|chat|copilot|assistant|bot|turn|reply/i.test(t)) {
      testids[t] = (testids[t] || 0) + 1;
    }
  });
  const cib = [];
  walk(document.documentElement, (el) => {
    const tag = el.tagName && el.tagName.toLowerCase();
    if (tag && tag.startsWith("cib-")) {
      const key = tag + (el.getAttribute("type") ? '[type="' + el.getAttribute("type") + '"]' : "");
      cib[key] = (cib[key] || 0) + 1;
    }
  });
  const replyDivs = queryDeepAll('[data-testid="copilot-message-reply-div"]', document).filter(
    (e) => e.offsetParent !== null,
  );
  function buttonSemanticName(el) {
    return [
      el.getAttribute?.("aria-label") || "",
      el.getAttribute?.("title") || "",
      el.getAttribute?.("data-testid") || "",
      el.className ? String(el.className) : "",
    ].join(" ").replace(/\\s+/g, " ").trim();
  }
  function buttonText(el) {
    return (el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ");
  }
  function isDisabled(el) {
    return !!(
      el.disabled ||
      el.getAttribute?.("aria-disabled") === "true" ||
      el.hasAttribute?.("disabled")
    );
  }
  const composerButtons = queryDeepAll(
    '.fai-SendButton, button, [role="button"]',
    document,
  ).filter((e) => {
    if (!e.offsetParent) return false;
    const name = buttonSemanticName(e);
    return /send|reply|stop|生成|停止|送信|応答|fai-SendButton|stopGenerating/i.test(name);
  }).slice(-20).map((e) => {
    const name = buttonSemanticName(e);
    return {
      tag: e.tagName?.toLowerCase?.() || "",
      name,
      text: buttonText(e).slice(0, 160),
      disabled: isDisabled(e),
      hasStopChild: !!e.querySelector?.('.fai-SendButton__stopBackground, [data-testid*="stop"], [class*="StopGenerating"], [class*="stopGenerating"]'),
      rect: (() => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })(),
    };
  });
  const lastReplySample =
    replyDivs.length > 0
      ? sampleText(replyDivs[replyDivs.length - 1], 240)
      : "";
  return {
    url: location.href,
    title: document.title,
    roles,
    articleHints,
    testids,
    cib,
    copilotMessageReplyDivCount: replyDivs.length,
    lastCopilotReplySample: lastReplySample,
    composerButtons,
  };
})()`;

function relaySessionAdapter(page) {
  return {
    async evaluate(expression) {
      return {
        value: await page.evaluate(expression),
      };
    },
  };
}

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: CDP_CONNECT_TIMEOUT_MS });
  } catch (e) {
    console.error("connectOverCDP failed:", e.message);
    console.error("Start Edge with: --remote-debugging-port=9360 (or set CDP_HTTP) and open M365 Copilot chat.");
    process.exit(1);
  }
  try {
    const contexts = browser.contexts();
    const pages = contexts.flatMap((c) => c.pages());
    const chat =
      pages.find((p) => /m365\.cloud\.microsoft.*chat/i.test(p.url())) ||
      pages.find((p) => /copilot\.microsoft/i.test(p.url())) ||
      pages[0];
    if (!chat) {
      console.error("No page found.");
      process.exit(1);
    }
    await chat.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    const relaySession = relaySessionAdapter(chat);
    const frames = chat.frames();
    const perFrame = [];
    let replyDivTotal = 0;
    let replyDivBestFrame = -1;
    let replyDivBestSample = "";
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      try {
        const data = await f.evaluate(PROBE_JS);
        perFrame.push({ index: i, frameUrl: f.url(), ...data });
        const n = data.copilotMessageReplyDivCount || 0;
        if (n > replyDivTotal) {
          replyDivTotal = n;
          replyDivBestFrame = i;
          replyDivBestSample = data.lastCopilotReplySample || "";
        }
      } catch (e) {
        perFrame.push({ index: i, frameUrl: f.url(), error: String(e.message || e) });
      }
    }
    const relayLooseExtract = normalizeCopilotVisibleText(await extractAssistantReplyText(relaySession));
    const relayStrictExtract = normalizeCopilotVisibleText(await extractAssistantReplyStrict(relaySession));
    const relayHeuristicExtract = normalizeCopilotVisibleText(await extractAssistantReplyHeuristic(relaySession));
    const relayResolvedExtract =
      (await resolveAssistantReplyForReturn(
        relaySession,
        relayLooseExtract,
        0,
        null,
      ).catch(() => null)) ?? "";
    const assistantSelectorMatches = [];
    for (const selector of ASSISTANT_REPLY_DOM_SELECTORS) {
      const locator = chat.locator(selector);
      const count = await locator.count().catch(() => 0);
      const last = count > 0 ? locator.nth(count - 1) : null;
      assistantSelectorMatches.push({
        selector,
        count,
        visibleCount:
          count > 0
            ? await locator.evaluateAll(
                (nodes) =>
                  nodes.filter((node) => {
                    const rect = node.getBoundingClientRect?.();
                    if (!rect) return false;
                    const style = getComputedStyle(node);
                    return (
                      style.display !== "none" &&
                      style.visibility !== "hidden" &&
                      Number(style.opacity || "1") !== 0 &&
                      rect.width > 0 &&
                      rect.height > 0
                    );
                  }).length,
              ).catch(() => 0)
            : 0,
        lastTag: last ? await last.evaluate((el) => el.tagName.toLowerCase()).catch(() => null) : null,
        lastTestId: last ? await last.getAttribute("data-testid").catch(() => null) : null,
        lastClass:
          last
            ? await last.evaluate((el) => (el.className ? String(el.className).slice(0, 120) : null)).catch(() => null)
            : null,
        lastSample:
          last
            ? await last.evaluate((el) => {
                const t = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
                return t.length > 240 ? `${t.slice(0, 240)}…` : t;
              }).catch(() => null)
            : null,
      });
    }
    let a11y = null;
    try {
      // Playwright 1.59+ removed page.accessibility(); use ARIA snapshot string instead.
      const snap =
        typeof chat.ariaSnapshot === "function"
          ? await chat.ariaSnapshot()
          : await chat.locator("body").ariaSnapshot();
      a11y = typeof snap === "string" ? snap.slice(0, 8000) : String(snap).slice(0, 8000);
    } catch (e) {
      a11y = { error: String(e.message || e) };
    }
    const listContainer = chat.locator('[data-testid="MessageListContainer"]');
    const listCount = await listContainer.count();
    let listHtmlLen = 0;
    if (listCount) {
      try {
        const h = await listContainer.first().evaluate((el) => el.innerHTML.length);
        listHtmlLen = h;
      } catch (_) {}
    }
    let listTextLen = 0;
    let listTextTail = "";
    if (listCount) {
      try {
        listTextTail = await listContainer.first().evaluate((el) => {
          const text = (el.innerText || el.textContent || "").trim();
          return text.length > 12000 ? text.slice(-12000) : text;
        });
        listTextLen = listTextTail.length;
      } catch (_) {}
    }
    const a11yOut =
      a11y && typeof a11y === "object" && "error" in a11y
        ? a11y
        : typeof a11y === "string"
          ? a11y.slice(0, 8000)
          : String(a11y).slice(0, 8000);
    console.log(
      JSON.stringify(
        {
          mainUrl: chat.url(),
          messageListContainerHtmlLen: listHtmlLen,
          messageListContainerTextLen: listTextLen,
          messageListContainerTextTail: listTextTail,
          a11ySnippet: a11yOut,
          relayLooseExtract,
          relayStrictExtract,
          relayHeuristicExtract,
          relayResolvedExtract,
          assistantSelectorMatches,
          copilotMessageReplyDivTotal: replyDivTotal,
          copilotMessageReplyDivBestFrameIndex: replyDivBestFrame,
          lastCopilotReplySampleFromBestFrame: replyDivBestSample,
          frames: perFrame,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
