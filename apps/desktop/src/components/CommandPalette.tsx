import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import type { SessionMeta } from "../session/session-display";
import { sessionPrimaryLine, formatSessionSubtitle } from "../session/session-display";
import type { SessionStatusSnapshot } from "./shell-types";
import { findSlashCommands, type SlashCommand } from "../lib/slash-commands";

export type SessionListEntry = { id: string; meta?: SessionMeta; status?: SessionStatusSnapshot };

type PaletteAction =
  | {
      kind: "session";
      id: string;
      title: string;
      sub: string;
      status?: SessionStatusSnapshot;
    }
  | {
      kind: "command";
      command: string;
      title: string;
      sub: string;
    }
  | {
      kind: "action";
      id: string;
      title: string;
      sub: string;
    };

function statusBadge(status?: SessionStatusSnapshot): string | null {
  if (!status) return null;
  if (status.phase === "waiting_approval") return "Needs approval";
  if (status.phase === "running" || status.phase === "retrying" || status.phase === "compacting") {
    return "Running";
  }
  return null;
}

export function CommandPalette(props: {
  open: boolean;
  onClose: () => void;
  sessions: SessionListEntry[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onRunSlashCommand: (commandText: string) => void;
}): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [cursor, setCursor] = createSignal(0);
  let inputRef!: HTMLInputElement;
  let listRef: HTMLDivElement | undefined;

  const sessionActions = createMemo<PaletteAction[]>(() => {
    return [...props.sessions]
      .filter((s) => s.id !== props.activeSessionId)
      .sort((a, b) => (b.meta?.createdAt ?? 0) - (a.meta?.createdAt ?? 0))
      .map<PaletteAction>((s) => ({
        kind: "session",
        id: s.id,
        title: sessionPrimaryLine(s.meta),
        sub: formatSessionSubtitle(s.id, s.meta),
        status: s.status,
      }));
  });

  const commandActions = createMemo<PaletteAction[]>(() => {
    const all: SlashCommand[] = findSlashCommands("");
    return all.map<PaletteAction>((c) => ({
      kind: "command",
      command: c.command,
      title: c.command,
      sub: c.description,
    }));
  });

  const quickActions = createMemo<PaletteAction[]>(() => [
    { kind: "action", id: "new-chat", title: "Start a new chat", sub: "Begin a separate conversation" },
    { kind: "action", id: "open-settings", title: "Open Settings", sub: "Project, Copilot, permissions" },
  ]);

  type PaletteEntry = { item: PaletteAction; index: number };
  type PaletteGroup = { label: string; items: PaletteEntry[] };

  const filtered = createMemo<PaletteGroup[]>(() => {
    const q = query().trim().toLowerCase();
    const matches = (s: string) => s.toLowerCase().includes(q);

    const sessions = q
      ? sessionActions().filter((a) => matches(a.title) || matches(a.sub))
      : sessionActions();
    const commands = q
      ? commandActions().filter((a) => matches(a.title) || matches(a.sub))
      : commandActions();
    const quick = q
      ? quickActions().filter((a) => matches(a.title) || matches(a.sub))
      : quickActions();

    const groups: PaletteGroup[] = [];
    let i = 0;
    const push = (label: string, items: PaletteAction[]) => {
      if (items.length === 0) return;
      groups.push({ label, items: items.map((item) => ({ item, index: i++ })) });
    };
    push("Chats", sessions);
    push("Slash commands", commands);
    push("Quick actions", quick);
    return groups;
  });

  const flatItems = createMemo<PaletteAction[]>(() =>
    filtered().flatMap((g) => g.items.map((e) => e.item)),
  );

  createEffect(
    on(filtered, () => {
      setCursor(0);
    }),
  );

  createEffect(
    on(
      () => props.open,
      (open, prev) => {
        if (open && !prev) {
          setQuery("");
          setCursor(0);
          queueMicrotask(() => inputRef?.focus());
        }
      },
    ),
  );

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(flatItems().length - 1, c + 1));
        scrollSelectedIntoView();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
        scrollSelectedIntoView();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flatItems()[cursor()];
        if (item) activate(item);
      }
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  function scrollSelectedIntoView() {
    queueMicrotask(() => {
      const el = listRef?.querySelector<HTMLElement>("[data-ra-palette-active='true']");
      el?.scrollIntoView({ block: "nearest" });
    });
  }

  function activate(item: PaletteAction) {
    if (item.kind === "session") {
      props.onSelectSession(item.id);
    } else if (item.kind === "command") {
      props.onRunSlashCommand(item.command);
    } else if (item.kind === "action") {
      if (item.id === "new-chat") props.onNewSession();
      else if (item.id === "open-settings") props.onOpenSettings();
    }
    props.onClose();
  }

  return (
    <Show when={props.open}>
      <div
        class="ra-palette-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-ra-command-palette
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div class="ra-palette">
          <div class="ra-palette__head">
            <span class="ra-palette__icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="7" cy="7" r="4.5" />
                <line x1="10.5" y1="10.5" x2="14" y2="14" />
              </svg>
            </span>
            <input
              ref={inputRef}
              class="ra-palette__input"
              type="text"
              placeholder="Search chats, slash commands, actions…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              spellcheck={false}
              autocomplete="off"
            />
            <span class="ra-palette__hint">
              <kbd>↑↓</kbd> <kbd>↵</kbd> <kbd>Esc</kbd>
            </span>
          </div>

          <div ref={listRef} class="ra-palette__list">
            <Show
              when={flatItems().length > 0}
              fallback={
                <div class="ra-palette__empty">
                  <p class="ra-type-button-label text-[var(--ra-text-primary)]">No matches</p>
                  <p class="ra-type-caption text-[var(--ra-text-muted)] mt-1">
                    Try a different keyword or start a new chat.
                  </p>
                </div>
              }
            >
              <For each={filtered()}>
                {(group) => (
                  <div class="ra-palette__group">
                    <div class="ra-palette__group-label">{group.label}</div>
                    <For each={group.items}>
                      {(entry) => {
                        const isActive = createMemo(() => cursor() === entry.index);
                        const item = entry.item;
                        return (
                          <button
                            type="button"
                            data-ra-palette-active={isActive() ? "true" : undefined}
                            classList={{
                              "ra-palette__row": true,
                              "ra-palette__row--active": isActive(),
                            }}
                            onMouseEnter={() => setCursor(entry.index)}
                            onClick={() => activate(item)}
                          >
                            <span class="ra-palette__row-glyph" aria-hidden="true">
                              <Show
                                when={item.kind === "session"}
                                fallback={
                                  <Show
                                    when={item.kind === "command"}
                                    fallback={<span class="ra-palette__glyph-action">→</span>}
                                  >
                                    <span class="ra-palette__glyph-cmd">/</span>
                                  </Show>
                                }
                              >
                                <span class="ra-palette__glyph-session">●</span>
                              </Show>
                            </span>
                            <span class="ra-palette__row-body">
                              <span class="ra-palette__row-title">{item.title}</span>
                              <span class="ra-palette__row-sub">{item.sub}</span>
                            </span>
                            <Show when={item.kind === "session" && statusBadge(item.status)}>
                              {(label) => <span class="ra-palette__row-badge">{label()}</span>}
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
