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

async function getBodyLength(page: any): Promise<number> {
  return await page.evaluate(() => document.body.innerText?.length ?? 0);
}

async function sendPrompt(page: any, text: string) {
  const input = await findPromptInput(page);
  if (input) {
    await input.click();
    await input.fill(text);
    await page.keyboard.press("Enter");
    console.log(`[CDP] Sent prompt via .fill + Enter: "${text.substring(0, 40)}..."`);
  } else {
    await page.click("body", { position: { x: 600, y: 700 } });
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    console.log(`[CDP] Sent prompt via fallback: "${text.substring(0, 40)}..."`);
  }
}

/**
 * Detect Copilot generation using the stop button as the signal.
 *
 * M365 Copilot shows a "Stop generating" button while streaming
 * and hides it when done. We watch its visibility:
 *   1. Appears  → streaming started (optional, may happen too fast)
 *   2. Gone     → streaming finished
 *
 * If no stop button appears at all, we fall back to textarea-ready
 * detection (the input becomes interactive again).
 */
async function waitForGenerationDone(page: any, timeoutMs = 120_000) {
  const start = Date.now();

  // ── Strategy A: stop button appearance + disappearance ──
  const stopSelectors = [
    'button:has-text("生成を停止")',
    'button:has-text("Stop generating")',
    'button:has-text("Stop")',
    'button[aria-label*="Stop generating"]',
    'button[aria-label*="生成を停止"]',
    '[class*="stop"] button',
  ];

  // Try detecting stop button within 3s of prompt sent
  let streamDetected = false;
  for (const sel of stopSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3_000 })) {
        streamDetected = true;
        console.log(`[CDP] Streaming detected via stop button: ${sel}`);
        // Now wait for that button to disappear
        await btn.waitFor({ state: "hidden", timeout: timeoutMs });
        console.log(`[CDP] Stop button hidden — generation complete!`);
        return;
      }
    } catch {
      continue;
    }
  }

  if (streamDetected) return;

  // ── Strategy B: textarea becomes interactive again ──
  console.log("[CDP] No stop button — watching for ready input...");
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(1_000);
    const ready = await page.evaluate(() => {
      // Find the compose textarea
      const els = document.querySelectorAll(
        'textarea, div[role="textbox"], [contenteditable="true"]',
      );
      for (const el of els) {
        // Check no aria-busy or disabled state
        const rect = el.getBoundingClientRect();
        if (rect.width > 50) {
          // Has visible width, check no busy state
          const busy = el.getAttribute("aria-busy") === "true";
          const disabled = (el as HTMLElement).getAttribute("data-disabled") === "true";
          if (!busy && !disabled) return true;
        }
      }
      return false;
    });
    if (ready) {
      console.log("[CDP] Input is interactive again — generation complete!");
      return;
    }
  }

  console.log("[CDP] Waiting timed out — assuming done");
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
    await sendPrompt(page, "日本の首都はどこですか？一言で答えてください。");
    await page.screenshot({ path: "test-results/cdp-03-before-send.png" });

    await waitForGenerationDone(page);

    const finalLength = await getBodyLength(page);
    console.log(`[CDP] After response, body length: ${finalLength}`);

    await page.screenshot({ path: "test-results/cdp-03-response.png" });

    // Verify page has meaningful content
    expect(finalLength).toBeGreaterThan(200);
  });

  test("04 — multi-turn follow-up", async () => {
    const bodyBefore = await getBodyLength(page);
    console.log(`[CDP] Body before follow-up: ${bodyBefore}`);

    await sendPrompt(page, "その都市の名所を3つ教えて");

    await waitForGenerationDone(page);

    const bodyAfter = await getBodyLength(page);
    console.log(`[CDP] After follow-up, body length: ${bodyAfter} (was ${bodyBefore})`);

    await page.screenshot({ path: "test-results/cdp-04-followup.png" });

    // Verify page grew compared to before
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
