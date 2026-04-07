import { Show, type JSX } from "solid-js";
import { ToolStatusDot } from "./primitives";
import { ui } from "../lib/ui-tokens";

export function ToolCallRow(props: {
  toolUseId: string;
  toolName: string;
  status: "running" | "done" | "error";
  result: string | null;
}): JSX.Element {
  return (
    <div class={`my-2 text-xs ${ui.mutedText} flex items-start gap-2`} data-ra-tool-row data-ra-tool-use-id={props.toolUseId}>
      <ToolStatusDot status={props.status} />
      <div class="flex-1 min-w-0">
        <span class="font-medium text-[var(--ra-text-primary)]">{props.toolName}</span>
        {props.status === "running" && <span class="ml-2 animate-pulse">running…</span>}
        <Show when={props.result}>
          <pre class="mt-1 text-[11px] opacity-70 overflow-x-auto whitespace-pre-wrap font-mono">
            {props.result!.slice(0, 300)}
            {props.result!.length > 300 ? "…" : ""}
          </pre>
        </Show>
      </div>
    </div>
  );
}
