import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { generateSync } from "otplib";
import {
  announceMicrosoftAuthenticatorMatchNumber,
  readMicrosoftAuthenticatorMatchNumber,
} from "./microsoft-number-match";

function copilotUrl(): string {
  return (process.env.E2E_COPILOT_URL ?? "https://copilot.microsoft.com/").trim() || "https://copilot.microsoft.com/";
}

/** サインインフロー開始時に開く URL（未指定なら E2E_COPILOT_URL）。M365 は https://m365.cloud.microsoft/ など。 */
function authEntryUrl(): string {
  const start = process.env.E2E_AUTH_ENTRY_URL?.trim();
  if (start) return start;
  return copilotUrl();
}

/** ログイン完了後に開きたい URL（未指定なら authEntryUrl）。 */
function postAuthNavigateUrl(): string {
  return process.env.E2E_AUTH_POST_LOGIN_URL?.trim() || authEntryUrl();
}

/** ログイン成功とみなすページの URL にマッチする正規表現（既定: Copilot または M365）。 */
function authSuccessUrlRegex(): RegExp {
  const raw = process.env.E2E_AUTH_SUCCESS_URL_REGEXP?.trim();
  if (raw) {
    try {
      return new RegExp(raw, "i");
    } catch {
      console.warn("[e2e] Invalid E2E_AUTH_SUCCESS_URL_REGEXP — using default Copilot|M365 pattern.");
    }
  }
  return /copilot\.microsoft\.com|m365\.cloud\.microsoft/i;
}

function isAuthProductUrl(u: string): boolean {
  return authSuccessUrlRegex().test(u);
}

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

async function dismissCookieBanners(page: Page): Promise<void> {
  const labels = [
    /Accept all/i,
    /^Accept$/i,
    /同意/i,
    /^OK$/i,
    /Got it/i,
    /了解/i,
    /Reject all/i,
  ];
  for (const name of labels) {
    await page
      .getByRole("button", { name })
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
  }
}

/** Copilot / M365 等でチャット入力が使え、明確な Sign in CTA が無い＝既にサインイン済みとみなす */
export async function isAuthSessionReady(page: Page): Promise<boolean> {
  const u = page.url();
  if (!isAuthProductUrl(u)) return false;
  if (/signin|login|oauth/i.test(u)) return false;

  const signIn = page
    .getByRole("button", { name: /^Sign in$/i })
    .or(page.getByRole("link", { name: /^Sign in$/i }));
  const signInShown = await signIn.first().isVisible({ timeout: 2500 }).catch(() => false);

  const composer = page
    .locator(
      'textarea, [contenteditable="true"][aria-multiline="true"], div[role="textbox"]',
    )
    .first();
  const composerShown = await composer.isVisible({ timeout: 12_000 }).catch(() => false);

  if (signInShown && !composerShown) return false;
  if (composerShown && !signInShown) return true;
  if (composerShown) return true;

  await page.waitForTimeout(2000);
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  if (/Sign in to continue|Sign in with Microsoft|サインインして続行/i.test(body)) {
    return false;
  }

  return await composer.isVisible({ timeout: 5000 }).catch(() => false);
}

/** @deprecated 互換エイリアス — isAuthSessionReady と同じ */
export async function isCopilotSessionReady(page: Page): Promise<boolean> {
  return isAuthSessionReady(page);
}

async function tryOpenSignInFromAccountMenu(page: Page): Promise<boolean> {
  const triggerSelectors = [
    '[aria-label*="Account" i]',
    '[aria-label*="アカウント" i]',
    '[aria-label*="Sign in" i]',
    '[aria-label*="profile" i]',
    '[aria-label*="Profile" i]',
    'button[class*="user" i]',
    "header button[type=\"button\"]",
  ];
  for (const sel of triggerSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(600);
      const signIn = page
        .getByRole("menuitem", { name: /Sign in|サインイン|ログイン/i })
        .or(page.getByRole("link", { name: /Sign in|サインイン/i }))
        .or(page.getByRole("button", { name: /Sign in|サインイン/i }));
      if (await signIn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await signIn.first().click();
        return true;
      }
    }
  }
  return false;
}

async function tryClickSignInOnCopilot(page: Page): Promise<boolean> {
  const attempts: Array<() => Promise<void>> = [
    async () => {
      await page.locator('a[href*="login.live.com" i], a[href*="login.microsoftonline.com" i]').first().click({
        timeout: 10_000,
      });
    },
    async () => {
      await page.locator('a[href*="login" i], a[href*="signin" i]').first().click({ timeout: 10_000 });
    },
    async () => {
      await page.getByRole("button", { name: /^Sign in$/i }).first().click({ timeout: 10_000 });
    },
    async () => {
      await page.getByRole("link", { name: /^Sign in$/i }).first().click({ timeout: 10_000 });
    },
    async () => {
      await page.getByRole("button", { name: /Sign in to Copilot|Sign in with Microsoft/i }).first().click({
        timeout: 10_000,
      });
    },
    async () => {
      await page.getByText(/^Sign in$/i).first().click({ timeout: 10_000 });
    },
    async () => {
      await page.getByRole("button", { name: /サインイン/i }).first().click({ timeout: 10_000 });
    },
    async () => {
      await page.getByRole("link", { name: /サインイン/i }).first().click({ timeout: 10_000 });
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

async function openConsumerLoginLive(page: Page): Promise<void> {
  const candidates = [
    process.env.E2E_LOGIN_LIVE_FALLBACK_URL?.trim(),
    "https://login.live.com/",
    "https://account.live.com/",
  ].filter((u): u is string => !!u);

  const emailHint = page.getByRole("textbox", {
    name: /メール、電話、Skype|Email, phone, or Skype|電子メール|メールアドレス|Email or phone/i,
  });
  const emailLoose = page.locator('input[type="email"], input[name="loginfmt"], input#i0116').first();

  for (const url of candidates) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2000);
    if (await emailHint.isVisible({ timeout: 12_000 }).catch(() => false)) {
      return;
    }
    if (await emailLoose.isVisible({ timeout: 12_000 }).catch(() => false)) {
      return;
    }
  }

  throw new Error(
    "[e2e] login.live.com を開いてもメール入力欄が見つかりません。E2E_MICROSOFT_LOGIN_URL にブラウザでコピーしたサインイン URL を設定してください。",
  );
}

function isMicrosoftLoginHost(u: string): boolean {
  return /login\.(microsoftonline|live)\.com|signup\.live\.com/i.test(u);
}

async function navigateToCopilotEntry(page: Page): Promise<void> {
  const custom = process.env.E2E_MICROSOFT_LOGIN_URL?.trim();
  if (custom) {
    await page.goto(custom, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2000);
    await dismissCookieBanners(page);
    return;
  }

  await page.goto(authEntryUrl(), { waitUntil: "domcontentloaded", timeout: 90_000 });
  try {
    await page.waitForLoadState("networkidle", { timeout: 45_000 });
  } catch {
    /* SPA は networkidle しないことがある */
  }
  await page.waitForTimeout(3000);
  await dismissCookieBanners(page);
}

/** Copilot 上から Microsoft ログインへ（既に login.* なら何もしない） */
async function proceedFromCopilotLandingToMicrosoftLogin(page: Page): Promise<void> {
  if (isMicrosoftLoginHost(page.url())) {
    return;
  }

  let clicked = await tryClickSignInOnCopilot(page);
  if (!clicked) {
    clicked = await tryOpenSignInFromAccountMenu(page);
  }

  if (clicked) {
    await page.waitForURL(/login\.(microsoftonline|live)\.com|signup\.live\.com/i, { timeout: 90_000 });
    return;
  }

  console.warn(
    "[e2e] Copilot 上で Sign in が見つかりません。login.live.com 系に直接遷移します（E2E_MICROSOFT_LOGIN_URL で上書き可能）。",
  );
  await openConsumerLoginLive(page);
}

/**
 * Microsoft ログインページへ遷移する。
 * 優先: E2E_MICROSOFT_LOGIN_URL → Copilot で Sign in → アカウントメニュー → login.live.com 系フォールバック。
 */
export async function openMicrosoftLoginFromCopilot(page: Page): Promise<void> {
  await navigateToCopilotEntry(page);
  if (!isMicrosoftLoginHost(page.url())) {
    await proceedFromCopilotLandingToMicrosoftLogin(page);
  }
}

async function saveStorageState(page: Page, authStatePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(authStatePath), { recursive: true });
  await page.context().storageState({ path: authStatePath });
}

/**
 * Copilot → Microsoft サインイン（メール/パスワード、任意 TOTP、番号照合の検出と通知）→ storage 保存。
 * 既に Copilot にサインイン済みならメール/パスワードはスキップする。
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

  await navigateToCopilotEntry(page);

  if (isAuthProductUrl(page.url()) && !isMicrosoftLoginHost(page.url())) {
    if (await isAuthSessionReady(page)) {
      console.log(
        "[e2e] 対象アプリは既にサインイン済みのため、ログイン手順をスキップして storage を保存します。",
      );
      await saveStorageState(page, options.authStatePath);
      return;
    }
  }

  if (!isMicrosoftLoginHost(page.url())) {
    await proceedFromCopilotLandingToMicrosoftLogin(page);
  }

  if (isAuthProductUrl(page.url()) && !isMicrosoftLoginHost(page.url())) {
    if (await isAuthSessionReady(page)) {
      console.log(
        "[e2e] 対象アプリは既にサインイン済みのため、ログイン手順をスキップして storage を保存します。",
      );
      await saveStorageState(page, options.authStatePath);
      return;
    }
  }

  if (!isMicrosoftLoginHost(page.url())) {
    throw new Error(
      "[e2e] Microsoft ログインページに到達できず、対象アプリも未サインインです。E2E_MICROSOFT_LOGIN_URL / E2E_AUTH_ENTRY_URL / E2E_HEADED=1 を確認してください。",
    );
  }

  await page
    .getByRole("link", { name: /Use another account|別のアカウント/i })
    .click({ timeout: 4000 })
    .catch(() => {});

  const emailBox = page
    .getByRole("textbox", {
      name: /メール、電話、Skype|Email, phone, or Skype|電子メール|メールアドレス|Email or phone/i,
    })
    .or(page.locator('input[name="loginfmt"], input#i0116, input[type="email"]').first());

  await emailBox.click({ timeout: 30_000 });
  await emailBox.fill(email);
  await page.getByRole("button", { name: /次へ|Next/i }).click();

  await page.waitForTimeout(1500);

  const pwBox = page
    .getByRole("textbox", { name: /パスワード|Password/i })
    .or(page.locator('input[name="passwd"], input#i0118, input[type="password"]').first());

  await pwBox.click({ timeout: 30_000 });
  await pwBox.fill(password);
  await page.getByRole("button", { name: /サインイン|Sign in/i }).click();

  await page.waitForURL(
    /ProcessAuth|login\.live\.com|login\.microsoftonline\.com|copilot\.microsoft|m365\.cloud\.microsoft/i,
    {
      timeout: 45_000,
    },
  );

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

    const u = page.url();
    if (isAuthProductUrl(u) && !isMicrosoftLoginHost(u)) {
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

  const successRe = authSuccessUrlRegex();
  if (!successRe.test(page.url())) {
    await page.goto(postAuthNavigateUrl(), { waitUntil: "domcontentloaded", timeout: 90_000 });
  }

  await page.waitForURL(successRe, { timeout: options.postPasswordTimeoutMs });
  await saveStorageState(page, options.authStatePath);
}
