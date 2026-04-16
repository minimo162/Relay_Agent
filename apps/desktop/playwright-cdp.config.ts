import { defineConfig } from "@playwright/test";
import { relayCdpEndpointFromEnv } from "./tests/cdp-endpoint";

/* Standalone Playwright config for CDP-connected M365 Copilot E2E tests.
 *
 * IMPORTANT: This config uses connectOverCDP to attach to a running Edge/Chrome
 * instance. You MUST start the browser with --remote-debugging-port (Relay / Playwright live default: **9360** — `CDP_ENDPOINT` で上書き)
 * before running tests. Do NOT use the default `chromium.launch()` path — it creates
 * an isolated profile that has NO M365 session cookies.
 *
 * Memo: the attached browser profile must already be signed in to M365 Copilot;
 * otherwise tests hit login.microsoftonline.com and fail for the wrong reason.
 *
 * Usage:
 *   1. Launch Edge (tests 既定):  e.g. --remote-debugging-port=9360
 *   2. Run tests:    pnpm run test:e2e:m365-cdp   (or: CDP_ENDPOINT=http://127.0.0.1:9360 npx playwright test --config=playwright-cdp.config.ts --project=m365-cdp-chat)
 *
 * Grounding (real Copilot, opt-in): sign in to M365 Copilot in that profile, then
 *   RELAY_GROUNDING_E2E=1 pnpm run test:e2e:copilot-grounding
 * (asserts assistant text does not cite x_size / y_size / bag.length0 absent from tests/fixtures/tetris_grounding.html and tetris.html).
 *
 * Known pitfalls (see docs/COPILOT_E2E_CDP_PITFALLS.md for details):
 *   - Browserbase (browser_navigate) runs in a separate container — cookies are NOT shared
 *     with the Docker-hosted Edge on localhost:9222. Always use connectOverCDP.
 *   - Copilot's input is a Lexical editor (div[role="textbox"]). page.fill() fails.
 *     Use page.keyboard.type() to trigger React synthetic events and enable the send button.
 *   - Session lifetime in headless Docker is ~1-2 hours. Re-run the launch script
 *     and re-authenticate via MFA when tests start redirecting to login.microsoftonline.com.
 */

const CDP_ENDPOINT = relayCdpEndpointFromEnv();

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
