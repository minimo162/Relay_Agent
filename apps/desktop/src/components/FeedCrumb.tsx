import { createMemo, type JSX } from "solid-js";
import { workspaceBasename } from "../lib/workspace-display";
import { StatusDot } from "./ui";
import type { SessionStatusSnapshot } from "./shell-types";

function statusLabel(status: SessionStatusSnapshot): string {
  switch (status.phase) {
    case "waiting_approval":
      return "Needs approval";
    case "running":
    case "retrying":
    case "compacting":
      return "Working";
    case "cancelling":
      return "Cancelling";
    case "idle":
    default:
      return "Ready";
  }
}

export function FeedCrumb(props: {
  sessionStatus: SessionStatusSnapshot;
  workspacePath: () => string;
  onOpenSettings: () => void;
  onToggleSidebar?: () => void;
  onToggleRail?: () => void;
  chatsOpen?: boolean;
  contextOpen?: boolean;
}): JSX.Element {
  const pathTrimmed = createMemo(() => props.workspacePath().trim());
  const hasWorkspace = createMemo(() => pathTrimmed().length > 0);
  const workspaceName = createMemo(() =>
    hasWorkspace() ? workspaceBasename(pathTrimmed()) : "Project not set",
  );
  const busy = createMemo(() => props.sessionStatus.phase !== "idle");

  return (
    <header class="ra-feed-crumb" role="banner">
      <span class="ra-feed-crumb__brand">
        <span class="ra-feed-crumb__brand-mark" aria-hidden="true" />
        <span class="ra-feed-crumb__brand-name">Relay Agent</span>
      </span>
      <span class="ra-feed-crumb__sep" aria-hidden="true">／</span>
      <button
        type="button"
        class="ra-feed-crumb__workspace"
        data-ra-workspace-chip
        title={hasWorkspace() ? pathTrimmed() : "No project set. Open Settings to choose one."}
        aria-label={hasWorkspace() ? `Project: ${pathTrimmed()}` : "Project not set"}
        onClick={() => props.onOpenSettings()}
      >
        {workspaceName()}
      </button>
      <div class="ra-feed-crumb__spacer" />
      <div class="ra-feed-crumb__status" title={statusLabel(props.sessionStatus)}>
        <StatusDot status={busy() ? "connecting" : "connected"} label={statusLabel(props.sessionStatus)} />
        <span class="ra-feed-crumb__status-label">{statusLabel(props.sessionStatus)}</span>
      </div>
      <button
        type="button"
        class="ra-feed-crumb__toggle"
        classList={{ "is-open": props.chatsOpen }}
        onClick={() => props.onToggleSidebar?.()}
        aria-expanded={props.chatsOpen}
        aria-controls="ra-drawer-sessions"
        data-ra-chats-trigger=""
      >
        Chats
      </button>
      <button
        type="button"
        class="ra-feed-crumb__toggle"
        classList={{ "is-open": props.contextOpen }}
        onClick={() => props.onToggleRail?.()}
        aria-expanded={props.contextOpen}
        aria-controls="ra-drawer-context"
        data-ra-context-trigger=""
      >
        Context
      </button>
    </header>
  );
}
