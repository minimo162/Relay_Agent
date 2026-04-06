import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { generateSync } from "otplib";
import {
  announceMicrosoftAuthenticatorMatchNumber,
  readMicrosoftAuthenticatorMatchNumber,
} from "./microsoft-number-match";

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

async function tryClickSignInOnCopilot(page: Page): Promise<boolean> {
  const attempts: Array<() => Promise<void>> = [
    async () => {
      await page.getByRole("button", { name: /^Sign in$/i }).first().click({ timeout: 6000 });
    },
    async () => {
      await page.getByRole("link", { name: /Sign in/i }).first().click({ timeout: 6000 });
    },
    async () => {
      await page.getByRole("button", { name: /サインイン/i }).first().click({ timeout: 6000 });
    },
    async () => {
      await page.getByRole("link", { name: /サインイン/i }).first().click({ timeout: 6000 });
    },
    async () => {
      await page.locator('a[href*="login"], a[href*="signin"]').first().click({ timeout: 6000 });
    },
    async () => {
      await page.getByTestId("sidebar-settings-button").click({ timeout: 5000 });
      await page.getByTestId("connect-account-button").click({ timeout: 5000 });
      await page.getByTestId("msa-sign-in-button").click({ timeout: 5000 });
    },
  ];

  for (const run of attempts) {
    try {
      await run();
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/** Copilot から Microsoft ログインページへ遷移する（既にログイン画面なら何もしない）。 */
export async function openMicrosoftLoginFromCopilot(page: Page): Promise<void> {
  await page.goto(COPILOT_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(2000);

  if (/login\.(microsoftonline|live)\.com|signup\.live\.com/i.test(page.url())) {
    return;
  }

  const clicked = await tryClickSignInOnCopilot(page);
  if (!clicked) {
    throw new Error(
      "[e2e] Copilot 上でサインインを開始できませんでした。E2E_HEADED=1 で画面を確認するか、E2E_COPILOT_URL を調整してください。",
    );
  }

  await page.waitForURL(/login\.(microsoftonline|live)\.com|signup\.live\.com/, {
    timeout: 60_000,
  });
}

/**
 * Copilot → Microsoft サインイン（メール/パスワード、任意 TOTP、番号照合の検出と通知）→ storage 保存。
 */
export async function signInMicrosoftViaCopilotUi(
  page: Page,
  email: string,
  password: string,
  options: {
    authStatePath: string;
    postPasswordTimeoutMs: number;
    twoFaScreenshotIntervalMs: number;
    manualContinueFile: string | null;
  },
): Promise<void> {
  await fs.promises.mkdir(path.dirname(options.authStatePath), { recursive: true });

  await openMicrosoftLoginFromCopilot(page);

  await page
    .getByRole("link", { name: /Use another account|別のアカウント/i })
    .click({ timeout: 4000 })
    .catch(() => {});

  const emailBox = page.getByRole("textbox", {
    name: /メール、電話、Skype|Email, phone, or Skype|電子メール|メールアドレス/i,
  });
  await emailBox.click({ timeout: 30_000 });
  await emailBox.fill(email);
  await page.getByRole("button", { name: /次へ|Next/i }).click();

  await page.waitForTimeout(1500);

  const pwBox = page.getByRole("textbox", { name: /パスワード|Password/i });
  await pwBox.click({ timeout: 30_000 });
  await pwBox.fill(password);
  await page.getByRole("button", { name: /サインイン|Sign in/i }).click();

  await page.waitForURL(/ProcessAuth|login\.live\.com|login\.microsoftonline\.com|copilot\.microsoft/i, {
    timeout: 45_000,
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
  const shotEveryMs = Math.max(5000, options.twoFaScreenshotIntervalMs || 30_000);
  const tickMs = 2000;
  let shotCount = 0;
  let msSinceShot = 0;

  while (Date.now() < deadline) {
    await clickIfVisible(page, () => page.getByRole("button", { name: /はい|Yes/i }), 800);
    await clickIfVisible(
      page,
      () => page.getByRole("button", { name: /copilot\.cloud\.microsoft/i }),
      800,
    );

    const code = await readMicrosoftAuthenticatorMatchNumber(page);
    if (code) {
      await announceMicrosoftAuthenticatorMatchNumber(code, shotDir);
    }

    const url = page.url();
    if (/copilot\.microsoft\.com/i.test(url) && !/signin|login/i.test(url)) {
      break;
    }

    if (options.manualContinueFile && fs.existsSync(options.manualContinueFile)) {
      break;
    }

    msSinceShot += tickMs;
    if (msSinceShot >= shotEveryMs) {
      msSinceShot = 0;
      if (headed || process.env.E2E_2FA_SCREENSHOTS === "1") {
        const p = path.join(shotDir, `e2e-2fa-wait-${++shotCount}.png`);
        await page.screenshot({ path: p, fullPage: true }).catch(() => {});
      }
    }

    await page.waitForTimeout(Math.min(tickMs, deadline - Date.now()));
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
