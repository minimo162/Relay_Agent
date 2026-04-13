import type { Page } from "@playwright/test";

type RelayMockConfig = {
  autoComplete?: boolean;
};

type RelayMockState = {
  sessionCounter: number;
  sessions: Map<string, { running: boolean; messages: string[] }>;
  listeners: Map<string, Set<(event: { payload: unknown }) => void>>;
  listenerCounts: Map<string, number>;
  mcpServers: Array<{
    name: string;
    command: string;
    args: string[];
    connected: boolean;
    tools: string[];
  }>;
  callbackCounter: number;
  callbacks: Map<number, (event: { event: string; id: number; payload: unknown }) => void>;
  eventCounter: number;
  pluginListeners: Map<string, Map<number, number>>;
  emit: (event: string, payload: unknown) => void;
};

function initRelayMock(config: { autoComplete: boolean }) {
  const state: RelayMockState = {
    sessionCounter: 0,
    sessions: new Map(),
    listeners: new Map(),
    listenerCounts: new Map(),
    mcpServers: [],
    callbackCounter: 0,
    callbacks: new Map(),
    eventCounter: 0,
    pluginListeners: new Map(),
    emit(event: string, payload: unknown) {
      const handlers = this.listeners.get(event);
      if (handlers) {
        for (const handler of handlers) handler({ payload });
      }
      const pluginHandlers = this.pluginListeners.get(event);
      if (!pluginHandlers) return;
      for (const [eventId, callbackId] of pluginHandlers.entries()) {
        this.callbacks.get(callbackId)?.({ event, id: eventId, payload });
      }
    },
  };

  const setListenerCount = (event: string) => {
    const direct = state.listeners.get(event)?.size ?? 0;
    const plugin = state.pluginListeners.get(event)?.size ?? 0;
    state.listenerCounts.set(event, direct + plugin);
  };

  const autoCompleteTurn = (sessionId: string) => {
    if ((window as any).__RELAY_E2E_AUTOCOMPLETE === false) return;
    setTimeout(() => {
      const session = state.sessions.get(sessionId);
      if (session) session.running = false;
      state.emit("agent:turn_complete", {
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
        state.sessionCounter += 1;
        const id = `session-e2e-${state.sessionCounter}`;
        state.sessions.set(id, { running: true, messages: [req.goal] });
        autoCompleteTurn(id);
        return id;
      }
      case "continue_agent_session": {
        const session = state.sessions.get(req.sessionId);
        if (!session) throw new Error(`[mock] Unknown session ${req.sessionId}`);
        session.running = true;
        session.messages = [...(session.messages ?? []), req.message];
        autoCompleteTurn(req.sessionId);
        return req.sessionId;
      }
      case "respond_approval":
      case "respond_user_question":
      case "undo_session_write":
      case "redo_session_write":
      case "write_text_export":
      case "remove_workspace_allowlist_tool":
      case "clear_workspace_allowlist":
        return undefined;
      case "cancel_agent": {
        const session = state.sessions.get(req.sessionId);
        if (session) session.running = false;
        return undefined;
      }
      case "get_session_write_undo_status":
        return { canUndo: false, canRedo: false };
      case "get_session_history": {
        const session = state.sessions.get(req.sessionId);
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
        return state.mcpServers;
      case "mcp_add_server": {
        const server = { name: req.name, command: req.command, args: req.args ?? [], connected: true, tools: [] };
        state.mcpServers = [...state.mcpServers, server];
        return server;
      }
      case "mcp_remove_server":
        state.mcpServers = state.mcpServers.filter((server) => server.name !== req.name);
        return true;
      case "mcp_check_server_status":
        return state.mcpServers.find((server) => server.name === req.name) ?? {
          name: req.name,
          command: "",
          args: [],
          connected: false,
          tools: [],
        };
      case "warmup_copilot_bridge":
        return { connected: true, loginRequired: false, url: null, error: null };
      case "workspace_instruction_surfaces":
        return { workspaceRoot: null, surfaces: [] };
      case "get_workspace_allowlist":
        return { storePath: "/mock/.relay-agent/workspace_allowed_tools.json", entries: [] };
      case "list_workspace_slash_commands":
        return [];
      case "probe_rust_analyzer":
        return { ok: false, versionLine: null, error: "mock: rust-analyzer not available" };
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
      case "plugin:event|listen": {
        state.eventCounter += 1;
        const eventId = state.eventCounter;
        if (!state.pluginListeners.has(req.event)) {
          state.pluginListeners.set(req.event, new Map());
        }
        state.pluginListeners.get(req.event)?.set(eventId, req.handler);
        setListenerCount(req.event);
        return eventId;
      }
      case "plugin:event|unlisten": {
        state.pluginListeners.get(req.event)?.delete(req.eventId);
        setListenerCount(req.event);
        return undefined;
      }
      case "plugin:event|emit":
      case "plugin:event|emit_to":
        state.emit(req.event, req.payload);
        return undefined;
      default:
        throw new Error("[mock] Unknown command: " + cmd);
    }
  };

  (window as any).__RELAY_MOCK__ = state;
  (window as any).__RELAY_E2E_AUTOCOMPLETE = config.autoComplete;
  (window as any).__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(callback: (event: { event: string; id: number; payload: unknown }) => void) {
      state.callbackCounter += 1;
      state.callbacks.set(state.callbackCounter, callback);
      return state.callbackCounter;
    },
    unregisterCallback(callbackId: number) {
      state.callbacks.delete(callbackId);
    },
  };
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener() {
      return undefined;
    },
  };
}

export async function injectRelayMock(page: Page, config?: RelayMockConfig) {
  await page.addInitScript(initRelayMock, {
    autoComplete: config?.autoComplete ?? true,
  });
}

export async function emitAgentEvent(page: Page, eventName: string, payload: unknown) {
  await page.evaluate(
    ({ eventName, payload }) => {
      (window as any).__RELAY_MOCK__?.emit(eventName, payload);
    },
    { eventName, payload },
  );
}

export async function waitForMockSession(page: Page, sessionId: string) {
  await page.waitForFunction(
    (id) => Boolean((window as any).__RELAY_MOCK__?.sessions?.has(id)),
    sessionId,
  );
}

export async function waitForAgentListener(page: Page, eventName: string) {
  await page.waitForFunction(
    (name) => {
      const count = (window as any).__RELAY_MOCK__?.listenerCounts?.get(name);
      const listeners = (window as any).__RELAY_MOCK__?.listeners?.get(name);
      return Boolean((typeof count === "number" && count > 0) || (listeners && listeners.size > 0));
    },
    eventName,
  );
}
