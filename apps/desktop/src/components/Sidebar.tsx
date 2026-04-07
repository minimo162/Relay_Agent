import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import { Input } from "./ui";
import { ui } from "../lib/ui-tokens";

export function Sidebar(props: {
  sessionIds: string[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const [search, setSearch] = createSignal("");

  const filtered = createMemo(() => {
    const q = search().toLowerCase();
    if (!q) return props.sessionIds;
    return props.sessionIds.filter((id) => id.toLowerCase().includes(q));
  });

  return (
    <aside class="ra-shell-sidebar" aria-label="Sessions">
      <div class="ra-sidebar-shell">
        <div class="ra-sidebar-shell__header">
          <h2 class={`text-sm font-semibold ${ui.textPrimary} mb-2`}>Sessions</h2>
          <Input
            type="search"
            placeholder="Search sessions…"
            class="text-xs"
            aria-label="Search sessions"
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
        <div class="ra-sidebar-shell__list">
          <Show when={filtered().length === 0}>
            <div class={`text-xs ${ui.mutedText} text-center py-8`}>No matching sessions</div>
          </Show>
          <For each={filtered()}>
            {(id) => (
              <button
                type="button"
                classList={{
                  "ra-session-row": true,
                  "ra-session-row--selected": props.activeSessionId === id,
                }}
                aria-current={props.activeSessionId === id ? "true" : undefined}
                aria-label={id}
                onClick={() => props.onSelect(id)}
              >
                {id.slice(0, 8)}…
              </button>
            )}
          </For>
        </div>
      </div>
    </aside>
  );
}
