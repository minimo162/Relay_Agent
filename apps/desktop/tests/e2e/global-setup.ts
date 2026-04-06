import fs from "node:fs";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { loadE2eEnv } from "./load-e2e-env";
import { microsoftAuthStatePath } from "./auth-paths";
import { signInMicrosoftViaCopilotUi } from "./microsoft-sign-in";

function parseIntEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Headed は Linux で DISPLAY が無いと起動に失敗する（SSH など）。 */
function resolveHeadless(): boolean {
  const wantHeaded =
    process.env.E2E_HEADED === "1" ||
    process.env.E2E_HEADED === "true" ||
    parseIntEnv("E2E_2FA_PAUSE_MS", 0) > 0 ||
    !!(process.env.E2E_2FA_WAIT_FILE?.trim());

  if (!wantHeaded) {
    return true;
  }
  if (process.platform === "linux" && !process.env.DISPLAY?.trim()) {
    console.warn(
      "[e2e:auth] Headed mode was requested (E2E_HEADED / E2E_2FA_*), but DISPLAY is unset — using headless. " +
        "For a visible browser: export DISPLAY=:0 or use `xvfb-run -a pnpm test:e2e`.",
    );
    return true;
  }
  return false;
}

async function launchChromiumForAuth(headless: boolean) {
  const channel = process.env.E2E_CHROME_CHANNEL?.trim() || undefined;
  const opts = { headless, channel } as const;
  try {
    return await chromium.launch({ headless: opts.headless, channel: opts.channel });
  } catch (err) {
    if (channel) {
      console.warn(
        `[e2e:auth] Launch with E2E_CHROME_CHANNEL=${channel} failed; retrying bundled Chromium.`,
        err,
      );
      return await chromium.launch({ headless });
    }
    const hint =
      "Install: pnpm exec playwright install chromium\n" +
      "Linux system libs: pnpm exec playwright install-deps (or install --with-deps)";
    throw new Error(`${String(err)}\n[e2e:auth] ${hint}`);
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  loadE2eEnv();

  if (process.env.E2E_SKIP_AUTH_SETUP === "1" || process.env.E2E_SKIP_AUTH_SETUP === "true") {
    console.log("[e2e:auth] E2E_SKIP_AUTH_SETUP set — skipping Microsoft auth refresh.");
    return;
  }

  const email = process.env.M365_COPILOT_EMAIL?.trim() ?? "";
  const password = process.env.M365_COPILOT_PASSWORD?.trim() ?? "";
  const authPath = microsoftAuthStatePath();

  const authSaveRun =
    process.env.E2E_AUTH_SAVE_RUN === "1" || process.env.E2E_AUTH_SAVE_RUN === "true";
  const savedOnly =
    !authSaveRun &&
    (process.env.E2E_AUTH_MODE === "saved-only" ||
      process.env.E2E_USE_SAVED_AUTH_ONLY === "1" ||
      process.env.E2E_USE_SAVED_AUTH_ONLY === "true");

  if (savedOnly) {
    console.log(
      "[e2e:auth] E2E_AUTH_MODE=saved-only (or E2E_USE_SAVED_AUTH_ONLY) — globalSetup はブラウザログインしません。",
    );
    if (fs.existsSync(authPath)) {
      console.log(`[e2e:auth] 既存の storage をテストで利用します: ${authPath}`);
    } else {
      console.warn(
        `[e2e:auth] storage がありません: ${authPath}\n` +
          "  記録: cd apps/desktop && pnpm test:e2e:auth-save（.env.e2e にメール・パスワードが必要）\n" +
          "  または: npx playwright codegen --save-storage=tests/.auth/microsoft-copilot.json …",
      );
    }
    return;
  }

  const maxAgeHours = parseIntEnv("E2E_AUTH_MAX_AGE_HOURS", 24);
  const force = process.env.E2E_FORCE_AUTH === "1" || process.env.E2E_FORCE_AUTH === "true";

  if (!force && !authSaveRun && fs.existsSync(authPath)) {
    const ageMs = Date.now() - fs.statSync(authPath).mtimeMs;
    if (ageMs < maxAgeHours * 3600_000) {
      console.log(`[e2e:auth] Reusing fresh storage state (${authPath}).`);
      return;
    }
  }

  if (authSaveRun && (!email || !password)) {
    throw new Error(
      "[e2e:auth] pnpm test:e2e:auth-save には .env.e2e の M365_COPILOT_EMAIL / M365_COPILOT_PASSWORD が必要です。",
    );
  }

  if (!email || !password) {
    console.log(
      "[e2e:auth] No M365_COPILOT_EMAIL / M365_COPILOT_PASSWORD — skipping auth setup (local app tests still run).",
    );
    return;
  }

  const headless = resolveHeadless();

  const browser = await launchChromiumForAuth(headless);

  try {
    const usePriorStorage = !force && fs.existsSync(authPath);
    if (usePriorStorage) {
      console.log(`[e2e:auth] Prior storage state loaded to detect existing Copilot session (${authPath}).`);
    }
    if (force && fs.existsSync(authPath)) {
      console.log("[e2e:auth] E2E_FORCE_AUTH — starting without prior storage state.");
    }

    const context = await browser.newContext(
      usePriorStorage ? { storageState: authPath } : {},
    );
    const page = await context.newPage();

    const postPasswordTimeoutMs = parseIntEnv("E2E_POST_PASSWORD_TIMEOUT_MS", 300_000);
    const twoFaScreenshotIntervalMs = parseIntEnv("E2E_2FA_SCREENSHOT_INTERVAL_MS", 30_000);
    const manualFile = process.env.E2E_2FA_WAIT_FILE?.trim()
      ? path.resolve(process.cwd(), process.env.E2E_2FA_WAIT_FILE!.trim())
      : null;

    if (manualFile) {
      console.log(
        `[e2e:auth] When 2FA is satisfied, run: touch "${manualFile}" (or create the file).`,
      );
    }

    await signInMicrosoftViaCopilotUi(page, email, password, {
      authStatePath: authPath,
      postPasswordTimeoutMs,
      twoFaScreenshotIntervalMs,
      manualContinueFile: manualFile,
    });

    console.log(`[e2e:auth] Saved Microsoft auth state to ${authPath}`);
  } finally {
    await browser.close();
  }
}
