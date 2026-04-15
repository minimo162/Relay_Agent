import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal, onCleanup } from "solid-js";
import { warmupCopilotBridge, type BrowserAutomationSettings, type CopilotWarmupResult } from "../lib/ipc";

export interface CopilotWarmupState {
  status: "idle" | "checking" | "ready" | "needs_sign_in" | "error";
  message: string | null;
  result: CopilotWarmupResult | null;
}

function formatStage(stage: CopilotWarmupResult["stage"]): string {
  return stage.replaceAll("_", " ");
}

export function copilotWarmupHeadline(state: CopilotWarmupState): string {
  if (state.result?.connected) {
    return "Ready";
  }
  if (state.result?.loginRequired) {
    return "Needs sign-in";
  }
  switch (state.status) {
    case "ready":
      return "Ready";
    case "needs_sign_in":
      return "Needs sign-in";
    case "checking":
      return "Checking…";
    case "error":
      return "Needs attention";
    case "idle":
    default:
      return "Not checked yet";
  }
}

export function copilotWarmupStageDetail(state: CopilotWarmupState): string | null {
  if (!state.result) return null;
  const request = `request ${state.result.requestId.slice(0, 8)}`;
  const failure = state.result.failureCode ? `, ${state.result.failureCode}` : "";
  const statusCode = state.result.statusCode != null ? `, HTTP ${state.result.statusCode}` : "";
  return `Stage: ${formatStage(state.result.stage)}${failure}${statusCode}, ${request}`;
}

export function useCopilotWarmup(loadSettings: () => BrowserAutomationSettings | null | undefined) {
  const [copilotState, setCopilotState] = createSignal<CopilotWarmupState>({
    status: "idle",
    message: null,
    result: null,
  });

  const runCopilotWarmup = (focusMainWindow: boolean) => {
    const mockedUiSession =
      typeof window !== "undefined" &&
      (((window as unknown as { __RELAY_MOCK__?: unknown }).__RELAY_MOCK__ != null) ||
        ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null && !isTauri()));

    if (!isTauri() || mockedUiSession) {
      setCopilotState({
        status: "ready",
        message: "Preview mode: Copilot warmup is mocked.",
        result: {
          requestId: "preview-mode",
          connected: true,
          loginRequired: false,
          bootTokenPresent: false,
          cdpPort: loadSettings()?.cdpPort ?? 9360,
          stage: "ready",
          message: "Preview mode: Copilot warmup is mocked.",
          failureCode: null,
          statusCode: null,
          url: null,
        },
      });
      return;
    }
    setCopilotState({ status: "checking", message: "Checking Copilot connection…", result: null });
    void warmupCopilotBridge(loadSettings() ?? null)
      .then((r) => {
        if (r.loginRequired) {
          setCopilotState({
            status: "needs_sign_in",
            message: r.message,
            result: r,
          });
        } else if (r.connected) {
          setCopilotState({ status: "ready", message: r.message, result: r });
        } else {
          setCopilotState({ status: "error", message: r.message, result: r });
        }
      })
      .catch((err) => {
        console.error("[Copilot] warmup failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        setCopilotState({ status: "error", message: `Copilot: ${msg}`, result: null });
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
  onCleanup(() => {});

  return {
    copilotState,
    runCopilotWarmup,
  };
}
