import { defineConfig } from "@playwright/test";
import { loadE2eEnv } from "./tests/e2e/load-e2e-env";

loadE2eEnv();

/**
 * ブラウザで Microsoft にログインし `tests/.auth/microsoft-copilot.json` だけ更新する。
 * Vite / アプリの webServer は起動しない。
 *
 *   E2E_AUTH_SAVE_RUN=1 pnpm exec playwright test -c playwright.auth-save.config.ts
 *   または pnpm test:e2e:auth-save
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/auth-save.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
});
