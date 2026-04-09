import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Button, Input } from "./ui";
import {
  clearWorkspaceAllowlist,
  formatSessionAuditSummary,
  getRelayDiagnostics,
  getSessionHistory,
  getWorkspaceAllowlist,
  removeWorkspaceAllowlistTool,
  writeTextExport,
  type BrowserAutomationSettings,
  type WorkspaceAllowlistSnapshot,
} from "../lib/ipc";
import {
  DEFAULT_MAX_TURNS,
  loadBrowserSettings,
  loadMaxTurns,
  loadWorkspacePath,
  saveBrowserSettings,
  saveMaxTurns,
  saveWorkspacePath,
} from "../lib/settings-storage";

export function SettingsModal(props: {
  open: boolean;
  onClose: () => void;
  /** Called after Save so the shell can refresh workspace label, etc. */
  onSaved?: () => void;
  /** When set, Settings can copy an audit summary for this session. */
  activeSessionId?: string | null;
}): JSX.Element {
  const [workspace, setWorkspace] = createSignal("");
  const [maxTurns, setMaxTurns] = createSignal(DEFAULT_MAX_TURNS);
  const [browser, setBrowser] = createSignal<BrowserAutomationSettings>(loadBrowserSettings());
  const [copyHint, setCopyHint] = createSignal<string | null>(null);
  const [saveHint, setSaveHint] = createSignal<string | null>(null);
  const [allowlist, setAllowlist] = createSignal<WorkspaceAllowlistSnapshot | null>(null);
  const [allowlistBusy, setAllowlistBusy] = createSignal(false);
  const [predNotes, setPredNotes] = createSignal<string[]>([]);

  const refreshAllowlist = async () => {
    if (!isTauri()) return;
    setAllowlistBusy(true);
    try {
      const s = await getWorkspaceAllowlist();
      setAllowlist(s);
    } catch {
      setAllowlist(null);
    } finally {
      setAllowlistBusy(false);
    }
  };

  createEffect(() => {
    if (!props.open) return;
    setWorkspace(loadWorkspacePath());
    setMaxTurns(loadMaxTurns());
    setBrowser(loadBrowserSettings());
    setCopyHint(null);
    setSaveHint(null);
    void getRelayDiagnostics()
      .then((d) => setPredNotes(d.predictabilityNotes ?? []))
      .catch(() => setPredNotes([]));
    void refreshAllowlist();
  });

  const saveSettings = () => {
    saveWorkspacePath(workspace());
    saveMaxTurns(maxTurns());
    saveBrowserSettings(browser());
    props.onSaved?.();
    setSaveHint("Saved locally.");
    setTimeout(() => setSaveHint(null), 2500);
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
      saveWorkspacePath(selected);
      props.onSaved?.();
    } catch (e) {
      console.error("[Settings] folder dialog failed", e);
    }
  };

  const diagnosticsBundle = async () => {
    const diag = await getRelayDiagnostics();
    const sid = props.activeSessionId?.trim() || null;
    return {
      relayDiagnostics: diag,
      localSettings: {
        workspacePath: workspace().trim() || null,
        maxTurns: maxTurns(),
        browserAutomation: browser(),
      },
      activeSessionId: sid,
      exportedAt: new Date().toISOString(),
    };
  };

  const copyDiagnostics = async () => {
    try {
      const bundle = await diagnosticsBundle();
      const text = JSON.stringify(bundle, null, 2);
      await navigator.clipboard.writeText(text);
      setCopyHint("Copied to clipboard.");
      setTimeout(() => setCopyHint(null), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCopyHint(`Copy failed: ${msg}`);
      setTimeout(() => setCopyHint(null), 4000);
    }
  };

  const exportDiagnosticsFile = async () => {
    if (!isTauri()) return;
    try {
      const bundle = await diagnosticsBundle();
      const text = JSON.stringify(bundle, null, 2);
      const day = new Date().toISOString().slice(0, 10);
      const path = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: `relay-diagnostics-${day}.json`,
      });
      if (path == null) return;
      await writeTextExport(path, text);
      setCopyHint("Diagnostics saved to file.");
      setTimeout(() => setCopyHint(null), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCopyHint(`Export failed: ${msg}`);
      setTimeout(() => setCopyHint(null), 4000);
    }
  };

  const copySessionAuditSummary = async () => {
    const sid = props.activeSessionId?.trim();
    if (!sid) {
      setCopyHint("No active session — select a session in the sidebar first.");
      setTimeout(() => setCopyHint(null), 3500);
      return;
    }
    try {
      const res = await getSessionHistory({ sessionId: sid });
      const text = formatSessionAuditSummary(res);
      await navigator.clipboard.writeText(text);
      setCopyHint("Session audit summary copied.");
      setTimeout(() => setCopyHint(null), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCopyHint(`Copy failed: ${msg}`);
      setTimeout(() => setCopyHint(null), 4000);
    }
  };

  const exportSessionHistoryJson = async () => {
    if (!isTauri()) return;
    const sid = props.activeSessionId?.trim();
    if (!sid) {
      setCopyHint("No active session — select a session in the sidebar first.");
      setTimeout(() => setCopyHint(null), 3500);
      return;
    }
    try {
      const res = await getSessionHistory({ sessionId: sid });
      const text = JSON.stringify(
        { ...res, exportedAt: new Date().toISOString() },
        null,
        2,
      );
      const day = new Date().toISOString().slice(0, 10);
      const short = sid.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 24);
      const path = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: `relay-session-${short}-${day}.json`,
      });
      if (path == null) return;
      await writeTextExport(path, text);
      setCopyHint("Session history saved to file.");
      setTimeout(() => setCopyHint(null), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCopyHint(`Export failed: ${msg}`);
      setTimeout(() => setCopyHint(null), 4000);
    }
  };

  const b = () => browser();

  return (
    <Show when={props.open}>
      <div class="absolute inset-0 z-20" role="dialog" aria-modal="true" aria-label="Settings">
        <button
          type="button"
          class="ra-modal-backdrop absolute inset-0 cursor-default border-0 p-0"
          aria-label="Close settings"
          onClick={() => props.onClose()}
        />
        <div class="absolute inset-x-0 top-8 mx-auto w-full max-w-lg max-h-[min(90vh,42rem)] overflow-y-auto pointer-events-none flex justify-center px-4">
          <div class="ra-modal-panel w-full pointer-events-auto shadow-[var(--ra-shadow-sm)]">
            <div class="flex items-start justify-between gap-2">
              <p class="ra-modal-panel__title">Settings</p>
              <button
                type="button"
                class="text-[11px] text-[var(--ra-text-muted)] hover:text-[var(--ra-text-primary)]"
                onClick={() => props.onClose()}
              >
                Close
              </button>
            </div>
            <p class="text-xs text-[var(--ra-text-secondary)] mt-1">
              Workspace and limits apply to the next agent run. Browser automation fields are stored
              for diagnostics and future CDP wiring.
            </p>

            <div class="mt-4 space-y-3">
              <div class="block">
                <span class="text-[11px] font-medium text-[var(--ra-text-muted)] uppercase tracking-wide">
                  Workspace path (cwd)
                </span>
                <div class="flex gap-2 mt-1 items-stretch">
                  <Input
                    class="flex-1 min-w-0 font-mono text-xs"
                    placeholder="/path/to/project"
                    value={workspace()}
                    onInput={(e) => setWorkspace(e.currentTarget.value)}
                  />
                  <Show when={isTauri()}>
                    <Button
                      variant="secondary"
                      type="button"
                      class="!text-xs shrink-0 px-3"
                      data-ra-workspace-browse
                      onClick={() => void pickWorkspaceFolder()}
                    >
                      Browse…
                    </Button>
                  </Show>
                </div>
              </div>

              <label class="block">
                <span class="text-[11px] font-medium text-[var(--ra-text-muted)] uppercase tracking-wide">
                  Max turns per goal
                </span>
                <Input
                  type="number"
                  min={1}
                  max={256}
                  class="mt-1 w-full text-xs"
                  value={maxTurns()}
                  onInput={(e) => {
                    const n = parseInt(e.currentTarget.value, 10);
                    if (Number.isFinite(n)) setMaxTurns(n);
                  }}
                />
              </label>

              <fieldset class="border border-[var(--ra-border)] rounded-lg p-3 space-y-2">
                <legend class="text-[11px] font-medium text-[var(--ra-text-muted)] px-1">
                  Browser automation (stored)
                </legend>
                <label class="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={b().autoLaunchEdge}
                    onChange={(e) =>
                      setBrowser({ ...b(), autoLaunchEdge: e.currentTarget.checked })
                    }
                  />
                  Auto-launch Edge when connecting
                </label>
                <label class="block">
                  <span class="text-[var(--ra-text-muted)]">CDP port hint</span>
                  <Input
                    type="number"
                    class="mt-1 w-full text-xs"
                    value={b().cdpPort}
                    onInput={(e) => {
                      const n = parseInt(e.currentTarget.value, 10);
                      if (Number.isFinite(n) && n > 0) setBrowser({ ...b(), cdpPort: n });
                    }}
                  />
                </label>
                <label class="block">
                  <span class="text-[var(--ra-text-muted)]">Timeout (ms)</span>
                  <Input
                    type="number"
                    class="mt-1 w-full text-xs"
                    value={b().timeoutMs}
                    onInput={(e) => {
                      const n = parseInt(e.currentTarget.value, 10);
                      if (Number.isFinite(n) && n > 0) setBrowser({ ...b(), timeoutMs: n });
                    }}
                  />
                </label>
              </fieldset>

              <div class="rounded-lg border border-[var(--ra-border)] p-3 space-y-2">
                <p class="text-[11px] font-medium text-[var(--ra-text-muted)] uppercase tracking-wide">
                  How connections use your settings
                </p>
                <p class="text-xs text-[var(--ra-text-secondary)]">
                  Relay prefers explicit values over hidden guesses. The workspace path below is sent as{" "}
                  <span class="font-mono">cwd</span> on each agent run (may differ from the app process directory in
                  diagnostics). Copilot talks to Edge over CDP; the port hint defaults to 9360 unless you change it
                  above.
                </p>
                <Show when={predNotes().length > 0}>
                  <ul class="text-xs text-[var(--ra-text-secondary)] list-disc pl-4 space-y-1">
                    <For each={predNotes()}>{(line) => <li>{line}</li>}</For>
                  </ul>
                </Show>
              </div>

              <Show when={isTauri()}>
                <div class="rounded-lg border border-[var(--ra-border)] p-3 space-y-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="text-[11px] font-medium text-[var(--ra-text-muted)] uppercase tracking-wide">
                      Workspace tool allow list
                    </p>
                    <span class="text-[10px] text-[var(--ra-text-muted)] font-mono truncate max-w-[200px]">
                      {allowlist()?.storePath ?? ""}
                    </span>
                  </div>
                  <p class="text-xs text-[var(--ra-text-secondary)]">
                    Tools approved with &quot;Allow for this workspace&quot; are stored per normalized folder. Remove
                    entries here instead of editing JSON by hand.
                  </p>
                  <Show when={allowlistBusy()}>
                    <p class="text-xs text-[var(--ra-text-muted)]">Loading…</p>
                  </Show>
                  <Show
                    when={(allowlist()?.entries.length ?? 0) > 0}
                    fallback={
                      <p class="text-xs text-[var(--ra-text-muted)]">No persisted workspace allows yet.</p>
                    }
                  >
                    <div class="max-h-40 overflow-y-auto space-y-2">
                      <For each={allowlist()?.entries ?? []}>
                        {(ent) => (
                          <div class="rounded border border-[var(--ra-border)] p-2 space-y-1">
                            <p class="text-[10px] font-mono text-[var(--ra-text-secondary)] break-all">
                              {ent.workspaceKey}
                            </p>
                            <ul class="space-y-1">
                              <For each={ent.tools}>
                                {(tool) => (
                                  <li class="flex items-center justify-between gap-2 text-xs">
                                    <span class="font-mono">{tool}</span>
                                    <button
                                      type="button"
                                      class="text-[10px] text-[var(--ra-accent)] hover:underline shrink-0"
                                      onClick={async () => {
                                        try {
                                          await removeWorkspaceAllowlistTool(ent.workspaceKey, tool);
                                          await refreshAllowlist();
                                          setCopyHint(`Removed ${tool} for one workspace.`);
                                          setTimeout(() => setCopyHint(null), 2200);
                                        } catch (e) {
                                          const msg = e instanceof Error ? e.message : String(e);
                                          setCopyHint(`Remove failed: ${msg}`);
                                          setTimeout(() => setCopyHint(null), 4000);
                                        }
                                      }}
                                    >
                                      Remove
                                    </button>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div class="flex flex-wrap gap-2 pt-1">
                    <Button
                      variant="secondary"
                      type="button"
                      class="!text-xs"
                      disabled={!workspace().trim()}
                      onClick={async () => {
                        const cwd = workspace().trim();
                        if (!cwd) return;
                        try {
                          await clearWorkspaceAllowlist(cwd);
                          await refreshAllowlist();
                          setCopyHint("Cleared allows for the workspace path above.");
                          setTimeout(() => setCopyHint(null), 2500);
                        } catch (e) {
                          const msg = e instanceof Error ? e.message : String(e);
                          setCopyHint(`Clear failed: ${msg}`);
                          setTimeout(() => setCopyHint(null), 4000);
                        }
                      }}
                    >
                      Clear all for path above
                    </Button>
                    <Button
                      variant="secondary"
                      type="button"
                      class="!text-xs"
                      disabled={!allowlist()}
                      onClick={async () => {
                        const snap = allowlist();
                        if (!snap) return;
                        try {
                          await navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
                          setCopyHint("Allow list copied.");
                          setTimeout(() => setCopyHint(null), 2500);
                        } catch (e) {
                          const msg = e instanceof Error ? e.message : String(e);
                          setCopyHint(`Copy failed: ${msg}`);
                          setTimeout(() => setCopyHint(null), 4000);
                        }
                      }}
                    >
                      Copy allow list JSON
                    </Button>
                    <Button
                      variant="secondary"
                      type="button"
                      class="!text-xs"
                      disabled={!allowlist()}
                      onClick={async () => {
                        const snap = allowlist();
                        if (!snap) return;
                        try {
                          const day = new Date().toISOString().slice(0, 10);
                          const path = await save({
                            filters: [{ name: "JSON", extensions: ["json"] }],
                            defaultPath: `relay-workspace-allowlist-${day}.json`,
                          });
                          if (path == null) return;
                          await writeTextExport(path, JSON.stringify(snap, null, 2));
                          setCopyHint("Allow list saved to file.");
                          setTimeout(() => setCopyHint(null), 2500);
                        } catch (e) {
                          const msg = e instanceof Error ? e.message : String(e);
                          setCopyHint(`Save failed: ${msg}`);
                          setTimeout(() => setCopyHint(null), 4000);
                        }
                      }}
                    >
                      Save allow list…
                    </Button>
                  </div>
                </div>
              </Show>
            </div>

            <Show when={saveHint()}>
              <p class="mt-2 text-xs text-[var(--ra-accent)]">{saveHint()}</p>
            </Show>
            <Show when={copyHint()}>
              <p class="mt-2 text-xs text-[var(--ra-text-secondary)]">{copyHint()}</p>
            </Show>

            <div class="flex flex-col gap-2 mt-5">
              <span class="text-[11px] font-medium text-[var(--ra-text-muted)] uppercase tracking-wide">
                Debug
              </span>
              <div class="flex flex-wrap gap-2 justify-end">
                <Button variant="secondary" type="button" class="!text-xs" onClick={() => void copyDiagnostics()}>
                  Copy diagnostics
                </Button>
                <Show when={isTauri()}>
                  <Button
                    variant="secondary"
                    type="button"
                    class="!text-xs"
                    data-ra-export-diagnostics
                    onClick={() => void exportDiagnosticsFile()}
                  >
                    Save diagnostics…
                  </Button>
                </Show>
                <Button
                  variant="secondary"
                  type="button"
                  class="!text-xs"
                  data-ra-copy-session-audit
                  onClick={() => void copySessionAuditSummary()}
                >
                  Copy session audit
                </Button>
                <Show when={isTauri()}>
                  <Button
                    variant="secondary"
                    type="button"
                    class="!text-xs"
                    data-ra-export-session-json
                    onClick={() => void exportSessionHistoryJson()}
                  >
                    Save session JSON…
                  </Button>
                </Show>
                <Button variant="primary" type="button" class="!text-xs" onClick={() => saveSettings()}>
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
