import { type JSX } from "solid-js";
import { StatusDot } from "./ui";
import type { SessionState } from "./shell-types";
import { ui } from "../lib/ui-tokens";

export function StatusBar(props: { sessionState: SessionState; sessionCount: number }): JSX.Element {
  const dot =
    props.sessionState === "running" ? "connecting"
    : props.sessionState === "error" ? "disconnected"
    : "connected";

  const label =
    props.sessionState === "running" ? "Working"
    : props.sessionState === "error" ? "Error"
    : "Ready";

  return (
    <footer
      class={`ra-shell-footer px-3 py-1 flex items-center gap-2 text-xs ${ui.mutedText}`}
      style={{ "min-height": "28px" }}
      data-ra-footer-session={props.sessionState}
    >
      <StatusDot status={dot} label={label} />
      <span>Relay Agent v0.1.0</span>
      <span class="mx-auto">
        {props.sessionCount} session{props.sessionCount !== 1 ? "s" : ""}
      </span>
    </footer>
  );
}
