import { Show, type JSX } from "solid-js";
import { toolTimelineKind } from "../lib/tool-timeline";
import { ToolStatusDot } from "./primitives";
import { ui } from "../lib/ui-tokens";

export function ToolCallRow(props: {
  toolUseId: string;
  toolName: string;
  status: "running" | "done" | "error";
  result: string | null;
}): JSX.Element {
  const tl = () => toolTimelineKind(props.toolName);
  return (
    <div
      class={`my-2 ra-type-button-label ${ui.mutedText} flex items-start gap-2 ra-tool-row ra-tool-row--${tl()}`}
      data-ra-tool-row
      data-ra-tool-use-id={props.toolUseId}
    >
      <ToolStatusDot status={props.status} />
      <div class="flex-1 min-w-0">
        <span class="ra-type-mono-small text-[var(--ra-text-primary)]">{props.toolName}</span>
        {props.status === "running" && <span class="ml-2 animate-pulse">running…</span>}
        <Show when={props.result}>
          <pre class="ra-type-mono-body mt-1 opacity-70 overflow-x-auto whitespace-pre-wrap">
            {props.result!.slice(0, 300)}
            {props.result!.length > 300 ? "…" : ""}
          </pre>
        </Show>
      </div>
    </div>
  );
}
