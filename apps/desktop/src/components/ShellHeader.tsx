import { type JSX } from "solid-js";
import { ui } from "../lib/ui-tokens";
import { Button, StatusDot } from "./ui";

export function ShellHeader(props: {
  sessionRunning: boolean;
  showToolActivityInline: boolean;
  onToolActivityChange: (value: boolean) => void;
}): JSX.Element {
  const onToolKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      props.onToolActivityChange(false);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      props.onToolActivityChange(true);
    }
  };

  return (
    <header class="ra-shell-header">
      <span class={`font-semibold text-sm tracking-tight ${ui.textPrimary}`}>Relay Agent</span>
      <div class="flex-1" />
      <div
        class="flex items-center gap-2 shrink-0"
        title={props.sessionRunning ? "Agent is running." : "Agent is idle."}
      >
        <StatusDot
          status={props.sessionRunning ? "connecting" : "connected"}
          label={props.sessionRunning ? "Agent running" : "Agent idle"}
        />
        <span class={`text-xs ${ui.mutedText} hidden sm:inline`}>Agent</span>
      </div>
      <div
        role="radiogroup"
        aria-label="Tool activity in chat"
        class="ra-tab-track ra-tab-track--header"
        data-ra-toggle-tool-activity
        onKeyDown={onToolKeyDown}
      >
        <button
          type="button"
          role="radio"
          aria-checked={!props.showToolActivityInline}
          classList={{
            "ra-tab-track__btn": true,
            "ra-tab-track__btn--active": !props.showToolActivityInline,
          }}
          onClick={() => props.onToolActivityChange(false)}
        >
          Chat only
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={props.showToolActivityInline}
          classList={{
            "ra-tab-track__btn": true,
            "ra-tab-track__btn--active": props.showToolActivityInline,
          }}
          onClick={() => props.onToolActivityChange(true)}
        >
          With tools
        </button>
      </div>
      <Button variant="ghost" type="button" disabled class="!px-3 !py-1 !text-xs opacity-60" title="Coming soon">
        Settings
      </Button>
    </header>
  );
}
