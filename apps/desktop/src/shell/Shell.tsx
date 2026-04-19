/// <reference types="vite/client" />
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { truncatePromptPreview } from "../session/session-display";
import {
  cancelAgent,
  chunksFromHistory,
  compactAgentSession,
  continueAgentSession,
  getSessionHistory,
  getSessionWriteUndoStatus,
  listWorkspaceSlashCommands,
  mcpListServers,
  normalizeAssistantVisibleText,
  redoSessionWrite,
  respondApproval,
  respondUserQuestion,
  startAgent,
  undoSessionWrite,
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
import { FeedCrumb } from "../components/FeedCrumb";
import { MessageFeed } from "../components/MessageFeed";
import { RailPanel } from "../components/RailPanel";
import { SettingsModal, type ShellSettingsDraft } from "../components/SettingsModal";
import { Sidebar } from "../components/Sidebar";
import type { SessionStatusSnapshot } from "../components/shell-types";
import {
  loadAlwaysOnTop,
  loadBrowserSettings,
  loadMaxTurns,
  loadWorkspacePath,
  saveAlwaysOnTop,
  saveBrowserSettings,
  saveMaxTurns,
  saveWorkspacePath,
} from "../lib/settings-storage";
import { pickWorkspaceFolder } from "../lib/workspace-picker";
import { buildPlanTimelineFromUiChunks } from "../context/todo-write-parse";
import { createSessionStore } from "./sessionStore";
import { createApprovalStore } from "./approvalStore";
import { useCopilotWarmup } from "./useCopilotWarmup";
import { useAgentEvents } from "./useAgentEvents";

const DEV_FIRST_RUN_SEND_EVENT = "relay:dev-first-run-send";
const DEV_CONFIGURE_EVENT = "relay:dev-configure";
const DEV_APPROVE_LATEST_EVENT = "relay:dev-approve-latest";
const DEV_APPROVE_LATEST_SESSION_EVENT = "relay:dev-approve-latest-session";
const DEV_APPROVE_LATEST_WORKSPACE_EVENT = "relay:dev-approve-latest-workspace";
const DEV_REJECT_LATEST_EVENT = "relay:dev-reject-latest";

type DevFirstRunSendPayload = {
  text?: string;
};

type DevConfigurePayload = {
  workspacePath?: string | null;
  cdpPort?: number | null;
  autoLaunchEdge?: boolean | null;
  timeoutMs?: number | null;
  maxTurns?: number | null;
  alwaysOnTop?: boolean | null;
  persistSettings?: boolean | null;
  rerunWarmup?: boolean | null;
};

type DevApprovalPayload = {
  mode?: "once" | "session" | "workspace" | "reject";
};

type ShellDrawer = "none" | "sessions" | "context";

const WIDE_BREAKPOINT_PX = 900;
const RAIL_BREAKPOINT_PX = 1200;

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

async function applyAlwaysOnTopSetting(enabled: boolean) {
  if (!isTauri()) return;
  try {
    await getCurrentWindow().setAlwaysOnTop(enabled);
  } catch (error) {
    console.error("[Shell] setAlwaysOnTop failed", error);
  }
}

export default function Shell(): JSX.Element {
  const sessions = createSessionStore();
  const approvals = createApprovalStore();
  const [inlineChunksBySession, setInlineChunksBySession] = createSignal<
    Record<string, Extract<UiChunk, { kind: "approval_request" | "user_question" }>[]>
  >({});
  const [sessionError, setSessionError] = createSignal<string | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [workspaceLabel, setWorkspaceLabel] = createSignal(loadWorkspacePath().trim());
  const [browserSettings, setBrowserSettings] = createSignal(loadBrowserSettings());
  const [maxTurns, setMaxTurns] = createSignal(loadMaxTurns());
  const [alwaysOnTop, setAlwaysOnTop] = createSignal(loadAlwaysOnTop());
  const [writeUndoStatus, setWriteUndoStatus] = createSignal({ canUndo: false, canRedo: false });
  const [activeDrawer, setActiveDrawer] = createSignal<ShellDrawer>("none");
  const [showFirstRunGate, setShowFirstRunGate] = createSignal(false);
  const { copilotState, runCopilotWarmup } = useCopilotWarmup(browserSettings);

  const mergeChunksWithInline = (sessionId: string, baseChunks: UiChunk[]): UiChunk[] => {
    const inlineChunks = inlineChunksBySession()[sessionId] ?? [];
    if (inlineChunks.length === 0) return baseChunks;
    return [...baseChunks, ...inlineChunks];
  };

  const appendInlineChunk = (
    sessionId: string,
    chunk: Extract<UiChunk, { kind: "approval_request" | "user_question" }>,
  ) => {
    setInlineChunksBySession((prev) => {
      const current = prev[sessionId] ?? [];
      const exists = current.some((entry) =>
        chunk.kind === "approval_request"
          ? entry.kind === "approval_request" && entry.approvalId === chunk.approvalId
          : entry.kind === "user_question" && entry.questionId === chunk.questionId,
      );
      if (exists) return prev;
      return { ...prev, [sessionId]: [...current, chunk] };
    });
    if (sessions.activeSessionId() !== sessionId) return;
    sessions.setChunks((prev) => {
      const exists = prev.some((entry) =>
        chunk.kind === "approval_request"
          ? entry.kind === "approval_request" && entry.approvalId === chunk.approvalId
          : entry.kind === "user_question" && entry.questionId === chunk.questionId,
      );
      if (exists) return prev;
      return [...prev, chunk];
    });
  };

  const updateInlineChunk = (
    sessionId: string,
    predicate: (chunk: Extract<UiChunk, { kind: "approval_request" | "user_question" }>) => boolean,
    updater: (chunk: Extract<UiChunk, { kind: "approval_request" | "user_question" }>) => Extract<
      UiChunk,
      { kind: "approval_request" | "user_question" }
    >,
  ) => {
    setInlineChunksBySession((prev) => {
      const current = prev[sessionId];
      if (!current?.length) return prev;
      let changed = false;
      const next = current.map((chunk) => {
        if (!predicate(chunk)) return chunk;
        changed = true;
        return updater(chunk);
      });
      if (!changed) return prev;
      return { ...prev, [sessionId]: next };
    });
    if (sessions.activeSessionId() !== sessionId) return;
    sessions.setChunks((prev) => {
      let changed = false;
      const next = prev.map((chunk) => {
        if (
          (chunk.kind !== "approval_request" && chunk.kind !== "user_question") ||
          !predicate(chunk)
        ) {
          return chunk;
        }
        changed = true;
        return updater(chunk);
      });
      return changed ? next : prev;
    });
  };

  const markApprovalStatus = (
    sessionId: string,
    approvalId: string,
    status: Extract<UiChunk, { kind: "approval_request" }>["status"],
  ) => {
    updateInlineChunk(
      sessionId,
      (chunk) => chunk.kind === "approval_request" && chunk.approvalId === approvalId,
      (chunk) => (chunk.kind === "approval_request" ? { ...chunk, status } : chunk),
    );
  };

  const markUserQuestionStatus = (
    sessionId: string,
    questionId: string,
    status: Extract<UiChunk, { kind: "user_question" }>["status"],
  ) => {
    updateInlineChunk(
      sessionId,
      (chunk) => chunk.kind === "user_question" && chunk.questionId === questionId,
      (chunk) => (chunk.kind === "user_question" ? { ...chunk, status } : chunk),
    );
  };

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

  createEffect(() => {
    void applyAlwaysOnTopSetting(alwaysOnTop());
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
    const sid = sessions.activeSessionId();
    if (!sid) {
      setWriteUndoStatus({ canUndo: false, canRedo: false });
      return;
    }
    if ((sessions.statusBySession()[sid]?.phase ?? "idle") !== "idle") return;
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

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeDrawer() !== "none") {
        setActiveDrawer("none");
        return;
      }
      const isAccelerator = event.metaKey || event.ctrlKey;
      if (!isAccelerator || event.shiftKey || event.altKey) return;
      const key = event.key;
      if (key.toLowerCase() === "n") {
        event.preventDefault();
        handleNewSession();
        return;
      }
      if (key === "[" || key === "]") {
        const ids = sessions.sessionIds();
        if (ids.length === 0) return;
        event.preventDefault();
        const currentId = sessions.activeSessionId();
        const index = currentId ? ids.indexOf(currentId) : -1;
        const step = key === "]" ? 1 : -1;
        const nextIndex = index === -1
          ? (step === 1 ? 0 : ids.length - 1)
          : (index + step + ids.length) % ids.length;
        const nextId = ids[nextIndex];
        if (nextId && nextId !== currentId) selectSession(nextId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
    if (!isTauri()) return;
    let disposed = false;
    let sendUnlisten: (() => void) | null = null;
    let configureUnlisten: (() => void) | null = null;
    let approveUnlisten: (() => void) | null = null;
    let approveSessionUnlisten: (() => void) | null = null;
    let approveWorkspaceUnlisten: (() => void) | null = null;
    let rejectUnlisten: (() => void) | null = null;
    void listen<DevFirstRunSendPayload>(DEV_FIRST_RUN_SEND_EVENT, (event) => {
      const text = event.payload?.text?.trim();
      if (!text) return;
      void handleSend(text);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      sendUnlisten = fn;
    });
    void listen<DevConfigurePayload>(DEV_CONFIGURE_EVENT, (event) => {
      const payload = event.payload ?? {};
      const persistSettings = payload.persistSettings === true;
      if (typeof payload.workspacePath === "string") {
        const next = payload.workspacePath.trim();
        setWorkspaceLabel(next);
        if (persistSettings) saveWorkspacePath(next);
      }
      if (
        typeof payload.cdpPort === "number" ||
        typeof payload.autoLaunchEdge === "boolean" ||
        typeof payload.timeoutMs === "number"
      ) {
        const current = browserSettings();
        const next = {
          cdpPort:
            typeof payload.cdpPort === "number" && payload.cdpPort > 0 ? payload.cdpPort : current.cdpPort,
          autoLaunchEdge:
            typeof payload.autoLaunchEdge === "boolean" ? payload.autoLaunchEdge : current.autoLaunchEdge,
          timeoutMs:
            typeof payload.timeoutMs === "number" && payload.timeoutMs > 0 ? payload.timeoutMs : current.timeoutMs,
        };
        setBrowserSettings(next);
        if (persistSettings) saveBrowserSettings(next);
      }
      if (typeof payload.maxTurns === "number" && payload.maxTurns > 0) {
        setMaxTurns(payload.maxTurns);
        if (persistSettings) saveMaxTurns(payload.maxTurns);
      }
      if (typeof payload.alwaysOnTop === "boolean") {
        setAlwaysOnTop(payload.alwaysOnTop);
        if (persistSettings) saveAlwaysOnTop(payload.alwaysOnTop);
      }
      if (payload.rerunWarmup !== false) {
        runCopilotWarmup(true);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      configureUnlisten = fn;
    });
    void listen<DevApprovalPayload>(DEV_APPROVE_LATEST_EVENT, () => {
      const approval = approvals.approvals()[0];
      if (!approval) return;
      void handleApproveOnce(approval.sessionId, approval.approvalId);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      approveUnlisten = fn;
    });
    void listen<DevApprovalPayload>(DEV_APPROVE_LATEST_SESSION_EVENT, () => {
      const approval = approvals.approvals()[0];
      if (!approval) return;
      void handleApproveForSession(approval.sessionId, approval.approvalId);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      approveSessionUnlisten = fn;
    });
    void listen<DevApprovalPayload>(DEV_APPROVE_LATEST_WORKSPACE_EVENT, () => {
      const approval = approvals.approvals()[0];
      if (!approval || !approval.workspaceCwdConfigured) return;
      void handleApproveForWorkspace(approval.sessionId, approval.approvalId);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      approveWorkspaceUnlisten = fn;
    });
    void listen<DevApprovalPayload>(DEV_REJECT_LATEST_EVENT, () => {
      const approval = approvals.approvals()[0];
      if (!approval) return;
      void handleReject(approval.sessionId, approval.approvalId);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      rejectUnlisten = fn;
    });
    onCleanup(() => {
      disposed = true;
      sendUnlisten?.();
      configureUnlisten?.();
      approveUnlisten?.();
      approveSessionUnlisten?.();
      approveWorkspaceUnlisten?.();
      rejectUnlisten?.();
    });
  });

  const sessionBusy = createMemo(() => sessions.activeSessionStatus().phase !== "idle");
  const firstRunProjectReady = createMemo(() => workspaceLabel().trim().length > 0);
  const firstRunCopilotReady = createMemo(
    () => copilotState().result?.connected || copilotState().status === "ready",
  );
  const firstRunCanStart = createMemo(() => firstRunProjectReady() && firstRunCopilotReady());
  const firstRunMissingProject = createMemo(() => sessions.isFirstRun() && !firstRunProjectReady());
  const firstRunMissingCopilot = createMemo(() => sessions.isFirstRun() && !firstRunCopilotReady());
  const showFirstRunRequirements = createMemo(
    () => showFirstRunGate() && (firstRunMissingProject() || firstRunMissingCopilot()),
  );

  createEffect(() => {
    if (!showFirstRunGate()) return;
    if (!sessions.isFirstRun() || firstRunCanStart()) {
      setShowFirstRunGate(false);
    }
  });

  const reloadHistory = async (
    sessionId: string,
    opts?: { fallbackAssistantText?: string; afterTurnComplete?: boolean },
  ) => {
    try {
      const res = await getSessionHistory({ sessionId });
      let next = chunksFromHistory(res.messages);
      const fb = normalizeAssistantVisibleText(opts?.fallbackAssistantText ?? "");
      const hasAssistantText = next.some((c) => c.kind === "assistant" && c.text.trim().length > 0);
      const historyAlreadyHasFallback = fb
        ? next.some(
            (chunk) =>
              chunk.kind === "assistant" && normalizeAssistantVisibleText(chunk.text) === fb,
          )
        : false;
      if (!hasAssistantText && fb && !historyAlreadyHasFallback) {
        next = [...next, { kind: "assistant" as const, text: fb }];
      }
      next = mergeChunksWithInline(sessionId, next);
      sessions.setPlanBySession((prev) => ({
        ...prev,
        [sessionId]: buildPlanTimelineFromUiChunks(next),
      }));
      const nextStatus: SessionStatusSnapshot = opts?.afterTurnComplete || !res.running
        ? { phase: "idle" }
        : (sessions.statusBySession()[sessionId] ?? { phase: "running" });
      sessions.setStatusBySession((prev) => ({ ...prev, [sessionId]: nextStatus }));
      if (sessions.activeSessionId() === sessionId) {
        sessions.setChunks(next);
        if (nextStatus.phase === "idle") setSessionError(null);
      }
    } catch (err) {
      console.error("[IPC] load history failed", err);
      if (sessions.activeSessionId() !== sessionId) return;
      const fb = normalizeAssistantVisibleText(opts?.fallbackAssistantText ?? "");
      const activeAlreadyHasFallback = fb
        ? sessions
            .chunks()
            .some(
              (chunk) =>
                chunk.kind === "assistant" && normalizeAssistantVisibleText(chunk.text) === fb,
            )
        : false;
      if (fb && !activeAlreadyHasFallback) {
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
    appendInlineChunk,
    setSessionError,
    reloadHistory,
  });

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    setSessionError(null);
    if (sessions.isFirstRun() && !firstRunCanStart()) {
      setShowFirstRunGate(true);
      return false;
    }

    approvals.clearPending();

    const prevChunks = sessions.chunks();
    const activeId = sessions.activeSessionId();
    const canContinue = Boolean(activeId && sessions.activeSessionStatus().phase === "idle");

    sessions.setChunks((prev) => [...prev, { kind: "user" as const, text: trimmed }]);

    try {
      if (canContinue && activeId) {
        await continueAgentSession({ sessionId: activeId, message: trimmed });
        sessions.setStatusBySession((prev) => ({ ...prev, [activeId]: { phase: "running" } }));
        sessions.setHasStartedConversation(true);
        return true;
      }

      const sessionId = await startAgent({
        goal: trimmed,
        files: [],
        cwd: workspaceLabel().trim() || null,
        maxTurns: maxTurns(),
        browserSettings: browserSettings(),
      });
      sessions.setActiveSessionId(sessionId);
      sessions.setSessionIds((prev) => (prev.includes(sessionId) ? prev : [...prev, sessionId]));
      sessions.setSessionMeta((meta) => ({
        ...meta,
        [sessionId]: {
          createdAt: Date.now(),
          preview: truncatePromptPreview(trimmed, 52),
        },
      }));
      sessions.setStatusBySession((prev) => ({ ...prev, [sessionId]: { phase: "running" } }));
      sessions.setHasStartedConversation(true);
      return true;
    } catch (err) {
      sessions.setChunks(prevChunks);
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
      return false;
    }
  };

  const handleApproveOnce = async (sessionId: string, approvalId: string) => {
    await respondApproval({ sessionId, approvalId, approved: true, rememberForSession: false });
    markApprovalStatus(sessionId, approvalId, "approved");
    approvals.removeApproval(approvalId);
  };

  const handleApproveForSession = async (sessionId: string, approvalId: string) => {
    await respondApproval({ sessionId, approvalId, approved: true, rememberForSession: true });
    markApprovalStatus(sessionId, approvalId, "approved");
    approvals.removeApproval(approvalId);
  };

  const handleApproveForWorkspace = async (sessionId: string, approvalId: string) => {
    await respondApproval({
      sessionId,
      approvalId,
      approved: true,
      rememberForSession: false,
      rememberForWorkspace: true,
    });
    markApprovalStatus(sessionId, approvalId, "approved");
    approvals.removeApproval(approvalId);
  };

  const handleReject = async (sessionId: string, approvalId: string) => {
    await respondApproval({ sessionId, approvalId, approved: false });
    markApprovalStatus(sessionId, approvalId, "rejected");
    approvals.removeApproval(approvalId);
  };

  const handleUserQuestionSubmit = async (sessionId: string, questionId: string, answer: string) => {
    if (!answer) return;
    try {
      await respondUserQuestion({ sessionId, questionId, answer });
      markUserQuestionStatus(sessionId, questionId, "answered");
      approvals.removeQuestion(questionId);
    } catch (err) {
      console.error("[IPC] respond_user_question failed", err);
    }
  };

  const handleUserQuestionCancel = async (sessionId: string, questionId: string) => {
    try {
      await respondUserQuestion({ sessionId, questionId, answer: "" });
      markUserQuestionStatus(sessionId, questionId, "cancelled");
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
    setActiveDrawer("none");
    setShowFirstRunGate(false);
    sessions.setActiveSessionId(id);
    sessions.setHasStartedConversation(true);
    setSessionError(null);
    void reloadHistory(id);
  };

  const handleNewSession = () => {
    setActiveDrawer("none");
    setShowFirstRunGate(false);
    sessions.setActiveSessionId(null);
    sessions.setChunks([]);
    setSessionError(null);
    approvals.clearPending();
    setWriteUndoStatus({ canUndo: false, canRedo: false });
  };

  const applySettings = (settings: ShellSettingsDraft) => {
    setWorkspaceLabel(settings.workspacePath);
    setBrowserSettings(settings.browserSettings);
    setMaxTurns(settings.maxTurns);
    setAlwaysOnTop(settings.alwaysOnTop);
  };

  const openSettings = () => {
    setActiveDrawer("none");
    setSettingsOpen(true);
  };

  const handleChooseProject = async () => {
    try {
      const selected = await pickWorkspaceFolder(workspaceLabel());
      if (selected) {
        const next = selected.trim();
        setWorkspaceLabel(next);
        saveWorkspacePath(next);
        return;
      }
    } catch (error) {
      console.error("[Shell] workspace dialog failed", error);
      openSettings();
      return;
    }
    if (!isTauri()) openSettings();
  };

  const toggleDrawer = (drawer: Exclude<ShellDrawer, "none">) => {
    setActiveDrawer((current) => (current === drawer ? "none" : drawer));
  };

  const runSlashCommand = (input: string) => {
    const ctx: SlashCommandContext = {
      sessionId: sessions.activeSessionId(),
      clearChunks: () => sessions.setChunks([]),
      compactSession: (sid) => compactAgentSession({ sessionId: sid }),
      sessionRunning: sessionBusy(),
      chunksCount: sessions.chunks().length,
    };
    return executeSlashCommand(input, ctx);
  };

  const onUndoAction = async () => {
    const sid = sessions.activeSessionId();
    if (!sid) return;
    try {
      await undoSessionWrite({ sessionId: sid });
      await refreshWriteUndoStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
    }
  };

  const onRedoAction = async () => {
    const sid = sessions.activeSessionId();
    if (!sid) return;
    try {
      await redoSessionWrite({ sessionId: sid });
      await refreshWriteUndoStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
    }
  };

  return (
    <div
      classList={{
        "ra-shell": true,
        "ra-shell--first-run": sessions.isFirstRun(),
        "ra-shell--sidebar-open": activeDrawer() === "sessions",
        "ra-shell--rail-open": activeDrawer() === "context",
      }}
    >
      <aside
        class="ra-shell-sidebar"
        aria-label="Chats"
        data-ra-shell-drawer="sessions"
      >
        <Sidebar
          sessions={sessions.sessionEntries()}
          activeSessionId={sessions.activeSessionId()}
          onSelect={selectSession}
          onNewSession={handleNewSession}
          workspacePath={workspaceLabel()}
          onWorkspaceChipClick={openSettings}
          onOpenSettings={openSettings}
        />
      </aside>

      <main class="ra-shell-main">
        <FeedCrumb
          sessionStatus={sessions.activeSessionStatus()}
          workspacePath={workspaceLabel}
          onOpenSettings={openSettings}
          onToggleSidebar={() => toggleDrawer("sessions")}
          onToggleRail={() => toggleDrawer("context")}
          chatsOpen={activeDrawer() === "sessions"}
          contextOpen={activeDrawer() === "context"}
        />

        <Show when={sessionError()}>
          <div
            role="alert"
            data-ra-session-error
            class="ra-session-error"
          >
            <p class="ra-type-title-sm text-[var(--ra-text-primary)]">Couldn&apos;t complete that request</p>
            <p class={`mt-0.5 ra-type-body-sans text-[var(--ra-red)] whitespace-pre-wrap break-words`}>
              {sessionError()}
            </p>
          </div>
        </Show>

        <MessageFeed
          chunks={sessions.chunks()}
          sessionStatus={sessions.activeSessionStatus()}
          workspacePath={workspaceLabel}
          firstRun={sessions.isFirstRun()}
          copilotState={copilotState()}
          showFirstRunRequirements={showFirstRunRequirements()}
          missingProject={firstRunMissingProject()}
          missingCopilot={firstRunMissingCopilot()}
          onChooseProject={() => void handleChooseProject()}
          onReconnectCopilot={() => runCopilotWarmup(false)}
          onApproveOnce={handleApproveOnce}
          onApproveForSession={handleApproveForSession}
          onApproveForWorkspace={handleApproveForWorkspace}
          onReject={handleReject}
          onSubmitUserQuestion={handleUserQuestionSubmit}
          onCancelUserQuestion={handleUserQuestionCancel}
        />
        <Composer
          onSend={handleSend}
          disabled={sessionBusy()}
          running={sessionBusy()}
          onCancel={handleCancel}
          onSlashCommand={runSlashCommand}
          onAppendAssistant={(text: string) => {
            sessions.setChunks((prev) => [...prev, { kind: "assistant", text }]);
          }}
          hero={sessions.isFirstRun()}
          autoFocus={!settingsOpen()}
          disabledReason={null}
        />

        <ApprovalOverlay
          enabled={false}
          approvals={approvals.approvals()}
          onApproveOnce={handleApproveOnce}
          onApproveForSession={handleApproveForSession}
          onApproveForWorkspace={handleApproveForWorkspace}
          onReject={handleReject}
        />
        <UserQuestionOverlay
          enabled={false}
          questions={approvals.userQuestions()}
          onSubmit={handleUserQuestionSubmit}
          onCancel={handleUserQuestionCancel}
        />
        <SettingsModal
          open={settingsOpen()}
          onClose={() => setSettingsOpen(false)}
          onApply={applySettings}
          copilotState={copilotState()}
          onReconnectCopilot={() => runCopilotWarmup(false)}
        />
      </main>

      <RailPanel
        mcpServers={mcpServers}
        setMcpServers={setMcpServers}
        workspacePath={workspaceLabel}
        planTimeline={sessions.planTimelineForActiveSession}
        maxTurns={maxTurns}
        canUndo={writeUndoStatus().canUndo}
        canRedo={writeUndoStatus().canRedo}
        onUndo={() => void onUndoAction()}
        onRedo={() => void onRedoAction()}
      />

      <Show when={activeDrawer() !== "none"}>
        <button
          type="button"
          class="ra-shell-drawer-backdrop"
          aria-label="Close panel"
          onClick={() => setActiveDrawer("none")}
        />
      </Show>
    </div>
  );
}

// Export breakpoints for other modules (used in CSS as documented constants)
export { WIDE_BREAKPOINT_PX, RAIL_BREAKPOINT_PX };
