import { test, expect } from "@playwright/test";
import { injectRelayMock } from "./relay-e2e-harness";

async function openApp(page: any) {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Ready to start" })).toBeVisible();
}

test("desktop opens as a beginner OpenWork/OpenCode launcher", async ({ page }) => {
  await injectRelayMock(page);
  await openApp(page);

  await expect(page.getByRole("heading", { name: "Ready to start" })).toBeVisible();
  await expect(page.getByText("Setup progress")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /OpenWork\/OpenCode setup is 100% complete/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open OpenWork/OpenCode" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh Setup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What happens next" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "If setup stops" })).toBeVisible();
  await expect(page.getByText("http://127.0.0.1:18180/v1")).toBeHidden();
  await expect(page.getByText("pnpm dev")).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reconnect Copilot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
});

test("desktop shows live OpenWork/OpenCode download progress", async ({ page }) => {
  await injectRelayMock(page, {
    openworkSetup: {
      status: "preparing",
      stage: "download_openwork_opencode",
      message: "Downloading and verifying OpenWork/OpenCode.",
      progressPercent: 42,
      progressDetail: "Downloading OpenWork: 21.0 MB of 50.0 MB.",
      actionLabel: null,
      launchLabel: null,
    },
  });

  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15000 });

  await expect(page.getByRole("heading", { name: "Setting things up" })).toBeVisible();
  await expect(page.locator(".ra-setup-progress__current")).toHaveText("Get OpenWork/OpenCode");
  await expect(page.getByText("Downloading OpenWork: 21.0 MB of 50.0 MB.")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /OpenWork\/OpenCode setup is 42% complete/ })).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
});

test("advanced diagnostics panel reads provider bridge status", async ({ page }) => {
  await injectRelayMock(page);
  await openApp(page);

  await page.getByText("Advanced diagnostics").click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/architecture:/)).toBeVisible();
  await expect(page.getByText(/OpenCode runtime:/)).toBeVisible();
  await expect(page.getByText(/bridge running:/)).toBeVisible();
  await expect(page.getByText(/setup detail:/)).toBeVisible();
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
