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
import { friendlyToolActivityLabel, type UiChunk } from "../lib/ipc";
import { ellipsisPath, workspaceBasename } from "../lib/workspace-display";
import type { CopilotWarmupState } from "../shell/useCopilotWarmup";
import { EmptyState } from "./primitives";
import { FirstRunPanel } from "./FirstRunPanel";
import { InlineApprovalCard } from "./InlineApprovalCard";
import { InlineQuestionCard } from "./InlineQuestionCard";
import { MessageBubble } from "./MessageBubble";
import { ToolCallRow } from "./ToolCallRow";
import type { ApprovalActionHandler, SessionStatusSnapshot } from "./shell-types";

/** Pixels from bottom to treat as "following" the stream (sticky scroll). */
const NEAR_BOTTOM_PX = 80;

export function MessageFeed(props: {
  chunks: UiChunk[];
  sessionStatus: SessionStatusSnapshot;
  /** Saved workspace cwd (empty = unset). */
  workspacePath: () => string;
  firstRun: boolean;
  copilotState: CopilotWarmupState;
  showFirstRunRequirements: boolean;
  missingProject: boolean;
  missingCopilot: boolean;
  onChooseProject: () => void;
  onReconnectCopilot: () => void;
  onApproveOnce: ApprovalActionHandler;
  onApproveForSession: ApprovalActionHandler;
  onApproveForWorkspace: ApprovalActionHandler;
  onReject: ApprovalActionHandler;
  onSubmitUserQuestion: (sessionId: string, questionId: string, answer: string) => void;
  onCancelUserQuestion: (sessionId: string, questionId: string) => void;
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
        return seconds != null ? `Retrying in ${seconds}s…` : "Retrying…";
      }
      case "compacting":
        return "Condensing context…";
      case "waiting_approval":
        return visiblePendingApproval() ? null : "Waiting for approval…";
      case "cancelling":
        return "Stopping…";
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
    return "Start with the result you need.";
  });

  const emptySubtitle = createMemo(() => {
    const p = props.workspacePath().trim();
    const location =
      p.length > 0
        ? `Working in ${ellipsisPath(p, 72)}.`
        : "Choose a project from the header first.";
    return `${location} Relay inspects first and edits only when the request calls for it.`;
  });

  const emptyExample = createMemo(() => "Make this screen easier to scan.");

  return (
    <div ref={container!} class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
      <Show when={empty() && props.chunks.length === 0}>
        <Show
          when={props.firstRun}
          fallback={
            <EmptyState
              eyebrow={emptyEyebrow()}
              title={emptyTitle()}
              subtitle={emptySubtitle()}
              example={emptyExample()}
            />
          }
        >
          <FirstRunPanel
            workspacePath={props.workspacePath}
            onChooseProject={props.onChooseProject}
            onReconnectCopilot={props.onReconnectCopilot}
            copilotState={props.copilotState}
            showRequirements={props.showFirstRunRequirements}
            missingProject={props.missingProject}
            missingCopilot={props.missingCopilot}
          />
        </Show>
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
          class={`flex items-center gap-2 ra-type-caption mt-2 text-[var(--ra-text-secondary)]`}
          data-ra-agent-thinking
        >
          <span class="inline-block w-2 h-2 rounded-full bg-[var(--ra-accent)] animate-pulse" />
          {statusLine()}
        </div>
      </Show>
    </div>
  );
}
