import { invoke } from "@tauri-apps/api/core";
import { listen, type Event } from "@tauri-apps/api/event";
import { get, writable, type Readable } from "svelte/store";

const MAX_FEED_ENTRIES = 200;

export type AgentContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean };

export type AgentMessage = {
  role: "user" | "assistant";
  content: AgentContentBlock[];
};

export type AgentSessionHistory = {
  sessionId: string;
  running: boolean;
  messages: AgentMessage[];
};

export type AgentSessionStatus =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "error"
  | "cancelled";

export type AgentSessionState = {
  sessionId: string | null;
  running: boolean;
  status: AgentSessionStatus;
  messages: AgentMessage[];
  lastStopReason: string | null;
  lastError: string | null;
};

export type AgentPendingApproval = {
  sessionId: string;
  approvalId: string;
  toolName: string;
  description: string;
  target?: string;
  input: unknown;
};

export type AgentApprovalState = {
  pending: AgentPendingApproval | null;
};

export type AgentFeedEntryType =
  | "session_started"
  | "tool_start"
  | "tool_result"
  | "approval_needed"
  | "turn_complete"
  | "error";

export type AgentFeedEntry = {
  id: string;
  sessionId: string;
  type: AgentFeedEntryType;
  title: string;
  detail?: string;
  toolName?: string;
  toolUseId?: string;
  isError?: boolean;
  timestamp: string;
};

export type StartAgentRequest = {
  goal: string;
  files?: string[];
  cwd?: string;
  browserSettings?: {
    cdpPort: number;
    autoLaunchEdge: boolean;
    timeoutMs: number;
  };
  maxTurns?: number;
};

type StartAgentPayload = {
  sessionId: string;
  goal: string;
  files: string[];
};

type ToolStartPayload = {
  sessionId: string;
  toolUseId: string;
  toolName: string;
};

type ToolResultPayload = {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  content: string;
  isError: boolean;
};

type ApprovalNeededPayload = {
  sessionId: string;
  approvalId: string;
  toolName: string;
  description: string;
  target?: string;
  input: unknown;
};

type TurnCompletePayload = {
  sessionId: string;
  stopReason: string;
  assistantMessage: string;
  messageCount: number;
};

type ErrorPayload = {
  sessionId: string;
  error: string;
  cancelled: boolean;
};

type TauriEventName =
  | "agent:tool_start"
  | "agent:tool_result"
  | "agent:approval_needed"
  | "agent:turn_complete"
  | "agent:error";

type ListenFn = <TPayload>(
  eventName: TauriEventName,
  handler: (event: Event<TPayload>) => void
) => Promise<() => void>;

type InvokeFn = <TResponse>(
  command: string,
  args?: Record<string, unknown>
) => Promise<TResponse>;

type AgentUiDependencies = {
  invoke: InvokeFn;
  listen: ListenFn;
};

type AgentUiController = {
  feedStore: Readable<AgentFeedEntry[]>;
  approvalStore: Readable<AgentApprovalState>;
  sessionStore: Readable<AgentSessionState>;
  bind: () => Promise<void>;
  dispose: () => void;
  startAgent: (request: StartAgentRequest) => Promise<string>;
  respondApproval: (approvalId: string, approved: boolean) => Promise<void>;
  cancelAgent: () => Promise<void>;
  refreshSessionHistory: (sessionId?: string) => Promise<AgentSessionHistory | null>;
  reset: () => void;
};

const DEFAULT_SESSION_STATE: AgentSessionState = {
  sessionId: null,
  running: false,
  status: "idle",
  messages: [],
  lastStopReason: null,
  lastError: null
};

const DEFAULT_APPROVAL_STATE: AgentApprovalState = {
  pending: null
};

const DEFAULT_DEPS: AgentUiDependencies = {
  invoke: (command, args) => invoke(command, args),
  listen
};

function nextEntryId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "Unknown agent UI error.";
}

function createFeedStore() {
  const store = writable<AgentFeedEntry[]>([]);

  return {
    subscribe: store.subscribe,
    push(entry: Omit<AgentFeedEntry, "id" | "timestamp">) {
      store.update((entries) => {
        const next = [
          ...entries,
          {
            ...entry,
            id: nextEntryId(),
            timestamp: new Date().toISOString()
          }
        ];
        return next.length > MAX_FEED_ENTRIES
          ? next.slice(-MAX_FEED_ENTRIES)
          : next;
      });
    },
    reset() {
      store.set([]);
    }
  };
}

export function createAgentUi(
  deps: AgentUiDependencies = DEFAULT_DEPS
): AgentUiController {
  const feedStore = createFeedStore();
  const approvalStore = writable<AgentApprovalState>(DEFAULT_APPROVAL_STATE);
  const sessionStore = writable<AgentSessionState>(DEFAULT_SESSION_STATE);

  let activeSessionId: string | null = null;
  let unlistenFns: Array<() => void> = [];
  let bindPromise: Promise<void> | null = null;

  function isActiveSession(sessionId: string): boolean {
    return activeSessionId === sessionId;
  }

  function pushStartFeed(payload: StartAgentPayload): void {
    feedStore.push({
      sessionId: payload.sessionId,
      type: "session_started",
      title: "エージェントを開始しました",
      detail: payload.files.length
        ? `${payload.goal}\n${payload.files.join("\n")}`
        : payload.goal
    });
  }

  function reset(): void {
    activeSessionId = null;
    feedStore.reset();
    approvalStore.set(DEFAULT_APPROVAL_STATE);
    sessionStore.set(DEFAULT_SESSION_STATE);
  }

  async function refreshSessionHistory(
    sessionId = activeSessionId ?? undefined
  ): Promise<AgentSessionHistory | null> {
    if (!sessionId) {
      return null;
    }

    const history = await deps.invoke<AgentSessionHistory>("get_session_history", {
      request: { sessionId }
    });

    if (!isActiveSession(history.sessionId)) {
      return history;
    }

    sessionStore.update((state) => ({
      ...state,
      sessionId: history.sessionId,
      running: history.running,
      messages: history.messages
    }));

    return history;
  }

  async function handleToolStart(payload: ToolStartPayload): Promise<void> {
    if (!isActiveSession(payload.sessionId)) {
      return;
    }

    feedStore.push({
      sessionId: payload.sessionId,
      type: "tool_start",
      title: `ツール開始: ${payload.toolName}`,
      detail: payload.toolUseId,
      toolName: payload.toolName,
      toolUseId: payload.toolUseId
    });
  }

  async function handleToolResult(payload: ToolResultPayload): Promise<void> {
    if (!isActiveSession(payload.sessionId)) {
      return;
    }

    feedStore.push({
      sessionId: payload.sessionId,
      type: "tool_result",
      title: payload.isError
        ? `ツール失敗: ${payload.toolName}`
        : `ツール完了: ${payload.toolName}`,
      detail: payload.content,
      toolName: payload.toolName,
      toolUseId: payload.toolUseId,
      isError: payload.isError
    });
    await refreshSessionHistory(payload.sessionId);
  }

  async function handleApprovalNeeded(payload: ApprovalNeededPayload): Promise<void> {
    if (!isActiveSession(payload.sessionId)) {
      return;
    }

    approvalStore.set({ pending: payload });
    sessionStore.update((state) => ({
      ...state,
      status: "awaiting_approval"
    }));
    feedStore.push({
      sessionId: payload.sessionId,
      type: "approval_needed",
      title: `承認待ち: ${payload.toolName}`,
      detail: payload.target ?? payload.description,
      toolName: payload.toolName
    });
  }

  async function handleTurnComplete(payload: TurnCompletePayload): Promise<void> {
    if (!isActiveSession(payload.sessionId)) {
      return;
    }

    approvalStore.set(DEFAULT_APPROVAL_STATE);
    sessionStore.update((state) => ({
      ...state,
      running: false,
      status: "completed",
      lastStopReason: payload.stopReason
    }));
    feedStore.push({
      sessionId: payload.sessionId,
      type: "turn_complete",
      title: "エージェントが完了しました",
      detail: payload.assistantMessage
    });
    await refreshSessionHistory(payload.sessionId);
  }

  async function handleError(payload: ErrorPayload): Promise<void> {
    if (!isActiveSession(payload.sessionId)) {
      return;
    }

    approvalStore.set(DEFAULT_APPROVAL_STATE);
    sessionStore.update((state) => ({
      ...state,
      running: false,
      status: payload.cancelled ? "cancelled" : "error",
      lastError: payload.error
    }));
    feedStore.push({
      sessionId: payload.sessionId,
      type: "error",
      title: payload.cancelled ? "エージェントをキャンセルしました" : "エージェントでエラーが発生しました",
      detail: payload.error,
      isError: true
    });
    await refreshSessionHistory(payload.sessionId);
  }

  async function bind(): Promise<void> {
    if (unlistenFns.length > 0) {
      return;
    }

    if (bindPromise) {
      return bindPromise;
    }

    bindPromise = (async () => {
      const callbacks = await Promise.all([
        deps.listen<ToolStartPayload>("agent:tool_start", (event) => {
          void handleToolStart(event.payload);
        }),
        deps.listen<ToolResultPayload>("agent:tool_result", (event) => {
          void handleToolResult(event.payload);
        }),
        deps.listen<ApprovalNeededPayload>("agent:approval_needed", (event) => {
          void handleApprovalNeeded(event.payload);
        }),
        deps.listen<TurnCompletePayload>("agent:turn_complete", (event) => {
          void handleTurnComplete(event.payload);
        }),
        deps.listen<ErrorPayload>("agent:error", (event) => {
          void handleError(event.payload);
        })
      ]);

      unlistenFns = callbacks;
      bindPromise = null;
    })();

    return bindPromise;
  }

  function dispose(): void {
    for (const unlisten of unlistenFns) {
      unlisten();
    }
    unlistenFns = [];
    bindPromise = null;
  }

  async function startAgent(request: StartAgentRequest): Promise<string> {
    await bind();
    reset();

    const normalizedRequest = {
      goal: request.goal,
      files: request.files ?? [],
      cwd: request.cwd,
      browserSettings: request.browserSettings,
      maxTurns: request.maxTurns
    };

    try {
      const sessionId = await deps.invoke<string>("start_agent", {
        request: normalizedRequest
      });

      activeSessionId = sessionId;
      sessionStore.set({
        sessionId,
        running: true,
        status: "running",
        messages: [],
        lastStopReason: null,
        lastError: null
      });
      pushStartFeed({
        sessionId,
        goal: normalizedRequest.goal,
        files: normalizedRequest.files
      });
      await refreshSessionHistory(sessionId);

      return sessionId;
    } catch (error) {
      const message = normalizeErrorMessage(error);
      sessionStore.set({
        ...DEFAULT_SESSION_STATE,
        status: "error",
        lastError: message
      });
      throw new Error(message);
    }
  }

  async function respondApproval(
    approvalId: string,
    approved: boolean
  ): Promise<void> {
    if (!activeSessionId) {
      throw new Error("No active agent session.");
    }

    await deps.invoke("respond_approval", {
      request: {
        sessionId: activeSessionId,
        approvalId,
        approved
      }
    });

    approvalStore.set(DEFAULT_APPROVAL_STATE);
    sessionStore.update((state) => ({
      ...state,
      status: approved ? "running" : state.status
    }));
  }

  async function cancelAgent(): Promise<void> {
    if (!activeSessionId) {
      return;
    }

    await deps.invoke("cancel_agent", {
      request: { sessionId: activeSessionId }
    });
  }

  return {
    feedStore: { subscribe: feedStore.subscribe },
    approvalStore: { subscribe: approvalStore.subscribe },
    sessionStore: { subscribe: sessionStore.subscribe },
    bind,
    dispose,
    startAgent,
    respondApproval,
    cancelAgent,
    refreshSessionHistory,
    reset
  };
}

const defaultAgentUi = createAgentUi();

export const feedStore = defaultAgentUi.feedStore;
export const approvalStore = defaultAgentUi.approvalStore;
export const sessionStore = defaultAgentUi.sessionStore;
export const bindAgentUi = defaultAgentUi.bind;
export const disposeAgentUi = defaultAgentUi.dispose;
export const startAgent = defaultAgentUi.startAgent;
export const respondApproval = defaultAgentUi.respondApproval;
export const cancelAgent = defaultAgentUi.cancelAgent;
export const refreshSessionHistory = defaultAgentUi.refreshSessionHistory;
export const resetAgentUi = defaultAgentUi.reset;

export function getActiveSessionState(): AgentSessionState {
  return get(sessionStore);
}
