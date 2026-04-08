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

const CDP = process.env.CDP_HTTP || "http://127.0.0.1:9360";

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
  };
})()`;

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP);
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
          a11ySnippet: a11yOut,
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
