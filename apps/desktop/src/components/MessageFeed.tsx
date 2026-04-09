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
import { friendlyToolActivityLabel, type SessionPreset, type UiChunk } from "../lib/ipc";
import { ellipsisPath, workspaceBasename } from "../lib/workspace-display";
import { EmptyState } from "./primitives";
import { MessageBubble } from "./MessageBubble";
import { ToolCallRow } from "./ToolCallRow";
import type { SessionState } from "./shell-types";

/** Pixels from bottom to treat as "following" the stream (sticky scroll). */
const NEAR_BOTTOM_PX = 80;

export function MessageFeed(props: {
  chunks: UiChunk[];
  sessionState: SessionState;
  /** Saved workspace cwd (empty = unset). */
  workspacePath: () => string;
  /** Composer session mode (empty-state copy for Plan / Explore). */
  sessionPreset: SessionPreset;
}): JSX.Element {
  let container!: HTMLDivElement;
  const [stickToBottom, setStickToBottom] = createSignal(true);

  const feedChunks = createMemo(() => props.chunks);
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
    const base =
      p.length > 0
        ? `${ellipsisPath(p, 72)} — describe your task in the box below.`
        : "Click the workspace name in the header to set a project folder so file tools use the right root. Then describe your task below.";
    if (props.sessionPreset === "plan") {
      return `${base} Plan mode stays read-only; use Build when you want the agent to apply file changes.`;
    }
    if (props.sessionPreset === "explore") {
      return `${base} Explore mode only runs read_file, glob_search, and grep_search—switch to Plan or Build for more tools.`;
    }
    return base;
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

      <Show when={statusLine()}>
        <div
          class={`flex items-center gap-2 ra-type-button-label mt-2 text-[var(--ra-timeline-thinking)]`}
          data-ra-agent-thinking
        >
          <span class="inline-block w-2 h-2 rounded-full bg-[var(--ra-timeline-thinking)] animate-pulse" />
          {statusLine()}
        </div>
      </Show>
    </div>
  );
}
