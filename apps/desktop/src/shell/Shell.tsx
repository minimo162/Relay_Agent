/// <reference types="vite/client" />
import { open } from "@tauri-apps/plugin-dialog";
import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js";
import {
  applyCodePatch,
  cdpSendPrompt,
  collectCodeContext,
  executeOfficeCliCommand,
  getRelayWorkspaceState,
  inspectOfficeFile,
  runRelayDocumentSearch,
  warmupCopilotBridge,
  type RelayCodeContextResponse,
  type RelayCodePatchApplyResponse,
  type RelayDocumentSearchQueryPlanHints,
  type RelayDocumentSearchResponse,
  type RelayOfficeCommandResponse,
  type RelaySearchResultCard,
  type RelayWorkspaceState,
} from "../lib/ipc";
import {
  buildLocalDocumentSearchResultSummary,
  buildCodePatchPlanPrompt,
  buildDocumentSearchReflectionPrompt,
  buildDocumentSearchPlanPrompt,
  buildDocumentSearchResultSummaryPrompt,
  buildOfficeEditPlanPrompt,
  candidateIdForResultIndex,
  officePlanToArgs,
  validateDocumentSearchPlanText,
  validateDocumentSearchReflectionText,
  validateDocumentSearchResultSummaryText,
  validateCodePatchPlanText,
  validateOfficeEditPlanText,
  type RelayCodePatchPlan,
  type RelayDocumentSearchResultSummary,
  type RelayOfficeEditPlan,
} from "../lib/copilot-planners";
import { loadWorkspacePath, saveWorkspacePath } from "../lib/settings-storage";
import { showToast } from "../lib/status-toasts";
import { pickWorkspaceFolder } from "../lib/workspace-picker";
import { StatusToasts } from "../components/StatusToasts";

type Mode = "search" | "office" | "code";
type SearchPhase = "" | "planning" | "searching" | "reflecting" | "organizing";
type CodePhase = "" | "context" | "planning" | "applying";
type AgentRunPhase = "idle" | "understanding" | "planning" | "executing" | "observing" | "reflecting" | "finalizing" | "failed";
type AgentTraceStatus = "running" | "done" | "error";
type AgentTraceItem = {
  id: string;
  label: string;
  detail: string;
  status: AgentTraceStatus;
};
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
    concept_confirmed: "概念一致を確認",
    concept_candidate: "概念候補",
    entity_context_match: "名称文脈の候補",
    content_confirmed: "内容から確認",
    partial_content_match: "部分一致",
    generic_content_match: "汎用一致",
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
  const [searchWarning, setSearchWarning] = createSignal("");
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

  const [codeInstruction, setCodeInstruction] = createSignal("");
  const [codeRunning, setCodeRunning] = createSignal(false);
  const [codePhase, setCodePhase] = createSignal<CodePhase>("");
  const [codeContext, setCodeContext] = createSignal<RelayCodeContextResponse | null>(null);
  const [codePlan, setCodePlan] = createSignal<RelayCodePatchPlan | null>(null);
  const [codeApplyResult, setCodeApplyResult] = createSignal<RelayCodePatchApplyResponse | null>(null);
  const [codeError, setCodeError] = createSignal("");
  const [agentTrace, setAgentTrace] = createSignal<AgentTraceItem[]>([]);
  const [agentRunPhase, setAgentRunPhase] = createSignal<AgentRunPhase>("idle");

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
  const candidatePathById = (cards: RelaySearchResultCard[]) => new Map(
    cards.slice(0, 80).map((card, index) => [candidateIdForResultIndex(index), card.path] as const),
  );
  const searchProgressPercent = createMemo(() => {
    switch (searchPhase()) {
      case "planning":
        return 18;
      case "searching":
        return 62;
      case "reflecting":
        return 74;
      case "organizing":
        return 88;
      default:
        return 0;
    }
  });
  let searchSequence = 0;
  let agentTraceSequence = 0;

  const resetAgentTrace = () => {
    agentTraceSequence = 0;
    setAgentTrace([]);
    setAgentRunPhase("understanding");
  };

  const beginAgentStep = (label: string, detail = "") => {
    const id = `step-${++agentTraceSequence}`;
    setAgentTrace((items) => [...items, { id, label, detail, status: "running" }]);
    return id;
  };

  const finishAgentStep = (id: string, status: AgentTraceStatus, detail?: string) => {
    setAgentTrace((items) => items.map((item) => item.id === id
      ? { ...item, status, detail: detail ?? item.detail }
      : item));
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
    const traceId = beginAgentStep("Copilot", "検索語を整理");
    setAgentRunPhase("planning");
    setSearchPhase("planning");
    setSearchStatus("Copilotで検索語を整理しています");
    try {
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
      finishAgentStep(traceId, "done", validation.value.summary || "検索語を確定");
      return validation.value;
    } catch (error) {
      finishAgentStep(traceId, "error", friendlyErrorMessage(error));
      throw error;
    }
  };

  const organizeSearchSnapshot = async (
    query: string,
    workspace: string,
    snapshotId: string,
    result: RelayDocumentSearchResponse,
  ): Promise<RelayDocumentSearchResultSummary> => {
    const traceId = beginAgentStep("Copilot", "検索結果を整理");
    setAgentRunPhase("finalizing");
    setSearchPhase("organizing");
    setSearchStatus("Copilotで結果を整理しています");
    try {
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
        candidatePathById(result.cards),
      );
      if (!validation.ok) {
        throw new Error(`Copilot検索結果整理の検証に失敗しました: ${validation.errors.join(" / ")}`);
      }
      finishAgentStep(traceId, "done", validation.value.summary);
      return validation.value;
    } catch (error) {
      finishAgentStep(traceId, "error", friendlyErrorMessage(error));
      throw error;
    }
  };

  const shouldReflectSearchResult = (cards: RelaySearchResultCard[]): boolean => {
    const top = cards.slice(0, 12);
    if (top.length === 0) return false;
    const confirmed = top.filter((card) => ["content_confirmed", "concept_confirmed"].includes(card.evidenceState || "")).length;
    const weak = top.filter((card) => ["concept_candidate", "entity_context_match", "filename_only", "generic_content_match", "partial_content_match"].includes(card.evidenceState || card.matchMode || "")).length;
    return confirmed < Math.min(3, Math.ceil(top.length / 4)) && weak >= Math.ceil(top.length * 0.6);
  };

  const reflectSearchSnapshot = async (
    query: string,
    workspace: string,
    snapshotId: string,
    result: RelayDocumentSearchResponse,
    plan: RelayDocumentSearchQueryPlanHints,
  ) => {
    const traceId = beginAgentStep("Copilot", "検索結果を点検");
    setAgentRunPhase("reflecting");
    setSearchPhase("reflecting");
    setSearchStatus("検索結果の質を確認しています");
    try {
      await ensureCopilotReady();
      const prompt = buildDocumentSearchReflectionPrompt({
        rawQuery: query,
        snapshotId,
        workspacePath: workspace,
        localSummary: result.summary,
        coverageLabel: result.coverageLabel,
        queryPlan: plan,
        cards: result.cards,
      });
      const response = await cdpSendPrompt({ prompt, waitResponseSecs: 75 });
      if (!response.ok) {
        throw new Error(response.error || "Copilot から検索点検結果が返りませんでした。");
      }
      const validation = validateDocumentSearchReflectionText(response.responseText, query, snapshotId);
      if (!validation.ok) {
        throw new Error(`Copilot検索点検の検証に失敗しました: ${validation.errors.join(" / ")}`);
      }
      finishAgentStep(traceId, "done", validation.value.rationale);
      return validation.value;
    } catch (error) {
      finishAgentStep(traceId, "error", friendlyErrorMessage(error));
      throw error;
    }
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
    setSearchWarning("");
    setSearchStatus("");
    setSearchPhase("");
    resetAgentTrace();
    const searchId = ++searchSequence;
    try {
      const plan = await compileSearchPlan(query, workspace);
      if (searchId !== searchSequence) return;
      setAgentRunPhase("executing");
      setSearchPhase("searching");
      setSearchStatus("ローカル検索を実行しています");
      const traceId = beginAgentStep("Relay", "ローカル検索を実行");
      let result = await runRelayDocumentSearch({
        query,
        workspacePath: workspace,
        intent: "find_files",
        thoroughness: "thorough",
        evidence: "candidate",
        maxResults: refine ? 120 : 80,
        fileTypes: plan.fileTypeHints.length ? plan.fileTypeHints : ["any"],
        queryPlanHints: plan,
      });
      finishAgentStep(traceId, result.ok ? "done" : "error", result.coverageLabel || result.summary);
      if (searchId !== searchSequence) return;
      const snapshotId = `snapshot-${Date.now().toString(36)}-${searchId}`;
      let effectivePlan = plan;
      if (result.ok && result.cards.length > 0 && shouldReflectSearchResult(result.cards)) {
        try {
          const reflection = await reflectSearchSnapshot(query, workspace, snapshotId, result, effectivePlan);
          if (searchId !== searchSequence) return;
          if (reflection.action === "refine" && reflection.refinedTerms.length > 0) {
            effectivePlan = {
              ...effectivePlan,
              expandedTerms: [...new Set([...(effectivePlan.expandedTerms || []), ...reflection.refinedTerms])],
              supportTerms: [...new Set([...(effectivePlan.supportTerms || []), ...reflection.supportTerms])],
              demoteTerms: [...new Set([...(effectivePlan.demoteTerms || []), ...reflection.demoteTerms])],
              summary: reflection.summary || effectivePlan.summary,
            };
            setSearchPhase("searching");
            setSearchStatus("検索語を絞って再検索しています");
            const refineTraceId = beginAgentStep("Relay", "追加検索を実行");
            result = await runRelayDocumentSearch({
              query,
              workspacePath: workspace,
              intent: "find_files",
              thoroughness: "thorough",
              evidence: "candidate",
              maxResults: 120,
              fileTypes: effectivePlan.fileTypeHints.length ? effectivePlan.fileTypeHints : ["any"],
              queryPlanHints: effectivePlan,
            });
            finishAgentStep(refineTraceId, result.ok ? "done" : "error", result.coverageLabel || result.summary);
          }
        } catch (error) {
          if (searchId !== searchSequence) return;
          const message = friendlyErrorMessage(error);
          setSearchWarning(`検索結果の点検だけ完了できませんでした。ローカル検索結果は表示しています。詳細: ${message}`);
        }
      }
      if (searchId !== searchSequence) return;
      const localOrganizer = buildLocalDocumentSearchResultSummary({
        rawQuery: query,
        snapshotId,
        resultSummary: result.summary,
        coverageLabel: result.coverageLabel,
        cards: result.cards,
      });
      setSearchSnapshot({
        id: snapshotId,
        query,
        createdAt: new Date().toISOString(),
        result,
        organizer: localOrganizer,
      });
      setSelectedCard(result.cards[0] ?? null);
      if (!result.ok) setSearchError(result.error || result.summary);
      showToast({
        tone: result.ok ? "ok" : "danger",
        message: result.ok ? "検索結果を表示しました" : "検索に失敗しました",
        detail: localOrganizer.summary,
      });
      if (!result.ok || result.cards.length === 0) return;
      setAgentRunPhase("finalizing");
      try {
        const organizer = await organizeSearchSnapshot(query, workspace, snapshotId, result);
        if (searchId !== searchSequence) return;
        setSearchSnapshot((current) => current && current.id === snapshotId
          ? { ...current, organizer }
          : current);
        showToast({
          tone: "ok",
          message: "検索結果を整理しました",
          detail: organizer.summary,
        });
      } catch (error) {
        if (searchId !== searchSequence) return;
        const message = friendlyErrorMessage(error);
        setSearchWarning(`検索結果の整理だけ完了できませんでした。ローカル検索結果は表示しています。詳細: ${message}`);
        showToast({ tone: "warn", message: "結果整理をスキップしました", detail: message });
        return;
      }
    } catch (error) {
      if (searchId !== searchSequence) return;
      const message = friendlyErrorMessage(error);
      setAgentRunPhase("failed");
      setSearchError(message);
      showToast({ tone: "danger", message: "検索に失敗しました", detail: message });
    } finally {
      if (searchId === searchSequence) {
        setSearching(false);
        if (agentRunPhase() !== "failed") setAgentRunPhase("idle");
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
    const traceId = beginAgentStep("Relay", "Officeファイルを確認");
    const result = await inspectOfficeFile({ filePath });
    finishAgentStep(traceId, result.ok ? "done" : "error", result.ok ? "アウトラインを取得" : result.error || result.stderr);
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
    resetAgentTrace();
    setAgentRunPhase("planning");
    try {
      const outline = await inspectOffice();
      const traceId = beginAgentStep("Copilot", "編集内容をOfficeCLI操作へ変換");
      setOfficePhase("Copilotで変更内容を整理しています");
      try {
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
        finishAgentStep(traceId, "done", validation.value.summary || `${validation.value.commands.length}件の操作`);
      } catch (error) {
        finishAgentStep(traceId, "error", friendlyErrorMessage(error));
        throw error;
      }
      showToast({ tone: "ok", message: "変更内容を確認しました" });
    } catch (error) {
      const message = friendlyErrorMessage(error);
      setAgentRunPhase("failed");
      setOfficeError(message);
      showToast({ tone: "danger", message: "変更内容を確認できませんでした", detail: message });
    } finally {
      setOfficeRunning(false);
      if (agentRunPhase() !== "failed") setAgentRunPhase("idle");
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
    setAgentRunPhase("executing");
    setOfficePhase("バックアップを作成して適用しています");
    setOfficeError("");
    try {
      let lastResult: RelayOfficeCommandResponse | null = null;
      for (const [index, command] of plan.commands.entries()) {
        const traceId = beginAgentStep("Relay", command.summary || "OfficeCLIを実行");
        const result = await executeOfficeCliCommand({
          filePath,
          officecliArgs: officePlanToArgs(command),
          createBackup: index === 0,
        });
        finishAgentStep(traceId, result.ok ? "done" : "error", result.ok ? "適用済み" : result.error || result.stderr);
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
      setAgentRunPhase("failed");
      setOfficeError(message);
      showToast({ tone: "danger", message: "Office編集に失敗しました", detail: message });
    } finally {
      setOfficeRunning(false);
      if (agentRunPhase() !== "failed") setAgentRunPhase("idle");
      setOfficePhase("");
      void refreshState(false);
    }
  };

  const createCodePlan = async () => {
    const workspace = workspacePath().trim();
    const instruction = codeInstruction().trim();
    if (!workspace) {
      showToast({ tone: "danger", message: "先にワークスペースを選択してください" });
      return;
    }
    if (!instruction) {
      showToast({ tone: "danger", message: "変更したい内容を入力してください" });
      return;
    }
    setCodeRunning(true);
    setCodePhase("context");
    setCodeError("");
    setCodeContext(null);
    setCodePlan(null);
    setCodeApplyResult(null);
    resetAgentTrace();
    setAgentRunPhase("planning");
    try {
      const contextTraceId = beginAgentStep("Relay", "コード文脈を収集");
      setAgentRunPhase("observing");
      const context = await collectCodeContext({
        workspacePath: workspace,
        instruction,
        targetPaths: [],
        maxFiles: 8,
      });
      finishAgentStep(contextTraceId, context.ok ? "done" : "error", context.summary || context.error || undefined);
      setCodeContext(context);
      if (!context.ok || context.files.length === 0) {
        throw new Error(context.error || context.summary || "変更案に使えるコードファイルを確認できませんでした。");
      }
      setCodePhase("planning");
      setAgentRunPhase("planning");
      const planTraceId = beginAgentStep("Copilot", "コード変更案を作成");
      let nextPlan: RelayCodePatchPlan | null = null;
      try {
        await ensureCopilotReady();
        const prompt = buildCodePatchPlanPrompt({
          instruction,
          workspacePath: workspace,
          contextFiles: context.files,
        });
        const response = await cdpSendPrompt({ prompt, waitResponseSecs: 90 });
        if (!response.ok) throw new Error(response.error || "Copilot からコード変更案が返りませんでした。");
        const validation = validateCodePatchPlanText(
          response.responseText,
          instruction,
          workspace,
          new Set(context.files.map((file) => file.relativePath)),
        );
        if (!validation.ok) {
          throw new Error(`Copilotコード変更案の検証に失敗しました: ${validation.errors.join(" / ")}`);
        }
        nextPlan = validation.value;
        setCodePlan(nextPlan);
        finishAgentStep(planTraceId, "done", nextPlan.summary);
      } catch (error) {
        finishAgentStep(planTraceId, "error", friendlyErrorMessage(error));
        throw error;
      }
      if (!nextPlan) throw new Error("Copilot からコード変更案が返りませんでした。");
      showToast({
        tone: nextPlan.edits.length ? "ok" : "warn",
        message: nextPlan.edits.length ? "コード変更案を作成しました" : "安全に変更できる案はありませんでした",
        detail: nextPlan.summary,
      });
    } catch (error) {
      const message = friendlyErrorMessage(error);
      setAgentRunPhase("failed");
      setCodeError(message);
      showToast({ tone: "danger", message: "コード変更案を作成できませんでした", detail: message });
    } finally {
      setCodeRunning(false);
      if (agentRunPhase() !== "failed") setAgentRunPhase("idle");
      setCodePhase("");
    }
  };

  const applyCodePlan = async () => {
    const workspace = workspacePath().trim();
    const plan = codePlan();
    if (!workspace || !plan || plan.edits.length === 0) {
      showToast({ tone: "danger", message: "先にコード変更案を作成してください" });
      return;
    }
    setCodeRunning(true);
    setAgentRunPhase("executing");
    setCodePhase("applying");
    setCodeError("");
    setCodeApplyResult(null);
    try {
      const traceId = beginAgentStep("Relay", "コード差分を適用");
      const result = await applyCodePatch({
        workspacePath: workspace,
        edits: plan.edits,
      });
      finishAgentStep(traceId, result.ok ? "done" : "error", result.ok ? result.changedFiles.join(", ") : result.error || undefined);
      setCodeApplyResult(result);
      if (!result.ok) throw new Error(result.error || "コード差分の適用に失敗しました。");
      showToast({
        tone: "ok",
        message: "コード差分を適用しました",
        detail: result.changedFiles.join(", "),
      });
    } catch (error) {
      const message = friendlyErrorMessage(error);
      setAgentRunPhase("failed");
      setCodeError(message);
      showToast({ tone: "danger", message: "コード差分を適用できませんでした", detail: message });
    } finally {
      setCodeRunning(false);
      if (agentRunPhase() !== "failed") setAgentRunPhase("idle");
      setCodePhase("");
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
          <button
            type="button"
            classList={{ "is-active": mode() === "code" }}
            onClick={() => setMode("code")}
          >
            コードを書く
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
          <Show when={mode() === "office"} fallback={
            <section class="relay-work-panel">
              <div class="relay-panel-heading">
                <div>
                  <p class="relay-kicker">Code</p>
                  <h1>コードを書く</h1>
                </div>
              </div>

              <Show when={!workspaceReady()}>
                <div class="relay-state-panel relay-state-panel--warning">
                  <strong>ワークスペースを選択してください</strong>
                  <p>コード変更は選択したフォルダの内側だけに適用されます。</p>
                </div>
              </Show>

              <label class="relay-field relay-field--wide">
                <span>変更したい内容</span>
                <textarea
                  rows="7"
                  value={codeInstruction()}
                  onInput={(event) => {
                    setCodeInstruction(event.currentTarget.value);
                    setCodePlan(null);
                    setCodeApplyResult(null);
                    queueCopilotWarmup();
                  }}
                  onFocus={queueCopilotWarmup}
                  placeholder="例: README のセットアップ手順を今の仕様に合わせて更新して"
                />
              </label>

              <div class="relay-action-row">
                <button type="button" class="ra-button" disabled={codeRunning() || !workspaceReady() || !codeInstruction().trim()} onClick={createCodePlan}>
                  {codeRunning() && codePhase() !== "applying" ? "作成中" : "変更案を作成"}
                </button>
                <button type="button" class="ra-button ra-button--secondary" disabled={codeRunning() || !codePlan() || codePlan()?.edits.length === 0} onClick={applyCodePlan}>
                  差分を適用
                </button>
              </div>

              <Show when={codeRunning()}>
                <div class="relay-progress-panel" role="status" aria-live="polite">
                  <span class="relay-spinner" aria-hidden="true" />
                  <div>
                    <strong>
                      {codePhase() === "context"
                        ? "コード文脈を確認しています"
                        : codePhase() === "planning"
                          ? "Copilotで変更案を作成しています"
                          : "差分を適用しています"}
                    </strong>
                  </div>
                </div>
              </Show>

              <Show when={codeError() && !codeRunning()}>
                <div class="relay-state-panel relay-state-panel--danger">
                  <strong>完了できませんでした</strong>
                  <p>{codeError()}</p>
                </div>
              </Show>

              <Show when={codeContext()}>
                {(context) => (
                  <section class="relay-result-block">
                    <div class="relay-result-header">
                      <div>
                        <h2>確認したコード</h2>
                        <p>{context().summary}</p>
                      </div>
                      <p>{context().files.length}件 · {context().elapsedMs}ms</p>
                    </div>
                    <div class="relay-plan-list">
                      <For each={context().files}>
                        {(file) => (
                          <div class="relay-plan-item">
                            <strong>{file.relativePath}</strong>
                            <code>{file.language || "text"} · {file.score} · {file.truncated ? "一部のみ" : "全文"}</code>
                          </div>
                        )}
                      </For>
                    </div>
                  </section>
                )}
              </Show>

              <Show when={codePlan()}>
                {(plan) => (
                  <section class="relay-result-block">
                    <div class="relay-result-header">
                      <div>
                        <h2>変更案</h2>
                        <p>{plan().summary}</p>
                      </div>
                      <p>{plan().risk}</p>
                    </div>
                    <Show when={plan().edits.length === 0}>
                      <div class="relay-state-panel">
                        <strong>適用できる差分はありません</strong>
                        <p>対象ファイル名や変更箇所をもう少し具体的に入力してください。</p>
                      </div>
                    </Show>
                    <div class="relay-plan-list">
                      <For each={plan().edits}>
                        {(edit) => (
                          <div class="relay-plan-item">
                            <strong>{edit.relativePath}</strong>
                            <span>{edit.summary}</span>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={plan().verificationCommands.length}>
                      <div class="relay-plan-strip">
                        <span>確認コマンド候補</span>
                        <small>{plan().verificationCommands.join(" / ")}</small>
                      </div>
                    </Show>
                    <Show when={plan().doneCriteria.length}>
                      <div class="relay-plan-strip">
                        <span>完了条件</span>
                        <small>{plan().doneCriteria.join(" / ")}</small>
                      </div>
                    </Show>
                  </section>
                )}
              </Show>

              <Show when={codeApplyResult()}>
                {(result) => (
                  <section class="relay-result-block">
                    <div class="relay-result-header">
                      <h2>適用結果</h2>
                      <p class={statusTone(result().ok)}>{result().ok ? "成功" : "失敗"} · {result().elapsedMs}ms</p>
                    </div>
                    <Show when={result().changedFiles.length}>
                      <p class="relay-hint">{result().changedFiles.join(", ")}</p>
                    </Show>
                    <pre>{result().diff || result().diffStat || result().error || "No diff"}</pre>
                  </section>
                )}
              </Show>
            </section>
          }>
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
                {officeRunning() ? "処理中" : "変更を確認"}
              </button>
              <button type="button" class="ra-button ra-button--secondary" disabled={officeRunning() || !officePlan()} onClick={executeOfficePlan}>
                変更を適用
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
                      <For each={plan().operations}>
                        {(operation) => (
                          <div class="relay-plan-item">
                            <strong>{operation.summary}</strong>
                            <code>{operation.kind}{operation.sheet && operation.range ? ` · ${operation.sheet}!${operation.range}` : ""}</code>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={plan().ambiguities.length}>
                      <div class="relay-plan-strip">
                        <span>確認が必要な点</span>
                        <small>{plan().ambiguities.join(" / ")}</small>
                      </div>
                    </Show>
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
          </Show>
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
            <Show when={searchWarning()}>
              <div class="relay-state-panel">
                <strong>検索結果の整理を完了できませんでした</strong>
                <p>{searchWarning()}</p>
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
          <Show when={mode() === "office"} fallback={
            <section class="relay-detail-panel">
              <p class="relay-kicker">Code</p>
              <h2>{workspacePath() ? shortPath(workspacePath()) : "ワークスペース未選択"}</h2>
              <Show when={codePlan()} fallback={<p class="relay-hint">変更案を作成すると、編集対象と差分がここに表示されます。</p>}>
                {(plan) => (
                  <div class="relay-plan-list">
                    <For each={plan().edits}>
                      {(edit) => (
                        <div class="relay-plan-item">
                          <strong>{edit.relativePath}</strong>
                          <code>{edit.summary}</code>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </Show>
              <Show when={codeApplyResult()?.diffStat}>
                <pre>{codeApplyResult()?.diffStat}</pre>
              </Show>
            </section>
          }>
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
          </Show>
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
        <Show when={agentTrace().length}>
          <section class="relay-detail-panel relay-agent-trace-panel">
            <p class="relay-kicker">Flow</p>
            <div class="relay-agent-trace">
              <For each={agentTrace()}>
                {(item) => (
                  <div class="relay-agent-step" classList={{
                    "is-running": item.status === "running",
                    "is-done": item.status === "done",
                    "is-error": item.status === "error",
                  }}>
                    <span aria-hidden="true" />
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.detail}</p>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>
      </aside>

      <StatusToasts />
    </main>
  );
}
