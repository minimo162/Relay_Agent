import { type JSX } from "solid-js";
import { ui } from "../lib/ui-tokens";
import { Button, StatusDot } from "./ui";
export function ShellHeader(props: {
  sessionRunning: boolean;
  showToolActivityInline: boolean;
  onToolActivityChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <header class="ra-shell-header">
      <span class={`font-semibold text-sm tracking-tight ${ui.textPrimary}`}>Relay Agent</span>
      <div class="flex-1" />
      <StatusDot status={props.sessionRunning ? "connecting" : "connected"} label="Copilot" />
      <label class="ra-header-switch">
        <span class="sr-only">Show tool names and raw results in the main chat</span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={props.showToolActivityInline}
          checked={props.showToolActivityInline}
          onChange={(e) => props.onToolActivityChange(e.currentTarget.checked)}
          data-ra-toggle-tool-activity
        />
        <span>Tool activity in chat</span>
      </label>
      <Button variant="ghost" type="button" disabled class="!px-3 !py-1 !text-xs opacity-60" title="Coming soon">
        Settings
      </Button>
    </header>
  );
}
