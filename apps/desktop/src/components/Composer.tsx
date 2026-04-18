import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Textarea } from "./ui";
import { detectSlashMode, findSlashCommands, type SlashCommand } from "../lib/slash-commands";

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
      class="ra-slash-palette"
      role="listbox"
      aria-label="Slash commands"
    >
      {props.commands.length === 0 ? (
        <div class="ra-slash-palette__empty">No matching commands</div>
      ) : (
        props.commands.map((cmd, i) => (
          <div
            role="option"
            aria-selected={i === props.selectedIndex}
            classList={{
              "ra-slash-palette__option": true,
              "is-selected": i === props.selectedIndex,
            }}
            onClick={() => props.onSelect(cmd)}
            onMouseEnter={() => props.onSelectIndex(i)}
          >
            <span class="ra-slash-palette__command">{cmd.command}</span>
            <span class="ra-slash-palette__desc">{cmd.description}</span>
          </div>
        ))
      )}
      <div class="ra-slash-palette__hint">
        <kbd>Tab</kbd> <kbd>Enter</kbd> select · <kbd>Esc</kbd> dismiss
      </div>
    </div>
  );
}

export function Composer(props: {
  onSend: (text: string) => boolean | Promise<boolean>;
  disabled: boolean;
  running: boolean;
  onCancel: () => void;
  onSlashCommand?: (input: string) => Promise<string | null>;
  onAppendAssistant?: (text: string) => void;
  hero?: boolean;
  autoFocus?: boolean;
  disabledReason?: string | null;
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

  createEffect(() => {
    if (!props.autoFocus || props.disabled) return;
    queueMicrotask(() => {
      textareaRef?.focus();
    });
  });

  const closeSlashDropdown = () => setSlashMode(null);

  const selectCommand = (cmd: SlashCommand) => {
    setText(`${cmd.command} `);
    closeSlashDropdown();
    textareaRef.focus();
  };

  const send = async () => {
    const value = text().trim();
    if (!value || props.disabled) return;

    if (value.startsWith("/") && props.onSlashCommand) {
      const accepted = await props.onSend(value);
      if (!accepted) return;
      const response = await props.onSlashCommand(value);
      setText("");
      queueMicrotask(() => {
        if (textareaRef) adjustComposerTextareaHeight(textareaRef);
      });
      if (response && props.onAppendAssistant) {
        props.onAppendAssistant(response);
      }
      return;
    }

    const accepted = await props.onSend(value);
    if (!accepted) return;
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
          selectedIndex: (current.selectedIndex - 1 + current.commands.length) % current.commands.length,
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

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  };

  const canSend = () => text().trim().length > 0 && !props.running && !props.disabled;
  const placeholder = () => {
    if (!props.hero) return "Ask for the result you need.";
    return "Example: simplify this setup flow.";
  };

  const openSlashPalette = () => {
    if (props.disabled) return;
    textareaRef?.focus();
    const current = text();
    if (!current.startsWith("/")) {
      setText("/");
      queueMicrotask(() => {
        if (textareaRef) {
          textareaRef.setSelectionRange(1, 1);
          adjustComposerTextareaHeight(textareaRef);
        }
      });
    }
    setSlashMode({
      query: "",
      commands: findSlashCommands(""),
      selectedIndex: 0,
    });
  };

  onMount(() => {
    const onGlobalKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey) return;
      const key = event.key;
      if (key === "/") {
        event.preventDefault();
        openSlashPalette();
        return;
      }
      if (key.toLowerCase() === "k") {
        event.preventDefault();
        textareaRef?.focus();
      }
    };
    window.addEventListener("keydown", onGlobalKey);
    onCleanup(() => window.removeEventListener("keydown", onGlobalKey));
  });

  return (
    <div class={`ra-composer relative shrink-0 ${props.hero ? "ra-composer--hero" : ""}`}>
      <div class="ra-composer-inner">
        <div class="ra-composer-shell relative">
          <div class="ra-composer-row">
            <div class="ra-composer-input-wrap">
              <Textarea
                ref={textareaRef}
                rows={1}
                placeholder={placeholder()}
                value={text()}
                onInput={onInput}
                onKeyDown={onKey}
                disabled={props.disabled}
                class="ra-composer-input resize-none w-full"
                data-ra-composer-textarea=""
                data-testid="composer-textarea"
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
            <button
              type="button"
              class="ra-composer-send"
              disabled={!canSend()}
              aria-label="Send"
              data-ra-composer-send=""
              data-testid="composer-send"
              onClick={() => void send()}
            >
              <SendArrowIcon />
            </button>
          </div>
          <Show when={props.disabledReason || props.running}>
            <div class="ra-composer-footer">
              <Show when={props.disabledReason}>
                {(reason) => (
                  <span
                    class="ra-composer-disabled-note"
                    role="status"
                    aria-live="polite"
                    data-ra-composer-disabled-note=""
                  >
                    {reason()}
                  </span>
                )}
              </Show>
              <Show when={props.running}>
                <button type="button" class="ra-composer-cancel-link" onClick={props.onCancel}>
                  Cancel
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
