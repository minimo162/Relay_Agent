import { defineConfig } from "@playwright/test";

/**
 * Attaches to an already-running Tauri app whose WebView2 was started with
 * RELAY_WEBVIEW2_CDP_PORT (see `pnpm run tauri:dev:cdp`).
 *
 * CDP HTTP endpoint: RELAY_WEBVIEW2_CDP_HTTP (default http://127.0.0.1:9222)
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/webview-cdp.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
});
