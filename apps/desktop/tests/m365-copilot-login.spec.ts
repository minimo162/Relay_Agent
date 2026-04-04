import { test, expect } from "@playwright/test";

/* ── Constants ────────────────────────────────────────────────── */

const COPILOT_URL = "https://copilot.microsoft.com/";
const TEST_EMAIL =
  process.env.M365_COPILOT_EMAIL ?? "yuukikod@ralleti.onmicrosoft.com";
const TEST_PASSWORD = process.env.M365_COPILOT_PASSWORD ?? "";

/* ── Tests ───────────────────────────────────────────────────── */

test.describe("M365 Copilot — Browser Login & Chat", () => {
  test("login to M365 Copilot via MSA sign-in", async ({ page }) => {
    test.skip(!TEST_PASSWORD, "M365_COPILOT_PASSWORD env is not set");

    await page.goto(COPILOT_URL, { waitUntil: "networkidle" });

    // Open settings → connect account → MSA sign-in
    await page.getByTestId("sidebar-settings-button").click();
    await page.getByTestId("connect-account-button").click();
    await page.getByTestId("msa-sign-in-button").click();

    // ── Step 1: Email ──
    const emailBox = page.getByRole("textbox", {
      name: "メール、電話、Skype を入力します。",
    });
    await emailBox.click();
    await emailBox.fill(TEST_EMAIL);
    await page.getByRole("button", { name: "次へ" }).click();

    // await for password screen
    // The password field is a masked textbox
    await page.waitForTimeout(2000);

    // ── Step 2: Password ──
    const pwBox = page.getByRole("textbox", { name: "パスワード" });
    await pwBox.click();
    await pwBox.fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "サインイン" }).click();

    // ── Step 3: MFA / Keep-signed-in / Consent ──
    // May hit /common/SAS/ProcessAuth — wait for it
    await page.waitForURL(/ProcessAuth|login.live\.com|copilot\.microsoft/, {
      timeout: 15_000,
    });

    // "はい" (Yes, stay signed in?)
    const haiBtn = page.getByRole("button", { name: "はい" });
    if (await haiBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await haiBtn.click();
    }

    // Consent screen for copilot.cloud.microsoft
    const consentBtn = page.getByRole("button", { name: "copilot.cloud.microsoft" });
    if (await consentBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await consentBtn.click();
    }

    // ── Verify: land on Copilot main page ──
    await page.waitForURL(/copilot\.microsoft\.com/, { timeout: 15_000 });
    await expect(page).toHaveURL(/copilot\.microsoft\.com/);

    // Save auth state for subsequent tests
    await page.context().storageState({
      path: "tests/auth.json",
    });

    // Screenshot
    await page.screenshot({ path: "test-results/m365-login-success.png" });

    const title = await page.title();
    expect(title).toMatch(/copilot/i);
  });

  test("send a prompt and receive a response (auth required)", async ({
    page,
  }) => {
    test.skip(!TEST_PASSWORD, "M365_COPILOT_PASSWORD env is not set");

    // Login first
    await page.goto(COPILOT_URL, { waitUntil: "networkidle" });
    await page.getByTestId("sidebar-settings-button").click();
    await page.getByTestId("connect-account-button").click();
    await page.getByTestId("msa-sign-in-button").click();

    await page
      .getByRole("textbox", { name: "メール、電話、Skype を入力します。" })
      .fill(TEST_EMAIL);
    await page.getByRole("button", { name: "次へ" }).click();
    await page.waitForTimeout(2000);

    await page.getByRole("textbox", { name: "パスワード" }).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "サインイン" }).click();

    await page.waitForTimeout(3_000);
    const haiBtn = page.getByRole("button", { name: "はい" });
    if (await haiBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await haiBtn.click();
    }
    const consentBtn = page.getByRole("button", { name: "copilot.cloud.microsoft" });
    if (await consentBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await consentBtn.click();
    }

    await page.waitForURL(/copilot\.microsoft\.com/, { timeout: 15_000 });

    // ── Send a prompt ──
    // Find the prompt input (varies by layout)
    const promptInput = page.locator(
      'textarea, [contenteditable="true"], input[role="combobox"]',
    );
    await page.waitForTimeout(2_000);
    const visibleInput = promptInput.first();
    await visibleInput.click();
    await visibleInput.fill("What is the capital of Japan? One word answer.");
    await page.keyboard.press("Enter");

    // Wait for response to appear
    await page.waitForTimeout(30_000);
    await page.screenshot({ path: "test-results/m365-copilot-response.png" });

    // Basic check: body content should be substantial
    const bodyText = await page.textContent("body");
    expect(bodyText?.length).toBeGreaterThan(100);
  });
});
