import { defineConfig } from "@playwright/test";

/* Standalone Playwright config for CDP-connected M365 Copilot E2E tests.
 *
 * IMPORTANT: This config uses connectOverCDP to attach to a running Edge/Chrome
 * instance. You MUST start the browser with --remote-debugging-port (Relay 既定: 9333)
 * before running tests. Do NOT use the default `chromium.launch()` path — it creates
 * an isolated profile that has NO M365 session cookies.
 *
 * Memo: the attached browser profile must already be signed in to M365 Copilot;
 * otherwise tests hit login.microsoftonline.com and fail for the wrong reason.
 *
 * Usage:
 *   1. Launch Edge (Relay 既定):  e.g. --remote-debugging-port=9333
 *   2. Run tests:    CDP_ENDPOINT=http://127.0.0.1:9333 npx playwright test --config=playwright-cdp.config.ts
 *
 * Known pitfalls (see docs/COPILOT_E2E_CDP_PITFALLS.md for details):
 *   - Browserbase (browser_navigate) runs in a separate container — cookies are NOT shared
 *     with the Docker-hosted Edge on localhost:9222. Always use connectOverCDP.
 *   - Copilot's input is a Lexical editor (div[role="textbox"]). page.fill() fails.
 *     Use page.keyboard.type() to trigger React synthetic events and enable the send button.
 *   - Session lifetime in headless Docker is ~1-2 hours. Re-run the launch script
 *     and re-authenticate via MFA when tests start redirecting to login.microsoftonline.com.
 */

const CDP_ENDPOINT =
  process.env.CDP_ENDPOINT || "http://127.0.0.1:9333";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 180_000,         // default per-test timeout (Copilot AI responses can take 30-60 s)
  use: {
    trace: "on-first-retry",
    video: "retain-on-failure",
    navigationTimeout: 120_000,
    actionTimeout: 60_000,
  },
  outputDir: "test-results-cdp",

  projects: [
    {
      name: "cdp-connect",
      testMatch: "**/m365-copilot-capabilities-v2.spec.ts",
      use: {
        connectOverCDP: {
          endpointURL: CDP_ENDPOINT,
        },
      },
    },
    /** Self-contained: tests call `chromium.connectOverCDP` in `beforeAll` (same endpoint). */
    {
      name: "m365-cdp-chat",
      testMatch: "**/m365-copilot-cdp.spec.ts",
    },
  ],
});
