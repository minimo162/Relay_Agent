/// <reference types="vite/client" />
import { isTauri } from "@tauri-apps/api/core";
import { Show, createEffect, createMemo, createSignal, onMount, type JSX } from "solid-js";
import { truncatePromptPreview } from "../session/session-display";
import {
  cancelAgent,
  chunksFromHistory,
  compactAgentSession,
  getSessionHistory,
  getSessionWriteUndoStatus,
  listWorkspaceSlashCommands,
  mcpListServers,
  redoSessionWrite,
  respondApproval,
  respondUserQuestion,
  startAgent,
  undoSessionWrite,
  readStoredSessionPreset,
  writeStoredSessionPreset,
  type SessionPreset,
  type McpServer,
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
import type { SessionStatusSnapshot } from "../components/shell-types";
import { loadBrowserSettings, loadMaxTurns, loadWorkspacePath } from "../lib/settings-storage";
import { buildPlanTimelineFromUiChunks } from "../context/todo-write-parse";
import { createSessionStore } from "./sessionStore";
import { createApprovalStore } from "./approvalStore";
import { useCopilotWarmup } from "./useCopilotWarmup";
import { useAgentEvents } from "./useAgentEvents";

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
  const sessions = createSessionStore();
  const approvals = createApprovalStore();
  const [sessionError, setSessionError] = createSignal<string | null>(null);
  const { copilotBridgeHint, copilotSuccessFlash, runCopilotWarmup } = useCopilotWarmup(loadBrowserSettings);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
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
    const sid = sessions.activeSessionId();
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
    sessions.activeSessionId();
    if ((sessions.statusBySession()[sessions.activeSessionId() ?? ""]?.phase ?? "idle") !== "idle") return;
    void refreshWriteUndoStatus();
  });

  const [mcpServers, setMcpServers] = createSignal<McpServer[]>([]);

  onMount(async () => {
    try {
      const servers = await mcpListServers();
      setMcpServers(servers);
    } catch (err) {
      console.error("[MCP] Failed to load servers:", err);
    }

    runCopilotWarmup(true);
  });

  const sessionBusy = createMemo(() => sessions.activeSessionStatus().phase !== "idle");

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
      sessions.setChunks(next);
      sessions.setPlanBySession((prev) => ({
        ...prev,
        [sessionId]: buildPlanTimelineFromUiChunks(next),
      }));
      const nextStatus: SessionStatusSnapshot = opts?.afterTurnComplete || !res.running
        ? { phase: "idle" }
        : (sessions.statusBySession()[sessionId] ?? { phase: "running" });
      sessions.setStatusBySession((prev) => ({ ...prev, [sessionId]: nextStatus }));
      if (nextStatus.phase === "idle") setSessionError(null);
    } catch (err) {
      console.error("[IPC] load history failed", err);
      const fb = opts?.fallbackAssistantText?.trim();
      if (fb) {
        sessions.setChunks((prev) => [...prev, { kind: "assistant", text: fb }]);
      }
      if (opts?.afterTurnComplete) {
        sessions.setStatusBySession((prev) => ({ ...prev, [sessionId]: { phase: "idle" } }));
      }
    }
  };

  useAgentEvents({
    activeSessionId: sessions.activeSessionId,
    setChunks: sessions.setChunks,
    setPlanBySession: sessions.setPlanBySession,
    setStatusBySession: sessions.setStatusBySession,
    setApprovals: approvals.setApprovals,
    setUserQuestions: approvals.setUserQuestions,
    setSessionError,
    reloadHistory,
  });

  const handleSend = async (text: string) => {
    setSessionError(null);
    approvals.clearPending();

    sessions.setChunks((prev) => [...prev, { kind: "user" as const, text }]);

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
      sessions.setActiveSessionId(sessionId);
      sessions.setSessionIds((prev) => [...prev, sessionId]);
      sessions.setSessionMeta((m) => ({
        ...m,
        [sessionId]: {
          createdAt: Date.now(),
          preview: truncatePromptPreview(text, 52),
        },
      }));
      sessions.setStatusBySession((prev) => ({ ...prev, [sessionId]: { phase: "running" } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
    }
  };

  const handleApproveOnce = async (approvalId: string) => {
    const sid = sessions.activeSessionId();
    if (!sid) return;
    await respondApproval({ sessionId: sid, approvalId, approved: true, rememberForSession: false });
    approvals.removeApproval(approvalId);
  };

  const handleApproveForSession = async (approvalId: string) => {
    const sid = sessions.activeSessionId();
    if (!sid) return;
    await respondApproval({ sessionId: sid, approvalId, approved: true, rememberForSession: true });
    approvals.removeApproval(approvalId);
  };

  const handleApproveForWorkspace = async (approvalId: string) => {
    const sid = sessions.activeSessionId();
    if (!sid) return;
    await respondApproval({
      sessionId: sid,
      approvalId,
      approved: true,
      rememberForSession: false,
      rememberForWorkspace: true,
    });
    approvals.removeApproval(approvalId);
  };

  const handleReject = async (approvalId: string) => {
    const sid = sessions.activeSessionId();
    if (!sid) return;
    await respondApproval({ sessionId: sid, approvalId, approved: false });
    approvals.removeApproval(approvalId);
  };

  const handleUserQuestionSubmit = async (questionId: string, answer: string) => {
    const sid = sessions.activeSessionId();
    if (!sid) return;
    if (!answer) return;
    try {
      await respondUserQuestion({ sessionId: sid, questionId, answer });
      approvals.removeQuestion(questionId);
    } catch (err) {
      console.error("[IPC] respond_user_question failed", err);
    }
  };

  const handleUserQuestionCancel = async (questionId: string) => {
    const sid = sessions.activeSessionId();
    if (!sid) return;
    try {
      await respondUserQuestion({ sessionId: sid, questionId, answer: "" });
      approvals.removeQuestion(questionId);
    } catch (err) {
      console.error("[IPC] respond_user_question cancel failed", err);
    }
  };

  const handleCancel = async () => {
    const sid = sessions.activeSessionId();
    if (!sid) return;
    try {
      await cancelAgent({ sessionId: sid });
      sessions.setStatusBySession((prev) => ({
        ...prev,
        [sid]: { phase: "cancelling", message: "Cancellation requested" },
      }));
    } catch (err) {
      console.error("[IPC] cancel failed", err);
    }
  };

  const selectSession = (id: string) => {
    sessions.setActiveSessionId(id);
    setSessionError(null);
    void reloadHistory(id);
  };

  const handleNewSession = () => {
    sessions.setActiveSessionId(null);
    sessions.setChunks([]);
    setSessionError(null);
    approvals.clearPending();
    setWriteUndoStatus({ canUndo: false, canRedo: false });
  };

  return (
    <div classList={{ "ra-shell": true, "ra-shell--first-run": sessions.isFirstRun() }}>
      <ShellHeader
        sessionStatus={sessions.activeSessionStatus()}
        workspacePath={workspaceLabel}
        onWorkspaceChipClick={() => setSettingsOpen(true)}
        canUndo={writeUndoStatus().canUndo}
        canRedo={writeUndoStatus().canRedo}
        onUndo={async () => {
          const sid = sessions.activeSessionId();
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
          const sid = sessions.activeSessionId();
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

      <Sidebar
        sessions={sessions.sessionEntries()}
        activeSessionId={sessions.activeSessionId()}
        onSelect={selectSession}
        onNewSession={handleNewSession}
        workspacePath={workspaceLabel()}
        onWorkspaceChipClick={() => setSettingsOpen(true)}
      />

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
          when={sessions.isFirstRun()}
          fallback={
            <>
              <MessageFeed
                chunks={sessions.chunks()}
                sessionStatus={sessions.activeSessionStatus()}
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
                    sessionId: sessions.activeSessionId(),
                    clearChunks: () => sessions.setChunks([]),
                    compactSession: (sid) => compactAgentSession({ sessionId: sid }),
                    sessionRunning: sessionBusy(),
                    chunksCount: sessions.chunks().length,
                  };
                  return executeSlashCommand(input, ctx);
                }}
                onAppendAssistant={(text: string) => {
                  sessions.setChunks((prev) => [...prev, { kind: "assistant", text }]);
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
                  sessionId: sessions.activeSessionId(),
                  clearChunks: () => sessions.setChunks([]),
                  compactSession: (sid) => compactAgentSession({ sessionId: sid }),
                  sessionRunning: sessionBusy(),
                  chunksCount: sessions.chunks().length,
                };
                return executeSlashCommand(input, ctx);
              }}
              onAppendAssistant={(text: string) => {
                sessions.setChunks((prev) => [...prev, { kind: "assistant", text }]);
              }}
              hero
            />
          </FirstRunPanel>
        </Show>
        <ApprovalOverlay
          approvals={approvals.approvals()}
          onApproveOnce={handleApproveOnce}
          onApproveForSession={handleApproveForSession}
          onApproveForWorkspace={handleApproveForWorkspace}
          onReject={handleReject}
        />
        <UserQuestionOverlay
          questions={approvals.userQuestions()}
          onSubmit={handleUserQuestionSubmit}
          onCancel={handleUserQuestionCancel}
        />
        <SettingsModal
          open={settingsOpen()}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setWorkspaceLabel(loadWorkspacePath().trim());
          }}
          sessionCount={sessions.sessionIds().length}
        />
      </main>

      <Show when={!sessions.isFirstRun()}>
        <ContextPanel
          mcpServers={mcpServers}
          setMcpServers={setMcpServers}
          workspacePath={workspaceLabel}
          sessionPreset={sessionPreset}
          planTimeline={sessions.planTimelineForActiveSession}
        />
      </Show>

      <div class="col-span-full">
        <StatusBar
          copilotBridgeHint={copilotBridgeHint()}
          copilotSuccessFlash={copilotSuccessFlash()}
          onRetryCopilot={isTauri() ? () => runCopilotWarmup(false) : undefined}
          copilotRetryDisabled={sessionBusy()}
        />
      </div>
    </div>
  );
}
