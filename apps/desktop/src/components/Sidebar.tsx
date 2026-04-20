import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import type { SessionMeta } from "../session/session-display";
import { formatSessionSubtitle, sessionPrimaryLine } from "../session/session-display";
import type { SessionStatusSnapshot } from "./shell-types";
import { Input } from "./ui";
import { ui } from "../lib/ui-tokens";

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

export type SessionListEntry = { id: string; meta?: SessionMeta; status?: SessionStatusSnapshot };

function workspaceBaseName(workspacePath: string): string | null {
  const raw = workspacePath.trim();
  if (!raw) return null;
  const normalized = raw.replace(/[\\/]+$/, "");
  if (!normalized) return null;
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function statusBadgeLabel(status?: SessionStatusSnapshot): string | null {
  if (!status) return null;
  if (status.phase === "waiting_approval") return "Needs approval";
  if (status.phase === "running" || status.phase === "retrying" || status.phase === "compacting") {
    return "Running";
  }
  return null;
}

export function Sidebar(props: {
  sessions: SessionListEntry[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  workspacePath: string;
  onWorkspaceChipClick: () => void;
  onOpenSettings?: () => void;
}): JSX.Element {
  const [search, setSearch] = createSignal("");
  const workspaceName = createMemo(() => workspaceBaseName(props.workspacePath));

  const filtered = createMemo(() => {
    const q = search().toLowerCase().trim();
    const list = [...props.sessions].sort(
      (a, b) => (b.meta?.createdAt ?? 0) - (a.meta?.createdAt ?? 0),
    );
    if (!q) return list;
    return list.filter(({ id, meta }) => {
      if (id.toLowerCase().includes(q)) return true;
      if (sessionPrimaryLine(meta).toLowerCase().includes(q)) return true;
      return formatSessionSubtitle(id, meta).toLowerCase().includes(q);
    });
  });
  const hasSessions = createMemo(() => props.sessions.length > 0);
  const emptyTitle = createMemo(() => {
    if (!hasSessions()) return "No chats yet";
    if (search().trim()) return "No matching chats";
    return "No chats yet";
  });
  const emptySubtitle = createMemo(() =>
    !hasSessions() ? "Recent chats appear here after the first request." : null,
  );

  return (
    <div class="ra-sidebar-shell">
      <div class="ra-sidebar-shell__header">
        <h2 class="ra-sidebar-shell__brand">
          <span class="ra-sidebar-shell__brand-mark" aria-hidden="true" />
          <span class="ra-sidebar-shell__brand-word">
            <span class="ra-sidebar-shell__brand-name">Relay</span>
            <span class="ra-sidebar-shell__brand-sub" aria-hidden="true">静 · AGENT</span>
          </span>
        </h2>
        <button
          type="button"
          class="ra-sidebar-new-chat"
          onClick={props.onNewSession}
          aria-label="Start a new chat"
          data-ra-new-chat-trigger=""
        >
          <span class="ra-sidebar-new-chat__icon">
            <NewChatIcon />
          </span>
          <span>New chat</span>
        </button>
        <Show when={hasSessions()}>
          <Input
            type="search"
            placeholder="Search chats…"
            aria-label="Search chats"
            class="ra-sidebar-search"
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </Show>
      </div>
      <div class="ra-sidebar-shell__list">
        <div class="ra-sidebar-shell__label">Chats</div>
        <Show when={filtered().length === 0}>
          <div class="ra-sidebar-shell__empty">
            <div class={`ra-type-button-label ${ui.textPrimary}`}>{emptyTitle()}</div>
            <Show when={emptySubtitle()}>
              {(subtitle) => (
                <div class={`ra-type-caption ${ui.mutedText} mt-1 leading-relaxed`}>{subtitle()}</div>
              )}
            </Show>
          </div>
        </Show>
        <For each={filtered()}>
          {(entry) => {
            const id = entry.id;
            const primaryLabel = sessionPrimaryLine(entry.meta);
            const subLabel = formatSessionSubtitle(id, entry.meta);
            const statusLabel = statusBadgeLabel(entry.status);
            return (
              <button
                type="button"
                classList={{
                  "ra-session-row": true,
                  "ra-session-row--selected": props.activeSessionId === id,
                }}
                aria-current={props.activeSessionId === id ? "true" : undefined}
                aria-label={`${id}. ${primaryLabel}`}
                title={id}
                onClick={() => props.onSelect(id)}
              >
                <span class="ra-session-row__primary">
                  <span class="ra-session-row__title">{primaryLabel}</span>
                  <Show when={statusLabel}>
                    {(label) => <span class="ra-session-status-badge">{label()}</span>}
                  </Show>
                </span>
                <span class="ra-session-row__sub">{subLabel}</span>
              </button>
            );
          }}
        </For>
      </div>
      <div class="ra-sidebar-shell__footer">
        <button
          type="button"
          class="ra-sidebar-workspace-chip"
          onClick={props.onWorkspaceChipClick}
          title={workspaceName() ? props.workspacePath : "Choose project folder"}
        >
          <span class="ra-sidebar-workspace-chip__label">Project</span>
          <span class={`ra-sidebar-workspace-chip__value ${workspaceName() ? ui.textPrimary : "text-[var(--ra-red)]"}`}>
            {workspaceName() ?? "Not set"}
          </span>
        </button>
        <Show when={props.onOpenSettings}>
          <button
            type="button"
            class="ra-sidebar-settings-btn"
            onClick={() => props.onOpenSettings?.()}
          >
            Settings
          </button>
        </Show>
      </div>
    </div>
  );
}
