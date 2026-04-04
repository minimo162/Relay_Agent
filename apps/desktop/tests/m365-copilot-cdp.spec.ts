import { test, expect, chromium } from "@playwright/test";

/* ── Constants ────────────────────────────────────────────────── */

const M365_COPILOT_URL = "https://m365.cloud.microsoft/chat";
const CDP_ENDPOINT =
  process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222";

/* ── Browser setup via CDP ───────────────────────────────────── */

async function connectViaCDP() {
  return await chromium.connectOverCDP(CDP_ENDPOINT);
}

/**
 * Find an existing tab on the Copilot page, or open a new one.
 */
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
  // After initial prompt the input is in a different spot (follow-up box at bottom)
  const selectors = [
    // follow-up compose area (after first exchange)
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

/** Count visible message bubbles in the conversation */
async function countMessages(page: any): Promise<number> {
  // Copilot wraps each turn in article/section-like elements with meaningful text
  const count = await page.evaluate(() => {
    // Count distinct response paragraphs / content blocks
    const articleEls = document.querySelectorAll("article, [class*='message'], [class*='conversation'] article, [data-test-id*='message']");
    return articleEls.length;
  });
  // Fallback: count sections of substantial text in the body
  if (count === 0) {
    return await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          (node.textContent?.trim()?.length ?? 0) > 100
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
      });
      let n = 0;
      while (walker.nextNode()) n++;
      return n;
    });
  }
  return count;
}

async function sendPrompt(page: any, text: string) {
  const input = await findPromptInput(page);
  if (input) {
    await input.click();
    await input.fill(text);
    await page.waitForTimeout(500); // let the fill register
    await page.keyboard.press("Enter");
    console.log(`[CDP] Sent prompt via .fill + Enter: "${text.substring(0, 40)}..."`);
  } else {
    // Fallback
    await page.click("body", { position: { x: 600, y: 700 } });
    await page.keyboard.type(text);
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    console.log(`[CDP] Sent prompt via fallback: "${text.substring(0, 40)}..."`);
  }
}

/** Wait for any response content to appear on the page */
async function waitForResponse(page: any, timeoutMs = 60_000) {
  await page.waitForFunction(
    () => {
      const body = document.body;
      const text = body.innerText || "";
      return text.length > 50;
    },
    { timeout: timeoutMs, polling: 1000 },
  );
}

/** Wait until a NEW response appears after the prompt */
async function waitForNewResponse(page: any, expectedBodyAfter: number, timeoutMs = 60_000) {
  await page.waitForFunction(
    ({ threshold }) => {
      const body = document.body;
      const text = body.innerText || "";
      return text.length > threshold;
    },
    { timeout: timeoutMs, polling: 1000 },
    { threshold: expectedBodyAfter + 50 }, // require at least 50 more chars
  );
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
    console.log("[CDP] Waiting for response...");

    await waitForResponse(page);
    await page.waitForTimeout(5_000); // extra time for full response

    await page.screenshot({ path: "test-results/cdp-03-response.png" });

    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(100);
    console.log(`[CDP] Response received, body length: ${bodyText?.length}`);
  });

  test("04 — multi-turn follow-up", async () => {
    // Record current body length so we can detect NEW content
    const bodyBefore = await page.evaluate(() => document.body.innerText?.length ?? 0);
    console.log(`[CDP] Body before follow-up: ${bodyBefore}`);

    await sendPrompt(page, "その都市の名所を3つ教えて");

    console.log("[CDP] Waiting for follow-up response...");
    await waitForNewResponse(page, bodyBefore);
    await page.waitForTimeout(5_000);

    await page.screenshot({ path: "test-results/cdp-04-followup.png" });

    const bodyAfter = await page.evaluate(() => document.body.innerText?.length ?? 0);
    console.log(`[CDP] Follow-up response received, body length: ${bodyAfter} (was ${bodyBefore})`);

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
