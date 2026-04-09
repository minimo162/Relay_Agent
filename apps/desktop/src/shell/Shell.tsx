/// <reference types="vite/client" />
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { truncatePromptPreview, type SessionMeta } from "../session/session-display";
import {
  cancelAgent,
  chunksFromHistory,
  compactAgentSession,
  getSessionHistory,
  getSessionWriteUndoStatus,
  listWorkspaceSlashCommands,
  mcpListServers,
  onAgentEvent,
  redoSessionWrite,
  respondApproval,
  respondUserQuestion,
  startAgent,
  undoSessionWrite,
  warmupCopilotBridge,
  readStoredSessionPreset,
  writeStoredSessionPreset,
  type SessionPreset,
  type AgentApprovalNeededEvent,
  type AgentUserQuestionNeededEvent,
  type AgentErrorEvent,
  type AgentTextDeltaEvent,
  type AgentToolResultEvent,
  type AgentToolStartEvent,
  type AgentTurnCompleteEvent,
  type ContextFile,
  type McpServer,
  type UiChunk,
  type WorkspaceSlashCommandRow,
} from "../lib/ipc";
import {
  executeSlashCommand,
  setWorkspaceSlashCommands,
  type SlashCommand,
  type SlashCommandContext,
} from "../lib/slash-commands";
import { ApprovalOverlay } from "../components/ApprovalOverlay";
import { UserQuestionOverlay } from "../components/UserQuestionOverlay";
import { Composer } from "../components/Composer";
import { ContextPanel } from "../components/ContextPanel";
import { MessageFeed } from "../components/MessageFeed";
import { SettingsModal } from "../components/SettingsModal";
import { ShellHeader } from "../components/ShellHeader";
import { Sidebar } from "../components/Sidebar";
import { StatusBar } from "../components/StatusBar";
import type { Approval, UserQuestion } from "../components/shell-types";
import {
  loadBrowserSettings,
  loadMaxTurns,
  loadWorkspacePath,
} from "../lib/settings-storage";
import {
  buildPlanTimelineFromUiChunks,
  parseTodoWriteToolResult,
  type PlanTimelineEntry,
} from "../context/todo-write-parse";

function workspaceSlashRowsToCommands(rows: WorkspaceSlashCommandRow[]): SlashCommand[] {
  return rows.map((row) => ({
    command: `/${row.name}`,
    description: row.description?.trim() || "Workspace command (.relay/commands)",
    handler: async (args: string) => {
      const a = args.trim();
      if (a.length) return `${row.body}\n\n${a}`;
      return row.body;
    },
  }));
}

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
  const [sessionMeta, setSessionMeta] = createSignal<Record<string, SessionMeta>>({});

  const sessionEntries = createMemo(() =>
    sessionIds().map((id) => ({ id, meta: sessionMeta()[id] })),
  );
  const [sessionRunning, setSessionRunning] = createSignal(false);
  const [sessionError, setSessionError] = createSignal<string | null>(null);
  const [copilotBridgeHint, setCopilotBridgeHint] = createSignal<string | null>(null);

  const [chunks, setChunks] = createSignal<UiChunk[]>([]);

  const [showToolActivityInline, setShowToolActivityInline] = createSignal(readShowToolActivity());

  const [approvals, setApprovals] = createSignal<Approval[]>([]);
  const [userQuestions, setUserQuestions] = createSignal<UserQuestion[]>([]);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [planBySession, setPlanBySession] = createSignal<Record<string, PlanTimelineEntry[]>>({});
  const [workspaceLabel, setWorkspaceLabel] = createSignal(loadWorkspacePath().trim());
  const [sessionPreset, setSessionPreset] = createSignal<SessionPreset>(readStoredSessionPreset());
  const [writeUndoStatus, setWriteUndoStatus] = createSignal({ canUndo: false, canRedo: false });

  createEffect(() => {
    const cwd = workspaceLabel();
    if (!isTauri()) {
      setWorkspaceSlashCommands([]);
      return;
    }
    void listWorkspaceSlashCommands(cwd.trim() || null)
      .then((rows) => setWorkspaceSlashCommands(workspaceSlashRowsToCommands(rows)))
      .catch(() => setWorkspaceSlashCommands([]));
  });

  const refreshWriteUndoStatus = async () => {
    const sid = activeSessionId();
    if (!sid) {
      setWriteUndoStatus({ canUndo: false, canRedo: false });
      return;
    }
    try {
      const s = await getSessionWriteUndoStatus({ sessionId: sid });
      setWriteUndoStatus({ canUndo: s.canUndo, canRedo: s.canRedo });
    } catch {
      setWriteUndoStatus({ canUndo: false, canRedo: false });
    }
  };

  createEffect(() => {
    activeSessionId();
    if (sessionRunning()) return;
    void refreshWriteUndoStatus();
  });

  const planTimelineForActiveSession = createMemo(() => {
    const id = activeSessionId();
    if (!id) return [];
    return planBySession()[id] ?? [];
  });

  const [contextFiles, setContextFiles] = createSignal<ContextFile[]>([
    { name: "README.md", path: "/tmp/Relay_Agent/README.md", size: 1024 },
    { name: "package.json", path: "/tmp/Relay_Agent/package.json", size: 2048 },
  ]);
  const [mcpServers, setMcpServers] = createSignal<McpServer[]>([]);

  onMount(async () => {
    try {
      const servers = await mcpListServers();
      setMcpServers(servers);
    } catch (err) {
      console.error("[MCP] Failed to load servers:", err);
    }

    void warmupCopilotBridge()
      .then((r) => {
        if (r.loginRequired) {
          setCopilotBridgeHint("Sign in to Copilot in Edge, then return here.");
        } else if (r.error) {
          setCopilotBridgeHint(`Copilot: ${r.error}`);
        } else if (r.connected) {
          setCopilotBridgeHint(null);
        }
      })
      .catch((err) => {
        console.error("[Copilot] warmup failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        setCopilotBridgeHint(`Copilot: ${msg}`);
      })
      .finally(() => {
        if (!isTauri()) return;
        const win = getCurrentWindow();
        void win
          .show()
          .then(() => win.setFocus())
          .catch((e) => console.error("[Shell] window show/focus failed:", e));
      });
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
      setPlanBySession((prev) => ({
        ...prev,
        [sessionId]: buildPlanTimelineFromUiChunks(next),
      }));
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
      if (event.toolName === "TodoWrite" && !event.isError) {
        const todos = parseTodoWriteToolResult(event.content);
        if (todos?.length) {
          setPlanBySession((prev) => {
            const cur = prev[sessionId] ?? [];
            if (cur.some((e) => e.toolUseId === event.toolUseId)) return prev;
            const entry: PlanTimelineEntry = {
              toolUseId: event.toolUseId,
              atMs: Date.now(),
              todos,
            };
            return { ...prev, [sessionId]: [...cur, entry] };
          });
        }
      }

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
              workspaceCwdConfigured: Boolean(e.workspaceCwdConfigured),
            },
          ]);
          break;
        }

        case "user_question": {
          const e = event.data as AgentUserQuestionNeededEvent;
          setUserQuestions((prev) => [
            ...prev,
            {
              sessionId: e.sessionId,
              questionId: e.questionId,
              prompt: e.prompt,
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
    setUserQuestions([]);

    setChunks((prev) => [...prev, { kind: "user" as const, text }]);

    try {
      const cwd = loadWorkspacePath().trim();
      const sessionId = await startAgent({
        goal: text,
        files: [],
        cwd: cwd || null,
        maxTurns: loadMaxTurns(),
        browserSettings: loadBrowserSettings(),
        sessionPreset: sessionPreset(),
      });
      setActiveSessionId(sessionId);
      setSessionIds((prev) => [...prev, sessionId]);
      setSessionMeta((m) => ({
        ...m,
        [sessionId]: {
          createdAt: Date.now(),
          preview: truncatePromptPreview(text, 52),
        },
      }));
      setSessionRunning(true);
      setCopilotBridgeHint(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
      setSessionRunning(false);
    }
  };

  const handleApproveOnce = async (approvalId: string) => {
    const sid = activeSessionId();
    if (!sid) return;
    await respondApproval({ sessionId: sid, approvalId, approved: true, rememberForSession: false });
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
  };

  const handleApproveForSession = async (approvalId: string) => {
    const sid = activeSessionId();
    if (!sid) return;
    await respondApproval({ sessionId: sid, approvalId, approved: true, rememberForSession: true });
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
  };

  const handleApproveForWorkspace = async (approvalId: string) => {
    const sid = activeSessionId();
    if (!sid) return;
    await respondApproval({
      sessionId: sid,
      approvalId,
      approved: true,
      rememberForSession: false,
      rememberForWorkspace: true,
    });
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
  };

  const handleReject = async (approvalId: string) => {
    const sid = activeSessionId();
    if (!sid) return;
    await respondApproval({ sessionId: sid, approvalId, approved: false });
    setApprovals((prev) => prev.filter((a) => a.approvalId !== approvalId));
  };

  const handleUserQuestionSubmit = async (questionId: string, answer: string) => {
    const sid = activeSessionId();
    if (!sid) return;
    if (!answer) return;
    try {
      await respondUserQuestion({ sessionId: sid, questionId, answer });
      setUserQuestions((prev) => prev.filter((q) => q.questionId !== questionId));
    } catch (err) {
      console.error("[IPC] respond_user_question failed", err);
    }
  };

  const handleUserQuestionCancel = async (questionId: string) => {
    const sid = activeSessionId();
    if (!sid) return;
    try {
      await respondUserQuestion({ sessionId: sid, questionId, answer: "" });
      setUserQuestions((prev) => prev.filter((q) => q.questionId !== questionId));
    } catch (err) {
      console.error("[IPC] respond_user_question cancel failed", err);
    }
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
        onOpenSettings={() => setSettingsOpen(true)}
        workspacePath={workspaceLabel}
        onWorkspaceChipClick={() => setSettingsOpen(true)}
        canUndo={writeUndoStatus().canUndo}
        canRedo={writeUndoStatus().canRedo}
        onUndo={async () => {
          const sid = activeSessionId();
          if (!sid) return;
          try {
            await undoSessionWrite({ sessionId: sid });
            await refreshWriteUndoStatus();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setSessionError(msg);
          }
        }}
        onRedo={async () => {
          const sid = activeSessionId();
          if (!sid) return;
          try {
            await redoSessionWrite({ sessionId: sid });
            await refreshWriteUndoStatus();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setSessionError(msg);
          }
        }}
      />

      <Sidebar sessions={sessionEntries()} activeSessionId={activeSessionId()} onSelect={selectSession} />

      <main class="ra-shell-main">
        <Show when={sessionError()}>
          <div
            role="alert"
            data-ra-session-error
            class="shrink-0 px-6 py-2.5 text-sm border-b border-[var(--ra-border)] bg-[var(--ra-surface-elevated)]"
          >
            <p class="ra-type-title-sm text-[var(--ra-text-primary)]">Couldn&apos;t complete that request</p>
            <p class="mt-0.5 text-[var(--ra-red)] whitespace-pre-wrap break-words">{sessionError()}</p>
            <p class="mt-1.5 text-[var(--ra-text-secondary)]">Try editing your prompt or switching sessions.</p>
          </div>
        </Show>
        <MessageFeed
          chunks={chunks()}
          sessionState={sessionState()}
          showToolActivityInline={showToolActivityInline()}
          workspacePath={workspaceLabel}
          sessionPreset={sessionPreset()}
        />
        <Composer
          sessionPreset={sessionPreset()}
          onSessionPresetChange={(p) => {
            setSessionPreset(p);
            writeStoredSessionPreset(p);
          }}
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
        <ApprovalOverlay
          approvals={approvals()}
          onApproveOnce={handleApproveOnce}
          onApproveForSession={handleApproveForSession}
          onApproveForWorkspace={handleApproveForWorkspace}
          onReject={handleReject}
        />
        <UserQuestionOverlay
          questions={userQuestions()}
          onSubmit={handleUserQuestionSubmit}
          onCancel={handleUserQuestionCancel}
        />
        <SettingsModal
          open={settingsOpen()}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setWorkspaceLabel(loadWorkspacePath().trim());
          }}
          activeSessionId={activeSessionId()}
        />
      </main>

      <ContextPanel
        contextFiles={contextFiles}
        setContextFiles={setContextFiles}
        mcpServers={mcpServers}
        setMcpServers={setMcpServers}
        workspacePath={workspaceLabel}
        sessionPreset={sessionPreset}
        planTimeline={planTimelineForActiveSession}
      />

      <div class="col-span-full">
        <StatusBar
          sessionState={sessionState()}
          sessionCount={sessionIds().length}
          copilotBridgeHint={copilotBridgeHint()}
          workspaceFullPath={workspaceLabel() || null}
        />
      </div>
    </div>
  );
}
