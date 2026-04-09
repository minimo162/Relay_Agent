import { type JSX } from "solid-js";
import { StatusDot } from "./ui";
import type { SessionState } from "./shell-types";
import { ui } from "../lib/ui-tokens";
import { ellipsisPath } from "../lib/workspace-display";

export function StatusBar(props: {
  sessionState: SessionState;
  sessionCount: number;
  copilotBridgeHint?: string | null;
  /** Full workspace path for tooltip; display uses ellipsis. */
  workspaceFullPath?: string | null;
}): JSX.Element {
  const dot =
    props.sessionState === "running" ? "connecting"
    : props.sessionState === "error" ? "disconnected"
    : "connected";

  const label =
    props.sessionState === "running" ? "Working"
    : props.sessionState === "error" ? "Error"
    : "Ready";

  const hint = props.copilotBridgeHint?.trim();
  const full = props.workspaceFullPath?.trim() ?? "";
  const displayPath = full ? ellipsisPath(full, 72) : "";

  const copyWorkspacePath = () => {
    if (!full) return;
    void navigator.clipboard.writeText(full).catch(() => {});
  };

  const footerMinHeight =
    hint ? (full ? "52px" : "40px")
    : full ? "44px"
    : "28px";

  return (
    <footer
      class={`ra-shell-footer px-3 py-1 flex flex-col gap-0.5 text-sm ${ui.mutedText}`}
      style={{ "min-height": footerMinHeight }}
      data-ra-footer-session={props.sessionState}
    >
      <div class="flex items-center gap-2 w-full flex-wrap">
        <StatusDot status={dot} label={label} />
        <span>Relay Agent v0.1.0</span>
        <span class="mx-auto">
          {props.sessionCount} session{props.sessionCount !== 1 ? "s" : ""}
        </span>
      </div>
      {full ? (
        <div class="flex items-center gap-2 w-full min-h-[1.25rem]">
          <div
            class="flex-1 min-w-0 font-mono text-xs text-[var(--ra-text-secondary)] truncate"
            title={full}
            data-ra-workspace-label
          >
            Workspace: {displayPath}
          </div>
          <button
            type="button"
            class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-[var(--ra-border)] text-[var(--ra-text-muted)] hover:bg-[var(--ra-hover)] hover:text-[var(--ra-text-secondary)]"
            title="Copy full path"
            data-ra-workspace-copy
            onClick={() => copyWorkspacePath()}
          >
            Copy
          </button>
        </div>
      ) : (
        <div
          class="w-full text-xs text-[var(--ra-text-muted)] truncate"
          data-ra-workspace-label
          title="Open Settings to set a workspace folder"
        >
          Workspace not set — use Settings to choose a folder or enter a path.
        </div>
      )}
      {hint ? (
        <div
          role="status"
          data-ra-copilot-warmup-hint
          class="w-full truncate text-[var(--ra-accent)] opacity-95"
          title={hint}
        >
          {hint}
        </div>
      ) : null}
    </footer>
  );
}
