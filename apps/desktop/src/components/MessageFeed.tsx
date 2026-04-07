import { For, Show, createEffect, createMemo, on, type JSX } from "solid-js";
import { friendlyToolActivityLabel, type UiChunk } from "../lib/ipc";
import { EmptyState } from "./primitives";
import { MessageBubble } from "./MessageBubble";
import { ToolCallRow } from "./ToolCallRow";
import type { SessionState } from "./shell-types";
import { ui } from "../lib/ui-tokens";

export function MessageFeed(props: {
  chunks: UiChunk[];
  sessionState: SessionState;
  showToolActivityInline: boolean;
}): JSX.Element {
  let container!: HTMLDivElement;

  const chatChunks = createMemo(() =>
    props.chunks.filter((c) => c.kind === "user" || c.kind === "assistant"),
  );
  const toolChunks = createMemo(() =>
    props.chunks.filter((c): c is Extract<UiChunk, { kind: "tool_call" }> => c.kind === "tool_call"),
  );
  const feedChunks = createMemo(() =>
    props.showToolActivityInline ? props.chunks : chatChunks(),
  );
  const runningToolName = createMemo(() => {
    for (let i = props.chunks.length - 1; i >= 0; i--) {
      const c = props.chunks[i]!;
      if (c.kind === "tool_call" && c.status === "running") return c.toolName;
    }
    return null as string | null;
  });
  const statusLine = createMemo(() => {
    if (props.sessionState !== "running") return null;
    const name = runningToolName();
    return name ? friendlyToolActivityLabel(name) : "Working on your request…";
  });

  createEffect(
    on(
      () => props.chunks.length,
      () => {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      },
    ),
  );

  const empty = createMemo(() => feedChunks().length === 0);

  return (
    <div ref={container!} class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
      <Show when={empty() && props.chunks.length === 0}>
        <EmptyState
          eyebrow="Workspace"
          title="Relay Agent is ready"
          subtitle="Describe your task in the composer below to get started."
        />
      </Show>
      <For each={feedChunks()}>
        {(chunk) => {
          if (chunk.kind === "tool_call") {
            return (
              <ToolCallRow
                toolUseId={chunk.toolUseId}
                toolName={chunk.toolName}
                status={chunk.status}
                result={chunk.result}
              />
            );
          }
          return <MessageBubble role={chunk.kind} text={chunk.text} />;
        }}
      </For>

      <Show when={!props.showToolActivityInline && toolChunks().length > 0}>
        <details
          class={`mt-3 rounded-xl border ${ui.border} ${ui.surfaceElevated} px-3 py-2`}
          data-ra-activity-details
        >
          <summary
            class={`text-xs ${ui.mutedText} cursor-pointer select-none`}
            data-ra-activity-summary
          >
            Technical activity ({toolChunks().length})
          </summary>
          <div class="mt-2 border-t border-[var(--ra-border)] pt-2">
            <For each={toolChunks()}>
              {(chunk) => (
                <ToolCallRow
                  toolUseId={chunk.toolUseId}
                  toolName={chunk.toolName}
                  status={chunk.status}
                  result={chunk.result}
                />
              )}
            </For>
          </div>
        </details>
      </Show>

      <Show when={statusLine()}>
        <div class={`flex items-center gap-2 text-xs ${ui.mutedText} mt-2`} data-ra-agent-thinking>
          <span class="inline-block w-2 h-2 rounded-full bg-[var(--ra-yellow)] animate-pulse" />
          {statusLine()}
        </div>
      </Show>
    </div>
  );
}
