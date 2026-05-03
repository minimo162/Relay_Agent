/**
 * E2E mock for @tauri-apps/api/core.
 */

function mockDiagnostics() {
  const config = (window as any).__RELAY_MOCK_CONFIG__ ?? {};
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
    predictabilityNotes: ["mock predictability"],
    copilotRepairStageStats: [],
    copilotBridgeRunning: true,
    copilotBridgeConnected: true,
    copilotBridgeLoginRequired: false,
    opencodeRuntimeMessage: "mock runtime ready",
    openworkSetup,
  };
}

const state = (window as any).__RELAY_MOCK__ ??= {
  invocations: [] as Array<{ cmd: string; request: unknown }>,
};

export function isTauri(): boolean {
  return false;
}

export async function invoke(cmd: string, args: any): Promise<unknown> {
  const req = args?.request ?? args ?? {};
  state.invocations ??= [];
  state.invocations.push({ cmd, request: req });

  switch (cmd) {
    case "warmup_copilot_bridge":
      const config = (window as any).__RELAY_MOCK_CONFIG__ ?? {};
      const copilotReady = config.copilotReady ?? true;
      return {
        connected: copilotReady,
        loginRequired: false,
        bootTokenPresent: true,
        cdpPort: 9360,
        stage: copilotReady ? "ready" : "status_request",
        message: copilotReady ? "Mock Copilot ready" : "Mock Copilot unavailable",
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
      throw new Error(`[mock] Unknown diagnostic invoke: ${cmd}`);
  }
}
