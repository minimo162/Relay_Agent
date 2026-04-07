/**
 * E2E mock for @tauri-apps/api/core
 */

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
      state.sessions.set(id, { running: true });
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
    case "respond_approval":
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
        messages: [],
      };
    }
    default:
      throw new Error(`[E2E mock] Unknown command: ${cmd}`);
  }
}
