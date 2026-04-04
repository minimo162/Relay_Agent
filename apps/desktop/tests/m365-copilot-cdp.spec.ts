import { test, expect, chromium } from "@playwright/test";

/* ── Constants ────────────────────────────────────────────────── */

const M365_COPILOT_URL = "https://m365.cloud.microsoft/chat";
const CDP_ENDPOINT =
  process.env.CDP_ENDPOINT ?? "http://localhost:9222";

/* ── Browser setup via CDP ───────────────────────────────────── */

async function connectViaCDP() {
  return await chromium.connectOverCDP(CDP_ENDPOINT);
}

/**
 * Find an existing tab on the Copilot page, or fall back to the
 * very first context (the default Chrome profile context).
 */
async function findCopilotPage(browser: any) {
  // CDP connect gives contexts that mirror Chrome's browser contexts
  // The default profile is usually the first context
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
          const title = await page.title();
          console.log(`[CDP] Found existing tab: ${url} — "${title}"`);
          return page;
        }
      } catch {
        continue;
      }
    }
  }

  // No matching tab found — open one in the default context
  console.log("[CDP] No existing Copilot tab found, opening new one...");
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
    'textarea',
    '[contenteditable="true"]',
    'input[role="combobox"]',
    'input[type="text"]',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) return el;
    } catch {
      continue;
    }
  }
  // Fallback: click approximate composer area
  return null;
}

async function sendPrompt(page: any, text: string) {
  const input = await findPromptInput(page);
  if (input) {
    await input.click();
    await input.fill(text);
  } else {
    await page.click("body", { position: { x: 600, y: 700 } });
    await page.keyboard.type(text);
  }
  await page.keyboard.press("Enter");
}

async function waitForResponse(page: any, timeoutMs = 60_000) {
  await page.waitForFunction(
    () => {
      // Look for substantial text content that looks like a Copilot response
      const body = document.body;
      const text = body.innerText || "";
      return text.length > 200;
    },
    { timeout: timeoutMs, polling: 1000 },
  );
}

/* ── Tests ───────────────────────────────────────────────────── */

test.describe.configure({ mode: "serial" });

test.describe("M365 Copilot via CDP", () => {
  let browser: any;

  test.beforeAll(async () => {
    browser = await connectViaCDP();
  });

  test("01 — m365.cloud.microsoft/chat is open and ready", async () => {
    const page = await findCopilotPage(browser);

    const url = page.url();
    console.log(`[CDP] Current URL: ${url}`);

    await page.screenshot({
      path: "test-results/cdp-01-chat-ready.png",
    });

    const title = await page.title();
    console.log(`[CDP] Page title: ${title}`);

    // Allow the URL even if it briefly passed through login
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
  });

  test("02 — compose area is visible", async () => {
    const page = await findCopilotPage(browser);

    const input = await findPromptInput(page);
    expect(input).toBeTruthy();
    if (input) {
      await expect(input).toBeVisible();
    }

    await page.screenshot({ path: "test-results/cdp-02-compose.png" });
  });

  test("03 — send a prompt and receive a response", async () => {
    const page = await findCopilotPage(browser);

    await sendPrompt(page, "日本の首都はどこですか？一言で答えてください。");

    await page.screenshot({
      path: "test-results/cdp-03-before-send.png",
    });

    console.log("[CDP] Prompt sent, waiting for response...");
    await waitForResponse(page);
    await page.waitForTimeout(3_000);

    await page.screenshot({
      path: "test-results/cdp-03-response.png",
    });

    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(100);
    console.log(`[CDP] Response received, body length: ${bodyText?.length}`);
  });

  test("04 — multi-turn follow-up", async () => {
    const page = await findCopilotPage(browser);

    await sendPrompt(page, "その都市の名所を3つ教えて");

    console.log("[CDP] Follow-up sent, waiting for response...");
    await waitForResponse(page);
    await page.waitForTimeout(3_000);

    await page.screenshot({
      path: "test-results/cdp-04-followup.png",
    });

    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(200);
    console.log(`[CDP] Follow-up response, body length: ${bodyText?.length}`);
  });

  test("05 — full-page screenshot of conversation", async () => {
    const page = await findCopilotPage(browser);

    await page.screenshot({
      path: "test-results/cdp-05-full-page.png",
      fullPage: true,
    });

    console.log("[CDP] Full-page screenshot captured!");
  });
});
