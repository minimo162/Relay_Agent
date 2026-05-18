import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  useDefaultRenderTool,
  useHumanInTheLoop,
  type CopilotChatLabels,
} from "@copilotkit/react-core/v2";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  GitCompareArrows,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { createRelayAgUiAgent, relayAgentId } from "./lib/relay-ag-ui";
import type { PdfPickResponse, StatusResponse, WorkspacePickResponse } from "./types";

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
  chatInputPlaceholder: "メッセージを入力（例: このPDFの誤字を探して）",
  chatDisclaimerText: "",
  welcomeMessageText: "普通のチャットと同じように依頼してください。必要なローカルツールはCopilotが選び、Relayが安全に実行します。",
  modalHeaderTitle: "Relay Agent",
  chatInputToolbarToolsButtonLabel: "添付 / ツール",
  chatInputToolbarAddButtonLabel: "追加",
};

export function App() {
  const [workspace, setWorkspace] = useState(() => localStorage.getItem(workspaceStorageKey) ?? "");
  const [workspaceHistory, setWorkspaceHistory] = useState(loadWorkspaceHistory);
  const [workspaceError, setWorkspaceError] = useState("");
  const [starterNotice, setStarterNotice] = useState("");
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false);
  const [isPickingPdf, setIsPickingPdf] = useState(false);
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

  const insertStarterPrompt = useCallback(async (
    prompt: string,
    successMessage = "下書きを入力しました。内容を確認して送信してください。",
    copiedMessage = "下書きをコピーしました。入力欄に貼り付けてください。",
  ) => {
    setStarterNotice("");
    const inserted = insertPromptIntoComposer(prompt);
    if (inserted) {
      setStarterNotice(successMessage);
      return;
    }

    try {
      await navigator.clipboard.writeText(prompt);
      setStarterNotice(copiedMessage);
    } catch {
      setWorkspaceError("入力欄が見つからず、クリップボードにもコピーできませんでした。");
    }
  }, []);

  const pickPdf = useCallback(async (title: string): Promise<string | null> => {
    setWorkspaceError("");
    setStarterNotice("");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120_000);
    try {
      const response = await fetch(api("/api/pdf/pick"), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ currentPath: workspace, title }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`PDF picker failed: ${response.status}`);
      const result = (await response.json()) as PdfPickResponse;
      if (result.cancelled) return null;
      if (result.error) {
        setWorkspaceError(result.error);
        return null;
      }
      if (!result.path || !result.exists) {
        setWorkspaceError("PDFファイルを選択できませんでした。");
        return null;
      }
      return result.path;
    } catch (error) {
      setWorkspaceError(timedOut
        ? "PDF選択がタイムアウトしました。もう一度押してください。"
        : error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }, [api, authHeaders, workspace]);

  const adoptWorkspaceForFiles = useCallback((paths: string[]): string => {
    const nextWorkspace = workspaceForSelectedFiles(paths, workspace);
    if (nextWorkspace && nextWorkspace !== workspace) {
      setWorkspace(nextWorkspace);
      saveWorkspace(nextWorkspace, setWorkspaceHistory);
      return nextWorkspace;
    }
    return workspace;
  }, [workspace]);

  const pickPdfForProofread = useCallback(async () => {
    setIsPickingPdf(true);
    try {
      const path = await pickPdf("誤字を確認するPDFを選択");
      if (!path) return;
      const effectiveWorkspace = adoptWorkspaceForFiles([path]);
      const workspaceNote = effectiveWorkspace !== workspace ? "作業フォルダもPDFの場所に合わせました。" : "";
      await insertStarterPrompt(
        buildPdfProofreadPrompt(path),
        `PDF確認の下書きを入力しました。送信するとRelayがPDFを読みます。${workspaceNote}`,
      );
    } finally {
      setIsPickingPdf(false);
    }
  }, [adoptWorkspaceForFiles, insertStarterPrompt, pickPdf, workspace]);

  const pickPdfsForCompare = useCallback(async () => {
    setIsPickingPdf(true);
    try {
      const firstPath = await pickPdf("比較する1つ目のPDFを選択");
      if (!firstPath) return;
      const secondPath = await pickPdf("比較する2つ目のPDFを選択");
      if (!secondPath) {
        setStarterNotice("2つ目のPDF選択がキャンセルされました。");
        return;
      }
      const effectiveWorkspace = adoptWorkspaceForFiles([firstPath, secondPath]);
      const workspaceNote = effectiveWorkspace !== workspace ? "作業フォルダもPDFの共通フォルダに合わせました。" : "";
      await insertStarterPrompt(
        buildPdfComparePrompt(firstPath, secondPath),
        `PDF比較の下書きを入力しました。送信するとRelayが2つのPDFを読みます。${workspaceNote}`,
      );
    } finally {
      setIsPickingPdf(false);
    }
  }, [adoptWorkspaceForFiles, insertStarterPrompt, pickPdf, workspace]);

  const agent = useMemo(() =>
    createRelayAgUiAgent({
      url: api("/agui/relay"),
      headers: authHeaders(),
      threadId: threadIdRef.current,
      workspace,
    }), [api, authHeaders, workspace]);

  const visibleWorkspaceHistory = useMemo(
    () => workspaceHistory.filter((item) => item !== workspace).slice(0, 3),
    [workspace, workspaceHistory],
  );
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
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">R</span>
              <div>
                <h1>Relay Agent</h1>
                <p className="subtitle">Copilot とローカルツールをつなぐチャット</p>
              </div>
            </div>
            <button
              className="status-pill"
              id="readiness"
              type="button"
              data-ready={readiness.ready}
              title={readiness.title}
              onClick={handleRefresh}
              aria-label={`接続状態: ${readiness.label}`}
            >
              {readiness.label}
            </button>
          </header>

          <main className="chat-layout">
            {readiness.label === "Sign in needed" ? (
              <div className="signin-row" role="status" aria-live="polite">
                <span>Copilot にサインインしてください。</span>
                <button type="button" className="text-button" onClick={() => void openCopilot()}>
                  Open Copilot <ExternalLink size={14} aria-hidden="true" />
                </button>
              </div>
            ) : null}

            <section className="workspace-bar" aria-label="Workspace">
              <div>
                <span className="label">作業フォルダ</span>
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

            {workspaceError ? (
              <p id="workspace-error" className="workspace-error" role="alert">{workspaceError}</p>
            ) : null}
            {starterNotice ? <p className="starter-notice" role="status" aria-live="polite">{starterNotice}</p> : null}

            <div id="workspace-history" className="workspace-history" hidden={visibleWorkspaceHistory.length === 0}>
              {visibleWorkspaceHistory.map((item) => (
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
              <section className="empty-chat" aria-label="はじめかた">
                <div className="onboarding-card">
                  <div className="onboarding-heading">
                    <MessageSquareText size={20} aria-hidden="true" />
                    <div>
                      <h2>チャットを始める</h2>
                      <p>最初に作業フォルダを選ぶだけで使えます。</p>
                    </div>
                  </div>
                  <ol className="onboarding-steps">
                    <li>
                      <span>1</span>
                      <div>
                        <strong>フォルダを選択</strong>
                        <p>検索・編集・作成の対象にするローカルフォルダを指定します。</p>
                      </div>
                    </li>
                    <li>
                      <span>2</span>
                      <div>
                        <strong>自然文で依頼</strong>
                        <p>ファイル検索、PDF確認、Office編集、コード作成を普通に入力します。</p>
                      </div>
                    </li>
                    <li>
                      <span>3</span>
                      <div>
                        <strong>変更は確認して実行</strong>
                        <p>ファイルを書き換える前に、Relay がチャット内で承認を求めます。</p>
                      </div>
                    </li>
                  </ol>
                  <button
                    className="primary-button onboarding-action"
                    type="button"
                    disabled={isPickingWorkspace}
                    onClick={() => void chooseWorkspace()}
                  >
                    <FolderOpen size={15} aria-hidden="true" />
                    {isPickingWorkspace ? "選択中..." : "作業フォルダを選ぶ"}
                  </button>
                </div>
              </section>
            ) : (
              <>
                <section className="starter-row" aria-label="よく使う依頼">
                  <button
                    type="button"
                    className="starter-chip"
                    disabled={isPickingPdf}
                    onClick={() => void pickPdfForProofread()}
                  >
                    <FileText size={16} aria-hidden="true" />
                    {isPickingPdf ? "PDF選択中..." : "PDFを選んで誤字確認"}
                  </button>
                  <button
                    type="button"
                    className="starter-chip"
                    disabled={isPickingPdf}
                    onClick={() => void pickPdfsForCompare()}
                  >
                    <GitCompareArrows size={16} aria-hidden="true" />
                    2つのPDFを選んで比較
                  </button>
                </section>
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
              </>
            )}

            <details className="details">
              <summary>診断</summary>
              <div className="details-header">
                <span>共有用に伏せ字化した診断情報</span>
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
      <div className="tool-card" aria-live="polite">
        <div className="tool-card-heading">
          <span>tool</span>
          <code>{name}</code>
        </div>
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
        <strong>
          {completed ? (
            <CheckCircle2 size={16} aria-hidden="true" />
          ) : (
            <ShieldCheck size={16} aria-hidden="true" />
          )}
          {completed ? "確認済み" : "実行前の確認"}
        </strong>
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

function buildPdfProofreadPrompt(pdfPath: string): string {
  return `PDFの誤字・表記ゆれを確認してください。
対象PDF: ${formatPathForPrompt(pdfPath)}

進め方:
1. 対象PDFを exact path で read してください。長いPDFや途中で切れる場合は、read mode=map でページ構成を確認してから pageStart/pageEnd で必要範囲を読んでください。
2. 抽出できた本文だけを根拠に、誤字候補、表記ゆれ、日付・数値・固有名詞の不自然さを一覧化してください。
3. 各指摘には根拠となる短い引用または周辺テキストとページ範囲を付けてください。
4. 画像だけのPDF、OCRが必要な箇所、抽出できないページは確認不可と明記してください。`;
}

function buildPdfComparePrompt(firstPdfPath: string, secondPdfPath: string): string {
  return `2つのPDFを比較し、整合しない可能性がある箇所を探してください。
PDF A: ${formatPathForPrompt(firstPdfPath)}
PDF B: ${formatPathForPrompt(secondPdfPath)}

進め方:
1. PDF A と PDF B の両方を exact path で read してください。長い場合は両方を read mode=map で読み、見出し・ページプレビュー・日付・数値で対応するページ範囲を先に揃えてください。
2. 対応が取れた pageStart/pageEnd の範囲を両方のPDFで read してから、名称、日付、数値、見出し、注記、表現の差分を整理してください。
3. 不整合候補ごとに、どちらのPDFのどのページ範囲・周辺テキストと食い違うのかを短く示してください。
4. 画像だけのPDF、OCRが必要な箇所、抽出できないページは比較不可と明記してください。`;
}

function formatPathForPrompt(path: string): string {
  return `"${path.replaceAll("\"", "\\\"")}"`;
}

function insertPromptIntoComposer(prompt: string): boolean {
  const textarea = document.querySelector<HTMLTextAreaElement>(".chat-card textarea");
  if (textarea) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, prompt);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
    return true;
  }

  const editable = document.querySelector<HTMLElement>(".chat-card [contenteditable='true']");
  if (editable) {
    editable.focus();
    editable.textContent = prompt;
    editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
    return true;
  }

  return false;
}

function compactPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

function workspaceForSelectedFiles(paths: string[], currentWorkspace: string): string | null {
  const existingWorkspace = currentWorkspace.trim();
  if (existingWorkspace && paths.every((path) => isPathInsideFolder(existingWorkspace, path))) {
    return existingWorkspace;
  }
  return commonParentDirectory(paths);
}

function isPathInsideFolder(folder: string, path: string): boolean {
  const normalizedFolder = normalizePathForCompare(folder).replace(/\/+$/u, "");
  const normalizedPath = normalizePathForCompare(path).replace(/\/+$/u, "");
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function commonParentDirectory(paths: string[]): string | null {
  const directories = paths.map(parentDirectory).filter((path): path is string => Boolean(path));
  if (directories.length === 0) return null;
  const parsed = directories.map(parsePathForCommonAncestor);
  const [first] = parsed;
  if (parsed.some((item) => item.root !== first.root)) return null;

  const common: string[] = [];
  for (let index = 0; ; index += 1) {
    const part = first.parts[index];
    if (!part || parsed.some((item) => item.parts[index] !== part)) break;
    common.push(part);
  }
  if (common.length === 0) return first.root || null;
  return formatCommonAncestor(first.root, common);
}

function parentDirectory(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return null;
  return normalized.slice(0, index);
}

function normalizePathForCompare(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  return /^[a-z]:/iu.test(normalized) ? normalized.toLowerCase() : normalized;
}

function parsePathForCommonAncestor(path: string): { root: string; parts: string[] } {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  const drive = normalized.match(/^[a-z]:/iu)?.[0];
  if (drive) {
    return {
      root: `${drive}/`,
      parts: normalized.slice(drive.length).split("/").filter(Boolean),
    };
  }
  if (normalized.startsWith("/")) {
    return {
      root: "/",
      parts: normalized.split("/").filter(Boolean),
    };
  }
  return {
    root: "",
    parts: normalized.split("/").filter(Boolean),
  };
}

function formatCommonAncestor(root: string, parts: string[]): string {
  if (root === "/") return `/${parts.join("/")}`;
  if (root.endsWith(":/")) return `${root}${parts.join("/")}`;
  return [root, ...parts].filter(Boolean).join("/");
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
