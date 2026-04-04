import { test, expect, chromium } from "@playwright/test";

/* ── Constants ────────────────────────────────────────────────── */

const M365_COPILOT_URL = "https://m365.cloud.microsoft/chat";
const CDP_ENDPOINT =
  process.env.CDP_ENDPOINT ?? "http://localhost:9222";

/* ── Browser setup via CDP ───────────────────────────────────── */
// Connect to an already-running Chrome/Chromium with --remote-debugging-port=9222
// Example launch on the host machine:
//   google-chrome --remote-debugging-port=9222 \
//     --user-data-dir=/tmp/m365-copilot-profile \
//     https://m365.cloud.microsoft/chat

async function connectViaCDP() {
  try {
    return await chromium.connectOverCDP(CDP_ENDPOINT);
  } catch (e) {
    throw new Error(
      `Failed to connect to CDP endpoint ${CDP_ENDPOINT}.\n` +
      `Make sure Chrome/Chromium is running with --remote-debugging-port=9222.\n` +
      `Error: ${e}`,
    );
  }
}

/* ── Tests ───────────────────────────────────────────────────── */

test.describe.configure({ mode: "serial" });

test.describe("M365 Copilot via CDP", () => {
  let browser: import("@playwright/test").Browser;

  test.beforeAll(async () => {
    browser = await connectViaCDP();
  });

  test.afterAll(async () => {
    // Don't close the CDP-connected browser — it's the user's Chrome
    // browser.close() would kill their Chrome. Just release context.
  });

  test("01 — m365.cloud.microsoft/chat is open and ready", async () => {
    const page = await browser.newPage();
    await page.goto(M365_COPILOT_URL, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    // Take a screenshot to verify the page loaded
    await page.screenshot({
      path: "test-results/cdp-01-chat-ready.png",
    });

    // Verify we're on the chat page (not redirected to login)
    const url = page.url();
    expect(url).toContain("m365.cloud.microsoft");
    expect(url).not.toContain("login.microsoftonline.com");

    const title = await page.title();
    console.log(`[CDP] Page title: ${title}`);

    await page.close();
  });

  test("02 — compose area is visible", async () => {
    const page = await browser.newPage();
    await page.goto(M365_COPILOT_URL, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    // Wait for compose/prompt area
    // M365 Copilot typically uses a textarea or contenteditable in the compose area
    const composeInput = page.locator(
      'textarea, [contenteditable="true"], [role="textbox"], input[type="text"]',
    );

    // Wait until at least one editable element is visible
    await composeInput.first().waitFor({ state: "visible", timeout: 10_000 });
    await expect(composeInput.first()).toBeVisible();

    await page.screenshot({ path: "test-results/cdp-02-compose.png" });
    await page.close();
  });

  test("03 — send a prompt and receive a response", async () => {
    const page = await browser.newPage();
    await page.goto(M365_COPILOT_URL, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    // Find and fill the prompt input
    const promptInput = page
      .locator('textarea, [contenteditable="true"], [role="textbox"]')
      .first();
    await promptInput.click();
    await promptInput.fill(
      "日本の首都はどこですか？一言で答えてください。",
    );

    // Take a screenshot before sending
    await page.screenshot({
      path: "test-results/cdp-03-before-send.png",
    });

    // Press Enter to send
    await page.keyboard.press("Enter");

    console.log("[CDP] Prompt sent, waiting for response...");

    // Wait for the response to appear — polling for content growth
    await page.waitForFunction(
      () => {
        // Copilot responses appear in article/main content areas
        const articles = document.querySelectorAll(
          "article, [data-test-id], .ac-textRun, main *",
        );
        for (const el of articles) {
          const text = el.textContent || "";
          if (text.length > 30) {
            return true;
          }
        }
        return false;
      },
      { timeout: 60_000, polling: 1000 },
    );

    // Wait a bit more for the full response
    await page.waitForTimeout(5_000);

    await page.screenshot({
      path: "test-results/cdp-03-response.png",
    });

    // Validate response content
    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(100);
    console.log(`[CDP] Response received, body length: ${bodyText?.length}`);

    await page.close();
  });

  test("04 — multi-turn conversation", async () => {
    const page = await browser.newPage();
    await page.goto(M365_COPILOT_URL, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    // Follow-up prompt
    const promptInput = page
      .locator('textarea, [contenteditable="true"], [role="textbox"]')
      .first();
    await promptInput.click();
    await promptInput.fill("その都市の名所を3つ教えて");

    await page.keyboard.press("Enter");

    console.log("[CDP] Follow-up prompt sent, waiting for response...");

    await page.waitForFunction(
      () => {
        const articles = document.querySelectorAll(
          "article, [data-test-id], .ac-textRun, main *",
        );
        for (const el of articles) {
          const text = el.textContent || "";
          if (text.length > 50) return true;
        }
        return false;
      },
      { timeout: 60_000, polling: 1000 },
    );

    await page.waitForTimeout(5_000);
    await page.screenshot({
      path: "test-results/cdp-04-followup-response.png",
    });

    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(200);
    console.log(`[CDP] Follow-up response received, body length: ${bodyText?.length}`);

    await page.close();
  });

  test("05 — screenshot full page layout", async () => {
    const page = await browser.newPage();
    await page.goto(M365_COPILOT_URL, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    await page.screenshot({
      path: "test-results/cdp-05-full-page.png",
      fullPage: true,
    });

    await page.close();
  });
});
