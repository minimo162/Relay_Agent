import { test, expect } from "@playwright/test";
import { injectRelayMock } from "./relay-e2e-harness";

async function openApp(page: any) {
  await page.goto("/", { waitUntil: "networkidle", timeout: 15000 });
  await expect(page.getByRole("banner").getByText("Relay Agent", { exact: true })).toBeVisible();
}

test.describe("Diagnostic shell", () => {
  test("does not expose the legacy chat/session product surface", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await openApp(page);

    await expect(page.getByRole("heading", { name: "Provider Gateway Console" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Chats" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Context" })).toHaveCount(0);
    await expect(page.locator(".ra-session-row")).toHaveCount(0);
    await expect(page.locator("[data-ra-approval-card]")).toHaveCount(0);
    await expect(page.locator("[data-ra-composer-textarea]")).toHaveCount(0);
  });

  test("keeps provider checks visible as the main workflow", async ({ page }) => {
    await injectRelayMock(page, { autoComplete: true });
    await openApp(page);

    await expect(page.getByText("pnpm start:opencode-provider-gateway")).toBeVisible();
    await expect(page.getByText("pnpm install:opencode-provider-config -- --workspace /path/to/workspace")).toBeVisible();
    await expect(page.getByText("pnpm smoke:opencode-provider")).toBeVisible();
    await expect(page.getByText("Model id:")).toBeVisible();
  });
});
