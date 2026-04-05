import { defineConfig, devices } from "@playwright/test";

/* Standalone Playwright config — CDP connection to Edge/M365 Copilot. */

export default defineConfig({
  testDir: "./tests",
  testMatch: "m365-copilot-capabilities.spec.ts",
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: ["list", "json"],
  outputDir: "test-results",
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  globalSetup: require.resolve("./tests/m365-capabilities-setup.ts"),
  projects: [
    {
      name: "cdp-edge",
      use: {
        ...devices["Desktop Chrome"],
        // CDP connection mode
        connectOptions: {
          wsEndpoint: process.env.CDP_WS_ENDPOINT || "ws://127.0.0.1:9222/devtools/browser/",
        },
      },
    },
  ],
});
