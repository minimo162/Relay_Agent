/**
 * Playwright preload script — mocks @tauri-apps/api in the browser.
 * Must be added via `page.addInitScript()` before navigation.
 *
 * In tests, this file is referenced by playwright.config.ts
 * OR injected manually via page.addInitScript({ path: __filename }).
 */

// ── Global mock state ───
const mock = {
  sessionIdCounter: 0,
  sessions: new Map<string, Record<string, unknown>>(),
  eventListeners: new Map<string, Set<(payload: unknown) => void>>(),

  /** Emit a fake Tauri event (callable from test JS context) */
  emit(event: string, payload: unknown) {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      for (const h of handlers) h(payload);
    }
  },
};

// Expose to tests
(window as any).__RELAY_MOCK__ = mock;

// ── @tauri-apps/api/core mock ───
const tauriCore = {
  async invoke(cmd: string, args: any): Promise<unknown> {
    const req = args?.request ?? args ?? {};

    switch (cmd) {
      case "start_agent": {
        mock.sessionIdCounter += 1;
        const id = `session-e2e-${mock.sessionIdCounter}`;
        mock.sessions.set(id, { running: true });
        return id;
      }
      case "respond_approval":
        return undefined;
      case "respond_user_question":
        return undefined;
      case "cancel_agent": {
        const entry = mock.sessions.get(req.sessionId);
        if (entry) (entry as any).running = false;
        return undefined;
      }
      case "get_session_history": {
        const entry = mock.sessions.get(req.sessionId) || {};
        return { sessionId: req.sessionId, running: false, messages: [] };
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
          processCwd: "/mock",
          clawConfigHomeDisplay: "~/.claw (mock)",
          maxTextFileReadBytes: 10485760,
          doctorHints: ["mock"],
          predictabilityNotes: ["mock predictability"],
        };
      case "get_workspace_allowlist":
        return { storePath: "/mock/.relay-agent/workspace_allowed_tools.json", entries: [] };
      case "remove_workspace_allowlist_tool":
      case "clear_workspace_allowlist":
        return undefined;
      case "list_workspace_slash_commands":
        return [];
      case "write_text_export":
        return undefined;
      case "workspace_instruction_surfaces":
        return { workspaceRoot: null, surfaces: [] };
      case "get_desktop_permission_summary":
        return [];
      default:
        throw new Error(`[mock] Unknown invoke: ${cmd}`);
    }
  },
};

// ── @tauri-apps/api/event mock ───
const tauriEvent = {
  async listen(event: string, handler: (e: { payload: unknown }) => void): Promise<() => void> {
    if (!mock.eventListeners.has(event)) {
      mock.eventListeners.set(event, new Set());
    }
    mock.eventListeners.get(event)!.add(handler);
    return () => {
      mock.eventListeners.get(event)?.delete(handler);
    };
  },
  async once(_event: string, _handler: (e: { payload: unknown }) => void): Promise<() => void> {
    return () => {};
  },
};

// Attach to window for module resolution
(window as any).__TAURI_INTERNALS__ = { invoke: tauriCore.invoke.bind(tauriCore) };
(window as any).__TAURI_EVENT__ = tauriEvent;

// Shim the module paths so import resolves work in the browser
// Solid.js uses ES imports — we need to mock the module resolution.
// The trick: override window.__TAURI__ before Solid app inits.
(window as any).__TAURI__ = {
  core: tauriCore,
  event: tauriEvent,
};
