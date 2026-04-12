import { Show, type JSX } from "solid-js";
import { shouldCollapseToolResult, toolAuditPresentation, toolTimelineKind } from "../lib/tool-timeline";
import { ToolStatusDot } from "./primitives";
import { ui } from "../lib/ui-tokens";

export function ToolCallRow(props: {
  toolUseId: string;
  toolName: string;
  input?: Record<string, unknown>;
  status: "running" | "done" | "error";
  result: string | null;
}): JSX.Element {
  const tl = () => toolTimelineKind(props.toolName);
  const presentation = () => toolAuditPresentation(props.toolName, props.status, props.result, props.input);
  const showDetails = () => shouldCollapseToolResult(presentation().detailBody ?? null);
  return (
    <div
      class={`my-2 ra-type-button-label ${ui.mutedText} flex items-start gap-2 ra-tool-row ra-tool-row--${tl()}`}
      data-ra-tool-row
      data-ra-tool-use-id={props.toolUseId}
    >
      <ToolStatusDot status={props.status} />
      <div class="flex-1 min-w-0">
        <div class="flex flex-col gap-0.5 min-w-0">
          <div class="flex items-center gap-2 min-w-0">
            <span class="ra-type-button-label text-[var(--ra-text-primary)] shrink-0">
              {presentation().label}
            </span>
            <span class="ra-type-caption text-[var(--ra-text-muted)] truncate">{presentation().summary}</span>
          </div>
          <Show when={presentation().target}>
            {(target) => (
              <span class="ra-type-mono-small text-[var(--ra-text-muted)] truncate">{target()}</span>
            )}
          </Show>
        </div>
        <Show when={showDetails()}>
          <details class="mt-1">
            <summary class={`cursor-pointer ra-type-caption ${ui.mutedText}`}>
              {presentation().detailTitle ?? "Show details"}
            </summary>
            <pre class="ra-type-mono-body mt-1 opacity-70 overflow-x-auto whitespace-pre-wrap">
              {presentation().detailBody}
            </pre>
          </details>
        </Show>
      </div>
    </div>
  );
}
