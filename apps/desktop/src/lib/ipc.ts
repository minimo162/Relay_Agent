/**
 * Tauri IPC bridge for the Relay desktop workbench.
 *
 * The current product surface uses these commands directly for workspace
 * state, document search, OfficeCLI execution, and M365 Copilot planning.
 *
 * Diagnostic commands (tauri_bridge.rs):
 *   warmup_copilot_bridge (optional browserSettings), get_relay_diagnostics,
 *   connect_cdp, cdp_send_prompt, cdp_start_new_chat, cdp_screenshot
 *   (`cdp_send_prompt` is routed through the Node Copilot bridge; direct CDP
 *   send is kept backend-side only for diagnostics.)
 *
 * Legacy agent chat/session commands are intentionally not exported from this
 * frontend bridge.
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
  RelayCodeContextFile as GeneratedRelayCodeContextFile,
  RelayCodeContextRequest as GeneratedRelayCodeContextRequest,
  RelayCodeContextResponse as GeneratedRelayCodeContextResponse,
  RelayCodePatchApplyRequest as GeneratedRelayCodePatchApplyRequest,
  RelayCodePatchApplyResponse as GeneratedRelayCodePatchApplyResponse,
  RelayCodePatchEdit as GeneratedRelayCodePatchEdit,
  RelayDocumentSearchRequest as GeneratedRelayDocumentSearchRequest,
  RelayDocumentSearchResponse as GeneratedRelayDocumentSearchResponse,
  RelayDocumentSearchQueryPlanHints as GeneratedRelayDocumentSearchQueryPlanHints,
  RelaySearchResultCard as GeneratedRelaySearchResultCard,
  RelayDiagnostics as GeneratedRelayDiagnostics,
  RelayOfficeCommandResponse as GeneratedRelayOfficeCommandResponse,
  RelayOfficeExecuteRequest as GeneratedRelayOfficeExecuteRequest,
  RelayOfficeInspectRequest as GeneratedRelayOfficeInspectRequest,
  RelayWorkspaceState as GeneratedRelayWorkspaceState,
} from "./ipc.generated";

/* ============================================================
   Request / Response types (Rust models.rs → camelCase)
   ============================================================ */

export type BrowserAutomationSettings = GeneratedBrowserAutomationSettings;

/** `get_relay_diagnostics` payload (camelCase from Rust). */
export type RelayDiagnostics = GeneratedRelayDiagnostics;
export type RelayWorkspaceState = GeneratedRelayWorkspaceState;
export type RelayDocumentSearchRequest = GeneratedRelayDocumentSearchRequest;
export type RelayDocumentSearchResponse = GeneratedRelayDocumentSearchResponse;
export type RelayDocumentSearchQueryPlanHints = GeneratedRelayDocumentSearchQueryPlanHints;
export type RelaySearchResultCard = GeneratedRelaySearchResultCard;
export type RelayOfficeInspectRequest = GeneratedRelayOfficeInspectRequest;
export type RelayOfficeExecuteRequest = GeneratedRelayOfficeExecuteRequest;
export type RelayOfficeCommandResponse = GeneratedRelayOfficeCommandResponse;
export type RelayCodeContextRequest = GeneratedRelayCodeContextRequest;
export type RelayCodeContextFile = GeneratedRelayCodeContextFile;
export type RelayCodeContextResponse = GeneratedRelayCodeContextResponse;
export type RelayCodePatchEdit = GeneratedRelayCodePatchEdit;
export type RelayCodePatchApplyRequest = GeneratedRelayCodePatchApplyRequest;
export type RelayCodePatchApplyResponse = GeneratedRelayCodePatchApplyResponse;

/* ============================================================
   Diagnostic Tauri commands
   ============================================================ */

export async function getRelayDiagnostics(): Promise<RelayDiagnostics> {
  return invoke<RelayDiagnostics>("get_relay_diagnostics");
}

export async function getRelayWorkspaceState(
  workspacePath?: string | null,
): Promise<RelayWorkspaceState> {
  return invoke<RelayWorkspaceState>("get_relay_workspace_state", {
    workspacePath: workspacePath?.trim() || null,
  });
}

export async function runRelayDocumentSearch(
  request: RelayDocumentSearchRequest,
): Promise<RelayDocumentSearchResponse> {
  return invoke<RelayDocumentSearchResponse>("run_relay_document_search", { request });
}

export async function inspectOfficeFile(
  request: RelayOfficeInspectRequest,
): Promise<RelayOfficeCommandResponse> {
  return invoke<RelayOfficeCommandResponse>("inspect_office_file", { request });
}

export async function executeOfficeCliCommand(
  request: RelayOfficeExecuteRequest,
): Promise<RelayOfficeCommandResponse> {
  return invoke<RelayOfficeCommandResponse>("execute_officecli_command", { request });
}

export async function collectCodeContext(
  request: RelayCodeContextRequest,
): Promise<RelayCodeContextResponse> {
  return invoke<RelayCodeContextResponse>("collect_code_context", { request });
}

export async function applyCodePatch(
  request: RelayCodePatchApplyRequest,
): Promise<RelayCodePatchApplyResponse> {
  return invoke<RelayCodePatchApplyResponse>("apply_code_patch", { request });
}

/** Retry the historical OpenCode setup path. Not used by the current workbench. */
export async function retryOpencodeSetup(): Promise<void> {
  return invoke<void>("retry_opencode_setup");
}

/** Open the historical OpenCode Web handoff when available. Not used by the current workbench. */
export async function openOpencodeWeb(workspace?: string): Promise<void> {
  return invoke<void>("open_opencode_web", {
    workspace: workspace?.trim() || null,
  });
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
