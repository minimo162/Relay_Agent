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

  const emptyTitle = createMemo(() => {
    if (props.sessionPreset === "plan") return "Start with the part of the project you want understood";
    if (props.sessionPreset === "explore") return "Start with the question you want answered from the codebase";
    return "Start with the result you want";
  });

  const emptySubtitle = createMemo(() => {
    const p = props.workspacePath().trim();
    const location =
      p.length > 0
        ? `Relay will work in ${ellipsisPath(p, 72)}.`
        : "Choose the project folder from the header first so Relay knows which codebase to use.";
    if (props.sessionPreset === "plan") {
      return `${location} This conversation stays read-only and returns a plan, explanation, or review.`;
    }
    if (props.sessionPreset === "explore") {
      return `${location} This conversation can read and search only, so it is safe for quick codebase exploration.`;
    }
    return `${location} Relay can inspect the repo, decide whether a plan is needed, and edit files when the request calls for it.`;
  });

  const emptyNextSteps = createMemo(() => {
    if (props.sessionPreset === "plan") {
      return [
        "Relay will inspect the repo first and write its checklist in the Plan panel.",
        `If you want file changes later, start a new conversation in ${sessionModeLabel("build")}.`,
      ];
    }
    if (props.sessionPreset === "explore") {
      return [
        "Relay will read files and run searches only.",
        `For a plan or code changes, start a new conversation in ${sessionModeLabel("plan")} or ${sessionModeLabel("build")}.`,
      ];
    }
    return [
      "Relay will inspect the repo before deciding whether a plan or approval is needed.",
      "Approvals appear before risky changes, and progress continues inline in the conversation.",
    ];
  });

  const emptyExample = createMemo(() => {
    if (props.sessionPreset === "plan") {
      return "Review the onboarding flow and propose the smallest safe change that would make setup clearer for new developers.";
    }
    if (props.sessionPreset === "explore") {
      return "Find where the first-run setup is rendered and explain how the UI decides what to show.";
    }
    return "Fix the first-run setup flow so a new developer can understand what to do without opening the docs.";
  });

  return (
    <div ref={container!} class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
      <Show when={empty() && props.chunks.length === 0}>
        <EmptyState
          eyebrow={emptyEyebrow()}
          title={emptyTitle()}
          subtitle={emptySubtitle()}
          nextSteps={emptyNextSteps()}
          example={emptyExample()}
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
