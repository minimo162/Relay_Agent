import { test, expect } from "@playwright/test";

/* ── Helpers ─────────────────────────────────────────────── */

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

/** Open the page and wait for the Solid app to hydrate */
async function openApp(page: any) {
  await page.goto("/");
  // Wait for the shell to render (status bar is a reliable anchor)
  await expect(page.locator("text=Relay Agent v0.1.0")).toBeVisible();
}

/* ── Tests ───────────────────────────────────────────────── */

test("app shell renders 3-pane layout", async ({ page }) => {
  await openApp(page);

  // Header
  await expect(page.getByText("Relay Agent", { exact: true })).toBeVisible();

  // Sidebar
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

  // Context panel tabs
  await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Servers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Policy" })).toBeVisible();

  // Status bar
  await expect(page.locator("text=Relay Agent v0.1.0")).toBeVisible();
});

test("composer input is present and editable", async ({ page }) => {
  await openApp(page);
  const textarea = page.locator("textarea[placeholder='What would you like to do?']");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEditable();
});

test("typing in composer shows Send button", async ({ page }) => {
  await openApp(page);
  const textarea = page.locator("textarea[placeholder='What would you like to do?']");
  await expect(page.locator("text=Send")).not.toBeVisible();

  await textarea.fill("hello");
  await expect(page.locator("text=Send")).toBeVisible({ timeout: 3000 });
});

test("enter key sends message and adds user bubble", async ({ page }) => {
  await openApp(page);
  const textarea = page.locator("textarea[placeholder='What would you like to do?']");
  await textarea.fill("analyze this data");
  await textarea.press("Enter");

  // User message should appear in the feed
  await expect(page.locator("text=analyze this data")).toBeVisible({ timeout: 5000 });
});

test("clicking Send button sends message", async ({ page }) => {
  await openApp(page);
  const textarea = page.locator("textarea[placeholder='What would you like to do?']");
  await textarea.fill("summarize results");
  await page.locator("text=Send").click();

  await expect(page.locator("text=summarize results")).toBeVisible({ timeout: 5000 });
});

test("session appears in sidebar after sending prompt", async ({ page }) => {
  await openApp(page);
  const textarea = page.locator("textarea[placeholder='What would you like to do?']");
  await textarea.fill("test session");
  await textarea.press("Enter");

  // A new session pill should appear in the sidebar
  // A new session pill should appear in the sidebar
  // Session IDs are truncated to 8 chars + ellipsis: "session-…" for "session-e2e-1"
  await expect(page.getByRole("button", { name: /session-…$/ })).toBeVisible({ timeout: 5000 });
});

test("context panel tabs are switchable", async ({ page }) => {
  await openApp(page);

  await page.locator("text=Servers").click();
  await expect(page.locator("text=No MCP servers connected")).toBeVisible();

  await page.locator("text=Policy").click();
  await expect(page.locator("text=No active policies")).toBeVisible();

  await page.locator("text=Files").click();
  await expect(page.locator("text=Drop files or open picker")).toBeVisible();
});

test("settings button is in header", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("text=⚙ Settings")).toBeVisible();
});

test("turn_complete event handled without crash", async ({ page }) => {
  await openApp(page);
  const textarea = page.locator("textarea[placeholder='What would you like to do?']");
  await textarea.fill("process workbook");
  await textarea.press("Enter");

  // Simulate agent completing the turn
  await emitEvent(page, "agent:turn_complete", {
    sessionId: "session-e2e-1",
    stopReason: "end_turn",
    assistantMessage: "Analysis complete: 42 rows processed successfully.",
    messageCount: 2,
  });

  // App should still be functional (no crash)
  await expect(page.locator("textarea")).toBeVisible();
});

test("error event handled gracefully", async ({ page }) => {
  await openApp(page);
  await emitEvent(page, "agent:error", {
    sessionId: "session-e2e-1",
    error: "Something went wrong",
    cancelled: false,
  });

  // App should still be visible
  await expect(page.locator("textarea")).toBeVisible();
});

test("tool_start event handled", async ({ page }) => {
  await openApp(page);
  await emitEvent(page, "agent:tool_start", {
    sessionId: "session-e2e-1",
    toolUseId: "tool-1",
    toolName: "read_file",
  });

  await expect(page.locator("textarea")).toBeVisible();
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

  await expect(page.locator("textarea")).toBeVisible();
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

  // ApprovalOverlay should render
  await expect(page.locator("text=Tool: write_file")).toBeVisible({ timeout: 3000 });
  // Fallback: check if ANY text containing "write_file" is visible
  if (!(await page.locator("text=Tool: write_file").isVisible().catch(() => false))) {
    const pageText = await page.textContent("body");
    console.log("Page body text:", pageText?.substring(0, 500));
  }
  await expect(page.locator("text=Approve")).toBeVisible();
  await expect(page.locator("text=Reject")).toBeVisible();
});

test("dark mode is default", async ({ page }) => {
  await openApp(page);
  // The data-theme attribute should be set to "dark"
  const html = page.locator("html");
  const theme = await html.getAttribute("data-theme");
  expect(theme).toBe("dark");
});
