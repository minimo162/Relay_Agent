import { createMemo, type JSX } from "solid-js";
import { ui } from "../lib/ui-tokens";
import { Button, StatusDot } from "./ui";
import { workspaceBasename } from "../lib/workspace-display";

export function ShellHeader(props: {
  sessionRunning: boolean;
  showToolActivityInline: boolean;
  onToolActivityChange: (value: boolean) => void;
  onOpenSettings: () => void;
  /** Configured workspace root (trimmed empty = unset). */
  workspacePath: () => string;
  /** Opens Settings (same as header Settings); used by workspace chip. */
  onWorkspaceChipClick: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): JSX.Element {
  const pathTrimmed = createMemo(() => props.workspacePath().trim());
  const hasWorkspace = createMemo(() => pathTrimmed().length > 0);
  const chipLabel = createMemo(() =>
    hasWorkspace() ? workspaceBasename(pathTrimmed()) : "Workspace not set",
  );
  const chipTitle = createMemo(() =>
    hasWorkspace()
      ? pathTrimmed()
      : "No workspace folder set. Click to open the settings panel and choose a folder or enter a path.",
  );

  const chipAriaLabel = createMemo(() =>
    hasWorkspace()
      ? `Workspace folder: ${pathTrimmed()}. Click to change.`
      : "Workspace folder not set. Click to configure.",
  );

  const onToolKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      props.onToolActivityChange(false);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      props.onToolActivityChange(true);
    }
  };

  return (
    <header class="ra-shell-header">
      <span class={`font-semibold text-sm tracking-tight ${ui.textPrimary}`}>Relay Agent</span>
      <button
        type="button"
        class={`ml-2 max-w-[min(40vw,14rem)] shrink min-w-0 rounded-full border px-2.5 py-0.5 text-left text-[11px] transition-colors ${
          hasWorkspace()
            ? "border-[var(--ra-border-strong)] bg-[var(--ra-surface-elevated)] text-[var(--ra-text-secondary)] hover:bg-[var(--ra-hover)]"
            : "border-dashed border-[var(--ra-border)] text-[var(--ra-text-muted)] hover:border-[var(--ra-text-muted)] hover:text-[var(--ra-text-secondary)]"
        }`}
        data-ra-workspace-chip
        title={chipTitle()}
        aria-label={chipAriaLabel()}
        onClick={() => props.onWorkspaceChipClick()}
      >
        <span class="block truncate font-medium">{chipLabel()}</span>
      </button>
      <div class="flex-1" />
      <div
        class="flex items-center gap-2 shrink-0"
        title={props.sessionRunning ? "Agent is running." : "Agent is idle."}
      >
        <StatusDot
          status={props.sessionRunning ? "connecting" : "connected"}
          label={props.sessionRunning ? "Agent running" : "Agent idle"}
        />
        <span class={`text-xs ${ui.mutedText} hidden sm:inline`}>Agent</span>
      </div>
      <div
        class="flex items-center gap-0.5 shrink-0 border-l border-[var(--ra-border)] pl-2 ml-1"
        title="Undo or redo the last workspace file change from this session"
      >
        <Button
          variant="ghost"
          type="button"
          class="!px-2 !py-1 !text-[11px] min-w-0"
          disabled={props.sessionRunning || !props.canUndo}
          onClick={() => props.onUndo()}
        >
          Undo
        </Button>
        <Button
          variant="ghost"
          type="button"
          class="!px-2 !py-1 !text-[11px] min-w-0"
          disabled={props.sessionRunning || !props.canRedo}
          onClick={() => props.onRedo()}
        >
          Redo
        </Button>
      </div>
      <div
        role="radiogroup"
        aria-label="Tool activity in chat"
        class="ra-tab-track ra-tab-track--header"
        data-ra-toggle-tool-activity
        onKeyDown={onToolKeyDown}
      >
        <button
          type="button"
          role="radio"
          aria-checked={!props.showToolActivityInline}
          classList={{
            "ra-tab-track__btn": true,
            "ra-tab-track__btn--active": !props.showToolActivityInline,
          }}
          onClick={() => props.onToolActivityChange(false)}
        >
          Chat only
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={props.showToolActivityInline}
          classList={{
            "ra-tab-track__btn": true,
            "ra-tab-track__btn--active": props.showToolActivityInline,
          }}
          onClick={() => props.onToolActivityChange(true)}
        >
          With tools
        </button>
      </div>
      <Button
        variant="ghost"
        type="button"
        class="!px-3 !py-1 !text-xs"
        title="Workspace, limits, diagnostics"
        onClick={() => props.onOpenSettings()}
      >
        Settings
      </Button>
    </header>
  );
}
