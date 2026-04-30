/// <reference types="vite/client" />
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import {
  getRelayDiagnostics,
  openOpenworkOrOpencode,
  retryOpenworkSetup,
  type RelayDiagnostics,
} from "../lib/ipc";
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

async function showMainWindow() {
  try {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();
  } catch (error) {
    console.error("[Shell] window show/focus failed", error);
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
  const setup = diagnostics.openworkSetup;
  return [
    `architecture: ${diagnostics.architectureNotes}`,
    `target OS: ${diagnostics.targetOs}`,
    `process cwd: ${diagnostics.processCwd}`,
    `CDP port: ${diagnostics.defaultEdgeCdpPort}`,
    `bridge running: ${formatBool(diagnostics.copilotBridgeRunning)}`,
    `bridge connected: ${formatBool(diagnostics.copilotBridgeConnected)}`,
    `M365 sign-in required: ${formatBool(diagnostics.copilotBridgeLoginRequired)}`,
    `OpenCode runtime: ${diagnostics.opencodeRuntimeMessage ?? "unknown"}`,
    `OpenWork/OpenCode setup: ${setup?.status ?? "unknown"}`,
    `setup stage: ${setup?.stage ?? "unknown"}`,
    `setup detail: ${setup?.message ?? "unknown"}`,
    `setup config: ${setup?.configPath ?? "unknown"}`,
  ];
}

function setupTitle(diagnostics: RelayDiagnostics | null, copilotStatus: string): string {
  const setup = diagnostics?.openworkSetup;
  if (setup?.status === "needs_attention") return "Setup needs attention";
  if (copilotStatus === "needs_sign_in") return "Sign in to Microsoft 365";
  if (setup?.status === "ready" && copilotStatus === "ready") return "Ready to start";
  return "Setting things up";
}

function setupMessage(diagnostics: RelayDiagnostics | null, copilotMessage: string | null | undefined): string {
  const setup = diagnostics?.openworkSetup;
  if (setup?.status === "needs_attention") return "Relay could not finish setup. Try again, or open advanced details for support.";
  if (copilotMessage && copilotMessage.toLowerCase().includes("sign")) return copilotMessage;
  if (setup?.status === "ready" && copilotMessage) return "Open OpenWork/OpenCode to begin.";
  if (setup?.status === "ready") return "Open OpenWork/OpenCode to begin.";
  return "Relay is preparing OpenWork/OpenCode and the Copilot connection.";
}

function stepLabel(value: "ready" | "working" | "blocked"): string {
  if (value === "ready") return "Ready";
  if (value === "blocked") return "Needs attention";
  return "Preparing";
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
  const [openingWorkspace, setOpeningWorkspace] = createSignal(false);
  const [setupRetrying, setSetupRetrying] = createSignal(false);
  const { copilotState, runCopilotWarmup } = useCopilotWarmup(browserSettings);

  const workspace = createMemo(() => workspaceLabel() || "OpenCode/OpenWork workspace owns execution state");
  const endpoint = createMemo(providerBaseUrl);
  const diagLines = createMemo(() => diagnosticsSummary(diagnostics()));
  const setupState = createMemo(() => {
    const copilot = copilotState();
    const report = diagnostics();
    const setupStatus = report?.openworkSetup?.status ?? "preparing";
    const setupReady = setupStatus === "ready";
    const copilotReady = copilot.status === "ready";
    const needsSignIn = copilot.status === "needs_sign_in";
    const needsAttention = setupStatus === "needs_attention";
    return {
      title: setupTitle(report, copilot.status),
      message: setupMessage(report, copilot.message),
      status: setupStatus,
      setupReady,
      copilotReady,
      needsSignIn,
      needsAttention,
      launchLabel: report?.openworkSetup?.launchLabel ?? "Open OpenWork/OpenCode",
      providerBaseUrl: report?.openworkSetup?.providerBaseUrl ?? endpoint(),
      configPath: report?.openworkSetup?.configPath ?? "~/.config/opencode/opencode.json",
      steps: [
        {
          label: "OpenWork/OpenCode",
          value: stepLabel(needsAttention ? "blocked" : setupReady ? "ready" : "working"),
        },
        {
          label: "Microsoft 365",
          value: copilotReady ? "Signed in" : needsSignIn ? "Sign-in needed" : "Checking",
        },
        {
          label: "Start",
          value: setupReady && copilotReady ? "Open" : "Waiting",
        },
      ],
    };
  });

  onMount(() => {
    void showMainWindow();
    void runCopilotWarmup(false);
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

  const openWorkspace = async () => {
    setOpeningWorkspace(true);
    try {
      await openOpenworkOrOpencode();
      showToast({ tone: "ok", message: "Opening OpenWork/OpenCode" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast({ tone: "danger", message: "OpenWork/OpenCode is not ready", detail: message });
      await refreshDiagnostics(false);
    } finally {
      setOpeningWorkspace(false);
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
            <div class="mt-4 grid gap-3 md:grid-cols-3">
              {setupState().steps.map((step) => (
                <div class="rounded border border-[var(--ra-color-border)] bg-[var(--ra-color-surface-subtle)] p-3">
                  <p class="text-sm font-semibold">{step.label}</p>
                  <p class="mt-1 text-sm text-[var(--ra-color-text-muted)]">{step.value}</p>
                </div>
              ))}
            </div>
          </article>
          <div class="ra-surface flex flex-col justify-center gap-3 p-5">
            <Show
              when={setupState().needsAttention}
              fallback={
                <Show
                  when={setupState().needsSignIn}
                  fallback={
                    <button
                      type="button"
                      class="ra-button"
                      disabled={openingWorkspace() || !setupState().setupReady || !setupState().copilotReady}
                      onClick={openWorkspace}
                    >
                      {openingWorkspace() ? "Opening" : setupState().launchLabel}
                    </button>
                  }
                >
                  <button type="button" class="ra-button" onClick={reconnectCopilot}>
                    Check Microsoft Sign-In
                  </button>
                </Show>
              }
            >
              <button
                type="button"
                class="ra-button"
                disabled={setupRetrying()}
                onClick={retrySetup}
              >
                {setupRetrying() ? "Trying Again" : "Try Setup Again"}
              </button>
            </Show>
            <Show when={!setupState().needsAttention}>
              <button
                type="button"
                class="ra-button ra-button--secondary"
                disabled={setupRetrying()}
                onClick={retrySetup}
              >
                {setupRetrying() ? "Trying Again" : "Refresh Setup"}
              </button>
            </Show>
          </div>
        </section>

        <section class="grid gap-4 pb-5 md:grid-cols-2">
          <article class="ra-surface p-5">
            <h2 class="text-xl font-semibold">What happens next</h2>
            <div class="mt-4 grid gap-3 text-sm text-[var(--ra-color-text-muted)]">
              <p>Relay prepares OpenWork/OpenCode and connects it to Microsoft 365 Copilot.</p>
              <p>When the status is ready, press Open OpenWork/OpenCode and continue there.</p>
              <p>OpenWork/OpenCode keeps the chat, tools, approvals, files, and session history.</p>
            </div>
          </article>
          <article class="ra-surface p-5">
            <h2 class="text-xl font-semibold">If setup stops</h2>
            <div class="mt-4 grid gap-3 text-sm text-[var(--ra-color-text-muted)]">
              <p>Use Try Setup Again first. Relay will restart the setup without command line steps.</p>
              <p>If Microsoft 365 sign-in is needed, use Check Microsoft Sign-In.</p>
              <p>Advanced details are only needed when sharing a support report.</p>
            </div>
          </article>
        </section>

        <section class="pb-5">
          <details class="ra-surface p-5">
            <summary class="cursor-pointer text-lg font-semibold">Advanced diagnostics</summary>
            <div class="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div class="grid gap-3">
                <div class="rounded border border-[var(--ra-color-border)] p-4">
                  <p class="text-sm font-semibold">Workspace</p>
                  <p class="mt-2 break-all text-sm text-[var(--ra-color-text-muted)]">{workspace()}</p>
                </div>
                <div class="rounded border border-[var(--ra-color-border)] p-4">
                  <p class="text-sm font-semibold">Provider</p>
                  <p class="mt-2 break-all font-mono text-sm text-[var(--ra-color-text-muted)]">{endpoint()}</p>
                  <p class="mt-2 text-sm text-[var(--ra-color-text-muted)]">
                    Model id: <span class="font-mono">relay-agent/m365-copilot</span>
                  </p>
                </div>
                <div class="rounded border border-[var(--ra-color-border)] p-4">
                  <p class="text-sm font-semibold">Transport defaults</p>
                  <p class="mt-2 text-sm text-[var(--ra-color-text-muted)]">
                    CDP {browserSettings().cdpPort} · timeout {browserSettings().timeoutMs} ms · max turns {maxTurns()}
                  </p>
                </div>
              </div>

              <aside>
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
                      Refresh diagnostics to inspect provider bridge, CDP, M365 sign-in, and OpenWork/OpenCode status.
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
            </div>
          </details>
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
