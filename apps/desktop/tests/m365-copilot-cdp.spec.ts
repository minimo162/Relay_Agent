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

/* ── Compose helpers ─────────────────────────────────────────── */

async function getBodyLength(page: any): Promise<number> {
  return await page.evaluate(() => document.body.innerText?.length ?? 0);
}

/**
 * Get the text content of the composer/prompt box.
 * Useful for verifying text was entered.
 */
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

/**
 * Find and click the send/reply button.
 * M365 Copilot's send button is near the composer area, usually
 * a send icon (paper plane / arrow) button.
 *
 * We find buttons near the bottom-right of the viewport and
 * click the one that has the send icon.
 */
async function clickSendButton(page: any) {
  // Strategy 1: aria-label based
  const ariaSelectors = [
    'button[aria-label="Reply"]',
    'button[aria-label="返信"]',
    'button[aria-label="Send"]',
    'button[aria-label="送信"]',
    // The send button might have a tooltip
    '[title="Reply"]',
    '[title="Send"]',
  ];
  for (const sel of ariaSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        const rect = await btn.boundingBox();
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ force: true, timeout: 3000 });
        console.log(`[CDP] ✅ Sent via aria-label: ${sel} (x=${Math.round(rect?.x)}, y=${Math.round(rect?.y)})`);
        return true;
      }
    } catch {
      continue;
    }
  }

  // Strategy 2: look for SVG send/paper-plane icon
  try {
    // The send button typically contains a path that looks like an airplane/arrow
    const svgButtons = await page.locator("button svg").all();
    for (const svg of svgButtons) {
      const btn = svg.locator(".."); // parent <button>
      try {
        await btn.waitFor({ state: "visible", timeout: 500 });
        const isEnabled = await btn.isEnabled({ timeout: 500 }).catch(() => false);
        if (isEnabled) {
          await btn.scrollIntoViewIfNeeded();
          await btn.click({ force: true });
          console.log("[CDP] ✅ Sent via SVG button click");
          return true;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // no SVG buttons found
  }

  // Strategy 3: dispatch a submit event on the form
  try {
    const formSubmitted = await page.evaluate(() => {
      // Try to find a form and submit it
      const forms = document.querySelectorAll("form");
      for (const form of forms) {
        const submitters = form.querySelectorAll('button[type="submit"], [role="button"]');
        for (const btn of submitters) {
          (btn as HTMLElement).click();
          return true;
        }
      }

      // Try the M365 Copilot specific: look for the send button by class
      const sendBtn = document.querySelector(
        'button[class*="send"], button[class*="submit"], [class*="composer"] button'
      ) as HTMLElement;
      if (sendBtn) {
        sendBtn.click();
        return true;
      }

      // Last resort: dispatch keyboard event on the textbox
      const textbox = document.querySelector(
        'div[role="textbox"], [contenteditable="true"]'
      ) as HTMLElement;
      if (textbox) {
        textbox.focus();
        textbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
        textbox.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", ctrlKey: true, bubbles: true }));
        return true;
      }
      return false;
    });
    if (formSubmitted) {
      console.log("[CDP] ✅ Sent via JS dispatch");
      return true;
    }
  } catch (e) {
    console.log(`[CDP] ❌ JS dispatch failed: ${e}`);
  }

  console.log("[CDP] ❌ Could not find send button!");
  return false;
}

/**
 * Send a prompt to M365 Copilot.
 * 1. Fill the text in the composer
 * 2. Click the send button
 * 3. Verify the text disappeared from the composer (i.e., it was sent)
 */
async function sendPrompt(page: any, text: string) {
  const selectors = [
    'div[role="textbox"]',
    'textarea',
    '[contenteditable="true"]',
    'input[role="combobox"]',
  ];

  let input = null;
  for (const sel of selectors) {
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

  // Fill the prompt
  await input.click();
  await input.fill(text);
  await page.waitForTimeout(500);

  // Verify text was entered
  const composerText = await getComposerText(page);
  console.log(`[CDP] Composer text before send: "${composerText.substring(0, 50)}..."`);

  // Click send
  await clickSendButton(page);

  // Wait for composer to clear (indicates the message was sent)
  try {
    await page.waitForFunction(
      () => {
        const els = document.querySelectorAll(
          'div[role="textbox"], [contenteditable="true"]'
        );
        for (const el of els) {
          const text = (el as HTMLElement).innerText?.trim();
          if (text && text.length > 0) return false; // still has text
        }
        return true; // all clear
      },
      { timeout: 5_000 }
    );
    console.log("[CDP] ✅ Composer cleared — prompt sent!");
    return true;
  } catch {
    const afterText = await getComposerText(page);
    console.log(`[CDP] ⚠️ Composer still has: "${afterText.substring(0, 50)}..."`);
    return false;
  }
}

/**
 * Wait for Copilot generation to complete.
 *
 * Strategy A: "Stop generating" button appears then disappears
 * Strategy B: body text length stability
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
        console.log(`[CDP] Stop button hidden → generation complete`);
        return;
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

    if (currLength > prevLength + 20) {
      stableCount = 0; // still growing
    } else if (currLength === prevLength && currLength > 200) {
      stableCount++;
      if (stableCount >= 2) {
        console.log(`[CDP] Body stable at ${currLength} chars → done`);
        return;
      }
    }
    prevLength = currLength;
  }

  console.log(`[CDP] Timeout at ${await getBodyLength(page)} chars — assuming done`);
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

  test("01 — m365.cloud.microsoft/chat is open and ready", async () => {
    const url = page.url();
    console.log(`[CDP] Current URL: ${url}`);
    expect(url).toBeTruthy();

    const title = await page.title();
    console.log(`[CDP] Page title: ${title}`);
    expect(title).toBeTruthy();

    await page.screenshot({ path: "test-results/cdp-01-chat-ready.png" });
  });

  test("02 — compose area is visible", async () => {
    const text = await getComposerText(page);
    console.log(`[CDP] Composer text (should not be stuck): "${text.substring(0, 80)}"`);

    const input = page.locator('div[role="textbox"], textarea, [contenteditable="true"]').first();
    await expect(input).toBeVisible();

    await page.screenshot({ path: "test-results/cdp-02-compose.png" });
  });

  test("03 — send a prompt and receive a response", async () => {
    const ok = await sendPrompt(page, "日本の首都はどこですか？一言で答えてください。");
    expect(ok).toBe(true);
    await page.screenshot({ path: "test-results/cdp-03-before-send.png" });

    await waitForGenerationDone(page);

    const finalLength = await getBodyLength(page);
    console.log(`[CDP] After response, body length: ${finalLength}`);
    expect(finalLength).toBeGreaterThan(200);

    await page.screenshot({ path: "test-results/cdp-03-response.png" });
  });

  test("04 — multi-turn follow-up", async () => {
    const bodyBefore = await getBodyLength(page);
    console.log(`[CDP] Body before follow-up: ${bodyBefore}`);

    const ok = await sendPrompt(page, "その都市の名所を3つ教えて");
    expect(ok).toBe(true);

    await waitForGenerationDone(page);

    const bodyAfter = await getBodyLength(page);
    console.log(`[CDP] After follow-up, body length: ${bodyAfter} (was ${bodyBefore})`);
    expect(bodyAfter).toBeGreaterThan(bodyBefore);

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
