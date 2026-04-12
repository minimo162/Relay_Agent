/**
 * E2E mock for @tauri-apps/api/core
 */

export function isTauri(): boolean {
  return false;
}

const state = (window as any).__RELAY_MOCK__ ??= {
  sessionCounter: 0,
  sessions: new Map(),
  listeners: new Map(),
  emit(event: string, payload: unknown) {
    const fns = this.listeners.get(event);
    if (fns) for (const fn of fns) fn({ payload });
  },
};

export async function invoke(cmd: string, args: any): Promise<unknown> {
  const req = args?.request ?? args ?? {};

  switch (cmd) {
    case "start_agent": {
      state.sessionCounter += 1;
      const id = `session-e2e-${state.sessionCounter}`;
      state.sessions.set(id, { running: true, messages: [req.goal] });
      const win = window as unknown as { __RELAY_E2E_AUTOCOMPLETE?: boolean };
      if (win.__RELAY_E2E_AUTOCOMPLETE !== false) {
        setTimeout(() => {
          const s = state.sessions.get(id);
          if (s) s.running = false;
          state.emit("agent:turn_complete", {
            sessionId: id,
            stopReason: "end_turn",
            assistantMessage: "Task completed.",
            messageCount: 2,
          });
        }, 200);
      }
      return id;
    }
    case "continue_agent_session": {
      const s = state.sessions.get(req.sessionId);
      if (!s) throw new Error(`[E2E mock] Unknown session: ${req.sessionId}`);
      s.running = true;
      s.messages = [...(s.messages ?? []), req.message];
      const win = window as unknown as { __RELAY_E2E_AUTOCOMPLETE?: boolean };
      if (win.__RELAY_E2E_AUTOCOMPLETE !== false) {
        setTimeout(() => {
          const current = state.sessions.get(req.sessionId);
          if (current) current.running = false;
          state.emit("agent:turn_complete", {
            sessionId: req.sessionId,
            stopReason: "end_turn",
            assistantMessage: "Task completed.",
            messageCount: (s.messages?.length ?? 0) + 1,
          });
        }, 200);
      }
      return req.sessionId;
    }
    case "respond_approval":
      return undefined;
    case "respond_user_question":
      return undefined;
    case "cancel_agent": {
      const s = state.sessions.get(req.sessionId);
      if (s) s.running = false;
      return undefined;
    }
    case "get_session_history": {
      const s = state.sessions.get(req.sessionId);
      return {
        sessionId: req.sessionId,
        running: s ? s.running : false,
        messages: (s?.messages ?? []).map((text: string) => ({
          role: "user",
          content: [{ type: "text", text }],
        })),
      };
    }
    case "compact_agent_session":
      return { message: "Session compacted", removedMessageCount: 0 };
    case "undo_session_write":
    case "redo_session_write":
      return undefined;
    case "get_session_write_undo_status":
      return { canUndo: false, canRedo: false };
    case "probe_rust_analyzer":
      return { ok: false, versionLine: null, error: "mock: rust-analyzer not available" };
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
    case "mcp_list_servers":
      return [];
    case "get_desktop_permission_summary":
      return [
        { name: "Bash", requirement: "require_approval", description: "Shell commands" },
        { name: "File write", requirement: "require_approval", description: "Write files" },
        { name: "File read", requirement: "auto_allow", description: "Read files" },
        { name: "Network", requirement: "auto_deny", description: "Outbound HTTP" },
      ];
    default:
      throw new Error(`[E2E mock] Unknown command: ${cmd}`);
  }
}
