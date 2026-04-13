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
  await page.goto("/");
  await expect(page.getByRole("banner").getByText("Relay Agent", { exact: true })).toBeVisible();
}

function composer(page: any) {
  return page.locator("textarea");
}

test("first run shows onboarding preflight and hides app chrome", async ({ page }) => {
  await openApp(page);
  await expect(page.getByText("Set up once, then ask for the result you want")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirm the Copilot connection" })).toBeVisible();
  await expect(page.getByText("Copilot signed in", { exact: true })).toHaveCount(0);
  await expect(page.getByText("CDP reachable", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose folder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect Copilot" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conversations" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Integrations" })).toHaveCount(0);
  await expect(page.locator("[data-ra-footer-session]")).toHaveCount(0);
});

test("settings modal exposes setup and advanced controls", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Project folder/)).toBeVisible();
  await expect(dialog.getByText(/New conversation mode/)).toBeVisible();
  await expect(dialog.getByText("Step 2 · Copilot connection")).toBeVisible();
  const advanced = dialog.locator("details.ra-settings-details");
  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(dialog.getByText("Browser debug port", { exact: true })).not.toBeVisible();
  await advanced.locator("summary").click();
  await expect(dialog.getByText("Browser debug port", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Always on top", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export diagnostics" })).toBeVisible();
});

test("sending the first prompt exits onboarding and creates one conversation", async ({ page }) => {
  await injectMock(page, true);
  await openApp(page);
  await composer(page).fill("review the workspace");
  await composer(page).press("Control+Enter");
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".ra-session-row")).toHaveCount(1);
  await expect(page.getByText("What appears here once work starts")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Redo" })).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toBeVisible();
});

test.skip("tool rows use human labels instead of raw tool names", async () => {
  // Covered by the mock-driven suite; browser-only app.e2e focuses on shell flow.
});

test.skip("approval overlay uses updated copy and advanced details label", async () => {
  // Covered by the mock-driven suite; browser-only app.e2e focuses on shell flow.
});
