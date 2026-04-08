/**
 * E2E mock package — replaces @tauri-apps/api
 *
 * Vite alias: @tauri-apps/api/core → this file
 *             @tauri-apps/api/event → this file
 *             @tauri-apps/plugin-shell → this file
 *
 * The shared state object on window.__RELAY_MOCK__ is the single source
 * of truth for mock data, listeners, and test helpers (emit).
 */

/* ── Shared mock state (single source of truth) ─────────── */
const s = (window as any).__RELAY_MOCK__ ??= {
  sessionCounter: 0,
  sessions: new Map<string, { running: boolean; messages: any[] }>(),
  listeners: new Map<string, Set<(e: any) => void>>(),
  mcpServers: [] as Array<{
    name: string;
    command: string;
    args: string[];
    connected: boolean;
    tools: string[];
  }>,
  autoCompleteTurn: true,  // tests can set to false via page.evaluate

  /** Call registered listeners for a Tauri event name.
   *  Payload is wrapped in the Tauri Event shape { event, windowLabel, payload }. */
  emit(event: string, payload: unknown) {
    const fns = this.listeners.get(event);
    if (fns) {
      for (const fn of fns) {
        fn({ event, windowLabel: "main", payload });
      }
    }
  },
};

/* Expose auto-complete flag for tests to toggle */
Object.defineProperty(window, "__E2E_AUTO_COMPLETE", {
  get: () => s.autoCompleteTurn,
  set: (v: boolean) => { s.autoCompleteTurn = v; },
});

/* ── @tauri-apps/api/event ───────────────────────────────── */
export type UnlistenFn = () => void;
export type EventCallback<T> = (event: Event<T>) => void;
export interface Event<T> {
  event: string;
  windowLabel: string;
  payload: T;
}
export async function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  if (!s.listeners.has(event)) s.listeners.set(event, new Set());
  const set = s.listeners.get(event)!;
  // The emit() function on __RELAY_MOCK__ already wraps payload into
  // the Tauri Event shape { event, windowLabel, payload }.
  // Don't wrap again — just pass through to the handler.
  set.add(handler);
  return () => set.delete(handler);
}

export async function once<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  const remove = await listen(event, async (e) => { handler(e); remove(); });
  return remove;
}

/* ── @tauri-apps/api/core ────────────────────────────────── */
export async function invoke(cmd: string, args: any): Promise<unknown> {
  const req = args?.request ?? args ?? {};

  switch (cmd) {
    case "start_agent": {
      s.sessionCounter += 1;
      const id = `session-e2e-${s.sessionCounter}`;
      s.sessions.set(id, { running: true, messages: [] });
      // Auto-complete: fire turn_complete after 100ms so the UI re-enables
      if (s.autoCompleteTurn) {
        setTimeout(() => {
          const sess = s.sessions.get(id);
          if (sess) sess.running = false;
          s.emit("agent:turn_complete", {
            sessionId: id,
            stopReason: "end_turn",
            assistantMessage: "Done.",
            messageCount: 2,
          });
        }, 100);
      }
      return id;
    }
    case "respond_approval":
      return undefined;
    case "cancel_agent": {
      const entry = s.sessions.get(req.sessionId);
      if (entry) entry.running = false;
      return undefined;
    }
    case "get_session_history": {
      const entry = s.sessions.get(req.sessionId);
      return {
        sessionId: req.sessionId,
        running: entry ? entry.running : false,
        messages: entry ? entry.messages : [],
      };
    }
    case "compact_agent_session": {
      if (!s.sessions.has(req.sessionId)) throw new Error("session not found");
      return { message: "Session compacted", removedMessageCount: 3 };
    }
    case "warmup_copilot_bridge":
      return { connected: true, loginRequired: false, url: null, error: null };
    case "get_relay_diagnostics":
      return {
        appVersion: "0.0.0-mock",
        targetOs: "linux",
        copilotNodeBridgePort: 18080,
        defaultEdgeCdpPort: 9360,
        relayAgentDevMode: false,
        architectureNotes: "mock",
      };
    case "mcp_list_servers":
      return s.mcpServers;
    case "mcp_add_server": {
      const srv = {
        name: req.name, command: req.command, args: req.args ?? [],
        connected: true, tools: ["tool_a", "tool_b"],
      };
      s.mcpServers.push(srv);
      return srv;
    }
    case "mcp_remove_server": {
      const idx = s.mcpServers.findIndex((x: any) => x.name === req.name);
      if (idx >= 0) { s.mcpServers.splice(idx, 1); return true; }
      return false;
    }
    case "mcp_check_server_status": {
      const found = s.mcpServers.find((x: any) => x.name === req.name);
      if (!found) throw new Error("server not found");
      return found;
    }
    case "connect_cdp":
    case "cdp_start_new_chat":
      return { ok: true, debugUrl: "", pageUrl: "", pageTitle: "", port: 9360, launched: false, error: null };
    case "cdp_send_prompt":
      return { ok: true, responseText: "", bodyLength: 0, error: null };
    case "cdp_screenshot":
      return { ok: true, screenshot: "base64" };
    default:
      throw new Error(`[E2E mock] Unknown command: ${cmd}`);
  }
}

/* Stub for @tauri-apps/plugin-shell */
export async function open(_path: string): Promise<void> {}
