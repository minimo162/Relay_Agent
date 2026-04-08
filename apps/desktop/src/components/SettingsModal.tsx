import { Show, createEffect, createSignal, type JSX } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Input } from "./ui";
import { getRelayDiagnostics, type BrowserAutomationSettings } from "../lib/ipc";
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
}): JSX.Element {
  const [workspace, setWorkspace] = createSignal("");
  const [maxTurns, setMaxTurns] = createSignal(DEFAULT_MAX_TURNS);
  const [browser, setBrowser] = createSignal<BrowserAutomationSettings>(loadBrowserSettings());
  const [copyHint, setCopyHint] = createSignal<string | null>(null);
  const [saveHint, setSaveHint] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.open) return;
    setWorkspace(loadWorkspacePath());
    setMaxTurns(loadMaxTurns());
    setBrowser(loadBrowserSettings());
    setCopyHint(null);
    setSaveHint(null);
  });

  const save = () => {
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

  const copyDiagnostics = async () => {
    try {
      const diag = await getRelayDiagnostics();
      const bundle = {
        relayDiagnostics: diag,
        localSettings: {
          workspacePath: workspace().trim() || null,
          maxTurns: maxTurns(),
          browserAutomation: browser(),
        },
        copiedAt: new Date().toISOString(),
      };
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
        <div class="absolute inset-x-0 top-8 mx-auto w-full max-w-lg max-h-[min(85vh,32rem)] overflow-y-auto pointer-events-none flex justify-center px-4">
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
            </div>

            <Show when={saveHint()}>
              <p class="mt-2 text-xs text-[var(--ra-accent)]">{saveHint()}</p>
            </Show>
            <Show when={copyHint()}>
              <p class="mt-2 text-xs text-[var(--ra-text-secondary)]">{copyHint()}</p>
            </Show>

            <div class="flex flex-wrap gap-2 mt-5 justify-end">
              <Button variant="secondary" type="button" class="!text-xs" onClick={() => copyDiagnostics()}>
                Copy diagnostics
              </Button>
              <Button variant="primary" type="button" class="!text-xs" onClick={() => save()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
