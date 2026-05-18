import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  useDefaultRenderTool,
  useHumanInTheLoop,
  type CopilotChatLabels,
} from "@copilotkit/react-core/v2";
import { Download, ExternalLink, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { createRelayAgUiAgent, relayAgentId } from "./lib/relay-ag-ui";
import type { StatusResponse, WorkspacePickResponse } from "./types";

const workspaceStorageKey = "relay.workbench.workspace";
const workspaceHistoryKey = "relay.workbench.workspaceHistory";
const threadStorageKey = "relay.workbench.threadId";
const workbenchClientStorageKey = "relay.workbench.clientId";
const token = new URLSearchParams(window.location.search).get("token") ?? "";

type ReadinessState = {
  label: "Checking" | "Ready" | "Connecting" | "Sign in needed" | "Local issue" | "Provider error";
  ready: "true" | "partial" | "false" | "pending" | undefined;
  title: string;
  raw: string;
};

const initialReadiness: ReadinessState = {
  label: "Checking",
  ready: undefined,
  title: "",
  raw: "",
};

const approvalRequestSchema = z.object({
  request: z.union([z.string(), z.record(z.unknown())]).optional(),
}).passthrough();

type ApprovalRequestArgs = z.infer<typeof approvalRequestSchema>;

const chatLabels: Partial<CopilotChatLabels> = {
  chatInputPlaceholder: "何をしますか?",
  chatDisclaimerText: "",
  welcomeMessageText: "ローカルのファイル検索、Office編集、コード作成を自然文で依頼できます。",
  modalHeaderTitle: "Relay Agent",
  chatInputToolbarToolsButtonLabel: "ツール",
  chatInputToolbarAddButtonLabel: "追加",
};

export function App() {
  const [workspace, setWorkspace] = useState(() => localStorage.getItem(workspaceStorageKey) ?? "");
  const [workspaceHistory, setWorkspaceHistory] = useState(loadWorkspaceHistory);
  const [workspaceError, setWorkspaceError] = useState("");
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessState>(initialReadiness);
  const [supportBusy, setSupportBusy] = useState(false);
  const threadIdRef = useRef(loadThreadId());

  const api = useCallback((path: string): string => {
    const url = new URL(path, window.location.origin);
    if (token) url.searchParams.set("token", token);
    return url.toString();
  }, []);

  const authHeaders = useCallback((extra: Record<string, string> = {}): Record<string, string> => {
    return token ? { ...extra, "X-Relay-Token": token } : extra;
  }, []);

  const refreshStatus = useCallback(async () => {
    const response = await fetch(api("/api/status"), {
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(`Status failed: ${response.status}`);
    const status = (await response.json()) as StatusResponse;
    const copilot = status.checks.find((check) => check.name === "copilot-cdp");
    const optionalFailures = status.checks.filter((check) => check.required === false && !check.ready);
    const requiredLocalFailure = status.checks.find((check) =>
      check.required !== false && check.name !== "copilot-cdp" && !check.ready
    );
    const raw = JSON.stringify(status, null, 2);
    if (status.ready) {
      setReadiness({
        label: "Ready",
        ready: "true",
        title: optionalFailures.length > 0
          ? `Optional capability unavailable: ${optionalFailures.map((check) => check.name).join(", ")}`
          : "",
        raw,
      });
    } else if (requiredLocalFailure) {
      setReadiness({
        label: "Local issue",
        ready: "false",
        title: requiredLocalFailure.detail,
        raw,
      });
    } else if (copilot?.state === "sign_in_required") {
      setReadiness({
        label: "Sign in needed",
        ready: "partial",
        title: "Open Copilot in Edge and sign in, then retry.",
        raw,
      });
    } else if (copilot?.state === "provider_error") {
      setReadiness({
        label: "Provider error",
        ready: "false",
        title: copilot.detail,
        raw,
      });
    } else {
      setReadiness({
        label: "Connecting",
        ready: "pending",
        title: copilot?.detail ?? "Relay is connecting to Copilot.",
        raw,
      });
    }
  }, [api, authHeaders]);

  const handleRefresh = useCallback(() => {
    void refreshStatus().catch((error) => {
      setReadiness({
        label: "Provider error",
        ready: "false",
        title: error instanceof Error ? error.message : String(error),
        raw: error instanceof Error ? error.message : String(error),
      });
    });
  }, [refreshStatus]);

  useEffect(() => {
    const clientId = loadWorkbenchClientId();
    let closed = false;
    const payload = () => JSON.stringify({ clientId });

    const heartbeat = async () => {
      if (closed) return;
      try {
        await fetch(api("/api/session/heartbeat"), {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: payload(),
        });
      } catch {
        // Readiness polling already surfaces sidecar connectivity failures.
      }
    };

    const closeSession = () => {
      if (closed) return;
      closed = true;
      const body = payload();
      const blob = new Blob([body], { type: "application/json" });
      if (!(typeof navigator.sendBeacon === "function" && navigator.sendBeacon(api("/api/session/closed"), blob))) {
        void fetch(api("/api/session/closed"), {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body,
          keepalive: true,
        }).catch(() => undefined);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void heartbeat();
    };
    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) closeSession();
    };

    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 10_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", closeSession);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", closeSession);
      closeSession();
    };
  }, [api, authHeaders]);

  useEffect(() => {
    handleRefresh();
  }, [handleRefresh]);

  useEffect(() => {
    const pollMs = readiness.ready === "true" ? 30_000 : 2_000;
    const interval = window.setInterval(handleRefresh, pollMs);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") handleRefresh();
    };
    window.addEventListener("focus", handleRefresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleRefresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [handleRefresh, readiness.ready]);

  const chooseWorkspace = useCallback(async () => {
    setIsPickingWorkspace(true);
    setWorkspaceError("");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120_000);
    try {
      const response = await fetch(api("/api/workspace/pick"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ currentPath: workspace }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Workspace picker failed: ${response.status}`);
      const result = (await response.json()) as WorkspacePickResponse;
      if (result.cancelled) return;
      if (result.error) {
        setWorkspaceError(result.error);
        return;
      }
      if (!result.path) {
        setWorkspaceError("Workspace picker did not return a folder.");
        return;
      }
      setWorkspace(result.path);
      saveWorkspace(result.path, setWorkspaceHistory);
    } catch (error) {
      setWorkspaceError(timedOut
        ? "フォルダ選択がタイムアウトしました。もう一度押してください。"
        : error instanceof Error ? error.message : String(error));
    } finally {
      window.clearTimeout(timeout);
      setIsPickingWorkspace(false);
    }
  }, [api, authHeaders, workspace]);

  const openCopilot = useCallback(async () => {
    try {
      await fetch(api("/api/copilot/open"), {
        method: "POST",
        headers: authHeaders(),
      });
      handleRefresh();
    } catch {
      window.open("https://m365.cloud.microsoft/chat", "_blank", "noopener,noreferrer");
    }
  }, [api, authHeaders, handleRefresh]);

  const downloadSupportBundle = useCallback(async () => {
    setSupportBusy(true);
    try {
      const response = await fetch(api("/api/support-bundle"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ includeSensitive: false }),
      });
      if (!response.ok) throw new Error(`Support bundle failed: ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `relay-support-${new Date().toISOString().replaceAll(":", "-")}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setSupportBusy(false);
    }
  }, [api, authHeaders]);

  const agent = useMemo(() =>
    createRelayAgUiAgent({
      url: api("/agui/relay"),
      headers: authHeaders(),
      threadId: threadIdRef.current,
      workspace,
    }), [api, authHeaders, workspace]);

  const compactWorkspace = workspace ? compactPath(workspace) : "未選択";
  const chatReady = readiness.label === "Ready";

  return (
    <CopilotKitProvider
      selfManagedAgents={{ [relayAgentId]: agent }}
      properties={{ workspace, relay_workspace: workspace, relayWorkspace: workspace }}
    >
      <CopilotChatConfigurationProvider
        agentId={relayAgentId}
        threadId={threadIdRef.current}
        hasExplicitThreadId
        labels={chatLabels}
      >
        <RelayChatTools />
        <section className="shell" data-testid="relay-chatbot-shell">
          <header className="topbar">
            <div>
              <p className="eyebrow">Relay Agent</p>
              <h1>Chat</h1>
            </div>
            <button
              className="status-pill"
              id="readiness"
              type="button"
              data-ready={readiness.ready}
              title={readiness.title}
              onClick={handleRefresh}
            >
              {readiness.label}
            </button>
          </header>

          <main className="chat-layout">
            {readiness.label === "Sign in needed" ? (
              <div className="signin-row" role="status">
                <span>Copilot にサインインしてください。</span>
                <button type="button" className="text-button" onClick={() => void openCopilot()}>
                  Open Copilot <ExternalLink size={14} aria-hidden="true" />
                </button>
              </div>
            ) : null}

            <section className="workspace-bar" aria-label="Workspace">
              <div>
                <span className="label">Workspace</span>
                <div
                  id="workspace"
                  className="workspace-chip"
                  title={workspace || "Workspace not selected"}
                  data-empty={workspace ? "false" : "true"}
                >
                  {compactWorkspace}
                </div>
                <input id="workspace-path" type="hidden" value={workspace} readOnly />
              </div>
              <button
                id="workspace-change"
                className="secondary-button"
                type="button"
                disabled={isPickingWorkspace}
                onClick={() => void chooseWorkspace()}
              >
                <FolderOpen size={15} aria-hidden="true" />
                {isPickingWorkspace ? "選択中..." : "フォルダを選択"}
              </button>
            </section>

            {workspaceError ? <p id="workspace-error" className="workspace-error">{workspaceError}</p> : null}

            <div id="workspace-history" className="workspace-history" hidden={workspaceHistory.length === 0}>
              {workspaceHistory.map((item) => (
                <button
                  key={item}
                  type="button"
                  title={item}
                  onClick={() => {
                    setWorkspace(item);
                    saveWorkspace(item, setWorkspaceHistory);
                  }}
                >
                  {compactPath(item)}
                </button>
              ))}
            </div>

            {!workspace ? (
              <section className="empty-chat" aria-label="Workspace required">
                <p>最初に作業フォルダを選択してください。</p>
              </section>
            ) : (
              <section className="chat-card" data-ready={chatReady ? "true" : "false"}>
                <CopilotChat
                  agentId={relayAgentId}
                  threadId={threadIdRef.current}
                  labels={chatLabels}
                  autoScroll="pin-to-bottom"
                  throttleMs={120}
                  input={{ autoFocus: true, showDisclaimer: false, bottomAnchored: true }}
                  welcomeScreen
                  onError={(event) => {
                    const error = "error" in event ? event.error : new Error("Copilot chat error");
                    setReadiness({
                      label: "Provider error",
                      ready: "false",
                      title: error.message,
                      raw: error.stack ?? error.message,
                    });
                  }}
                />
              </section>
            )}

            <details className="details">
              <summary>Support</summary>
              <div className="details-header">
                <span>Redacted diagnostics</span>
                <button
                  className="text-button"
                  type="button"
                  disabled={supportBusy}
                  onClick={() => void downloadSupportBundle()}
                >
                  <Download size={14} aria-hidden="true" />
                  Export
                </button>
              </div>
              <pre id="raw">{readiness.raw}</pre>
            </details>
          </main>
        </section>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}

function RelayChatTools() {
  useDefaultRenderTool({
    render: ({ name, status, result }) => (
      <div className="tool-card">
        <span>{name}</span>
        <strong>{toolStatusLabel(status)}</strong>
        {result ? <p>{compactToolResult(result)}</p> : null}
      </div>
    ),
  }, []);

  useHumanInTheLoop<ApprovalRequestArgs>({
    name: "request_approval",
    description: "Approve or reject a Relay local mutation.",
    parameters: approvalRequestSchema,
    render: ApprovalRequestCard,
  }, []);

  return null;
}

function ApprovalRequestCard({
  args,
  status,
  respond,
}: {
  args: Partial<ApprovalRequestArgs> | ApprovalRequestArgs;
  status: "inProgress" | "executing" | "complete";
  result: string | undefined;
  respond: ((result: unknown) => Promise<void>) | undefined;
  name: string;
  description: string;
}) {
  const request = parseApprovalRequest(args.request);
  const target = approvalTarget(request);
  const operation = approvalOperation(request);
  const completed = status === "complete";

  return (
    <section className="approval-card" aria-live="polite">
      <div className="approval-heading">
        <strong>{completed ? "確認済み" : "実行前の確認"}</strong>
        <span>{operation || "local action"}</span>
      </div>
      <dl>
        <dt>対象</dt>
        <dd>{target || "-"}</dd>
        <dt>操作</dt>
        <dd>{operation || "-"}</dd>
      </dl>
      {!completed && respond ? (
        <div className="approval-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void respond({ approved: false, reason: "rejected in Relay Workbench" })}
          >
            実行しない
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void respond({ approved: true, reason: "approved in Relay Workbench" })}
          >
            実行する
          </button>
        </div>
      ) : null}
    </section>
  );
}

function saveWorkspace(workspace: string, setWorkspaceHistory: (history: string[]) => void): void {
  const value = workspace.trim();
  if (!value) return;
  localStorage.setItem(workspaceStorageKey, value);
  const history = loadWorkspaceHistory().filter((item) => item !== value);
  const nextHistory = [value, ...history].slice(0, 4);
  localStorage.setItem(workspaceHistoryKey, JSON.stringify(nextHistory));
  setWorkspaceHistory(nextHistory);
}

function loadWorkspaceHistory(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(workspaceHistoryKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function loadThreadId(): string {
  const existing = localStorage.getItem(threadStorageKey);
  if (existing) return existing;
  const next = createId("thread");
  localStorage.setItem(threadStorageKey, next);
  return next;
}

function loadWorkbenchClientId(): string {
  const next = createId("client");
  try {
    const existing = sessionStorage.getItem(workbenchClientStorageKey);
    if (existing) return existing;
    sessionStorage.setItem(workbenchClientStorageKey, next);
  } catch {
    // Stale ids expire server-side if sessionStorage is unavailable.
  }
  return next;
}

function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 9);
  return `relay-${prefix}-${Date.now().toString(36)}-${random}`;
}

function compactPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

function parseApprovalRequest(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : { raw: value };
    } catch {
      return { raw: value };
    }
  }
  return isRecord(value) ? value : {};
}

function approvalTarget(request: Record<string, unknown>): string {
  const functionArguments = parseFunctionArguments(request.functionArguments);
  const value =
    functionArguments.filePath ??
    functionArguments.file_path ??
    functionArguments.path ??
    functionArguments.target ??
    functionArguments.oldPath ??
    functionArguments.old_path ??
    request.filePath ??
    request.file_path ??
    request.path ??
    request.target ??
    "";
  return typeof value === "string" ? compactPath(value) : JSON.stringify(value);
}

function approvalOperation(request: Record<string, unknown>): string {
  const functionArguments = parseFunctionArguments(request.functionArguments);
  const value =
    functionArguments.operation ??
    functionArguments.command ??
    functionArguments.action ??
    request.functionName ??
    request.operation ??
    request.command ??
    request.action ??
    "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseFunctionArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

function compactToolResult(result: unknown): string {
  const parsed = typeof result === "string" ? tryParseJson(result) : result;
  if (isRecord(parsed)) {
    const summary = parsed.summary;
    if (typeof summary === "string" && summary.trim()) return summary.trim();

    const tool = typeof parsed.tool === "string" ? parsed.tool : "";
    const success = typeof parsed.success === "boolean" ? parsed.success : undefined;
    if (tool) return success === false ? `${tool} failed` : `${tool} completed`;
  }
  if (Array.isArray(parsed)) return `${parsed.length} items`;

  const text = typeof result === "string" ? result : String(result);
  if (looksLikeJson(text)) return "Completed";
  return text.length <= 220 ? text : `${text.slice(0, 220)}...`;
}

function toolStatusLabel(status: string): string {
  return {
    inProgress: "準備中",
    executing: "実行中",
    complete: "完了",
  }[status] ?? status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}
