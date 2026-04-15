import { Show, createEffect, createSignal, type JSX } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { BrowserAutomationSettings, SessionPreset } from "../lib/ipc";
import { getRelayDiagnostics, writeTextExport } from "../lib/ipc";
import {
  loadAlwaysOnTop,
  loadBrowserSettings,
  loadDefaultSessionPreset,
  loadMaxTurns,
  loadWorkspacePath,
  saveAlwaysOnTop,
  saveBrowserSettings,
  saveDefaultSessionPreset,
  saveMaxTurns,
  saveWorkspacePath,
} from "../lib/settings-storage";
import { sessionModeLabel, sessionModeSummary } from "../lib/session-mode-label";
import {
  copilotWarmupHeadline,
  copilotWarmupStageDetail,
  type CopilotWarmupState,
} from "../shell/useCopilotWarmup";
import { Button, Input } from "./ui";

export interface ShellSettingsDraft {
  workspacePath: string;
  browserSettings: BrowserAutomationSettings;
  maxTurns: number;
  sessionPreset: SessionPreset;
  alwaysOnTop: boolean;
}

export function SettingsModal(props: {
  open: boolean;
  onClose: () => void;
  onApply: (settings: ShellSettingsDraft) => void;
  copilotState: CopilotWarmupState;
  onReconnectCopilot: () => void;
}): JSX.Element {
  let closeButtonRef!: HTMLButtonElement;
  let workspaceInputRef!: HTMLInputElement;
  let panelRef!: HTMLDivElement;
  let lastFocusedElement: HTMLElement | null = null;
  let wasOpen = false;
  const [workspace, setWorkspace] = createSignal("");
  const [sessionPreset, setSessionPreset] = createSignal<SessionPreset>("build");
  const [maxTurns, setMaxTurns] = createSignal("16");
  const [cdpPort, setCdpPort] = createSignal("9360");
  const [timeoutMs, setTimeoutMs] = createSignal("120000");
  const [autoLaunchEdge, setAutoLaunchEdge] = createSignal(true);
  const [alwaysOnTop, setAlwaysOnTop] = createSignal(false);
  const [hint, setHint] = createSignal<string | null>(null);
  const [exporting, setExporting] = createSignal(false);

  createEffect(() => {
    if (props.open && !wasOpen) {
      lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const browser = loadBrowserSettings();
      setWorkspace(loadWorkspacePath());
      setSessionPreset(loadDefaultSessionPreset());
      setMaxTurns(String(loadMaxTurns()));
      setCdpPort(String(browser.cdpPort));
      setTimeoutMs(String(browser.timeoutMs));
      setAutoLaunchEdge(browser.autoLaunchEdge);
      setAlwaysOnTop(loadAlwaysOnTop());
      setHint(null);
      queueMicrotask(() => {
        (workspaceInputRef ?? closeButtonRef)?.focus();
      });
    } else if (!props.open && wasOpen) {
      queueMicrotask(() => {
        if (lastFocusedElement && document.contains(lastFocusedElement)) {
          lastFocusedElement.focus();
        }
      });
    }
    wasOpen = props.open;
  });

  const handleDialogKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = panelRef?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const ordered = Array.from(focusables).filter((el) => !el.hasAttribute("disabled"));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !panelRef.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const persist = () => {
    const nextMaxTurns = Math.min(256, Math.max(1, parseInt(maxTurns(), 10) || 16));
    const nextBrowserSettings: BrowserAutomationSettings = {
      cdpPort: Math.max(1, parseInt(cdpPort(), 10) || 9360),
      timeoutMs: Math.max(10_000, parseInt(timeoutMs(), 10) || 120_000),
      autoLaunchEdge: autoLaunchEdge(),
    };
    const next: ShellSettingsDraft = {
      workspacePath: workspace().trim(),
      browserSettings: nextBrowserSettings,
      maxTurns: nextMaxTurns,
      sessionPreset: sessionPreset(),
      alwaysOnTop: alwaysOnTop(),
    };
    saveWorkspacePath(next.workspacePath);
    saveDefaultSessionPreset(next.sessionPreset);
    saveMaxTurns(next.maxTurns);
    saveBrowserSettings(next.browserSettings);
    saveAlwaysOnTop(next.alwaysOnTop);
    props.onApply(next);
    setHint("Settings saved.");
    props.onClose();
  };

  const pickWorkspaceFolder = async () => {
    if (!isTauri()) return;
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: workspace().trim() || undefined,
      });
      if (selected == null) return;
      setWorkspace(selected);
    } catch (error) {
      console.error("[Settings] folder dialog failed", error);
    }
  };

  const exportDiagnostics = async () => {
    if (!isTauri()) return;
    setExporting(true);
    try {
      const path = await save({
        defaultPath: "relay-diagnostics.json",
      });
      if (!path) return;
      const diagnostics = await getRelayDiagnostics();
      await writeTextExport(path, JSON.stringify(diagnostics, null, 2));
      setHint("Diagnostics exported.");
    } catch (error) {
      console.error("[Settings] diagnostics export failed", error);
      setHint("Couldn't export diagnostics.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Show when={props.open}>
      <div
        class="absolute inset-0 z-20"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onKeyDown={handleDialogKeyDown}
      >
        <button
          type="button"
          class="ra-modal-backdrop absolute inset-0 cursor-default border-0 p-0"
          aria-label="Close"
          onClick={() => props.onClose()}
        />
        <div class="absolute inset-x-0 top-6 mx-auto w-full max-w-3xl max-h-[min(92vh,52rem)] overflow-y-auto pointer-events-none flex justify-center px-4">
          <div ref={panelRef} class="ra-modal-panel w-full pointer-events-auto">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="ra-modal-panel__title">Settings</p>
                <p class="ra-type-button-label text-[var(--ra-text-secondary)] mt-1">
                  Configure Relay&apos;s project folder, Copilot connection, and desktop behavior.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                class="ra-type-caption text-[var(--ra-text-muted)] hover:text-[var(--ra-text-primary)]"
                onClick={() => props.onClose()}
              >
                Close
              </button>
            </div>

            <div class="mt-5 space-y-4">
              <section class="ra-settings-card">
                <p class="ra-type-system-micro text-[var(--ra-text-muted)]">Basic</p>
                <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                  Choose the project and confirm that Copilot is ready.
                </p>
                <div class="mt-3 space-y-4">
                  <div class="ra-settings-step ra-settings-step--highlight">
                    <span class="ra-type-system-micro text-[var(--ra-text-muted)]">Step 1 · Project</span>
                    <div class="flex gap-2 mt-1 items-stretch">
                      <Input
                        ref={workspaceInputRef}
                        class="ra-type-mono-small flex-1 min-w-0"
                        placeholder="/path/to/project"
                        value={workspace()}
                        onInput={(e) => setWorkspace(e.currentTarget.value)}
                        data-ra-settings-workspace=""
                      />
                      <Show when={isTauri()}>
                        <Button
                          variant="secondary"
                          type="button"
                          class="ra-type-button-label shrink-0 px-3"
                          onClick={() => void pickWorkspaceFolder()}
                        >
                          Browse…
                        </Button>
                      </Show>
                    </div>
                    <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                      Relay reads and edits within this folder, so point it at the project you want this window to use.
                    </p>
                  </div>

                  <div class="ra-settings-status ra-settings-status--highlight">
                    <div>
                      <span class="ra-type-system-micro text-[var(--ra-text-muted)]">Step 2 · Copilot</span>
                      <p class="ra-type-button-label text-[var(--ra-text-primary)] mt-1">
                        {copilotWarmupHeadline(props.copilotState)}
                      </p>
                      <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                        {copilotWarmupStageDetail(props.copilotState)
                          ?? props.copilotState.message
                          ?? "Run a check to verify the Edge/CDP connection."}
                      </p>
                      <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                        Relay uses Edge to reach Copilot. If this is not ready, reconnect after signing in.
                      </p>
                    </div>
                    <Button variant="secondary" type="button" class="ra-type-button-label" onClick={props.onReconnectCopilot}>
                      Reconnect Copilot
                    </Button>
                  </div>
                </div>
              </section>

              <details class="ra-settings-card ra-settings-details">
                <summary class="ra-settings-details__summary">
                  <div>
                    <p class="ra-type-system-micro text-[var(--ra-text-muted)]">Advanced</p>
                    <p class="ra-type-button-label text-[var(--ra-text-primary)] mt-1">Browser and troubleshooting options</p>
                  </div>
                  <span class="ra-type-caption text-[var(--ra-text-muted)]">Show</span>
                </summary>
                <div class="mt-3 space-y-4">
                  <div class="ra-settings-step">
                    <span class="ra-type-system-micro text-[var(--ra-text-muted)]">Conversation defaults</span>
                    <p class="ra-type-button-label text-[var(--ra-text-primary)] mt-1">Default chat mode</p>
                    <div class="ra-settings-segmented mt-2" role="group" aria-label="Default chat mode">
                      {(["build", "plan", "explore"] as SessionPreset[]).map((preset) => (
                        <button
                          type="button"
                          class={`ra-settings-segmented__option ${sessionPreset() === preset ? "is-selected" : ""}`}
                          aria-pressed={sessionPreset() === preset}
                          onClick={() => setSessionPreset(preset)}
                        >
                          <span>{sessionModeLabel(preset)}</span>
                        </button>
                      ))}
                    </div>
                    <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                      {sessionModeSummary(sessionPreset())}
                    </p>
                  </div>

                  <div class="ra-settings-field-grid">
                    <label class="block">
                      <span class="ra-type-system-micro text-[var(--ra-text-muted)]">Max turns</span>
                      <Input value={maxTurns()} onInput={(e) => setMaxTurns(e.currentTarget.value)} />
                    </label>
                    <label class="block">
                      <span class="ra-type-system-micro text-[var(--ra-text-muted)]">Browser debug port</span>
                      <Input value={cdpPort()} onInput={(e) => setCdpPort(e.currentTarget.value)} />
                    </label>
                  </div>

                  <div class="ra-settings-field-grid">
                    <label class="block">
                      <span class="ra-type-system-micro text-[var(--ra-text-muted)]">Response timeout (ms)</span>
                      <Input value={timeoutMs()} onInput={(e) => setTimeoutMs(e.currentTarget.value)} />
                    </label>
                    <label class="ra-settings-toggle">
                      <input
                        type="checkbox"
                        checked={autoLaunchEdge()}
                        onChange={(e) => setAutoLaunchEdge(e.currentTarget.checked)}
                      />
                      <span>
                        <span class="ra-type-button-label text-[var(--ra-text-primary)]">Auto-launch Edge</span>
                        <span class="ra-type-caption text-[var(--ra-text-muted)]">Open Edge automatically when Copilot is needed.</span>
                      </span>
                    </label>
                  </div>

                  <label class="ra-settings-toggle">
                    <input
                      type="checkbox"
                      checked={alwaysOnTop()}
                      onChange={(e) => setAlwaysOnTop(e.currentTarget.checked)}
                    />
                    <span>
                      <span class="ra-type-button-label text-[var(--ra-text-primary)]">Always on top</span>
                      <span class="ra-type-caption text-[var(--ra-text-muted)]">Keep Relay above other windows. Off by default for browser-based work.</span>
                    </span>
                  </label>

                  <div class="ra-settings-status">
                    <div>
                      <span class="ra-type-system-micro text-[var(--ra-text-muted)]">Diagnostics</span>
                      <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                        Export a JSON support bundle with current runtime facts and connection hints.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      type="button"
                      class="ra-type-button-label"
                      disabled={exporting()}
                      onClick={() => void exportDiagnostics()}
                    >
                      {exporting() ? "Exporting…" : "Export diagnostics"}
                    </Button>
                  </div>
                </div>
              </details>
            </div>

            <Show when={hint()}>
              <p class="mt-3 ra-type-button-label text-[var(--ra-accent)]">{hint()}</p>
            </Show>

            <div class="flex flex-wrap gap-2 justify-end mt-6">
              <Button variant="secondary" type="button" class="ra-type-button-label" onClick={() => props.onClose()}>
                Cancel
              </Button>
              <Button variant="primary" type="button" class="ra-type-button-label" onClick={() => persist()}>
                Save settings
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
