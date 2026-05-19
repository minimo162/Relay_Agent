import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  RotateCw,
  ShieldCheck,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type {
  PdfReviewFinding,
  PdfReviewJobResponse,
  StatusResponse,
} from "./types";

const token = new URLSearchParams(window.location.search).get("token") ?? "";
const sessionStorageKey = "relay.pdfReview.clientId";

const maxPdfFiles = 8;

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
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<PdfReviewJobResponse | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [supportBusy, setSupportBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const api = useCallback((path: string): string => {
    const url = new URL(path, window.location.origin);
    if (token) url.searchParams.set("token", token);
    return url.toString();
  }, []);

  const authHeaders = useCallback((extra: Record<string, string> = {}): Record<string, string> => {
    return token ? { ...extra, "X-Relay-Token": token } : extra;
  }, []);

  const refreshStatus = useCallback(async () => {
    const response = await fetch(api("/health"), { headers: authHeaders() });
    if (!response.ok) throw new Error(`Relay Core status failed: ${response.status}`);
    const status = (await response.json()) as StatusResponse;
    const raw = JSON.stringify(status, null, 2);
    const requiredIssue = status.checks.find((check) => check.required !== false && !check.ready);
    setReadiness({
      ready: status.ready,
      label: status.ready ? "Ready" : requiredIssue?.state === "sign_in_required" ? "Sign in needed" : "Not ready",
      detail: requiredIssue?.detail ?? "PDFレビューを開始できます。",
      raw,
    });
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

  const canRun = readiness.ready && files.length > 0 && files.length <= maxPdfFiles && !running;
  const reviewMode = files.length <= 1
    ? "1つのPDFをまとめて確認"
    : `${files.length}つのPDFを対応表で比較`;
  const visibleFiles = useMemo(() => files.map((file) => ({
    name: file.name,
    size: formatBytes(file.size),
  })), [files]);

  const onFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? [])
      .filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))
      .slice(0, maxPdfFiles);
    setFiles(nextFiles);
    setJob(null);
    setError(nextFiles.length === 0 ? "PDFファイルを選択してください。" : "");
  }, []);

  const clearSelection = useCallback(() => {
    setFiles([]);
    setJob(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const runReview = useCallback(async () => {
    if (!canRun) return;
    setRunning(true);
    setError("");
    setJob(null);
    setProgress("PDFをRelay Coreへ渡しています。");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const form = new FormData();
      form.append("reviewType", "auto");
      for (const file of files) form.append("files", file, file.name);
      setProgress("ページ単位でテキストを抽出しています。");
      const response = await fetch(api("/v1/pdf/review"), {
        method: "POST",
        headers: authHeaders(),
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(extractError(text) ?? `PDF review failed: ${response.status}`);
      }
      setProgress("ページ付きの結果を整理しています。");
      setJob((await response.json()) as PdfReviewJobResponse);
      setProgress("完了しました。");
    } catch (reason) {
      if (controller.signal.aborted) {
        setProgress("キャンセルしました。");
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
        setProgress("");
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, [api, authHeaders, canRun, files]);

  const cancelReview = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const downloadReport = useCallback(() => {
    if (!job) return;
    const blob = new Blob([job.reportMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${job.jobId}-report.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [job]);

  const deleteJob = useCallback(async () => {
    if (!job) return;
    await fetch(api(`/v1/pdf/jobs/${encodeURIComponent(job.jobId)}`), {
      method: "DELETE",
      headers: authHeaders(),
    }).catch(() => undefined);
    setJob(null);
    setProgress("レビュー結果を削除しました。");
  }, [api, authHeaders, job]);

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

  const groupedFindings = useMemo(() => groupFindings(job?.findings ?? []), [job]);

  return (
    <main className="shell" data-testid="relay-pdf-review-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">R</span>
          <div>
            <h1>Relay PDF Review</h1>
            <p className="subtitle">PDFの誤字・表記・整合性をページ付きで確認します。</p>
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

      <section className="hero-card" aria-labelledby="review-title">
        <div className="hero-copy">
          <p className="eyebrow">PDF review</p>
          <h2 id="review-title">PDFを選ぶだけでまとめて確認できます</h2>
          <p>
            1つなら誤字脱字・表記・文書内整合を一括チェックします。
            2つ以上なら章見出しの対応表を作ってから文書間の違いも確認します。
          </p>
        </div>

        <label className="drop-zone">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={onFileChange}
          />
          <UploadCloud size={26} aria-hidden="true" />
          <span>PDFを選択</span>
          <small>1〜{maxPdfFiles}件まで。処理データはユーザーローカル領域に保存されます。</small>
        </label>

        <p className="review-description">{reviewMode}</p>

        {visibleFiles.length > 0 ? (
          <ul className="file-list" aria-label="選択中のPDF">
            {visibleFiles.map((file) => (
              <li key={file.name}>
                <FileText size={16} aria-hidden="true" />
                <span>{file.name}</span>
                <small>{file.size}</small>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="actions">
          <button className="primary-button" type="button" disabled={!canRun} onClick={() => void runReview()}>
            {running ? <RotateCw className="spin" size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
            {running ? "確認中..." : "レビューを開始"}
          </button>
          {running ? (
            <button className="secondary-button" type="button" onClick={cancelReview}>
              <XCircle size={16} aria-hidden="true" />
              キャンセル
            </button>
          ) : (
            <button className="secondary-button" type="button" disabled={files.length === 0} onClick={clearSelection}>
              選択をクリア
            </button>
          )}
        </div>
      </section>

      <section className="status-region" aria-live="polite">
        {progress ? <p>{progress}</p> : <p>PDFを選択するとレビューを開始できます。</p>}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>

      {job ? (
        <section className="results" aria-labelledby="result-title">
          <div className="results-heading">
            <div>
              <p className="eyebrow">Result</p>
              <h2 id="result-title">レビュー結果</h2>
              <p>{job.findings.length}件の候補 · {job.documents.length}文書 · {job.sectionAlignments.length}件の対応 · {job.status}</p>
            </div>
            <div className="result-actions">
              <button className="secondary-button" type="button" onClick={downloadReport}>
                <Download size={16} aria-hidden="true" />
                レポート
              </button>
              <button className="icon-button" type="button" onClick={() => void deleteJob()} aria-label="レビュー結果を削除">
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          {job.limitations.length > 0 ? (
            <div className="limitations">
              <strong>確認範囲</strong>
              <ul>
                {job.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
              </ul>
            </div>
          ) : null}

          {job.sectionAlignments.length > 0 ? (
            <section className="alignment-panel" aria-labelledby="alignment-title">
              <div>
                <p className="eyebrow">Alignment</p>
                <h3 id="alignment-title">章見出しの対応表</h3>
              </div>
              <div className="alignment-list">
                {job.sectionAlignments.slice(0, 24).map((alignment) => (
                  <article key={alignment.alignmentId} className="alignment-row" data-status={alignment.status}>
                    <div>
                      <strong>{alignment.baseTitle}</strong>
                      <small>{documentLabel(job, alignment.baseDocumentId)} · p.{alignment.basePageStart}-{alignment.basePageEnd}</small>
                    </div>
                    <div>
                      <strong>{alignment.comparedTitle ?? "対応なし"}</strong>
                      <small>
                        {documentLabel(job, alignment.comparedDocumentId)}
                        {alignment.comparedPageStart ? ` · p.${alignment.comparedPageStart}-${alignment.comparedPageEnd}` : ""}
                      </small>
                    </div>
                    <span>{alignment.status} · {alignment.score}</span>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <div className="finding-groups">
            {groupedFindings.map((group) => (
              <section key={group.category} className="finding-group">
                <h3>{group.category}</h3>
                <div className="finding-list">
                  {group.findings.map((finding) => (
                    <article key={finding.id} className="finding-card">
                      <div className="finding-meta">
                        <span>{finding.severity}</span>
                        <span>{documentLabel(job, finding.documentId)} · p.{finding.page}</span>
                      </div>
                      <p className="finding-issue">{finding.issue}</p>
                      <blockquote>{finding.evidence || "引用可能なテキストはありません。"}</blockquote>
                      <p className="finding-suggestion">{finding.suggestion}</p>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

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

function extractError(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? null;
  } catch {
    return text.trim() || null;
  }
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function groupFindings(findings: PdfReviewFinding[]): Array<{ category: string; findings: PdfReviewFinding[] }> {
  const groups = new Map<string, PdfReviewFinding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.category) ?? [];
    group.push(finding);
    groups.set(finding.category, group);
  }
  return Array.from(groups, ([category, grouped]) => ({ category, findings: grouped }));
}

function documentLabel(job: PdfReviewJobResponse, documentId: string): string {
  return job.documents.find((document) => document.documentId === documentId)?.displayName ?? documentId;
}
