/// <reference types="vite/client" />
import { open } from "@tauri-apps/plugin-dialog";
import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js";
import {
  cdpSendPrompt,
  executeOfficeCliCommand,
  getRelayWorkspaceState,
  inspectOfficeFile,
  runRelayDocumentSearch,
  warmupCopilotBridge,
  type RelayDocumentSearchQueryPlanHints,
  type RelayDocumentSearchResponse,
  type RelayOfficeCommandResponse,
  type RelaySearchResultCard,
  type RelayWorkspaceState,
} from "../lib/ipc";
import {
  buildDocumentSearchPlanPrompt,
  buildOfficeEditPlanPrompt,
  officePlanToArgs,
  validateDocumentSearchPlanText,
  validateOfficeEditPlanText,
  type RelayOfficeEditPlan,
} from "../lib/copilot-planners";
import { loadWorkspacePath, saveWorkspacePath } from "../lib/settings-storage";
import { showToast } from "../lib/status-toasts";
import { pickWorkspaceFolder } from "../lib/workspace-picker";
import { StatusToasts } from "../components/StatusToasts";

type Mode = "search" | "office";

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

function cardEvidenceLabel(card: RelaySearchResultCard): string {
  const evidence = card.evidenceState || card.matchMode || "";
  const labels: Record<string, string> = {
    content_confirmed: "中身確認済み",
    filename_only: "ファイル名候補",
    filename: "ファイル名候補",
    path: "パス候補",
    candidate: "候補",
  };
  return labels[evidence] || "候補";
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
  const [searchStatus, setSearchStatus] = createSignal("");
  const [searchPlan, setSearchPlan] = createSignal<RelayDocumentSearchQueryPlanHints | null>(null);
  const [visibleResultCount, setVisibleResultCount] = createSignal(24);

  const [officeFilePath, setOfficeFilePath] = createSignal("");
  const [officeInstruction, setOfficeInstruction] = createSignal("");
  const [officePlan, setOfficePlan] = createSignal<RelayOfficeEditPlan | null>(null);
  const [officeRunning, setOfficeRunning] = createSignal(false);
  const [officeResult, setOfficeResult] = createSignal<RelayOfficeCommandResponse | null>(null);
  const [officeError, setOfficeError] = createSignal("");

  const workspaceReady = createMemo(() => workspacePath().trim().length > 0);
  const activeCard = createMemo(() => selectedCard() || searchResult()?.cards[0] || null);
  const resultCards = createMemo(() => searchResult()?.cards ?? []);
  const visibleCards = createMemo(() => resultCards().slice(0, visibleResultCount()));
  const hasMoreCards = createMemo(() => resultCards().length > visibleResultCount());
  let searchSequence = 0;

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
    setOfficePlan(null);
    setOfficeResult(null);
    setOfficeError("");
  };

  const ensureCopilotReady = async () => {
    const warmup = await warmupCopilotBridge(null);
    if (!warmup.connected) {
      throw new Error(warmup.message || "Copilot に接続できませんでした。Edge で M365 Copilot にサインインしてから再実行してください。");
    }
  };

  const compileSearchPlan = async (query: string, workspace: string) => {
    setSearchStatus("Copilotで検索語を整理しています");
    await ensureCopilotReady();
    const prompt = buildDocumentSearchPlanPrompt({ userQuery: query, workspacePath: workspace });
    const response = await cdpSendPrompt({ prompt, waitResponseSecs: 75 });
    if (!response.ok) {
      throw new Error(response.error || "Copilot から検索計画が返りませんでした。");
    }
    const validation = validateDocumentSearchPlanText(response.responseText, query);
    if (!validation.ok) {
      throw new Error(`Copilot検索計画の検証に失敗しました: ${validation.errors.join(" / ")}`);
    }
    return validation.value;
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
    setSearchPlan(null);
    setSearchStatus("");
    setVisibleResultCount(24);
    const searchId = ++searchSequence;
    try {
      const plan = await compileSearchPlan(query, workspace);
      if (searchId !== searchSequence) return;
      setSearchPlan(plan);
      setSearchStatus("ローカル検索を実行しています");
      const result = await runRelayDocumentSearch({
        query,
        workspacePath: workspace,
        intent: "find_files",
        thoroughness: "thorough",
        evidence: "candidate",
        maxResults: 80,
        fileTypes: plan.fileTypeHints.length ? plan.fileTypeHints : ["any"],
        queryPlanHints: plan,
      });
      if (searchId !== searchSequence) return;
      setSearchResult(result);
      setSelectedCard(result.cards[0] ?? null);
      if (!result.ok) setSearchError(result.error || result.summary);
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
    } finally {
      if (searchId === searchSequence) {
        setSearching(false);
        setSearchStatus("");
        void refreshState(false);
      }
    }
  };

  const inspectOffice = async (): Promise<RelayOfficeCommandResponse> => {
    const filePath = officeFilePath().trim();
    if (!filePath) {
      throw new Error("Officeファイルを選択してください。");
    }
    const result = await inspectOfficeFile({ filePath });
    setOfficeResult(result);
    if (!result.ok) {
      throw new Error(result.stderr || result.error || "OfficeCLI outline failed.");
    }
    return result;
  };

  const planOfficeEdit = async () => {
    const filePath = officeFilePath().trim();
    const instruction = officeInstruction().trim();
    if (!filePath || !instruction) {
      showToast({ tone: "danger", message: "Officeファイルと編集内容を入力してください" });
      return;
    }
    setOfficeRunning(true);
    setOfficeError("");
    setOfficePlan(null);
    try {
      const outline = await inspectOffice();
      await ensureCopilotReady();
      const prompt = buildOfficeEditPlanPrompt({
        instruction,
        filePath,
        outlineJson: outline.stdout || outline.stderr || "",
      });
      const response = await cdpSendPrompt({ prompt, waitResponseSecs: 75 });
      if (!response.ok) throw new Error(response.error || "Copilot からOffice編集計画が返りませんでした。");
      const validation = validateOfficeEditPlanText(response.responseText, instruction, filePath);
      if (!validation.ok) {
        throw new Error(`Copilot Office編集計画の検証に失敗しました: ${validation.errors.join(" / ")}`);
      }
      setOfficePlan(validation.value);
      showToast({ tone: "ok", message: "編集案を作成しました" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOfficeError(message);
      showToast({ tone: "danger", message: "編集案を作成できませんでした", detail: message });
    } finally {
      setOfficeRunning(false);
      void refreshState(false);
    }
  };

  const executeOfficePlan = async () => {
    const filePath = officeFilePath().trim();
    const plan = officePlan();
    if (!filePath || !plan) {
      showToast({ tone: "danger", message: "先に編集案を作成してください" });
      return;
    }
    setOfficeRunning(true);
    setOfficeError("");
    try {
      let lastResult: RelayOfficeCommandResponse | null = null;
      for (const [index, command] of plan.commands.entries()) {
        const result = await executeOfficeCliCommand({
          filePath,
          officecliArgs: officePlanToArgs(command),
          createBackup: index === 0,
        });
        lastResult = result;
        setOfficeResult(result);
        if (!result.ok) {
          throw new Error(result.stderr || result.error || "OfficeCLI command failed.");
        }
      }
      showToast({
        tone: "ok",
        message: "Office編集を実行しました",
        detail: lastResult?.backupPath ? `バックアップ: ${lastResult.backupPath}` : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOfficeError(message);
      showToast({ tone: "danger", message: "Office編集に失敗しました", detail: message });
    } finally {
      setOfficeRunning(false);
      void refreshState(false);
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
                <p class="relay-kicker">Office</p>
                <h1>Officeファイルを編集する</h1>
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
                  placeholder="C:/path/to/file.xlsx"
                />
              </label>
              <label class="relay-field relay-field--wide">
                <span>編集内容</span>
                <textarea
                  rows="6"
                  value={officeInstruction()}
                  onInput={(event) => {
                    setOfficeInstruction(event.currentTarget.value);
                    setOfficePlan(null);
                  }}
                  placeholder="例: Sheet1 の A1 を確認して、見出しを「売上」に変更して"
                />
              </label>
            </div>

            <div class="relay-action-row">
              <button type="button" class="ra-button ra-button--secondary" disabled={officeRunning()} onClick={planOfficeEdit}>
                {officeRunning() ? "処理中" : "編集案を作成"}
              </button>
              <button type="button" class="ra-button" disabled={officeRunning() || !officePlan()} onClick={executeOfficePlan}>
                バックアップして実行
              </button>
            </div>

            <Show when={officeRunning()}>
              <div class="relay-progress-panel" role="status" aria-live="polite">
                <span class="relay-spinner" aria-hidden="true" />
                <div>
                  <strong>処理しています</strong>
                </div>
              </div>
            </Show>

            <Show when={officeError() && !officeRunning()}>
              <div class="relay-state-panel relay-state-panel--danger">
                <strong>完了できませんでした</strong>
                <p>{officeError()}</p>
              </div>
            </Show>

            <Show when={officePlan()}>
              {(plan) => (
                <section class="relay-result-block">
                  <div class="relay-result-header">
                    <div>
                      <h2>編集案</h2>
                      <p>{plan().summary || `${plan().commands.length}件のOfficeCLI操作`}</p>
                    </div>
                    <p>{plan().risk}</p>
                  </div>
                  <div class="relay-plan-list">
                    <For each={plan().commands}>
                      {(command) => (
                        <div class="relay-plan-item">
                          <strong>{command.summary}</strong>
                          <code>{officePlanToArgs(command)}</code>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              )}
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
                <p class="relay-kicker">Search</p>
                <h1>資料を探す</h1>
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
                  <strong>{searchStatus() || "検索しています"}</strong>
                </div>
              </div>
            </Show>

            <Show when={!searching() ? searchPlan() : null}>
              {(plan) => (
                <div class="relay-plan-strip">
                  <span>{plan().summary || "検索語を展開しました"}</span>
                  <small>{[...plan().expandedTerms, ...plan().supportTerms].slice(0, 8).join(" / ")}</small>
                </div>
              )}
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
                          <span>{cardEvidenceLabel(card)}</span>
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

      </section>

      <aside class="relay-detail">
        <Show when={mode() === "search"} fallback={
          <section class="relay-detail-panel">
            <p class="relay-kicker">Office</p>
            <h2>{officeFilePath() ? shortPath(officeFilePath()) : "ファイル未選択"}</h2>
            <Show when={officePlan()} fallback={<p class="relay-hint">編集案を作成すると、実行内容がここに表示されます。</p>}>
              {(plan) => (
                <div class="relay-plan-list">
                  <For each={plan().commands}>
                    {(command) => (
                      <div class="relay-plan-item">
                        <strong>{command.summary}</strong>
                        <code>{officePlanToArgs(command)}</code>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </Show>
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
                    <p><span>根拠</span>{cardEvidenceLabel(card())}</p>
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
