import { Show, createEffect, createSignal, type JSX } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Input } from "./ui";
import { loadWorkspacePath, saveWorkspacePath } from "../lib/settings-storage";

export function SettingsModal(props: {
  open: boolean;
  onClose: () => void;
  /** Called after workspace is saved so the shell can refresh workspace label. */
  onSaved?: () => void;
}): JSX.Element {
  const [workspace, setWorkspace] = createSignal("");
  const [hint, setHint] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.open) return;
    setWorkspace(loadWorkspacePath());
    setHint(null);
  });

  const persistAndClose = () => {
    saveWorkspacePath(workspace());
    props.onSaved?.();
    setHint(null);
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
      saveWorkspacePath(selected);
      props.onSaved?.();
      setHint("Folder saved.");
      setTimeout(() => setHint(null), 2000);
    } catch (e) {
      console.error("[Settings] folder dialog failed", e);
    }
  };

  return (
    <Show when={props.open}>
      <div class="absolute inset-0 z-20" role="dialog" aria-modal="true" aria-label="Workspace folder">
        <button
          type="button"
          class="ra-modal-backdrop absolute inset-0 cursor-default border-0 p-0"
          aria-label="Close"
          onClick={() => props.onClose()}
        />
        <div class="absolute inset-x-0 top-8 mx-auto w-full max-w-lg max-h-[min(90vh,42rem)] overflow-y-auto pointer-events-none flex justify-center px-4">
          <div class="ra-modal-panel w-full pointer-events-auto shadow-[var(--ra-shadow-sm)]">
            <div class="flex items-start justify-between gap-2">
              <p class="ra-modal-panel__title">Workspace</p>
              <button
                type="button"
                class={`ra-type-caption text-[var(--ra-text-muted)] hover:text-[var(--ra-text-primary)]`}
                onClick={() => props.onClose()}
              >
                Close
              </button>
            </div>
            <p class={`ra-type-button-label text-[var(--ra-text-secondary)] mt-1`}>
              Pick the project folder the agent uses as its working directory.
            </p>

            <div class="mt-4 space-y-3">
              <div class="block">
                <span class={`ra-type-system-micro text-[var(--ra-text-muted)]`}>Folder path</span>
                <div class="flex gap-2 mt-1 items-stretch">
                  <Input
                    class="ra-type-mono-small flex-1 min-w-0"
                    placeholder="/path/to/project"
                    value={workspace()}
                    onInput={(e) => setWorkspace(e.currentTarget.value)}
                  />
                  <Show when={isTauri()}>
                    <Button
                      variant="secondary"
                      type="button"
                      class="ra-type-button-label shrink-0 px-3"
                      data-ra-workspace-browse
                      onClick={() => void pickWorkspaceFolder()}
                    >
                      Browse…
                    </Button>
                  </Show>
                </div>
              </div>
            </div>

            <Show when={hint()}>
              <p class={`mt-2 ra-type-button-label text-[var(--ra-accent)]`}>{hint()}</p>
            </Show>

            <div class="flex flex-wrap gap-2 justify-end mt-5">
              <Button
                variant="primary"
                type="button"
                class="ra-type-button-label"
                onClick={() => persistAndClose()}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
