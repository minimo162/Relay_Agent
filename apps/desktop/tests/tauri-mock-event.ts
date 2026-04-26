/**
 * E2E mock for @tauri-apps/api/event.
 */

type Handler = (event: { payload: unknown }) => void;

const state = (window as any).__RELAY_MOCK_EVENTS__ ??= {
  listeners: new Map<string, Set<Handler>>(),
};

export async function listen(
  event: string,
  handler: Handler,
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
  handler: Handler,
): Promise<() => void> {
  const unlisten = await listen(event, (payload) => {
    handler(payload);
    unlisten();
  });
  return unlisten;
}

export async function emit(event: string, payload: unknown): Promise<void> {
  for (const handler of state.listeners.get(event) ?? []) {
    handler({ payload });
  }
}
