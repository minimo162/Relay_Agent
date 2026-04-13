import { type JSX } from "solid-js";
import { ui } from "../lib/ui-tokens";
import type { SessionStatusSnapshot } from "./shell-types";

function footerLabel(status: SessionStatusSnapshot): string {
  switch (status.phase) {
    case "running":
      return "Conversation in progress";
    case "retrying":
      return "Retrying";
    case "compacting":
      return "Compacting context";
    case "waiting_approval":
      return "Waiting for approval";
    case "cancelling":
      return "Cancelling";
    case "idle":
    default:
      return "Ready";
  }
}

export function StatusBar(props: {
  sessionStatus: SessionStatusSnapshot;
}): JSX.Element {
  return (
    <footer
      class={`ra-shell-footer px-3 py-1 flex items-center gap-2 ra-type-button-label ${ui.mutedText}`}
      data-ra-footer-session={props.sessionStatus.phase}
    >
      <span class="text-[var(--ra-text-muted)]">Status</span>
      <span class={`ra-type-caption ${ui.textSecondary}`}>{footerLabel(props.sessionStatus)}</span>
    </footer>
  );
}
