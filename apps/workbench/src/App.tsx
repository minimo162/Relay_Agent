import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  RotateCw,
  Server,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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

const initialReadiness: ReadinessState = {
  ready: false,
  label: "Checking",
  detail: "Relay Core と Codex app-server bridge の状態を確認しています。",
  raw: "",
};

export function App() {
  const [readiness, setReadiness] = useState<ReadinessState>(initialReadiness);
  const [bridge, setBridge] = useState<BridgeHealthResponse | null>(null);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [supportBusy, setSupportBusy] = useState(false);

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

      <section className="hero-card" aria-labelledby="bridge-title">
        <div className="hero-copy">
          <p className="eyebrow">Bundled app-server path</p>
          <h2 id="bridge-title">Copilotを頭脳にして、Codex app server がローカル作業を進めます</h2>
          <p>
            WorkbenchはRelayのブラウザブリッジへ接続します。ブリッジはCodex app serverを起動し、
            Relay Coreの <code>/v1</code> provider 経由でM365 Copilotに推論を渡します。
          </p>
        </div>

        <div className="quick-steps" aria-label="runtime chain">
          <article>
            <strong>1. Workbench</strong>
            <span>ブラウザUIは <code>/bridge/*</code> を使い、Copilot CDPへ直接触れません。</span>
          </article>
          <article>
            <strong>2. Codex app server</strong>
            <span>session、turn、item、event stream、tool loop を担当します。</span>
          </article>
          <article>
            <strong>3. Relay provider</strong>
            <span><code>/v1/chat/completions</code> は app server 用の低レベルproviderです。</span>
          </article>
        </div>
      </section>

      <section className="console-grid" aria-label="Relay bridge console">
        <section className="panel test-panel" aria-labelledby="bridge-health-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Bridge</p>
              <h2 id="bridge-health-title">Codex app-server bridge</h2>
            </div>
            <button className="primary-button" type="button" onClick={() => void refreshStatus()}>
              <RotateCw size={16} aria-hidden="true" />
              更新
            </button>
          </div>
          <div className="status-region" aria-live="polite">
            {error ? <p className="error" role="alert">{error}</p> : null}
            <p>{readiness.detail}</p>
            {bridge ? (
              <pre className="answer">{JSON.stringify(bridge, null, 2)}</pre>
            ) : (
              <p>Bridge health を取得しています。</p>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="bridge-endpoint-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Bridge endpoints</p>
              <h2 id="bridge-endpoint-title">Workbench が使う経路</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => void copyText("base", window.location.origin)}>
              <Clipboard size={16} aria-hidden="true" />
              {copied === "base" ? "コピー済み" : "Base URL"}
            </button>
          </div>
          <dl className="endpoint-list">
            <div><dt>Health</dt><dd><code>GET /bridge/health</code></dd></div>
            <div><dt>Session</dt><dd><code>POST /bridge/sessions</code></dd></div>
            <div><dt>Turn</dt><dd><code>POST /bridge/sessions/{"{sessionId}"}/turns</code></dd></div>
            <div><dt>Events</dt><dd><code>GET /bridge/turns/{"{turnId}"}/events</code></dd></div>
            <div><dt>Provider</dt><dd><code>POST /v1/chat/completions</code></dd></div>
          </dl>
        </section>
      </section>

      <section className="panel starter-panel" aria-labelledby="next-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Next runtime gate</p>
            <h2 id="next-title">同梱前に必要な確認</h2>
          </div>
          <Server size={22} aria-hidden="true" />
        </div>
        <div className="quick-steps" aria-label="bridge gaps">
          <article>
            <strong>Artifact</strong>
            <span>app-server binary、schema、license、hashをpinします。</span>
          </article>
          <article>
            <strong>Provider</strong>
            <span>app server がRelayの <code>m365-copilot</code> providerを使えることを検証します。</span>
          </article>
          <article>
            <strong>Tools</strong>
            <span>local file、Office、diff、approvalを app-server tool loop に接続します。</span>
          </article>
        </div>
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
