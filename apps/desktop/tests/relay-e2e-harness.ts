import type { Page } from "@playwright/test";

type RelayMockConfig = {
  copilotReady?: boolean;
};

type RelayMockState = {
  invocations: Array<{ cmd: string; request: unknown }>;
  callbacks: Map<number, (event: { event: string; id: number; payload: unknown }) => void>;
  callbackCounter: number;
};

function mockDiagnostics() {
  return {
    appVersion: "0.0.0-mock",
    targetOs: "linux",
    copilotNodeBridgePort: 18080,
    defaultEdgeCdpPort: 9360,
    relayAgentDevMode: false,
    architectureNotes: "mock provider diagnostics",
    processCwd: "/mock",
    clawConfigHomeDisplay: "~/.claw (mock)",
    maxTextFileReadBytes: 10485760,
    doctorHints: ["mock"],
    predictabilityNotes: ["mock"],
    copilotRepairStageStats: [],
    copilotBridgeRunning: true,
    copilotBridgeConnected: true,
    copilotBridgeLoginRequired: false,
    opencodeRuntimeMessage: "mock runtime ready",
  };
}

function initRelayMock(config: { copilotReady: boolean }) {
  const state: RelayMockState = {
    invocations: [],
    callbacks: new Map(),
    callbackCounter: 0,
  };

  const invoke = async (cmd: string, args: any) => {
    const req = args?.request ?? args ?? {};
    state.invocations.push({ cmd, request: req });
    switch (cmd) {
      case "warmup_copilot_bridge":
        return {
          connected: config.copilotReady,
          loginRequired: false,
          bootTokenPresent: true,
          cdpPort: 9360,
          stage: config.copilotReady ? "ready" : "status_request",
          message: config.copilotReady ? "Mock Copilot ready" : "Mock Copilot unavailable",
          failureCode: null,
          statusCode: 200,
          url: "https://m365.cloud.microsoft/chat",
        };
      case "get_relay_diagnostics":
        return mockDiagnostics();
      case "write_text_export":
      case "remove_workspace_allowlist_tool":
      case "clear_workspace_allowlist":
        return undefined;
      case "get_workspace_allowlist":
        return {
          storePath: "/mock/.relay-agent/workspace_allowed_tools.json",
          entries: [],
          warnings: [],
        };
      case "list_workspace_slash_commands":
      case "list_workspace_skills":
        return [];
      case "workspace_instruction_surfaces":
        return { workspaceRoot: null, surfaces: [] };
      case "probe_rust_analyzer":
        return { ok: false, versionLine: null, error: "mock: rust-analyzer not available" };
      case "connect_cdp":
      case "cdp_start_new_chat":
        return {
          ok: true,
          debugUrl: "http://127.0.0.1:9360",
          pageUrl: "https://m365.cloud.microsoft/chat",
          pageTitle: "M365 Copilot",
          port: 9360,
          launched: false,
          error: null,
        };
      case "cdp_send_prompt":
        return { ok: true, responseText: "", bodyLength: 0, error: null };
      case "cdp_screenshot":
        return { ok: true, screenshot: "base64" };
      case "disconnect_cdp":
        return undefined;
      default:
        throw new Error("[mock] Unknown diagnostic command: " + cmd);
    }
  };

  (window as any).__RELAY_MOCK__ = state;
  (window as any).__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(callback: (event: { event: string; id: number; payload: unknown }) => void) {
      state.callbackCounter += 1;
      state.callbacks.set(state.callbackCounter, callback);
      return state.callbackCounter;
    },
    unregisterCallback(callbackId: number) {
      state.callbacks.delete(callbackId);
    },
  };
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener() {
      return undefined;
    },
  };
}

export async function injectRelayMock(page: Page, config?: RelayMockConfig) {
  await page.addInitScript(initRelayMock, {
    copilotReady: config?.copilotReady ?? true,
  });
}
