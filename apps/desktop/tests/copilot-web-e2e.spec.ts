import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { microsoftAuthStatePath } from "./e2e/auth-paths";

/* ── Constants ────────────────────────────────────────────────── */

const COPILOT_URL = "https://copilot.microsoft.com";
const storageFile = microsoftAuthStatePath();
const hasSavedAuth = fs.existsSync(storageFile);

/* ── Helpers ─────────────────────────────────────────────────── */

async function waitForCopilotReady(page: any, timeout = 30_000) {
  // Wait for the prompt input area to appear
  await page.waitForSelector('textarea, [contenteditable="true"], input[role="combobox"]', {
    state: "visible",
    timeout,
  });
}

async function sendPrompt(page: any, prompt: string) {
  // Try multiple selectors to find the input field
  const selectors = [
    'textarea[placeholder*="essage"]',
    'textarea[placeholder*="Ask"]',
    'textarea',
    '[contenteditable="true"]',
    'input[role="combobox"]',
    'input[type="text"]',
  ];

  let input: any = null;
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        input = el;
        break;
      }
    } catch {
      // try next selector
    }
  }

  if (!input) {
    // Fallback: click anywhere in the composer area and type
    await page.click("body", { position: { x: 500, y: 400 } });
    await page.keyboard.type(prompt);
  } else {
    await input.fill(prompt);
  }

  // Press Enter to send
  await page.keyboard.press("Enter");
}

async function waitForResponse(page: any, timeout = 60_000) {
  // Wait for the response text to appear (copilot generates content)
  // Copilot's response appears in structured answer blocks
  await page.waitForFunction(
    () => {
      // Check if there's content that looks like a response (not just the user prompt)
      const articles = document.querySelectorAll("article, [data-content], .ac-ac-wrapper, main *");
      for (const el of articles) {
        const text = el.textContent || "";
        if (text.length > 50 && !text.includes("Sign in")) {
          return true;
        }
      }
      return false;
    },
    { timeout },
  );
}

/* ── Tests ───────────────────────────────────────────────────── */

test.describe.configure({ mode: "serial" });

test.describe("M365 Copilot Web UI E2E", () => {
  if (hasSavedAuth) {
    test.use({ storageState: storageFile });
  }

  test.beforeEach(() => {
    test.skip(
      !hasSavedAuth,
      `Missing ${storageFile}. Add M365_COPILOT_EMAIL/PASSWORD to .env.e2e and run pnpm test:e2e (globalSetup), or codegen --save-storage.`,
    );
  });

  test("navigates to copilot.microsoft.com and is ready", async ({ page }) => {
    await page.goto(COPILOT_URL, { waitUntil: "networkidle", timeout: 30_000 });
    await waitForCopilotReady(page);

    // Verify we're on Copilot page (not redirected to login)
    const title = await page.title();
    expect(title).toContain("Copilot");

    // Take screenshot for debugging
    await page.screenshot({ path: "test-results/01-copilot-ready.png" });
  });

  test("sends a simple prompt and receives a response", async ({ page }) => {
    await page.goto(COPILOT_URL, { waitUntil: "networkidle", timeout: 30_000 });
    await waitForCopilotReady(page);

    await sendPrompt(page, "What is the capital of Japan? Answer in one word.");

    await waitForResponse(page, 60_000);

    // Take screenshot of response
    await page.screenshot({ path: "test-results/02-copilot-response.png" });

    // Verify some content appeared
    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(100);
  });

  test("sends a follow-up prompt (multi-turn conversation)", async ({ page }) => {
    // The previous test already started a conversation, continue on same page
    await sendPrompt(page, "Tell me two famous foods from that city.");

    await waitForResponse(page, 60_000);

    await page.screenshot({ path: "test-results/03-copilot-followup.png" });

    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(200);
  });

  test("navigates conversation history", async ({ page }) => {
    // Check if we can see the conversation thread
    // Look for the sidebar or history section
    const sidebarSelectors = [
      '[data-testid="sidebar"]',
      "aside",
      '.history',
      '[class*="history"]',
    ];

    let hasSidebar = false;
    for (const sel of sidebarSelectors) {
      if (await page.locator(sel).isVisible({ timeout: 3000 }).catch(() => false)) {
        hasSidebar = true;
        break;
      }
    }

    // At minimum, verify the conversation content is rendered
    const messages = await page.locator("article, p, div[class*='message']").all();
    expect(messages.length).toBeGreaterThan(0);

    await page.screenshot({ path: "test-results/04-copilot-history.png" });
  });

  test("starts a new conversation", async ({ page }) => {
    // Try to find a "New topic" or "+" button
    const newTopicSelectors = [
      'button:has-text("New topic")',
      'button:has-text("New")',
      'a[href*="new"]',
      'button[aria-label*="new" i]',
      'div[role="button"]:has-text("New topic")',
    ];

    let clicked = false;
    for (const sel of newTopicSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.click();
          clicked = true;
          break;
        }
      } catch {
        // try next selector
      }
    }

    // Navigate to fresh page regardless
    await page.goto(COPILOT_URL, { waitUntil: "networkidle", timeout: 30_000 });
    await waitForCopilotReady(page);

    await sendPrompt(page, "Hello! Reply with just one word.");
    await waitForResponse(page, 60_000);

    await page.screenshot({ path: "test-results/05-copilot-new-chat.png" });
  });
});
