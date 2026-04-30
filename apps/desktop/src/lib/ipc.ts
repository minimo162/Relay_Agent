/**
 * Tauri IPC bridge — provider diagnostics.
 *
 * Provider-mode execution does not use these commands. OpenCode/OpenWork calls
 * the OpenAI-compatible provider gateway directly and owns sessions, tools,
 * permissions, transcript state, and workspace execution.
 *
 * Diagnostic commands (tauri_bridge.rs):
 *   warmup_copilot_bridge (optional browserSettings), get_relay_diagnostics,
 *   connect_cdp, cdp_send_prompt, cdp_start_new_chat, cdp_screenshot
 *
 * Legacy agent chat/session commands are intentionally not exported from this
 * frontend bridge. Provider-mode execution belongs to OpenCode/OpenWork.
 *
 * Relay-owned agent events were removed with the hard-cut migration.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  BrowserAutomationSettings as GeneratedBrowserAutomationSettings,
  CdpConnectResult as GeneratedCdpConnectResult,
  CdpPromptResult as GeneratedCdpPromptResult,
  CdpSendPromptRequest as GeneratedCdpSendPromptRequest,
  ConnectCdpRequest as GeneratedConnectCdpRequest,
  RelayDiagnostics as GeneratedRelayDiagnostics,
} from "./ipc.generated";

/* ============================================================
   Request / Response types (Rust models.rs → camelCase)
   ============================================================ */

export type BrowserAutomationSettings = GeneratedBrowserAutomationSettings;

/** `get_relay_diagnostics` payload (camelCase from Rust). */
export type RelayDiagnostics = GeneratedRelayDiagnostics;

/* ============================================================
   Diagnostic Tauri commands
   ============================================================ */

export async function getRelayDiagnostics(): Promise<RelayDiagnostics> {
  return invoke<RelayDiagnostics>("get_relay_diagnostics");
}

/** Retry installed OpenWork/OpenCode provider setup. */
export async function retryOpenworkSetup(): Promise<void> {
  return invoke<void>("retry_openwork_setup");
}

/** Open the prepared OpenWork/OpenCode app when available. */
export async function openOpenworkOrOpencode(): Promise<void> {
  return invoke<void>("open_openwork_or_opencode");
}

/** Write support text (e.g. diagnostics JSON) to a path from the native save dialog. */
export async function writeTextExport(path: string, contents: string): Promise<void> {
  return invoke<void>("write_text_export", { path, contents });
}

/** Node bridge `GET /status` after ensuring Edge/Copilot tab (startup prewarm). */
export type CopilotWarmupStage =
  | "ensure_server"
  | "health_check"
  | "boot_token_auth"
  | "status_request"
  | "cdp_attach"
  | "copilot_tab"
  | "login_check"
  | "ready";

export type CopilotWarmupFailureCode =
  | "ensure_server_failed"
  | "health_check_failed"
  | "boot_token_unauthorized"
  | "status_http_error"
  | "status_transport_error"
  | "cdp_attach_failed"
  | "copilot_tab_unavailable"
  | "login_required"
  | "unknown";

export interface CopilotWarmupResult {
  requestId: string;
  connected: boolean;
  loginRequired: boolean;
  bootTokenPresent: boolean;
  cdpPort: number;
  stage: CopilotWarmupStage;
  message: string;
  failureCode?: CopilotWarmupFailureCode | null;
  statusCode?: number | null;
  url?: string | null;
}

export async function warmupCopilotBridge(
  browserSettings?: BrowserAutomationSettings | null,
): Promise<CopilotWarmupResult> {
  return invoke<CopilotWarmupResult>("warmup_copilot_bridge", {
    browserSettings: browserSettings ?? null,
  });
}

/* ============================================================
   CDP (Chrome DevTools Protocol) — M365 Copilot integration
   ============================================================ */

export type ConnectCdpRequest = GeneratedConnectCdpRequest;
export type CdpConnectResult = GeneratedCdpConnectResult;
export type CdpSendPromptRequest = GeneratedCdpSendPromptRequest;
export type CdpPromptResult = GeneratedCdpPromptResult;

/** Connect to M365 Copilot via Edge CDP */
export async function connectCdp(
  request: ConnectCdpRequest,
): Promise<CdpConnectResult> {
  return invoke<CdpConnectResult>("connect_cdp", { request });
}

/** Send a prompt to M365 Copilot and wait for the response */
export async function cdpSendPrompt(
  request: CdpSendPromptRequest,
): Promise<CdpPromptResult> {
  return invoke<CdpPromptResult>("cdp_send_prompt", { request });
}

/** Start a new chat in M365 Copilot */
export async function cdpStartNewChat(
  request: ConnectCdpRequest,
): Promise<CdpConnectResult> {
  return invoke<CdpConnectResult>("cdp_start_new_chat", { request });
}

/** Capture a screenshot of the Copilot browser */
export async function cdpScreenshot(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("cdp_screenshot", {});
}

/** Disconnect from the Copilot page and clean up the auto-launched browser */
export async function disconnectCdp(): Promise<void> {
  return invoke<void>("disconnect_cdp", {});
}
