/**
 * E2E mock for @tauri-apps/plugin-dialog (no native picker in browser preview).
 */

export async function open(_options?: unknown): Promise<null> {
  return null;
}

export async function save(_options?: unknown): Promise<null> {
  return null;
}
