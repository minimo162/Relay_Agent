import { test, expect } from "@playwright/test";
import { injectRelayMock } from "./relay-e2e-harness";

async function openApp(page: any) {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Ready to start" })).toBeVisible();
}

test.describe("Beginner setup shell", () => {
  test("does not expose the legacy chat/session product surface", async ({ page }) => {
    await injectRelayMock(page);
    await openApp(page);

    await expect(page.getByRole("heading", { name: "Ready to start" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh Setup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Chats" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Context" })).toHaveCount(0);
    await expect(page.locator(".ra-session-row")).toHaveCount(0);
    await expect(page.locator("[data-ra-approval-card]")).toHaveCount(0);
    await expect(page.locator("[data-ra-composer-textarea]")).toHaveCount(0);
  });

  test("keeps provider details behind advanced diagnostics", async ({ page }) => {
    await injectRelayMock(page);
    await openApp(page);

    await expect(page.getByText("pnpm dev")).toHaveCount(0);
    await page.getByText("Advanced diagnostics").click();
    await expect(page.getByText("Model id:")).toBeVisible();
  });
});
