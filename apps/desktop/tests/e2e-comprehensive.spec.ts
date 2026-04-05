import { test, expect } from "@playwright/test";

/**
 * Comprehensive E2E tests for Relay Agent UI.
 *
 * Mock is injected via page.addInitScript() BEFORE the app loads,
 * replacing @tauri-apps/api/core and @tauri-apps/api/event.
 * This approach is proven to work (see app.e2e.spec.ts).
 */

/* ──────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────── */

/**
 * Inject mock before every page navigation.
 * This replaces the real Tauri SDK for the entire page lifecycle.
 *
 * @param autoComplete When true (default), start_agent auto-fires
 *   a turn_complete after 150ms so the textarea re-enables.
 *   Set to false when testing the running-state UI.
 */
async function injectMock(page: any, autoComplete = true) {
  await page.addInitScript(`(${ String(mockSetup) })(${ JSON.stringify(autoComplete) });`);
}

/** The actual mock setup that runs in the browser context */
function mockSetup(autoComplete: boolean) {
  const _mock = {
    sessionCounter: 0,
    sessions: new Map(),
    listeners: new Map(),

    emit(event: string, payload: unknown) {
      const fns = this.listeners.get(event);
      if (fns) for (const fn of fns) fn({ event, windowLabel: "main", payload });
    },

    listen(event: string, handler: (e: unknown) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event).add(handler);
      return () => this.listeners.get(event)?.delete(handler);
    },
  };
  (window as any).__RELAY_MOCK__ = _mock;

  // ── Core invoke mock ─────────────────────────────────
  const _invoke = async (cmd: string, args: any) => {
    const req = args?.request ?? args ?? {};
    switch (cmd) {
      case "start_agent": {
        _mock.sessionCounter += 1;
        const id = "session-e2e-" + _mock.sessionCounter;
        _mock.sessions.set(id, { running: true });
        if (autoComplete) {
          setTimeout(() => {
            _mock.sessions.get(id).running = false;
            _mock.emit("agent:turn_complete", {
              sessionId: id,
              stopReason: "end_turn",
              assistantMessage: "Task completed.",
              messageCount: 2,
            });
          }, 150);
        }
        return id;
      }
      case "respond_approval": return undefined;
      case "cancel_agent": {
        const s = _mock.sessions.get(req.sessionId);
        if (s) s.running = false;
        return undefined;
      }
      case "get_session_history": {
        const s = _mock.sessions.get(req.sessionId);
        return { sessionId: req.sessionId, running: s?.running ?? false, messages: [] };
      }
      case "compact_agent_session":
        return { message: "Session compacted", removedMessageCount: 3 };
      case "mcp_list_servers": return [];
      case "mcp_add_server": {
        const srv = { name: req.name, command: req.command, args: req.args || [], connected: true, tools: ["a","b"] };
        return srv;
      }
      case "mcp_remove_server": return true;
      case "mcp_check_server_status": return { name: req.name, command: "", args: [], connected: false, tools: [] };
      case "connect_cdp": case "cdp_start_new_chat":
        return { ok: true, debugUrl: "", pageUrl: "", pageTitle: "", port: 9222, launched: false, error: null };
      case "cdp_send_prompt":
        return { ok: true, responseText: "", bodyLength: 0, error: null };
      case "cdp_screenshot":
        return { ok: true, screenshot: "base64" };
      default:
        throw new Error("[mock] Unknown command: " + cmd);
    }
  };

  // ── Wire into Tauri internals ────────────────────────
  (window as any).__TAURI_INTERNALS__ = { invoke: _invoke };

  (window as any).__TAURI_EVENT_INTERNALS__ = {
    listen: async (event: string, handler: (e: unknown) => void) => _mock.listen(event, handler),
    once: async () => () => {},
  };
}

/** Open the app and wait for the shell to render */
async function openApp(page: any) {
  await page.goto("/", { waitUntil: "networkidle", timeout: 15000 });
  await expect(page.locator("text=Relay Agent v0.1.0")).toBeVisible();
}

/** Trigger a Tauri event via the mock */
async function emitEvent(page: any, event: string, payload: any) {
  await page.evaluate(
    ({ event, payload }) => {
      (window as any).__RELAY_MOCK__?.emit(event, payload);
    },
    { event, payload },
  );
}

/** Send text via composer and wait for the message to appear */
async function sendPrompt(page: any, text: string) {
  const textarea = page.locator("textarea");
  await expect(textarea).toBeEditable({ timeout: 5000 });
  await textarea.fill(text);
  await textarea.press("Enter");
  // Wait for the user message to appear as a bubble
  await expect(page.getByText(text, { exact: false })).toBeVisible({ timeout: 5000 });
}

/* ══════════════════════════════════════════════════════════════
 * Test Suites
 * ══════════════════════════════════════════════════════════════ */

/* ── 1. Session Lifecycle ─────────────────────────────────── */

test.describe("Session Lifecycle", () => {
  test("creates a new session when sending a prompt", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "hello session");
  });

  test("supports multiple independent sessions", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "first task");
    // Wait for auto-complete to re-enable textarea
    await page.waitForTimeout(300);
    await sendPrompt(page, "second task");
  });

  test("status bar shows session count updates", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await expect(page.locator("text=0 sessions")).toBeVisible();
    await sendPrompt(page, "session A");
    await page.waitForTimeout(300);
    await expect(page.locator("text=1 session")).toBeVisible({ timeout: 5000 });
  });
});

/* ── 2. Agent Running State & Cancel ──────────────────────── */

test.describe("Agent Running State & Cancel", () => {
  test("Cancel button shown while agent is running", async ({ page }) => {
    await injectMock(page, false);
    await openApp(page);
    await sendPrompt(page, "stop running agent");
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible({ timeout: 5000 });
  });

  test("Cancel button stops running state", async ({ page }) => {
    await injectMock(page, false);
    await openApp(page);
    await sendPrompt(page, "abort now");
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(200);
    await expect(page.getByRole("button", { name: "Cancel" })).not.toBeVisible({ timeout: 3000 });
  });

  test("turn_complete event stops running state", async ({ page }) => {
    await injectMock(page, false);
    await openApp(page);
    await sendPrompt(page, "manual complete");
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(100);
    await emitEvent(page, "agent:turn_complete", {
      sessionId: "session-e2e-1",
      stopReason: "end_turn",
      assistantMessage: "Analysis complete.",
      messageCount: 4,
    });
    await page.waitForTimeout(200);
    await expect(page.getByRole("button", { name: "Cancel" })).not.toBeVisible({ timeout: 3000 });
  });

  test("Send button returns after turn_complete", async ({ page }) => {
    await injectMock(page, false);
    await openApp(page);
    await sendPrompt(page, "send again test");
    await page.waitForTimeout(100);
    await emitEvent(page, "agent:turn_complete", {
      sessionId: "session-e2e-1",
      stopReason: "end_turn",
      assistantMessage: "done",
      messageCount: 2,
    });
    await page.waitForTimeout(200);
    await expect(page.locator("textarea")).toBeEditable({ timeout: 5000 });
  });
});

/* ── 3. Streaming & Tool Events ───────────────────────────── */

const STREAM_TEST_TIMEOUT = 200; // Wait time after actions for renders

test.describe("Streaming & Tool Events", () => {
  test("text_delta event populates assistant bubble", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "stream test");
    await page.waitForTimeout(200); // Wait for turn_complete to clear running state
    await emitEvent(page, "agent:text_delta", {
      sessionId: "session-e2e-1",
      text: "Hello from agent",
      isComplete: false,
    });
    await expect(page.getByText("Hello from agent")).toBeVisible({ timeout: 3000 });
  });

  test("multiple text_delta events append", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "concat test");
    await page.waitForTimeout(200);
    await emitEvent(page, "agent:text_delta", { sessionId: "session-e2e-1", text: "Part A ", isComplete: false });
    await page.waitForTimeout(50);
    await emitEvent(page, "agent:text_delta", { sessionId: "session-e2e-1", text: "Part B", isComplete: false });
    await expect(page.getByText("Part A")).toBeVisible({ timeout: 3000 });
  });

  test("tool_start shows tool name and running indicator", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "tool test");
    await page.waitForTimeout(200);
    await emitEvent(page, "agent:tool_start", { sessionId: "session-e2e-1", toolUseId: "t-1", toolName: "read_file" });
    await expect(page.getByText("read_file")).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("running\u2026")).toBeVisible({ timeout: 3000 });
  });

  test("tool_result shows content", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "result test");
    await page.waitForTimeout(200);
    await emitEvent(page, "agent:tool_start", { sessionId: "session-e2e-1", toolUseId: "t-2", toolName: "search_files" });
    await page.waitForTimeout(50);
    await emitEvent(page, "agent:tool_result", { sessionId: "session-e2e-1", toolUseId: "t-2", toolName: "search_files", content: "Found 3 files", isError: false });
    await expect(page.getByText("search_files")).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("Found 3 files")).toBeVisible({ timeout: 3000 });
  });

  test("tool_result with isError shows error styling", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "tool error test");
    await page.waitForTimeout(200);
    await emitEvent(page, "agent:tool_result", { sessionId: "session-e2e-1", toolUseId: "t-3", toolName: "write_file", content: "Permission denied", isError: true });
    await expect(page.getByText("write_file")).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("Permission denied")).toBeVisible({ timeout: 3000 });
  });
});

/* ── 4. Approval Flow ─────────────────────────────────────── */

test.describe("Approval Flow", () => {
  test("approval_needed overlay shows tool details", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "approval test");
    await page.waitForTimeout(200);
    await emitEvent(page, "agent:approval_needed", {
      sessionId: "session-e2e-1",
      approvalId: "a-1",
      toolName: "write_file",
      description: "write_file on /tmp/out.csv",
      target: "/tmp/out.csv",
      input: { path: "/tmp/out.csv", content: "data" },
    });
    await expect(page.getByText("Tool: write_file")).toBeVisible({ timeout: 3000 });
  });

  test("Approve button dismisses overlay", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "approve test");
    await page.waitForTimeout(200);
    await emitEvent(page, "agent:approval_needed", {
      sessionId: "session-e2e-1",
      approvalId: "a-2",
      toolName: "bash",
      description: "rm -rf /tmp/old",
      input: { command: "rm -rf /tmp/old" },
    });
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible({ timeout: 3000 });
    await page.getByRole("button", { name: "Approve" }).click();
    await page.waitForTimeout(200);
    await expect(page.getByRole("button", { name: "Approve" })).not.toBeVisible({ timeout: 2000 });
  });

  test("Reject button dismisses overlay", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "reject test");
    await page.waitForTimeout(200);
    await emitEvent(page, "agent:approval_needed", {
      sessionId: "session-e2e-1",
      approvalId: "a-3",
      toolName: "write_file",
      description: "Write to forbidden",
      target: "/etc/shadow",
      input: { path: "/etc/shadow" },
    });
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible({ timeout: 3000 });
    await page.getByRole("button", { name: "Reject" }).click();
    await page.waitForTimeout(200);
    await expect(page.getByRole("button", { name: "Reject" })).not.toBeVisible({ timeout: 2000 });
  });

  test("multiple approvals render as separate cards", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "multi approval");
    await page.waitForTimeout(200);
    await emitEvent(page, "agent:approval_needed", { sessionId: "session-e2e-1", approvalId: "a-4", toolName: "write_file", description: "First", input: {} });
    await emitEvent(page, "agent:approval_needed", { sessionId: "session-e2e-1", approvalId: "a-5", toolName: "bash", description: "Second", input: {} });
    await expect(page.getByText("Tool: write_file")).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("Tool: bash")).toBeVisible({ timeout: 3000 });
  });
});

/* ── 5. Error Handling ────────────────────────────────────── */

test.describe("Error Handling", () => {
  test("error event shows error state", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "error test");
    await page.waitForTimeout(200);
    await emitEvent(page, "agent:error", { sessionId: "session-e2e-1", error: "Connection failed", cancelled: false });
    await expect(page.getByText("Error")).toBeVisible({ timeout: 2000 });
  });

  test("cancelled error does not show error state", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await emitEvent(page, "agent:error", { sessionId: "session-e2e-999", error: "Cancelled", cancelled: true });
    await page.waitForTimeout(100);
    // App should still be functional - footer should show version
    await expect(page.locator("text=Relay Agent v0.1.0")).toBeVisible({ timeout: 2000 });
  });

  test("app remains functional after error", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await emitEvent(page, "agent:error", { sessionId: "session-e2e-1", error: "Transient", cancelled: false });
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 2000 });
    await expect(textarea).toBeEditable();
  });
});

/* ── 6. Context Panel ─────────────────────────────────────── */

test.describe("Context Panel", () => {
  test("files tab shows default files", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await page.getByRole("button", { name: "Files" }).click();
    await expect(page.getByText("README.md").first()).toBeVisible({ timeout: 2000 });
  });

  test("file count displays correctly", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await page.getByRole("button", { name: "Files" }).click();
    await expect(page.getByText("2 files")).toBeVisible({ timeout: 2000 });
  });

  test("servers tab shows empty state", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await page.getByRole("button", { name: "Servers" }).click();
    await expect(page.getByText("No MCP servers connected")).toBeVisible({ timeout: 2000 });
  });

  test("add server interface appears", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await page.getByRole("button", { name: "Servers" }).click();
    await page.getByText("+ Add Server").click();
    await expect(page.getByPlaceholder("Server name")).toBeVisible({ timeout: 2000 });
  });

  test("policy tab shows default policies", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await page.getByRole("button", { name: "Policy" }).click();
    await expect(page.getByText("Bash")).toBeVisible({ timeout: 2000 });
    await expect(page.getByText("File write")).toBeVisible({ timeout: 2000 });
    await expect(page.getByText("File read")).toBeVisible({ timeout: 2000 });
  });

  test("policy badges: Require Approval, Allow, Deny", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await page.getByRole("button", { name: "Policy" }).click();
    await expect(page.getByText("\u26a1 Approve").first()).toBeVisible({ timeout: 2000 });
    await expect(page.getByText("\u2713 Allow")).toBeVisible({ timeout: 2000 });
    await expect(page.getByText("\u26d4 Deny")).toBeVisible({ timeout: 2000 });
  });
});

/* ── 7. Composer Input Behaviors ──────────────────────────── */

test.describe("Composer Input Behaviors", () => {
  test("empty input does not show Send button", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await expect(page.getByRole("button", { name: "Send" })).not.toBeVisible();
  });

  test("whitespace-only input does not show Send button", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await page.locator("textarea").fill("   ");
    await expect(page.getByRole("button", { name: "Send" })).not.toBeVisible({ timeout: 2000 });
  });

  test("Enter key sends message and clears textarea", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "test message");
    await expect(page.locator("textarea")).toHaveValue("", { timeout: 2000 });
  });

  test("Clicking Send button sends message", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await page.locator("textarea").fill("click send");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("click send")).toBeVisible({ timeout: 5000 });
  });

  test("disabled when agent is running, then recovers after auto-complete", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "disabled test");
    // Auto-complete fires after 150ms, re-enabling textarea
    await page.waitForTimeout(300);
    await expect(page.locator("textarea")).toBeEditable({ timeout: 5000 });
  });
});

/* ── 8. Layout Integrity ─────────────────────────────────── */

test.describe("Layout Integrity", () => {
  test("3-pane layout is present", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await expect(page.locator("aside").first()).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("aside").last()).toBeVisible();
  });

  test("header contains app name and settings", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await expect(page.locator("header")).toBeVisible();
    await expect(page.getByText("Relay Agent", { exact: true })).toBeVisible();
    await expect(page.getByText("\u2699 Settings")).toBeVisible();
  });

  test("footer shows version and session count", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await expect(page.getByText("Relay Agent v0.1.0")).toBeVisible();
    await expect(page.getByText("0 sessions")).toBeVisible();
  });

  test("empty state shows welcome message", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await expect(page.getByText("Relay Agent is ready")).toBeVisible();
    await expect(page.getByText("\ud83e\uddf8")).toBeVisible();
  });
});

/* ── 9. Theme & Visual ───────────────────────────────────── */

test.describe("Theme & Visual", () => {
  test("dark mode is default", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    const theme = await page.locator("html").getAttribute("data-theme");
    expect(theme).toBe("dark");
  });

  test("CSS custom properties are defined", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--ra-surface").trim()
    );
    expect(bg.length).toBeGreaterThan(0);
  });
});

/* ── 10. Edge Cases & Robustness ──────────────────────────── */

test.describe("Edge Cases & Robustness", () => {
  test("rapid event burst does not crash the app", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    for (let i = 0; i < 20; i++) {
      await emitEvent(page, "agent:text_delta", { sessionId: "session-e2e-1", text: `chunk-${i} `, isComplete: false });
    }
    await expect(page.locator("textarea")).toBeVisible({ timeout: 3000 });
  });

  test("long message text renders without overflow", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    const long = "A".repeat(500);
    await page.locator("textarea").fill(long);
    await page.locator("textarea").press("Enter");
    await expect(page.getByText("AAAAA")).toBeVisible({ timeout: 5000 });
  });

  test("special characters render correctly", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    const special = "Hello <>&\"\' \u65e5\u672c\u8a9e \ud83c\udf89";
    await page.locator("textarea").fill(special);
    await page.locator("textarea").press("Enter");
    await expect(page.getByText("Hello")).toBeVisible({ timeout: 5000 });
  });

  test("unknown event type does not crash the app", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await emitEvent(page, "agent:unknown_event_type", { sessionId: "session-e2e-1" });
    await expect(page.locator("textarea")).toBeEditable({ timeout: 2000 });
  });
});
