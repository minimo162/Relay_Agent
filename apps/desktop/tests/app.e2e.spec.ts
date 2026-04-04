import { test, expect } from "@playwright/test";

/* ── Helpers ─────────────────────────────────────────────── */

const COMPOSER_PLACEHOLDER = "What would you like to do? (type / for commands)";

/** Send a Tauri event from the browser context */
async function emitEvent(page: any, event: string, payload: any) {
  await page.evaluate(
    ({ event, payload }) => {
      const s = (window as any).__RELAY_MOCK__;
      s?.emit(event, payload);
    },
    { event, payload },
  );
}

/** Composer input selector (reusable) */
function composerInput(page: any) {
  return page.locator(`textarea[placeholder='${COMPOSER_PLACEHOLDER}']`);
}

/** Open the page and wait for the Solid app to hydrate */
async function openApp(page: any) {
  await page.goto("/");
  await expect(page.locator("text=Relay Agent v0.1.0")).toBeVisible();
}

/* ── Existing Tests (fixed selectors) ────────────────────── */

test("app shell renders 3-pane layout", async ({ page }) => {
  await openApp(page);
  await expect(page.getByText("Relay Agent", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Servers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Policy" })).toBeVisible();
  await expect(page.locator("text=Relay Agent v0.1.0")).toBeVisible();
});

test("composer input is present and editable", async ({ page }) => {
  await openApp(page);
  await expect(composerInput(page)).toBeVisible();
  await expect(composerInput(page)).toBeEditable();
});

test("typing in composer shows Send button", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("button", { name: "Send" })).not.toBeVisible();
  await composerInput(page).fill("hello");
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 3000 });
});

test("enter key sends message and adds user bubble", async ({ page }) => {
  await openApp(page);
  await composerInput(page).fill("analyze this data");
  await composerInput(page).press("Enter");
  await expect(page.locator("text=analyze this data")).toBeVisible({ timeout: 5000 });
});

test("clicking Send button sends message", async ({ page }) => {
  await openApp(page);
  await composerInput(page).fill("summarize results");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("text=summarize results")).toBeVisible({ timeout: 5000 });
});

test("session appears in sidebar after sending prompt", async ({ page }) => {
  await openApp(page);
  await composerInput(page).fill("test session");
  await composerInput(page).press("Enter");
  await expect(page.getByRole("button", { name: /session-/ })).toBeVisible({ timeout: 5000 });
});

test("context panel tabs are switchable", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Servers" }).click();
  await expect(page.locator("text=No MCP servers connected")).toBeVisible();
  await page.getByRole("button", { name: "Policy" }).click();
  await expect(page.locator("text=policies")).toBeVisible();
  await page.getByRole("button", { name: "Files" }).click();
  // Files tab shows file list or placeholder depending on state
  await expect(page.locator("text=Add File").first()).toBeVisible({ timeout: 2000 }).catch(async () => {
    await expect(page.locator("text=files").first()).toBeVisible();
  });
});

test("settings button is in header", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("button", { name: /Settings/ })).toBeVisible();
});

test("turn_complete event handled without crash", async ({ page }) => {
  await openApp(page);
  await composerInput(page).fill("process workbook");
  await composerInput(page).press("Enter");
  await emitEvent(page, "agent:turn_complete", {
    sessionId: "session-e2e-1",
    stopReason: "end_turn",
    assistantMessage: "Analysis complete.",
    messageCount: 2,
  });
  await expect(composerInput(page)).toBeVisible();
});

test("error event handled gracefully", async ({ page }) => {
  await openApp(page);
  await emitEvent(page, "agent:error", {
    sessionId: "session-e2e-1",
    error: "Something went wrong",
    cancelled: false,
  });
  await expect(composerInput(page)).toBeVisible();
});

test("tool_start event handled", async ({ page }) => {
  await openApp(page);
  await emitEvent(page, "agent:tool_start", {
    sessionId: "session-e2e-1",
    toolUseId: "tool-1",
    toolName: "read_file",
  });
  await expect(composerInput(page)).toBeVisible();
});

test("tool_result event handled", async ({ page }) => {
  await openApp(page);
  await emitEvent(page, "agent:tool_result", {
    sessionId: "session-e2e-1",
    toolUseId: "tool-1",
    toolName: "read_file",
    content: "file contents here",
    isError: false,
  });
  await expect(composerInput(page)).toBeVisible();
});

test("approval_needed event handled", async ({ page }) => {
  await openApp(page);
  await emitEvent(page, "agent:approval_needed", {
    sessionId: "session-e2e-1",
    approvalId: "approval-1",
    toolName: "write_file",
    description: "write_file on /tmp/output.csv",
    target: "/tmp/output.csv",
    input: { path: "/tmp/output.csv", content: "data" },
  });
  await expect(page.locator("text=Approve").first()).toBeVisible();
  await expect(page.locator("text=Reject").first()).toBeVisible();
});

test("dark mode is default", async ({ page }) => {
  await openApp(page);
  const theme = await page.locator("html").getAttribute("data-theme");
  expect(theme).toBe("dark");
});
