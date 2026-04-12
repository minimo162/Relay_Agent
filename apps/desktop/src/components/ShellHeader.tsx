import { createMemo, type JSX } from "solid-js";
import { ui } from "../lib/ui-tokens";
import { Button, StatusDot } from "./ui";
import { workspaceBasename } from "../lib/workspace-display";
import type { SessionStatusSnapshot } from "./shell-types";

export function ShellHeader(props: {
  sessionStatus: SessionStatusSnapshot;
  workspacePath: () => string;
  onOpenSettings: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  firstRun?: boolean;
}): JSX.Element {
  const pathTrimmed = createMemo(() => props.workspacePath().trim());
  const hasWorkspace = createMemo(() => pathTrimmed().length > 0);
  const chipLabel = createMemo(() =>
    hasWorkspace() ? workspaceBasename(pathTrimmed()) : "Workspace not set",
  );
  const busy = createMemo(() => props.sessionStatus.phase !== "idle");

  return (
    <header class={`ra-shell-header ${props.firstRun ? "ra-shell-header--minimal" : ""}`}>
      <span class={`ra-display-title ra-type-body-sans ${ui.textPrimary}`}>Relay Agent</span>
      <div class="flex-1" />

      {props.firstRun ? (
        <Button variant="secondary" type="button" class="ra-type-button-label" onClick={props.onOpenSettings}>
          Settings
        </Button>
      ) : (
        <>
          <button
            type="button"
            class={`ra-workspace-chip max-w-[min(40vw,14rem)] shrink min-w-0 ${ui.radiusPill} border px-2.5 py-0.5 text-left ra-type-caption transition-colors ${
              hasWorkspace()
                ? "border-[var(--ra-border-strong)] bg-[var(--ra-surface-elevated)] text-[var(--ra-text-secondary)] hover:bg-[var(--ra-hover)]"
                : "border-dashed border-[var(--ra-border)] text-[var(--ra-text-muted)] hover:border-[var(--ra-text-muted)] hover:text-[var(--ra-text-secondary)]"
            }`}
            data-ra-workspace-chip
            title={hasWorkspace() ? pathTrimmed() : "No workspace folder set. Open settings to configure one."}
            aria-label={hasWorkspace() ? `Workspace folder: ${pathTrimmed()}` : "Workspace folder not set"}
            onClick={() => props.onOpenSettings()}
          >
            <span class="block truncate font-medium">{chipLabel()}</span>
          </button>

          <div class="ra-shell-header__status flex items-center gap-2 shrink-0">
            <StatusDot status={busy() ? "connecting" : "connected"} label={busy() ? "Conversation running" : "Conversation idle"} />
            <span class={`ra-type-button-label ${ui.mutedText} hidden sm:inline`}>
              {busy() ? "Working" : "Ready"}
            </span>
          </div>

          <div
            class="ra-shell-header__actions flex items-center gap-0.5 shrink-0 border-l border-[var(--ra-border)] pl-2 ml-1"
            title="Undo or redo the last workspace file change from this conversation"
          >
            <Button
              variant="ghost"
              type="button"
              class="ra-type-caption !px-2 !py-1 min-w-0"
              disabled={busy() || !props.canUndo}
              onClick={() => props.onUndo()}
            >
              Undo
            </Button>
            <Button
              variant="ghost"
              type="button"
              class="ra-type-caption !px-2 !py-1 min-w-0"
              disabled={busy() || !props.canRedo}
              onClick={() => props.onRedo()}
            >
              Redo
            </Button>
          </div>

          <Button variant="secondary" type="button" class="ra-type-button-label" onClick={props.onOpenSettings}>
            Settings
          </Button>
        </>
      )}
    </header>
  );
}
