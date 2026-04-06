import { test, expect, chromium, type Page } from "@playwright/test";

const CDP_HTTP =
  process.env.RELAY_WEBVIEW2_CDP_HTTP ?? "http://127.0.0.1:9222";

function pickRelayPage(pages: Page[]) {
  return (
    pages.find(
      (p) =>
        p.url().includes("localhost:1421") || p.url().includes("127.0.0.1:1421"),
    ) ?? pages[0]
  );
}

test.describe("Tauri WebView2 via CDP", () => {
  test.beforeEach(({}, testInfo) => {
    if (process.platform !== "win32") {
      testInfo.skip(true, "WebView2 CDP is Windows-only in this setup");
    }
  });

  test("shell is reachable over CDP", async () => {
    let browser;
    try {
      browser = await chromium.connectOverCDP(CDP_HTTP);
    } catch (e) {
      throw new Error(
        `Could not connect to ${CDP_HTTP}. Start the app with: pnpm run tauri:dev:cdp (ensure port is free). Underlying: ${e}`,
      );
    }

    try {
      const pages = browser.contexts().flatMap((c) => c.pages());
      const page = pickRelayPage(pages);

      if (!page) {
        throw new Error("No page found on CDP endpoint (empty browser?)");
      }

      await expect(page.getByText("Relay Agent", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
