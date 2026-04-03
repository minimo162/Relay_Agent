/**
 * E2E mock for @tauri-apps/api/event
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

export async function listen(
  event: string,
  handler: (e: { payload: unknown }) => void
): Promise<() => void> {
  if (!state.listeners.has(event)) {
    state.listeners.set(event, new Set());
  }
  state.listeners.get(event)!.add(handler);
  return () => {
    state.listeners.get(event)?.delete(handler);
  };
}

export async function once(
  event: string,
  handler: (e: { payload: unknown }) => void
): Promise<() => void> {
  const unlisten = await listen(event, (e) => {
    handler(e);
    unlisten();
  });
  return unlisten;
}

export async function emit(event: string, payload: unknown): Promise<void> {
  state.emit(event, payload);
}
