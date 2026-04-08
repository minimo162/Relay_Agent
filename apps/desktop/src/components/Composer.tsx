import { For, Show, createEffect, createMemo, createSignal, onMount, type JSX } from "solid-js";
import { Textarea } from "./ui";
import {
  detectSlashMode,
  findSlashCommands,
  type SlashCommand,
} from "../lib/slash-commands";
import {
  addPromptTemplate,
  listPromptTemplates,
  removePromptTemplate,
} from "../lib/prompt-templates-store";
import type { SessionPreset } from "../lib/ipc";

/** Matches `.ra-composer-shell textarea` max-height in index.css */
const COMPOSER_TEXTAREA_MAX_PX = 200;

function adjustComposerTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const next = Math.min(el.scrollHeight, COMPOSER_TEXTAREA_MAX_PX);
  el.style.height = `${next}px`;
}

function SendArrowIcon() {
  return (
    <svg
      class="ra-composer-send__icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function SlashAutocomplete(props: {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onSelectIndex: (index: number) => void;
}) {
  return (
    <div
      class="absolute left-0 bottom-full mb-1 min-w-full w-64 rounded-xl py-1 overflow-hidden z-50 border border-[var(--ra-border)] bg-[var(--ra-surface-elevated)] shadow-[var(--ra-shadow-sm)]"
      role="listbox"
      aria-label="Slash commands"
    >
      {props.commands.length === 0 ? (
        <div class="px-3 py-1.5 text-xs text-[var(--ra-text-muted)]">No matching commands</div>
      ) : (
        props.commands.map((cmd, i) => (
          <div
            role="option"
            aria-selected={i === props.selectedIndex}
            class={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs transition-colors ${
              i === props.selectedIndex
                ? "bg-[var(--ra-accent)] text-white"
                : "text-[var(--ra-text-secondary)] hover:bg-[var(--ra-hover)]"
            }`}
            onClick={() => props.onSelect(cmd)}
            onMouseEnter={() => props.onSelectIndex(i)}
          >
            <span class="font-mono font-medium">/{cmd.command}</span>
            <span class="opacity-70 ml-auto truncate max-w-[120px]">{cmd.description}</span>
          </div>
        ))
      )}
      <div class="px-3 py-1 text-[10px] text-[var(--ra-text-muted)] border-t border-[var(--ra-border)]">
        <kbd class="font-mono">Tab</kbd> or <kbd class="font-mono">Enter</kbd> to select
      </div>
    </div>
  );
}

export function Composer(props: {
  sessionPreset: SessionPreset;
  onSessionPresetChange: (preset: SessionPreset) => void;
  onSend: (text: string) => void;
  disabled: boolean;
  running: boolean;
  onCancel: () => void;
  onSlashCommand?: (input: string) => Promise<string | null>;
  onAppendAssistant?: (text: string) => void;
}): JSX.Element {
  const [text, setText] = createSignal("");
  const [templatesOpen, setTemplatesOpen] = createSignal(false);
  const [templateRev, setTemplateRev] = createSignal(0);
  const savedTemplates = createMemo(() => {
    void templateRev();
    return listPromptTemplates();
  });
  const [slashMode, setSlashMode] = createSignal<{
    query: string;
    commands: SlashCommand[];
    selectedIndex: number;
  } | null>(null);

  let textareaRef!: HTMLTextAreaElement;

  createEffect(() => {
    text();
    queueMicrotask(() => {
      if (textareaRef) adjustComposerTextareaHeight(textareaRef);
    });
  });

  onMount(() => {
    queueMicrotask(() => {
      if (textareaRef) adjustComposerTextareaHeight(textareaRef);
    });
  });

  const closeSlashDropdown = () => setSlashMode(null);

  const selectCommand = (cmd: SlashCommand) => {
    setText(`/${cmd.command} `);
    closeSlashDropdown();
    textareaRef.focus();
  };

  const send = async () => {
    const value = text().trim();
    if (!value || props.disabled) return;

    if (value.startsWith("/") && props.onSlashCommand) {
      const response = await props.onSlashCommand(value);
      setText("");
      queueMicrotask(() => {
        if (textareaRef) adjustComposerTextareaHeight(textareaRef);
      });
      if (response && props.onAppendAssistant) {
        props.onAppendAssistant(response);
      }
      props.onSend(value);
      return;
    }

    props.onSend(value);
    setText("");
    queueMicrotask(() => {
      if (textareaRef) adjustComposerTextareaHeight(textareaRef);
    });
  };

  const onInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const newVal = e.currentTarget.value;
    setText(newVal);
    adjustComposerTextareaHeight(e.currentTarget);

    const detection = detectSlashMode(newVal, newVal.length);
    if (detection) {
      const matches = findSlashCommands(detection.query);
      setSlashMode({
        query: detection.query,
        commands: matches,
        selectedIndex: 0,
      });
    } else {
      closeSlashDropdown();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    const current = slashMode();

    if (current && current.commands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashMode({
          ...current,
          selectedIndex: (current.selectedIndex + 1) % current.commands.length,
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashMode({
          ...current,
          selectedIndex:
            (current.selectedIndex - 1 + current.commands.length) % current.commands.length,
        });
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        selectCommand(current.commands[current.selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSlashDropdown();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectCommand(current.commands[current.selectedIndex]);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const canSend = () => text().trim().length > 0 && !props.running;

  return (
    <div class="ra-composer relative shrink-0">
      <div class="ra-composer-inner">
        <div class="ra-composer-shell relative">
          <div class="ra-composer-input-wrap">
            <Textarea
              ref={textareaRef}
              rows={1}
              placeholder="What would you like to do? (type / for commands)"
              value={text()}
              onInput={onInput}
              onKeyDown={onKey}
              disabled={props.disabled}
              class="ra-composer-input resize-none w-full"
            />
            <Show when={slashMode()}>
              {(m) => (
                <SlashAutocomplete
                  commands={m().commands}
                  selectedIndex={m().selectedIndex}
                  onSelect={selectCommand}
                  onSelectIndex={(index) => setSlashMode({ ...m(), selectedIndex: index })}
                />
              )}
            </Show>
          </div>
          <div class="ra-composer-toolbar">
            <div class="flex items-center gap-2 min-w-0 flex-wrap">
              <p class="ra-composer-hint shrink-0">Enter to send · Shift+Enter for new line</p>
              <div
                class="flex shrink-0 rounded-md border border-[var(--ra-border)] overflow-hidden text-[11px]"
                role="group"
                aria-label="Session mode"
              >
                <button
                  type="button"
                  class={`px-2 py-0.5 transition-colors ${
                    props.sessionPreset === "build"
                      ? "bg-[var(--ra-accent)] text-white"
                      : "text-[var(--ra-text-secondary)] hover:bg-[var(--ra-hover)]"
                  }`}
                  aria-pressed={props.sessionPreset === "build"}
                  title="Full tool access; writes and shell may ask for approval"
                  onClick={() => props.onSessionPresetChange("build")}
                >
                  Build
                </button>
                <button
                  type="button"
                  class={`px-2 py-0.5 border-l border-[var(--ra-border)] transition-colors ${
                    props.sessionPreset === "plan"
                      ? "bg-[var(--ra-accent)] text-white"
                      : "text-[var(--ra-text-secondary)] hover:bg-[var(--ra-hover)]"
                  }`}
                  aria-pressed={props.sessionPreset === "plan"}
                  title="Read-only host: no file/shell writes—use Build to apply changes"
                  onClick={() => props.onSessionPresetChange("plan")}
                >
                  Plan
                </button>
                <button
                  type="button"
                  class={`px-2 py-0.5 border-l border-[var(--ra-border)] transition-colors ${
                    props.sessionPreset === "explore"
                      ? "bg-[var(--ra-accent)] text-white"
                      : "text-[var(--ra-text-secondary)] hover:bg-[var(--ra-hover)]"
                  }`}
                  aria-pressed={props.sessionPreset === "explore"}
                  title="Only read_file, glob_search, grep_search—fast codebase scan; use Plan or Build for more"
                  onClick={() => props.onSessionPresetChange("explore")}
                >
                  Explore
                </button>
              </div>
              <div class="relative shrink-0">
                <button
                  type="button"
                  class="text-[11px] px-2 py-0.5 rounded-md border border-[var(--ra-border)] text-[var(--ra-text-secondary)] hover:bg-[var(--ra-hover)]"
                  aria-expanded={templatesOpen()}
                  aria-haspopup="listbox"
                  data-ra-templates-trigger
                  onClick={() => setTemplatesOpen((o) => !o)}
                >
                  Templates
                </button>
                <Show when={templatesOpen()}>
                  <div
                    class="absolute left-0 bottom-full mb-1 z-50 min-w-[220px] max-w-[min(100vw-2rem,320px)] rounded-xl border border-[var(--ra-border)] bg-[var(--ra-surface-elevated)] shadow-[var(--ra-shadow-sm)] py-1 max-h-56 overflow-y-auto"
                    role="listbox"
                    aria-label="Prompt templates"
                  >
                    <Show
                      when={savedTemplates().length > 0}
                      fallback={
                        <div class="px-3 py-2 text-[11px] text-[var(--ra-text-muted)]">
                          No saved templates yet.
                        </div>
                      }
                    >
                      <For each={savedTemplates()}>
                        {(t) => (
                          <div class="flex items-start gap-1 px-2 py-1 hover:bg-[var(--ra-hover)]">
                            <button
                              type="button"
                              role="option"
                              class="flex-1 text-left text-xs text-[var(--ra-text-primary)] truncate"
                              onClick={() => {
                                setText(t.body);
                                setTemplatesOpen(false);
                                queueMicrotask(() => textareaRef?.focus());
                              }}
                            >
                              {t.title}
                            </button>
                            <button
                              type="button"
                              class="text-[10px] text-[var(--ra-text-muted)] px-1"
                              title="Remove template"
                              onClick={() => {
                                removePromptTemplate(t.id);
                                setTemplateRev((n) => n + 1);
                              }}
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </For>
                    </Show>
                    <div class="border-t border-[var(--ra-border)] mt-1 pt-1 px-2 pb-1">
                      <button
                        type="button"
                        class="text-[11px] w-full text-left text-[var(--ra-accent)] disabled:opacity-40"
                        disabled={!text().trim()}
                        onClick={() => {
                          const title = window.prompt("Name this template");
                          if (!title?.trim() || !text().trim()) return;
                          addPromptTemplate(title.trim(), text());
                          setTemplateRev((n) => n + 1);
                          setTemplatesOpen(false);
                        }}
                      >
                        Save current as template…
                      </button>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
            <Show when={props.sessionPreset === "plan" || props.sessionPreset === "explore"}>
              <p class="text-[10px] text-[var(--ra-text-muted)] mt-1.5 max-w-[52rem] leading-snug">
                {props.sessionPreset === "explore"
                  ? "Explore uses only workspace read/search tools. Switch to Build to edit files, or Plan for broader read-only analysis (e.g. task list)."
                  : "Plan is read-only on the host—ideas and diffs stay in chat until you start a new session with Build to apply changes."}
              </p>
            </Show>
            <div class="ra-composer-toolbar-actions">
              <Show when={props.running}>
                <button
                  type="button"
                  class="ra-composer-cancel"
                  onClick={props.onCancel}
                >
                  Cancel
                </button>
              </Show>
              <Show when={canSend()}>
                <button
                  type="button"
                  class="ra-composer-send"
                  disabled={props.disabled}
                  aria-label="Send"
                  onClick={() => void send()}
                >
                  <SendArrowIcon />
                  <span>Send</span>
                </button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
