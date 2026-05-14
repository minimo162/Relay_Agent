/// <reference types="vite/client" />
import { open } from "@tauri-apps/plugin-dialog";
import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js";
import {
  executeOfficeCliCommand,
  getRelayWorkspaceState,
  inspectOfficeFile,
  runRelayDocumentSearch,
  warmupCopilotBridge,
  type RelayDocumentSearchResponse,
  type RelayOfficeCommandResponse,
  type RelaySearchResultCard,
  type RelayWorkspaceState,
} from "../lib/ipc";
import { loadWorkspacePath, saveWorkspacePath } from "../lib/settings-storage";
import { showToast } from "../lib/status-toasts";
import { pickWorkspaceFolder } from "../lib/workspace-picker";
import { StatusToasts } from "../components/StatusToasts";

type Mode = "search" | "office";
type Activity = {
  id: string;
  mode: Mode;
  title: string;
  status: string;
  detail: string;
  at: string;
};

function nowLabel(): string {
  return new Date().toLocaleString();
}

function shortPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

function statusTone(ok: boolean): string {
  return ok ? "text-[var(--ra-color-success)]" : "text-[var(--ra-color-danger)]";
}

function cardBucketLabel(card: RelaySearchResultCard): string {
  const bucket = card.bucket || card.folderRole || "";
  const labels: Record<string, string> = {
    direct_source_workpaper: "作業元",
    supporting_evidence: "補助資料",
    disclosure_output: "開示/出力",
    review_or_audit: "監査/確認",
    backup_or_archive: "バックアップ",
    source_workpaper: "作業元",
    filing: "提出/保管",
    audit: "監査",
  };
  return labels[bucket] || bucket || "候補";
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.find((value) => value && value.trim())?.trim() || "";
}

export default function Shell(): JSX.Element {
  const [mode, setMode] = createSignal<Mode>("search");
  const [workspacePath, setWorkspacePath] = createSignal(loadWorkspacePath());
  const [state, setState] = createSignal<RelayWorkspaceState | null>(null);
  const [stateLoading, setStateLoading] = createSignal(false);

  const [searchQuery, setSearchQuery] = createSignal("");
  const [searching, setSearching] = createSignal(false);
  const [searchResult, setSearchResult] = createSignal<RelayDocumentSearchResponse | null>(null);
  const [selectedCard, setSelectedCard] = createSignal<RelaySearchResultCard | null>(null);
  const [searchError, setSearchError] = createSignal("");
  const [visibleResultCount, setVisibleResultCount] = createSignal(24);

  const [officeFilePath, setOfficeFilePath] = createSignal("");
  const [officeArgs, setOfficeArgs] = createSignal("");
  const [officeRunning, setOfficeRunning] = createSignal(false);
  const [officeResult, setOfficeResult] = createSignal<RelayOfficeCommandResponse | null>(null);

  const [copilotChecking, setCopilotChecking] = createSignal(false);
  const [copilotMessage, setCopilotMessage] = createSignal("未確認");
  const [activity, setActivity] = createSignal<Activity[]>([]);

  const workspaceReady = createMemo(() => workspacePath().trim().length > 0);
  const appState = createMemo(() => state());
  const activeCard = createMemo(() => selectedCard() || searchResult()?.cards[0] || null);
  const resultCards = createMemo(() => searchResult()?.cards ?? []);
  const visibleCards = createMemo(() => resultCards().slice(0, visibleResultCount()));
  const hasMoreCards = createMemo(() => resultCards().length > visibleResultCount());
  let searchSequence = 0;

  const appendActivity = (entry: Omit<Activity, "id" | "at">) => {
    setActivity((current) => [
      { ...entry, id: crypto.randomUUID(), at: nowLabel() },
      ...current,
    ].slice(0, 12));
  };

  const refreshState = async (showSuccess = false) => {
    setStateLoading(true);
    try {
      const next = await getRelayWorkspaceState(workspacePath());
      setState(next);
      if (showSuccess) showToast({ tone: "ok", message: "状態を更新しました" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast({ tone: "danger", message: "状態確認に失敗しました", detail: message });
    } finally {
      setStateLoading(false);
    }
  };

  onMount(() => {
    void refreshState(false);
  });

  const chooseWorkspace = async () => {
    const selected = await pickWorkspaceFolder(workspacePath());
    if (!selected) return;
    setWorkspacePath(selected);
    saveWorkspacePath(selected);
    await refreshState(true);
  };

  const chooseOfficeFile = async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      defaultPath: firstNonEmpty(officeFilePath(), workspacePath()) || undefined,
      filters: [
        {
          name: "Office files",
          extensions: ["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    setOfficeFilePath(selected);
    setOfficeArgs(`view "${selected}" outline --json`);
  };

  const runSearch = async () => {
    const query = searchQuery().trim();
    const workspace = workspacePath().trim();
    if (!workspace) {
      showToast({ tone: "danger", message: "先にワークスペースを選択してください" });
      return;
    }
    if (!query) {
      showToast({ tone: "danger", message: "検索したい内容を入力してください" });
      return;
    }

    setSearching(true);
    setSearchResult(null);
    setSelectedCard(null);
    setSearchError("");
    setVisibleResultCount(24);
    const searchId = ++searchSequence;
    try {
      const result = await runRelayDocumentSearch({
        query,
        workspacePath: workspace,
        intent: "find_files",
        thoroughness: "thorough",
        evidence: "candidate",
        maxResults: 80,
        fileTypes: ["any"],
      });
      if (searchId !== searchSequence) return;
      setSearchResult(result);
      setSelectedCard(result.cards[0] ?? null);
      if (!result.ok) setSearchError(result.error || result.summary);
      appendActivity({
        mode: "search",
        title: query,
        status: result.ok ? "完了" : "失敗",
        detail: `${result.cards.length}件 / ${result.coverageLabel}`,
      });
      showToast({
        tone: result.ok ? "ok" : "danger",
        message: result.ok ? "検索が完了しました" : "検索に失敗しました",
        detail: result.summary,
      });
    } catch (error) {
      if (searchId !== searchSequence) return;
      const message = error instanceof Error ? error.message : String(error);
      setSearchError(message);
      showToast({ tone: "danger", message: "検索に失敗しました", detail: message });
      appendActivity({ mode: "search", title: query, status: "失敗", detail: message });
    } finally {
      if (searchId === searchSequence) {
        setSearching(false);
        void refreshState(false);
      }
    }
  };

  const inspectOffice = async () => {
    const filePath = officeFilePath().trim();
    if (!filePath) {
      showToast({ tone: "danger", message: "Officeファイルを選択してください" });
      return;
    }
    setOfficeRunning(true);
    try {
      const result = await inspectOfficeFile({ filePath });
      setOfficeResult(result);
      appendActivity({
        mode: "office",
        title: shortPath(filePath),
        status: result.ok ? "構造確認" : "失敗",
        detail: result.ok ? "outline --json" : result.stderr || result.error || "OfficeCLI failed",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast({ tone: "danger", message: "Office構造確認に失敗しました", detail: message });
    } finally {
      setOfficeRunning(false);
    }
  };

  const executeOffice = async () => {
    const filePath = officeFilePath().trim();
    const args = officeArgs().trim();
    if (!filePath || !args) {
      showToast({ tone: "danger", message: "OfficeファイルとOfficeCLI引数を入力してください" });
      return;
    }
    setOfficeRunning(true);
    try {
      const result = await executeOfficeCliCommand({
        filePath,
        officecliArgs: args,
        createBackup: true,
      });
      setOfficeResult(result);
      appendActivity({
        mode: "office",
        title: shortPath(filePath),
        status: result.ok ? "実行完了" : "失敗",
        detail: result.command.join(" "),
      });
      showToast({
        tone: result.ok ? "ok" : "danger",
        message: result.ok ? "OfficeCLIを実行しました" : "OfficeCLIが失敗しました",
        detail: result.backupPath ? `バックアップ: ${result.backupPath}` : result.error || undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast({ tone: "danger", message: "OfficeCLI実行に失敗しました", detail: message });
    } finally {
      setOfficeRunning(false);
      void refreshState(false);
    }
  };

  const checkCopilot = async () => {
    setCopilotChecking(true);
    try {
      const result = await warmupCopilotBridge(null);
      setCopilotMessage(result.connected ? "接続済み" : result.message);
      showToast({ tone: result.connected ? "ok" : "danger", message: result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCopilotMessage(message);
      showToast({ tone: "danger", message: "Copilot確認に失敗しました", detail: message });
    } finally {
      setCopilotChecking(false);
    }
  };

  const copyPath = async (path: string) => {
    await navigator.clipboard.writeText(path);
    showToast({ tone: "ok", message: "パスをコピーしました" });
  };

  return (
    <main class="relay-app-shell bg-[var(--ra-color-bg)] text-[var(--ra-color-text)]">
      <header class="relay-topbar">
        <div class="relay-brand">
          <div class="relay-brand__mark" aria-hidden="true">R</div>
          <div>
            <p class="relay-brand__name">Relay Agent</p>
            <p class="relay-brand__caption">Documents and Office tools</p>
          </div>
        </div>

        <div class="relay-mode-switch" role="tablist" aria-label="Relay task mode">
          <button
            type="button"
            classList={{ "is-active": mode() === "search" }}
            onClick={() => setMode("search")}
          >
            資料を探す
          </button>
          <button
            type="button"
            classList={{ "is-active": mode() === "office" }}
            onClick={() => setMode("office")}
          >
            Officeファイルを編集する
          </button>
        </div>

        <div class="relay-workspace-pill">
          <div>
            <p>Workspace</p>
            <strong title={workspacePath()}>{workspacePath() ? shortPath(workspacePath()) : "未選択"}</strong>
          </div>
          <button type="button" class="ra-button ra-button--secondary" onClick={chooseWorkspace}>
            変更
          </button>
        </div>
      </header>

      <section class="relay-workbench">
        <Show when={mode() === "search"} fallback={
          <section class="relay-work-panel">
            <div class="relay-panel-heading">
              <div>
                <p class="relay-kicker">OfficeCLI workflow</p>
                <h1>Officeファイルを安全に確認・編集する</h1>
                <p class="relay-panel-copy">構造確認、引数レビュー、バックアップ作成を同じ画面で行います。</p>
              </div>
              <button type="button" class="ra-button ra-button--secondary" onClick={chooseOfficeFile}>
                ファイルを選択
              </button>
            </div>

            <Show when={!workspaceReady()}>
              <div class="relay-state-panel relay-state-panel--warning">
                <strong>ワークスペースが未設定です</strong>
                <p>対象フォルダを選択すると、Officeファイル選択時の初期位置にも使われます。</p>
              </div>
            </Show>

            <div class="relay-form-grid">
              <label class="relay-field relay-field--wide">
                <span>対象ファイル</span>
                <input
                  value={officeFilePath()}
                  onInput={(event) => setOfficeFilePath(event.currentTarget.value)}
                  placeholder="C:/path/to/workbook.xlsx"
                />
              </label>
              <label class="relay-field relay-field--wide">
                <span>OfficeCLI引数</span>
                <textarea
                  rows="5"
                  value={officeArgs()}
                  onInput={(event) => setOfficeArgs(event.currentTarget.value)}
                  placeholder={`view "C:/path/file.xlsx" outline --json`}
                />
              </label>
            </div>

            <div class="relay-action-row">
              <button type="button" class="ra-button ra-button--secondary" disabled={officeRunning()} onClick={inspectOffice}>
                構造を確認
              </button>
              <button type="button" class="ra-button" disabled={officeRunning()} onClick={executeOffice}>
                {officeRunning() ? "実行中" : "バックアップして実行"}
              </button>
            </div>

            <Show when={officeRunning()}>
              <div class="relay-progress-panel" role="status" aria-live="polite">
                <span class="relay-spinner" aria-hidden="true" />
                <div>
                  <strong>OfficeCLI を実行しています</strong>
                  <p>完了までこの画面を開いたまま待機してください。</p>
                </div>
              </div>
            </Show>

            <Show when={officeResult()}>
              {(result) => (
                <section class="relay-result-block">
                  <div class="relay-result-header">
                    <h2>実行結果</h2>
                    <p class={statusTone(result().ok)}>{result().ok ? "成功" : "失敗"} · {result().elapsedMs}ms</p>
                  </div>
                  <Show when={result().backupPath}>
                    <p class="relay-hint">バックアップ: {result().backupPath}</p>
                  </Show>
                  <pre>{result().stdout || result().stderr || result().error || "No output"}</pre>
                </section>
              )}
            </Show>
          </section>
        }>
          <section class="relay-work-panel">
            <div class="relay-panel-heading">
              <div>
                <p class="relay-kicker">Document search</p>
                <h1>資料を探す</h1>
                <p class="relay-panel-copy">ファイル名、フォルダ構造、抽出済みメタデータを使って候補を整理します。検索は詳細モードに固定されています。</p>
              </div>
            </div>

            <Show when={!workspaceReady()}>
              <div class="relay-state-panel relay-state-panel--warning">
                <strong>ワークスペースを選択してください</strong>
                <p>検索対象のフォルダを選ぶまで、検索は実行できません。</p>
              </div>
            </Show>

            <div class="relay-search-box">
              <textarea
                rows="4"
                value={searchQuery()}
                onInput={(event) => setSearchQuery(event.currentTarget.value)}
                placeholder="例: 部品売上に関するファイルを探して"
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void runSearch();
                }}
              />
              <button type="button" class="ra-button relay-search-button" disabled={searching() || !workspaceReady()} onClick={runSearch}>
                {searching() ? "検索中" : "検索"}
              </button>
            </div>

            <Show when={searching()}>
              <div class="relay-progress-panel" role="status" aria-live="polite">
                <span class="relay-spinner" aria-hidden="true" />
                <div>
                  <strong>詳細検索を実行しています</strong>
                  <p>候補が多いフォルダでも UI は操作可能な状態を保ちます。</p>
                </div>
              </div>
            </Show>

            <Show when={searchError() && !searching()}>
              <div class="relay-state-panel relay-state-panel--danger">
                <strong>検索を完了できませんでした</strong>
                <p>{searchError()}</p>
              </div>
            </Show>

            <Show when={searchResult() && !searching() && resultCards().length === 0}>
              <div class="relay-state-panel">
                <strong>候補は見つかりませんでした</strong>
                <p>別名、略称、年度、対象部署などを加えて再検索してください。</p>
              </div>
            </Show>

            <Show when={searchResult() && resultCards().length > 0}>
              <section class="relay-result-block">
                <div class="relay-result-header">
                  <div>
                    <h2>検索結果</h2>
                    <p>{searchResult()?.summary}</p>
                  </div>
                  <p class={statusTone(Boolean(searchResult()?.ok))}>
                    {resultCards().length}件 · {searchResult()?.elapsedMs ?? 0}ms
                  </p>
                </div>
                <p class="relay-hint">{searchResult()?.coverageLabel}</p>
                <div class="relay-result-list">
                  <For each={visibleCards()}>
                    {(card) => (
                      <button
                        type="button"
                        class="relay-result-card"
                        classList={{ "is-active": activeCard()?.path === card.path }}
                        onClick={() => setSelectedCard(card)}
                      >
                        <div>
                          <p class="relay-result-card__title">{card.title}</p>
                          <p class="relay-result-card__path">{card.displayPath || card.path}</p>
                        </div>
                        <div class="relay-card-meta">
                          <span>{cardBucketLabel(card)}</span>
                          <span>{card.evidenceState || card.matchMode || "candidate"}</span>
                          <Show when={card.score != null}>
                            <span>{card.score}</span>
                          </Show>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
                <Show when={hasMoreCards()}>
                  <button
                    type="button"
                    class="relay-secondary-action relay-secondary-action--center"
                    onClick={() => setVisibleResultCount((count) => count + 24)}
                  >
                    さらに表示
                  </button>
                </Show>
              </section>
            </Show>
          </section>
        </Show>

        <details class="relay-runtime-details">
          <summary>状態と履歴</summary>
          <div class="relay-runtime-grid">
            <section>
              <div class="relay-section-heading">
                <p>Runtime</p>
                <button type="button" disabled={stateLoading()} onClick={() => refreshState(true)}>
                  更新
                </button>
              </div>
              <div class="relay-status-list">
                <p><span class={statusTone(Boolean(appState()?.documentSearchAvailable))}>●</span> Search</p>
                <p><span class={statusTone(Boolean(appState()?.officecliAvailable))}>●</span> OfficeCLI</p>
                <p><span class={statusTone(Boolean(appState()?.ripgrepAvailable))}>●</span> ripgrep</p>
                <p><span class="text-[var(--ra-color-text-muted)]">●</span> Copilot: {copilotMessage()}</p>
              </div>
              <button type="button" class="relay-secondary-action" disabled={copilotChecking()} onClick={checkCopilot}>
                {copilotChecking() ? "確認中" : "Copilot接続を確認"}
              </button>
            </section>
            <section>
              <p class="relay-sidebar-title">履歴</p>
              <Show when={activity().length > 0} fallback={<p class="relay-hint">実行履歴はまだありません。</p>}>
                <div class="relay-history-list">
                  <For each={activity().slice(0, 4)}>
                    {(item) => (
                      <button type="button" class="relay-history-item" onClick={() => setMode(item.mode)}>
                        <span>{item.status}</span>
                        <strong>{item.title}</strong>
                        <small>{item.at}</small>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </div>
        </details>
      </section>

      <aside class="relay-detail">
        <Show when={mode() === "search"} fallback={
          <section class="relay-detail-panel">
            <p class="relay-kicker">Applied steps</p>
            <h2>Office編集の安全確認</h2>
            <ol class="relay-step-list">
              <li>対象ファイルを選択</li>
              <li>構造確認でシート・ページ・範囲を確認</li>
              <li>OfficeCLI引数をレビュー</li>
              <li>バックアップを作成して実行</li>
            </ol>
            <p class="relay-hint">Officeファイルはテキスト置換ではなく、OfficeCLI経由でのみ変更します。</p>
          </section>
        }>
          <section class="relay-detail-panel">
            <p class="relay-kicker">Selected candidate</p>
            <Show when={activeCard()} fallback={<p class="relay-hint">検索結果を選択すると詳細が表示されます。</p>}>
              {(card) => (
                <>
                  <h2>{card().title}</h2>
                  <p class="relay-detail-path">{card().path}</p>
                  <div class="relay-detail-grid">
                    <p><span>分類</span>{cardBucketLabel(card())}</p>
                    <p><span>種類</span>{card().fileType || "-"}</p>
                    <p><span>根拠</span>{card().evidenceState || "-"}</p>
                    <p><span>更新</span>{card().modifiedTime || "-"}</p>
                  </div>
                  <div class="relay-action-row relay-action-row--compact">
                    <button type="button" class="ra-button ra-button--secondary" onClick={() => copyPath(card().path)}>
                      パスをコピー
                    </button>
                  </div>
                  <Show when={card().warnings.length > 0}>
                    <div class="relay-warning-list">
                      <For each={card().warnings}>
                        {(warning) => <p>{warning}</p>}
                      </For>
                    </div>
                  </Show>
                </>
              )}
            </Show>
          </section>
        </Show>
      </aside>

      <StatusToasts />
    </main>
  );
}
