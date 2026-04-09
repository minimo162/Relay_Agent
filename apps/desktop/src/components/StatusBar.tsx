import { type JSX } from "solid-js";
import { StatusDot } from "./ui";
import type { SessionState } from "./shell-types";
import { ui } from "../lib/ui-tokens";

export function StatusBar(props: {
  sessionState: SessionState;
  sessionCount: number;
  copilotBridgeHint?: string | null;
  /** Short success line (e.g. after Copilot warmup); shown when no error/login hint. */
  copilotSuccessFlash?: string | null;
  onRetryCopilot?: () => void;
  copilotRetryDisabled?: boolean;
  /** Full workspace path for footer tooltip only (header shows the chip). */
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
  const successFlash = props.copilotSuccessFlash?.trim();
  const footerExtra = hint || successFlash;
  const full = props.workspaceFullPath?.trim() ?? "";

  return (
    <footer
      class={`ra-shell-footer px-3 py-1 flex flex-col gap-0.5 ra-type-button-label ${ui.mutedText}`}
      style={{ "min-height": footerExtra ? "36px" : "28px" }}
      data-ra-footer-session={props.sessionState}
      title={full || undefined}
      data-ra-workspace-label={full ? "set" : "unset"}
    >
      <div class="flex items-center gap-2 w-full flex-wrap">
        <StatusDot status={dot} label={label} />
        <span>Relay Agent v0.1.0</span>
        <span class="mx-auto">
          {props.sessionCount} session{props.sessionCount !== 1 ? "s" : ""}
        </span>
        {props.onRetryCopilot ? (
          <button
            type="button"
            class="ra-type-caption text-[var(--ra-text-muted)] hover:text-[var(--ra-text-primary)] underline-offset-2 hover:underline disabled:opacity-40 disabled:pointer-events-none"
            disabled={props.copilotRetryDisabled}
            onClick={() => props.onRetryCopilot?.()}
            data-ra-copilot-reconnect
          >
            Reconnect Copilot
          </button>
        ) : null}
      </div>
      {hint ? (
        <div
          role="status"
          data-ra-copilot-warmup-hint
          class="w-full truncate text-[var(--ra-accent)] opacity-95"
          title={hint}
        >
          {hint}
        </div>
      ) : successFlash ? (
        <div
          role="status"
          data-ra-copilot-warmup-success
          class="w-full truncate text-[var(--ra-text-secondary)] opacity-90"
          title={successFlash}
        >
          {successFlash}
        </div>
      ) : null}
    </footer>
  );
}
