import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import type { SessionMeta } from "../session/session-display";
import { formatSessionSubtitle, sessionPrimaryLine } from "../session/session-display";
import { Input } from "./ui";
import { ui } from "../lib/ui-tokens";

export type SessionListEntry = { id: string; meta?: SessionMeta };

export function Sidebar(props: {
  sessions: SessionListEntry[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const [search, setSearch] = createSignal("");

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
    if (!hasSessions()) return "No sessions yet";
    if (search().trim()) return "No matching sessions";
    return "No sessions yet";
  });
  const emptySubtitle = createMemo(() =>
    !hasSessions() ? "Your recent work appears here after the first request." : null,
  );

  return (
    <aside class="ra-shell-sidebar" aria-label="Sessions">
      <div class="ra-sidebar-shell">
        <div class="ra-sidebar-shell__header">
          <h2 class={`ra-display-title ra-type-body-sans ${ui.textPrimary} mb-2`}>Sessions</h2>
          <Show when={hasSessions()}>
            <Input
              type="search"
              placeholder="Search sessions…"
              aria-label="Search sessions"
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </Show>
        </div>
        <div class="ra-sidebar-shell__list">
          <Show when={filtered().length === 0}>
            <div class="py-8 px-4 text-center">
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
                  <span class="block font-medium truncate">{primaryLabel}</span>
                  <span class={`block ra-type-caption mt-0.5 truncate ${ui.mutedText}`}>{subLabel}</span>
                </button>
              );
            }}
          </For>
        </div>
      </div>
    </aside>
  );
}
