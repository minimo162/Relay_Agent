import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { generateSync } from "otplib";

const COPILOT_URL = process.env.E2E_COPILOT_URL ?? "https://copilot.microsoft.com/";

function totpFromEnv(): string | null {
  const secret = process.env.M365_COPILOT_TOTP_SECRET?.trim();
  if (!secret) return null;
  return generateSync({ secret });
}

async function clickIfVisible(
  page: Page,
  getter: () => ReturnType<Page["getByRole"]>,
  timeout: number,
): Promise<boolean> {
  const el = getter();
  if (await el.isVisible({ timeout }).catch(() => false)) {
    await el.click();
    return true;
  }
  return false;
}

/**
 * Complete M365 / consumer Microsoft sign-in from Copilot “connect account” through
 * email+password, optional TOTP (M365_COPILOT_TOTP_SECRET), optional manual 2FA wait,
 * then persist storage state.
 */
export async function signInMicrosoftViaCopilotUi(
  page: Page,
  email: string,
  password: string,
  options: {
    authStatePath: string;
    /** After password submit: max ms to wait for Copilot (push approval, etc.). */
    postPasswordTimeoutMs: number;
    /** If > 0, take screenshots this often while waiting for post-password flows. */
    twoFaScreenshotIntervalMs: number;
    /** Touch this file (or create it) to continue when E2E_2FA_WAIT_FILE is set. */
    manualContinueFile: string | null;
  },
): Promise<void> {
  await fs.promises.mkdir(path.dirname(options.authStatePath), { recursive: true });

  await page.goto(COPILOT_URL, { waitUntil: "networkidle", timeout: 60_000 });

  await page.getByTestId("sidebar-settings-button").click();
  await page.getByTestId("connect-account-button").click();
  await page.getByTestId("msa-sign-in-button").click();

  const emailBox = page.getByRole("textbox", {
    name: /メール、電話、Skype|Email, phone, or Skype/i,
  });
  await emailBox.click();
  await emailBox.fill(email);
  await page.getByRole("button", { name: /次へ|Next/i }).click();

  await page.waitForTimeout(1500);

  const pwBox = page.getByRole("textbox", { name: /パスワード|Password/i });
  await pwBox.click();
  await pwBox.fill(password);
  await page.getByRole("button", { name: /サインイン|Sign in/i }).click();

  await page.waitForURL(/ProcessAuth|login\.live\.com|login\.microsoftonline\.com|copilot\.microsoft/i, {
    timeout: 30_000,
  });

  const totp = totpFromEnv();
  if (totp) {
    const otpInput = page.locator('input[type="tel"], input[name="otc"], input[inputmode="numeric"]').first();
    if (await otpInput.isVisible({ timeout: 8000 }).catch(() => false)) {
      await otpInput.fill(totp);
      await page.getByRole("button", { name: /確認|Verify|Next|次へ/i }).click().catch(() => {});
    }
  }

  const headed = process.env.E2E_HEADED === "1" || process.env.E2E_HEADED === "true";
  const shotDir = path.join(process.cwd(), "test-results");
  await fs.promises.mkdir(shotDir, { recursive: true });

  const deadline = Date.now() + options.postPasswordTimeoutMs;
  const interval = Math.max(5000, options.twoFaScreenshotIntervalMs || 30_000);
  let shotCount = 0;

  while (Date.now() < deadline) {
    await clickIfVisible(page, () => page.getByRole("button", { name: /はい|Yes/i }), 800);
    await clickIfVisible(
      page,
      () => page.getByRole("button", { name: /copilot\.cloud\.microsoft/i }),
      800,
    );

    const url = page.url();
    if (/copilot\.microsoft\.com/i.test(url) && !/signin|login/i.test(url)) {
      break;
    }

    if (options.manualContinueFile && fs.existsSync(options.manualContinueFile)) {
      break;
    }

    if (headed || process.env.E2E_2FA_SCREENSHOTS === "1") {
      const p = path.join(shotDir, `e2e-2fa-wait-${++shotCount}.png`);
      await page.screenshot({ path: p, fullPage: true }).catch(() => {});
    }

    await page.waitForTimeout(Math.min(interval, deadline - Date.now()));
  }

  await clickIfVisible(page, () => page.getByRole("button", { name: /はい|Yes/i }), 3000);
  await clickIfVisible(
    page,
    () => page.getByRole("button", { name: /copilot\.cloud\.microsoft/i }),
    5000,
  );

  await page.waitForURL(/copilot\.microsoft\.com/, { timeout: options.postPasswordTimeoutMs });
  await page.context().storageState({ path: options.authStatePath });
}
