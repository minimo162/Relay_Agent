import { Show, createSignal, type JSX } from "solid-js";
import { Button, Textarea } from "./ui";
import {
  detectSlashMode,
  findSlashCommands,
  type SlashCommand,
} from "../lib/slash-commands";

function SlashAutocomplete(props: {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onSelectIndex: (index: number) => void;
}) {
  return (
    <div
      class="absolute left-0 bottom-full mb-1 min-w-full w-64 rounded-xl py-1 overflow-hidden z-50 border border-[var(--ra-border)] bg-[var(--ra-surface-elevated)] shadow-[var(--ra-shadow-md)]"
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
      if (response && props.onAppendAssistant) {
        props.onAppendAssistant(response);
      }
      props.onSend(value);
      return;
    }

    props.onSend(value);
    setText("");
  };

  const onInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const newVal = e.currentTarget.value;
    setText(newVal);

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

  return (
    <div class="ra-composer relative shrink-0">
      <div class="relative">
        <Textarea
          ref={textareaRef}
          rows={1}
          placeholder="What would you like to do? (type / for commands)"
          value={text()}
          onInput={onInput}
          onKeyDown={onKey}
          disabled={props.disabled}
          class="resize-none w-full !min-h-[44px] !py-2.5"
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
      <div class="flex justify-end mt-2 gap-2">
        <Show when={props.running}>
          <Button variant="secondary" onClick={props.onCancel} class="px-4 py-1.5 text-xs">
            Cancel
          </Button>
        </Show>
        <Show when={text().trim().length > 0 && !props.running}>
          <Button variant="primary" disabled={props.disabled} onClick={() => void send()} class="px-4 py-1.5 text-xs">
            Send
          </Button>
        </Show>
      </div>
    </div>
  );
}
