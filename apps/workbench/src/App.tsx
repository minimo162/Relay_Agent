import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Download,
  Play,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RelayManifestResponse, StatusResponse } from "./types";

const token = new URLSearchParams(window.location.search).get("token") ?? "";
const sessionStorageKey = "relay.apiHub.clientId";

const defaultPrompt = "このHTMLツールからRelay Core経由でCopilotに接続できているか、短く確認してください。";

type ReadinessState = {
  ready: boolean;
  label: string;
  detail: string;
  raw: string;
};

const initialReadiness: ReadinessState = {
  ready: false,
  label: "Checking",
  detail: "Relay Core の状態を確認しています。",
  raw: "",
};

export function App() {
  const [readiness, setReadiness] = useState<ReadinessState>(initialReadiness);
  const [manifest, setManifest] = useState<RelayManifestResponse | null>(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [answer, setAnswer] = useState("");
  const [running, setRunning] = useState(false);
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
    const [healthResponse, manifestResponse] = await Promise.all([
      fetch(api("/health"), { headers: authHeaders() }),
      fetch(api("/v1/relay/manifest"), { headers: authHeaders() }),
    ]);
    if (!healthResponse.ok) throw new Error(`Relay Core status failed: ${healthResponse.status}`);
    if (!manifestResponse.ok) throw new Error(`Relay manifest failed: ${manifestResponse.status}`);
    const status = (await healthResponse.json()) as StatusResponse;
    const nextManifest = (await manifestResponse.json()) as RelayManifestResponse;
    const raw = JSON.stringify(status, null, 2);
    const requiredIssue = status.checks.find((check) => check.required !== false && !check.ready);
    setReadiness({
      ready: status.ready,
      label: status.ready ? "Ready" : requiredIssue?.state === "sign_in_required" ? "Sign in needed" : "Not ready",
      detail: requiredIssue?.detail ?? "HTMLツールからRelay APIを利用できます。",
      raw,
    });
    setManifest(nextManifest);
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

  const baseUrl = manifest?.baseUrl ?? window.location.origin;
  const starterHtml = useMemo(() => buildStarterHtml(baseUrl, token), [baseUrl]);
  const canRun = readiness.ready && prompt.trim().length > 0 && !running;

  const runPrompt = useCallback(async () => {
    if (!canRun) return;
    setRunning(true);
    setError("");
    setAnswer("");
    try {
      const response = await fetch(api("/v1/chat/completions"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: "m365-copilot",
          messages: [{ role: "user", content: prompt.trim() }],
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(extractError(text) ?? `Copilot request failed: ${response.status}`);
      }
      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      setAnswer(json.choices?.[0]?.message?.content ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  }, [api, authHeaders, canRun, prompt]);

  const copyText = useCallback(async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1800);
  }, []);

  const downloadStarter = useCallback(() => {
    const blob = new Blob([starterHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "relay-html-tool-starter.html";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [starterHtml]);

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
    <main className="shell" data-testid="relay-api-hub-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">R</span>
          <div>
            <h1>Relay API Hub</h1>
            <p className="subtitle">任意のHTMLツールからM365 Copilotを安全に呼び出すローカルAPIです。</p>
          </div>
        </div>
        <button
          className="status-pill"
          type="button"
          data-ready={readiness.ready ? "true" : "false"}
          title={readiness.detail}
          onClick={() => void refreshStatus()}
          aria-label={`Relay Core status: ${readiness.label}`}
        >
          {readiness.ready ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertCircle size={15} aria-hidden="true" />}
          {readiness.label}
        </button>
      </header>

      <section className="hero-card" aria-labelledby="hub-title">
        <div className="hero-copy">
          <p className="eyebrow">Local Copilot API</p>
          <h2 id="hub-title">HTMLをつなぐだけでCopilotを使えます</h2>
          <p>
            Relay CoreがCopilot接続、トークン認証、OpenAI互換APIを受け持ちます。
            HTMLツール側は通常のChat Completions APIとして呼び、必要なツールはHTML側で実行します。
          </p>
        </div>

        <div className="quick-steps" aria-label="使い方">
          <article>
            <strong>1. Relayを起動</strong>
            <span>この画面が開いてReadyになればAPIが利用できます。</span>
          </article>
          <article>
            <strong>2. HTMLからPOST</strong>
            <span><code>/v1/chat/completions</code> でCopilotに依頼します。</span>
          </article>
          <article>
            <strong>3. ツールはHTML側</strong>
            <span>function callingの結果を受け取り、クライアント側で安全に実行します。</span>
          </article>
        </div>
      </section>

      <section className="console-grid" aria-label="Relay API console">
        <section className="panel test-panel" aria-labelledby="test-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Test</p>
              <h2 id="test-title">接続テスト</h2>
            </div>
            <button className="primary-button" type="button" disabled={!canRun} onClick={() => void runPrompt()}>
              {running ? <RotateCw className="spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {running ? "送信中..." : "Copilotに送信"}
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            aria-label="Copilot test prompt"
            spellCheck={false}
          />
          <div className="status-region" aria-live="polite">
            {error ? <p className="error" role="alert">{error}</p> : null}
            {answer ? <pre className="answer">{answer}</pre> : <p>ここで疎通確認できます。自作HTMLツールからも同じAPIを呼びます。</p>}
          </div>
        </section>

        <section className="panel" aria-labelledby="endpoint-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Endpoints</p>
              <h2 id="endpoint-title">HTMLツール用API</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => void copyText("base", baseUrl)}>
              <Clipboard size={16} aria-hidden="true" />
              {copied === "base" ? "コピー済み" : "Base URL"}
            </button>
          </div>
          <dl className="endpoint-list">
            <div><dt>Health</dt><dd><code>GET /health</code></dd></div>
            <div><dt>Manifest</dt><dd><code>GET /v1/relay/manifest</code></dd></div>
            <div><dt>Models</dt><dd><code>GET /v1/models</code></dd></div>
            <div><dt>Chat</dt><dd><code>POST /v1/chat/completions</code></dd></div>
            <div><dt>Session</dt><dd><code>GET /v1/copilot/session</code></dd></div>
          </dl>
        </section>
      </section>

      <section className="panel starter-panel" aria-labelledby="starter-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Starter</p>
            <h2 id="starter-title">HTMLスターター</h2>
          </div>
          <div className="actions">
            <button className="secondary-button" type="button" onClick={() => void copyText("starter", starterHtml)}>
              <Clipboard size={16} aria-hidden="true" />
              {copied === "starter" ? "コピー済み" : "コピー"}
            </button>
            <button className="secondary-button" type="button" onClick={downloadStarter}>
              <Download size={16} aria-hidden="true" />
              HTML保存
            </button>
          </div>
        </div>
        <pre className="code-sample">{starterHtml}</pre>
      </section>

      <details className="support">
        <summary>診断</summary>
        <div className="support-body">
          <p>通常は開く必要はありません。問い合わせ時だけ使います。</p>
          <button className="secondary-button" type="button" disabled={supportBusy} onClick={() => void downloadSupportBundle()}>
            {supportBusy ? "作成中..." : "サポート情報を保存"}
          </button>
          <pre>{readiness.raw || "No status yet."}</pre>
          {manifest ? <pre>{JSON.stringify(manifest, null, 2)}</pre> : null}
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

function extractError(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { error?: string | { message?: string } };
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.message ?? null;
  } catch {
    return text.trim() || null;
  }
}

function buildStarterHtml(baseUrl: string, launchToken: string): string {
  const safeBase = JSON.stringify(baseUrl);
  const safeToken = JSON.stringify(launchToken || "PASTE_RELAY_TOKEN_HERE");
  return `<!doctype html>
<html lang="ja">
<meta charset="utf-8" />
<title>Relay HTML Tool Starter</title>
<body>
  <textarea id="prompt" rows="6" style="width:100%">このHTMLツールからCopilotに接続できているか確認してください。</textarea>
  <button id="send">Send to Copilot</button>
  <pre id="output"></pre>
  <script>
    const relayBase = ${safeBase};
    const relayToken = ${safeToken};
    async function askCopilot(message) {
      const url = new URL('/v1/chat/completions', relayBase);
      url.searchParams.set('token', relayToken);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'm365-copilot',
          messages: [{ role: 'user', content: message }]
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const json = await response.json();
      return json.choices?.[0]?.message?.content ?? '';
    }
    document.querySelector('#send').onclick = async () => {
      const output = document.querySelector('#output');
      output.textContent = 'Running...';
      try {
        output.textContent = await askCopilot(document.querySelector('#prompt').value);
      } catch (error) {
        output.textContent = String(error);
      }
    };
  </script>
</body>
</html>`;
}
