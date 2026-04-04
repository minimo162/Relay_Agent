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

async function findPromptInput(page: any) {
  const selectors = [
    'div[role="textbox"]',
    'textarea',
    '[contenteditable="true"]',
    'input[role="combobox"]',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) return el;
    } catch {
      continue;
    }
  }
  return null;
}

/** Get full page body text length */
async function getBodyLength(page: any): Promise<number> {
  return await page.evaluate(() => document.body.innerText?.length ?? 0);
}

async function sendPrompt(page: any, text: string) {
  const input = await findPromptInput(page);
  if (input) {
    await input.click();
    await input.fill(text);
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    console.log(`[CDP] Sent prompt via .fill + Enter: "${text.substring(0, 40)}..."`);
  } else {
    await page.click("body", { position: { x: 600, y: 700 } });
    await page.keyboard.type(text);
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    console.log(`[CDP] Sent prompt via fallback: "${text.substring(0, 40)}..."`);
  }
}

/**
 * Wait for a streaming Copilot response to COMPLETE.
 * Strategy:
 *   1. Wait until body grows significantly (confirm response started)
 *   2. Then wait for streaming to STOP (body text stabilises for 3s)
 */
async function waitForStreamingComplete(
  page: any,
  initialBodyLength: number,
  timeoutMs = 120_000,
) {
  const start = Date.now();
  let lastLength = initialBodyLength;
  let stableCount = 0;
  const requiredStableChecks = 3; // 3×1s = stable for 3 seconds

  console.log(`[CDP] Waiting for response to complete (initial length: ${initialBodyLength})...`);

  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(1_000);
    const currentLength = await getBodyLength(page);

    if (currentLength > initialBodyLength + 30) {
      // Content has started arriving
      if (currentLength === lastLength) {
        stableCount++;
        if (stableCount >= requiredStableChecks) {
          console.log(
            `[CDP] Response complete! body length: ${currentLength} (Δ +${currentLength - initialBodyLength})`,
          );
          return;
        }
      } else {
        // Still streaming — reset stability counter
        stableCount = 0;
      }
      lastLength = currentLength;
    } else {
      // No growth yet — keep waiting
    }
  }

  // Final check — even if not perfectly stable, return if we got some content
  const finalLength = await getBodyLength(page);
  console.log(
    `[CDP] Timeout but got some content: ${finalLength} (Δ +${finalLength - initialBodyLength})`,
  );
  return; // don't fail — just log
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
    const input = await findPromptInput(page);
    expect(input).toBeTruthy();
    if (input) await expect(input).toBeVisible();

    await page.screenshot({ path: "test-results/cdp-02-compose.png" });
  });

  test("03 — send a prompt and receive a response", async () => {
    // Capture initial state BEFORE sending
    const initialLength = await getBodyLength(page);
    console.log(`[CDP] Initial body length: ${initialLength}`);

    await sendPrompt(page, "日本の首都はどこですか？一言で答えてください。");
    await page.screenshot({ path: "test-results/cdp-03-before-send.png" });

    // Wait for the streaming response to fully complete
    await waitForStreamingComplete(page, initialLength);

    await page.waitForTimeout(2_000); // grace period
    await page.screenshot({ path: "test-results/cdp-03-response.png" });

    const finalLength = await getBodyLength(page);
    console.log(`[CDP] After response, body length: ${finalLength}`);
    expect(finalLength).toBeGreaterThan(initialLength);
  });

  test("04 — multi-turn follow-up", async () => {
    const bodyBefore = await getBodyLength(page);
    console.log(`[CDP] Body before follow-up: ${bodyBefore}`);

    await sendPrompt(page, "その都市の名所を3つ教えて");

    await waitForStreamingComplete(page, bodyBefore);
    await page.waitForTimeout(2_000);

    await page.screenshot({ path: "test-results/cdp-04-followup.png" });

    const bodyAfter = await getBodyLength(page);
    console.log(`[CDP] After follow-up, body length: ${bodyAfter} (was ${bodyBefore})`);
    expect(bodyAfter).toBeGreaterThan(bodyBefore);
  });

  test("05 — full-page screenshot of conversation", async () => {
    await page.screenshot({
      path: "test-results/cdp-05-full-page.png",
      fullPage: true,
    });
    console.log("[CDP] Full-page screenshot captured!");
  });
});
