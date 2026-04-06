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

export default async function globalSetup(_config: FullConfig): Promise<void> {
  loadE2eEnv();

  if (process.env.E2E_SKIP_AUTH_SETUP === "1" || process.env.E2E_SKIP_AUTH_SETUP === "true") {
    console.log("[e2e:auth] E2E_SKIP_AUTH_SETUP set — skipping Microsoft auth refresh.");
    return;
  }

  const email = process.env.M365_COPILOT_EMAIL?.trim() ?? "";
  const password = process.env.M365_COPILOT_PASSWORD?.trim() ?? "";
  const authPath = microsoftAuthStatePath();

  const maxAgeHours = parseIntEnv("E2E_AUTH_MAX_AGE_HOURS", 24);
  const force = process.env.E2E_FORCE_AUTH === "1" || process.env.E2E_FORCE_AUTH === "true";

  if (!force && fs.existsSync(authPath)) {
    const ageMs = Date.now() - fs.statSync(authPath).mtimeMs;
    if (ageMs < maxAgeHours * 3600_000) {
      console.log(`[e2e:auth] Reusing fresh storage state (${authPath}).`);
      return;
    }
  }

  if (!email || !password) {
    console.log(
      "[e2e:auth] No M365_COPILOT_EMAIL / M365_COPILOT_PASSWORD — skipping auth setup (local app tests still run).",
    );
    return;
  }

  const headed =
    process.env.E2E_HEADED === "1" ||
    process.env.E2E_HEADED === "true" ||
    parseIntEnv("E2E_2FA_PAUSE_MS", 0) > 0 ||
    !!(process.env.E2E_2FA_WAIT_FILE?.trim());

  const browser = await chromium.launch({
    headless: !headed,
    channel: process.env.E2E_CHROME_CHANNEL || undefined,
  });

  try {
    const context = await browser.newContext();
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
