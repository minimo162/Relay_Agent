<script lang="ts">
  import { browser } from "$app/environment";
  import { beforeNavigate, goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import {
    projectInfo,
    type AssessCopilotHandoffResponse,
    type ApprovalDecision,
    type PreviewExecutionResponse,
    type ReadTurnArtifactsResponse,
    type RespondToApprovalResponse,
    type RunExecutionResponse,
    type TurnArtifact,
    type TurnDetailsViewModel,
    type SessionDetail,
    type SubmitCopilotResponseResponse,
    type Turn,
    type ValidationIssue
  } from "@relay-agent/contracts";
  import { get } from "svelte/store";

  import {
    assessCopilotHandoff,
    discardStudioDraft,
    generateRelayPacket,
    listAuditHistory,
    loadStudioDraft,
    markStudioDraftClean,
    previewExecution,
    readSession,
    readTurnArtifacts,
    rememberAuditHistory,
    rememberRecentFile,
    rememberRecentSession,
    respondToApproval,
    runExecution,
    saveStudioDraft,
    startTurn,
    submitCopilotResponse,
    type AuditHistoryEntry,
    type PersistedPreviewSnapshot
  } from "$lib";
  import { createStudioState, type StudioState } from "$lib/studio-state";

  type RelayMode = "discover" | "plan" | "repair" | "followup";
  type StudioTimelineTone = "pending" | "active" | "ready";
  type StudioTimelineEntry = {
    id: string;
    label: string;
    note: string;
    tone: StudioTimelineTone;
  };
  type HelpEntry = {
    term: string;
    detail: string;
    action: string;
  };
  type RecoveryGuidance = {
    problem: string;
    reason: string;
    nextSteps: string[];
    followupPrompt?: string;
  };
  type TurnDetailsTab = "overview" | "packet" | "validation" | "approval" | "execution";
  type TurnDetailSection =
    | TurnDetailsViewModel["packet"]
    | TurnDetailsViewModel["validation"]
    | TurnDetailsViewModel["approval"]
    | TurnDetailsViewModel["execution"];
  type PendingStudioAction =
    | {
        kind: "route-leave";
        href: string;
        targetLabel: string;
      }
    | {
        kind: "new-turn";
      }
    | {
        kind: "switch-turn";
        turnId: string;
        turnTitle: string;
      };

  const studio = createStudioState();
  const studioState = studio.state;
  const relayModes = projectInfo.supportedRelayModes;
  const turnDetailsTabs: TurnDetailsTab[] = [
    "overview",
    "packet",
    "validation",
    "approval",
    "execution"
  ];

  let currentSessionId: string | null = null;
  let routeSessionId: string | null = null;
  let routeTurnId: string | null = null;
  let reviewerMode = false;
  let loadedRouteKey = "";
  let sessionDetail: SessionDetail | null = null;
  let selectedTurnId: string | null = null;
  let restoredPreviewSnapshot: PersistedPreviewSnapshot | null = null;
  let previewSnapshot: PersistedPreviewSnapshot | null = null;
  let auditHistoryEntries: AuditHistoryEntry[] = [];
  let auditHistoryEntry: AuditHistoryEntry | null = null;
  let turnArtifacts: TurnArtifact[] = [];
  let turnDetails: TurnDetailsViewModel | null = null;
  let selectedArtifactId: string | null = null;
  let selectedArtifact: TurnArtifact | null = null;
  let selectedTurnDetailsTab: TurnDetailsTab = "overview";
  let artifactLoading = false;
  let artifactError = "";
  let artifactKey = "";
  let lastArtifactKey = "";
  let continuityNotice = "";
  let draftPersistenceEnabled = false;
  let pendingStudioAction: PendingStudioAction | null = null;
  let bypassNavigationGuard = false;
  let studioHelpOpen = false;

  let sessionLoading = false;
  let startTurnPending = false;
  let packetPending = false;
  let validationPending = false;
  let previewPending = false;
  let approvalPending = false;
  let executionPending = false;

  let sessionNotice = "";
  let sessionError = "";
  let packetError = "";
  let validationError = "";
  let previewError = "";
  let approvalError = "";
  let executionError = "";

  let relayPacketText = "";
  let relayPacketSummary = "";
  let handoffAssessment: AssessCopilotHandoffResponse | null = null;
  let handoffCheckPending = false;
  let handoffCopyMessage = "";
  let handoffCopyError = "";
  let handoffCopyRequiresConfirm = false;
  let validationSummary = "";
  let previewSummary = "";
  let approvalSummary = "";
  let executionSummary = "";
  let approvalNote = "";
  let followupCopyMessage = "";
  let followupCopyError = "";
  let reviewerCopyMessage = "";
  let reviewerCopyError = "";

  let validationResult: SubmitCopilotResponseResponse | null = null;
  let previewResult: PreviewExecutionResponse | null = null;
  let approvalResult: RespondToApprovalResponse | null = null;
  let executionResult: RunExecutionResponse | null = null;
  let validationGuidance: RecoveryGuidance | null = null;
  let previewGuidance: RecoveryGuidance | null = null;
  let reviewGuidance: RecoveryGuidance | null = null;
  let reviewFailureReason = "";

  let lastLoadToken = 0;
  let lastRawResponse = "";

  function normalizeWorkbookFocus(value: string): string {
    return value.trim() || "Sheet1";
  }

  function hasDraftFieldChanges(
    state: StudioState,
    turn: Turn | null,
    detail: SessionDetail | null
  ): boolean {
    const baselineTitle = turn?.title ?? "";
    const baselineObjective = turn?.objective ?? "";
    const baselineMode = turn?.mode ?? "plan";
    const baselineWorkbookPath = detail?.session.primaryWorkbookPath ?? "";
    const baselineFocus = "Sheet1";

    return (
      state.turnTitle.trim() !== baselineTitle.trim()
      || state.turnObjective.trim() !== baselineObjective.trim()
      || state.relayMode !== baselineMode
      || state.workbookPath.trim() !== baselineWorkbookPath.trim()
      || normalizeWorkbookFocus(state.workbookFocus) !== baselineFocus
    );
  }

  function hasMeaningfulStudioDraftState(
    state: StudioState,
    turn: Turn | null,
    detail: SessionDetail | null
  ): boolean {
    return Boolean(
      hasDraftFieldChanges(state, turn, detail)
        || relayPacketText.trim()
        || state.rawResponse.trim()
        || validationSummary.trim()
        || previewSummary.trim()
        || approvalSummary.trim()
        || executionSummary.trim()
        || previewSnapshot
    );
  }

  function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "The Studio request failed before the command could finish.";
  }

  function sortTurns(turns: Turn[]): Turn[] {
    return [...turns].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function formatIssuePath(path: ValidationIssue["path"]): string {
    if (path.length === 0) {
      return "root";
    }

    return path.reduce<string>((result, segment) => {
      if (typeof segment === "number") {
        return `${result}[${segment}]`;
      }

      return result ? `${result}.${segment}` : segment;
    }, "");
  }

  function artifactLabel(artifact: TurnArtifact): string {
    switch (artifact.artifactType) {
      case "workbook-profile":
        return "Workbook profile";
      case "sheet-preview":
        return "Sheet preview";
      case "column-profile":
        return "Column profile";
      case "diff-summary":
        return "Diff from base";
      case "preview":
        return "Checked changes snapshot";
    }
  }

  function artifactSummary(artifact: TurnArtifact): string {
    switch (artifact.artifactType) {
      case "workbook-profile":
        return `${artifact.payload.sheetCount} sheet${artifact.payload.sheetCount === 1 ? "" : "s"} in ${artifact.payload.format.toUpperCase()}`;
      case "sheet-preview":
        return `${artifact.payload.rows.length} sampled row${artifact.payload.rows.length === 1 ? "" : "s"} from ${artifact.payload.sheet}`;
      case "column-profile":
        return `${artifact.payload.columns.length} column${artifact.payload.columns.length === 1 ? "" : "s"} profiled on ${artifact.payload.sheet}`;
      case "diff-summary":
        return `${artifact.payload.targetCount} target${artifact.payload.targetCount === 1 ? "" : "s"} and ${artifact.payload.estimatedAffectedRows} affected row${artifact.payload.estimatedAffectedRows === 1 ? "" : "s"}`;
      case "preview":
        return `${artifact.payload.diffSummary.targetCount} target${artifact.payload.diffSummary.targetCount === 1 ? "" : "s"} with ${artifact.payload.requiresApproval ? "approval required" : "review only"}`;
    }
  }

  function turnDetailsTabLabel(tab: TurnDetailsTab): string {
    switch (tab) {
      case "overview":
        return "Overview";
      case "packet":
        return "Packet";
      case "validation":
        return "Validation";
      case "approval":
        return "Approval";
      case "execution":
        return "Execution";
    }
  }

  function turnDetailsTabSummary(tab: TurnDetailsTab, details: TurnDetailsViewModel | null): string {
    if (!details) {
      return "";
    }

    switch (tab) {
      case "overview":
        return details.overview.summary;
      case "packet":
        return details.packet.summary;
      case "validation":
        return details.validation.summary;
      case "approval":
        return details.approval.summary;
      case "execution":
        return details.execution.summary;
    }
  }

  function inspectionSourceLabel(sourceType?: TurnDetailSection["sourceType"]): string {
    switch (sourceType) {
      case "live":
        return "Live current turn";
      case "persisted":
        return "Saved locally";
      case "mixed":
        return "Live + saved";
      default:
        return "Unavailable";
    }
  }

  function overviewStepTone(state: TurnDetailsViewModel["overview"]["steps"][number]["state"]): string {
    switch (state) {
      case "complete":
        return "status-ready";
      case "failed":
        return "status-failed";
      case "current":
        return "status-pending";
      case "notRequired":
        return "status-ready";
      default:
        return "status-pending";
    }
  }

  function resetArtifactBrowser(): void {
    turnDetails = null;
    turnArtifacts = [];
    selectedArtifactId = null;
    selectedTurnDetailsTab = "overview";
    artifactLoading = false;
    artifactError = "";
  }

  async function loadArtifactsForTurn(
    sessionId: string,
    turnId: string
  ): Promise<void> {
    artifactLoading = true;
    artifactError = "";

    try {
      const response: ReadTurnArtifactsResponse = await readTurnArtifacts({
        sessionId,
        turnId
      });
      turnDetails = response.turnDetails;
      turnArtifacts = response.artifacts;

      if (!response.artifacts.some((artifact) => artifact.artifactId === selectedArtifactId)) {
        selectedArtifactId = response.artifacts[0]?.artifactId ?? null;
      }
    } catch (error) {
      turnDetails = null;
      turnArtifacts = [];
      selectedArtifactId = null;
      artifactError = toErrorMessage(error);
    } finally {
      artifactLoading = false;
    }
  }

  function dedupeStrings(values: string[]): string[] {
    return [...new Set(values.filter((value) => value.trim().length > 0))];
  }

  function buildCopilotRetryPrompt(reason: string): string {
    const objective =
      selectedTurn?.objective || $studioState.turnObjective || "Keep the same workbook goal.";

    return [
      "Please revise the previous Relay Agent response.",
      `Goal: ${objective}`,
      `Issue to fix: ${reason}`,
      "Requirements:",
      "- Return strict JSON only.",
      "- Stay within the tools Relay Agent listed in the packet.",
      "- Keep the original workbook read-only.",
      "- If you save a copy, use a different output path from the source workbook."
    ].join("\n");
  }

  function suggestNextSteps(
    stage: "validation" | "preview" | "review",
    reason: string,
    hasFollowupPrompt: boolean
  ): string[] {
    const lowerReason = reason.toLowerCase();
    const steps: string[] = [];

    if (stage === "validation") {
      steps.push(
        hasFollowupPrompt
          ? "Copy the follow-up prompt back to Copilot or fix the JSON manually."
          : "Ask Copilot for a corrected JSON response or fix the pasted response manually."
      );
      steps.push("Replace the pasted response with the repaired JSON.");
      steps.push("Run Validate response again.");
    } else if (stage === "preview") {
      steps.push("Review the issue below and ask Copilot for a revised response.");
      steps.push("Run Check changes again after the revised response passes validation.");
    } else {
      steps.push("Review the save issue below before trying again.");
      steps.push("If needed, ask Copilot for a revised response that keeps the original workbook read-only.");
      steps.push("Check the changes again before saving the reviewed copy.");
    }

    if (lowerReason.includes("json") || lowerReason.includes("parse")) {
      steps.unshift("Ask Copilot to return strict JSON only, without markdown or extra commentary.");
    }

    if (
      lowerReason.includes("output path")
      || lowerReason.includes("source path")
      || lowerReason.includes("same file")
    ) {
      steps.unshift("Use a different file name or folder for the reviewed copy so the original file stays unchanged.");
    }

    if (lowerReason.includes("unsupported")) {
      steps.unshift("Ask Copilot to stay within the supported tools listed in the request packet.");
    }

    if (lowerReason.includes("approval")) {
      steps.unshift("Confirm the review step again after checking the summary.");
    }

    return dedupeStrings(steps).slice(0, 3);
  }

  function buildDemoOutputPath(sourcePath: string): string {
    const normalized = sourcePath.trim();

    if (!normalized) {
      return "/absolute/path/to/revenue-workflow-demo.guided.csv";
    }

    const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    const directory = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
    const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
    const extensionIndex = fileName.lastIndexOf(".");
    const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;

    return `${directory}${baseName}.guided-demo.csv`;
  }

  function fileNameFromPath(path: string): string {
    const normalized = path.trim();
    if (!normalized) {
      return "";
    }

    const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  }

  function directoryFromPath(path: string): string {
    const normalized = path.trim();
    if (!normalized) {
      return "";
    }

    const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    return lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
  }

  function buildDemoResponse(sourcePath: string): string {
    return JSON.stringify(
      {
        version: "1.0",
        summary: "Keep approved rows, add a review label, and write a sanitized CSV copy.",
        actions: [
          {
            tool: "table.filter_rows",
            sheet: "Sheet1",
            args: {
              predicate: "approved = true"
            }
          },
          {
            tool: "table.derive_column",
            sheet: "Sheet1",
            args: {
              column: "review_label",
              expression: "[segment] + \"-approved\"",
              position: "end"
            }
          },
          {
            tool: "workbook.save_copy",
            args: {
              outputPath: buildDemoOutputPath(sourcePath)
            }
          }
        ],
        followupQuestions: [],
        warnings: []
      },
      null,
      2
    );
  }

  function buildPreviewSnapshot(
    result: PreviewExecutionResponse | null
  ): PersistedPreviewSnapshot | null {
    if (!result) {
      return null;
    }

    return {
      sourcePath: result.diffSummary.sourcePath,
      outputPath: result.diffSummary.outputPath,
      targetCount: result.diffSummary.targetCount,
      estimatedAffectedRows: result.diffSummary.estimatedAffectedRows,
      warnings: result.warnings,
      requiresApproval: result.requiresApproval,
      lastGeneratedAt: new Date().toISOString()
    };
  }

  function describePendingAction(action: PendingStudioAction): string {
    if (action.kind === "route-leave") {
      return `Open ${action.targetLabel}`;
    }

    if (action.kind === "switch-turn") {
      return `Switch to "${action.turnTitle}"`;
    }

    return "Start a fresh turn";
  }

  function queuePendingStudioAction(action: PendingStudioAction): void {
    pendingStudioAction = action;
  }

  function closePendingStudioAction(): void {
    pendingStudioAction = null;
  }

  async function continueWithRouteLeave(discardDraft: boolean): Promise<void> {
    if (!currentSessionId || !pendingStudioAction || pendingStudioAction.kind !== "route-leave") {
      return;
    }

    const { href } = pendingStudioAction;

    if (discardDraft) {
      discardStudioDraft(currentSessionId);
    } else {
      markStudioDraftClean(currentSessionId);
    }

    closePendingStudioAction();
    bypassNavigationGuard = true;

    try {
      await goto(href);
    } finally {
      bypassNavigationGuard = false;
    }
  }

  function discardDraftAndContinue(): void {
    if (!currentSessionId || !pendingStudioAction) {
      return;
    }

    const action = pendingStudioAction;
    discardStudioDraft(currentSessionId);
    closePendingStudioAction();

    if (action.kind === "switch-turn") {
      const turn = turns.find((item) => item.id === action.turnId) ?? null;
      selectTurn(turn);
      return;
    }

    if (action.kind === "new-turn") {
      prepareNewTurnDraft();
    }
  }

  function restoreContinuityDraft(detail: SessionDetail, fallbackTurnId: string | null): string | null {
    const savedDraft = loadStudioDraft(detail.session.id);

    continuityNotice = "";
    restoredPreviewSnapshot = null;

    if (!savedDraft) {
      return fallbackTurnId;
    }

    const resumedTurnId =
      savedDraft.selectedTurnId === null
        ? null
        : detail.turns.some((turn) => turn.id === savedDraft.selectedTurnId)
          ? savedDraft.selectedTurnId
          : fallbackTurnId;
    const resumedTurn =
      detail.turns.find((turn) => turn.id === resumedTurnId) ?? null;

    studioState.set({
      selectedSessionId: detail.session.id,
      turnTitle: savedDraft.turnTitle || resumedTurn?.title || "",
      turnObjective: savedDraft.turnObjective || resumedTurn?.objective || "",
      relayMode: savedDraft.relayMode,
      workbookPath:
        savedDraft.workbookPath || detail.session.primaryWorkbookPath || "",
      workbookFocus: savedDraft.workbookFocus || "Sheet1",
      packetDraft: "",
      rawResponse: savedDraft.rawResponse,
      validationNote: "",
      previewNote: "",
      diffHeadline: "",
      previewWarnings: []
    });

    relayPacketText = savedDraft.relayPacketText;
    relayPacketSummary = savedDraft.relayPacketSummary;
    validationSummary = savedDraft.validationSummary;
    previewSummary = savedDraft.previewSummary;
    approvalSummary = savedDraft.approvalSummary;
    executionSummary = savedDraft.executionSummary;
    restoredPreviewSnapshot = savedDraft.previewSnapshot;

    continuityNotice = savedDraft.previewSnapshot
      ? `Restored local draft from ${formatDate(savedDraft.lastUpdatedAt)}. Preview context came back too, but request preview again before execution.`
      : `Restored local draft from ${formatDate(savedDraft.lastUpdatedAt)}.`;

    return resumedTurnId;
  }

  function persistStudioContinuity(): void {
    if (!browser || !draftPersistenceEnabled || !currentSessionId) {
      return;
    }

    const state = get(studioState);
    const activeTurn =
      sessionDetail?.turns.find((turn) => turn.id === selectedTurnId) ?? null;
    const lastUpdatedAt = new Date().toISOString();
    const workbookPath =
      state.workbookPath.trim() || sessionDetail?.session.primaryWorkbookPath || "";

    saveStudioDraft({
      sessionId: currentSessionId,
      selectedTurnId,
      selectedTurnTitle: activeTurn?.title ?? "",
      turnTitle: state.turnTitle,
      turnObjective: state.turnObjective,
      relayMode: state.relayMode,
      workbookPath,
      workbookFocus: state.workbookFocus,
      relayPacketText,
      relayPacketSummary,
      rawResponse: state.rawResponse,
      validationSummary,
      previewSummary,
      approvalSummary,
      executionSummary,
      previewSnapshot: previewResult
        ? buildPreviewSnapshot(previewResult)
        : restoredPreviewSnapshot,
      lastUpdatedAt,
      cleanShutdown: false
    });

    if (sessionDetail) {
      rememberRecentSession({
        sessionId: sessionDetail.session.id,
        title: sessionDetail.session.title,
        workbookPath: sessionDetail.session.primaryWorkbookPath ?? workbookPath,
        lastOpenedAt: lastUpdatedAt,
        lastTurnTitle: activeTurn?.title ?? ""
      });
    }

    if (workbookPath) {
      rememberRecentFile({
        path: workbookPath,
        lastUsedAt: lastUpdatedAt,
        sessionId: currentSessionId,
        source: selectedTurnId ? "draft" : "session"
      });
    }
  }

  onMount(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): string | void => {
      if (!currentSessionId || reviewerMode) {
        return;
      }

      if (leaveWarningRequired) {
        event.preventDefault();
        event.returnValue = "";
        return "";
      }

      markStudioDraftClean(currentSessionId);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  });

  beforeNavigate((navigation) => {
    if (
      !browser
      || !currentSessionId
      || reviewerMode
      || bypassNavigationGuard
      || !navigation.to
    ) {
      return;
    }

    const nextSessionId = navigation.to.url.searchParams.get("sessionId");
    const nextHref = `${navigation.to.url.pathname}${navigation.to.url.search}${navigation.to.url.hash}`;
    const stayingOnSameSession =
      navigation.to.url.pathname === "/studio" && nextSessionId === currentSessionId;

    if (stayingOnSameSession) {
      return;
    }

    if (!leaveWarningRequired) {
      markStudioDraftClean(currentSessionId);
      return;
    }

    navigation.cancel();
    queuePendingStudioAction({
      kind: "route-leave",
      href: nextHref || "/",
      targetLabel:
        navigation.to.url.pathname === "/"
          ? "Home"
          : navigation.to.url.pathname === "/studio"
            ? "another Studio session"
            : "the next screen"
    });
  });

  function summarizeTurnStatus(status: Turn["status"]): string {
    switch (status) {
      case "packet-ready":
        return "Packet generated and waiting for a pasted response.";
      case "awaiting-response":
        return "Response needs repair before preview can run.";
      case "validated":
        return "Validation passed. Preview can be requested.";
      case "preview-ready":
        return "Preview is available for approval and later execution.";
      case "approved":
        return "Preview approval was recorded.";
      case "executed":
        return "Execution has already been recorded.";
      case "failed":
        return "The turn hit an execution or validation failure.";
      default:
        return "Turn draft is ready for the next Studio command.";
    }
  }

  function clearValidationAndPreview(clearRawResponse = false): void {
    validationError = "";
    previewError = "";
    validationSummary = "";
    previewSummary = "";
    validationResult = null;
    previewResult = null;
    clearApprovalAndExecution(true);

    if (clearRawResponse) {
      studio.updateRawResponse("");
    }
  }

  function clearApprovalAndExecution(clearApprovalNote = false): void {
    approvalError = "";
    executionError = "";
    approvalSummary = "";
    executionSummary = "";
    approvalResult = null;
    executionResult = null;

    if (clearApprovalNote) {
      approvalNote = "";
    }
  }

  function clearAllCommandFeedback(clearRawResponse = false): void {
    packetError = "";
    relayPacketText = "";
    relayPacketSummary = "";
    followupCopyMessage = "";
    followupCopyError = "";
    reviewerCopyMessage = "";
    reviewerCopyError = "";
    clearHandoffFeedback();
    clearValidationAndPreview(clearRawResponse);
  }

  function clearHandoffFeedback(): void {
    handoffAssessment = null;
    handoffCheckPending = false;
    handoffCopyMessage = "";
    handoffCopyError = "";
    handoffCopyRequiresConfirm = false;
  }

  function dismissHandoffAssessment(): void {
    handoffCopyRequiresConfirm = false;
  }

  async function copyRelayPacketToClipboard(): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard access is not available in this build.");
    }

    await navigator.clipboard.writeText(relayPacketText);
    handoffCopyRequiresConfirm = false;
    handoffCopyMessage =
      "Relay packet copied. Share only the minimum content Copilot needs.";
  }

  async function copyFollowupPrompt(prompt: string): Promise<void> {
    followupCopyError = "";
    followupCopyMessage = "";

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is not available in this build.");
      }

      await navigator.clipboard.writeText(prompt);
      followupCopyMessage = "Follow-up prompt copied. Paste it back into Copilot to request a safer retry.";
    } catch (error) {
      followupCopyError = toErrorMessage(error);
    }
  }

  async function handleCopyRelayPacket(): Promise<void> {
    if (!sessionDetail || !selectedTurnId || !relayPacketText) {
      return;
    }

    handoffCheckPending = true;
    handoffCopyError = "";
    handoffCopyMessage = "";

    try {
      const assessment = await assessCopilotHandoff({
        sessionId: sessionDetail.session.id,
        turnId: selectedTurnId
      });

      handoffAssessment = assessment;

      if (assessment.status === "caution") {
        handoffCopyRequiresConfirm = true;
        return;
      }

      await copyRelayPacketToClipboard();
    } catch (error) {
      handoffCopyError = toErrorMessage(error);
    } finally {
      handoffCheckPending = false;
    }
  }

  async function handleConfirmRelayPacketCopy(): Promise<void> {
    handoffCheckPending = true;
    handoffCopyError = "";
    handoffCopyMessage = "";

    try {
      await copyRelayPacketToClipboard();
    } catch (error) {
      handoffCopyError = toErrorMessage(error);
    } finally {
      handoffCheckPending = false;
    }
  }

  function buildReviewerSummary(): string {
    const warnings = reviewWarnings;
    const lines = [
      `Session: ${sessionDetail?.session.title || "Current session"}`,
      `Turn: ${selectedTurn?.title || $studioState.turnTitle || "Current request"}`,
      `Summary: ${reviewWhatChanges}`,
      `Rows: ${reviewRowsSummary}`,
      `Output: ${reviewOutputPath || "No reviewed copy path yet"}`,
      `Status: ${reviewHeadline}`
    ];

    if (warnings.length > 0) {
      lines.push(`Warnings: ${warnings.join(" | ")}`);
    }

    return lines.join("\n");
  }

  async function copyReviewerSummary(): Promise<void> {
    reviewerCopyError = "";
    reviewerCopyMessage = "";

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is not available in this build.");
      }

      await navigator.clipboard.writeText(buildReviewerSummary());
      reviewerCopyMessage = "Review summary copied. Share it with the reviewer or approver.";
    } catch (error) {
      reviewerCopyError = toErrorMessage(error);
    }
  }

  function syncDraftFromTurn(turn: Turn | null): void {
    if (!turn) {
      studio.updateTurnTitle("");
      studio.updateTurnObjective("");
      studio.updateRelayMode("plan");
      return;
    }

    studio.updateTurnTitle(turn.title);
    studio.updateTurnObjective(turn.objective);
    studio.updateRelayMode(turn.mode);
  }

  function selectTurn(turn: Turn | null): void {
    selectedTurnId = turn?.id ?? null;
    restoredPreviewSnapshot = null;
    resetArtifactBrowser();
    continuityNotice = "";
    syncDraftFromTurn(turn);
    clearAllCommandFeedback(true);

    if (turn) {
      sessionNotice = reviewerMode
        ? `Read-only review is open for "${turn.title}".`
        : `Turn "${turn.title}" is selected. Generate a packet in this run before validating a pasted response.`;
    } else if (sessionDetail) {
      sessionNotice = reviewerMode
        ? `Review mode is open for "${sessionDetail.session.title}". Select a turn to inspect it.`
        : `Session "${sessionDetail.session.title}" is ready for a new turn.`;
    }
  }

  function handleTurnSelectionRequest(turn: Turn): void {
    if (turn.id === selectedTurnId) {
      return;
    }

    if (!leaveWarningRequired) {
      selectTurn(turn);
      return;
    }

    queuePendingStudioAction({
      kind: "switch-turn",
      turnId: turn.id,
      turnTitle: turn.title
    });
  }

  function prepareNewTurnDraft(): void {
    if (currentSessionId) {
      discardStudioDraft(currentSessionId);
    }

    selectedTurnId = null;
    restoredPreviewSnapshot = null;
    resetArtifactBrowser();
    continuityNotice = "";
    syncDraftFromTurn(null);
    studio.updateWorkbookPath(sessionDetail?.session.primaryWorkbookPath ?? "");
    studio.updateWorkbookFocus("Sheet1");
    clearAllCommandFeedback(true);
    sessionNotice = sessionDetail
      ? `Session "${sessionDetail.session.title}" is ready for a new turn.`
      : "Select a session from Home to start a new turn.";
  }

  function handlePrepareNewTurnRequest(): void {
    if (reviewerMode) {
      return;
    }

    if (!leaveWarningRequired) {
      prepareNewTurnDraft();
      return;
    }

    queuePendingStudioAction({ kind: "new-turn" });
  }

  async function refreshSessionDetail(preferredTurnId = selectedTurnId): Promise<void> {
    if (!currentSessionId) {
      return;
    }

    const detail = await readSession({ sessionId: currentSessionId });
    sessionDetail = detail;
    studio.updateWorkbookPath(detail.session.primaryWorkbookPath ?? "");

    const turns = sortTurns(detail.turns);
    const nextTurn =
      turns.find((turn) => turn.id === preferredTurnId) ??
      turns.find((turn) => turn.id === detail.session.latestTurnId) ??
      turns[0] ??
      null;

    selectedTurnId = nextTurn?.id ?? null;
    syncDraftFromTurn(nextTurn);
  }

  async function loadStudioSession(
    sessionId: string | null,
    preferredTurnId: string | null = null
  ): Promise<void> {
    draftPersistenceEnabled = false;
    currentSessionId = sessionId;
    sessionDetail = null;
    selectedTurnId = null;
    restoredPreviewSnapshot = null;
    continuityNotice = "";
    sessionError = "";
    sessionNotice = "";
    studio.setSession(sessionId);
    studio.updateWorkbookFocus("Sheet1");
    clearAllCommandFeedback(true);

    if (!sessionId) {
      studio.updateWorkbookPath("");
      syncDraftFromTurn(null);
      sessionLoading = false;
      sessionNotice = "Select a session from Home to start the Studio relay flow.";
      return;
    }

    sessionLoading = true;
    const loadToken = ++lastLoadToken;

    try {
      const detail = await readSession({ sessionId });

      if (loadToken !== lastLoadToken) {
        return;
      }

      sessionDetail = detail;
      studio.updateWorkbookPath(detail.session.primaryWorkbookPath ?? "");

      const turns = sortTurns(detail.turns);
      const routePreferredTurnId =
        preferredTurnId && turns.some((turn) => turn.id === preferredTurnId)
          ? preferredTurnId
          : null;
      const shouldRestoreDraft = !reviewerMode && !routePreferredTurnId;
      const savedDraft = shouldRestoreDraft ? loadStudioDraft(detail.session.id) : null;
      const fallbackTurn =
        turns.find((turn) => turn.id === detail.session.latestTurnId) ?? turns[0] ?? null;
      const restoredTurnId = shouldRestoreDraft
        ? restoreContinuityDraft(detail, fallbackTurn?.id ?? null)
        : routePreferredTurnId;
      const preferredTurn =
        turns.find((turn) => turn.id === restoredTurnId) ??
        (restoredTurnId === null ? (reviewerMode ? fallbackTurn : null) : fallbackTurn);

      if (savedDraft) {
        markStudioDraftClean(detail.session.id);
      }

      if (preferredTurn && !savedDraft) {
        selectTurn(preferredTurn);
      } else if (preferredTurn) {
        selectedTurnId = preferredTurn.id;
        sessionNotice = reviewerMode
          ? `Read-only review is open for "${preferredTurn.title}".`
          : continuityNotice || `Turn "${preferredTurn.title}" is selected and ready to resume.`;
      } else if (restoredTurnId === null) {
        selectedTurnId = null;
        sessionNotice = reviewerMode
          ? `Review mode is open for "${detail.session.title}". Select a turn to inspect it.`
          : continuityNotice || `Session "${detail.session.title}" is ready for a new turn.`;
      } else {
        syncDraftFromTurn(null);
        sessionNotice = reviewerMode
          ? `Review mode is open for "${detail.session.title}".`
          : `Session "${detail.session.title}" is ready for its first turn.`;
      }

      rememberRecentSession({
        sessionId: detail.session.id,
        title: detail.session.title,
        workbookPath: detail.session.primaryWorkbookPath ?? "",
        lastOpenedAt: new Date().toISOString(),
        lastTurnTitle: preferredTurn?.title ?? ""
      });

      if (detail.session.primaryWorkbookPath) {
        rememberRecentFile({
          path: detail.session.primaryWorkbookPath,
          lastUsedAt: new Date().toISOString(),
          sessionId: detail.session.id,
          source: "session"
        });
      }
    } catch (error) {
      if (loadToken !== lastLoadToken) {
        return;
      }

      sessionError = toErrorMessage(error);
      sessionNotice = "";
      studio.updateWorkbookPath("");
      syncDraftFromTurn(null);
    } finally {
      if (loadToken === lastLoadToken) {
        draftPersistenceEnabled = true;
        sessionLoading = false;
      }
    }
  }

  async function handleStartTurn(): Promise<void> {
    if (!sessionDetail) {
      return;
    }

    const state = get(studioState);
    startTurnPending = true;
    sessionError = "";

    try {
      const response = await startTurn({
        sessionId: sessionDetail.session.id,
        title: state.turnTitle.trim(),
        objective: state.turnObjective.trim(),
        mode: state.relayMode
      });

      sessionDetail = {
        session: response.session,
        turns: [
          response.turn,
          ...sessionDetail.turns.filter((turn) => turn.id !== response.turn.id)
        ]
      };

      selectTurn(response.turn);
      sessionNotice = `Turn "${response.turn.title}" started. Generate the relay packet next.`;
    } catch (error) {
      sessionError = toErrorMessage(error);
    } finally {
      startTurnPending = false;
    }
  }

  async function handleGeneratePacket(): Promise<void> {
    if (!sessionDetail || !selectedTurnId) {
      return;
    }

    packetPending = true;
    packetError = "";
    clearValidationAndPreview(false);

    try {
      const packet = await generateRelayPacket({
        sessionId: sessionDetail.session.id,
        turnId: selectedTurnId
      });

      relayPacketText = JSON.stringify(packet, null, 2);
      relayPacketSummary = `${packet.mode} mode packet ready with ${packet.context.length} context line${packet.context.length === 1 ? "" : "s"}, ${packet.allowedReadTools.length} read tool${packet.allowedReadTools.length === 1 ? "" : "s"}, and ${packet.allowedWriteTools.length} write tool${packet.allowedWriteTools.length === 1 ? "" : "s"}.`;
      sessionNotice = "Relay packet generated. Paste a Copilot JSON response and validate it next.";
      await refreshSessionDetail(selectedTurnId);
    } catch (error) {
      packetError = toErrorMessage(error);
    } finally {
      packetPending = false;
    }
  }

  async function handleSubmitResponse(): Promise<void> {
    if (!sessionDetail || !selectedTurnId) {
      return;
    }

    const state = get(studioState);
    validationPending = true;
    validationError = "";
    previewError = "";
    previewSummary = "";
    previewResult = null;
    clearApprovalAndExecution(true);

    try {
      const result = await submitCopilotResponse({
        sessionId: sessionDetail.session.id,
        turnId: selectedTurnId,
        rawResponse: state.rawResponse
      });

      validationResult = result;
      validationSummary = result.accepted
        ? `Validation passed with ${result.parsedResponse?.actions.length ?? 0} action${result.parsedResponse?.actions.length === 1 ? "" : "s"}.`
        : `Validation returned ${result.validationIssues.length} issue${result.validationIssues.length === 1 ? "" : "s"}.`;
      sessionNotice = result.accepted
        ? "Response accepted. Preview can be requested next."
        : "Response was stored, but the parser returned repairable validation issues.";
      await refreshSessionDetail(selectedTurnId);
    } catch (error) {
      validationError = toErrorMessage(error);
    } finally {
      validationPending = false;
    }
  }

  async function handlePreview(): Promise<void> {
    if (!sessionDetail || !selectedTurnId) {
      return;
    }

    previewPending = true;
    previewError = "";
    clearApprovalAndExecution(true);

    try {
      const result = await previewExecution({
        sessionId: sessionDetail.session.id,
        turnId: selectedTurnId
      });

      previewResult = result;
      previewSummary = result.requiresApproval
        ? `Changes are ready to review. Confirm the review before Relay Agent saves a new copy to ${result.diffSummary.outputPath}.`
        : "Changes are ready to review. This plan is read-only, so no save step is needed.";
      sessionNotice = result.requiresApproval
        ? "Changes are ready to review. Confirm them when they look right, then save a new copy."
        : "Changes are ready to review. This plan does not need a saved copy.";
      await refreshSessionDetail(selectedTurnId);
    } catch (error) {
      previewError = toErrorMessage(error);
    } finally {
      previewPending = false;
    }
  }

  function loadDemoResponse(): void {
    const sourcePath =
      get(studioState).workbookPath.trim() || sessionDetail?.session.primaryWorkbookPath || "";

    studio.updateRawResponse(buildDemoResponse(sourcePath));
    sessionNotice =
      "A sample Copilot response was loaded for the bundled walkthrough. Validate it next.";
  }

  async function handleApproval(decision: ApprovalDecision): Promise<void> {
    if (!sessionDetail || !selectedTurnId || !previewResult) {
      return;
    }

    approvalPending = true;
    approvalError = "";
    executionError = "";
    executionSummary = "";
    executionResult = null;

    try {
      const result = await respondToApproval({
        sessionId: sessionDetail.session.id,
        turnId: selectedTurnId,
        decision,
        note: approvalNote.trim() || undefined
      });

      approvalResult = result;
      approvalSummary =
        decision === "approved"
          ? result.readyForExecution
            ? "Review confirmed. Saving a new copy is now enabled."
            : "Review confirmed, but saving is still unavailable until the backend rechecks the plan."
          : "Review marked as not ready. Saving stays blocked until the changes are checked again.";
      sessionNotice =
        decision === "approved"
          ? "Review confirmed. You can now save a new copy."
          : "The current review was marked as not ready. Save stays blocked until the changes are checked again.";
      await refreshSessionDetail(selectedTurnId);
    } catch (error) {
      approvalError = toErrorMessage(error);
    } finally {
      approvalPending = false;
    }
  }

  async function handleExecution(): Promise<void> {
    if (!sessionDetail || !selectedTurnId || !previewResult || reviewerMode || reviewAlreadySaved) {
      return;
    }

    executionPending = true;
    executionError = "";

    try {
      const activeTurn =
        sessionDetail.turns.find((turn) => turn.id === selectedTurnId) ?? null;
      const result = await runExecution({
        sessionId: sessionDetail.session.id,
        turnId: selectedTurnId
      });

      executionResult = result;
      executionSummary = result.executed
        ? `A new reviewed copy was saved${result.outputPath ? ` to ${result.outputPath}` : ""}.`
        : result.reason ?? "The save request was recorded without writing a new copy.";

      if (result.executed) {
        rememberAuditHistory({
          id: `${sessionDetail.session.id}:${selectedTurnId}:${result.outputPath || "recorded"}`,
          sessionId: sessionDetail.session.id,
          sessionTitle: sessionDetail.session.title,
          turnId: selectedTurnId,
          turnTitle: activeTurn?.title ?? "",
          sourcePath: previewResult.diffSummary.sourcePath,
          outputPath: result.outputPath || previewResult.diffSummary.outputPath,
          executedAt: new Date().toISOString(),
          summary: reviewWhatChanges,
          targetCount: previewResult.diffSummary.targetCount,
          affectedRows: previewResult.diffSummary.estimatedAffectedRows,
          warnings: result.warnings
        });
        auditHistoryEntries = listAuditHistory();
      }

      sessionNotice = result.executed
        ? "Save complete. Review the output path and warnings below."
        : result.reason ?? "The save request was recorded.";
      await refreshSessionDetail(selectedTurnId);
    } catch (error) {
      executionError = toErrorMessage(error);
    } finally {
      executionPending = false;
    }
  }

  async function handlePrimaryReviewAction(): Promise<void> {
    if (
      reviewerMode
      || reviewAlreadySaved
      || !validationResult?.accepted
      || previewPending
      || approvalPending
      || executionPending
    ) {
      return;
    }

    if (!previewResult || approvalResult?.decision === "rejected") {
      await handlePreview();
      return;
    }

    if (previewResult.requiresApproval && !approvalGranted) {
      await handleApproval("approved");
      return;
    }

    if (!previewResult.requiresApproval) {
      return;
    }

    await handleExecution();
  }

  $: routeSessionId = $page.url.searchParams.get("sessionId");
  $: routeTurnId = $page.url.searchParams.get("turnId");
  $: reviewerMode = $page.url.searchParams.get("view") === "review";
  $: routeKey = `${routeSessionId ?? ""}:${routeTurnId ?? ""}:${reviewerMode ? "review" : "edit"}`;

  $: if (browser && routeKey !== loadedRouteKey) {
    loadedRouteKey = routeKey;
    void loadStudioSession(routeSessionId, routeTurnId);
  }

  $: previewSnapshot = previewResult
    ? buildPreviewSnapshot(previewResult)
    : restoredPreviewSnapshot;

  $: artifactKey = currentSessionId && selectedTurnId ? `${currentSessionId}:${selectedTurnId}` : "";

  $: if (browser && artifactKey !== lastArtifactKey) {
    lastArtifactKey = artifactKey;

    if (currentSessionId && selectedTurnId) {
      void loadArtifactsForTurn(currentSessionId, selectedTurnId);
    } else {
      resetArtifactBrowser();
    }
  }

  $: auditHistoryEntries = browser ? listAuditHistory() : [];

  $: auditHistoryEntry =
    currentSessionId
      ? auditHistoryEntries.find((entry) =>
          entry.sessionId === currentSessionId
          && (!selectedTurnId || entry.turnId === selectedTurnId)
        ) ?? auditHistoryEntries.find((entry) => entry.sessionId === currentSessionId) ?? null
      : null;

  $: selectedArtifact =
    turnArtifacts.find((artifact) => artifact.artifactId === selectedArtifactId)
    ?? turnArtifacts[0]
    ?? null;

  $: turns = sessionDetail ? sortTurns(sessionDetail.turns) : [];

  $: selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? null;
  $: demoResponseAvailable = Boolean(
    (sessionDetail?.session.primaryWorkbookPath || $studioState.workbookPath).endsWith(
      "revenue-workflow-demo.csv"
    )
  );

  $: hasMeaningfulDraft = hasMeaningfulStudioDraftState(
    $studioState,
    selectedTurn,
    sessionDetail
  );

  $: hasValidationCheckpoint = Boolean(validationResult?.accepted && !previewResult);

  $: hasUnreviewedPreview = Boolean(
    previewResult && previewResult.requiresApproval && !approvalGranted && !approvalPending
  );

  $: hasExecutionReadyCheckpoint = Boolean(
    previewResult && approvalGranted && !executionResult
  );

  $: leaveWarningReasons = [
    hasMeaningfulDraft
      ? "This session still has local draft text or staged response content that you can reopen later."
      : null,
    hasValidationCheckpoint
      ? "Validation passed, but preview has not been requested in this app run yet."
      : null,
    hasUnreviewedPreview
      ? "Preview is ready, but no approval or rejection decision has been recorded yet."
      : null,
    hasExecutionReadyCheckpoint
      ? "Preview review is complete, but save-copy execution has not been requested yet."
      : null
  ].filter((value): value is string => Boolean(value));

  $: leaveWarningRequired = Boolean(!reviewerMode && currentSessionId && leaveWarningReasons.length > 0);

  $: studioHelpEntries = !selectedTurn
    ? [
        {
          term: "Turn title",
          detail: "A short label for the change request you want to run in this session.",
          action: "Name the work first, then start the turn."
        },
        {
          term: "Turn objective",
          detail: "Describe the business result you want instead of listing low-level tool steps.",
          action: "Say what should happen to the file in plain language."
        },
        {
          term: "Start turn",
          detail: "Saves this request so Relay Agent can prepare the next Studio steps.",
          action: "Use this after the title and objective look right."
        }
      ]
    : !relayPacketText
      ? [
          {
            term: "Copy for Copilot",
            detail: "Prepares the current request so you can paste it into Copilot with the needed context.",
            action: "Generate the packet first, then copy it."
          },
          {
            term: "Next step",
            detail: "This turn is saved, but Copilot has not been asked for a response yet.",
            action: "Generate a packet for the selected turn."
          }
        ]
      : !validationResult
        ? [
            {
              term: "Pasted response",
              detail: "Paste the full Copilot JSON response here so Relay Agent can check it safely.",
              action: "Paste the response, then run validation."
            },
            {
              term: "Check changes",
              detail: "After the response passes validation, Relay Agent can show what would change before any new file is saved.",
              action: "Fix any validation issue before moving on."
            }
          ]
        : !previewResult
          ? [
              {
                term: "Check changes",
                detail: "Shows what would change before anything is saved to a new file.",
                action: "Check the planned changes after validation succeeds."
              },
              {
                term: "Review confirmation",
                detail: "Some changes need one explicit review confirmation before Relay Agent can save a new copy.",
                action: "Review the change summary when it appears."
              }
            ]
          : [
              {
                term: "Save new copy",
                detail: "Relay Agent writes a new file and keeps the original workbook unchanged.",
                action: "Save only after the reviewed changes look right."
              },
              {
                term: "Points to check",
                detail: "These notes call out risks, limits, or assumptions before the copy is written.",
                action: "Read them before confirming review or saving."
              }
            ] satisfies HelpEntry[];

  $: stageTimeline = [
    {
      id: "prepare",
      label: "Prepare request",
      note: !sessionDetail
        ? routeSessionId
          ? "Loading the selected session."
          : "Open a session from Home to begin."
        : selectedTurn
          ? `${selectedTurn.title} is ready. Update the request here if needed, or move on to the Copilot step.`
          : $studioState.turnTitle.trim() || $studioState.turnObjective.trim()
            ? "The request draft is filled in and ready to start."
            : "Name what you want to change, then start a turn.",
      tone: !sessionDetail ? (routeSessionId ? "active" : "pending") : selectedTurn ? "ready" : $studioState.turnTitle.trim() || $studioState.turnObjective.trim() ? "active" : "pending"
    },
    {
      id: "copilot",
      label: "Bring back Copilot response",
      note: validationResult?.accepted
        ? validationSummary || "The response passed validation and is ready for review."
        : $studioState.rawResponse.trim()
          ? "A response is pasted in. Validate it before review starts."
          : relayPacketText
            ? "The request packet is ready. Copy it into Copilot, then bring the full JSON response back here."
            : "Generate the Copilot packet for the selected turn first.",
      tone: validationResult?.accepted ? "ready" : relayPacketText || $studioState.rawResponse.trim() ? "active" : selectedTurn ? "pending" : "pending"
    },
    {
      id: "review-save",
      label: "Review and save",
      note: reviewAlreadySaved
        ? executionSummary || "A reviewed copy was saved for this turn."
        : !validationResult?.accepted
          ? "Review starts after the response passes validation."
          : !previewResult
            ? "Check the planned changes next."
            : !previewResult.requiresApproval
              ? "This plan is review-only. No saved copy is needed."
              : approvalResult?.decision === "rejected"
                ? "The changes were marked as not ready. Check them again before saving."
                : approvalGranted
                  ? "Review is complete. Save the new copy when you are ready."
                  : "Changes are ready to review. Confirm them before saving a new copy.",
      tone: reviewAlreadySaved ? "ready" : !validationResult?.accepted ? "pending" : previewResult ? "active" : "active"
    }
  ] satisfies StudioTimelineEntry[];

  $: reloadNote =
    selectedTurn && !relayPacketText && !validationResult && !previewResult && selectedTurn.itemIds.length > 0
      ? "This turn was reloaded from local storage. Check the changes again in the current app run before saving a new copy."
      : "";

  $: approvalGranted = previewResult
    ? !previewResult.requiresApproval
      || selectedTurn?.status === "approved"
      || approvalResult?.readyForExecution
    : false;

  $: reviewHistoryMatchesTurn = Boolean(
    selectedTurnId
      && auditHistoryEntry
      && (!auditHistoryEntry.turnId || auditHistoryEntry.turnId === selectedTurnId)
  );

  $: reviewAlreadySaved = Boolean(
    executionResult?.executed || selectedTurn?.status === "executed" || reviewHistoryMatchesTurn
  );

  $: executionBlockedReason =
    reviewAlreadySaved
      ? "This turn already saved a reviewed copy. Start another turn if you need a new output."
      : !previewResult
      ? "Check the changes after validation succeeds."
      : previewResult.requiresApproval && !approvalGranted
        ? approvalResult?.decision === "rejected"
          ? "The current review was marked as not ready. Check the changes again to continue."
          : "Confirm the reviewed changes before saving a new copy."
        : "You can save the reviewed copy now.";

  $: reviewActionPending = previewPending || approvalPending || executionPending;

  $: reviewPrimaryLabel =
    reviewerMode
      ? "Read-only review"
      : reviewAlreadySaved
        ? "Reviewed copy already saved"
      : !validationResult?.accepted
        ? "Check changes after validation"
        : !previewResult || approvalResult?.decision === "rejected"
          ? previewPending
            ? "Checking changes..."
            : "Check changes"
          : !previewResult.requiresApproval
            ? "Review complete"
            : !approvalGranted
              ? approvalPending
                ? "Confirming review..."
                : "Confirm review"
              : executionPending
                ? "Saving reviewed copy..."
                : "Save reviewed copy";

  $: reviewPrimaryDisabled =
    Boolean(
      reviewerMode
        || reviewAlreadySaved
        || !validationResult?.accepted
        || reviewActionPending
        || (previewResult && !previewResult.requiresApproval)
    );

  $: reviewHeadline =
    reviewerMode
      ? "Read-only review"
      : reviewAlreadySaved
        ? "Reviewed copy already saved"
      : !validationResult?.accepted
        ? "Review starts after a valid response"
        : !previewResult
          ? "Check the planned changes"
          : !previewResult.requiresApproval
            ? "Review complete"
            : approvalResult?.decision === "rejected"
              ? "This plan needs changes before save"
              : !approvalGranted
                ? "Confirm this review before save"
                : "Save the reviewed copy";

  $: reviewCopy =
    reviewerMode
      ? reviewAlreadySaved
        ? "This view is read-only. The selected turn already saved a reviewed copy, so the change summary is safe to inspect without execution controls."
        : "This view is read-only. It hides editing, Copilot handoff, and save controls so a reviewer can inspect the summary only."
      : reviewAlreadySaved
        ? executionSummary || "This turn already saved a reviewed copy. Start another turn if you need a different output."
      : !validationResult?.accepted
        ? "Paste and validate a Copilot response first. Review and save unlock after that step succeeds."
        : !previewResult
          ? "Relay Agent can now show what will change before anything is saved."
          : !previewResult.requiresApproval
            ? "This plan only reviewed the workbook. There is no save step for this result."
            : approvalResult?.decision === "rejected"
              ? "The current review was marked as not ready. Check the changes again or adjust the response before saving."
              : !approvalGranted
                ? "Read the change summary below, then confirm the review when it looks right."
                : "The reviewed plan is ready. Save a new copy when you are ready.";

  $: showRejectReviewAction = Boolean(
    !reviewerMode
      && !reviewAlreadySaved
      && previewResult
      && previewResult.requiresApproval
      && !approvalGranted
      && approvalResult?.decision !== "rejected"
      && !approvalPending
  );

  $: showReviewNote = Boolean(
    !reviewerMode
      && !reviewAlreadySaved
      && previewResult
      && previewResult.requiresApproval
      && !approvalGranted
      && approvalResult?.decision !== "rejected"
  );

  $: reviewSourcePath =
    previewResult?.diffSummary.sourcePath
    || previewSnapshot?.sourcePath
    || auditHistoryEntry?.sourcePath
    || $studioState.workbookPath
    || sessionDetail?.session.primaryWorkbookPath
    || "";

  $: reviewOutputPath =
    previewResult?.diffSummary.outputPath
    || previewSnapshot?.outputPath
    || auditHistoryEntry?.outputPath
    || "";

  $: hasReviewSummary = Boolean(previewResult || previewSnapshot || auditHistoryEntry);

  $: reviewTargetCount =
    previewResult?.diffSummary.targetCount
    ?? previewSnapshot?.targetCount
    ?? auditHistoryEntry?.targetCount
    ?? 0;

  $: reviewAffectedRows =
    previewResult?.diffSummary.estimatedAffectedRows
    ?? previewSnapshot?.estimatedAffectedRows
    ?? auditHistoryEntry?.affectedRows
    ?? 0;

  $: reviewWhatChanges =
    !previewResult && !previewSnapshot && !auditHistoryEntry
      ? "Check the changes to see a short summary of what Relay Agent plans to update."
      : previewResult && previewResult.diffSummary.sheets.length === 0
        ? "This step only reviews the workbook. No rows or columns will be rewritten."
        : previewResult
          ? `${reviewTargetCount} change area${reviewTargetCount === 1 ? "" : "s"} ${reviewAffectedRows === 0 ? "are" : "cover"} ${reviewAffectedRows} row${reviewAffectedRows === 1 ? "" : "s"} in the reviewed copy.`
          : previewSnapshot
            ? "A previous review snapshot was restored. Check the changes again to refresh the live summary."
            : auditHistoryEntry?.summary || "The saved review summary is available for this turn.";

  $: reviewRowsSummary =
    !previewResult && !previewSnapshot && !auditHistoryEntry
      ? "Row counts appear here after Relay Agent checks the changes."
      : previewSnapshot && !previewResult
        ? `${reviewAffectedRows} row${reviewAffectedRows === 1 ? "" : "s"} estimated across ${reviewTargetCount} target${reviewTargetCount === 1 ? "" : "s"}.`
        : auditHistoryEntry && !previewResult
          ? `${reviewAffectedRows} row${reviewAffectedRows === 1 ? "" : "s"} were recorded across ${reviewTargetCount} target${reviewTargetCount === 1 ? "" : "s"} in the saved copy.`
          : `${reviewAffectedRows} row${reviewAffectedRows === 1 ? "" : "s"} estimated across ${reviewTargetCount} target${reviewTargetCount === 1 ? "" : "s"}.`;

  $: reviewWarnings =
    previewResult?.warnings ?? previewSnapshot?.warnings ?? auditHistoryEntry?.warnings ?? [];

  $: reviewerViewHref =
    currentSessionId
      ? `/studio?sessionId=${currentSessionId}${selectedTurnId ? `&turnId=${selectedTurnId}` : ""}&view=review`
      : "/";

  $: editableStudioHref =
    currentSessionId
      ? `/studio?sessionId=${currentSessionId}${selectedTurnId ? `&turnId=${selectedTurnId}` : ""}`
      : "/";

  $: showCompletionActions = Boolean(hasReviewSummary || reviewAlreadySaved);

  $: completionHeading =
    reviewerMode
      ? "Reviewer actions"
      : reviewAlreadySaved
        ? "Next steps"
        : "Share this review";

  $: completionCopy =
    reviewerMode
      ? "Copy the summary or return Home. This view stays read-only."
      : reviewAlreadySaved
        ? "Share the summary, reopen the reviewer view, or start another turn from here."
        : "You can copy a short summary or open the same turn in reviewer mode.";

  $: validationGuidance =
    validationError
      ? {
          problem: "Relay Agent could not check this Copilot response.",
          reason: validationError,
          nextSteps: suggestNextSteps("validation", validationError, true),
          followupPrompt: buildCopilotRetryPrompt(validationError)
        }
      : validationResult && !validationResult.accepted
        ? {
            problem: "Relay Agent could not trust this response yet.",
            reason: validationResult.validationIssues.length === 1
              ? validationResult.validationIssues[0]?.message || "The pasted response needs one repair before preview can start."
              : `The pasted response still has ${validationResult.validationIssues.length} repair items before preview can start.`,
            nextSteps: suggestNextSteps(
              "validation",
              validationResult.validationIssues
                .map((issue) => issue.message)
                .slice(0, 3)
                .join("; "),
              Boolean(validationResult.repairPrompt)
            ),
            followupPrompt: validationResult.repairPrompt
              || buildCopilotRetryPrompt(
                validationResult.validationIssues
                  .map((issue) => issue.message)
                  .slice(0, 3)
                  .join("; ")
              )
          }
        : null;

  $: previewGuidance = previewError
    ? {
        problem: "Relay Agent could not check the planned changes yet.",
        reason: previewError,
        nextSteps: suggestNextSteps("preview", previewError, true),
        followupPrompt: buildCopilotRetryPrompt(previewError)
      }
    : null;

  $: reviewFailureReason =
    approvalError
    || executionError
    || (!executionResult?.executed ? executionResult?.reason || "" : "");

  $: reviewGuidance = reviewFailureReason
    ? {
        problem: approvalError
          ? "Relay Agent could not record the review confirmation yet."
          : "Relay Agent could not save a reviewed copy yet.",
        reason: reviewFailureReason,
        nextSteps: suggestNextSteps("review", reviewFailureReason, true),
        followupPrompt: buildCopilotRetryPrompt(reviewFailureReason)
      }
    : null;

  $: reviewOutputSafety =
    !reviewOutputPath
      ? "The reviewed copy location will appear here after changes are checked."
      : reviewOutputPath === reviewSourcePath
        ? "This path matches the original file, so Relay Agent keeps save blocked until a separate copy path is available."
        : fileNameFromPath(reviewOutputPath) === fileNameFromPath(reviewSourcePath)
          ? "The reviewed copy keeps the same file name in a different folder. The original file still stays unchanged."
          : directoryFromPath(reviewOutputPath) === directoryFromPath(reviewSourcePath)
            ? "Relay Agent already suggests a different copy name in the same folder, so the original file stays untouched."
            : "Relay Agent already suggests a separate copy path, so the original file stays untouched.";

  $: reviewProgressLabel =
    reviewerMode
      ? reviewAlreadySaved
        ? "Read-only review"
        : "Review only"
      : previewPending
      ? "Checking changes"
      : approvalPending
        ? "Confirming review"
        : executionPending
          ? "Saving reviewed copy"
          : reviewAlreadySaved
            ? "Copy saved"
            : previewResult
              ? approvalGranted || !previewResult.requiresApproval
                ? "Ready to save"
                : "Ready for review"
              : validationResult?.accepted
                ? "Ready to check changes"
                : "Waiting for valid response";

  $: reviewProgressCopy =
    reviewerMode
      ? reviewAlreadySaved
        ? "This reviewer view is showing a turn that already saved a reviewed copy."
        : "This reviewer view only shows the summary, output path, and warnings. Editing and save controls stay hidden."
      : previewPending
      ? "Relay Agent is building the change summary now. Saving stays locked until this finishes."
      : approvalPending
        ? "Relay Agent is recording the review confirmation before enabling save."
        : executionPending
          ? "Relay Agent is writing the new copy now. The original workbook still stays unchanged."
          : reviewAlreadySaved
            ? "The reviewed copy was saved successfully."
            : previewResult
              ? approvalGranted || !previewResult.requiresApproval
                ? "The review step is complete."
                : "Review the summary below, then confirm the changes when they look right."
              : validationResult?.accepted
                ? "You can check the planned changes next."
                : "Validation must succeed before review and save can begin.";

  $: if ($studioState.rawResponse !== lastRawResponse) {
    lastRawResponse = $studioState.rawResponse;

    if (!validationPending && !previewPending && (validationResult || previewResult || validationError || previewError || validationSummary || previewSummary)) {
      clearValidationAndPreview(false);
    }
  }

  $: if (browser && draftPersistenceEnabled && currentSessionId && !reviewerMode) {
    $studioState;
    selectedTurnId;
    relayPacketText;
    relayPacketSummary;
    validationSummary;
    previewSummary;
    approvalSummary;
    executionSummary;
    sessionDetail;
    previewSnapshot;
    persistStudioContinuity();
  }
</script>

<svelte:head>
  <title>Relay Agent | Studio</title>
</svelte:head>

<div class="ra-view">
  <section class="ra-hero">
    <p class="ra-eyebrow">Studio route</p>
    <h1 class="ra-headline">Move from Copilot response to review and save.</h1>
    <p class="ra-lede">
      Studio keeps the backend safety gates, but the user-facing flow is now simpler:
      prepare the request, bring back the Copilot response, review the planned changes,
      and save a new copy only after that review is complete.
    </p>
  </section>

  <section class="studio-grid" aria-label="Studio session workspace">
    <article class="ra-panel pane pane-timeline">
      <div class="pane-header">
        <div>
          <p class="pane-label">Timeline</p>
          <h2>{sessionDetail ? sessionDetail.session.title : "No session handoff yet"}</h2>
        </div>
        <span class={`status-pill ${sessionDetail ? `status-${sessionDetail.session.status}` : "status-pending"}`}>
          {sessionDetail ? sessionDetail.session.status : "awaiting handoff"}
        </span>
      </div>

      <p class="pane-copy">
        Home hands a `sessionId` into this route. From there, Studio reads persisted session
        detail and keeps the next safe step visible without requiring backend stage jargon.
      </p>

      {#if sessionLoading}
        <div class="empty-state">
          <h3>Loading session</h3>
          <p>Reading the selected session and turn list from local JSON storage.</p>
        </div>
      {:else if !sessionDetail}
        <div class="empty-state">
          <h3>No session selected</h3>
          <p>Open a session from Home so Studio can load its detail and start a turn.</p>
          <a class="session-link" href="/">Return to Home</a>
        </div>
      {:else}
        <section class="session-summary">
          <p class="summary-objective">{sessionDetail.session.objective}</p>

          <div class="session-meta">
            <span>{sessionDetail.turns.length} {sessionDetail.turns.length === 1 ? "turn" : "turns"}</span>
            <span>Updated {formatDate(sessionDetail.session.updatedAt)}</span>
            {#if sessionDetail.session.primaryWorkbookPath}
              <span title={sessionDetail.session.primaryWorkbookPath}>
                {sessionDetail.session.primaryWorkbookPath}
              </span>
            {/if}
          </div>
        </section>

        <section class="subpanel turn-subpanel">
          <div class="subpanel-header">
            <h3>Session turns</h3>
            {#if !reviewerMode}
              <button class="chip-button" type="button" on:click={handlePrepareNewTurnRequest}>
                Prepare new turn
              </button>
            {/if}
          </div>

          {#if turns.length === 0}
            <div class="empty-state empty-inline">
              <h3>No turns yet</h3>
              <p>Use the workflow pane to start the first turn for this session.</p>
            </div>
          {:else}
            <div class="turn-list">
              {#each turns as turn}
                <button
                  aria-pressed={turn.id === selectedTurnId}
                  aria-current={turn.id === selectedTurnId ? "page" : undefined}
                  class:selected-turn={turn.id === selectedTurnId}
                  class="turn-card"
                  type="button"
                  on:click={() => handleTurnSelectionRequest(turn)}
                >
                  <div class="turn-card-head">
                    <div>
                      <h3>{turn.title}</h3>
                      <p>{turn.objective}</p>
                    </div>
                    <span class={`status-pill status-${turn.status}`}>{turn.status}</span>
                  </div>

                  <div class="turn-meta">
                    <span>{turn.mode}</span>
                    <span>{turn.validationErrorCount} validation issue{turn.validationErrorCount === 1 ? "" : "s"}</span>
                    <span>{formatDate(turn.updatedAt)}</span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </section>

        <ol class="timeline-list">
          {#each stageTimeline as entry}
            <li
              aria-current={entry.tone === "active" ? "step" : undefined}
              class={`timeline-item tone-${entry.tone}`}
            >
              <div class="timeline-marker"></div>
              <div class="timeline-copy">
                <p>{entry.label}</p>
                <span>{entry.note}</span>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </article>

    <article class="ra-panel pane pane-main">
      <div class="pane-header">
        <div>
          <p class="pane-label">Workflow</p>
          <h2>{selectedTurn ? selectedTurn.title : "Start the next turn"}</h2>
        </div>
        <span class={`status-pill ${selectedTurn ? `status-${selectedTurn.status}` : "status-pending"}`}>
          {selectedTurn ? selectedTurn.status : "draft"}
        </span>
      </div>

      <p class="pane-copy">
        The center pane captures the request, Copilot handoff, and response checks. Once the
        response passes validation, the right pane turns into a single review-and-save step.
      </p>

      {#if sessionNotice}
        <section class="feedback feedback-info" aria-live="polite">
          <strong>Studio status</strong>
          <p>{sessionNotice}</p>
        </section>
      {/if}

      {#if continuityNotice}
        <section class="feedback feedback-info" aria-live="polite">
          <strong>Resume status</strong>
          <p>{continuityNotice}</p>
        </section>
      {/if}

      <section class="feedback feedback-info" aria-live="polite">
        <strong>File safety</strong>
        <p>
          The original workbook stays read-only in Studio. Relay Agent only writes a separate
          reviewed copy after the changes are checked and confirmed.
        </p>
      </section>

      <section class="subpanel help-subpanel">
        <div class="subpanel-header">
          <div>
            <h3>Need help with this step?</h3>
            <p class="support-copy">Open a short glossary without leaving Studio.</p>
          </div>
          <button class="chip-button" type="button" on:click={() => (studioHelpOpen = !studioHelpOpen)}>
            {studioHelpOpen ? "Hide help" : "Show help"}
          </button>
        </div>

        {#if studioHelpOpen}
          <div class="help-list">
            {#each studioHelpEntries as entry}
              <article class="help-card">
                <strong>{entry.term}</strong>
                <p>{entry.detail}</p>
                <span>{entry.action}</span>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      {#if leaveWarningRequired}
        <section class="feedback feedback-warn" aria-live="polite">
          <strong>Leave warning</strong>
          <p>
            If you close Studio, go back, or switch turns now, the app will ask whether to
            keep this local draft or discard it.
          </p>
        </section>
      {/if}

      {#if sessionError}
        <section class="feedback feedback-error" aria-live="polite">
          <strong>Session command issue</strong>
          <p>{sessionError}</p>
        </section>
      {/if}

      {#if reloadNote}
        <section class="feedback feedback-warn" aria-live="polite">
          <strong>Reload note</strong>
          <p>{reloadNote}</p>
        </section>
      {/if}

      {#if reviewerMode}
        <section class="feedback feedback-info" aria-live="polite">
          <strong>Read-only review mode</strong>
          <p>
            Editing, Copilot handoff, and save controls are hidden here. Use this screen to inspect
            the saved summary, inspection details, output path, and warnings for the selected turn.
          </p>
        </section>
      {:else}
        <div class="workflow-grid">
          <label class="field">
            <span>Turn title</span>
            <input
              on:input={(event) =>
                studio.updateTurnTitle((event.currentTarget as HTMLInputElement).value)}
              placeholder="Profile the inbound ledger"
              value={$studioState.turnTitle}
            />
          </label>

          <label class="field">
            <span>Relay mode</span>
            <select
              on:change={(event) =>
                studio.updateRelayMode((event.currentTarget as HTMLSelectElement).value as RelayMode)}
              value={$studioState.relayMode}
            >
              {#each relayModes as mode}
                <option value={mode}>{mode}</option>
              {/each}
            </select>
          </label>

          <label class="field field-wide">
            <span>Turn objective</span>
            <textarea
              on:input={(event) =>
                studio.updateTurnObjective((event.currentTarget as HTMLTextAreaElement).value)}
              placeholder="Inspect columns, shape a clean relay packet, and stage preview notes."
              rows="4"
            >{$studioState.turnObjective}</textarea>
          </label>

          <label class="field">
            <span>Workbook path</span>
            <input
              on:input={(event) =>
                studio.updateWorkbookPath((event.currentTarget as HTMLInputElement).value)}
              placeholder="/tmp/revenue-cleanup.csv"
              value={$studioState.workbookPath}
            />
          </label>

          <label class="field">
            <span>Workbook focus</span>
            <input
              on:input={(event) =>
                studio.updateWorkbookFocus((event.currentTarget as HTMLInputElement).value)}
              placeholder="Sheet1"
              value={$studioState.workbookFocus}
            />
          </label>
        </div>

        <div class="action-row">
          <button
            class="primary-button"
            disabled={!sessionDetail || startTurnPending || !$studioState.turnTitle.trim() || !$studioState.turnObjective.trim()}
            type="button"
            on:click={() => void handleStartTurn()}
          >
            {startTurnPending ? "Starting turn..." : selectedTurn ? "Start another turn" : "Start turn"}
          </button>

          <button
            class="secondary-button"
            disabled={!sessionDetail || !selectedTurn || packetPending}
            type="button"
            on:click={() => void handleGeneratePacket()}
          >
            {packetPending ? "Generating packet..." : relayPacketText ? "Regenerate packet" : "Generate packet"}
          </button>

          <button
            class="secondary-button"
            disabled={!sessionDetail || !selectedTurn || !relayPacketText || validationPending || !$studioState.rawResponse.trim()}
            type="button"
            on:click={() => void handleSubmitResponse()}
          >
            {validationPending ? "Validating response..." : validationResult ? "Re-validate response" : "Validate response"}
          </button>

          <button
            class="secondary-button"
            disabled={!sessionDetail || !selectedTurn || !validationResult?.accepted || previewPending}
            type="button"
            on:click={() => void handlePreview()}
          >
            {previewPending ? "Checking changes..." : previewResult ? "Refresh changes" : "Check changes"}
          </button>

          <button class="ghost-button" type="button" on:click={handlePrepareNewTurnRequest}>
            Reset draft
          </button>
        </div>

        <div class="workflow-panels">
          <section class="subpanel">
            <div class="subpanel-header">
              <div>
                <h3>Relay packet</h3>
                <span class={`status-pill ${relayPacketText ? "status-ready" : "status-pending"}`}>
                  {relayPacketText ? "generated" : "pending"}
                </span>
              </div>

              <button
                class="chip-button"
                disabled={!relayPacketText || handoffCheckPending || packetPending}
                type="button"
                on:click={() => void handleCopyRelayPacket()}
              >
                {handoffCheckPending ? "Checking copy..." : "Copy for Copilot"}
              </button>
            </div>

            {#if packetError}
              <p class="subpanel-error">{packetError}</p>
            {/if}

            {#if handoffCopyError}
              <p class="subpanel-error">{handoffCopyError}</p>
            {/if}

            {#if handoffCopyMessage}
              <p class="support-copy">{handoffCopyMessage}</p>
            {/if}

            {#if handoffAssessment && handoffCopyRequiresConfirm}
              <section class="feedback feedback-warn" aria-live="polite">
                <strong>{handoffAssessment.headline}</strong>
                <p>{handoffAssessment.summary}</p>

                {#if handoffAssessment.reasons.length > 0}
                  <ul class="feedback-list">
                    {#each handoffAssessment.reasons as reason}
                      <li>
                        <strong>{reason.label}:</strong> {reason.detail}
                      </li>
                    {/each}
                  </ul>
                {/if}

                {#if handoffAssessment.suggestedActions.length > 0}
                  <div class="copy-guidance">
                    <p class="copy-guidance-label">Before you copy anyway</p>
                    <ul class="feedback-list">
                      {#each handoffAssessment.suggestedActions as action}
                        <li>{action}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}

                <div class="action-row action-row-compact">
                  <button
                    class="secondary-button"
                    disabled={handoffCheckPending}
                    type="button"
                    on:click={() => void handleConfirmRelayPacketCopy()}
                  >
                    {handoffCheckPending ? "Copying..." : "Copy anyway"}
                  </button>
                  <button class="ghost-button" type="button" on:click={dismissHandoffAssessment}>
                    Cancel
                  </button>
                </div>
              </section>
            {/if}

            <pre class="packet-preview">{relayPacketText || "Select a turn and generate a relay packet to display the backend JSON payload here."}</pre>
          </section>

          <section class="subpanel">
            <div class="subpanel-header">
              <div>
                <h3>Pasted response</h3>
                <p class="support-copy">Paste the full Copilot JSON response here.</p>
              </div>
              <div class="action-row action-row-compact">
                {#if demoResponseAvailable}
                  <button class="chip-button" type="button" on:click={loadDemoResponse}>
                    Load demo response
                  </button>
                {/if}
                <span class={`status-pill ${$studioState.rawResponse.trim() ? "status-ready" : "status-pending"}`}>
                  {$studioState.rawResponse.trim() ? "captured" : "empty"}
                </span>
              </div>
            </div>

            <p class="support-copy">
              Paste the Copilot response JSON here. The validation command checks the schema and
              tool/action payload shapes before preview is allowed.
            </p>

            {#if demoResponseAvailable}
              <p class="support-copy">
                For the bundled sample walkthrough, `Load demo response` fills a safe example so you
                can reach preview without opening the README.
              </p>
            {/if}

            <textarea
              class="response-draft"
              on:input={(event) =>
                studio.updateRawResponse((event.currentTarget as HTMLTextAreaElement).value)}
              placeholder={`{"summary":"Rename and save a cleaned copy.","actions":[]}`}
              rows="10"
            >{$studioState.rawResponse}</textarea>
          </section>

          <section class="subpanel">
            <div class="subpanel-header">
              <h3>Validation feedback</h3>
              <span class={`status-pill ${validationResult?.accepted ? "status-ready" : validationResult ? "status-awaiting-response" : "status-pending"}`}>
                {validationResult ? (validationResult.accepted ? "accepted" : "repair needed") : "pending"}
              </span>
            </div>

            {#if validationError}
              <p class="subpanel-error">{validationError}</p>
            {/if}

            {#if validationGuidance}
              <section class={`feedback ${validationResult && !validationResult.accepted ? "feedback-warn" : "feedback-error"}`} aria-live="polite">
                <strong>{validationGuidance.problem}</strong>
                <p>{validationGuidance.reason}</p>
                <ul class="feedback-list">
                  {#each validationGuidance.nextSteps as step}
                    <li>{step}</li>
                  {/each}
                </ul>

                {#if validationGuidance.followupPrompt}
                  <div class="copy-guidance">
                    <p class="copy-guidance-label">Copilot follow-up prompt</p>
                    <pre class="packet-preview">{validationGuidance.followupPrompt}</pre>
                    <div class="action-row action-row-compact">
                      <button
                        class="secondary-button"
                        type="button"
                        on:click={() => void copyFollowupPrompt(validationGuidance.followupPrompt || "")}
                      >
                        Copy follow-up prompt
                      </button>
                    </div>
                  </div>
                {/if}

                {#if followupCopyError}
                  <p class="subpanel-error" aria-live="polite">{followupCopyError}</p>
                {/if}

                {#if followupCopyMessage}
                  <p class="support-copy" aria-live="polite">{followupCopyMessage}</p>
                {/if}
              </section>
            {/if}

            {#if validationResult}
              <p class="support-copy">{validationSummary}</p>

              {#if validationResult.accepted && validationResult.parsedResponse}
                <div class="result-grid">
                  <div class="result-card">
                    <p class="preview-label">Summary</p>
                    <h3>{validationResult.parsedResponse.summary}</h3>
                  </div>

                  <div class="result-card">
                    <p class="preview-label">Actions</p>
                    <h3>{validationResult.parsedResponse.actions.length}</h3>
                    <p>{validationResult.parsedResponse.followupQuestions.length} follow-up question{validationResult.parsedResponse.followupQuestions.length === 1 ? "" : "s"}</p>
                  </div>
                </div>

                {#if validationResult.parsedResponse.warnings.length > 0}
                  <div class="warning-list">
                    {#each validationResult.parsedResponse.warnings as warning}
                      <span>{warning}</span>
                    {/each}
                  </div>
                {/if}
              {:else}
                <div class="issue-list">
                  {#each validationResult.validationIssues as issue}
                    <article class="issue-card">
                      <p>{issue.message}</p>
                      <span>{formatIssuePath(issue.path)} · {issue.code}</span>
                    </article>
                  {/each}
                </div>

              {/if}
            {:else}
              <p class="support-copy">
                {validationSummary
                  ? `${validationSummary} Re-run validation before preview so the current app run has fresh parser state.`
                  : "Validation results will appear here after `submit_copilot_response` runs."}
              </p>
            {/if}
          </section>
        </div>
      {/if}

      <section class="subpanel artifact-browser">
        <div class="subpanel-header">
          <div>
            <h3>Inspection details</h3>
            <p class="support-copy">
              Review the current turn lifecycle and saved workbook evidence without leaving Studio.
            </p>
          </div>
          <span class={`status-pill ${turnDetails ? "status-ready" : "status-pending"}`}>
            {artifactLoading
              ? "loading"
              : turnDetails
                ? turnDetails.overview.currentStageLabel
                : "waiting"}
          </span>
        </div>

        {#if artifactError}
          <section class="feedback feedback-error" aria-live="polite">
            <strong>Could not open saved inspection details yet.</strong>
            <p>{artifactError}</p>
          </section>
        {/if}

        {#if !selectedTurn}
          <div class="empty-state empty-inline">
            <h3>No turn selected</h3>
            <p>Select a turn to review its lifecycle details and saved workbook evidence.</p>
          </div>
        {:else if artifactLoading}
          <div class="empty-state empty-inline">
            <h3>Loading inspection details</h3>
            <p>Reading the selected turn lifecycle and any saved workbook artifacts.</p>
          </div>
        {:else}
          {#if turnDetails}
            <div class="turn-details-shell">
              <div class="subpanel-header">
                <div>
                  <h4>Turn details</h4>
                  <p class="support-copy">
                    Inspect the packet, validation, approval, and execution state for this turn.
                  </p>
                </div>
                <span class="status-pill">{turnDetails.overview.currentStageLabel}</span>
              </div>

              <section class="feedback feedback-info" aria-live="polite">
                <strong>{turnDetails.overview.summary}</strong>
                <p>{turnDetails.overview.guardrailSummary}</p>
              </section>

              <div class="turn-details-nav" role="tablist" aria-label="Turn detail categories">
                {#each turnDetailsTabs as tab}
                  <button
                    aria-selected={selectedTurnDetailsTab === tab}
                    class:selected-turn-detail={selectedTurnDetailsTab === tab}
                    class="chip-button turn-detail-button"
                    role="tab"
                    type="button"
                    on:click={() => (selectedTurnDetailsTab = tab)}
                  >
                    <strong>{turnDetailsTabLabel(tab)}</strong>
                    <span>{turnDetailsTabSummary(tab, turnDetails)}</span>
                  </button>
                {/each}
              </div>

              {#if selectedTurnDetailsTab === "overview"}
                <div class="result-grid">
                  <article class="result-card">
                    <p class="preview-label">Current stage</p>
                    <h3>{turnDetails.overview.currentStageLabel}</h3>
                    <p>{turnDetails.overview.summary}</p>
                  </article>
                  <article class="result-card">
                    <p class="preview-label">Relay mode</p>
                    <h3>{turnDetails.overview.relayMode}</h3>
                    <p>{turnDetails.overview.storageMode === "memory" ? "Temporary mode" : "Saved locally"}</p>
                  </article>
                </div>

                <div class="turn-overview-grid">
                  {#each turnDetails.overview.steps as step}
                    <article class="preview-card turn-overview-card">
                      <div class="turn-overview-head">
                        <p class="preview-label">{step.label}</p>
                        <span class={`status-pill ${overviewStepTone(step.state)}`}>{step.state}</span>
                      </div>
                      <h3>{step.label}</h3>
                      <p>{step.summary}</p>
                    </article>
                  {/each}
                </div>
              {:else if selectedTurnDetailsTab === "packet"}
                {#if turnDetails.packet.available && turnDetails.packet.payload}
                  <div class="result-grid">
                    <article class="result-card">
                      <p class="preview-label">Source</p>
                      <h3>{turnDetails.packet.payload.sourcePath || "No source path recorded"}</h3>
                      <p>{turnDetails.packet.payload.sessionTitle} / {turnDetails.packet.payload.turnTitle}</p>
                    </article>
                    <article class="result-card">
                      <p class="preview-label">Packet source</p>
                      <h3>{inspectionSourceLabel(turnDetails.packet.sourceType)}</h3>
                      <p>{turnDetails.packet.updatedAt ? formatDate(turnDetails.packet.updatedAt) : "No timestamp recorded"}</p>
                    </article>
                    <article class="result-card">
                      <p class="preview-label">Allowed tools</p>
                      <h3>{turnDetails.packet.payload.allowedReadToolCount} read / {turnDetails.packet.payload.allowedWriteToolCount} write</h3>
                      <p>{turnDetails.packet.payload.relayMode} mode</p>
                    </article>
                  </div>

                  <article class="preview-card">
                    <p class="preview-label">Intent summary</p>
                    <h3>{turnDetails.packet.payload.objective}</h3>
                    <div class="turn-detail-list">
                      {#each turnDetails.packet.payload.contextLines as line}
                        <span>{line}</span>
                      {/each}
                    </div>
                  </article>

                  {#if turnDetails.packet.payload.responseNotes.length > 0}
                    <article class="preview-card">
                      <p class="preview-label">Packet notes</p>
                      <div class="turn-detail-list">
                        {#each turnDetails.packet.payload.responseNotes as note}
                          <span>{note}</span>
                        {/each}
                      </div>
                    </article>
                  {/if}
                {:else}
                  <div class="empty-state empty-inline">
                    <h3>Packet details unavailable</h3>
                    <p>{turnDetails.packet.summary}</p>
                  </div>
                {/if}
              {:else if selectedTurnDetailsTab === "validation"}
                {#if turnDetails.validation.available && turnDetails.validation.payload}
                  <div class="result-grid">
                    <article class="result-card">
                      <p class="preview-label">Validation status</p>
                      <h3>{turnDetails.validation.payload.headline}</h3>
                      <p>{turnDetails.validation.payload.primaryReason}</p>
                    </article>
                    <article class="result-card">
                      <p class="preview-label">Issues</p>
                      <h3>{turnDetails.validation.payload.issueCount}</h3>
                      <p>{turnDetails.validation.payload.warningCount} warning note{turnDetails.validation.payload.warningCount === 1 ? "" : "s"}</p>
                    </article>
                    <article class="result-card">
                      <p class="preview-label">Next step</p>
                      <h3>{turnDetails.validation.payload.canPreview ? "Preview can run" : "Repair needed first"}</h3>
                      <p>{inspectionSourceLabel(turnDetails.validation.sourceType)}</p>
                    </article>
                  </div>

                  {#if turnDetails.validation.payload.issues.length > 0}
                    <div class="issue-list">
                      {#each turnDetails.validation.payload.issues as issue}
                        <article class="issue-card">
                          <p>{issue.message}</p>
                          <span>{issue.path} · {issue.code}</span>
                        </article>
                      {/each}
                    </div>
                  {/if}

                  {#if turnDetails.validation.payload.relatedPreviewArtifactId}
                    <p class="support-copy">
                      Related preview evidence is available for this turn and can be checked in the workbook evidence list below.
                    </p>
                  {/if}
                {:else}
                  <div class="empty-state empty-inline">
                    <h3>Validation details unavailable</h3>
                    <p>{turnDetails.validation.summary}</p>
                  </div>
                {/if}
              {:else if selectedTurnDetailsTab === "approval"}
                {#if turnDetails.approval.available && turnDetails.approval.payload}
                  <div class="result-grid">
                    <article class="result-card">
                      <p class="preview-label">Approval state</p>
                      <h3>{turnDetails.approval.payload.requiresApproval ? (turnDetails.approval.payload.decision || "Not approved yet") : "Not required"}</h3>
                      <p>{turnDetails.approval.summary}</p>
                    </article>
                    <article class="result-card">
                      <p class="preview-label">Recorded at</p>
                      <h3>{turnDetails.approval.payload.approvedAt ? formatDate(turnDetails.approval.payload.approvedAt) : "No approval recorded yet"}</h3>
                      <p>{inspectionSourceLabel(turnDetails.approval.sourceType)}</p>
                    </article>
                    <article class="result-card">
                      <p class="preview-label">Execution access</p>
                      <h3>{turnDetails.approval.payload.readyForExecution ? "Ready to save" : "Still blocked"}</h3>
                      <p>{turnDetails.approval.payload.saveCopyGuardrail}</p>
                    </article>
                  </div>

                  <section class="feedback feedback-info" aria-live="polite">
                    <strong>Original file protection</strong>
                    <p>{turnDetails.approval.payload.originalFileGuardrail}</p>
                  </section>

                  {#if turnDetails.approval.payload.note}
                    <article class="preview-card">
                      <p class="preview-label">Approval note</p>
                      <h3>{turnDetails.approval.payload.note}</h3>
                    </article>
                  {/if}

                  {#if turnDetails.approval.payload.temporaryModeNote}
                    <section class="feedback feedback-warn" aria-live="polite">
                      <strong>Temporary mode note</strong>
                      <p>{turnDetails.approval.payload.temporaryModeNote}</p>
                    </section>
                  {/if}
                {:else}
                  <div class="empty-state empty-inline">
                    <h3>Approval details unavailable</h3>
                    <p>{turnDetails.approval.summary}</p>
                  </div>
                {/if}
              {:else if selectedTurnDetailsTab === "execution"}
                {#if turnDetails.execution.available && turnDetails.execution.payload}
                  <div class="result-grid">
                    <article class="result-card">
                      <p class="preview-label">Execution state</p>
                      <h3>{turnDetails.execution.payload.state}</h3>
                      <p>{turnDetails.execution.payload.reasonSummary}</p>
                    </article>
                    <article class="result-card">
                      <p class="preview-label">Output path</p>
                      <h3>{turnDetails.execution.payload.outputPath || "No output path recorded"}</h3>
                      <p>{turnDetails.execution.payload.executedAt ? formatDate(turnDetails.execution.payload.executedAt) : "No execution timestamp recorded"}</p>
                    </article>
                    <article class="result-card">
                      <p class="preview-label">Warnings</p>
                      <h3>{turnDetails.execution.payload.warningCount}</h3>
                      <p>{inspectionSourceLabel(turnDetails.execution.sourceType)}</p>
                    </article>
                  </div>

                  {#if turnDetails.execution.payload.warnings.length > 0}
                    <div class="warning-list">
                      {#each turnDetails.execution.payload.warnings as warning}
                        <span>{warning}</span>
                      {/each}
                    </div>
                  {/if}
                {:else}
                  <div class="empty-state empty-inline">
                    <h3>Execution details unavailable</h3>
                    <p>{turnDetails.execution.summary}</p>
                  </div>
                {/if}
              {/if}
            </div>
          {/if}

          <div class="artifact-evidence-shell">
            <div class="subpanel-header">
              <div>
                <h4>Workbook evidence</h4>
                <p class="support-copy">
                  Review saved workbook inspection artifacts for this turn.
                </p>
              </div>
              <span class={`status-pill ${turnArtifacts.length > 0 ? "status-ready" : "status-pending"}`}>
                {turnArtifacts.length > 0 ? `${turnArtifacts.length} saved` : "none yet"}
              </span>
            </div>

            {#if turnArtifacts.length === 0}
              <div class="empty-state empty-inline">
                <h3>No saved workbook evidence yet</h3>
                <p>
                  This turn has no persisted workbook artifacts. Read tools such as `workbook.inspect`,
                  `sheet.preview`, `sheet.profile_columns`, and `session.diff_from_base` create them.
                  This also happens in temporary mode, where local artifact history is not kept after
                  the app closes.
                </p>
              </div>
            {:else if selectedArtifact}
              <div class="artifact-browser-grid">
                <div class="artifact-list" role="list" aria-label="Saved inspection artifacts">
                  {#each turnArtifacts as artifact}
                    <button
                      aria-pressed={artifact.artifactId === selectedArtifactId}
                      class:selected-artifact={artifact.artifactId === selectedArtifactId}
                      class="artifact-card"
                      type="button"
                      on:click={() => (selectedArtifactId = artifact.artifactId)}
                    >
                      <strong>{artifactLabel(artifact)}</strong>
                      <span>{artifactSummary(artifact)}</span>
                      <small>{formatDate(artifact.createdAt)}</small>
                    </button>
                  {/each}
                </div>

                <div class="artifact-detail">
                  <div class="artifact-detail-head">
                    <div>
                      <p class="preview-label">Selected artifact</p>
                      <h3>{artifactLabel(selectedArtifact)}</h3>
                    </div>
                    <span class="status-pill">{formatDate(selectedArtifact.createdAt)}</span>
                  </div>

                  {#if selectedArtifact.artifactType === "workbook-profile"}
                    <div class="result-grid">
                      <article class="result-card">
                        <p class="preview-label">Source path</p>
                        <h3>{selectedArtifact.payload.sourcePath}</h3>
                      </article>
                      <article class="result-card">
                        <p class="preview-label">Workbook format</p>
                        <h3>{selectedArtifact.payload.format.toUpperCase()}</h3>
                        <p>{selectedArtifact.payload.sheetCount} sheet{selectedArtifact.payload.sheetCount === 1 ? "" : "s"}</p>
                      </article>
                    </div>

                    {#if selectedArtifact.payload.warnings.length > 0}
                      <div class="warning-list">
                        {#each selectedArtifact.payload.warnings as warning}
                          <span>{warning}</span>
                        {/each}
                      </div>
                    {/if}

                    <div class="artifact-sheet-grid">
                      {#each selectedArtifact.payload.sheets as sheet}
                        <article class="preview-card">
                          <p class="preview-label">{sheet.name}</p>
                          <h3>{sheet.rowCount} row{sheet.rowCount === 1 ? "" : "s"}</h3>
                          <p>{sheet.columnCount} column{sheet.columnCount === 1 ? "" : "s"}</p>
                          <div class="diff-tags">
                            {#each sheet.columns as column}
                              <span class="tag tag-changed">{column}</span>
                            {/each}
                          </div>
                        </article>
                      {/each}
                    </div>
                  {:else if selectedArtifact.artifactType === "sheet-preview"}
                    <div class="result-grid">
                      <article class="result-card">
                        <p class="preview-label">Sheet</p>
                        <h3>{selectedArtifact.payload.sheet}</h3>
                        <p>{selectedArtifact.payload.rows.length} sampled row{selectedArtifact.payload.rows.length === 1 ? "" : "s"}</p>
                      </article>
                      <article class="result-card">
                        <p class="preview-label">Preview size</p>
                        <h3>{selectedArtifact.payload.columns.length} column{selectedArtifact.payload.columns.length === 1 ? "" : "s"}</h3>
                        <p>{selectedArtifact.payload.truncated ? "The preview was truncated." : "The preview fit within the requested row limit."}</p>
                      </article>
                    </div>

                    {#if selectedArtifact.payload.warnings.length > 0}
                      <div class="warning-list">
                        {#each selectedArtifact.payload.warnings as warning}
                          <span>{warning}</span>
                        {/each}
                      </div>
                    {/if}

                    <div class="artifact-table-wrap">
                      <table class="artifact-table">
                        <thead>
                          <tr>
                            <th>Row</th>
                            {#each selectedArtifact.payload.columns as column}
                              <th>{column}</th>
                            {/each}
                          </tr>
                        </thead>
                        <tbody>
                          {#each selectedArtifact.payload.rows as row}
                            <tr>
                              <td>{row.rowNumber}</td>
                              {#each row.values as value}
                                <td>{value}</td>
                              {/each}
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {:else if selectedArtifact.artifactType === "column-profile"}
                    <div class="result-grid">
                      <article class="result-card">
                        <p class="preview-label">Sheet</p>
                        <h3>{selectedArtifact.payload.sheet}</h3>
                        <p>{selectedArtifact.payload.columns.length} column{selectedArtifact.payload.columns.length === 1 ? "" : "s"} profiled</p>
                      </article>
                      <article class="result-card">
                        <p class="preview-label">Sample size</p>
                        <h3>{selectedArtifact.payload.sampledRows} row{selectedArtifact.payload.sampledRows === 1 ? "" : "s"}</h3>
                        <p>{selectedArtifact.payload.rowCount} total row{selectedArtifact.payload.rowCount === 1 ? "" : "s"} scanned</p>
                      </article>
                    </div>

                    {#if selectedArtifact.payload.warnings.length > 0}
                      <div class="warning-list">
                        {#each selectedArtifact.payload.warnings as warning}
                          <span>{warning}</span>
                        {/each}
                      </div>
                    {/if}

                    <div class="artifact-column-grid">
                      {#each selectedArtifact.payload.columns as column}
                        <article class="preview-card">
                          <p class="preview-label">{column.column}</p>
                          <h3>{column.inferredType}</h3>
                          <p>{column.nonEmptyCount} non-empty, {column.nullCount} blank</p>
                          <div class="diff-tags">
                            {#each column.sampleValues as sample}
                              <span class="tag tag-added">{sample}</span>
                            {/each}
                          </div>
                        </article>
                      {/each}
                    </div>
                  {:else}
                    {@const diffPayload = selectedArtifact.artifactType === "preview" ? selectedArtifact.payload.diffSummary : selectedArtifact.payload}
                    {@const diffWarnings = selectedArtifact.artifactType === "preview" ? selectedArtifact.payload.warnings : selectedArtifact.payload.warnings}
                    <div class="result-grid">
                      <article class="result-card">
                        <p class="preview-label">Source path</p>
                        <h3>{diffPayload.sourcePath}</h3>
                      </article>
                      <article class="result-card">
                        <p class="preview-label">Reviewed copy path</p>
                        <h3>{diffPayload.outputPath}</h3>
                        <p>
                          {selectedArtifact.artifactType === "preview"
                            ? selectedArtifact.payload.requiresApproval
                              ? "This saved preview required review confirmation before save."
                              : "This saved preview was read-only."
                            : "This diff was saved as a read-side artifact for the turn."}
                        </p>
                      </article>
                    </div>

                    <div class="result-grid">
                      <article class="result-card">
                        <p class="preview-label">Targets</p>
                        <h3>{diffPayload.targetCount}</h3>
                        <p>{diffPayload.estimatedAffectedRows} affected row{diffPayload.estimatedAffectedRows === 1 ? "" : "s"}</p>
                      </article>
                      <article class="result-card">
                        <p class="preview-label">Warnings</p>
                        <h3>{diffWarnings.length}</h3>
                        <p>Saved with the artifact for later review.</p>
                      </article>
                    </div>

                    {#if diffWarnings.length > 0}
                      <div class="warning-list">
                        {#each diffWarnings as warning}
                          <span>{warning}</span>
                        {/each}
                      </div>
                    {/if}

                    <div class="artifact-sheet-grid">
                      {#each diffPayload.sheets as sheet}
                        <article class="preview-card">
                          <p class="preview-label">{sheet.target.label}</p>
                          <h3>{sheet.estimatedAffectedRows} row{sheet.estimatedAffectedRows === 1 ? "" : "s"} affected</h3>
                          <div class="diff-tags">
                            {#each sheet.addedColumns as column}
                              <span class="tag tag-added">+ {column}</span>
                            {/each}
                            {#each sheet.changedColumns as column}
                              <span class="tag tag-changed">~ {column}</span>
                            {/each}
                            {#each sheet.removedColumns as column}
                              <span class="tag tag-removed">- {column}</span>
                            {/each}
                          </div>
                        </article>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </section>
    </article>

    <article class="ra-panel pane pane-preview">
      <div class="pane-header">
        <div>
          <p class="pane-label">Review and save</p>
          <h2>Check the plan, then save a new copy</h2>
        </div>
        <span class={`status-pill ${hasReviewSummary ? "status-ready" : "status-pending"}`}>
          {#if reviewAlreadySaved}
            copy saved
          {:else if previewResult}
            ready to review
          {:else if previewSnapshot}
            snapshot restored
          {:else if auditHistoryEntry}
            saved summary
          {:else}
            waiting for review
          {/if}
        </span>
      </div>

      {#if previewGuidance}
        <section class="feedback feedback-error" aria-live="polite">
          <strong>{previewGuidance.problem}</strong>
          <p>{previewGuidance.reason}</p>
          <ul class="feedback-list">
            {#each previewGuidance.nextSteps as step}
              <li>{step}</li>
            {/each}
          </ul>

          {#if previewGuidance.followupPrompt}
            <div class="copy-guidance">
              <p class="copy-guidance-label">Copilot follow-up prompt</p>
              <pre class="packet-preview">{previewGuidance.followupPrompt}</pre>
              <div class="action-row action-row-compact">
                <button
                  class="secondary-button"
                  type="button"
                  on:click={() => void copyFollowupPrompt(previewGuidance.followupPrompt || "")}
                >
                  Copy follow-up prompt
                </button>
              </div>
            </div>
          {/if}

          {#if followupCopyError}
            <p class="subpanel-error" aria-live="polite">{followupCopyError}</p>
          {/if}

          {#if followupCopyMessage}
            <p class="support-copy" aria-live="polite">{followupCopyMessage}</p>
          {/if}
        </section>
      {/if}

      <section class="feedback feedback-info" aria-live="polite">
        <strong>{reviewProgressLabel}</strong>
        <p>{reviewProgressCopy}</p>
      </section>

      <div class="preview-stack">
        <section class="preview-summary-grid" aria-label="Review summary">
          <article class="preview-card summary-card">
            <p class="preview-label">What will change</p>
            <h3>{hasReviewSummary ? `${reviewTargetCount} target${reviewTargetCount === 1 ? "" : "s"} in scope` : "Waiting for change summary"}</h3>
            <p>{reviewWhatChanges}</p>
          </article>

          <article class="preview-card summary-card">
            <p class="preview-label">How many rows</p>
            <h3>{hasReviewSummary ? `${reviewAffectedRows} row${reviewAffectedRows === 1 ? "" : "s"} estimated` : "No row estimate yet"}</h3>
            <p>{reviewRowsSummary}</p>
          </article>

          <article class="preview-card summary-card">
            <p class="preview-label">Where the new copy goes</p>
            <h3>{reviewOutputPath || "Waiting for reviewed copy path"}</h3>
            <p>{reviewOutputSafety}</p>
          </article>
        </section>

        <section class="preview-card review-save-card">
          <p class="preview-label">Review and save</p>
          <h3>{reviewHeadline}</h3>
          <p>{reviewCopy}</p>

          {#if showReviewNote}
            <label class="field">
              <span>Review note</span>
              <textarea
                on:input={(event) => (approvalNote = (event.currentTarget as HTMLTextAreaElement).value)}
                placeholder="Optional note about why these changes look right."
                rows="3"
              >{approvalNote}</textarea>
            </label>
          {/if}

          {#if reviewGuidance}
            <section class="feedback feedback-warn" aria-live="polite">
              <strong>{reviewGuidance.problem}</strong>
              <p>{reviewGuidance.reason}</p>
              <ul class="feedback-list">
                {#each reviewGuidance.nextSteps as step}
                  <li>{step}</li>
                {/each}
              </ul>

              {#if reviewGuidance.followupPrompt}
                <div class="copy-guidance">
                  <p class="copy-guidance-label">Copilot follow-up prompt</p>
                  <pre class="packet-preview">{reviewGuidance.followupPrompt}</pre>
                  <div class="action-row action-row-compact">
                    <button
                      class="secondary-button"
                      type="button"
                      on:click={() => void copyFollowupPrompt(reviewGuidance.followupPrompt || "")}
                    >
                      Copy follow-up prompt
                    </button>
                  </div>
                </div>
              {/if}

              {#if followupCopyError}
                <p class="subpanel-error" aria-live="polite">{followupCopyError}</p>
              {/if}

              {#if followupCopyMessage}
                <p class="support-copy" aria-live="polite">{followupCopyMessage}</p>
              {/if}
            </section>
          {/if}

          {#if !reviewerMode && !reviewAlreadySaved}
            <div class="action-row action-row-compact">
              <button
                class="primary-button"
                disabled={reviewPrimaryDisabled}
                type="button"
                on:click={() => void handlePrimaryReviewAction()}
              >
                {reviewPrimaryLabel}
              </button>

              {#if showRejectReviewAction}
                <button
                  class="ghost-button"
                  disabled={approvalPending}
                  type="button"
                  on:click={() => void handleApproval("rejected")}
                >
                  Needs changes
                </button>
              {/if}
            </div>
          {/if}
        </section>

        <section class="preview-card">
          <p class="preview-label">Original file</p>
          <h3>{reviewSourcePath || "No workbook path has been staged yet."}</h3>
          <p>{$studioState.workbookFocus || "Sheet1"}</p>
        </section>

        <section class="preview-card">
          <p class="preview-label">New copy location</p>
          <h3>{reviewOutputPath || "Preview output path will appear here."}</h3>
          <p>
            {#if previewResult}
              {previewResult.requiresApproval
                ? approvalResult?.decision === "rejected"
                  ? "The current review was marked as not ready, so no new copy can be saved yet."
                  : approvalGranted
                    ? "Review is confirmed. Relay Agent can now save the reviewed copy."
                    : "This plan changes the workbook, so one review confirmation is still required."
                : "This plan is review-only, so no new copy will be written."}
            {:else if previewSnapshot}
              {previewSnapshot.requiresApproval
                ? "This restored snapshot came from a save-ready review. Check the changes again before saving in this app run."
                : "This restored snapshot came from a review-only step. Check the changes again to refresh the backend state."}
            {:else if auditHistoryEntry}
              This copy was already saved in an earlier run. Review mode is showing the recorded output path.
            {:else}
              Check the changes after validation succeeds to see where the reviewed copy will go.
            {/if}
          </p>
        </section>

        <section class="preview-card">
          <p class="preview-label">Change size</p>
          <h3>
            {#if previewResult}
              {previewResult.diffSummary.targetCount} target diff{previewResult.diffSummary.targetCount === 1 ? "" : "s"} staged
            {:else if previewSnapshot}
              {previewSnapshot.targetCount} target diff{previewSnapshot.targetCount === 1 ? "" : "s"} restored
            {:else if auditHistoryEntry}
              {auditHistoryEntry.targetCount} target diff{auditHistoryEntry.targetCount === 1 ? "" : "s"} recorded
            {:else}
              Diff preview has not been requested yet.
            {/if}
          </h3>
          <p>
            {#if previewResult}
              {previewResult.diffSummary.estimatedAffectedRows} row{previewResult.diffSummary.estimatedAffectedRows === 1 ? "" : "s"} estimated across the staged target{previewResult.diffSummary.targetCount === 1 ? "" : "s"}.
            {:else if previewSnapshot}
              {previewSnapshot.estimatedAffectedRows} row{previewSnapshot.estimatedAffectedRows === 1 ? "" : "s"} were estimated in the restored snapshot from the last run.
            {:else if auditHistoryEntry}
              {auditHistoryEntry.affectedRows} row{auditHistoryEntry.affectedRows === 1 ? "" : "s"} were recorded in the saved copy for this turn.
            {:else}
              The right pane will show the backend diff summary once preview is available.
            {/if}
          </p>

          {#if previewSummary}
            <p class="support-copy">{previewSummary}</p>
          {/if}
        </section>

        <section class="preview-card">
          <p class="preview-label">Review status</p>
          <h3>
            {#if !previewResult}
              {#if previewSnapshot}
                Review snapshot restored
              {:else if reviewAlreadySaved}
                Review already completed
              {:else}
                Review waits for checked changes.
              {/if}
            {:else if !previewResult.requiresApproval}
              No confirmation needed
            {:else if approvalGranted}
              Ready to save
            {:else if approvalResult?.decision === "rejected"}
              Needs changes
            {:else}
              Confirmation needed
            {/if}
          </h3>
          <p>
            {approvalSummary || (!previewResult
              ? previewSnapshot
                ? "A previous review summary was restored, but you still need to check the changes again before saving."
                : reviewAlreadySaved
                  ? "This turn already completed review and save, so this screen is showing the recorded summary."
                : "Check the changes first so the current diff can be reviewed."
              : !previewResult.requiresApproval
                ? "This plan only reviews the workbook, so there is no save action here."
                : "Confirm the review before Relay Agent can save a new copy.")}
          </p>
        </section>

        <section class="preview-card">
          <p class="preview-label">Save status</p>
          <h3>
            {#if reviewAlreadySaved}
              Already saved
            {:else if !previewResult}
              Save is waiting
            {:else if !previewResult.requiresApproval}
              No save step needed
            {:else if approvalGranted}
              Ready to save
            {:else}
              Review still needed
            {/if}
          </h3>
          <p>{executionSummary || executionBlockedReason}</p>

          {#if executionResult || auditHistoryEntry}
            <div class="result-grid">
              <div class="result-card">
                <p class="preview-label">Result</p>
                <h3>{executionResult?.executed || reviewAlreadySaved ? "Copy saved" : "Recorded only"}</h3>
                <p>{executionResult?.outputPath || auditHistoryEntry?.outputPath || "No output path was produced."}</p>
              </div>
            </div>

            {#if reviewWarnings.length > 0}
              <div class="warning-list">
                {#each reviewWarnings as warning}
                  <span>{warning}</span>
                {/each}
              </div>
            {/if}
          {/if}
        </section>

        {#if showCompletionActions}
          <section class="preview-card">
            <p class="preview-label">{completionHeading}</p>
            <h3>{reviewerMode ? "Share or close this review" : reviewAlreadySaved ? "This turn is complete" : "Useful next steps"}</h3>
            <p>{completionCopy}</p>

            {#if reviewerCopyError}
              <p class="subpanel-error">{reviewerCopyError}</p>
            {/if}

            {#if reviewerCopyMessage}
              <p class="support-copy">{reviewerCopyMessage}</p>
            {/if}

            <div class="action-row action-row-compact">
              <button
                class="secondary-button"
                disabled={!hasReviewSummary}
                type="button"
                on:click={() => void copyReviewerSummary()}
              >
                Copy review summary
              </button>
              {#if reviewerMode}
                <a class="session-link" href={editableStudioHref}>Open editable Studio</a>
              {:else}
                <a class="session-link" href={reviewerViewHref}>Open reviewer view</a>
              {/if}
              <a class="session-link" href="/">Return Home</a>
              {#if !reviewerMode && reviewAlreadySaved}
                <button class="ghost-button" type="button" on:click={handlePrepareNewTurnRequest}>
                  Start another turn
                </button>
              {/if}
            </div>
          </section>
        {/if}

        <section class="preview-card">
          <p class="preview-label">Points to check</p>
          <div class="warning-list">
            {#if reviewWarnings.length > 0}
              {#each reviewWarnings as warning}
                <span>{warning}</span>
              {/each}
            {:else}
              <span>Review notes will appear here after the backend diff is generated.</span>
            {/if}
          </div>
        </section>

        <section class="preview-card">
          <p class="preview-label">Detailed changes</p>

          {#if previewResult}
            {#if previewResult.diffSummary.sheets.length === 0}
              <div class="empty-state empty-inline">
                <h3>No sheet mutations</h3>
                <p>This preview only includes read-only actions, so there is no sheet diff to render.</p>
              </div>
            {:else}
              <div class="sheet-diff-list">
                {#each previewResult.diffSummary.sheets as sheet}
                  <article class="sheet-diff-card">
                    <div class="sheet-diff-head">
                      <h3>{sheet.target.label}</h3>
                      <span>{sheet.estimatedAffectedRows} row{sheet.estimatedAffectedRows === 1 ? "" : "s"} affected</span>
                    </div>

                    <div class="diff-tags">
                      {#each sheet.addedColumns as column}
                        <span class="tag tag-added">+ {column}</span>
                      {/each}

                      {#each sheet.changedColumns as column}
                        <span class="tag tag-changed">~ {column}</span>
                      {/each}

                      {#each sheet.removedColumns as column}
                        <span class="tag tag-removed">- {column}</span>
                      {/each}
                    </div>

                    {#if sheet.warnings.length > 0}
                      <div class="warning-list">
                        {#each sheet.warnings as warning}
                          <span>{warning}</span>
                        {/each}
                      </div>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
          {:else}
            <div class="empty-state empty-inline">
              <h3>No checked changes yet</h3>
              <p>Generate a packet, validate a pasted response, and check the changes to fill this pane with backend diff data.</p>
            </div>
          {/if}
        </section>
      </div>
    </article>
  </section>

  {#if pendingStudioAction}
    <div class="leave-dialog-backdrop" role="presentation">
      <div
        aria-describedby="leave-dialog-copy"
        aria-labelledby="leave-dialog-title"
        aria-modal="true"
        class="leave-dialog"
        role="dialog"
      >
        <p class="pane-label">Before you continue</p>
        <h2 id="leave-dialog-title">
          {pendingStudioAction.kind === "route-leave"
            ? "Leave Studio with this draft?"
            : "Replace the current draft?"}
        </h2>
        <p class="support-copy" id="leave-dialog-copy">
          {#if pendingStudioAction.kind === "route-leave"}
            {describePendingAction(pendingStudioAction)}. Choose whether Home should keep this
            draft for later or remove it now.
          {:else}
            {describePendingAction(pendingStudioAction)}. Continuing will replace the current
            Studio draft for this session.
          {/if}
        </p>

        <ul class="feedback-list leave-dialog-list">
          {#each leaveWarningReasons as reason}
            <li>{reason}</li>
          {/each}
        </ul>

        {#if pendingStudioAction.kind === "route-leave"}
          <div class="action-row leave-dialog-actions">
            <button
              class="primary-button"
              type="button"
              on:click={() => void continueWithRouteLeave(false)}
            >
              Leave and keep draft
            </button>
            <button
              class="secondary-button"
              type="button"
              on:click={() => void continueWithRouteLeave(true)}
            >
              Leave and discard draft
            </button>
            <button class="ghost-button" type="button" on:click={closePendingStudioAction}>
              Stay in Studio
            </button>
          </div>
        {:else}
          <div class="action-row leave-dialog-actions">
            <button class="primary-button" type="button" on:click={closePendingStudioAction}>
              Keep working on this draft
            </button>
            <button class="secondary-button" type="button" on:click={discardDraftAndContinue}>
              {pendingStudioAction.kind === "switch-turn"
                ? "Discard draft and switch turns"
                : "Discard draft and start fresh"}
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .studio-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(16rem, 20rem) minmax(0, 1.55fr) minmax(18rem, 22rem);
  }

  .pane {
    display: grid;
    align-content: start;
    gap: 1rem;
    min-height: 24rem;
  }

  .pane-main {
    min-height: 34rem;
  }

  .pane-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .pane-header h2 {
    margin: 0.2rem 0 0;
  }

  .pane-label {
    margin: 0;
    color: var(--ra-accent-strong);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .pane-copy {
    margin: 0;
    color: var(--ra-muted);
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.4rem 0.72rem;
    border: 1px solid var(--ra-border);
    border-radius: 999px;
    background: var(--ra-surface-strong);
    color: var(--ra-muted);
    font-size: 0.84rem;
    font-weight: 700;
    text-transform: capitalize;
    white-space: nowrap;
  }

  .status-ready,
  .status-active,
  .status-validated,
  .status-preview-ready,
  .status-approved,
  .status-executed {
    border-color: rgba(91, 125, 56, 0.28);
    color: #456626;
    background: rgba(91, 125, 56, 0.1);
  }

  .status-draft,
  .status-pending,
  .status-packet-ready,
  .status-awaiting-response {
    border-color: rgba(138, 90, 23, 0.28);
    color: #8a5a17;
    background: rgba(138, 90, 23, 0.08);
  }

  .status-error,
  .status-failed {
    border-color: rgba(141, 45, 31, 0.28);
    color: #7f2a20;
    background: rgba(141, 45, 31, 0.08);
  }

  .feedback {
    padding: 1rem 1.1rem;
    border-radius: 1rem;
    border: 1px solid transparent;
  }

  .feedback strong,
  .feedback p {
    margin: 0;
  }

  .feedback p {
    margin-top: 0.35rem;
  }

  .feedback-list {
    margin: 0.75rem 0 0;
    padding-left: 1.15rem;
  }

  .feedback-error {
    border-color: rgba(141, 45, 31, 0.22);
    background: rgba(141, 45, 31, 0.08);
    color: #7f2a20;
  }

  .feedback-info {
    border-color: rgba(37, 50, 32, 0.14);
    background: rgba(255, 255, 255, 0.64);
    color: var(--ra-text);
  }

  .feedback-warn {
    border-color: rgba(138, 90, 23, 0.2);
    background: rgba(138, 90, 23, 0.08);
    color: #8a5a17;
  }

  .leave-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: rgba(31, 45, 36, 0.4);
    backdrop-filter: blur(6px);
  }

  .leave-dialog {
    width: min(100%, 34rem);
    display: grid;
    gap: 1rem;
    padding: 1.35rem;
    border: 1px solid var(--ra-border-strong);
    border-radius: 1.2rem;
    background: rgba(255, 251, 244, 0.96);
    box-shadow: 0 1.5rem 3rem rgba(31, 45, 36, 0.18);
  }

  .leave-dialog h2 {
    margin: 0;
  }

  .leave-dialog-list {
    margin-top: 0;
  }

  .leave-dialog-actions {
    justify-content: flex-end;
  }

  .empty-state {
    display: grid;
    gap: 0.45rem;
    padding: 1.1rem;
    border: 1px dashed var(--ra-border-strong);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.54);
  }

  .empty-inline {
    padding: 0.95rem;
  }

  .empty-state h3,
  .empty-state p {
    margin: 0;
  }

  .empty-state p {
    color: var(--ra-muted);
  }

  .session-summary,
  .turn-subpanel {
    display: grid;
    gap: 0.8rem;
  }

  .summary-objective {
    margin: 0;
    color: var(--ra-text);
    line-height: 1.6;
  }

  .session-meta,
  .turn-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    color: var(--ra-muted);
    font-size: 0.9rem;
  }

  .session-meta span,
  .turn-meta span {
    padding: 0.35rem 0.55rem;
    border-radius: 999px;
    background: rgba(31, 45, 36, 0.05);
  }

  .timeline-list,
  .turn-list,
  .workflow-panels,
  .preview-stack,
  .preview-summary-grid,
  .sheet-diff-list {
    display: grid;
    gap: 0.9rem;
  }

  .timeline-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .timeline-item,
  .turn-card {
    display: grid;
    gap: 0.8rem;
    padding: 0.9rem;
    border: 1px solid var(--ra-border);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.7);
  }

  .timeline-item {
    grid-template-columns: auto 1fr;
    align-items: start;
  }

  .turn-card {
    text-align: left;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition:
      border-color 160ms ease,
      transform 160ms ease,
      box-shadow 160ms ease;
  }

  .turn-card:hover,
  .turn-card.selected-turn {
    transform: translateY(-1px);
    border-color: rgba(91, 125, 56, 0.3);
    box-shadow: 0 1rem 2rem rgba(31, 45, 36, 0.08);
  }

  .turn-card-head,
  .subpanel-header,
  .sheet-diff-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .turn-card-head h3,
  .subpanel-header h3,
  .subpanel-header h4,
  .preview-card h3,
  .sheet-diff-head h3 {
    margin: 0;
  }

  .turn-card-head p,
  .sheet-diff-head span,
  .preview-card p {
    margin: 0;
  }

  .turn-card-head p {
    margin-top: 0.35rem;
    color: var(--ra-muted);
    line-height: 1.5;
  }

  .timeline-marker {
    width: 0.8rem;
    height: 0.8rem;
    margin-top: 0.25rem;
    border-radius: 999px;
    background: rgba(138, 90, 23, 0.2);
  }

  .tone-active .timeline-marker {
    background: rgba(138, 90, 23, 0.66);
  }

  .tone-ready .timeline-marker {
    background: rgba(91, 125, 56, 0.8);
  }

  .timeline-copy {
    display: grid;
    gap: 0.3rem;
  }

  .timeline-copy p,
  .timeline-copy span {
    margin: 0;
  }

  .timeline-copy p {
    font-weight: 700;
  }

  .timeline-copy span {
    color: var(--ra-muted);
    line-height: 1.5;
  }

  .workflow-grid {
    display: grid;
    gap: 0.9rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .field {
    display: grid;
    gap: 0.45rem;
  }

  .field-wide {
    grid-column: 1 / -1;
  }

  .field span {
    font-size: 0.9rem;
    font-weight: 700;
  }

  .field input,
  .field textarea,
  .field select,
  .response-draft {
    width: 100%;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--ra-border);
    border-radius: 0.9rem;
    background: rgba(255, 255, 255, 0.95);
    color: var(--ra-text);
    font: inherit;
    font-size: 1rem;
    line-height: 1.5;
  }

  .field textarea,
  .response-draft {
    resize: vertical;
  }

  .field input:focus,
  .field textarea:focus,
  .field select:focus,
  .response-draft:focus,
  .chip-button:focus,
  .turn-card:focus,
  .session-link:focus {
    outline: 3px solid rgba(138, 90, 23, 0.22);
    outline-offset: 2px;
    border-color: var(--ra-accent);
  }

  .action-row,
  .warning-list,
  .diff-tags,
  .result-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .action-row-compact {
    align-items: center;
  }

  .copy-guidance {
    margin-top: 0.9rem;
  }

  .copy-guidance-label {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
  }

  .primary-button,
  .secondary-button,
  .ghost-button,
  .chip-button,
  .session-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.75rem;
    padding: 0.8rem 0.95rem;
    border-radius: 0.95rem;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  .primary-button {
    border: 0;
    background: linear-gradient(135deg, #8a5a17 0%, #5b7d38 100%);
    color: #fffdf7;
  }

  .secondary-button,
  .session-link {
    border: 1px solid var(--ra-border-strong);
    background: var(--ra-surface-strong);
    color: var(--ra-text);
  }

  .ghost-button,
  .chip-button {
    border: 1px dashed var(--ra-border-strong);
    background: transparent;
    color: var(--ra-muted);
  }

  .primary-button:disabled,
  .secondary-button:disabled,
  .ghost-button:disabled,
  .chip-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .subpanel,
  .preview-card,
  .result-card,
  .sheet-diff-card,
  .repair-card {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--ra-border);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.78);
  }

  .preview-summary-grid {
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  }

  .summary-card h3 {
    font-size: 1.15rem;
  }

  .packet-preview {
    margin: 0;
    padding: 0.95rem;
    border-radius: 0.9rem;
    background: rgba(31, 45, 36, 0.06);
    color: var(--ra-text);
    font-family: "Consolas", "Courier New", monospace;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .support-copy {
    margin: 0;
    color: var(--ra-muted);
    line-height: 1.6;
  }

  .subpanel-error {
    margin: 0;
    color: #7f2a20;
    line-height: 1.5;
  }

  .preview-label {
    margin: 0;
    color: var(--ra-accent-strong);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .warning-list span,
  .tag {
    padding: 0.5rem 0.7rem;
    border-radius: 999px;
    font-size: 0.9rem;
  }

  .warning-list span {
    background: rgba(138, 90, 23, 0.08);
    color: #8a5a17;
  }

  .help-subpanel {
    background: rgba(255, 255, 255, 0.72);
  }

  .artifact-browser {
    background: rgba(255, 255, 255, 0.72);
  }

  .turn-details-shell,
  .artifact-evidence-shell {
    display: grid;
    gap: 1rem;
  }

  .turn-details-nav {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  }

  .turn-detail-button {
    display: grid;
    gap: 0.3rem;
    justify-items: start;
    min-height: 0;
    padding: 0.9rem;
    text-align: left;
  }

  .turn-detail-button strong,
  .turn-detail-button span {
    margin: 0;
  }

  .turn-detail-button span {
    color: var(--ra-muted);
    line-height: 1.45;
  }

  .turn-detail-button.selected-turn-detail {
    border-style: solid;
    border-color: rgba(91, 125, 56, 0.28);
    background: rgba(91, 125, 56, 0.08);
    color: var(--ra-text);
  }

  .turn-overview-grid {
    display: grid;
    gap: 0.9rem;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  }

  .turn-overview-card {
    align-content: start;
  }

  .turn-overview-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .turn-detail-list {
    display: grid;
    gap: 0.6rem;
  }

  .turn-detail-list span {
    padding: 0.65rem 0.8rem;
    border-radius: 0.95rem;
    background: rgba(31, 45, 36, 0.05);
    color: var(--ra-text);
    line-height: 1.5;
  }

  .artifact-browser-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(13rem, 16rem) minmax(0, 1fr);
  }

  .artifact-list {
    display: grid;
    gap: 0.75rem;
    align-content: start;
  }

  .artifact-card {
    display: grid;
    gap: 0.35rem;
    width: 100%;
    padding: 0.9rem;
    border: 1px solid var(--ra-border);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.84);
    color: inherit;
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition:
      border-color 160ms ease,
      transform 160ms ease,
      box-shadow 160ms ease;
  }

  .artifact-card:hover,
  .artifact-card.selected-artifact {
    transform: translateY(-1px);
    border-color: rgba(91, 125, 56, 0.3);
    box-shadow: 0 1rem 2rem rgba(31, 45, 36, 0.08);
  }

  .artifact-card strong,
  .artifact-card span,
  .artifact-card small {
    margin: 0;
  }

  .artifact-card span,
  .artifact-card small {
    color: var(--ra-muted);
    line-height: 1.45;
  }

  .artifact-detail {
    display: grid;
    gap: 0.95rem;
    align-content: start;
  }

  .artifact-detail-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .artifact-detail-head h3 {
    margin: 0;
    word-break: break-word;
  }

  .artifact-sheet-grid,
  .artifact-column-grid {
    display: grid;
    gap: 0.9rem;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  }

  .artifact-table-wrap {
    overflow-x: auto;
    border: 1px solid rgba(37, 50, 32, 0.08);
    border-radius: 0.95rem;
    background: rgba(255, 255, 255, 0.86);
  }

  .artifact-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 28rem;
  }

  .artifact-table th,
  .artifact-table td {
    padding: 0.7rem 0.8rem;
    border-bottom: 1px solid rgba(37, 50, 32, 0.08);
    text-align: left;
    vertical-align: top;
  }

  .artifact-table th {
    background: rgba(31, 45, 36, 0.04);
    font-size: 0.9rem;
  }

  .artifact-table td {
    line-height: 1.5;
    word-break: break-word;
  }

  .help-list {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  }

  .help-card {
    display: grid;
    gap: 0.35rem;
    padding: 0.9rem;
    border: 1px solid rgba(37, 50, 32, 0.08);
    border-radius: 0.95rem;
    background: rgba(255, 255, 255, 0.84);
  }

  .help-card strong,
  .help-card p,
  .help-card span {
    margin: 0;
  }

  .help-card p {
    line-height: 1.5;
  }

  .help-card span {
    color: var(--ra-muted);
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .issue-list {
    display: grid;
    gap: 0.75rem;
  }

  .issue-card {
    display: grid;
    gap: 0.35rem;
    padding: 0.9rem;
    border-radius: 0.95rem;
    background: rgba(141, 45, 31, 0.06);
  }

  .issue-card p,
  .issue-card span {
    margin: 0;
  }

  .issue-card span {
    color: #7f2a20;
    font-size: 0.88rem;
  }

  .tag-added {
    background: rgba(91, 125, 56, 0.1);
    color: #456626;
  }

  .tag-changed {
    background: rgba(138, 90, 23, 0.08);
    color: #8a5a17;
  }

  .tag-removed {
    background: rgba(141, 45, 31, 0.08);
    color: #7f2a20;
  }

  @media (max-width: 1180px) {
    .studio-grid {
      grid-template-columns: 1fr;
    }

    .pane,
    .pane-main {
      min-height: 0;
    }
  }

  @media (max-width: 720px) {
    .workflow-grid {
      grid-template-columns: 1fr;
    }

    .artifact-browser-grid {
      grid-template-columns: 1fr;
    }

    .field-wide {
      grid-column: auto;
    }

    .pane-header,
    .turn-card-head,
    .subpanel-header,
    .sheet-diff-head {
      display: grid;
      justify-content: stretch;
    }

    .leave-dialog-actions {
      justify-content: stretch;
    }
  }
</style>
