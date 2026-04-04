import { defineConfig, devices } from "@playwright/test";

/* Standalone Playwright config — no webServer needed.
 * Used for CDP-connected M365 Copilot tests. */

export default defineConfig({
  testDir: "./tests",
  testMatch: "m365-copilot-*.spec.ts",
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  outputDir: "test-results",
});
