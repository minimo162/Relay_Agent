import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createRenderEffect,
  on,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { friendlyToolActivityLabel, type SessionPreset, type UiChunk } from "../lib/ipc";
import { ellipsisPath, workspaceBasename } from "../lib/workspace-display";
import { sessionModeLabel } from "../lib/session-mode-label";
import { EmptyState } from "./primitives";
import { MessageBubble } from "./MessageBubble";
import { ToolCallRow } from "./ToolCallRow";
import type { SessionStatusSnapshot } from "./shell-types";

/** Pixels from bottom to treat as "following" the stream (sticky scroll). */
const NEAR_BOTTOM_PX = 80;

export function MessageFeed(props: {
  chunks: UiChunk[];
  sessionStatus: SessionStatusSnapshot;
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
  const [nowMs, setNowMs] = createSignal(Date.now());
  createRenderEffect(() => {
    if (props.sessionStatus.phase !== "retrying") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    onCleanup(() => window.clearInterval(id));
  });
  const statusLine = createMemo(() => {
    switch (props.sessionStatus.phase) {
      case "running": {
        const name = runningToolName();
        return name ? friendlyToolActivityLabel(name) : "Working…";
      }
      case "retrying": {
        const seconds = props.sessionStatus.nextRetryAtMs
          ? Math.max(1, Math.ceil((props.sessionStatus.nextRetryAtMs - nowMs()) / 1000))
          : null;
        const attempt = props.sessionStatus.attempt;
        const parts = ["Retrying soon…"];
        if (attempt != null) parts.push(`attempt ${attempt}`);
        if (seconds != null) parts.push(`in ${seconds}s`);
        return parts.join(" ");
      }
      case "compacting":
        return "Compacting context…";
      case "waiting_approval":
        return "Waiting for approval…";
      case "cancelling":
        return "Cancelling…";
      case "idle":
      default:
        return null;
    }
  });

  /** Fingerprint of visible feed content so streaming text deltas retrigger effects. */
  const feedScrollSignature = createMemo(() => {
    const parts: string[] = [String(props.chunks.length), props.sessionStatus.phase, statusLine() ?? ""];
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
        : "Click the project folder in the header to choose the folder Relay should use, then describe your task below.";
    if (props.sessionPreset === "plan") {
      return `${base} This conversation stays read-only; start a new conversation in ${sessionModeLabel("build")} if you want Relay to change files.`;
    }
    if (props.sessionPreset === "explore") {
      return `${base} This conversation can read and search only; start a new conversation in ${sessionModeLabel("plan")} or ${sessionModeLabel("build")} for broader tools.`;
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
          example="Example: Review the auth flow and suggest the smallest safe fix."
        />
      </Show>
      <For each={feedChunks()}>
        {(chunk) => {
          if (chunk.kind === "tool_call") {
            return (
              <ToolCallRow
                toolUseId={chunk.toolUseId}
                toolName={chunk.toolName}
                input={chunk.input}
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
