import { type JSX } from "solid-js";
import { StatusDot } from "./ui";
import type { SessionState } from "./shell-types";
import { ui } from "../lib/ui-tokens";

export function StatusBar(props: {
  sessionState: SessionState;
  sessionCount: number;
  copilotBridgeHint?: string | null;
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

  return (
    <footer
      class={`ra-shell-footer px-3 py-1 flex flex-col gap-0.5 text-xs ${ui.mutedText}`}
      style={{ "min-height": hint ? "40px" : "28px" }}
      data-ra-footer-session={props.sessionState}
    >
      <div class="flex items-center gap-2 w-full">
        <StatusDot status={dot} label={label} />
        <span>Relay Agent v0.1.0</span>
        <span class="mx-auto">
          {props.sessionCount} session{props.sessionCount !== 1 ? "s" : ""}
        </span>
      </div>
      {hint ? (
        <div
          role="status"
          data-ra-copilot-warmup-hint
          class="w-full truncate text-[var(--ra-yellow)] opacity-95"
          title={hint}
        >
          {hint}
        </div>
      ) : null}
    </footer>
  );
}
