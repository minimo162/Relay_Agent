import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { BrowserAutomationSettings, WorkspaceAllowlistSnapshot } from "../lib/ipc";
import {
  clearWorkspaceAllowlist,
  getRelayDiagnostics,
  getWorkspaceAllowlist,
  removeWorkspaceAllowlistTool,
  writeTextExport,
} from "../lib/ipc";
import { fetchWorkspaceSkills, type RelaySkill } from "../lib/skills";
import { showToast } from "../lib/status-toasts";
import {
  loadAlwaysOnTop,
  loadBrowserSettings,
  loadMaxTurns,
  loadWorkspacePath,
  saveAlwaysOnTop,
  saveBrowserSettings,
  saveMaxTurns,
  saveWorkspacePath,
} from "../lib/settings-storage";
import {
  copilotWarmupHeadline,
  copilotWarmupStageDetail,
  type CopilotWarmupState,
} from "../shell/useCopilotWarmup";
import { pickWorkspaceFolder } from "../lib/workspace-picker";
import { Button, Input } from "./ui";

export interface ShellSettingsDraft {
  workspacePath: string;
  browserSettings: BrowserAutomationSettings;
  maxTurns: number;
  alwaysOnTop: boolean;
}

function previewWorkspaceAllowlistSnapshot(): WorkspaceAllowlistSnapshot | null {
  if (isTauri()) return null;
  return (window as typeof window & {
    __RELAY_ALLOWLIST_SNAPSHOT__?: WorkspaceAllowlistSnapshot;
  }).__RELAY_ALLOWLIST_SNAPSHOT__ ?? null;
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
  const [maxTurns, setMaxTurns] = createSignal("16");
  const [cdpPort, setCdpPort] = createSignal("9360");
  const [timeoutMs, setTimeoutMs] = createSignal("120000");
  const [autoLaunchEdge, setAutoLaunchEdge] = createSignal(true);
  const [alwaysOnTop, setAlwaysOnTop] = createSignal(false);
  const [hint, setHint] = createSignal<string | null>(null);
  const [exporting, setExporting] = createSignal(false);
  const [allowlistSnapshot, setAllowlistSnapshot] = createSignal<WorkspaceAllowlistSnapshot | null>(null);
  const [skills, setSkills] = createSignal<RelaySkill[]>([]);
  const [skillsLoaded, setSkillsLoaded] = createSignal(false);

  createEffect(() => {
    if (props.open && !wasOpen) {
      lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const browser = loadBrowserSettings();
      setWorkspace(loadWorkspacePath());
      setMaxTurns(String(loadMaxTurns()));
      setCdpPort(String(browser.cdpPort));
      setTimeoutMs(String(browser.timeoutMs));
      setAutoLaunchEdge(browser.autoLaunchEdge);
      setAlwaysOnTop(loadAlwaysOnTop());
      setHint(null);
      const previewSnapshot = previewWorkspaceAllowlistSnapshot();
      if (previewSnapshot) {
        setAllowlistSnapshot(previewSnapshot);
      } else {
        setAllowlistSnapshot(null);
        void getWorkspaceAllowlist()
          .then((snapshot) => setAllowlistSnapshot(snapshot))
          .catch((error) => {
            console.error("[Settings] workspace allowlist load failed", error);
            setAllowlistSnapshot({
              storePath: "",
              entries: [],
              warnings: ["Couldn't load workspace allowlist diagnostics."],
            });
          });
      }
      setSkillsLoaded(false);
      void fetchWorkspaceSkills(loadWorkspacePath().trim() || null)
        .then((rows) => {
          setSkills(rows);
          setSkillsLoaded(true);
        })
        .catch((error) => {
          console.error("[Settings] workspace skills load failed", error);
          setSkills([]);
          setSkillsLoaded(true);
        });
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
      alwaysOnTop: alwaysOnTop(),
    };
    saveWorkspacePath(next.workspacePath);
    saveMaxTurns(next.maxTurns);
    saveBrowserSettings(next.browserSettings);
    saveAlwaysOnTop(next.alwaysOnTop);
    props.onApply(next);
    setHint("Settings saved.");
    showToast({ tone: "ok", message: "Settings saved" });
    props.onClose();
  };

  const handlePickWorkspaceFolder = async () => {
    try {
      const selected = await pickWorkspaceFolder(workspace());
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
                  Configure the project, Copilot connection, and desktop behavior.
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
                  Set the project, check Copilot, then return to the chat.
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
                          onClick={() => void handlePickWorkspaceFolder()}
                        >
                          Browse…
                        </Button>
                      </Show>
                    </div>
                    <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                      Relay uses this folder when it reads, searches, or edits.
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
                        Relay reaches Copilot through Edge. If this is not ready, sign in there and reconnect.
                      </p>
                    </div>
                    <Button variant="secondary" type="button" class="ra-type-button-label" onClick={props.onReconnectCopilot}>
                      Reconnect Copilot
                    </Button>
                  </div>
                </div>
              </section>

              <section class="ra-settings-card" data-ra-skills>
                <div class="flex items-baseline gap-2">
                  <p class="ra-type-system-micro text-[var(--ra-text-muted)]">Skills</p>
                  <Show when={skills().length > 0}>
                    <span class="ra-type-caption text-[var(--ra-text-muted)]">
                      {skills().length} available
                    </span>
                  </Show>
                </div>
                <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                  Reusable prompt + tool hints loaded from
                  {" "}
                  <code class="ra-type-mono-small">.relay/skills/&lt;name&gt;.md</code>
                  {" "}in the current workspace. Run with
                  {" "}
                  <code class="ra-type-mono-small">/skill &lt;name&gt;</code>.
                </p>

                <Show
                  when={skillsLoaded() && skills().length > 0}
                  fallback={
                    <p class="ra-type-caption text-[var(--ra-text-muted)] mt-3">
                      <Show when={!skillsLoaded()} fallback={
                        <>
                          No skills found. Add files like
                          {" "}
                          <code class="ra-type-mono-small">.relay/skills/audit-expenses.md</code>
                          {" "}with YAML frontmatter
                          {" "}
                          (<code class="ra-type-mono-small">description</code>,
                          {" "}
                          <code class="ra-type-mono-small">tools</code>,
                          {" "}
                          <code class="ra-type-mono-small">allowlist</code>) and reopen Settings.
                        </>
                      }>
                        Loading…
                      </Show>
                    </p>
                  }
                >
                  <ul class="ra-skills-list mt-3">
                    <For each={skills()}>
                      {(skill) => (
                        <li class="ra-skills-entry">
                          <div class="ra-skills-entry__head">
                            <code class="ra-skills-entry__name ra-type-mono-small">/{skill.name}</code>
                            <Show when={skill.description}>
                              <span class="ra-skills-entry__desc">
                                {skill.description}
                              </span>
                            </Show>
                          </div>
                          <Show when={skill.tools.length > 0 || skill.allowlist.length > 0}>
                            <div class="ra-skills-entry__chips mt-1">
                              <For each={skill.tools}>
                                {(tool) => (
                                  <span class="ra-skills-chip ra-skills-chip--tool">
                                    {tool}
                                  </span>
                                )}
                              </For>
                              <For each={skill.allowlist}>
                                {(tool) => (
                                  <span class="ra-skills-chip ra-skills-chip--allow">
                                    allow · {tool}
                                  </span>
                                )}
                              </For>
                            </div>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </section>

              <section class="ra-settings-card" data-ra-permissions>
                <div class="flex items-baseline gap-2">
                  <p class="ra-type-system-micro text-[var(--ra-text-muted)]">Permissions</p>
                  <Show when={(allowlistSnapshot()?.entries.length ?? 0) > 0}>
                    <span class="ra-type-caption text-[var(--ra-text-muted)]">
                      {allowlistSnapshot()!.entries.length} workspace{allowlistSnapshot()!.entries.length === 1 ? "" : "s"}
                    </span>
                  </Show>
                </div>
                <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                  Tools you’ve approved with “Always for this folder.” Revoke them here.
                </p>

                <Show
                  when={(allowlistSnapshot()?.entries.length ?? 0) > 0}
                  fallback={
                    <p class="ra-type-caption text-[var(--ra-text-muted)] mt-3">
                      No remembered workspace approvals.
                    </p>
                  }
                >
                  <ul class="ra-permissions-list mt-3">
                    <For each={allowlistSnapshot()!.entries}>
                      {(entry) => {
                        const isCurrent = createMemo(
                          () => entry.workspaceKey === workspace().trim(),
                        );
                        return (
                          <li
                            classList={{
                              "ra-permissions-entry": true,
                              "ra-permissions-entry--current": isCurrent(),
                            }}
                          >
                            <div class="ra-permissions-entry__head">
                              <div class="ra-permissions-entry__path-wrap">
                                <Show when={isCurrent()}>
                                  <span
                                    class="ra-permissions-entry__current-badge"
                                    aria-label="Current workspace"
                                  >
                                    Current
                                  </span>
                                </Show>
                                <span
                                  class="ra-permissions-entry__path ra-type-mono-small"
                                  title={entry.workspaceKey}
                                >
                                  {entry.workspaceKey}
                                </span>
                              </div>
                              <button
                                type="button"
                                class="ra-permissions-entry__clear"
                                onClick={() => {
                                  void clearWorkspaceAllowlist(entry.workspaceKey)
                                    .then(() => getWorkspaceAllowlist())
                                    .then((snap) => {
                                      setAllowlistSnapshot(snap);
                                      showToast({
                                        tone: "ok",
                                        message: "Permissions cleared",
                                        detail: entry.workspaceKey,
                                      });
                                    })
                                    .catch((err) => {
                                      console.error("[Settings] clear allowlist failed", err);
                                      showToast({
                                        tone: "danger",
                                        message: "Couldn't clear permissions",
                                        detail: err instanceof Error ? err.message : String(err),
                                      });
                                    });
                                }}
                              >
                                Clear all
                              </button>
                            </div>
                            <Show
                              when={entry.tools.length > 0}
                              fallback={
                                <p class="ra-type-caption text-[var(--ra-text-muted)] mt-2">
                                  No tools allowed.
                                </p>
                              }
                            >
                              <ul class="ra-permissions-tools mt-2">
                                <For each={entry.tools}>
                                  {(toolName) => (
                                    <li class="ra-permissions-tool">
                                      <span class="ra-permissions-tool__name ra-type-mono-small">
                                        {toolName}
                                      </span>
                                      <button
                                        type="button"
                                        class="ra-permissions-tool__revoke"
                                        aria-label={`Revoke ${toolName}`}
                                        onClick={() => {
                                          void removeWorkspaceAllowlistTool(
                                            entry.workspaceKey,
                                            toolName,
                                          )
                                            .then(() => getWorkspaceAllowlist())
                                            .then((snap) => {
                                              setAllowlistSnapshot(snap);
                                              showToast({
                                                tone: "ok",
                                                message: "Permission revoked",
                                                detail: toolName,
                                              });
                                            })
                                            .catch((err) => {
                                              console.error(
                                                "[Settings] revoke tool failed",
                                                err,
                                              );
                                              showToast({
                                                tone: "danger",
                                                message: "Couldn't revoke permission",
                                                detail: err instanceof Error ? err.message : String(err),
                                              });
                                            });
                                        }}
                                      >
                                        Revoke
                                      </button>
                                    </li>
                                  )}
                                </For>
                              </ul>
                            </Show>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </Show>
              </section>

              <details class="ra-settings-card ra-settings-details">
                <summary class="ra-settings-details__summary">
                  <div>
                    <p class="ra-type-system-micro text-[var(--ra-text-muted)]">Advanced</p>
                    <p class="ra-type-button-label text-[var(--ra-text-primary)] mt-1">Browser and troubleshooting</p>
                  </div>
                  <span class="ra-type-caption text-[var(--ra-text-muted)]">Show</span>
                </summary>
                <div class="mt-3 space-y-4">
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
                        Export a JSON bundle with current runtime facts and connection hints.
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

                  <Show when={(allowlistSnapshot()?.warnings.length ?? 0) > 0}>
                    <div
                      class="ra-settings-status border-[var(--ra-warning-border)] bg-[var(--ra-warning-surface)]"
                      data-ra-allowlist-warning=""
                    >
                      <div>
                        <span class="ra-type-system-micro text-[var(--ra-warning-text)]">Workspace approvals</span>
                        <p class="ra-type-button-label text-[var(--ra-text-primary)] mt-1">
                          Saved “Allow for this workspace” rules need attention.
                        </p>
                        <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                          Relay could not safely read the persisted allowlist, so remembered workspace approvals were ignored until the store is repaired.
                        </p>
                        <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1 break-all">
                          {allowlistSnapshot()?.storePath}
                        </p>
                        <For each={allowlistSnapshot()?.warnings ?? []}>
                          {(warning) => (
                            <p class="ra-type-caption text-[var(--ra-warning-text)] mt-2">
                              {warning}
                            </p>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
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
