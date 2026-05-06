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
  if (setup?.status === "needs_attention") {
    return "Relay could not finish setup. Review the stopped step below, then use Try Setup Again.";
  }
  if (copilotMessage && copilotMessage.toLowerCase().includes("sign")) return copilotMessage;
  if (setup?.status === "ready" && copilotMessage) return "Open OpenWork/OpenCode to begin.";
  if (setup?.status === "ready") return "Open OpenWork/OpenCode to begin.";
  return "Relay is preparing OpenWork/OpenCode and the Copilot connection.";
}

type SetupProgressStep = {
  id: string;
  label: string;
  detail: string;
};

type SetupProgressState = "done" | "current" | "blocked" | "waiting";

const OPENWORK_SETUP_STEPS: SetupProgressStep[] = [
  {
    id: "setup",
    label: "Prepare Relay",
    detail: "Create the setup workspace.",
  },
  {
    id: "provider_gateway",
    label: "Start provider",
    detail: "Start the local Copilot gateway.",
  },
  {
    id: "provider_config",
    label: "Write config",
    detail: "Connect OpenCode to Relay.",
  },
  {
    id: "download_openwork_opencode",
    label: "Get OpenWork/OpenCode",
    detail: "Download and verify the tools.",
  },
  {
    id: "openwork_handoff",
    label: "Prepare OpenWork",
    detail: "Finish the desktop handoff.",
  },
  {
    id: "ready",
    label: "Ready",
    detail: "OpenWork/OpenCode can start.",
  },
];

function inferSetupStage(diagnostics: RelayDiagnostics | null): string {
  const setup = diagnostics?.openworkSetup;
  if (!setup) return "setup";
  if (setup.status === "ready") return "ready";
  if (setup.stage && setup.stage !== "needs_attention") return setup.stage;

  const detail = setup.message.toLowerCase();
  if (detail.includes("provider gateway") || detail.includes("copilot_server") || detail.includes("18180")) {
    return "provider_gateway";
  }
  if (detail.includes("config")) return "provider_config";
  if (detail.includes("download") || detail.includes("extract") || detail.includes("probe opencode")) {
    return "download_openwork_opencode";
  }
  if (detail.includes("installer") || detail.includes("handoff") || detail.includes("openwork")) {
    return "openwork_handoff";
  }
  return "setup";
}

function setupProgressIndex(stage: string): number {
  const index = OPENWORK_SETUP_STEPS.findIndex((step) => step.id === stage);
  return index >= 0 ? index : 0;
}

function setupProgressPercent(index: number, status: string, needsAttention: boolean): number {
  const maxIndex = OPENWORK_SETUP_STEPS.length - 1;
  if (status === "ready") return 100;
  if (needsAttention) return Math.round(Math.max(8, (index / maxIndex) * 100));
  return Math.round(Math.min(95, ((index + 0.35) / maxIndex) * 100));
}

function normalizedProgressPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function setupStepState(index: number, currentIndex: number, status: string, needsAttention: boolean): SetupProgressState {
  if (status === "ready") return "done";
  if (index < currentIndex) return "done";
  if (index === currentIndex) return needsAttention ? "blocked" : "current";
  return "waiting";
}

function setupStepValue(state: SetupProgressState): string {
  if (state === "done") return "Done";
  if (state === "blocked") return "Needs attention";
  if (state === "current") return "In progress";
  return "Waiting";
}

function setupAttentionDetail(diagnostics: RelayDiagnostics | null): string | null {
  const setup = diagnostics?.openworkSetup;
  if (setup?.status !== "needs_attention") return null;
  return setup.progressDetail || setup.message || "Relay could not finish setup.";
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
    const setupStage = inferSetupStage(report);
    const progressIndex = setupProgressIndex(setupStage);
    const explicitProgressPercent = normalizedProgressPercent(report?.openworkSetup?.progressPercent);
    const progressPercent = explicitProgressPercent ?? setupProgressPercent(progressIndex, setupStatus, needsAttention);
    const currentStep = OPENWORK_SETUP_STEPS[progressIndex] ?? OPENWORK_SETUP_STEPS[0];
    const progressDetail = report?.openworkSetup?.progressDetail || currentStep.detail;
    const attentionDetail = setupAttentionDetail(report);
    return {
      title: setupTitle(report, copilot.status),
      message: setupMessage(report, copilot.message),
      status: setupStatus,
      setupStage,
      progressPercent,
      progressDetail,
      attentionDetail,
      currentStep,
      setupReady,
      copilotReady,
      needsSignIn,
      needsAttention,
      launchLabel: report?.openworkSetup?.launchLabel ?? "Open OpenWork/OpenCode",
      providerBaseUrl: report?.openworkSetup?.providerBaseUrl ?? endpoint(),
      configPath: report?.openworkSetup?.configPath ?? "~/.config/opencode/opencode.json",
      steps: [
        ...OPENWORK_SETUP_STEPS.map((step, index) => {
          const state = setupStepState(index, progressIndex, setupStatus, needsAttention);
          return {
            ...step,
            state,
            value: setupStepValue(state),
          };
        }),
        {
          id: "m365",
          label: "Microsoft 365",
          detail: "Check Copilot sign-in.",
          state: copilotReady ? "done" : needsSignIn ? "blocked" : "current",
          value: copilotReady ? "Signed in" : needsSignIn ? "Sign-in needed" : "Checking",
        },
      ] satisfies Array<SetupProgressStep & { state: SetupProgressState; value: string }>,
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
            <div
              class="ra-setup-progress mt-5"
              data-state={setupState().needsAttention ? "blocked" : setupState().status === "ready" ? "done" : "current"}
              aria-label="OpenWork/OpenCode setup progress"
            >
              <div class="ra-setup-progress__topline">
                <div>
                  <p class="ra-setup-progress__eyebrow">Setup progress</p>
                  <p class="ra-setup-progress__current">{setupState().currentStep.label}</p>
                </div>
                <p class="ra-setup-progress__percent">{setupState().progressPercent}%</p>
              </div>
              <div
                class="ra-setup-progress__bar"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={setupState().progressPercent}
                aria-label={`OpenWork/OpenCode setup is ${setupState().progressPercent}% complete`}
                aria-valuetext={`${setupState().currentStep.label}: ${setupState().progressDetail}`}
              >
                <div class="ra-setup-progress__fill" style={{ width: `${setupState().progressPercent}%` }} />
              </div>
              <p class="ra-setup-progress__hint">{setupState().progressDetail}</p>
            </div>
            <Show when={setupState().attentionDetail}>
              <div class="ra-setup-attention" role="status" aria-live="polite">
                <p class="ra-setup-attention__label">Setup stopped here</p>
                <p class="ra-setup-attention__detail">{setupState().attentionDetail}</p>
              </div>
            </Show>
            <div class="ra-setup-steps mt-4">
              {setupState().steps.map((step) => (
                <div class="ra-setup-step" data-state={step.state}>
                  <div class="ra-setup-step__marker" aria-hidden="true" />
                  <div class="ra-setup-step__copy">
                    <p class="ra-setup-step__label">{step.label}</p>
                    <p class="ra-setup-step__detail">{step.detail}</p>
                  </div>
                  <p class="ra-setup-step__value">{step.value}</p>
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
