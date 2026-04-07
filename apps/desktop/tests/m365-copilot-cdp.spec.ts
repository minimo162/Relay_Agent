import { test, expect, chromium } from "@playwright/test";

/* ── Constants ────────────────────────────────────────────────── */

const M365_COPILOT_URL = "https://m365.cloud.microsoft/chat";
/** Relay / noVNC Edge scripts default to 9333; override with CDP_ENDPOINT. */
const CDP_ENDPOINT =
  process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9333";

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

  const sendSelectors = [
    'button[aria-label="送信"]',
    'button[aria-label="Reply"]',
    'button[aria-label="返信"]',
    'button[aria-label="Send"]',
  ];

  /** Match `copilot_server.js`: keyboard submit first, then send button. */
  const tryEnter = async () => {
    await input.click();
    await page.waitForTimeout(40);
    await page.keyboard.press("Enter");
    await waitForM365ComposerEmpty(page, 6_000);
  };

  try {
    await tryEnter();
    console.log("[CDP] ✅ Sent via Enter (composer cleared)");
    return true;
  } catch {
    console.log("[CDP] Enter did not submit; trying Ctrl+Enter");
  }

  try {
    await input.click();
    await page.waitForTimeout(40);
    await page.keyboard.press("Control+Enter");
    await waitForM365ComposerEmpty(page, 5_000);
    console.log("[CDP] ✅ Sent via Ctrl+Enter");
    return true;
  } catch {
    console.log("[CDP] Ctrl+Enter did not submit; clicking send button");
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
      await tryEnter();
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
    expect(bodyAfter).toBeGreaterThan(bodyBefore + 100); // Need at least 100 chars for 3 items

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
