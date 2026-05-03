import type { Page } from "@playwright/test";

type RelayMockConfig = {
  copilotReady?: boolean;
  openworkSetup?: Record<string, unknown>;
};

type RelayMockState = {
  invocations: Array<{ cmd: string; request: unknown }>;
  callbacks: Map<number, (event: { event: string; id: number; payload: unknown }) => void>;
  callbackCounter: number;
};

function initRelayMock(config: { copilotReady: boolean; openworkSetup?: Record<string, unknown> }) {
  function mockDiagnostics() {
    const openworkSetup = {
      status: "ready",
      stage: "ready",
      message: "OpenWork/OpenCode is configured to use M365 Copilot.",
      progressPercent: 100,
      progressDetail: "OpenWork/OpenCode setup is complete.",
      actionLabel: "Open OpenWork/OpenCode",
      launchLabel: "Open OpenWork/OpenCode",
      providerBaseUrl: "http://127.0.0.1:18180/v1",
      configPath: "~/.config/opencode/opencode.json",
      updatedAt: "2026-04-29T00:00:00Z",
      ...config.openworkSetup,
    };
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
      openworkSetup,
    };
  }

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
      case "retry_openwork_setup":
        return undefined;
      case "open_openwork_or_opencode":
        return undefined;
      case "write_text_export":
        return undefined;
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
  (window as any).__RELAY_MOCK_CONFIG__ = config;
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
    openworkSetup: config?.openworkSetup,
  });
}
