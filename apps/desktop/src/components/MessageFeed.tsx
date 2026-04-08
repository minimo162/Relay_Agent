import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { friendlyToolActivityLabel, type UiChunk } from "../lib/ipc";
import { ellipsisPath, workspaceBasename } from "../lib/workspace-display";
import { EmptyState } from "./primitives";
import { MessageBubble } from "./MessageBubble";
import { ToolCallRow } from "./ToolCallRow";
import type { SessionState } from "./shell-types";
import { ui } from "../lib/ui-tokens";

/** Pixels from bottom to treat as "following" the stream (sticky scroll). */
const NEAR_BOTTOM_PX = 80;

export function MessageFeed(props: {
  chunks: UiChunk[];
  sessionState: SessionState;
  showToolActivityInline: boolean;
  /** Saved workspace cwd (empty = unset). */
  workspacePath: () => string;
}): JSX.Element {
  let container!: HTMLDivElement;
  const [stickToBottom, setStickToBottom] = createSignal(true);

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
    return name ? friendlyToolActivityLabel(name) : "Working…";
  });

  /** Fingerprint of visible feed content so streaming text deltas retrigger effects. */
  const feedScrollSignature = createMemo(() => {
    const parts: string[] = [String(props.chunks.length), props.sessionState, statusLine() ?? ""];
    for (const c of props.chunks) {
      if (c.kind === "user" || c.kind === "assistant") {
        parts.push(`${c.kind}:${c.text.length}`);
      } else {
        parts.push(`tool:${c.toolUseId}:${c.status}:${String(c.result ?? "").length}`);
      }
    }
    return parts.join("\u001f");
  });

  function distanceFromBottom(el: HTMLElement) {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  function scrollToBottomIfStuck() {
    if (!stickToBottom()) return;
    const el = container;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  onMount(() => {
    const el = container;
    const onScroll = () => {
      setStickToBottom(distanceFromBottom(el) <= NEAR_BOTTOM_PX);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => el.removeEventListener("scroll", onScroll));
  });

  createEffect(
    on(feedScrollSignature, () => {
      scrollToBottomIfStuck();
    }),
  );

  const empty = createMemo(() => feedChunks().length === 0);

  const emptyEyebrow = createMemo(() => {
    const p = props.workspacePath().trim();
    return p ? workspaceBasename(p) : "Workspace";
  });

  const emptySubtitle = createMemo(() => {
    const p = props.workspacePath().trim();
    if (p) {
      return `${ellipsisPath(p, 72)} — describe your task in the box below.`;
    }
    return "Open Settings to set a workspace folder (cwd) so file tools use the right project root. Then describe your task below.";
  });

  return (
    <div ref={container!} class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
      <Show when={empty() && props.chunks.length === 0}>
        <EmptyState
          eyebrow={emptyEyebrow()}
          title="Ready when you are"
          subtitle={emptySubtitle()}
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
            title="Tool names and output; expand to inspect"
          >
            Tool runs ({toolChunks().length})
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
