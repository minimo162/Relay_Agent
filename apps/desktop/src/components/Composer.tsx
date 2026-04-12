import { Show, createEffect, createSignal, onMount, type JSX } from "solid-js";
import { Textarea } from "./ui";
import { detectSlashMode, findSlashCommands, type SlashCommand } from "../lib/slash-commands";
import type { SessionPreset } from "../lib/ipc";
import { ui } from "../lib/ui-tokens";
import { sessionModeLabel, sessionModeSummary } from "../lib/session-mode-label";

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
      class={`absolute left-0 bottom-full mb-1 min-w-full w-64 ${ui.radiusFeatured} py-1 overflow-hidden z-50 border border-[var(--ra-border)] bg-[var(--ra-surface-elevated)] shadow-[var(--ra-shadow-sm)]`}
      role="listbox"
      aria-label="Slash commands"
    >
      {props.commands.length === 0 ? (
        <div class={`px-3 py-1.5 ra-type-button-label text-[var(--ra-text-muted)]`}>
          No matching commands
        </div>
      ) : (
        props.commands.map((cmd, i) => (
          <div
            role="option"
            aria-selected={i === props.selectedIndex}
            class={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ra-type-button-label transition-colors ${
              i === props.selectedIndex
                ? "ra-surface-highlight"
                : "text-[var(--ra-text-secondary)] hover:bg-[var(--ra-hover)]"
            }`}
            onClick={() => props.onSelect(cmd)}
            onMouseEnter={() => props.onSelectIndex(i)}
          >
            <span class="ra-type-mono-small">{cmd.command}</span>
            <span class="opacity-70 ml-auto truncate max-w-[120px]">{cmd.description}</span>
          </div>
        ))
      )}
      <div class={`px-3 py-1 ra-type-caption text-[var(--ra-text-muted)] border-t border-[var(--ra-border)]`}>
        <kbd class="ra-type-mono-small">Tab</kbd> or <kbd class="ra-type-mono-small">Enter</kbd> to select
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
  hero?: boolean;
  allowModeSelection?: boolean;
  modeLockedNote?: string | null;
  autoFocus?: boolean;
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

  const canSend = () => text().trim().length > 0 && !props.running;
  const placeholder = () =>
    props.hero
      ? "Describe the task you want Relay to handle."
      : "What should the agent do? Type / for commands.";
  const allowModeSelection = () => props.allowModeSelection ?? true;

  return (
    <div class={`ra-composer relative shrink-0 ${props.hero ? "ra-composer--hero" : ""}`}>
      <div class="ra-composer-inner">
        <div class="ra-composer-shell relative">
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
          <div class="ra-composer-toolbar">
            <div class="ra-composer-toolbar-main">
              <p class="ra-composer-hint">⌘/Ctrl+Enter to send · Enter for new line</p>
              <p class="ra-composer-mode-summary">
                {props.modeLockedNote ?? sessionModeSummary(props.sessionPreset)}
              </p>
            </div>
            <div class="ra-composer-toolbar-actions">
              <Show when={allowModeSelection()}>
                <div
                  class={`ra-composer-mode-control ${ui.radiusCompact}`}
                  data-ra-session-mode
                  role="group"
                  aria-label="Work mode"
                >
                  <button
                    type="button"
                    class={`ra-composer-mode-option ${props.sessionPreset === "build" ? "is-selected" : ""}`}
                    aria-pressed={props.sessionPreset === "build"}
                    onClick={() => props.onSessionPresetChange("build")}
                  >
                    {sessionModeLabel("build")}
                  </button>
                  <button
                    type="button"
                    class={`ra-composer-mode-option ${props.sessionPreset === "plan" ? "is-selected" : ""}`}
                    aria-pressed={props.sessionPreset === "plan"}
                    onClick={() => props.onSessionPresetChange("plan")}
                  >
                    {sessionModeLabel("plan")}
                  </button>
                  <button
                    type="button"
                    class={`ra-composer-mode-option ${props.sessionPreset === "explore" ? "is-selected" : ""}`}
                    aria-pressed={props.sessionPreset === "explore"}
                    onClick={() => props.onSessionPresetChange("explore")}
                  >
                    {sessionModeLabel("explore")}
                  </button>
                </div>
              </Show>
              <Show when={props.running}>
                <button type="button" class="ra-composer-cancel" onClick={props.onCancel}>
                  Cancel
                </button>
              </Show>
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
                <span>Send</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
