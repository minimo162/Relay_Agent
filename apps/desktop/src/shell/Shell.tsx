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
  type AgentSessionStatusEvent,
  type AgentTextDeltaEvent,
  type AgentToolResultEvent,
  type AgentToolStartEvent,
  type AgentTurnCompleteEvent,
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
import { FirstRunPanel } from "../components/FirstRunPanel";
import { MessageFeed } from "../components/MessageFeed";
import { SettingsModal } from "../components/SettingsModal";
import { ShellHeader } from "../components/ShellHeader";
import { Sidebar } from "../components/Sidebar";
import { StatusBar } from "../components/StatusBar";
import type { Approval, SessionStatusSnapshot, UserQuestion } from "../components/shell-types";
import { loadBrowserSettings, loadMaxTurns, loadWorkspacePath } from "../lib/settings-storage";
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

export default function Shell(): JSX.Element {
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
  const [sessionIds, setSessionIds] = createSignal<string[]>([]);
  const [sessionMeta, setSessionMeta] = createSignal<Record<string, SessionMeta>>({});

  const sessionEntries = createMemo(() =>
    sessionIds().map((id) => ({ id, meta: sessionMeta()[id] })),
  );
  const [statusBySession, setStatusBySession] = createSignal<Record<string, SessionStatusSnapshot>>({});
  const [sessionError, setSessionError] = createSignal<string | null>(null);
  const [copilotBridgeHint, setCopilotBridgeHint] = createSignal<string | null>(null);
  const [copilotSuccessFlash, setCopilotSuccessFlash] = createSignal<string | null>(null);
  const copilotFlashTimer: { id?: ReturnType<typeof setTimeout> } = {};

  const runCopilotWarmup = (focusMainWindow: boolean) => {
    if (copilotFlashTimer.id) {
      clearTimeout(copilotFlashTimer.id);
      copilotFlashTimer.id = undefined;
    }
    void warmupCopilotBridge(loadBrowserSettings())
      .then((r) => {
        if (r.loginRequired) {
          setCopilotBridgeHint("Sign in to Copilot in Edge, then return here.");
          setCopilotSuccessFlash(null);
        } else if (r.error) {
          setCopilotBridgeHint(`Copilot: ${r.error}`);
          setCopilotSuccessFlash(null);
        } else if (r.connected) {
          setCopilotBridgeHint(null);
          setCopilotSuccessFlash("Copilot ready.");
          copilotFlashTimer.id = setTimeout(() => {
            setCopilotSuccessFlash(null);
            copilotFlashTimer.id = undefined;
          }, 3500);
        }
      })
      .catch((err) => {
        console.error("[Copilot] warmup failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        setCopilotBridgeHint(`Copilot: ${msg}`);
        setCopilotSuccessFlash(null);
      })
      .finally(() => {
        if (!focusMainWindow || !isTauri()) return;
        const win = getCurrentWindow();
        void win
          .show()
          .then(() => win.setFocus())
          .catch((e) => console.error("[Shell] window show/focus failed:", e));
      });
  };

  const [chunks, setChunks] = createSignal<UiChunk[]>([]);

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
    if ((statusBySession()[activeSessionId() ?? ""]?.phase ?? "idle") !== "idle") return;
    void refreshWriteUndoStatus();
  });

  const planTimelineForActiveSession = createMemo(() => {
    const id = activeSessionId();
    if (!id) return [];
    return planBySession()[id] ?? [];
  });

  const [mcpServers, setMcpServers] = createSignal<McpServer[]>([]);
  const isFirstRun = createMemo(
    () => sessionIds().length === 0 && chunks().length === 0 && activeSessionId() === null,
  );

  onCleanup(() => {
    if (copilotFlashTimer.id) clearTimeout(copilotFlashTimer.id);
  });

  onMount(async () => {
    try {
      const servers = await mcpListServers();
      setMcpServers(servers);
    } catch (err) {
      console.error("[MCP] Failed to load servers:", err);
    }

    runCopilotWarmup(true);
  });

  const activeSessionStatus = createMemo<SessionStatusSnapshot>(() => {
    const sid = activeSessionId();
    if (!sid) return { phase: "idle" };
    return statusBySession()[sid] ?? { phase: "idle" };
  });
  const sessionBusy = createMemo(() => activeSessionStatus().phase !== "idle");

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
      const nextStatus: SessionStatusSnapshot = opts?.afterTurnComplete || !res.running
        ? { phase: "idle" }
        : (statusBySession()[sessionId] ?? { phase: "running" });
      setStatusBySession((prev) => ({ ...prev, [sessionId]: nextStatus }));
      if (nextStatus.phase === "idle") setSessionError(null);
    } catch (err) {
      console.error("[IPC] load history failed", err);
      const fb = opts?.fallbackAssistantText?.trim();
      if (fb) {
        setChunks((prev) => [...prev, { kind: "assistant", text: fb }]);
      }
      if (opts?.afterTurnComplete) {
        setStatusBySession((prev) => ({ ...prev, [sessionId]: { phase: "idle" } }));
      }
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
        case "status": {
          const e = event.data as AgentSessionStatusEvent;
          setStatusBySession((prev) => ({
            ...prev,
            [e.sessionId]: {
              phase: e.phase,
              attempt: e.attempt,
              message: e.message,
              nextRetryAtMs: e.nextRetryAtMs,
              toolName: e.toolName,
              stopReason: e.stopReason,
            },
          }));
          if (e.phase === "idle" && e.stopReason !== "cancelled") {
            setSessionError(null);
          }
          break;
        }

        case "text_delta": {
          const e = event.data as AgentTextDeltaEvent;
          appendAssistantText(e.sessionId, e.text, e.isComplete);
          break;
        }

        case "turn_complete": {
          const e = event.data as AgentTurnCompleteEvent;
          console.log("[IPC] turn_complete", e.sessionId, e.stopReason);
          setStatusBySession((prev) => ({
            ...prev,
            [e.sessionId]: { phase: "idle", stopReason: e.stopReason },
          }));
          void reloadHistory(e.sessionId, {
            fallbackAssistantText: e.assistantMessage,
            afterTurnComplete: true,
          });
          break;
        }

        case "error": {
          const e = event.data as AgentErrorEvent;
          console.error("[IPC] error", e.sessionId, e.error);
          setStatusBySession((prev) => ({
            ...prev,
            [e.sessionId]: prev[e.sessionId] ?? { phase: "idle" },
          }));
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
      setStatusBySession((prev) => ({ ...prev, [sessionId]: { phase: "running" } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
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
      setStatusBySession((prev) => ({
        ...prev,
        [sid]: { phase: "cancelling", message: "Cancellation requested" },
      }));
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
    <div classList={{ "ra-shell": true, "ra-shell--first-run": isFirstRun() }}>
      <ShellHeader
        sessionStatus={activeSessionStatus()}
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
            class="shrink-0 px-6 py-2.5 ra-type-button-label border-b border-[var(--ra-border)] bg-[var(--ra-surface-elevated)]"
          >
            <p class="ra-type-title-sm text-[var(--ra-text-primary)]">Couldn&apos;t complete that request</p>
            <p class={`mt-0.5 ra-type-body-sans text-[var(--ra-red)] whitespace-pre-wrap break-words`}>
              {sessionError()}
            </p>
            <p class={`mt-1.5 ra-type-button-label text-[var(--ra-text-secondary)]`}>
              Try editing your prompt or switching sessions.
            </p>
          </div>
        </Show>
        <Show
          when={isFirstRun()}
          fallback={
            <>
              <MessageFeed
                chunks={chunks()}
                sessionStatus={activeSessionStatus()}
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
                disabled={sessionBusy()}
                running={sessionBusy()}
                onCancel={handleCancel}
                onSlashCommand={(input) => {
                  const ctx: SlashCommandContext = {
                    sessionId: activeSessionId(),
                    clearChunks: () => setChunks([]),
                    compactSession: (sid) => compactAgentSession({ sessionId: sid }),
                    sessionRunning: sessionBusy(),
                    chunksCount: chunks().length,
                  };
                  return executeSlashCommand(input, ctx);
                }}
                onAppendAssistant={(text: string) => {
                  setChunks((prev) => [...prev, { kind: "assistant", text }]);
                }}
              />
            </>
          }
        >
          <FirstRunPanel
            workspacePath={workspaceLabel}
            onChooseWorkspace={() => setSettingsOpen(true)}
            sessionPreset={sessionPreset()}
          >
            <Composer
              sessionPreset={sessionPreset()}
              onSessionPresetChange={(p) => {
                setSessionPreset(p);
                writeStoredSessionPreset(p);
              }}
              onSend={handleSend}
              disabled={sessionBusy()}
              running={sessionBusy()}
              onCancel={handleCancel}
              onSlashCommand={(input) => {
                const ctx: SlashCommandContext = {
                  sessionId: activeSessionId(),
                  clearChunks: () => setChunks([]),
                  compactSession: (sid) => compactAgentSession({ sessionId: sid }),
                  sessionRunning: sessionBusy(),
                  chunksCount: chunks().length,
                };
                return executeSlashCommand(input, ctx);
              }}
              onAppendAssistant={(text: string) => {
                setChunks((prev) => [...prev, { kind: "assistant", text }]);
              }}
              hero
            />
          </FirstRunPanel>
        </Show>
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
        />
      </main>

      <Show when={!isFirstRun()}>
        <ContextPanel
          mcpServers={mcpServers}
          setMcpServers={setMcpServers}
          workspacePath={workspaceLabel}
          sessionPreset={sessionPreset}
          planTimeline={planTimelineForActiveSession}
        />
      </Show>

      <div class="col-span-full">
        <StatusBar
          sessionStatus={activeSessionStatus()}
          sessionCount={sessionIds().length}
          copilotBridgeHint={copilotBridgeHint()}
          copilotSuccessFlash={copilotSuccessFlash()}
          onRetryCopilot={isTauri() ? () => runCopilotWarmup(false) : undefined}
          copilotRetryDisabled={sessionBusy()}
          workspaceFullPath={workspaceLabel() || null}
        />
      </div>
    </div>
  );
}
