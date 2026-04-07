/// <reference types="vite/client" />
import { Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import {
  cancelAgent,
  chunksFromHistory,
  compactAgentSession,
  getSessionHistory,
  mcpListServers,
  onAgentEvent,
  respondApproval,
  startAgent,
  type AgentApprovalNeededEvent,
  type AgentErrorEvent,
  type AgentTextDeltaEvent,
  type AgentToolResultEvent,
  type AgentToolStartEvent,
  type AgentTurnCompleteEvent,
  type ContextFile,
  type McpServer,
  type Policy,
  type UiChunk,
} from "./lib/ipc";
import {
  executeSlashCommand,
  type SlashCommandContext,
} from "./lib/slash-commands";
import { ApprovalOverlay } from "./components/ApprovalOverlay";
import { Composer } from "./components/Composer";
import { ContextPanel } from "./components/ContextPanel";
import { MessageFeed } from "./components/MessageFeed";
import { ShellHeader } from "./components/ShellHeader";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import type { Approval } from "./components/shell-types";

const LS_SHOW_TOOL_ACTIVITY = "relay.showToolActivity";

function readShowToolActivity(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(LS_SHOW_TOOL_ACTIVITY) === "1";
  } catch {
    return false;
  }
}

function writeShowToolActivity(on: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_SHOW_TOOL_ACTIVITY, on ? "1" : "0");
    }
  } catch {
    /* ignore */
  }
}

export default function Shell(): JSX.Element {
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
  const [sessionIds, setSessionIds] = createSignal<string[]>([]);
  const [sessionRunning, setSessionRunning] = createSignal(false);
  const [sessionError, setSessionError] = createSignal<string | null>(null);

  const [chunks, setChunks] = createSignal<UiChunk[]>([]);

  const [showToolActivityInline, setShowToolActivityInline] = createSignal(readShowToolActivity());

  const [approvals, setApprovals] = createSignal<Approval[]>([]);

  const [contextFiles, setContextFiles] = createSignal<ContextFile[]>([
    { name: "README.md", path: "/tmp/Relay_Agent/README.md", size: 1024 },
    { name: "package.json", path: "/tmp/Relay_Agent/package.json", size: 2048 },
  ]);
  const [mcpServers, setMcpServers] = createSignal<McpServer[]>([]);
  const [policies, setPolicies] = createSignal<Policy[]>([
    { name: "Bash", requirement: "require_approval", description: "Shell commands" },
    { name: "File write", requirement: "require_approval", description: "Write/modify files" },
    { name: "File read", requirement: "auto_allow", description: "Read-only access" },
    { name: "URL fetch", requirement: "auto_deny", description: "External requests" },
  ]);

  onMount(async () => {
    try {
      const servers = await mcpListServers();
      setMcpServers(servers);
    } catch (err) {
      console.error("[MCP] Failed to load servers:", err);
    }
  });

  const sessionState = createMemo(() => {
    if (sessionRunning()) return "running" as const;
    if (sessionError()) return "error" as const;
    return "idle" as const;
  });

  const reloadHistory = async (
    sessionId: string,
    opts?: { fallbackAssistantText?: string; afterTurnComplete?: boolean },
  ) => {
    try {
      const res = await getSessionHistory({ sessionId });
      let next = chunksFromHistory(res.messages);
      const hasAssistantText = next.some((c) => c.kind === "assistant" && c.text.trim().length > 0);
      const fb = opts?.fallbackAssistantText?.trim();
      if (!hasAssistantText && fb) {
        next = [...next, { kind: "assistant" as const, text: fb }];
      }
      setChunks(next);
      const idle = opts?.afterTurnComplete || !res.running;
      setSessionRunning(!idle);
      if (idle) setSessionError(null);
    } catch (err) {
      console.error("[IPC] load history failed", err);
      const fb = opts?.fallbackAssistantText?.trim();
      if (fb) {
        setChunks((prev) => [...prev, { kind: "assistant", text: fb }]);
      }
      if (opts?.afterTurnComplete) setSessionRunning(false);
    }
  };

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
        const idx = prev.findIndex(
          (chunk): chunk is Extract<UiChunk, { kind: "tool_call" }> =>
            chunk.kind === "tool_call" && chunk.toolUseId === event.toolUseId,
        );
        if (idx === -1) {
          return [
            ...prev,
            {
              kind: "tool_call",
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              result: event.content,
              status: event.isError ? "error" : "done",
            },
          ];
        }
        const cur = prev[idx] as Extract<UiChunk, { kind: "tool_call" }>;
        const next = [...prev];
        next[idx] = {
          kind: "tool_call",
          toolUseId: cur.toolUseId,
          toolName: cur.toolName,
          result: event.content,
          status: event.isError ? "error" : "done",
        };
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
          void reloadHistory(e.sessionId, {
            fallbackAssistantText: e.assistantMessage,
            afterTurnComplete: true,
          });
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

  const handleSend = async (text: string) => {
    setSessionError(null);
    setApprovals([]);

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

  const selectSession = (id: string) => {
    setActiveSessionId(id);
    setSessionError(null);
    void reloadHistory(id);
  };

  return (
    <div class="ra-shell">
      <ShellHeader
        sessionRunning={sessionRunning()}
        showToolActivityInline={showToolActivityInline()}
        onToolActivityChange={(v) => {
          setShowToolActivityInline(v);
          writeShowToolActivity(v);
        }}
      />

      <Sidebar sessionIds={sessionIds()} activeSessionId={activeSessionId()} onSelect={selectSession} />

      <main class="ra-shell-main">
        <Show when={sessionError()}>
          <div
            role="alert"
            data-ra-session-error
            class="shrink-0 px-6 py-2.5 text-xs border-b border-[var(--ra-border)] bg-[var(--ra-surface-elevated)] text-[var(--ra-red)] whitespace-pre-wrap break-words"
          >
            {sessionError()}
          </div>
        </Show>
        <MessageFeed
          chunks={chunks()}
          sessionState={sessionState()}
          showToolActivityInline={showToolActivityInline()}
        />
        <Composer
          onSend={handleSend}
          disabled={sessionRunning()}
          running={sessionRunning()}
          onCancel={handleCancel}
          onSlashCommand={(input) => {
            const ctx: SlashCommandContext = {
              sessionId: activeSessionId(),
              clearChunks: () => setChunks([]),
              compactSession: (sid) => compactAgentSession({ sessionId: sid }),
              sessionRunning: sessionRunning(),
              chunksCount: chunks().length,
            };
            return executeSlashCommand(input, ctx);
          }}
          onAppendAssistant={(text: string) => {
            setChunks((prev) => [...prev, { kind: "assistant", text }]);
          }}
        />
        <ApprovalOverlay approvals={approvals()} onApprove={handleApprove} onReject={handleReject} />
      </main>

      <ContextPanel
        contextFiles={contextFiles}
        setContextFiles={setContextFiles}
        mcpServers={mcpServers}
        setMcpServers={setMcpServers}
        policies={policies}
      />

      <div class="col-span-full">
        <StatusBar sessionState={sessionState()} sessionCount={sessionIds().length} />
      </div>
    </div>
  );
}
