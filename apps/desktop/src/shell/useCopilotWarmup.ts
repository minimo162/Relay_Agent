import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal, onCleanup } from "solid-js";
import { warmupCopilotBridge, type BrowserAutomationSettings } from "../lib/ipc";

export type CopilotWarmupState =
  | { status: "idle"; message: string | null }
  | { status: "checking"; message: string | null }
  | { status: "ready"; message: string }
  | { status: "needs_sign_in"; message: string }
  | { status: "error"; message: string };

export function useCopilotWarmup(loadSettings: () => BrowserAutomationSettings | null | undefined) {
  const [copilotState, setCopilotState] = createSignal<CopilotWarmupState>({
    status: "idle",
    message: null,
  });
  const copilotFlashTimer: { id?: ReturnType<typeof setTimeout> } = {};

  const runCopilotWarmup = (focusMainWindow: boolean) => {
    if (copilotFlashTimer.id) {
      clearTimeout(copilotFlashTimer.id);
      copilotFlashTimer.id = undefined;
    }
    setCopilotState({ status: "checking", message: "Checking Copilot connection…" });
    void warmupCopilotBridge(loadSettings() ?? null)
      .then((r) => {
        if (r.loginRequired) {
          setCopilotState({
            status: "needs_sign_in",
            message: "Sign in to Copilot in Edge, then return here.",
          });
        } else if (r.error) {
          setCopilotState({ status: "error", message: `Copilot: ${r.error}` });
        } else if (r.connected) {
          setCopilotState({ status: "ready", message: "Copilot ready." });
          copilotFlashTimer.id = setTimeout(() => {
            setCopilotState((prev) =>
              prev.status === "ready" ? { status: "idle", message: null } : prev,
            );
            copilotFlashTimer.id = undefined;
          }, 3500);
        } else {
          setCopilotState({ status: "error", message: "Copilot is unavailable right now." });
        }
      })
      .catch((err) => {
        console.error("[Copilot] warmup failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        setCopilotState({ status: "error", message: `Copilot: ${msg}` });
      })
      .finally(() => {
        if (!focusMainWindow || !isTauri()) return;
        const win = getCurrentWindow();
        void win
          .show()
          .then(() => win.setFocus())
          .catch((e) => console.error("[Shell] window show/focus failed:", e));
      });
  };

  onCleanup(() => {
    if (copilotFlashTimer.id) clearTimeout(copilotFlashTimer.id);
  });

  return {
    copilotState,
    runCopilotWarmup,
  };
}
