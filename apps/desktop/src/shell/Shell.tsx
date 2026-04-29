/// <reference types="vite/client" />
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { getRelayDiagnostics, retryOpenworkSetup, type RelayDiagnostics } from "../lib/ipc";
import {
  loadAlwaysOnTop,
  loadBrowserSettings,
  loadMaxTurns,
  loadWorkspacePath,
} from "../lib/settings-storage";
import { showToast } from "../lib/status-toasts";
import { SettingsModal, type ShellSettingsDraft } from "../components/SettingsModal";
import { StatusToasts } from "../components/StatusToasts";
import { useCopilotWarmup } from "./useCopilotWarmup";

async function applyAlwaysOnTopSetting(enabled: boolean) {
  try {
    await getCurrentWindow().setAlwaysOnTop(enabled);
  } catch (error) {
    console.error("[DiagnosticShell] setAlwaysOnTop failed", error);
  }
}

function providerBaseUrl(): string {
  const port = import.meta.env.VITE_RELAY_OPENCODE_PROVIDER_PORT || "18180";
  return `http://127.0.0.1:${port}/v1`;
}

function formatBool(value: boolean | null | undefined): string {
  if (value == null) return "unknown";
  return value ? "yes" : "no";
}

function diagnosticsSummary(diagnostics: RelayDiagnostics | null): string[] {
  if (!diagnostics) return [];
  return [
    `architecture: ${diagnostics.architectureNotes}`,
    `target OS: ${diagnostics.targetOs}`,
    `process cwd: ${diagnostics.processCwd}`,
    `CDP port: ${diagnostics.defaultEdgeCdpPort}`,
    `bridge running: ${formatBool(diagnostics.copilotBridgeRunning)}`,
    `bridge connected: ${formatBool(diagnostics.copilotBridgeConnected)}`,
    `M365 sign-in required: ${formatBool(diagnostics.copilotBridgeLoginRequired)}`,
    `OpenCode runtime: ${diagnostics.opencodeRuntimeMessage ?? "unknown"}`,
    `OpenWork/OpenCode setup: ${diagnostics.openworkSetup?.status ?? "unknown"}`,
  ];
}

function setupTitle(diagnostics: RelayDiagnostics | null, copilotStatus: string): string {
  const setup = diagnostics?.openworkSetup;
  if (setup?.status === "needs_attention") return "Needs attention";
  if (setup?.status === "preparing") return "Preparing";
  if (copilotStatus === "needs_sign_in") return "Sign in to M365";
  if (setup?.status === "ready" && copilotStatus === "ready") return "Ready";
  return "Preparing";
}

function setupMessage(diagnostics: RelayDiagnostics | null, copilotMessage: string | null | undefined): string {
  const setup = diagnostics?.openworkSetup;
  if (setup?.status === "ready" && copilotMessage) return copilotMessage;
  return setup?.message ?? "Preparing OpenWork/OpenCode for M365 Copilot.";
}

export default function Shell(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [workspaceLabel, setWorkspaceLabel] = createSignal(loadWorkspacePath().trim());
  const [browserSettings, setBrowserSettings] = createSignal(loadBrowserSettings());
  const [maxTurns, setMaxTurns] = createSignal(loadMaxTurns());
  const [alwaysOnTop, setAlwaysOnTop] = createSignal(loadAlwaysOnTop());
  const [diagnostics, setDiagnostics] = createSignal<RelayDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = createSignal(false);
  const [diagnosticsError, setDiagnosticsError] = createSignal<string | null>(null);
  const [setupRetrying, setSetupRetrying] = createSignal(false);
  const { copilotState, runCopilotWarmup } = useCopilotWarmup(browserSettings);

  const workspace = createMemo(() => workspaceLabel() || "OpenCode/OpenWork workspace owns execution state");
  const endpoint = createMemo(providerBaseUrl);
  const diagLines = createMemo(() => diagnosticsSummary(diagnostics()));
  const setupState = createMemo(() => {
    const copilot = copilotState();
    const report = diagnostics();
    return {
      title: setupTitle(report, copilot.status),
      message: setupMessage(report, copilot.message),
      status: report?.openworkSetup?.status ?? "preparing",
      providerBaseUrl: report?.openworkSetup?.providerBaseUrl ?? endpoint(),
      configPath: report?.openworkSetup?.configPath ?? "~/.config/opencode/opencode.json",
    };
  });

  onMount(() => {
    void runCopilotWarmup(true);
    void refreshDiagnostics(false);
    const timer = window.setInterval(() => {
      const setup = diagnostics()?.openworkSetup?.status;
      if (setup !== "ready") {
        void refreshDiagnostics(false);
      }
    }, 2500);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    void applyAlwaysOnTopSetting(alwaysOnTop());
  });

  const refreshDiagnostics = async (showSuccess = true) => {
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    try {
      const report = await getRelayDiagnostics();
      setDiagnostics(report);
      if (showSuccess) showToast({ tone: "ok", message: "Diagnostics refreshed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDiagnosticsError(message);
      showToast({ tone: "danger", message: "Diagnostics unavailable", detail: message });
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const reconnectCopilot = () => {
    void runCopilotWarmup(false);
  };

  const retrySetup = async () => {
    setSetupRetrying(true);
    try {
      await retryOpenworkSetup();
      showToast({ tone: "ok", message: "OpenWork/OpenCode setup restarted" });
      await refreshDiagnostics(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast({ tone: "danger", message: "Setup retry failed", detail: message });
    } finally {
      setSetupRetrying(false);
    }
  };

  const applySettings = (settings: ShellSettingsDraft) => {
    setWorkspaceLabel(settings.workspacePath);
    setBrowserSettings(settings.browserSettings);
    setMaxTurns(settings.maxTurns);
    setAlwaysOnTop(settings.alwaysOnTop);
  };

  return (
    <main class="min-h-screen bg-[var(--ra-color-bg)] text-[var(--ra-color-text)]">
      <div class="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-5">
        <header
          role="banner"
          class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ra-color-border)] pb-4"
        >
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ra-color-text-muted)]">
              OpenWork/OpenCode setup + M365 Copilot gateway
            </p>
            <h1 class="text-2xl font-semibold">Relay Agent</h1>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="ra-button ra-button--secondary" onClick={reconnectCopilot}>
              Reconnect Copilot
            </button>
            <button type="button" class="ra-button" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          </div>
        </header>

        <section class="grid gap-4 py-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <article class="ra-surface p-5">
            <p class="text-sm font-semibold text-[var(--ra-color-text-muted)]">OpenWork/OpenCode</p>
            <h2 class="mt-2 text-2xl font-semibold">{setupState().title}</h2>
            <p class="mt-2 max-w-3xl text-sm text-[var(--ra-color-text-muted)]">{setupState().message}</p>
            <div class="mt-4 grid gap-3 md:grid-cols-2">
              <p class="break-all rounded border border-[var(--ra-color-border)] bg-[var(--ra-color-surface-subtle)] p-3 text-sm">
                Provider: <span class="font-mono">{setupState().providerBaseUrl}</span>
              </p>
              <p class="break-all rounded border border-[var(--ra-color-border)] bg-[var(--ra-color-surface-subtle)] p-3 text-sm">
                Config: <span class="font-mono">{setupState().configPath}</span>
              </p>
            </div>
          </article>
          <div class="ra-surface flex flex-col justify-center gap-3 p-5">
            <button
              type="button"
              class="ra-button"
              disabled={setupRetrying()}
              onClick={retrySetup}
            >
              {setupRetrying() ? "Retrying" : "Retry Setup"}
            </button>
            <button type="button" class="ra-button ra-button--secondary" onClick={reconnectCopilot}>
              Check Sign-In
            </button>
          </div>
        </section>

        <section class="grid gap-4 py-5 md:grid-cols-3">
          <article class="ra-surface p-4">
            <p class="text-sm font-semibold text-[var(--ra-color-text-muted)]">Product UX</p>
            <h2 class="mt-2 text-lg font-semibold">OpenCode/OpenWork</h2>
            <p class="mt-2 text-sm text-[var(--ra-color-text-muted)]">
              Owns sessions, tools, permissions, transcript, MCP, plugins, skills, and workspace execution.
            </p>
          </article>
          <article class="ra-surface p-4">
            <p class="text-sm font-semibold text-[var(--ra-color-text-muted)]">Provider Endpoint</p>
            <h2 class="mt-2 break-all font-mono text-base">{endpoint()}</h2>
            <p class="mt-2 text-sm text-[var(--ra-color-text-muted)]">
              Model id: <span class="font-mono">relay-agent/m365-copilot</span>
            </p>
          </article>
          <article class="ra-surface p-4">
            <p class="text-sm font-semibold text-[var(--ra-color-text-muted)]">Copilot Transport</p>
            <h2 class="mt-2 text-lg font-semibold">
              {copilotState().status === "ready"
                ? "Ready"
                : copilotState().status === "checking"
                  ? "Checking"
                  : copilotState().status === "needs_sign_in"
                    ? "Sign in required"
                    : "Needs attention"}
            </h2>
            <p class="mt-2 text-sm text-[var(--ra-color-text-muted)]">
              {copilotState().message ?? "Edge CDP and M365 Copilot readiness are checked through diagnostics."}
            </p>
          </article>
        </section>

        <section class="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div class="ra-surface p-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="text-xl font-semibold">OpenWork/OpenCode Setup</h2>
                <p class="mt-2 max-w-2xl text-sm text-[var(--ra-color-text-muted)]">
                  This desktop surface is diagnostic-only. Production starts with the OpenWork/OpenCode auto
                  bootstrap, then OpenWork/OpenCode owns chat, tool execution, approvals, and session history.
                </p>
              </div>
              <span class="rounded-full border border-[var(--ra-color-border)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ra-color-text-muted)]">
                Diagnostic shell
              </span>
            </div>

            <div class="mt-5 grid gap-3">
              <code class="block overflow-x-auto rounded border border-[var(--ra-color-border)] bg-[var(--ra-color-surface-subtle)] p-3 text-sm">
                pnpm dev
              </code>
              <code class="block overflow-x-auto rounded border border-[var(--ra-color-border)] bg-[var(--ra-color-surface-subtle)] p-3 text-sm">
                pnpm bootstrap:openwork-opencode:auto
              </code>
              <code class="block overflow-x-auto rounded border border-[var(--ra-color-border)] bg-[var(--ra-color-surface-subtle)] p-3 text-sm">
                pnpm smoke:openwork-opencode-bootstrap-gateway
              </code>
            </div>

            <div class="mt-6 grid gap-3 md:grid-cols-2">
              <div class="rounded border border-[var(--ra-color-border)] p-4">
                <p class="text-sm font-semibold">Workspace</p>
                <p class="mt-2 break-all text-sm text-[var(--ra-color-text-muted)]">{workspace()}</p>
              </div>
              <div class="rounded border border-[var(--ra-color-border)] p-4">
                <p class="text-sm font-semibold">Diagnostic Defaults</p>
                <p class="mt-2 text-sm text-[var(--ra-color-text-muted)]">
                  CDP {browserSettings().cdpPort} · timeout {browserSettings().timeoutMs} ms · max turns {maxTurns()}
                </p>
              </div>
            </div>
          </div>

          <aside class="ra-surface p-5">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-lg font-semibold">Diagnostics</h2>
              <button
                type="button"
                class="ra-button ra-button--secondary"
                disabled={diagnosticsLoading()}
                onClick={() => refreshDiagnostics()}
              >
                {diagnosticsLoading() ? "Refreshing" : "Refresh"}
              </button>
            </div>
            <Show
              when={diagnostics()}
              fallback={
                <p class="mt-4 text-sm text-[var(--ra-color-text-muted)]">
                  Refresh diagnostics to inspect provider bridge, CDP, M365 sign-in, and OpenCode/OpenWork status.
                </p>
              }
            >
              <div class="mt-4 grid gap-2 text-sm">
                {diagLines().map((line) => (
                  <p class="break-words rounded border border-[var(--ra-color-border)] bg-[var(--ra-color-surface-subtle)] p-2">
                    {line}
                  </p>
                ))}
              </div>
            </Show>
            <Show when={diagnosticsError()}>
              <p class="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">
                {diagnosticsError()}
              </p>
            </Show>
          </aside>
        </section>
      </div>

      <SettingsModal
        open={settingsOpen()}
        onClose={() => setSettingsOpen(false)}
        onApply={applySettings}
        copilotState={copilotState()}
        onReconnectCopilot={reconnectCopilot}
      />
      <StatusToasts />
    </main>
  );
}
