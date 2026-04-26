/**
 * E2E mock for @tauri-apps/api/core.
 */

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
    predictabilityNotes: ["mock predictability"],
    copilotRepairStageStats: [],
    copilotBridgeRunning: true,
    copilotBridgeConnected: true,
    copilotBridgeLoginRequired: false,
    opencodeRuntimeMessage: "mock runtime ready",
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
      return {
        connected: true,
        loginRequired: false,
        bootTokenPresent: true,
        cdpPort: 9360,
        stage: "ready",
        message: "Mock Copilot ready",
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
      return { storePath: "/mock/.relay-agent/workspace_allowed_tools.json", entries: [], warnings: [] };
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
      throw new Error(`[mock] Unknown diagnostic invoke: ${cmd}`);
  }
}
