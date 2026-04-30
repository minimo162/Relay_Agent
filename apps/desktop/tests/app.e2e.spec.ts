import { test, expect } from "@playwright/test";
import { injectRelayMock } from "./relay-e2e-harness";

async function openApp(page: any) {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await expect(page.getByRole("heading", { name: "OpenWork/OpenCode Setup" })).toBeVisible();
}

test("desktop opens as an OpenWork/OpenCode setup diagnostic console", async ({ page }) => {
  await injectRelayMock(page);
  await openApp(page);

  await expect(page.getByRole("heading", { name: "OpenWork/OpenCode Setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open OpenWork/OpenCode" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh Setup" })).toBeVisible();
  await expect(page.getByText("OpenCode/OpenWork", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "http://127.0.0.1:18180/v1" })).toBeVisible();
  await expect(page.getByText("pnpm dev")).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reconnect Copilot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
});

test("diagnostics panel reads provider bridge status", async ({ page }) => {
  await injectRelayMock(page);
  await openApp(page);

  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/architecture:/)).toBeVisible();
  await expect(page.getByText(/OpenCode runtime:/)).toBeVisible();
  await expect(page.getByText(/bridge running:/)).toBeVisible();
});

test("settings remain available for provider diagnostics", async ({ page }) => {
  await injectRelayMock(page);
  await openApp(page);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Step 1 · Project/)).toBeVisible();
  await expect(dialog.getByText("Step 2 · Copilot")).toBeVisible();
  const advanced = dialog.locator("details.ra-settings-details");
  await advanced.locator("summary").click();
  await expect(dialog.getByRole("button", { name: "Export diagnostics" })).toBeVisible();
});
