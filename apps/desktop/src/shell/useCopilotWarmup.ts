import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal, onCleanup } from "solid-js";
import { warmupCopilotBridge, type BrowserAutomationSettings } from "../lib/ipc";

export function useCopilotWarmup(loadSettings: () => BrowserAutomationSettings | null | undefined) {
  const [copilotBridgeHint, setCopilotBridgeHint] = createSignal<string | null>(null);
  const [copilotSuccessFlash, setCopilotSuccessFlash] = createSignal<string | null>(null);
  const copilotFlashTimer: { id?: ReturnType<typeof setTimeout> } = {};

  const runCopilotWarmup = (focusMainWindow: boolean) => {
    if (copilotFlashTimer.id) {
      clearTimeout(copilotFlashTimer.id);
      copilotFlashTimer.id = undefined;
    }
    void warmupCopilotBridge(loadSettings() ?? null)
      .then((r) => {
        if (r.loginRequired) {
          setCopilotBridgeHint("Sign in to Copilot in Edge, then return here.");
          setCopilotSuccessFlash(null);
        } else if (r.error) {
          setCopilotBridgeHint(`Copilot: ${r.error}`);
          setCopilotSuccessFlash(null);
        } else if (r.connected) {
          setCopilotBridgeHint(null);
          setCopilotSuccessFlash("Copilot ready.");
          copilotFlashTimer.id = setTimeout(() => {
            setCopilotSuccessFlash(null);
            copilotFlashTimer.id = undefined;
          }, 3500);
        }
      })
      .catch((err) => {
        console.error("[Copilot] warmup failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        setCopilotBridgeHint(`Copilot: ${msg}`);
        setCopilotSuccessFlash(null);
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
    copilotBridgeHint,
    copilotSuccessFlash,
    runCopilotWarmup,
  };
}
