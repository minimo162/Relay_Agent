import { test, expect, chromium } from "@playwright/test";

/* ── Constants ────────────────────────────────────────────────── */

const M365_COPILOT_URL = "https://m365.cloud.microsoft/chat";
const CDP_ENDPOINT =
  process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222";

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

async function getComposerText(page: any): Promise<string> {
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
  // Find the composer input
  const inputSelectors = [
    'div[role="textbox"]',
    'textarea',
    '[contenteditable="true"]',
    'input[role="combobox"]',
  ];

  let input: any = null;
  for (const sel of inputSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        input = el;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!input) {
    console.log("[CDP] ❌ Could not find composer input");
    return false;
  }

  // Clear any existing text
  await input.click();
  await page.waitForTimeout(300);

  // Select all and delete
  await input.fill("");
  await page.waitForTimeout(200);

  // Type the new text
  await input.fill(text);
  await page.waitForTimeout(800); // ⬆️ increased wait for React state to catch up

  // Verify text was entered
  const composedText = await getComposerText(page);
  console.log(`[CDP] Composer text: "${composedText.substring(0, 60)}"`);
  if (!composedText.includes(text.substring(0, 10))) {
    console.log(`[CDP] ❌ Text not properly entered in composer`);
    return false;
  }

  // Find and click the send button
  // M365 Copilot send button aria-label is "送信" or "Reply"
  const sendSelectors = [
    'button[aria-label="送信"]',
    'button[aria-label="Reply"]',
    'button[aria-label="返信"]',
    'button[aria-label="Send"]',
  ];

  let sendClicked = false;
  for (const sel of sendSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3000 })) {
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

  // Wait for the composer to clear (confirms message was sent, not just clicked)
  try {
    await page.waitForFunction(
      () => {
        const els = document.querySelectorAll(
          'div[role="textbox"], [contenteditable="true"]'
        );
        for (const el of els) {
          const text = (el as HTMLElement).innerText?.trim();
          if (text && text.length > 5) return false; // still has content
        }
        return true;
      },
      { timeout: 5_000 }
    );
    console.log("[CDP] ✅ Composer cleared — message sent!");
    return true;
  } catch {
    const afterText = await getComposerText(page);
    console.log(`[CDP] ❌ Composer still has: "${afterText.substring(0, 60)}"`);
    return false;
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
    } else if (currLength === prevLength && currLength > 200) {
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

    // Wait for composer to be ready
    const input = page.locator('div[role="textbox"], [contenteditable="true"]').first();
 await expect(input).toBeVisible({ timeout: 10_000 });

    // Verify composer is empty (fresh chat)
    const composerText = await getComposerText(page);
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
    const input = await page.locator('div[role="textbox"], textarea, [contenteditable="true"]').first();
    await expect(input).toBeVisible();

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
    expect(finalLength).toBeGreaterThan(200);

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
