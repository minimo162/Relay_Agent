import { createMemo, type JSX } from "solid-js";
import { ellipsisPath, workspaceBasename } from "../lib/workspace-display";
import { ui } from "../lib/ui-tokens";
import type { SessionPreset } from "../lib/ipc";
import { Button } from "./ui";

function modeSummary(preset: SessionPreset): string {
  switch (preset) {
    case "plan":
      return "Default mode: Read-only plan. Relay can inspect the workspace without editing files.";
    case "explore":
      return "Default mode: Read and search. Relay can inspect files and searches without changing them.";
    default:
      return "Default mode: Edit files. Relay can apply changes, and sensitive actions may still ask for approval.";
  }
}

export function FirstRunPanel(props: {
  workspacePath: () => string;
  onChooseWorkspace: () => void;
  sessionPreset: SessionPreset;
  children: JSX.Element;
}): JSX.Element {
  const workspace = createMemo(() => props.workspacePath().trim());
  const hasWorkspace = createMemo(() => workspace().length > 0);
  const workspaceName = createMemo(() =>
    hasWorkspace() ? workspaceBasename(workspace()) : "No workspace selected yet",
  );
  const workspaceHint = createMemo(() =>
    hasWorkspace()
      ? ellipsisPath(workspace(), 64)
      : "Recommended for file-aware work. You can still send a general request without it.",
  );

  return (
    <section class="ra-first-run" aria-label="Get started">
      <div class="ra-first-run__panel">
        <div class="ra-first-run__lead">
          <p class="ra-empty-state__eyebrow">Relay Agent</p>
          <h1 class={`ra-type-section-heading ${ui.textPrimary}`}>Tell Relay what you need</h1>
          <p class={`ra-type-body-serif-sm ${ui.textSecondary}`}>
            Choose the workspace Relay should use for file-aware work, then describe the task you
            want done.
          </p>
        </div>

        <div class="ra-first-run__workspace">
          <div class="min-w-0">
            <p class={`ra-type-system-micro ${ui.mutedText}`}>Workspace</p>
            <p class={`ra-type-body-sans ${ui.textPrimary} mt-1 truncate`}>{workspaceName()}</p>
            <p class={`ra-type-caption ${ui.mutedText} mt-1 break-words`}>{workspaceHint()}</p>
          </div>
          <Button
            variant={hasWorkspace() ? "secondary" : "primary"}
            type="button"
            class="ra-type-button-label shrink-0"
            onClick={() => props.onChooseWorkspace()}
          >
            {hasWorkspace() ? "Change workspace" : "Choose workspace"}
          </Button>
        </div>

        <div class="ra-first-run__request">
          <div class="min-w-0">
            <p class={`ra-type-system-micro ${ui.mutedText}`}>First request</p>
            <p class={`ra-type-title-sm ${ui.textPrimary} mt-1`}>Start with a clear task</p>
            <p class={`ra-type-caption ${ui.mutedText} mt-1`}>
              Ask Relay to review code, plan a change, or update files in the selected workspace.
            </p>
            <p class="ra-first-run__mode-note">
              {modeSummary(props.sessionPreset)}
            </p>
          </div>
          {props.children}
        </div>
      </div>
    </section>
  );
}
