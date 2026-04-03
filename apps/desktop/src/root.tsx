/// <reference types="vite/client" />
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";

import {
  cancelAgent,
  chunksFromHistory,
  getSessionHistory,
  onAgentEvent,
  respondApproval,
  startAgent,
  type AgentApprovalNeededEvent,
  type AgentErrorEvent,
  type AgentTextDeltaEvent,
  type AgentTurnCompleteEvent,
  type AgentToolResultEvent,
  type AgentToolStartEvent,
  type UiChunk,
} from "./lib/ipc";
import { Button, Input, StatusDot } from "./components/ui";

/* Shared class tokens */
const C = {
  border: "border-[var(--ra-border)]",
  textPrimary: "text-[var(--ra-text-primary)]",
  textSecondary: "text-[var(--ra-text-secondary)]",
  textMuted: "text-[var(--ra-text-muted)]",
  accent: "text-[var(--ra-accent)]",
  surface: "bg-[var(--ra-surface)]",
  surfaceElevated: "bg-[var(--ra-surface-elevated)]",
  hover: "hover:bg-[var(--ra-hover)]",
  mutedText: "text-[var(--ra-text-muted)]",
};

/* ============================================================
   Session / Agent state
   ============================================================ */

type SessionState = "idle" | "running" | "error";

interface Approval {
  sessionId: string;
  approvalId: string;
  toolName: string;
  description: string;
  target?: string;
}

/* ============================================================
   Components
   ============================================================ */

/** Message bubble — user or assistant text */
function MessageBubble(props: { role: "user" | "assistant"; text: string }) {
  const isUser = props.role === "user";
  return (
    <div class={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        class={`max-w-[80%] rounded-xl px-4 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
          isUser
            ? "bg-[var(--ra-accent)] text-white"
            : `${C.surfaceElevated} ${C.border} border`
        }`}
      >
        {props.text}
      </div>
    </div>
  );
}

/** Tool call / result row */
function ToolCallRow(props: {
  toolUseId: string;
  toolName: string;
  status: "running" | "done" | "error";
  result: string | null;
}) {
  const icon =
    props.status === "running" ? "⟳"
    : props.status === "done" ? "✓"
    : "✗";
  const color =
    props.status === "running" ? "text-[var(--ra-yellow)]"
    : props.status === "done" ? "text-[var(--ra-green)]"
    : "text-[var(--ra-red)]";

  return (
    <div class={`my-2 text-xs ${C.mutedText} flex items-start gap-2`}>
      <span class={`${color} font-mono text-sm`}>{icon}</span>
      <div class="flex-1 min-w-0">
        <span class="font-medium">{props.toolName}</span>
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

/** Message feed */
function MessageFeed(props: { chunks: UiChunk[]; sessionState: SessionState }) {
  let container!: HTMLDivElement;

  createEffect(
    on(
      () => props.chunks.length,
      () => {
        // Auto-scroll to bottom on new messages
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      },
    ),
  );

  return (
    <div
      ref={container!}
      class="flex-1 overflow-y-auto px-6 py-4"
    >
      <Show when={props.chunks.length === 0}>
        <div class="flex h-full items-center justify-center text-center">
          <div>
            <div class="text-3xl mb-3">🧸</div>
            <p class={`text-sm ${C.textSecondary}`}>Relay Agent is ready</p>
            <p class={`text-xs ${C.mutedText} mt-1`}>
              Describe your task to get started
            </p>
          </div>
        </div>
      </Show>
      <For each={props.chunks}>
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

      {/* Running indicator */}
      <Show when={props.sessionState === "running"}>
        <div class={`flex items-center gap-2 text-xs ${C.mutedText} mt-2`}>
          <span class="inline-block w-2 h-2 rounded-full bg-[var(--ra-yellow)] animate-pulse" />
          Agent is thinking…
        </div>
      </Show>
    </div>
  );
}

/** Approval request card — pops up when the agent needs permission */
function ApprovalOverlay(props: {
  approvals: Approval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div class="absolute inset-x-0 bottom-0 z-10 p-4">
      <For each={props.approvals}>
        {(approval) => (
          <div class={`${C.surfaceElevated} ${C.border} border rounded-xl p-4 shadow-lg mb-2`}>
            <div class="flex items-start gap-3">
              <span class="text-amber-400 text-lg mt-0.5">⚠️</span>
              <div class="flex-1 min-w-0">
                <p class={`text-sm font-medium ${C.textPrimary}`}>
                  Tool: {approval.toolName}
                </p>
                <p class={`text-xs ${C.mutedText} mt-1`}>{approval.description}</p>
                <Show when={approval.target}>
                  <p class={`text-xs ${C.mutedText} mt-0.5 font-mono`}>{approval.target}</p>
                </Show>
              </div>
            </div>
            <div class="flex gap-2 mt-3 justify-end">
              <Button
                variant="secondary"
                onClick={() => props.onReject(approval.approvalId)}
                class="px-4 py-1.5 text-xs"
              >
                Reject
              </Button>
              <Button
                variant="primary"
                onClick={() => props.onApprove(approval.approvalId)}
                class="px-4 py-1.5 text-xs"
              >
                Approve
              </Button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

/** Sidebar sessions */
function Sidebar(props: {
  sessionIds: string[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside class={`${C.surfaceElevated} ${C.border} border-r overflow-y-auto h-full`}>
      <div class={`p-3 border-b ${C.border}`}>
        <h2 class={`text-sm font-semibold ${C.textPrimary} mb-2`}>Sessions</h2>
        <Input type="text" placeholder="Search sessions…" class="text-xs" />
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <Show when={props.sessionIds.length === 0}>
          <div class={`text-xs ${C.mutedText} text-center py-8`}>No sessions yet</div>
        </Show>
        <For each={props.sessionIds}>
          {(id) => (
            <button
              class={`w-full text-left text-xs px-3 py-2 rounded-lg mb-1 transition-colors truncate ${
                props.activeSessionId === id
                  ? "bg-[var(--ra-accent)] text-white"
                  : `${C.hover} ${C.textSecondary}`
              }`}
              onClick={() => props.onSelect(id)}
            >
              {id.slice(0, 8)}…
            </button>
          )}
        </For>
      </div>
    </aside>
  );
}

/** Context panel — files / servers / policy */
function ContextPanel() {
  type TabId = "files" | "servers" | "policy";
  const [activeTab, setActiveTab] = createSignal<TabId>("files");

  const tabs: { id: TabId; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "servers", label: "Servers" },
    { id: "policy", label: "Policy" },
  ];

  return (
    <aside
      class={`${C.surfaceElevated} ${C.border} border-l overflow-y-auto h-full flex flex-col`}
    >
      <div class={`flex border-b ${C.border}`}>
        <For each={tabs}>
          {(tab) => (
            <button
              class={`flex-1 text-xs py-2 text-center transition-colors ${
                activeTab() === tab.id
                  ? "text-[var(--ra-accent)] border-b-2 border-[var(--ra-accent)] font-medium"
                  : `${C.mutedText} hover:text-[var(--ra-text-primary)]`
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>
      <div class="flex-1 overflow-y-auto p-3">
        <Switch>
          <Match when={activeTab() === "files"}>
            <div class={`text-xs ${C.mutedText} text-center py-8`}>
              Drop files or open picker
            </div>
          </Match>
          <Match when={activeTab() === "servers"}>
            <div class={`text-xs ${C.mutedText} text-center py-8`}>
              No MCP servers connected
            </div>
          </Match>
          <Match when={activeTab() === "policy"}>
            <div class={`text-xs ${C.mutedText} text-center py-8`}>
              No active policies
            </div>
          </Match>
        </Switch>
      </div>
    </aside>
  );
}

/** Composer — input at bottom of main */
function Composer(props: {
  onSend: (text: string) => void;
  disabled: boolean;
  running: boolean;
  onCancel: () => void;
}) {
  const [text, setText] = createSignal("");

  const send = () => {
    const value = text().trim();
    if (!value || props.disabled) return;
    props.onSend(value);
    setText("");
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div class={`${C.surfaceElevated} ${C.border} border-t px-4 py-3`}>
      <textarea
        rows={1}
        placeholder="What would you like to do?"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={onKey}
        disabled={props.disabled}
        class="resize-none"
      />
      <div class="flex justify-end mt-2 gap-2">
        <Show when={props.running}>
          <Button
            variant="secondary"
            onClick={props.onCancel}
            class="px-4 py-1.5 text-xs"
          >
            Cancel
          </Button>
        </Show>
        <Show when={text().trim().length > 0 && !props.running}>
          <Button
            variant="primary"
            disabled={props.disabled}
            onClick={send}
            class="px-4 py-1.5 text-xs"
          >
            Send
          </Button>
        </Show>
      </div>
    </div>
  );
}

/** Status bar */
function StatusBar(props: { sessionState: SessionState; sessionCount: number }) {
  const dot =
    props.sessionState === "running" ? "connecting"
    : props.sessionState === "error" ? "disconnected"
    : "connected";

  const label =
    props.sessionState === "running" ? "Agent running"
    : props.sessionState === "error" ? "Error"
    : "Ready";

  return (
    <footer
      class={`${C.surfaceElevated} ${C.border} border-t px-3 py-1 flex items-center gap-2 text-xs ${C.mutedText}`}
      style={{ "min-height": "28px" }}
    >
      <StatusDot status={dot} label={label} />
      <span>Relay Agent v0.1.0</span>
      <span class="mx-auto">
        {props.sessionCount} session{props.sessionCount !== 1 ? "s" : ""}
      </span>
    </footer>
  );
}

/* ============================================================
   Shell — root layout
   ============================================================ */

export default function Shell(): JSX.Element {
  // Core session state
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
  const [sessionIds, setSessionIds] = createSignal<string[]>([]);
  const [sessionRunning, setSessionRunning] = createSignal(false);
  const [sessionError, setSessionError] = createSignal<string | null>(null);

  // Messages rendered as flat chunks
  const [chunks, setChunks] = createSignal<UiChunk[]>([]);

  // Pending approval queue
  const [approvals, setApprovals] = createSignal<Approval[]>([]);

  const sessionState = createMemo((): SessionState => {
    if (sessionRunning()) return "running";
    if (sessionError()) return "error";
    return "idle";
  });

  // ── Start IPC event listener on mount ────────────────────
  onMount(async () => {
    const appendAssistantText = (sessionId: string, text: string, isComplete: boolean) => {
      if (!text && !isComplete) return;
      if (activeSessionId() !== sessionId) return;

      if (!text && isComplete) {
        return;
      }

      setChunks((prev) => {
        const next = [...prev];
        const last = next.at(-1);
        if (last?.kind === "assistant") {
          last.text += text;
          return next;
        }
        next.push({ kind: "assistant", text });
        return next;
      });
    };

    const trackToolStart = (sessionId: string, event: AgentToolStartEvent) => {
      if (activeSessionId() !== sessionId) return;
      setChunks((prev) => {
        const next = [...prev];
        const existing = next.find(
          (chunk): chunk is Extract<UiChunk, { kind: "tool_call" }> =>
            chunk.kind === "tool_call" && chunk.toolUseId === event.toolUseId,
        );
        if (!existing) {
          next.push({
            kind: "tool_call",
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            result: null,
            status: "running",
          });
        }
        return next;
      });
    };

    const trackToolResult = (sessionId: string, event: AgentToolResultEvent) => {
      if (activeSessionId() !== sessionId) return;
      setChunks((prev) => {
        const next = [...prev];
        const existing = next.find(
          (chunk): chunk is Extract<UiChunk, { kind: "tool_call" }> =>
            chunk.kind === "tool_call" && chunk.toolUseId === event.toolUseId,
        );
        if (existing) {
          existing.result = event.content;
          existing.status = event.isError ? "error" : "done";
          return next;
        }
        next.push({
          kind: "tool_call",
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          result: event.content,
          status: event.isError ? "error" : "done",
        });
        return next;
      });
    };

    const unlisten = await onAgentEvent((event) => {
      switch (event.type) {
        case "text_delta": {
          const e = event.data as AgentTextDeltaEvent;
          appendAssistantText(e.sessionId, e.text, e.isComplete);
          break;
        }

        case "turn_complete": {
          const e = event.data as AgentTurnCompleteEvent;
          console.log("[IPC] turn_complete", e.sessionId, e.stopReason);
          setSessionRunning(false);
          void reloadHistory(e.sessionId);
          break;
        }

        case "error": {
          const e = event.data as AgentErrorEvent;
          console.error("[IPC] error", e.sessionId, e.error);
          setSessionRunning(false);
          if (!e.cancelled) setSessionError(e.error);
          break;
        }

        case "approval_needed": {
          const e = event.data as AgentApprovalNeededEvent;
          console.log("[IPC] approval_needed", e.approvalId, e.toolName);
          setApprovals((prev) => [
            ...prev,
            {
              sessionId: e.sessionId,
              approvalId: e.approvalId,
              toolName: e.toolName,
              description: e.description,
              target: e.target,
            },
          ]);
          break;
        }

        case "tool_start": {
          const e = event.data as AgentToolStartEvent;
          trackToolStart(e.sessionId, e);
          break;
        }

        case "tool_result": {
          const e = event.data as AgentToolResultEvent;
          trackToolResult(e.sessionId, e);
          break;
        }
      }
    });

    onCleanup(() => unlisten());
  });

  // ── Reload session history from Rust storage ─────────────
  const reloadHistory = async (sessionId: string) => {
    try {
      const res = await getSessionHistory({ sessionId });
      setChunks(chunksFromHistory(res.messages));
      setSessionRunning(res.running);
      if (!res.running) setSessionError(null);
    } catch (err) {
      console.error("[IPC] load history failed", err);
    }
  };

  // ── Send a prompt (starts agent session) ─────────────────
  const handleSend = async (text: string) => {
    setSessionError(null);
    setApprovals([]);

    // Optimistic user message
    setChunks((prev) => [...prev, { kind: "user" as const, text }]);

    try {
      const sessionId = await startAgent({
        goal: text,
        files: [],
      });
      setActiveSessionId(sessionId);
      setSessionIds((prev) => [...prev, sessionId]);
      setSessionRunning(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
      setSessionRunning(false);
    }
  };

  // ── Approval responses ───────────────────────────────────
  const handleApprove = async (approvalId: string) => {
    const sid = activeSessionId();
    if (!sid) return;
    await respondApproval({ sessionId: sid, approvalId, approved: true });
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
  };

  const handleReject = async (approvalId: string) => {
    const sid = activeSessionId();
    if (!sid) return;
    await respondApproval({ sessionId: sid, approvalId, approved: false });
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
  };

  // ── Cancel ───────────────────────────────────────────────
  const handleCancel = async () => {
    const sid = activeSessionId();
    if (!sid) return;
    try {
      await cancelAgent({ sessionId: sid });
      setSessionRunning(false);
    } catch (err) {
      console.error("[IPC] cancel failed", err);
    }
  };

  // ── Select a session from sidebar ────────────────────────
  const selectSession = (id: string) => {
    setActiveSessionId(id);
    void reloadHistory(id);
  };

  return (
    <div
      class="grid h-screen overflow-hidden"
      style={{
        "grid-template-rows": "auto 1fr auto",
        "grid-template-columns": "260px 1fr 300px",
        background: "var(--ra-surface)",
      }}
    >
      {/* Header */}
      <header
        class={`col-span-full flex items-center gap-2 px-4 py-2 border-b ${C.border} ${C.surfaceElevated}`}
      >
        <span class="font-bold text-sm tracking-wide">Relay Agent</span>
        <div class="flex-1" />
        <StatusDot status={sessionRunning() ? "connecting" : "connected"} label="Copilot" />
        <button
          class={`px-3 py-1 text-xs rounded-full border ${C.border} ${C.mutedText} ${C.hover} transition-colors`}
        >
          ⚙ Settings
        </button>
      </header>

      {/* 3-pane body */}
      <Sidebar
        sessionIds={sessionIds()}
        activeSessionId={activeSessionId()}
        onSelect={selectSession}
      />

      {/* Main — feed + composer */}
      <main class="overflow-y-auto flex-1 flex-col relative">
        <MessageFeed chunks={chunks()} sessionState={sessionState()} />
        <Composer
          onSend={handleSend}
          disabled={sessionRunning()}
          running={sessionRunning()}
          onCancel={handleCancel}
        />
        <ApprovalOverlay
          approvals={approvals()}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      </main>

      <ContextPanel />

      {/* Footer */}
      <div class="col-span-full">
        <StatusBar sessionState={sessionState()} sessionCount={sessionIds().length} />
      </div>
    </div>
  );
}
