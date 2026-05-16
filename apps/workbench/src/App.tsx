import { Activity, Check, RefreshCw, Send, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Subscription } from "rxjs";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import {
  approvalFromEvents,
  eventKey,
  normalizeApproval,
  RelayEventSourceAgent,
  runEventFromAgUi,
  type RelayAgUiEvent,
} from "./lib/relay-ag-ui";
import type { ApprovalState, RunEvent, RunResponse, RunStatus, StatusResponse } from "./types";

const workspaceStorageKey = "relay.workbench.workspace";
const workspaceHistoryKey = "relay.workbench.workspaceHistory";
const token = new URLSearchParams(window.location.search).get("token") ?? "";

type ReadinessState = {
  label: "Checking" | "Ready" | "Limited" | "Not ready";
  ready: "true" | "partial" | "false" | undefined;
  title: string;
};

const initialReadiness: ReadinessState = {
  label: "Checking",
  ready: undefined,
  title: "",
};

export function App() {
  const [workspace, setWorkspace] = useState(() => localStorage.getItem(workspaceStorageKey) ?? "");
  const [workspaceHistory, setWorkspaceHistory] = useState(loadWorkspaceHistory);
  const [instruction, setInstruction] = useState("");
  const [readiness, setReadiness] = useState<ReadinessState>(initialReadiness);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [raw, setRaw] = useState("");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<RunStatus | "idle">("idle");
  const [currentApproval, setCurrentApproval] = useState<ApprovalState | null>(null);
  const [sendDisabled, setSendDisabled] = useState(false);

  const eventKeysRef = useRef(new Set<string>());
  const streamRef = useRef<Subscription | null>(null);
  const statusRef = useRef<RunStatus | "idle">("idle");
  const runIdRef = useRef<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    statusRef.current = currentStatus;
    runIdRef.current = currentRunId;
  }, [currentRunId, currentStatus]);

  const api = useCallback((path: string): string => {
    const url = new URL(path, window.location.origin);
    if (token) url.searchParams.set("token", token);
    return url.toString();
  }, []);

  const authHeaders = useCallback((extra: Record<string, string> = {}): Record<string, string> => {
    return token ? { ...extra, "X-Relay-Token": token } : extra;
  }, []);

  const closeEventStream = useCallback(() => {
    streamRef.current?.unsubscribe();
    streamRef.current = null;
  }, []);

  const setRunChrome = useCallback((status: RunStatus | "idle", runId: string | null) => {
    setCurrentStatus(status);
    setCurrentRunId(runId);
    if (status !== "approval_required") {
      setCurrentApproval(null);
    }
  }, []);

  const appendRunEvent = useCallback((event: RunEvent): boolean => {
    const key = eventKey(event);
    if (eventKeysRef.current.has(key)) return false;
    eventKeysRef.current.add(key);
    setEvents((current) => [...current, event]);
    return true;
  }, []);

  const replaceEvents = useCallback((nextEvents: readonly RunEvent[]) => {
    eventKeysRef.current = new Set();
    const deduped: RunEvent[] = [];
    for (const event of nextEvents) {
      const key = eventKey(event);
      if (eventKeysRef.current.has(key)) continue;
      eventKeysRef.current.add(key);
      deduped.push(event);
    }
    setEvents(deduped);
  }, []);

  const renderRun = useCallback((result: RunResponse) => {
    setRunChrome(result.status, result.runId);
    replaceEvents(result.events);
    setCurrentApproval(approvalFromEvents(result.events, result.status));
    setRaw(JSON.stringify(result, null, 2));
  }, [replaceEvents, setRunChrome]);

  const loadRun = useCallback(async (runId: string) => {
    const response = await fetch(api(`/api/runs/${encodeURIComponent(runId)}`), {
      headers: authHeaders(),
    });
    if (!response.ok) return;
    const result = (await response.json()) as RunResponse;
    renderRun(result);
    if (result.status !== "running") closeEventStream();
  }, [api, authHeaders, closeEventStream, renderRun]);

  const applyEventState = useCallback((runId: string, event: RunEvent) => {
    if (event.type === "completed" || event.type === "final") {
      setRunChrome("completed", runId);
    } else if (event.type === "error") {
      setRunChrome("failed", runId);
    } else if (event.type === "cancelled") {
      setRunChrome("cancelled", runId);
    } else if (event.type === "approval_requested") {
      setRunChrome("approval_required", runId);
    } else if (event.type === "approval_resolved") {
      setCurrentApproval(null);
    }
  }, [setRunChrome]);

  const applyAgUiState = useCallback((event: RelayAgUiEvent) => {
    if (!event.state || !Object.prototype.hasOwnProperty.call(event.state, "approval")) return;
    setCurrentApproval(normalizeApproval(event.state.approval));
  }, []);

  const connectEvents = useCallback((runId: string) => {
    closeEventStream();
    const agent = new RelayEventSourceAgent((id) => api(`/api/runs/${encodeURIComponent(id)}/agui-events`));
    const subscription = agent.run({
      runId,
      threadId: "relay-workbench",
      state: {},
      messages: [],
      tools: [],
      context: [],
    }).subscribe({
      next: (event) => {
        const agUiEvent = event as RelayAgUiEvent;
        const runEvent = runEventFromAgUi(agUiEvent);
        const added = appendRunEvent(runEvent);
        if (!added) return;
        applyEventState(runId, runEvent);
        applyAgUiState(agUiEvent);
        if (
          runEvent.type === "final" ||
          runEvent.type === "completed" ||
          runEvent.type === "error" ||
          runEvent.type === "approval_requested"
        ) {
          window.setTimeout(() => void loadRun(runId), 120);
        }
      },
      error: (error: unknown) => {
        appendRunEvent({
          type: "error",
          message: "AG-UI stream failed",
          detail: error instanceof Error ? error.message : String(error),
        });
        if (runIdRef.current === runId && statusRef.current === "running") {
          window.setTimeout(() => void loadRun(runId), 180);
        }
      },
      complete: () => {
        if (runIdRef.current === runId && statusRef.current === "running") {
          window.setTimeout(() => void loadRun(runId), 180);
        }
      },
    });
    streamRef.current = subscription;
  }, [api, appendRunEvent, applyAgUiState, applyEventState, closeEventStream, loadRun]);

  const refreshStatus = useCallback(async () => {
    const response = await fetch(api("/api/status"), {
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error(`Status failed: ${response.status}`);
    const status = (await response.json()) as StatusResponse;
    const copilotReady = status.checks.some((check) => check.name === "copilot-cdp" && check.ready);
    const optionalFailures = status.checks.filter((check) => check.required === false && !check.ready);
    if (status.ready) {
      setReadiness({
        label: "Ready",
        ready: "true",
        title: optionalFailures.length > 0
          ? `Optional capability unavailable: ${optionalFailures.map((check) => check.name).join(", ")}`
          : "",
      });
    } else if (copilotReady) {
      setReadiness({
        label: "Limited",
        ready: "partial",
        title: "Some required local execution capability is unavailable.",
      });
    } else {
      setReadiness({
        label: "Not ready",
        ready: "false",
        title: "Copilot transport is not available.",
      });
    }
    setRaw(JSON.stringify(status, null, 2));
  }, [api, authHeaders]);

  const handleRefresh = useCallback(() => {
    void refreshStatus().catch((error) => {
      setReadiness({
        label: "Not ready",
        ready: "false",
        title: error instanceof Error ? error.message : String(error),
      });
      setRaw(error instanceof Error ? error.message : String(error));
    });
  }, [refreshStatus]);

  const runTask = useCallback(async () => {
    if (statusRef.current === "running" && runIdRef.current) {
      await cancelRun(runIdRef.current);
      return;
    }

    closeEventStream();
    setCurrentApproval(null);
    setRunChrome("running", null);
    replaceEvents([]);
    saveWorkspace(workspace, setWorkspaceHistory);

    try {
      const response = await fetch(api("/api/runs"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          instruction,
          workspace,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as RunResponse;
      renderRun(result);
      if (result.status === "running") {
        connectEvents(result.runId);
      }
    } catch (error) {
      setRunChrome("failed", null);
      replaceEvents([{
        type: "error",
        message: "完了できませんでした",
        detail: error instanceof Error ? error.message : String(error),
      }]);
    }
  }, [
    api,
    authHeaders,
    closeEventStream,
    connectEvents,
    instruction,
    renderRun,
    replaceEvents,
    setRunChrome,
    workspace,
  ]);

  const approveRun = useCallback(async (runId: string) => {
    setCurrentApproval(null);
    setRunChrome("running", runId);
    try {
      const response = await fetch(api(`/api/runs/${encodeURIComponent(runId)}/approve`), {
        method: "POST",
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as RunResponse;
      renderRun(result);
      if (result.status === "running") connectEvents(result.runId);
    } catch (error) {
      setRunChrome("failed", runId);
      appendRunEvent({
        type: "error",
        message: "承認後の実行に失敗しました",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [api, appendRunEvent, authHeaders, connectEvents, renderRun, setRunChrome]);

  const rejectRun = useCallback(async (runId: string) => {
    setCurrentApproval(null);
    try {
      const response = await fetch(api(`/api/runs/${encodeURIComponent(runId)}/reject`), {
        method: "POST",
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as RunResponse;
      renderRun(result);
    } catch (error) {
      setRunChrome("failed", runId);
      appendRunEvent({
        type: "error",
        message: "却下に失敗しました",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [api, appendRunEvent, authHeaders, renderRun, setRunChrome]);

  const cancelRun = useCallback(async (runId: string) => {
    setSendDisabled(true);
    try {
      const response = await fetch(api(`/api/runs/${encodeURIComponent(runId)}/cancel`), {
        method: "POST",
        headers: authHeaders(),
      });
      if (response.ok) {
        const result = (await response.json()) as RunResponse;
        renderRun(result);
      }
    } finally {
      setSendDisabled(false);
    }
  }, [api, authHeaders, renderRun]);

  useEffect(() => {
    handleRefresh();
    return closeEventStream;
  }, [closeEventStream, handleRefresh]);

  useEffect(() => {
    const element = instructionRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 132), 320)}px`;
  }, [instruction]);

  const summaryEvent = useMemo(() => {
    const finalEvent = [...events].reverse().find((event) => event.type === "final" || event.type === "completed");
    const errorEvent = [...events].reverse().find((event) => event.type === "error");
    return finalEvent ?? (currentStatus === "failed" ? errorEvent : undefined);
  }, [currentStatus, events]);

  const compactWorkspace = workspace ? compactPath(workspace) : "";
  const running = currentStatus === "running";

  return (
    <TooltipProvider>
      <section className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Relay Agent</p>
            <h1>Workbench</h1>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            {readiness.title ? <TooltipContent>{readiness.title}</TooltipContent> : null}
          </Tooltip>
        </header>

        <main className="workspace-layout">
          <Card className="composer-panel" aria-label="Task composer">
            <div className="field-group">
              <div className="field-row">
                <label className="field-label" htmlFor="workspace">Workspace</label>
                <span id="workspace-state" className="field-state">{compactWorkspace}</span>
              </div>
              <Input
                id="workspace"
                autoComplete="off"
                spellCheck={false}
                placeholder="/path/to/workspace"
                value={workspace}
                onChange={(event) => setWorkspace(event.currentTarget.value)}
              />
              <div id="workspace-history" className="workspace-history" hidden={workspaceHistory.length === 0}>
                {workspaceHistory.map((item) => (
                  <button
                    key={item}
                    type="button"
                    title={item}
                    onClick={() => setWorkspace(item)}
                  >
                    {compactPath(item)}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-group">
              <div className="field-row">
                <label className="field-label" htmlFor="instruction">Task</label>
                <span id="run-id" className="field-state">{currentRunId ?? ""}</span>
              </div>
              <Textarea
                id="instruction"
                ref={instructionRef}
                rows={3}
                placeholder="部品売上に関するファイルを探して"
                value={instruction}
                onChange={(event) => setInstruction(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void runTask();
                  }
                }}
              />
            </div>

            <div className="actions">
              <Button id="refresh" variant="secondary" type="button" disabled={running} onClick={handleRefresh}>
                <RefreshCw size={15} aria-hidden="true" />
                更新
              </Button>
              <Button
                id="send"
                type="button"
                data-running={running ? "true" : "false"}
                disabled={sendDisabled}
                onClick={() => void runTask()}
              >
                {running ? <Square size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
                {running ? "停止" : "送信"}
              </Button>
            </div>
          </Card>

          <Card
            id="summary"
            className="summary-panel"
            hidden={!summaryEvent}
            data-kind={summaryEvent?.type}
          >
            <p id="summary-label" className="summary-label">
              {summaryEvent && (summaryEvent.type === "final" || summaryEvent.type === "completed") ? "Result" : "Error"}
            </p>
            <div id="summary-text" className="summary-text">{summaryEvent?.detail || summaryEvent?.message || ""}</div>
          </Card>

          <ApprovalPanel
            approval={currentApproval}
            currentRunId={currentRunId}
            currentStatus={currentStatus}
            onApprove={approveRun}
            onReject={rejectRun}
          />

          <Card className="run-panel" aria-live="polite">
            <div className="run-header">
              <h2>
                <Activity size={16} aria-hidden="true" />
                Activity
              </h2>
              <span id="run-state" className="run-state" data-status={currentStatus}>
                {currentStatus === "approval_required" ? "Waiting" : statusLabel(currentStatus)}
              </span>
            </div>
            <ol id="events" className="events">
              {events.length === 0 ? <EmptyActivity /> : events.map((event) => (
                <EventItem key={eventKey(event)} event={event} />
              ))}
            </ol>
          </Card>

          <details className="details">
            <summary>Details</summary>
            <pre id="raw">{raw}</pre>
          </details>
        </main>
      </section>
    </TooltipProvider>
  );
}

function ApprovalPanel({
  approval,
  currentRunId,
  currentStatus,
  onApprove,
  onReject,
}: {
  approval: ApprovalState | null;
  currentRunId: string | null;
  currentStatus: RunStatus | "idle";
  onApprove: (runId: string) => Promise<void>;
  onReject: (runId: string) => Promise<void>;
}) {
  const hidden = !approval || currentStatus !== "approval_required" || !currentRunId;
  const toolCall = approval?.toolCall;
  const target = toolCall ? approvalTarget(toolCall.args) : "";
  const operation = toolCall ? String(toolCall.args.operation ?? toolCall.args.command ?? toolCall.tool) : "";

  return (
    <Card id="approval" className="approval-panel" hidden={hidden}>
      {toolCall && currentRunId ? (
        <>
          <div className="approval-header">
            <strong>確認が必要です</strong>
            <Badge tone="warning">{toolCall.tool}</Badge>
          </div>
          <dl className="approval-facts">
            <dt>操作</dt>
            <dd>{operation || "-"}</dd>
            <dt>対象</dt>
            <dd>{target || "-"}</dd>
          </dl>
          <details className="approval-raw">
            <summary>Raw</summary>
            <pre>{JSON.stringify(toolCall, null, 2)}</pre>
          </details>
          <div className="approval-actions">
            <Button variant="secondary" type="button" onClick={() => void onReject(currentRunId)}>
              <X size={15} aria-hidden="true" />
              実行しない
            </Button>
            <Button type="button" onClick={() => void onApprove(currentRunId)}>
              <Check size={15} aria-hidden="true" />
              許可して続行
            </Button>
          </div>
        </>
      ) : null}
    </Card>
  );
}

function EventItem({ event }: { event: RunEvent }) {
  return (
    <li className={`event event-${event.type}`}>
      <span className="event-marker">{event.type}</span>
      <div>
        <strong>{event.message}</strong>
        {event.detail ? <p>{event.detail}</p> : null}
      </div>
    </li>
  );
}

function EmptyActivity() {
  return (
    <li className="event event-empty">
      <span className="event-marker">idle</span>
      <div>
        <strong>まだ実行していません</strong>
      </div>
    </li>
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

function compactPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

function approvalTarget(args: Record<string, unknown>): string {
  const value = args.filePath ?? args.path ?? args.target ?? args.command ?? "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function statusLabel(status: RunStatus | "idle"): string {
  return {
    idle: "Idle",
    running: "Running",
    completed: "Done",
    failed: "Failed",
    approval_required: "Waiting",
    cancelled: "Stopped",
  }[status];
}
