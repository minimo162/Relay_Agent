import { Show, createEffect, createSignal, type JSX } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Button, Input } from "./ui";
import {
  clearWorkspaceAllowlist,
  formatSessionAuditSummary,
  getRelayDiagnostics,
  getSessionHistory,
  writeTextExport,
  type BrowserAutomationSettings,
} from "../lib/ipc";
import {
  DEFAULT_MAX_TURNS,
  loadBrowserSettings,
  loadMaxTurns,
  loadShowToolActivityInChat,
  loadWorkspacePath,
  saveBrowserSettings,
  saveMaxTurns,
  saveShowToolActivityInChat,
  saveWorkspacePath,
} from "../lib/settings-storage";

export function SettingsModal(props: {
  open: boolean;
  onClose: () => void;
  /** Called after Save so the shell can refresh workspace label, etc. */
  onSaved?: () => void;
  /** When set, Settings can copy an audit summary for this session. */
  activeSessionId?: string | null;
  /** Keep message feed in sync when user toggles tool visibility in Advanced. */
  onShowToolActivityInChatChange?: (showInline: boolean) => void;
}): JSX.Element {
  const [workspace, setWorkspace] = createSignal("");
  const [maxTurns, setMaxTurns] = createSignal(DEFAULT_MAX_TURNS);
  const [browser, setBrowser] = createSignal<BrowserAutomationSettings>(loadBrowserSettings());
  const [copyHint, setCopyHint] = createSignal<string | null>(null);
  const [saveHint, setSaveHint] = createSignal<string | null>(null);
  const [toolActivityInChat, setToolActivityInChat] = createSignal(true);

  createEffect(() => {
    if (!props.open) return;
    setWorkspace(loadWorkspacePath());
    setMaxTurns(loadMaxTurns());
    setBrowser(loadBrowserSettings());
    setToolActivityInChat(loadShowToolActivityInChat());
    setCopyHint(null);
    setSaveHint(null);
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

  const clearAllowlistForWorkspace = async () => {
    if (!isTauri()) return;
    const cwd = workspace().trim();
    if (!cwd) return;
    try {
      await clearWorkspaceAllowlist(cwd);
      setCopyHint("Cleared saved tool permissions for this workspace path.");
      setTimeout(() => setCopyHint(null), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCopyHint(`Clear failed: ${msg}`);
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
                class="text-xs text-[var(--ra-text-muted)] hover:text-[var(--ra-text-primary)]"
                onClick={() => props.onClose()}
              >
                Close
              </button>
            </div>
            <p class="text-sm text-[var(--ra-text-secondary)] mt-1">
              Choose the project folder the agent uses as its working directory.
            </p>

            <div class="mt-4 space-y-3">
              <div class="block">
                <span class="text-xs font-medium text-[var(--ra-text-muted)] uppercase tracking-wide">
                  Workspace
                </span>
                <div class="flex gap-2 mt-1 items-stretch">
                  <Input
                    class="flex-1 min-w-0 font-mono text-sm"
                    placeholder="/path/to/project"
                    value={workspace()}
                    onInput={(e) => setWorkspace(e.currentTarget.value)}
                  />
                  <Show when={isTauri()}>
                    <Button
                      variant="secondary"
                      type="button"
                      class="!text-sm shrink-0 px-3"
                      data-ra-workspace-browse
                      onClick={() => void pickWorkspaceFolder()}
                    >
                      Browse…
                    </Button>
                  </Show>
                </div>
              </div>
            </div>

            <Show when={saveHint()}>
              <p class="mt-2 text-sm text-[var(--ra-accent)]">{saveHint()}</p>
            </Show>
            <Show when={copyHint()}>
              <p class="mt-2 text-sm text-[var(--ra-text-secondary)]">{copyHint()}</p>
            </Show>

            <div class="flex flex-wrap gap-2 justify-end mt-5">
              <Button variant="primary" type="button" class="!text-sm" onClick={() => saveSettings()}>
                Save
              </Button>
            </div>

            <details class="mt-5 rounded-lg border border-[var(--ra-border)] p-3" data-ra-settings-advanced>
              <summary class="cursor-pointer text-xs font-medium text-[var(--ra-text-muted)] uppercase tracking-wide list-none flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                <span>Advanced</span>
                <span class="text-[10px] font-normal normal-case text-[var(--ra-text-muted)]">
                  Limits, browser, permissions, diagnostics
                </span>
              </summary>
              <div class="mt-3 space-y-3 pt-1 border-t border-[var(--ra-border)]">
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={toolActivityInChat()}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setToolActivityInChat(on);
                      saveShowToolActivityInChat(on);
                      props.onShowToolActivityInChatChange?.(on);
                    }}
                  />
                  <span>Show tool steps inline in chat</span>
                </label>

                <label class="block">
                  <span class="text-xs font-medium text-[var(--ra-text-muted)] uppercase tracking-wide">
                    Max turns per goal
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={256}
                    class="mt-1 w-full text-sm"
                    value={maxTurns()}
                    onInput={(e) => {
                      const n = parseInt(e.currentTarget.value, 10);
                      if (Number.isFinite(n)) setMaxTurns(n);
                    }}
                  />
                </label>

                <fieldset class="border border-[var(--ra-border)] rounded-lg p-3 space-y-2">
                  <legend class="text-xs font-medium text-[var(--ra-text-muted)] px-1">
                    Browser (CDP)
                  </legend>
                  <label class="flex items-center gap-2 text-sm">
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
                    <span class="text-[var(--ra-text-muted)] text-sm">CDP port</span>
                    <Input
                      type="number"
                      class="mt-1 w-full text-sm"
                      value={b().cdpPort}
                      onInput={(e) => {
                        const n = parseInt(e.currentTarget.value, 10);
                        if (Number.isFinite(n) && n > 0) setBrowser({ ...b(), cdpPort: n });
                      }}
                    />
                  </label>
                  <label class="block">
                    <span class="text-[var(--ra-text-muted)] text-sm">Timeout (ms)</span>
                    <Input
                      type="number"
                      class="mt-1 w-full text-sm"
                      value={b().timeoutMs}
                      onInput={(e) => {
                        const n = parseInt(e.currentTarget.value, 10);
                        if (Number.isFinite(n) && n > 0) setBrowser({ ...b(), timeoutMs: n });
                      }}
                    />
                  </label>
                </fieldset>

                <Show when={isTauri()}>
                  <div class="rounded-lg border border-[var(--ra-border)] p-3 space-y-2">
                    <p class="text-xs font-medium text-[var(--ra-text-muted)] uppercase tracking-wide">
                      Tool permissions
                    </p>
                    <p class="text-sm text-[var(--ra-text-secondary)]">
                      Remove every &quot;allow for this workspace&quot; entry for the path above.
                    </p>
                    <Button
                      variant="secondary"
                      type="button"
                      class="!text-sm"
                      disabled={!workspace().trim()}
                      onClick={() => void clearAllowlistForWorkspace()}
                    >
                      Clear saved permissions for this workspace
                    </Button>
                  </div>
                </Show>

                <div class="space-y-2">
                  <p class="text-xs font-medium text-[var(--ra-text-muted)] uppercase tracking-wide">
                    Diagnostics
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <Button variant="secondary" type="button" class="!text-sm" onClick={() => void copyDiagnostics()}>
                      Copy diagnostics
                    </Button>
                    <Show when={isTauri()}>
                      <Button
                        variant="secondary"
                        type="button"
                        class="!text-sm"
                        data-ra-export-diagnostics
                        onClick={() => void exportDiagnosticsFile()}
                      >
                        Save diagnostics…
                      </Button>
                    </Show>
                    <Button
                      variant="secondary"
                      type="button"
                      class="!text-sm"
                      data-ra-copy-session-audit
                      onClick={() => void copySessionAuditSummary()}
                    >
                      Copy session audit
                    </Button>
                    <Show when={isTauri()}>
                      <Button
                        variant="secondary"
                        type="button"
                        class="!text-sm"
                        data-ra-export-session-json
                        onClick={() => void exportSessionHistoryJson()}
                      >
                        Save session JSON…
                      </Button>
                    </Show>
                  </div>
                </div>

                <p class="text-xs text-[var(--ra-text-muted)]">
                  Apply limits and browser values with <span class="font-medium">Save</span> above.
                </p>
              </div>
            </details>
          </div>
        </div>
      </div>
    </Show>
  );
}
