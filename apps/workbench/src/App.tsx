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
  approvalFromToolCall,
  buildApprovalMessages,
  buildRunAgentInput,
  createRelayAgUiAgent,
  eventKey,
  normalizeApproval,
  runEventFromAgUi,
  updateToolCallDraft,
  type RelayAgUiEvent,
  type RelayAgUiToolCallDraft,
} from "./lib/relay-ag-ui";
import type { ApprovalState, RunEvent, RunStatus, StatusResponse } from "./types";

const workspaceStorageKey = "relay.workbench.workspace";
const workspaceHistoryKey = "relay.workbench.workspaceHistory";
const threadStorageKey = "relay.workbench.threadId";
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
  const [assistantText, setAssistantText] = useState("");
  const [raw, setRaw] = useState("");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<RunStatus | "idle">("idle");
  const [currentApproval, setCurrentApproval] = useState<ApprovalState | null>(null);
  const [sendDisabled, setSendDisabled] = useState(false);

  const eventKeysRef = useRef(new Set<string>());
  const eventSequenceRef = useRef(0);
  const streamRef = useRef<Subscription | null>(null);
  const agentRef = useRef<ReturnType<typeof createRelayAgUiAgent> | null>(null);
  const statusRef = useRef<RunStatus | "idle">("idle");
  const runIdRef = useRef<string | null>(null);
  const cancelledRunRef = useRef<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement | null>(null);
  const lastInstructionRef = useRef("");
  const threadIdRef = useRef(loadThreadId());
  const agUiEventsRef = useRef<RelayAgUiEvent[]>([]);
  const activeInputRef = useRef<unknown>(null);
  const toolCallDraftsRef = useRef(new Map<string, RelayAgUiToolCallDraft>());

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

  const closeEventStream = useCallback((abort = true) => {
    if (abort) agentRef.current?.abortRun();
    streamRef.current?.unsubscribe();
    streamRef.current = null;
    agentRef.current = null;
  }, []);

  const setRunChrome = useCallback((status: RunStatus | "idle", runId: string | null) => {
    statusRef.current = status;
    runIdRef.current = runId;
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
    eventSequenceRef.current = 0;
    const deduped: RunEvent[] = [];
    for (const event of nextEvents) {
      const key = eventKey(event);
      if (eventKeysRef.current.has(key)) continue;
      eventKeysRef.current.add(key);
      deduped.push(event);
    }
    setEvents(deduped);
  }, []);

  const setRawSnapshot = useCallback(() => {
    setRaw(JSON.stringify({
      transport: "/agui/relay",
      input: activeInputRef.current,
      events: agUiEventsRef.current,
    }, null, 2));
  }, []);

  const resetRunTranscript = useCallback(() => {
    toolCallDraftsRef.current = new Map();
    agUiEventsRef.current = [];
    activeInputRef.current = null;
    setAssistantText("");
    replaceEvents([]);
  }, [replaceEvents]);

  const applyEventState = useCallback((runId: string, event: RunEvent) => {
    if (event.type === "completed") {
      if (statusRef.current !== "approval_required") {
        setRunChrome("completed", runId);
      }
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

  const consumeAgUiEvent = useCallback((runId: string, event: RelayAgUiEvent) => {
    const enrichedEvent: RelayAgUiEvent = {
      ...event,
      runId,
      sequence: ++eventSequenceRef.current,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };

    agUiEventsRef.current = [...agUiEventsRef.current, enrichedEvent].slice(-200);
    setRawSnapshot();

    if (enrichedEvent.type === "TEXT_MESSAGE_CONTENT" && enrichedEvent.delta) {
      setAssistantText((current) => current + enrichedEvent.delta);
    }

    const draft = updateToolCallDraft(enrichedEvent, toolCallDraftsRef.current);
    if (draft) {
      const approval = approvalFromToolCall(draft);
      if (approval) {
        setCurrentApproval(approval);
        setRunChrome("approval_required", runId);
      }
    }

    const runEvent = runEventFromAgUi(enrichedEvent);
    if (runEvent.type === "completed" && statusRef.current === "approval_required") return;
    const added = appendRunEvent(runEvent);
    if (!added) return;
    applyEventState(runId, runEvent);
    applyAgUiState(enrichedEvent);
  }, [appendRunEvent, applyAgUiState, applyEventState, setRawSnapshot, setRunChrome]);

  const startAgUiRun = useCallback((input: ReturnType<typeof buildRunAgentInput>, resetTranscript: boolean) => {
    closeEventStream();
    cancelledRunRef.current = null;
    if (resetTranscript) resetRunTranscript();
    activeInputRef.current = input;
    setRunChrome("running", input.runId);
    setSendDisabled(false);
    setRawSnapshot();

    const agent = createRelayAgUiAgent(api("/agui/relay"), authHeaders());
    agentRef.current = agent;
    const subscription = agent.run(input).subscribe({
      next: (event) => {
        consumeAgUiEvent(input.runId, event as RelayAgUiEvent);
      },
      error: (error: unknown) => {
        if (cancelledRunRef.current === input.runId) return;
        const detail = error instanceof Error ? error.message : String(error);
        const failureEvent: RunEvent = {
          type: "error",
          message: "AG-UI run failed",
          detail,
          runId: input.runId,
          sequence: ++eventSequenceRef.current,
          timestamp: new Date().toISOString(),
        };
        appendRunEvent(failureEvent);
        setRunChrome("failed", input.runId);
        setRaw(JSON.stringify({ transport: "/agui/relay", error: detail }, null, 2));
      },
      complete: () => {
        streamRef.current = null;
        agentRef.current = null;
        if (runIdRef.current === input.runId && statusRef.current === "running") {
          setRunChrome("completed", input.runId);
        }
      },
    });
    streamRef.current = subscription;
  }, [
    api,
    appendRunEvent,
    authHeaders,
    closeEventStream,
    consumeAgUiEvent,
    resetRunTranscript,
    setRawSnapshot,
    setRunChrome,
  ]);

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

  const cancelRun = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    setSendDisabled(true);
    cancelledRunRef.current = runId;
    closeEventStream(true);
    const event: RunEvent = {
      type: "cancelled",
      message: "Stopped",
      runId,
      sequence: ++eventSequenceRef.current,
      timestamp: new Date().toISOString(),
    };
    appendRunEvent(event);
    setRunChrome("cancelled", runId);
    setSendDisabled(false);
  }, [appendRunEvent, closeEventStream, setRunChrome]);

  const runTask = useCallback(async () => {
    if (statusRef.current === "running") {
      await cancelRun();
      return;
    }

    const userText = instruction.trim();
    if (!userText) return;

    saveWorkspace(workspace, setWorkspaceHistory);
    setCurrentApproval(null);
    lastInstructionRef.current = userText;

    const runId = createRunId("run");
    const input = buildRunAgentInput({
      runId,
      threadId: threadIdRef.current,
      workspace,
      instruction: userText,
    });
    startAgUiRun(input, true);
  }, [cancelRun, instruction, startAgUiRun, workspace]);

  const respondToApproval = useCallback(async (approved: boolean) => {
    const approval = currentApproval;
    if (!approval) return;

    setCurrentApproval(null);
    const parentRunId = currentRunId ?? undefined;
    const runId = createRunId(approved ? "approve" : "reject");
    try {
      const messages = buildApprovalMessages({
        runId,
        userText: lastInstructionRef.current || instruction,
        approval,
        approved,
      });
      const input = buildRunAgentInput({
        runId,
        parentRunId,
        threadId: threadIdRef.current,
        workspace,
        messages,
      });
      startAgUiRun(input, false);
    } catch (error) {
      setRunChrome("failed", parentRunId ?? null);
      appendRunEvent({
        type: "error",
        message: approved ? "承認後の実行に失敗しました" : "却下に失敗しました",
        detail: error instanceof Error ? error.message : String(error),
        runId: parentRunId,
        sequence: ++eventSequenceRef.current,
        timestamp: new Date().toISOString(),
      });
    }
  }, [appendRunEvent, currentApproval, currentRunId, instruction, setRunChrome, startAgUiRun, workspace]);

  useEffect(() => {
    handleRefresh();
    return () => closeEventStream(true);
  }, [closeEventStream, handleRefresh]);

  useEffect(() => {
    const element = instructionRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 132), 320)}px`;
  }, [instruction]);

  const summaryEvent = useMemo(() => {
    const text = assistantText.trim();
    if (text) {
      return {
        type: "final",
        message: "Result",
        detail: text,
      } satisfies RunEvent;
    }
    const finalEvent = [...events].reverse().find((event) => event.type === "final");
    const errorEvent = [...events].reverse().find((event) => event.type === "error");
    return finalEvent ?? (currentStatus === "failed" ? errorEvent : undefined);
  }, [assistantText, currentStatus, events]);

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
            onApprove={() => respondToApproval(true)}
            onReject={() => respondToApproval(false)}
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
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const hidden = !approval || currentStatus !== "approval_required" || !currentRunId;
  const toolCall = approval?.toolCall;
  const target = toolCall ? approvalTarget(toolCall.args) : "";
  const operation = toolCall ? approvalOperation(toolCall.tool, toolCall.args) : "";

  return (
    <Card id="approval" className="approval-panel" hidden={hidden}>
      {toolCall && currentRunId ? (
        <>
          <div className="approval-header">
            <strong>確認が必要です</strong>
            <Badge tone="warning">{toolCall.tool}</Badge>
          </div>
          <p className="approval-copy">許可すると、この操作をローカルワークスペースで実行します。</p>
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
            <Button variant="secondary" type="button" onClick={() => void onReject()}>
              <X size={15} aria-hidden="true" />
              実行しない
            </Button>
            <Button type="button" onClick={() => void onApprove()}>
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
  const display = eventDisplay(event);
  return (
    <li className={`event event-${event.type}`}>
      <span className="event-marker">{display.marker}</span>
      <div>
        <strong>{display.message}</strong>
        {display.detail ? <p>{display.detail}</p> : null}
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

function loadThreadId(): string {
  const existing = localStorage.getItem(threadStorageKey);
  if (existing) return existing;
  const next = createRunId("thread");
  localStorage.setItem(threadStorageKey, next);
  return next;
}

function createRunId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 9);
  return `relay-${prefix}-${Date.now().toString(36)}-${random}`;
}

function compactPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

function approvalTarget(args: Record<string, unknown>): string {
  const value =
    args.filePath ??
    args.file_path ??
    args.path ??
    args.target ??
    args.oldPath ??
    args.old_path ??
    args.command ??
    "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function approvalOperation(tool: string, args: Record<string, unknown>): string {
  const value = args.operation ?? args.command ?? args.action ?? tool;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function eventDisplay(event: RunEvent): { marker: string; message: string; detail?: string } {
  if (event.type === "tool_call_started") {
    return {
      marker: "tool",
      message: `${event.message} を準備しています`,
      detail: compactIdentifier(event.detail),
    };
  }

  if (event.type === "tool_call_completed") {
    return {
      marker: "tool",
      message: "Tool completed",
      detail: summarizeToolResult(event.detail),
    };
  }

  if (event.type === "approval_requested") {
    return {
      marker: "wait",
      message: "Approval requested",
      detail: compactIdentifier(event.detail),
    };
  }

  if (event.type === "completed") {
    return { marker: "done", message: "Done" };
  }

  if (event.type === "cancelled") {
    return { marker: "stop", message: "Stopped" };
  }

  if (event.type === "error") {
    return {
      marker: "error",
      message: "Failed",
      detail: event.detail || event.message,
    };
  }

  if (event.type === "final") {
    return {
      marker: "answer",
      message: "Assistant",
      detail: event.detail,
    };
  }

  if (event.type === "status") {
    if (event.message === "Run started") return { marker: "run", message: "Run started" };
    if (event.message === "Assistant response started") return { marker: "reply", message: "Response started" };
    if (event.message === "Assistant response completed") return { marker: "reply", message: "Response completed" };
    if (event.message === "Tool arguments") return { marker: "tool", message: "Tool arguments ready" };
    if (event.message === "Tool call prepared") {
      return { marker: "tool", message: "Tool call prepared", detail: compactIdentifier(event.detail) };
    }
    if (event.message === "State updated") return { marker: "state", message: "State updated" };
  }

  return {
    marker: shortMarker(event.type),
    message: event.message,
    detail: event.detail,
  };
}

function shortMarker(value: string): string {
  const normalized = value.replaceAll("_", " ");
  if (normalized.length <= 10) return normalized;
  return normalized.split(" ").map((part) => part[0]).join("").slice(0, 8);
}

function compactIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 42) return value;
  return `${value.slice(0, 20)}...${value.slice(-12)}`;
}

function summarizeToolResult(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  try {
    const parsed = JSON.parse(detail) as {
      tool?: unknown;
      success?: unknown;
      summary?: unknown;
      data?: unknown;
      error?: unknown;
    };
    const dciSummary = summarizeDciObservation(parsed);
    if (dciSummary) return dciSummary;
    const parts = [];
    if (typeof parsed.tool === "string") parts.push(parsed.tool);
    if (typeof parsed.summary === "string") parts.push(parsed.summary);
    if (Array.isArray(parsed.data)) parts.push(`${parsed.data.length} item${parsed.data.length === 1 ? "" : "s"}`);
    if (typeof parsed.error === "string") parts.push(parsed.error);
    if (parts.length > 0) return parts.join(" · ");
  } catch {
    // Non-JSON tool results are already bounded upstream.
  }
  return detail.length > 180 ? `${detail.slice(0, 180)}...` : detail;
}

function summarizeDciObservation(parsed: { tool?: unknown; summary?: unknown; data?: unknown }): string | undefined {
  if (!parsed.data || typeof parsed.data !== "object") return undefined;
  const data = parsed.data as {
    schemaVersion?: unknown;
    matches?: unknown;
    displayPath?: unknown;
    anchors?: unknown;
    evidenceState?: unknown;
    truncated?: unknown;
    contextLabels?: unknown;
  };
  if (data.schemaVersion === "RelayGrepObservation.v1") {
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const first = matches[0] as { displayPath?: unknown; lineNumber?: unknown; excerpt?: unknown; contextLabels?: unknown } | undefined;
    const path = typeof first?.displayPath === "string" ? compactPath(first.displayPath) : "";
    const line = typeof first?.lineNumber === "number" ? `:${first.lineNumber}` : "";
    const excerpt = typeof first?.excerpt === "string" ? ` — ${first.excerpt.slice(0, 96)}` : "";
    const labels = Array.isArray(first?.contextLabels)
      ? first.contextLabels.filter((label): label is string => typeof label === "string").slice(0, 3).join(", ")
      : "";
    const labelText = labels ? ` · ${labels}` : "";
    const suffix = data.truncated === true ? " · truncated" : "";
    return `grep · ${matches.length} content match${matches.length === 1 ? "" : "es"}${path ? ` · ${path}${line}` : ""}${labelText}${excerpt}${suffix}`;
  }
  if (data.schemaVersion === "RelayReadObservation.v1") {
    const path = typeof data.displayPath === "string" ? compactPath(data.displayPath) : "";
    const anchors = Array.isArray(data.anchors) ? data.anchors : [];
    const anchor = anchors[0] as { startLine?: unknown; endLine?: unknown } | undefined;
    const lineRange = typeof anchor?.startLine === "number" && typeof anchor?.endLine === "number"
      ? `:${anchor.startLine}-${anchor.endLine}`
      : "";
    const evidence = typeof data.evidenceState === "string" ? data.evidenceState : "read";
    const labels = Array.isArray(data.contextLabels)
      ? data.contextLabels.filter((label): label is string => typeof label === "string").slice(0, 3).join(", ")
      : "";
    const labelText = labels ? ` · ${labels}` : "";
    return `read · ${evidence}${path ? ` · ${path}${lineRange}` : ""}${labelText}`;
  }
  return undefined;
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
