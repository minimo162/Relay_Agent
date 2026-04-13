import { test, expect } from "@playwright/test";

async function injectMock(page: any, autoComplete = true) {
  await page.addInitScript(`(${String(mockSetup)})(${JSON.stringify(autoComplete)});`);
}

function mockSetup(autoComplete: boolean) {
  (window as any).__RELAY_E2E_AUTOCOMPLETE = autoComplete;
  const mock = {
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
  (window as any).__RELAY_MOCK__ = mock;

  const autoCompleteTurn = (sessionId: string) => {
    if ((window as any).__RELAY_E2E_AUTOCOMPLETE === false) return;
    setTimeout(() => {
      const session = mock.sessions.get(sessionId);
      if (session) session.running = false;
      mock.emit("agent:turn_complete", {
        sessionId,
        stopReason: "end_turn",
        assistantMessage: "Task completed.",
        messageCount: (session?.messages?.length ?? 1) + 1,
      });
    }, 150);
  };

  const invoke = async (cmd: string, args: any) => {
    const req = args?.request ?? args ?? {};
    switch (cmd) {
      case "start_agent": {
        mock.sessionCounter += 1;
        const id = `session-e2e-${mock.sessionCounter}`;
        mock.sessions.set(id, { running: true, messages: [req.goal] });
        autoCompleteTurn(id);
        return id;
      }
      case "continue_agent_session": {
        const session = mock.sessions.get(req.sessionId);
        if (!session) throw new Error(`[mock] Unknown session ${req.sessionId}`);
        session.running = true;
        session.messages = [...(session.messages ?? []), req.message];
        autoCompleteTurn(req.sessionId);
        return req.sessionId;
      }
      case "respond_approval":
      case "respond_user_question":
      case "cancel_agent":
      case "undo_session_write":
      case "redo_session_write":
      case "write_text_export":
        return undefined;
      case "get_session_write_undo_status":
        return { canUndo: false, canRedo: false };
      case "get_session_history": {
        const session = mock.sessions.get(req.sessionId);
        return {
          sessionId: req.sessionId,
          running: session?.running ?? false,
          messages: (session?.messages ?? []).map((text: string) => ({
            role: "user",
            content: [{ type: "text", text }],
          })),
        };
      }
      case "compact_agent_session":
        return { message: "Session compacted", removedMessageCount: 0 };
      case "mcp_list_servers":
        return [];
      case "mcp_add_server":
        return { name: req.name, command: req.command, args: req.args ?? [], connected: true, tools: [] };
      case "mcp_remove_server":
        return true;
      case "mcp_check_server_status":
        return { name: req.name, command: "", args: [], connected: false, tools: [] };
      case "warmup_copilot_bridge":
        return { connected: true, loginRequired: false, url: null, error: null };
      case "workspace_instruction_surfaces":
        return { workspaceRoot: null, surfaces: [] };
      case "get_desktop_permission_summary":
        return [
          { name: "read_file", requirement: "auto_allow", description: "Read files" },
          { name: "write_file", requirement: "require_approval", description: "Write files" },
          { name: "bash", requirement: "require_approval", description: "Shell commands" },
        ];
      case "get_relay_diagnostics":
        return {
          appVersion: "0.0.0-mock",
          targetOs: "linux",
          copilotNodeBridgePort: 18080,
          defaultEdgeCdpPort: 9360,
          relayAgentDevMode: false,
          architectureNotes: "mock",
          processCwd: "/mock",
          clawConfigHomeDisplay: "~/.claw (mock)",
          maxTextFileReadBytes: 10485760,
          doctorHints: ["mock"],
          predictabilityNotes: ["mock"],
        };
      case "connect_cdp":
      case "cdp_start_new_chat":
        return { ok: true, debugUrl: "", pageUrl: "", pageTitle: "", port: 9360, launched: false, error: null };
      case "cdp_send_prompt":
        return { ok: true, responseText: "", bodyLength: 0, error: null };
      case "cdp_screenshot":
        return { ok: true, screenshot: "base64" };
      default:
        throw new Error("[mock] Unknown command: " + cmd);
    }
  };

  (window as any).__TAURI_INTERNALS__ = { invoke };
  (window as any).__TAURI_EVENT_INTERNALS__ = {
    listen: async (event: string, handler: (e: unknown) => void) => mock.listen(event, handler),
    once: async () => () => {},
  };
}

async function openApp(page: any) {
  await page.goto("/", { waitUntil: "networkidle", timeout: 15000 });
  await expect(page.getByRole("banner").getByText("Relay Agent", { exact: true })).toBeVisible();
}

async function sendPrompt(page: any, text: string) {
  const textarea = page.locator("textarea");
  await expect(textarea).toBeEditable({ timeout: 5000 });
  await textarea.fill(text);
  await textarea.press("Control+Enter");
}

async function waitForIdle(page: any) {
  await expect(page.locator('[data-ra-footer-session="idle"]')).toBeVisible({ timeout: 10000 });
}

async function emitEvent(page: any, event: string, payload: any) {
  await page.evaluate(
    ({ event, payload }) => {
      (window as any).__RELAY_MOCK__?.emit(event, payload);
    },
    { event, payload },
  );
}

test.describe("Conversation model", () => {
  test("continuing an idle conversation does not create a new row", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "first task");
    await waitForIdle(page);
    await expect(page.locator(".ra-session-row")).toHaveCount(1);

    await sendPrompt(page, "follow-up task");
    await waitForIdle(page);
    await expect(page.locator(".ra-session-row")).toHaveCount(1);
    await expect(page.getByText("follow-up task")).toBeVisible();
  });

  test("starting a new conversation creates a second row", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await sendPrompt(page, "task one");
    await waitForIdle(page);
    await page.getByRole("button", { name: "New conversation" }).click();
    await sendPrompt(page, "task two");
    await waitForIdle(page);
    await expect(page.locator(".ra-session-row")).toHaveCount(2);
  });
});

test.describe("Settings and first-run UX", () => {
  test("first-run keeps sidebar and context panel hidden", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await expect(page.getByRole("heading", { name: "Conversations" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Integrations" })).toHaveCount(0);
    await expect(page.getByText("Confirm the basics, then send your first request")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconnect Copilot" })).toHaveCount(0);
  });

  test("settings modal shows connection and advanced controls", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Reconnect Copilot" })).toBeVisible();
    const advanced = dialog.locator("details.ra-settings-details");
    await expect(advanced).not.toHaveAttribute("open", "");
    await expect(dialog.getByText("Browser debug port")).not.toBeVisible();
    await advanced.locator("summary").click();
    await expect(dialog.getByText("Browser debug port")).toBeVisible();
    await expect(dialog.getByText("Response timeout (ms)")).toBeVisible();
    await expect(dialog.getByText("Always on top")).toBeVisible();
  });
});

test.describe("Audit and approvals", () => {
  test("tool audit row renders human labels with input-derived target", async ({ page }) => {
    await injectMock(page, false);
    await openApp(page);
    await sendPrompt(page, "inspect files");
    await emitEvent(page, "agent:tool_start", {
      sessionId: "session-e2e-1",
      toolUseId: "tool-1",
      toolName: "grep_search",
      input: { pattern: "TODO", path: "/tmp/project" },
    });
    await emitEvent(page, "agent:tool_result", {
      sessionId: "session-e2e-1",
      toolUseId: "tool-1",
      toolName: "grep_search",
      content: JSON.stringify({ numFiles: 2, numMatches: 4 }),
      isError: false,
    });
    await expect(page.getByText("Search file contents")).toBeVisible();
    await expect(page.getByText("TODO · /tmp/project")).toBeVisible();
    await expect(page.getByText("4 hits across 2 files")).toBeVisible();
  });

  test("approval overlay uses conversation/folder wording", async ({ page }) => {
    await injectMock(page, true);
    await openApp(page);
    await emitEvent(page, "agent:approval_needed", {
      sessionId: "session-e2e-1",
      approvalId: "approval-1",
      toolName: "bash",
      description: "Run a shell command?",
      target: "npm test @ /tmp/project",
      input: { command: "npm test", cwd: "/tmp/project" },
      workspaceCwdConfigured: true,
    });
    await expect(page.getByRole("button", { name: "Allow once" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Always allow in this conversation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Always allow in this folder" })).toBeVisible();
    await expect(page.getByText("Advanced details")).toBeVisible();
  });
});
