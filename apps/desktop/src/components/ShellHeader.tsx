import { createMemo, type JSX } from "solid-js";
import { ui } from "../lib/ui-tokens";
import { Button, StatusDot } from "./ui";
import { workspaceBasename } from "../lib/workspace-display";
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

function NewChatIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12.5 3.5H4.75A1.25 1.25 0 0 0 3.5 4.75V11.25A1.25 1.25 0 0 0 4.75 12.5H11.25" />
      <path d="M13 2.75V6.25M11.25 4.5H14.75" />
    </svg>
  );
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator.platform || "").toLowerCase();
  const ua = (navigator.userAgent || "").toLowerCase();
  return platform.includes("mac") || ua.includes("mac os");
}

export function ShellHeader(props: {
  sessionStatus: SessionStatusSnapshot;
  workspacePath: () => string;
  onOpenSettings: () => void;
  onNewSession?: () => void;
  onToggleChats?: () => void;
  onToggleContext?: () => void;
  chatsOpen?: boolean;
  contextOpen?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}): JSX.Element {
  const pathTrimmed = createMemo(() => props.workspacePath().trim());
  const hasWorkspace = createMemo(() => pathTrimmed().length > 0);
  const chipLabel = createMemo(() =>
    hasWorkspace() ? workspaceBasename(pathTrimmed()) : "Project not set",
  );
  const busy = createMemo(() => props.sessionStatus.phase !== "idle");
  const showWriteActions = createMemo(() => props.canUndo || props.canRedo);
  const newChatShortcut = createMemo(() => (isMacPlatform() ? "⌘N" : "Ctrl+N"));

  return (
    <header class="ra-shell-header">
      <span class={`ra-shell-header__brand ra-display-title ra-type-body-sans ${ui.textPrimary}`}>Relay Agent</span>

      {props.onNewSession ? (
        <button
          type="button"
          class="ra-new-chat-btn"
          onClick={() => props.onNewSession?.()}
          title={`Start a new chat (${newChatShortcut()})`}
          aria-label="Start a new chat"
          aria-keyshortcuts={isMacPlatform() ? "Meta+N" : "Control+N"}
          data-ra-new-chat-trigger=""
        >
          <span class="ra-new-chat-btn__icon">
            <NewChatIcon />
          </span>
          <span>New chat</span>
          <span class="ra-new-chat-btn__kbd" aria-hidden="true">{newChatShortcut()}</span>
        </button>
      ) : null}

      <div class="flex-1" />

      <button
        type="button"
        class={`ra-workspace-chip ra-shell-header__workspace max-w-[min(40vw,14rem)] shrink min-w-0 text-left transition-colors ${
          hasWorkspace()
            ? "text-[var(--ra-text-secondary)] hover:bg-[var(--ra-hover)]"
            : "text-[var(--ra-text-muted)] hover:text-[var(--ra-text-secondary)]"
        }`}
        data-ra-workspace-chip
        title={hasWorkspace() ? pathTrimmed() : "No project set. Open Settings to choose one."}
        aria-label={hasWorkspace() ? `Project: ${pathTrimmed()}` : "Project not set"}
        onClick={() => props.onOpenSettings()}
      >
        <span class="ra-shell-header__workspace-label">Project</span>
        <span class="ra-shell-header__workspace-value">{chipLabel()}</span>
      </button>

      <div class="ra-shell-header__status flex items-center gap-2 shrink-0">
        <StatusDot status={busy() ? "connecting" : "connected"} label={statusLabel(props.sessionStatus)} />
        <span class={`ra-shell-header__status-label ra-type-caption ${ui.mutedText} hidden sm:inline`}>
          {statusLabel(props.sessionStatus)}
        </span>
      </div>

      <div class="ra-shell-header__nav">
        <Button
          variant="secondary"
          type="button"
          class={`ra-type-button-label ra-shell-header__toggle ${props.chatsOpen ? "is-open" : ""}`}
          aria-expanded={props.chatsOpen}
          aria-controls="ra-drawer-sessions"
          onClick={() => props.onToggleChats?.()}
          data-ra-chats-trigger=""
        >
          Chats
        </Button>
        <Button
          variant="secondary"
          type="button"
          class={`ra-type-button-label ra-shell-header__toggle ${props.contextOpen ? "is-open" : ""}`}
          aria-expanded={props.contextOpen}
          aria-controls="ra-drawer-context"
          onClick={() => props.onToggleContext?.()}
          data-ra-context-trigger=""
        >
          Context
        </Button>
      </div>

      {showWriteActions() ? (
        <div
          class="ra-shell-header__actions flex items-center gap-0.5 shrink-0"
          title="Undo or redo the last file change from this conversation"
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
      ) : null}

      <Button
        variant="ghost"
        type="button"
        class="ra-type-button-label ra-shell-header__settings"
        onClick={props.onOpenSettings}
      >
        Settings
      </Button>
    </header>
  );
}
