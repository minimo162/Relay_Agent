import { Show, createEffect, createSignal, onMount, type JSX } from "solid-js";
import { Textarea } from "./ui";
import {
  detectSlashMode,
  findSlashCommands,
  type SlashCommand,
} from "../lib/slash-commands";

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
  onSend: (text: string) => void;
  disabled: boolean;
  running: boolean;
  onCancel: () => void;
  onSlashCommand?: (input: string) => Promise<string | null>;
  onAppendAssistant?: (text: string) => void;
}): JSX.Element {
  const [text, setText] = createSignal("");
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
            <p class="ra-composer-hint">Enter to send · Shift+Enter for new line</p>
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
