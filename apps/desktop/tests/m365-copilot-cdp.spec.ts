import { test, expect, chromium } from "@playwright/test";

/* ── Constants ────────────────────────────────────────────────── */

const M365_COPILOT_URL = "https://m365.cloud.microsoft/chat";
/** Relay default CDP 9360 (YakuLingo uses 9333); override with CDP_ENDPOINT. */
const CDP_ENDPOINT =
  process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9360";

/** Same priority as `copilot_server.js` / `COMPOSER_ANCESTOR_CLOSEST` — avoids wrong `role=textbox`. */
const M365_COMPOSER_SELECTORS = [
  "#m365-chat-editor-target-element",
  '[data-lexical-editor="true"]',
  'div[role="textbox"][aria-label*="Copilot"]',
  'div[role="textbox"][aria-label*="メッセージ"]',
  'div[role="textbox"][aria-label*="Send a message"]',
  'div[role="textbox"]',
] as const;

const SELECT_ALL = process.platform === "darwin" ? "Meta+A" : "Control+A";

/**
 * Narrower than `copilot_server.js` `ATTACHMENT_PENDING_SELECTORS`: scoped to the composer dock only,
 * and we skip `[aria-busy="true"]` / `*loading*` (false positives on M365 shell). Upload/attach gating
 * still shows a visible `role="progressbar"` or `*progress*` in the input strip.
 */
const ATTACHMENT_PENDING_SELECTORS = ['[role="progressbar"]', '[data-testid*="progress"]'] as const;

/** CDP `Input.dispatchKeyEvent` modifiers (Chromium): Ctrl = 2 — matches `copilot_server.js` `dispatchEnterKey`. */
const CDP_MODIFIER_CTRL = 2;

/* ── Browser setup via CDP ───────────────────────────────────── */

async function connectViaCDP() {
  return await chromium.connectOverCDP(CDP_ENDPOINT);
}

async function findCopilotPage(browser: any) {
  const contexts = browser.contexts();
  for (const ctx of contexts) {
    const pages = ctx.pages();
    for (const page of pages) {
      try {
        const url = page.url();
        if (
          url.includes("m365.cloud.microsoft") ||
          url.includes("copilot.microsoft") ||
          url.includes("copilot.cloud.microsoft")
        ) {
          console.log(`[CDP] Found existing tab: ${url}`);
          return page;
        }
      } catch {
        continue;
      }
    }
  }

  console.log("[CDP] No existing Copilot tab, opening one...");
  const defaultContext = contexts[0] ?? (await browser.newContext());
  const page = await defaultContext.newPage();
  await page.goto(M365_COPILOT_URL, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForTimeout(3_000);
  return page;
}

/* ── Helpers ─────────────────────────────────────────────────── */

async function getBodyLength(page: any): Promise<number> {
  return await page.evaluate(() => document.body.innerText?.length ?? 0);
}

/** Visible string in the M365 chat composer only (not other textboxes). */
async function getM365ComposerText(page: any): Promise<string> {
  return await page.evaluate(() => {
    const root =
      document.querySelector("#m365-chat-editor-target-element") ||
      document.querySelector('[data-lexical-editor="true"]') ||
      document.querySelector('div[role="textbox"][aria-label*="Copilot"]') ||
      document.querySelector('div[role="textbox"][aria-label*="メッセージ"]') ||
      document.querySelector('div[role="textbox"][aria-label*="Send a message"]') ||
      document.querySelector("div[role=\"textbox\"]");
    if (!root) return "";
    return (root.innerText || "").replace(/\u200b/g, "").trim();
  });
}

async function findM365Composer(page: any) {
  for (const sel of M365_COMPOSER_SELECTORS) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 1200 })) return loc;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Align with `copilot_server.js` `focusComposer`: Lexical keeps the real caret in an inner
 * `[contenteditable="true"]`. After a reply, focus often sits on the transcript or chrome;
 * `page.keyboard.press("Enter")` then does not submit. Scroll + click + focus the inner node.
 */
async function focusM365ComposerDeep(page: any): Promise<boolean> {
  return await page.evaluate(() => {
    function vis(el: Element | null): el is HTMLElement {
      return !!el && (el as HTMLElement).offsetParent !== null;
    }
    function bestInner(root: HTMLElement | null): HTMLElement | null {
      if (!root || !vis(root)) return null;
      const inner = root.querySelector<HTMLElement>('[contenteditable="true"]');
      return vis(inner) ? inner : root;
    }
    function labelHints(el: Element): boolean {
      const lab = (
        (el.getAttribute("aria-label") || "") +
        " " +
        (el.getAttribute("placeholder") || "") +
        " " +
        (el.getAttribute("data-placeholder") || "")
      ).toLowerCase();
      if (!lab.trim()) return false;
      return /send a message|copilot|メッセージ|message|reply|返信|compose|prompt|type a message|ask copilot/.test(
        lab,
      );
    }
    const rootSelectors = [
      "#m365-chat-editor-target-element",
      '[data-lexical-editor="true"]',
      '[role="textbox"][aria-label*="メッセージ"]',
      '[role="textbox"][aria-label*="Send a message"]',
      '[role="textbox"][aria-label*="Copilot"]',
    ];
    for (const sel of rootSelectors) {
      const root = document.querySelector(sel) as HTMLElement | null;
      const el = bestInner(root);
      if (el && vis(el)) {
        try {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        } catch {
          /* ignore */
        }
        el.click();
        el.focus();
        return true;
      }
    }
    const labeled = Array.from(document.querySelectorAll('[role="textbox"]')).filter(
      (n): n is HTMLElement => n instanceof HTMLElement && labelHints(n) && vis(n),
    );
    for (const n of labeled) {
      const el = bestInner(n);
      if (el && vis(el)) {
        try {
          el.scrollIntoView({ block: "center", inline: "nearest" });
        } catch {
          /* ignore */
        }
        el.click();
        el.focus();
        return true;
      }
    }
    return false;
  });
}

/**
 * Like `copilot_server.js` `copilotAttachmentStillPending`, but **scoped to the composer dock**
 * (ancestors of `#m365-chat-editor-target-element`). Document-wide `[aria-busy="true"]` and
 * unrelated progressbars stay true for the whole session — that caused false 20s+ waits; real
 * attach/upload spinners for send gating live next to the editor.
 */
async function copilotAttachmentStillPending(page: any): Promise<boolean> {
  return await page.evaluate((sels: readonly string[]) => {
    function vis(el: Element | null): el is HTMLElement {
      return !!el && (el as HTMLElement).offsetParent !== null;
    }
    const start =
      document.querySelector("#m365-chat-editor-target-element") ||
      document.querySelector('[data-lexical-editor="true"]');
    if (!start) return false;
    let root: Element = start;
    for (let i = 0; i < 10 && root.parentElement; i++) root = root.parentElement;
    for (let i = 0; i < sels.length; i++) {
      let els: NodeListOf<Element>;
      try {
        els = root.querySelectorAll(sels[i]);
      } catch {
        continue;
      }
      for (let j = 0; j < els.length; j++) {
        if (vis(els[j]) && root.contains(els[j])) return true;
      }
    }
    return false;
  }, [...ATTACHMENT_PENDING_SELECTORS]);
}

/** Wait until attachment/upload/progress UI is gone so Enter / Send are not ignored (matches server submit gating). */
async function waitForCopilotAttachmentNotBlocking(page: any, timeoutMs: number) {
  const start = Date.now();
  let sawPending = false;
  while (Date.now() - start < timeoutMs) {
    const pending = await copilotAttachmentStillPending(page);
    if (!pending) {
      if (sawPending) console.log("[CDP] attachment/progress UI cleared — proceeding to submit");
      return;
    }
    sawPending = true;
    await page.waitForTimeout(200);
  }
  console.log("[CDP] waitForCopilotAttachmentNotBlocking timed out — submitting anyway");
}

/**
 * Until Copilot enables a primary send control, Enter often does nothing (same as disabled send click).
 * Mirrors `copilot_server.js` `findSendButtonCenter` / compose loop: wait after text is in the composer.
 */
async function m365SendControlLooksClickable(page: any): Promise<boolean> {
  return await page.evaluate(() => {
    function visible(el: Element | null): el is HTMLElement {
      return !!el && (el as HTMLElement).offsetParent !== null;
    }
    function clickable(el: HTMLElement): boolean {
      if (!visible(el)) return false;
      if (el.disabled) return false;
      if (el.getAttribute("aria-disabled") === "true") return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      return true;
    }
    function badLabel(label: string) {
      if (!label) return true;
      return /send feedback|送信する場所|settings|設定|share|共有/i.test(label);
    }
    const bySelector = [
      'button[data-testid="sendButton"]',
      'button[data-testid^="send"]',
      '[data-testid="sendButton"]',
      ".fai-SendButton",
      "button.fai-SendButton",
      'div[role="button"][data-testid="sendButton"]',
    ];
    for (const sel of bySelector) {
      for (const el of document.querySelectorAll(sel)) {
        if (!(el instanceof HTMLElement)) continue;
        if (clickable(el)) return true;
      }
    }
    for (const el of document.querySelectorAll("button, [role='button']")) {
      if (!(el instanceof HTMLElement)) continue;
      const label = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
      if (badLabel(label)) continue;
      if (
        /送信(?!.*フィードバック)/.test(label) ||
        /^send$/i.test(label) ||
        /send message/i.test(label) ||
        (label.includes("Send") && !/sending|sender/i.test(label)) ||
        /^reply$/i.test(label)
      ) {
        if (clickable(el)) return true;
      }
    }
    return false;
  });
}

async function waitForM365SendClickable(page: any, timeoutMs: number) {
  const start = Date.now();
  let sawDisabled = false;
  while (Date.now() - start < timeoutMs) {
    if (await m365SendControlLooksClickable(page)) {
      if (sawDisabled) console.log("[CDP] send control enabled after wait (attach/stream gate)");
      return;
    }
    sawDisabled = true;
    await page.waitForTimeout(200);
  }
  console.log("[CDP] waitForM365SendClickable timed out — submitting anyway");
}

/**
 * Same key sequence as `copilot_server.js` `dispatchEnterKey` / `trySubmitViaEnter` (not Playwright
 * `keyboard.press`, which can miss Lexical after multi-turn when focus routing differs).
 */
async function dispatchEnterViaCdp(page: any, modifiers = 0): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Page.bringToFront").catch(() => {});
    await session.send("Input.enable").catch(() => {});
    for (const type of ["keyDown", "keyUp"] as const) {
      await session.send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        modifiers,
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
    }
  } finally {
    await session.detach().catch(() => {});
  }
}

function m365LexicalInnerComposer(page: any) {
  return page
    .locator(
      '#m365-chat-editor-target-element [contenteditable="true"], [data-lexical-editor="true"] [contenteditable="true"]',
    )
    .first();
}

/**
 * Try several Enter paths so multi-turn matches production CDP behavior; avoids relying on a single
 * Playwright keyboard target.
 */
async function tryEnterStrategies(page: any, input: any) {
  await page.bringToFront().catch(() => {});
  const inner = m365LexicalInnerComposer(page);
  const attempts: Array<{ label: string; run: () => Promise<void> }> = [
    {
      label: "CDP Input.dispatchKeyEvent(Enter)",
      run: () => dispatchEnterViaCdp(page, 0),
    },
    {
      // Raw CDP after `focusComposer` can miss the focused node post-reply; shell click retargets like a user tap.
      label: "CDP Enter after shell click",
      run: async () => {
        await input.click({ timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(120);
        await dispatchEnterViaCdp(page, 0);
      },
    },
    {
      label: "page.keyboard Enter after shell click",
      run: async () => {
        await input.click({ timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(90);
        await page.keyboard.press("Enter");
      },
    },
    {
      label: "inner contenteditable.press(Enter)",
      run: async () => {
        if (!(await inner.isVisible({ timeout: 2_000 }).catch(() => false))) throw new Error("skip");
        await inner.click();
        await page.waitForTimeout(70);
        await inner.press("Enter");
      },
    },
  ];
  let last: unknown;
  for (const { label, run } of attempts) {
    try {
      await focusM365ComposerDeep(page);
      await page.waitForTimeout(115);
      await run();
      await waitForM365ComposerEmpty(page, 7_000);
      console.log(`[CDP] ✅ Sent via Enter (${label})`);
      return;
    } catch (e) {
      last = e;
      console.log(`[CDP] Enter attempt failed: ${label}`);
    }
  }
  throw last;
}

async function tryCtrlEnterStrategies(page: any, input: any) {
  await page.bringToFront().catch(() => {});
  const inner = m365LexicalInnerComposer(page);
  const attempts: Array<{ label: string; run: () => Promise<void> }> = [
    {
      label: "CDP Input.dispatchKeyEvent(Ctrl+Enter)",
      run: () => dispatchEnterViaCdp(page, CDP_MODIFIER_CTRL),
    },
    {
      label: "CDP Ctrl+Enter after shell click",
      run: async () => {
        await input.click({ timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(120);
        await dispatchEnterViaCdp(page, CDP_MODIFIER_CTRL);
      },
    },
    {
      label: "page.keyboard Control+Enter after shell click",
      run: async () => {
        await input.click({ timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(90);
        await page.keyboard.press("Control+Enter");
      },
    },
    {
      label: "inner contenteditable.press(Ctrl+Enter)",
      run: async () => {
        if (!(await inner.isVisible({ timeout: 2_000 }).catch(() => false))) throw new Error("skip");
        await inner.click();
        await page.waitForTimeout(70);
        await inner.press("Control+Enter");
      },
    },
  ];
  let last: unknown;
  for (const { label, run } of attempts) {
    try {
      await focusM365ComposerDeep(page);
      await page.waitForTimeout(115);
      await run();
      await waitForM365ComposerEmpty(page, 6_000);
      console.log(`[CDP] ✅ Sent via Ctrl+Enter (${label})`);
      return;
    } catch (e) {
      last = e;
      console.log(`[CDP] Ctrl+Enter attempt failed: ${label}`);
    }
  }
  throw last;
}

async function waitForM365ComposerEmpty(page: any, timeoutMs: number) {
  await page.waitForFunction(
    () => {
      const root =
        document.querySelector("#m365-chat-editor-target-element") ||
        document.querySelector('[data-lexical-editor="true"]') ||
        document.querySelector('div[role="textbox"][aria-label*="Copilot"]') ||
        document.querySelector('div[role="textbox"][aria-label*="メッセージ"]') ||
        document.querySelector('div[role="textbox"][aria-label*="Send a message"]') ||
        document.querySelector("div[role=\"textbox\"]");
      if (!root) return true;
      const t = (root.innerText || "").replace(/\u200b/g, "").trim();
      return t.length <= 2;
    },
    { timeout: timeoutMs },
  );
}

/** Poll until composer shows typed prefix (Lexical commits async). */
async function waitUntilComposerHasSubstring(page: any, needle: string, maxMs: number) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const t = await getM365ComposerText(page);
    if (needle.length === 0 || t.includes(needle)) return;
    await page.waitForTimeout(65);
  }
}

/** @deprecated Prefer getM365ComposerText — kept for any legacy call sites. */
async function getComposerText(page: any): Promise<string> {
  const t = await getM365ComposerText(page);
  if (t) return t;
  return await page.evaluate(() => {
    const els = document.querySelectorAll(
      'div[role="textbox"], textarea, [contenteditable="true"]'
    );
    for (const el of els) {
      const text = (el as HTMLElement).innerText?.trim();
      if (text && text.length > 0) return text;
    }
    return "";
  });
}

async function countUserMessages(page: any): Promise<number> {
  return await page.evaluate(() => {
    // M365 Copilot shows user messages with specific structure
    // Count distinct user message bubbles in the conversation
    let count = 0;
    // User prompts tend to be short and near the bottom
    const articles = document.querySelectorAll("article, [class*='message'], [data-conversation]");
    for (const article of articles) {
      const text = article.innerText || "";
      // User messages contain the prompt text (short, no copilot markers)
      if (
        text.includes("首都") ||
        text.includes("名所") ||
        text.includes("東京") ||
        text.length < 200
      ) {
        count++;
      }
    }
    return count || 1; // fallback
  });
}

/**
 * Start a new conversation in M365 Copilot.
 * Clicks "New Chat" in the sidebar or navigates to /chat.
 */
async function startNewChat(page: any) {
  console.log("[CDP] Starting new chat...");

  // Method 1: Click "New Chat" in sidebar
  const newChatSelectors = [
    'button[aria-label="New chat"]',
    'button[aria-label="新しいチャット"]',
    'a[href*="/chat"]',
    'button:has-text("New Chat")',
    'button:has-text("新しいチャット")',
    // The "+ / New" button in the sidebar
    'div[role="button"]:has-text("+")',
    'button:has(svg):above(textarea)',
  ];

  for (const sel of newChatSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        console.log(`[CDP] New chat via: ${sel}`);
        await page.waitForTimeout(2000);
        return true;
      }
    } catch {
      continue;
    }
  }

  // Method 2: Navigate to the base chat URL
  console.log("[CDP] No New Chat button found, navigating to /chat...");
  await page.goto(M365_COPILOT_URL, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForTimeout(2000);
  return true;
}

/**
 * Send a prompt to M365 Copilot and verify it was actually sent.
 *
 * Returns true only if:
 * 1. Text was entered in the composer
 * 2. Send button was clicked
 * 3. Composer text cleared (message was actually submitted)
 */
async function sendPrompt(page: any, text: string): Promise<boolean> {
  const input = await findM365Composer(page);
  if (!input) {
    console.log("[CDP] ❌ Could not find M365 composer");
    return false;
  }

  await input.click();
  await page.waitForTimeout(120);
  await page.keyboard.press(SELECT_ALL);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(80);
  try {
    await input.pressSequentially(text, { delay: 10 });
  } catch {
    await page.keyboard.type(text, { delay: 10 });
  }

  const needle = text.substring(0, Math.min(12, text.length));
  await waitUntilComposerHasSubstring(page, needle, 2_500);

  const composedText = await getM365ComposerText(page);
  console.log(`[CDP] Composer text: "${composedText.substring(0, 60)}"`);
  if (!composedText.includes(text.substring(0, Math.min(10, text.length)))) {
    console.log(`[CDP] ❌ Text not properly entered in composer`);
    return false;
  }

  // Match `submitPromptRaw`: focus Lexical inner editor; wait for attach/progress strip, then send enabled (Enter is ignored while disabled).
  await page.bringToFront().catch(() => {});
  const deepOk = await focusM365ComposerDeep(page);
  if (!deepOk) console.log("[CDP] focusM365ComposerDeep failed before submit; relying on locator + keyboard");
  await waitForCopilotAttachmentNotBlocking(page, 8_000);
  await waitForM365SendClickable(page, 15_000);

  const sendSelectors = [
    'button[aria-label="送信"]',
    'button[aria-label="Reply"]',
    'button[aria-label="返信"]',
    'button[aria-label="Send"]',
  ];

  try {
    await tryEnterStrategies(page, input);
    return true;
  } catch {
    console.log("[CDP] Enter strategies exhausted; trying Ctrl+Enter");
  }

  try {
    await tryCtrlEnterStrategies(page, input);
    return true;
  } catch {
    console.log("[CDP] Ctrl+Enter strategies exhausted; clicking send button");
  }

  let sendClicked = false;
  for (const sel of sendSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2500 })) {
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ force: true });
        sendClicked = true;
        console.log(`[CDP] Clicked send: ${sel}`);
        break;
      }
    } catch {
      continue;
    }
  }

  if (!sendClicked) {
    console.log("[CDP] ❌ Could not find send button");
    return false;
  }

  try {
    await waitForM365ComposerEmpty(page, 12_000);
    console.log("[CDP] ✅ Composer cleared after send click");
    return true;
  } catch {
    console.log("[CDP] Send click did not clear; retry Enter");
    try {
      await tryEnterStrategies(page, input);
      console.log("[CDP] ✅ Composer cleared after Enter retry");
      return true;
    } catch {
      const afterText = await getM365ComposerText(page);
      console.log(`[CDP] ❌ Composer still has: "${afterText.substring(0, 60)}"`);
      return false;
    }
  }
}

/**
 * Wait for Copilot generation to complete.
 *
 * Strategy A: "Stop generating" button appears → disappears
 * Strategy B: body text stability (fallback)
 * Strategy C: check for user message count increase + response text
 */
async function waitForGenerationDone(page: any, timeoutMs = 120_000) {
  const start = Date.now();

  // Strategy A: stop button
  const stopSelectors = [
    'button:has-text("生成を停止")',
    'button:has-text("Stop generating")',
    'button:has-text("Stop")',
    'button[aria-label*="Stop generating"]',
    'button[aria-label*="生成を停止"]',
  ];

  for (const sel of stopSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3_000 })) {
        console.log(`[CDP] Streaming detected via: ${sel}`);
        await btn.waitFor({ state: "hidden", timeout: timeoutMs });
        console.log("[CDP] Stop button hidden → generation complete");
        return true;
      }
    } catch {
      continue;
    }
  }

  // Strategy B: body text stability
  console.log("[CDP] No stop button — watching body text stability...");
  let prevLength = await getBodyLength(page);
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(1_000);
    const currLength = await getBodyLength(page);

    if (currLength > prevLength + 30) {
      // Content is growing - streaming is active
      stableCount = 0;
    } else if (currLength === prevLength && currLength > 90) {
      stableCount++;
      if (stableCount >= 2) {
        console.log(`[CDP] Body stable at ${currLength} chars → done`);
        return true;
      }
    }
    prevLength = currLength;
  }

  console.log(`[CDP] Timeout at ${await getBodyLength(page)} chars — assuming done`);
  return false;
}

/* ── Tests ───────────────────────────────────────────────────── */

test.describe.configure({ mode: "serial" });

test.describe("M365 Copilot via CDP", () => {
  let browser: any;
  let page: any;

  test.beforeAll(async () => {
    browser = await connectViaCDP();
    page = await findCopilotPage(browser);
  });

  test("00 — start a new chat", async () => {
    await startNewChat(page);

    // Verify the page loaded
    const url = page.url();
    console.log(`[CDP] After new chat, URL: ${url}`);

    const input = await findM365Composer(page);
    expect(input).not.toBeNull();
    await expect(input!).toBeVisible({ timeout: 10_000 });

    const composerText = await getM365ComposerText(page);
    console.log(`[CDP] Composer text (should be empty): "${composerText}"`);

    await page.screenshot({ path: "test-results/cdp-00-new-chat.png" });
  });

  test("01 — m365.cloud.microsoft/chat is ready", async () => {
    const url = page.url();
    console.log(`[CDP] Current URL: ${url}`);
    expect(url).toBeTruthy();

    const title = await page.title();
    console.log(`[CDP] Page title: ${title}`);
    expect(title).toBeTruthy();

    await page.screenshot({ path: "test-results/cdp-01-chat-ready.png" });
  });

  test("02 — compose area is visible", async () => {
    const input = await findM365Composer(page);
    expect(input).not.toBeNull();
    await expect(input!).toBeVisible();

    await page.screenshot({ path: "test-results/cdp-02-compose.png" });
  });

  test("03 — send a prompt and receive a response", async () => {
    const sent = await sendPrompt(page, "日本の首都はどこですか？一言で答えてください。");
    expect(sent).toBe(true);

    await page.screenshot({ path: "test-results/cdp-03-before-send.png" });

    const completed = await waitForGenerationDone(page);
    expect(completed).toBe(true);

    const finalLength = await getBodyLength(page);
    console.log(`[CDP] After response, body length: ${finalLength}`);
    // One-word answers keep document.body.innerText small (~100–150); rely on send + stream done above.
    expect(finalLength).toBeGreaterThan(40);

    await page.screenshot({ path: "test-results/cdp-03-response.png" });
  });

  test("04 — multi-turn follow-up", async () => {
    const bodyBefore = await getBodyLength(page);
    console.log(`[CDP] Body before follow-up: ${bodyBefore}`);

    const sent = await sendPrompt(page, "その都市の名所を3つ教えて");
    expect(sent).toBe(true);

    const completed = await waitForGenerationDone(page);
    expect(completed).toBe(true);

    const bodyAfter = await getBodyLength(page);
    console.log(`[CDP] After follow-up, body length: ${bodyAfter} (was ${bodyBefore})`);
    // Copilot sometimes answers tersely; require growth, not a fixed char budget.
    expect(bodyAfter).toBeGreaterThan(bodyBefore + 40);

    await page.screenshot({ path: "test-results/cdp-04-followup.png" });
  });

  test("05 — full-page screenshot of conversation", async () => {
    await page.screenshot({
      path: "test-results/cdp-05-full-page.png",
      fullPage: true,
    });
    console.log("[CDP] Full-page screenshot captured!");
  });
});
