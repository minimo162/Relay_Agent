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
  type RelayDocumentSearchResponse,
  type RelayOfficeCommandResponse,
  type RelaySearchResultCard,
  type RelayWorkspaceState,
} from "../lib/ipc";
import {
  buildDocumentSearchPlanPrompt,
  buildDocumentSearchResultSummaryPrompt,
  buildOfficeEditPlanPrompt,
  officePlanToArgs,
  validateDocumentSearchPlanText,
  validateDocumentSearchResultSummaryText,
  validateOfficeEditPlanText,
  type RelayDocumentSearchResultSummary,
  type RelayOfficeEditPlan,
} from "../lib/copilot-planners";
import { loadWorkspacePath, saveWorkspacePath } from "../lib/settings-storage";
import { showToast } from "../lib/status-toasts";
import { pickWorkspaceFolder } from "../lib/workspace-picker";
import { StatusToasts } from "../components/StatusToasts";

type Mode = "search" | "office";
type SearchPhase = "" | "planning" | "searching" | "organizing";
type SearchSnapshot = {
  id: string;
  query: string;
  createdAt: string;
  result: RelayDocumentSearchResponse;
  organizer: RelayDocumentSearchResultSummary;
};

function shortPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

function statusTone(ok: boolean): string {
  return ok ? "text-[var(--ra-color-success)]" : "text-[var(--ra-color-danger)]";
}

function cardEvidenceLabel(card: RelaySearchResultCard): string {
  const evidence = card.evidenceState || card.matchMode || "";
  const labels: Record<string, string> = {
    content_confirmed: "内容から確認",
    content: "内容から確認",
    filename_only: "ファイル名・パスからの候補",
    filename: "ファイル名・パスからの候補",
    path: "パスからの候補",
    candidate: "候補",
  };
  return labels[evidence] || "候補";
}

function warningLabel(value: string): string {
  const labels: Record<string, string> = {
    filename_only: "内容までは未確認です",
    content_not_confirmed: "検索語が内容からは確認できませんでした",
    content_reader_unavailable: "内容確認に対応していない形式です",
    unsupported_content_reader: "内容確認に対応していない形式です",
    access_denied: "アクセスできませんでした",
    not_found: "ファイルが見つかりませんでした",
    offline_share: "共有フォルダがオフラインです",
    locked_file: "ファイルがロックされています",
    policy_denied: "ポリシーにより確認できませんでした",
  };
  return labels[value] || value.replaceAll("_", " ");
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return values.find((value) => value && value.trim())?.trim() || "";
}

function fileNameFromPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).at(-1) || path;
}

function friendlyErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/provider gateway is still starting/iu.test(message)) {
    return "Copilot接続を準備できませんでした。EdgeでMicrosoft 365 Copilotにサインインしてから、もう一度実行してください。";
  }
  if (/Copilot bridge send|Copilot bridge start|submit_not_observed|new_chat_not_ready|dom_response_timeout|network_seed/iu.test(message)) {
    return `Copilotへの送信または応答取得に失敗しました。EdgeでMicrosoft 365 Copilotが操作できる状態か確認してから、もう一度実行してください。詳細: ${message}`;
  }
  if (/CDP connect|composer not found|Copilot page may not be ready/iu.test(message)) {
    return "Copilotに接続できませんでした。EdgeでMicrosoft 365 Copilotを開いてサインインしてから、もう一度実行してください。";
  }
  return message;
}

export default function Shell(): JSX.Element {
  const [mode, setMode] = createSignal<Mode>("search");
  const [workspacePath, setWorkspacePath] = createSignal(loadWorkspacePath());
  const [state, setState] = createSignal<RelayWorkspaceState | null>(null);
  const [stateLoading, setStateLoading] = createSignal(false);

  const [searchQuery, setSearchQuery] = createSignal("");
  const [searching, setSearching] = createSignal(false);
  const [searchSnapshot, setSearchSnapshot] = createSignal<SearchSnapshot | null>(null);
  const [selectedCard, setSelectedCard] = createSignal<RelaySearchResultCard | null>(null);
  const [searchError, setSearchError] = createSignal("");
  const [searchStatus, setSearchStatus] = createSignal("");
  const [searchPhase, setSearchPhase] = createSignal<SearchPhase>("");
  const [visibleResultCount, setVisibleResultCount] = createSignal(24);

  const [officeFilePath, setOfficeFilePath] = createSignal("");
  const [officeInstruction, setOfficeInstruction] = createSignal("");
  const [officePlan, setOfficePlan] = createSignal<RelayOfficeEditPlan | null>(null);
  const [officeRunning, setOfficeRunning] = createSignal(false);
  const [officePhase, setOfficePhase] = createSignal("");
  const [officeInspectResult, setOfficeInspectResult] = createSignal<RelayOfficeCommandResponse | null>(null);
  const [officeApplyResult, setOfficeApplyResult] = createSignal<RelayOfficeCommandResponse | null>(null);
  const [officeError, setOfficeError] = createSignal("");

  const workspaceReady = createMemo(() => workspacePath().trim().length > 0);
  const activeCard = createMemo(() => selectedCard() || searchSnapshot()?.result.cards[0] || null);
  const resultCards = createMemo(() => searchSnapshot()?.result.cards ?? []);
  const visibleCards = createMemo(() => resultCards().slice(0, visibleResultCount()));
  const hasMoreCards = createMemo(() => resultCards().length > visibleResultCount());
  const searchCategoryByPath = createMemo(() => {
    const map = new Map<string, RelayDocumentSearchResultSummary["categories"][number]>();
    for (const category of searchSnapshot()?.organizer.categories ?? []) {
      for (const path of category.paths) map.set(path, category);
    }
    return map;
  });
  const searchProgressPercent = createMemo(() => {
    switch (searchPhase()) {
      case "planning":
        return 18;
      case "searching":
        return 62;
      case "organizing":
        return 88;
      default:
        return 0;
    }
  });
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
    queueCopilotWarmup();
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
    setOfficeInspectResult(null);
    setOfficeApplyResult(null);
    setOfficePlan(null);
    setOfficeError("");
  };

  let copilotWarmupPromise: Promise<void> | null = null;
  let copilotWarmupReadyAt = 0;
  let copilotBackgroundWarmupQueued = false;

  const ensureCopilotReady = async () => {
    const now = Date.now();
    if (copilotWarmupReadyAt > 0 && now - copilotWarmupReadyAt < 5 * 60 * 1000) return;
    if (!copilotWarmupPromise) {
      copilotWarmupPromise = warmupCopilotBridge()
        .then((result) => {
          if (!result.connected) {
            throw new Error(
              result.message ||
                "Copilot に接続できませんでした。Edge で M365 Copilot にサインインしてから再実行してください。",
            );
          }
          copilotWarmupReadyAt = Date.now();
        })
        .finally(() => {
          copilotWarmupPromise = null;
        });
    }
    await copilotWarmupPromise;
  };

  const queueCopilotWarmup = () => {
    if (!workspaceReady() || copilotBackgroundWarmupQueued) return;
    if (copilotWarmupReadyAt > 0 && Date.now() - copilotWarmupReadyAt < 5 * 60 * 1000) return;
    copilotBackgroundWarmupQueued = true;
    window.setTimeout(() => {
      copilotBackgroundWarmupQueued = false;
      void ensureCopilotReady().catch((error) => {
        console.debug("[Relay] Copilot background warmup skipped:", error);
      });
    }, 900);
  };

  onMount(() => {
    window.setTimeout(queueCopilotWarmup, 1200);
  });

  const compileSearchPlan = async (query: string, workspace: string) => {
    setSearchPhase("planning");
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

  const organizeSearchSnapshot = async (
    query: string,
    workspace: string,
    snapshotId: string,
    result: RelayDocumentSearchResponse,
  ): Promise<RelayDocumentSearchResultSummary> => {
    setSearchPhase("organizing");
    setSearchStatus("Copilotで結果を整理しています");
    await ensureCopilotReady();
    const prompt = buildDocumentSearchResultSummaryPrompt({
      rawQuery: query,
      snapshotId,
      workspacePath: workspace,
      localSummary: result.summary,
      coverageLabel: result.coverageLabel,
      cards: result.cards,
    });
    const response = await cdpSendPrompt({ prompt, waitResponseSecs: 75 });
    if (!response.ok) {
      throw new Error(response.error || "Copilot から検索結果の整理が返りませんでした。");
    }
    const validation = validateDocumentSearchResultSummaryText(
      response.responseText,
      query,
      snapshotId,
      result.cards.map((card) => card.path),
    );
    if (!validation.ok) {
      throw new Error(`Copilot検索結果整理の検証に失敗しました: ${validation.errors.join(" / ")}`);
    }
    return validation.value;
  };

  const runSearch = async (refine = false) => {
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
    if (!refine) {
      setSearchSnapshot(null);
      setSelectedCard(null);
      setVisibleResultCount(24);
    }
    setSearchError("");
    setSearchStatus("");
    setSearchPhase("");
    const searchId = ++searchSequence;
    try {
      const plan = await compileSearchPlan(query, workspace);
      if (searchId !== searchSequence) return;
      setSearchPhase("searching");
      setSearchStatus("ローカル検索を実行しています");
      const result = await runRelayDocumentSearch({
        query,
        workspacePath: workspace,
        intent: "find_files",
        thoroughness: "thorough",
        evidence: "candidate",
        maxResults: refine ? 120 : 80,
        fileTypes: plan.fileTypeHints.length ? plan.fileTypeHints : ["any"],
        queryPlanHints: plan,
      });
      if (searchId !== searchSequence) return;
      const snapshotId = `snapshot-${Date.now().toString(36)}-${searchId}`;
      const organizer = await organizeSearchSnapshot(query, workspace, snapshotId, result);
      if (searchId !== searchSequence) return;
      setSearchSnapshot({
        id: snapshotId,
        query,
        createdAt: new Date().toISOString(),
        result,
        organizer,
      });
      setSelectedCard(result.cards[0] ?? null);
      if (!result.ok) setSearchError(result.error || result.summary);
      showToast({
        tone: result.ok ? "ok" : "danger",
        message: result.ok ? "検索が完了しました" : "検索に失敗しました",
        detail: organizer.summary,
      });
    } catch (error) {
      if (searchId !== searchSequence) return;
      const message = friendlyErrorMessage(error);
      setSearchError(message);
      showToast({ tone: "danger", message: "検索に失敗しました", detail: message });
    } finally {
      if (searchId === searchSequence) {
        setSearching(false);
        setSearchStatus("");
        setSearchPhase("");
        void refreshState(false);
      }
    }
  };

  const inspectOffice = async (): Promise<RelayOfficeCommandResponse> => {
    const filePath = officeFilePath().trim();
    if (!filePath) {
      throw new Error("Officeファイルを選択してください。");
    }
    setOfficePhase("ファイルを確認しています");
    const result = await inspectOfficeFile({ filePath });
    setOfficeInspectResult(result);
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
    setOfficePhase("変更内容を確認しています");
    setOfficeError("");
    setOfficePlan(null);
    setOfficeApplyResult(null);
    try {
      const outline = await inspectOffice();
      setOfficePhase("Copilotで変更内容を整理しています");
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
      showToast({ tone: "ok", message: "変更内容を確認しました" });
    } catch (error) {
      const message = friendlyErrorMessage(error);
      setOfficeError(message);
      showToast({ tone: "danger", message: "変更内容を確認できませんでした", detail: message });
    } finally {
      setOfficeRunning(false);
      setOfficePhase("");
      void refreshState(false);
    }
  };

  const executeOfficePlan = async () => {
    const filePath = officeFilePath().trim();
    const plan = officePlan();
    if (!filePath || !plan) {
      showToast({ tone: "danger", message: "先に変更内容を確認してください" });
      return;
    }
    setOfficeRunning(true);
    setOfficePhase("バックアップを作成して適用しています");
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
        setOfficeApplyResult(result);
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
      const message = friendlyErrorMessage(error);
      setOfficeError(message);
      showToast({ tone: "danger", message: "Office編集に失敗しました", detail: message });
    } finally {
      setOfficeRunning(false);
      setOfficePhase("");
      void refreshState(false);
    }
  };

  const copyPath = async (path: string) => {
    await navigator.clipboard.writeText(path);
    showToast({ tone: "ok", message: "パスをコピーしました" });
  };

  const categoryLabelForCard = (card: RelaySearchResultCard): string => {
    return searchCategoryByPath().get(card.path)?.label || "候補";
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
            </div>

            <Show when={!workspaceReady()}>
              <div class="relay-state-panel relay-state-panel--warning">
                <strong>ワークスペースが未設定です</strong>
                <p>対象フォルダを選択すると、Officeファイル選択時の初期位置にも使われます。</p>
              </div>
            </Show>

            <section class="relay-file-picker" classList={{ "is-empty": !officeFilePath() }}>
              <div>
                <p class="relay-kicker">対象ファイル</p>
                <h2>{officeFilePath() ? fileNameFromPath(officeFilePath()) : "Officeファイルを選択"}</h2>
                <p title={officeFilePath()}>{officeFilePath() || "編集する .xlsx / .xlsm / .docx / .pptx を選択してください。"}</p>
              </div>
              <button type="button" class="ra-button ra-button--secondary" onClick={chooseOfficeFile}>
                選択
              </button>
            </section>

            <div class="relay-form-grid">
              <label class="relay-field relay-field--wide relay-field--quiet">
                <span>ファイルパス</span>
                <input
                  value={officeFilePath()}
                  onInput={(event) => {
                    setOfficeFilePath(event.currentTarget.value);
                    setOfficeInspectResult(null);
                    setOfficeApplyResult(null);
                    setOfficePlan(null);
                  }}
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
                    queueCopilotWarmup();
                  }}
                  onFocus={queueCopilotWarmup}
                  placeholder="例: Sheet1 の A1 を確認して、見出しを「売上」に変更して"
                />
              </label>
            </div>

            <div class="relay-action-row">
              <button type="button" class="ra-button" disabled={officeRunning() || !officeFilePath().trim() || !officeInstruction().trim()} onClick={planOfficeEdit}>
                {officeRunning() ? "処理中" : "変更内容を確認"}
              </button>
              <button type="button" class="ra-button ra-button--secondary" disabled={officeRunning() || !officePlan()} onClick={executeOfficePlan}>
                バックアップを作成して適用
              </button>
            </div>

            <Show when={officeRunning()}>
              <div class="relay-progress-panel" role="status" aria-live="polite">
                <span class="relay-spinner" aria-hidden="true" />
                <div>
                  <strong>{officePhase() || "処理しています"}</strong>
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
                      <h2>確認した変更内容</h2>
                      <p>{plan().summary || `${plan().commands.length}件の変更操作`}</p>
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

            <Show when={officeApplyResult()}>
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
                onInput={(event) => {
                  setSearchQuery(event.currentTarget.value);
                  queueCopilotWarmup();
                }}
                onFocus={queueCopilotWarmup}
                placeholder="例: 部品売上に関するファイルを探して"
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void runSearch();
                }}
              />
              <button type="button" class="ra-button relay-search-button" disabled={searching() || !workspaceReady() || !searchQuery().trim()} onClick={() => void runSearch()}>
                {searching() ? "検索中" : "検索"}
              </button>
            </div>

            <Show when={searching()}>
              <div class="relay-progress-panel" role="status" aria-live="polite">
                <span class="relay-spinner" aria-hidden="true" />
                <div>
                  <strong>{searchStatus() || "検索しています"}</strong>
                  <div class="relay-progress-bar" aria-hidden="true">
                    <span style={{ width: `${searchProgressPercent()}%` }} />
                  </div>
                </div>
              </div>
            </Show>

            <Show when={searchError() && !searching()}>
              <div class="relay-state-panel relay-state-panel--danger">
                <strong>検索を完了できませんでした</strong>
                <p>{searchError()}</p>
              </div>
            </Show>

            <Show when={searchSnapshot() && !searching() && resultCards().length === 0}>
              <div class="relay-state-panel">
                <strong>候補は見つかりませんでした</strong>
                <p>別名、略称、年度、対象部署などを加えて再検索してください。</p>
              </div>
            </Show>

            <Show when={searchSnapshot() && resultCards().length > 0}>
              <section class="relay-result-block">
                <div class="relay-result-header">
                  <div>
                    <h2>検索結果</h2>
                    <p>{searchSnapshot()?.organizer.summary}</p>
                  </div>
                  <div class="relay-result-header__actions">
                    <p class={statusTone(Boolean(searchSnapshot()?.result.ok))}>
                      {resultCards().length}件 · {searchSnapshot()?.result.elapsedMs ?? 0}ms
                    </p>
                    <button
                      type="button"
                      class="relay-secondary-action"
                      disabled={searching()}
                      onClick={() => void runSearch(true)}
                    >
                      さらに詳しく調べる
                    </button>
                  </div>
                </div>
                <p class="relay-hint">{searchSnapshot()?.result.coverageLabel}</p>
                <Show when={searchSnapshot()?.organizer.categories.length}>
                  <div class="relay-category-strip">
                    <For each={searchSnapshot()?.organizer.categories ?? []}>
                      {(category) => (
                        <span title={category.rationale}>
                          {category.label}
                          <small>{category.paths.length}</small>
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={searchSnapshot()?.organizer.caveats.length}>
                  <div class="relay-caveat-list">
                    <For each={searchSnapshot()?.organizer.caveats ?? []}>
                      {(caveat) => <p>{caveat}</p>}
                    </For>
                  </div>
                </Show>
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
                          <span>{categoryLabelForCard(card)}</span>
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
                    表示件数を増やす
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
            <Show when={officeInspectResult()}>
              {(result) => (
                <div class="relay-mini-status" classList={{ "is-ok": result().ok, "is-danger": !result().ok }}>
                  {result().ok ? "ファイル確認済み" : "ファイル確認に失敗"}
                </div>
              )}
            </Show>
            <Show when={officePlan()} fallback={<p class="relay-hint">変更内容を確認すると、実行内容がここに表示されます。</p>}>
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
            <p class="relay-kicker">Candidate</p>
            <Show when={activeCard()} fallback={<p class="relay-hint">検索結果を選択すると詳細が表示されます。</p>}>
              {(card) => (
                <>
                  <h2>{card().title}</h2>
                  <p class="relay-detail-path">{card().path}</p>
                  <div class="relay-detail-grid">
                    <p><span>分類</span>{categoryLabelForCard(card())}</p>
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
                        {(warning) => <p>{warningLabel(warning)}</p>}
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
