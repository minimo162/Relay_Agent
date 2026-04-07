import { defineConfig, devices } from "@playwright/test";
import { loadE2eEnv } from "./tests/e2e/load-e2e-env";

loadE2eEnv();

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Single preview server + init-script mocks are flaky with multiple workers (idle/footer races).
  // Override locally with `npx playwright test --workers=4` if you need speed and accept risk.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "RELAY_E2E=1 pnpm build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
