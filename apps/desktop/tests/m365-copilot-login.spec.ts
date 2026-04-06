import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { microsoftAuthStatePath } from "./e2e/auth-paths";
import { signInMicrosoftViaCopilotUi } from "./e2e/microsoft-sign-in";

const COPILOT_URL = process.env.E2E_COPILOT_URL ?? "https://copilot.microsoft.com/";
const TEST_EMAIL = process.env.M365_COPILOT_EMAIL?.trim() ?? "";
const TEST_PASSWORD = process.env.M365_COPILOT_PASSWORD?.trim() ?? "";
const AUTH_FILE = microsoftAuthStatePath();

function parseIntEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

test.describe("M365 Copilot — Browser Login & Chat", () => {
  test.describe.configure({ mode: "serial" });

  test("sign-in via UI saves storage state (when credentials are set)", async ({ page }) => {
    test.skip(!TEST_PASSWORD || !TEST_EMAIL, "Set M365_COPILOT_EMAIL and M365_COPILOT_PASSWORD (e.g. in .env.e2e)");
    const hasSavedAuth = fs.existsSync(AUTH_FILE);
    test.skip(
      hasSavedAuth && process.env.E2E_RUN_BROWSER_LOGIN_SPEC !== "1",
      `Auth exists at ${AUTH_FILE}; set E2E_RUN_BROWSER_LOGIN_SPEC=1 to re-run browser login from this spec`,
    );

    const base = parseIntEnv("E2E_POST_PASSWORD_TIMEOUT_MS", 300_000);
    const pause = parseIntEnv("E2E_2FA_PAUSE_MS", 0);
    const postPasswordTimeoutMs = Math.max(base, pause || 0);
    const manualFile = process.env.E2E_2FA_WAIT_FILE?.trim()
      ? `${process.cwd()}/${process.env.E2E_2FA_WAIT_FILE!.trim()}`
      : null;

    await signInMicrosoftViaCopilotUi(page, TEST_EMAIL, TEST_PASSWORD, {
      authStatePath: AUTH_FILE,
      postPasswordTimeoutMs,
      twoFaScreenshotIntervalMs: parseIntEnv("E2E_2FA_SCREENSHOT_INTERVAL_MS", 30_000),
      manualContinueFile: manualFile,
    });

    await expect(page).toHaveURL(/copilot\.microsoft\.com/);
    const title = await page.title();
    expect(title).toMatch(/copilot/i);
    await page.screenshot({ path: "test-results/m365-login-success.png" });
  });

  test("send a prompt with saved session", async ({ browser }) => {
    test.skip(!fs.existsSync(AUTH_FILE), `Missing ${AUTH_FILE}. Use .env.e2e + globalSetup, or run the sign-in test first.`);

    const context = await browser.newContext({ storageState: AUTH_FILE });
    const page = await context.newPage();
    try {
      await page.goto(COPILOT_URL, { waitUntil: "networkidle" });

      const promptInput = page.locator(
        'textarea, [contenteditable="true"], input[role="combobox"]',
      );
      await page.waitForTimeout(2000);
      const visibleInput = promptInput.first();
      await visibleInput.click();
      await visibleInput.fill("What is the capital of Japan? One word answer.");
      await page.keyboard.press("Enter");

      await page.waitForTimeout(30_000);
      await page.screenshot({ path: "test-results/m365-copilot-response.png" });

      const bodyText = await page.textContent("body");
      expect(bodyText?.length).toBeGreaterThan(100);
    } finally {
      await context.close();
    }
  });
});
