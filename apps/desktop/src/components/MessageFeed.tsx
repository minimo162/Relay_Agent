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
import { EmptyState } from "./primitives";
import { InlineApprovalCard } from "./InlineApprovalCard";
import { InlineQuestionCard } from "./InlineQuestionCard";
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
  onApproveOnce: (approvalId: string) => void;
  onApproveForSession: (approvalId: string) => void;
  onApproveForWorkspace: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  onSubmitUserQuestion: (questionId: string, answer: string) => void;
  onCancelUserQuestion: (questionId: string) => void;
}): JSX.Element {
  let container!: HTMLDivElement;
  const [stickToBottom, setStickToBottom] = createSignal(true);
  const [visiblePendingApproval, setVisiblePendingApproval] = createSignal(false);

  const feedChunks = createMemo(() => props.chunks);
  const runningToolName = createMemo(() => {
    for (let i = props.chunks.length - 1; i >= 0; i--) {
      const c = props.chunks[i]!;
      if (c.kind === "tool_call" && c.status === "running") return c.toolName;
    }
    return null as string | null;
  });
  const hasStreamingAssistant = createMemo(() =>
    props.chunks.some((chunk) => chunk.kind === "assistant" && Boolean(chunk.streaming)),
  );
  const [nowMs, setNowMs] = createSignal(Date.now());
  createRenderEffect(() => {
    if (props.sessionStatus.phase !== "retrying") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    onCleanup(() => window.clearInterval(id));
  });
  const statusLine = createMemo(() => {
    switch (props.sessionStatus.phase) {
      case "running": {
        if (hasStreamingAssistant()) return null;
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
        return visiblePendingApproval() ? null : "Needs your approval…";
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
      } else if (c.kind === "tool_call") {
        parts.push(`tool:${c.toolUseId}:${c.status}:${String(c.result ?? "").length}`);
      } else if (c.kind === "approval_request") {
        parts.push(`approval:${c.approvalId}:${c.status}`);
      } else {
        parts.push(`question:${c.questionId}:${c.status}`);
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

  function updateVisiblePendingApproval() {
    const el = container;
    if (!el) return;
    const bounds = el.getBoundingClientRect();
    const cards = Array.from(
      el.querySelectorAll<HTMLElement>("[data-ra-approval-card][data-status='pending']"),
    );
    setVisiblePendingApproval(
      cards.some((card) => {
        const rect = card.getBoundingClientRect();
        return rect.bottom >= bounds.top + 8 && rect.top <= bounds.bottom - 8;
      }),
    );
  }

  onMount(() => {
    const el = container;
    const onScroll = () => {
      setStickToBottom(distanceFromBottom(el) <= NEAR_BOTTOM_PX);
      updateVisiblePendingApproval();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    updateVisiblePendingApproval();
    onCleanup(() => el.removeEventListener("scroll", onScroll));
  });

  createEffect(
    on(feedScrollSignature, () => {
      scrollToBottomIfStuck();
      requestAnimationFrame(() => updateVisiblePendingApproval());
    }),
  );

  const empty = createMemo(() => feedChunks().length === 0);

  const emptyEyebrow = createMemo(() => {
    const p = props.workspacePath().trim();
    return p ? workspaceBasename(p) : "Project";
  });

  const emptyTitle = createMemo(() => {
    if (props.sessionPreset === "plan") return "Start with what you want reviewed";
    if (props.sessionPreset === "explore") return "Start with what you want checked";
    return "Start with the result you want";
  });

  const emptySubtitle = createMemo(() => {
    const p = props.workspacePath().trim();
    const location =
      p.length > 0
        ? `Relay will work in ${ellipsisPath(p, 72)}.`
        : "Choose the project from the header so Relay knows where to work.";
    if (props.sessionPreset === "plan") {
      return `${location} This chat stays read-only and returns a plan, explanation, or review.`;
    }
    if (props.sessionPreset === "explore") {
      return `${location} This chat can only read and search.`;
    }
    return `${location} Relay can inspect the project and edit files when the request calls for it.`;
  });

  const emptyExample = createMemo(() => {
    if (props.sessionPreset === "plan") {
      return "Review this setup flow and propose the smallest safe change that would make it easier to understand.";
    }
    if (props.sessionPreset === "explore") {
      return "Find where the first screen is rendered and explain how the app decides what to show.";
    }
    return "Make the first screen easier to understand for someone using the app for the first time.";
  });

  return (
    <div ref={container!} class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
      <Show when={empty() && props.chunks.length === 0}>
        <EmptyState
          eyebrow={emptyEyebrow()}
          title={emptyTitle()}
          subtitle={emptySubtitle()}
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
          if (chunk.kind === "approval_request") {
            return (
              <InlineApprovalCard
                chunk={chunk}
                onApproveOnce={props.onApproveOnce}
                onApproveForSession={props.onApproveForSession}
                onApproveForWorkspace={props.onApproveForWorkspace}
                onReject={props.onReject}
              />
            );
          }
          if (chunk.kind === "user_question") {
            return (
              <InlineQuestionCard
                chunk={chunk}
                onSubmit={props.onSubmitUserQuestion}
                onCancel={props.onCancelUserQuestion}
              />
            );
          }
          return (
            <MessageBubble
              role={chunk.kind}
              text={chunk.text}
              streaming={chunk.kind === "assistant" ? Boolean(chunk.streaming) : false}
            />
          );
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
