import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  FolderOpen,
  Paperclip,
  RotateCw,
  Send,
  Server,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StatusResponse } from "./types";

const token = new URLSearchParams(window.location.search).get("token") ?? "";
const sessionStorageKey = "relay.bridgeWorkbench.clientId";

type ReadinessState = {
  ready: boolean;
  label: string;
  detail: string;
  raw: string;
};

type BridgeHealthResponse = {
  schemaVersion: "RelayCodexAppServerBridgeHealth.v1";
  configured: boolean;
  ready: boolean;
  state: string;
  detail: string;
  command?: string | null;
};

type BridgeSessionResponse = {
  schemaVersion: "RelayCodexAppServerBridgeSession.v1";
  sessionId: string;
  appServerThreadId: string;
  workArea?: string | null;
};

type BridgeTurnResponse = {
  schemaVersion: "RelayCodexAppServerBridgeTurn.v1";
  turnId: string;
  sessionId: string;
  appServerTurnId: string;
  eventUrl: string;
};

type WorkspacePickResponse = {
  path?: string | null;
  displayPath?: string | null;
  exists?: boolean;
  cancelled?: boolean;
  error?: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ActivityItem = {
  id: string;
  event: string;
  summary: string;
};

type BridgeAttachment = {
  schemaVersion: "RelayCodexAppServerBridgeAttachment.v1";
  attachmentId: string;
  fileName: string;
  path: string;
  mediaType?: string | null;
  size: number;
  sha256: string;
  source: string;
  createdAt: string;
};

type BridgeApproval = {
  schemaVersion: "RelayCodexAppServerBridgeApproval.v1";
  approvalId: string;
  turnId: string;
  appServerTurnId: string;
  toolCallId: string;
  toolName: string;
  summary: string;
  args: Record<string, unknown>;
  createdAt: string;
};

const initialReadiness: ReadinessState = {
  ready: false,
  label: "Checking",
  detail: "Relay Core と Codex app-server bridge の状態を確認しています。",
  raw: "",
};

export function App() {
  const [readiness, setReadiness] = useState<ReadinessState>(initialReadiness);
  const [bridge, setBridge] = useState<BridgeHealthResponse | null>(null);
  const [workspace, setWorkspace] = useState("");
  const [session, setSession] = useState<BridgeSessionResponse | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [attachments, setAttachments] = useState<BridgeAttachment[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<BridgeApproval[]>([]);
  const [running, setRunning] = useState(false);
  const [currentTurn, setCurrentTurn] = useState<BridgeTurnResponse | null>(null);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [supportBusy, setSupportBusy] = useState(false);
  const streamAbort = useRef<AbortController | null>(null);

  const api = useCallback((path: string): string => {
    const url = new URL(path, window.location.origin);
    if (token) url.searchParams.set("token", token);
    return url.toString();
  }, []);

  const authHeaders = useCallback((extra: Record<string, string> = {}): Record<string, string> => {
    return token ? { ...extra, "X-Relay-Token": token } : extra;
  }, []);

  const refreshStatus = useCallback(async () => {
    const [healthResponse, bridgeResponse] = await Promise.all([
      fetch(api("/health"), { headers: authHeaders() }),
      fetch(api("/bridge/health"), { headers: authHeaders() }),
    ]);
    if (!healthResponse.ok) throw new Error(`Relay Core status failed: ${healthResponse.status}`);
    if (!bridgeResponse.ok) throw new Error(`Relay bridge status failed: ${bridgeResponse.status}`);

    const status = (await healthResponse.json()) as StatusResponse;
    const bridgeStatus = (await bridgeResponse.json()) as BridgeHealthResponse;
    const requiredIssue = status.checks.find((check) => check.required !== false && !check.ready);
    const raw = JSON.stringify({ relayCore: status, codexAppServerBridge: bridgeStatus }, null, 2);
    const ready = status.ready && (bridgeStatus.ready || bridgeStatus.configured);
    const label = status.ready
      ? bridgeStatus.ready
        ? "Ready"
        : bridgeStatus.configured
          ? "Bridge starting"
          : "Bridge pending"
      : requiredIssue?.state === "sign_in_required"
        ? "Sign in needed"
        : "Not ready";
    const detail = !status.ready
      ? requiredIssue?.detail ?? "Relay Core の必須チェックが完了していません。"
      : bridgeStatus.detail;

    setReadiness({ ready, label, detail, raw });
    setBridge(bridgeStatus);
  }, [api, authHeaders]);

  useEffect(() => {
    const run = () => void refreshStatus().catch((reason) => {
      setReadiness({
        ready: false,
        label: "Not ready",
        detail: reason instanceof Error ? reason.message : String(reason),
        raw: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
      });
    });
    run();
    const timer = window.setInterval(run, readiness.ready ? 30_000 : 3_000);
    window.addEventListener("focus", run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [readiness.ready, refreshStatus]);

  useEffect(() => {
    const clientId = loadClientId();
    let closed = false;
    const body = () => JSON.stringify({ clientId });
    const heartbeat = () => {
      if (closed) return;
      void fetch(api("/api/session/heartbeat"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: body(),
      }).catch(() => undefined);
    };
    const close = () => {
      if (closed) return;
      closed = true;
      void fetch(api("/api/session/closed"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: body(),
        keepalive: true,
      }).catch(() => undefined);
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 10_000);
    window.addEventListener("pagehide", close);
    window.addEventListener("beforeunload", close);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", close);
      window.removeEventListener("beforeunload", close);
      close();
    };
  }, [api, authHeaders]);

  const copyText = useCallback(async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1800);
  }, []);

  const pickWorkspace = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(api("/api/workspace/pick"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ currentPath: workspace || null }),
      });
      if (!response.ok) throw new Error(`Workspace picker failed: ${response.status}`);
      const result = (await response.json()) as WorkspacePickResponse;
      if (!result.cancelled && result.path) {
        setWorkspace(result.path);
        setSession(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [api, authHeaders, workspace]);

  const stageFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("files", file, file.name));
    try {
      const response = await fetch(api("/bridge/attachments"), {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!response.ok) throw new Error(`Attachment staging failed: ${response.status} ${await response.text()}`);
      const result = await response.json() as { attachments?: BridgeAttachment[] };
      setAttachments((items) => [...items, ...(result.attachments ?? [])]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [api, authHeaders]);

  const removeAttachment = useCallback(async (attachmentId: string) => {
    setAttachments((items) => items.filter((item) => item.attachmentId !== attachmentId));
    try {
      await fetch(api(`/bridge/attachments/${attachmentId}`), {
        method: "DELETE",
        headers: authHeaders(),
      });
    } catch {
      // Attachment cleanup is best-effort from the UI; the sidecar owns retention cleanup.
    }
  }, [api, authHeaders]);

  const ensureSession = useCallback(async (): Promise<BridgeSessionResponse> => {
    if (session && (session.workArea ?? "") === (workspace || "")) {
      return session;
    }
    const response = await fetch(api("/bridge/sessions"), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        workArea: workspace || null,
        ephemeral: false,
      }),
    });
    if (!response.ok) throw new Error(`Bridge session failed: ${response.status} ${await response.text()}`);
    const nextSession = (await response.json()) as BridgeSessionResponse;
    setSession(nextSession);
    return nextSession;
  }, [api, authHeaders, session, workspace]);

  const handleSseBlock = useCallback((block: string, assistantMessageId: string) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message";
    const dataText = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    let payload: unknown = null;
    try {
      payload = dataText ? JSON.parse(dataText) : null;
    } catch {
      payload = dataText;
    }
    const summary = summarizeBridgeEvent(event, payload);
    setActivity((items) => [...items.slice(-39), { id: crypto.randomUUID(), event, summary }]);
    if (event === "approval/requested" && isBridgeApproval(payload)) {
      setApprovalRequests((items) => [...items.filter((item) => item.approvalId !== payload.approvalId), payload]);
    }
    if (event === "approval/resolved" && typeof payload === "object" && payload !== null && "approvalId" in payload) {
      const approvalId = String((payload as { approvalId?: unknown }).approvalId ?? "");
      setApprovalRequests((items) => items.filter((item) => item.approvalId !== approvalId));
    }
    const delta = extractTextDelta(payload);
    if (delta && event.toLowerCase().includes("delta")) {
      setMessages((items) => items.map((item) =>
        item.id === assistantMessageId ? { ...item, text: item.text + delta } : item,
      ));
    } else if (delta) {
      setMessages((items) => items.map((item) =>
        item.id === assistantMessageId && !item.text ? { ...item, text: delta } : item,
      ));
    }
  }, []);

  const resolveApproval = useCallback(async (approvalId: string, approved: boolean) => {
    setError("");
    try {
      const response = await fetch(api(`/bridge/approvals/${approvalId}`), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ approved }),
      });
      if (!response.ok) throw new Error(`Approval failed: ${response.status} ${await response.text()}`);
      setApprovalRequests((items) => items.filter((item) => item.approvalId !== approvalId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [api, authHeaders]);

  const streamTurnEvents = useCallback(async (
    turn: BridgeTurnResponse,
    assistantMessageId: string,
    signal: AbortSignal,
  ) => {
    const response = await fetch(api(turn.eventUrl), {
      headers: authHeaders(),
      signal,
    });
    if (!response.ok) throw new Error(`Bridge event stream failed: ${response.status} ${await response.text()}`);
    if (!response.body) throw new Error("Bridge event stream did not return a readable body.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        handleSseBlock(part, assistantMessageId);
      }
    }
    if (buffer.trim()) {
      handleSseBlock(buffer, assistantMessageId);
    }
  }, [api, authHeaders, handleSseBlock]);

  const sendTurn = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || running) return;
    setError("");
    setInput("");
    setRunning(true);
    setActivity([]);
    setApprovalRequests([]);
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", text: prompt };
    const assistantMessage: ChatMessage = { id: crypto.randomUUID(), role: "assistant", text: "" };
    setMessages((items) => [...items, userMessage, assistantMessage]);

    const abort = new AbortController();
    streamAbort.current = abort;
    try {
      const activeSession = await ensureSession();
      const turnResponse = await fetch(api(`/bridge/sessions/${activeSession.sessionId}/turns`), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          input: prompt,
          workArea: workspace || null,
          attachmentIds: attachments.map((item) => item.attachmentId),
        }),
        signal: abort.signal,
      });
      if (!turnResponse.ok) throw new Error(`Bridge turn failed: ${turnResponse.status} ${await turnResponse.text()}`);
      const turn = (await turnResponse.json()) as BridgeTurnResponse;
      setCurrentTurn(turn);
      await streamTurnEvents(turn, assistantMessage.id, abort.signal);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        setMessages((items) => items.map((item) =>
          item.id === assistantMessage.id ? { ...item, text: `実行できませんでした: ${message}` } : item,
        ));
      }
    } finally {
      streamAbort.current = null;
      setCurrentTurn(null);
      setRunning(false);
      void refreshStatus().catch(() => undefined);
    }
  }, [api, attachments, authHeaders, ensureSession, input, refreshStatus, running, streamTurnEvents, workspace]);

  const stopTurn = useCallback(async () => {
    streamAbort.current?.abort();
    if (!currentTurn) {
      setRunning(false);
      return;
    }
    try {
      await fetch(api(`/bridge/turns/${currentTurn.turnId}/cancel`), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
    } catch {
      // Cancellation is best-effort from the UI; the bridge records process state.
    } finally {
      setRunning(false);
    }
  }, [api, authHeaders, currentTurn]);

  const downloadSupportBundle = useCallback(async () => {
    setSupportBusy(true);
    setError("");
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSupportBusy(false);
    }
  }, [api, authHeaders]);

  return (
    <main className="shell" data-testid="relay-bridge-workbench-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">R</span>
          <div>
            <h1>Relay Bridge Workbench</h1>
            <p className="subtitle">Codex app server をM365 Copilotに接続するローカルブリッジです。</p>
          </div>
        </div>
        <button
          className="status-pill"
          type="button"
          data-ready={readiness.ready ? "true" : "false"}
          title={readiness.detail}
          onClick={() => void refreshStatus()}
          aria-label={`Relay bridge status: ${readiness.label}`}
        >
          {readiness.ready ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertCircle size={15} aria-hidden="true" />}
          {readiness.label}
        </button>
      </header>

      <section className="hero-card chat-card" aria-labelledby="bridge-title">
        <div className="panel-heading">
          <div className="hero-copy">
            <p className="eyebrow">Bundled app-server path</p>
            <h2 id="bridge-title">Copilotを頭脳にして、Codex app server がローカル作業を進めます</h2>
            <p>
              WorkbenchはRelayの <code>/bridge/*</code> にだけ接続します。Codex app server が会話とtool loopを管理し、
              Relay Coreの <code>/v1/chat/completions</code> provider 経由でM365 Copilotに推論を渡します。
            </p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void refreshStatus()}>
            <RotateCw size={16} aria-hidden="true" />
            更新
          </button>
        </div>

        <div className="workspace-row">
          <div>
            <span className="field-label">作業フォルダ</span>
            <strong>{workspace || "未選択"}</strong>
          </div>
          <button className="secondary-button" type="button" onClick={() => void pickWorkspace()}>
            <FolderOpen size={16} aria-hidden="true" />
            フォルダを選択
          </button>
        </div>

        <div className="message-list" aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty-state">
              <strong>通常のチャットとして指示できます。</strong>
              <span>例: このフォルダから関連資料を探して / Book2.xlsx のA1を赤くして / 小さなHTMLアプリを作って</span>
            </div>
          ) : messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <span>{message.role === "user" ? "You" : "Assistant"}</span>
              <p>{message.text || (message.role === "assistant" && running ? "応答を待っています..." : "")}</p>
            </article>
          ))}
        </div>

        <div className="composer">
          {error ? <p className="error" role="alert">{error}</p> : null}
          {attachments.length > 0 ? (
            <div className="attachment-tray" aria-label="添付ファイル">
              {attachments.map((attachment) => (
                <span className="attachment-chip" key={attachment.attachmentId} title={attachment.path}>
                  <Paperclip size={14} aria-hidden="true" />
                  {attachment.fileName}
                  <button type="button" aria-label={`${attachment.fileName} を外す`} onClick={() => void removeAttachment(attachment.attachmentId)}>
                    <X size={13} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {approvalRequests.length > 0 ? (
            <div className="approval-list" aria-live="polite">
              {approvalRequests.map((approval) => (
                <article className="approval-card" key={approval.approvalId}>
                  <div>
                    <span>{approval.toolName}</span>
                    <strong>{approval.summary}</strong>
                  </div>
                  <div className="approval-actions">
                    <button className="secondary-button" type="button" onClick={() => void resolveApproval(approval.approvalId, false)}>
                      拒否
                    </button>
                    <button className="primary-button" type="button" onClick={() => void resolveApproval(approval.approvalId, true)}>
                      承認
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void sendTurn();
              }
            }}
            placeholder="ここに指示を入力します"
            aria-label="Relay Agent instruction"
            disabled={running}
          />
          <div className="actions">
            <label className="secondary-button file-button">
              <Paperclip size={16} aria-hidden="true" />
              添付
              <input
                type="file"
                multiple
                onChange={(event) => {
                  void stageFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
                disabled={running}
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={!running && !input.trim()}
              onClick={() => running ? void stopTurn() : void sendTurn()}
            >
              {running ? <Square size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              {running ? "停止" : "送信"}
            </button>
            <span className="hint">Ctrl/⌘ + Enter でも送信できます。</span>
          </div>
        </div>
      </section>

      <section className="console-grid" aria-label="Relay bridge console">
        <section className="panel" aria-labelledby="activity-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Activity</p>
              <h2 id="activity-title">実行状況</h2>
            </div>
            <Server size={22} aria-hidden="true" />
          </div>
          <div className="activity-list" aria-live="polite">
            {activity.length === 0 ? (
              <p>送信すると、Codex app server のturnとtoolイベントがここに表示されます。</p>
            ) : activity.map((item) => (
              <article key={item.id}>
                <strong>{item.event}</strong>
                <span>{item.summary}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="bridge-health-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Bridge</p>
              <h2 id="bridge-health-title">Codex app-server bridge</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => void copyText("base", window.location.origin)}>
              <Clipboard size={16} aria-hidden="true" />
              {copied === "base" ? "コピー済み" : "Base URL"}
            </button>
          </div>
          <div className="status-region" aria-live="polite">
            <p>{readiness.detail}</p>
            {bridge ? (
              <p className="bridge-state">
                State: <strong>{bridge.state}</strong>{bridge.command ? ` / ${bridge.command}` : ""}
              </p>
            ) : null}
            <dl className="endpoint-list">
              <div><dt>Health</dt><dd><code>GET /bridge/health</code></dd></div>
              <div><dt>Session</dt><dd><code>POST /bridge/sessions</code></dd></div>
              <div><dt>Turn</dt><dd><code>POST /bridge/sessions/{"{sessionId}"}/turns</code></dd></div>
              <div><dt>Events</dt><dd><code>GET /bridge/turns/{"{turnId}"}/events</code></dd></div>
              <div><dt>Provider</dt><dd><code>POST /v1/chat/completions</code></dd></div>
            </dl>
          </div>
        </section>
      </section>

      <details className="support">
        <summary>診断</summary>
        <div className="support-body">
          <p>通常は開く必要はありません。問い合わせ時だけ使います。</p>
          <button className="secondary-button" type="button" disabled={supportBusy} onClick={() => void downloadSupportBundle()}>
            {supportBusy ? "作成中..." : "サポート情報を保存"}
          </button>
          <pre>{readiness.raw || "No status yet."}</pre>
        </div>
      </details>
    </main>
  );
}

function loadClientId(): string {
  const existing = localStorage.getItem(sessionStorageKey);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(sessionStorageKey, next);
  return next;
}

function summarizeBridgeEvent(event: string, payload: unknown): string {
  const text = extractTextDelta(payload);
  if (text) return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  if (typeof payload === "object" && payload !== null) {
    const params = "params" in payload ? (payload as { params?: unknown }).params : payload;
    if (typeof params === "object" && params !== null) {
      const item = "item" in params ? (params as { item?: unknown }).item : null;
      if (typeof item === "object" && item !== null && "type" in item) {
        return String((item as { type?: unknown }).type);
      }
      if ("turn" in params) return "turn state updated";
    }
  }
  return event;
}

function extractTextDelta(payload: unknown): string {
  if (typeof payload === "string") return "";
  if (typeof payload !== "object" || payload === null) return "";
  const root = payload as Record<string, unknown>;
  const params = (root.params && typeof root.params === "object")
    ? root.params as Record<string, unknown>
    : root;
  for (const key of ["delta", "text", "content"]) {
    const value = params[key];
    if (typeof value === "string") return value;
  }
  const item = params.item;
  if (typeof item === "object" && item !== null) {
    const itemRecord = item as Record<string, unknown>;
    for (const key of ["text", "content"]) {
      const value = itemRecord[key];
      if (typeof value === "string") return value;
    }
  }
  return "";
}

function isBridgeApproval(payload: unknown): payload is BridgeApproval {
  return typeof payload === "object" &&
    payload !== null &&
    (payload as { schemaVersion?: unknown }).schemaVersion === "RelayCodexAppServerBridgeApproval.v1" &&
    typeof (payload as { approvalId?: unknown }).approvalId === "string";
}
