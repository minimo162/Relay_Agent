<script lang="ts">
  import { browser } from "$app/environment";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import {
    projectInfo,
    type AssessCopilotHandoffResponse,
    type ApprovalDecision,
    type PreviewExecutionResponse,
    type RespondToApprovalResponse,
    type RunExecutionResponse,
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
    loadStudioDraft,
    markStudioDraftClean,
    previewExecution,
    readSession,
    rememberRecentFile,
    rememberRecentSession,
    respondToApproval,
    runExecution,
    saveStudioDraft,
    startTurn,
    submitCopilotResponse,
    type PersistedPreviewSnapshot
  } from "$lib";
  import { createStudioState } from "$lib/studio-state";

  type RelayMode = "discover" | "plan" | "repair" | "followup";
  type StudioTimelineTone = "pending" | "active" | "ready";
  type StudioTimelineEntry = {
    id: string;
    label: string;
    note: string;
    tone: StudioTimelineTone;
  };

  const studio = createStudioState();
  const studioState = studio.state;
  const relayModes = projectInfo.supportedRelayModes;

  let currentSessionId: string | null = null;
  let sessionDetail: SessionDetail | null = null;
  let selectedTurnId: string | null = null;
  let restoredPreviewSnapshot: PersistedPreviewSnapshot | null = null;
  let previewSnapshot: PersistedPreviewSnapshot | null = null;
  let continuityNotice = "";
  let draftPersistenceEnabled = false;

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

  let validationResult: SubmitCopilotResponseResponse | null = null;
  let previewResult: PreviewExecutionResponse | null = null;
  let approvalResult: RespondToApprovalResponse | null = null;
  let executionResult: RunExecutionResponse | null = null;

  let lastLoadToken = 0;
  let lastRawResponse = "";

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
    const handleLeave = (): void => {
      if (currentSessionId) {
        markStudioDraftClean(currentSessionId);
      }
    };

    window.addEventListener("beforeunload", handleLeave);

    return () => {
      handleLeave();
      window.removeEventListener("beforeunload", handleLeave);
    };
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
    continuityNotice = "";
    syncDraftFromTurn(turn);
    clearAllCommandFeedback(true);

    if (turn) {
      sessionNotice = `Turn "${turn.title}" is selected. Generate a packet in this run before validating a pasted response.`;
    } else if (sessionDetail) {
      sessionNotice = `Session "${sessionDetail.session.title}" is ready for a new turn.`;
    }
  }

  function prepareNewTurnDraft(): void {
    if (currentSessionId) {
      discardStudioDraft(currentSessionId);
    }

    selectedTurnId = null;
    restoredPreviewSnapshot = null;
    continuityNotice = "";
    syncDraftFromTurn(null);
    studio.updateWorkbookPath(sessionDetail?.session.primaryWorkbookPath ?? "");
    studio.updateWorkbookFocus("Sheet1");
    clearAllCommandFeedback(true);
    sessionNotice = sessionDetail
      ? `Session "${sessionDetail.session.title}" is ready for a new turn.`
      : "Select a session from Home to start a new turn.";
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

  async function loadStudioSession(sessionId: string | null): Promise<void> {
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
      const savedDraft = loadStudioDraft(detail.session.id);
      const fallbackTurn =
        turns.find((turn) => turn.id === detail.session.latestTurnId) ?? turns[0] ?? null;
      const restoredTurnId = restoreContinuityDraft(detail, fallbackTurn?.id ?? null);
      const preferredTurn =
        turns.find((turn) => turn.id === restoredTurnId) ??
        (restoredTurnId === null ? null : fallbackTurn);

      if (savedDraft) {
        markStudioDraftClean(detail.session.id);
      }

      if (preferredTurn && !savedDraft) {
        selectTurn(preferredTurn);
      } else if (preferredTurn) {
        selectedTurnId = preferredTurn.id;
        sessionNotice =
          continuityNotice || `Turn "${preferredTurn.title}" is selected and ready to resume.`;
      } else if (restoredTurnId === null) {
        selectedTurnId = null;
        sessionNotice = continuityNotice || `Session "${detail.session.title}" is ready for a new turn.`;
      } else {
        syncDraftFromTurn(null);
        sessionNotice = `Session "${detail.session.title}" is ready for its first turn.`;
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
        ? `Preview is ready and approval will be required before any write execution. Output target: ${result.diffSummary.outputPath}.`
        : `Preview is ready with no approval gate for this action set. Output target: ${result.diffSummary.outputPath}.`;
      sessionNotice = result.requiresApproval
        ? "Preview generated. Review the diff and record approval before requesting execution."
        : "Preview generated. Review the diff and request execution when ready.";
      await refreshSessionDetail(selectedTurnId);
    } catch (error) {
      previewError = toErrorMessage(error);
    } finally {
      previewPending = false;
    }
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
            ? "Approval recorded. Execution is now enabled for the current preview."
            : "Approval recorded, but the backend still marks execution as unavailable."
          : "Rejection recorded. Execution remains blocked until approval is granted.";
      sessionNotice =
        decision === "approved"
          ? "Approval recorded. Execution can now be requested for this preview."
          : "Preview rejection recorded. Execution stays blocked until approval is granted.";
      await refreshSessionDetail(selectedTurnId);
    } catch (error) {
      approvalError = toErrorMessage(error);
    } finally {
      approvalPending = false;
    }
  }

  async function handleExecution(): Promise<void> {
    if (!sessionDetail || !selectedTurnId || !previewResult) {
      return;
    }

    executionPending = true;
    executionError = "";

    try {
      const result = await runExecution({
        sessionId: sessionDetail.session.id,
        turnId: selectedTurnId
      });

      executionResult = result;
      executionSummary = result.executed
        ? "Execution completed for the current turn."
        : result.reason ?? "Execution request was recorded without applying changes.";
      sessionNotice = result.executed
        ? "Execution completed. Review the recorded warnings and artifacts for this turn."
        : result.reason ?? "Execution request was recorded.";
      await refreshSessionDetail(selectedTurnId);
    } catch (error) {
      executionError = toErrorMessage(error);
    } finally {
      executionPending = false;
    }
  }

  $: routeSessionId = $page.url.searchParams.get("sessionId");

  $: if (browser && routeSessionId !== currentSessionId) {
    void loadStudioSession(routeSessionId);
  }

  $: previewSnapshot = previewResult
    ? buildPreviewSnapshot(previewResult)
    : restoredPreviewSnapshot;

  $: turns = sessionDetail ? sortTurns(sessionDetail.turns) : [];

  $: selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? null;

  $: stageTimeline = [
    {
      id: "session",
      label: "Session detail",
      note: sessionDetail
        ? `${sessionDetail.turns.length} persisted turn${sessionDetail.turns.length === 1 ? "" : "s"} loaded from local JSON storage.`
        : routeSessionId
          ? "Loading the selected session detail."
          : "Open a session from Home to continue.",
      tone: sessionDetail ? "ready" : routeSessionId ? "active" : "pending"
    },
    {
      id: "turn",
      label: "Turn selection",
      note: selectedTurn
        ? `${selectedTurn.title} is selected. ${summarizeTurnStatus(selectedTurn.status)}`
        : $studioState.turnTitle.trim() || $studioState.turnObjective.trim()
          ? "Draft fields are filled in and ready for a new turn."
          : "Start a new turn or pick an existing one from the left pane.",
      tone: selectedTurn ? "ready" : $studioState.turnTitle.trim() || $studioState.turnObjective.trim() ? "active" : "pending"
    },
    {
      id: "packet",
      label: "Relay packet",
      note: relayPacketSummary || "Generate a relay packet for the selected turn.",
      tone: relayPacketText ? "ready" : selectedTurn ? "active" : "pending"
    },
    {
      id: "validation",
      label: "Validation feedback",
      note: validationSummary || "Paste a Copilot JSON response and validate it here.",
      tone: validationResult ? (validationResult.accepted ? "ready" : "active") : "pending"
    },
    {
      id: "preview",
      label: "Preview request",
      note: previewSummary || "Request preview after validation succeeds.",
      tone: previewResult ? "ready" : validationResult?.accepted ? "active" : "pending"
    },
    {
      id: "approval",
      label: "Approval gate",
      note: !previewResult
        ? "Record an approval decision after preview is ready."
        : !previewResult.requiresApproval
          ? "This preview is read-only, so no approval step is required."
          : selectedTurn?.status === "approved"
            ? approvalSummary || "Approval was recorded and execution is now available."
            : approvalResult?.decision === "rejected"
              ? approvalSummary || "Preview was rejected. Execution remains blocked."
              : "Preview is waiting for an approval decision before execution can proceed.",
      tone: !previewResult
        ? "pending"
        : !previewResult.requiresApproval || selectedTurn?.status === "approved"
          ? "ready"
          : "active"
    },
    {
      id: "execution",
      label: "Execution request",
      note: executionSummary
        || (!previewResult
          ? "Execution stays locked until preview is ready."
          : previewResult.requiresApproval && selectedTurn?.status !== "approved"
            ? approvalResult?.decision === "rejected"
              ? "Execution is blocked because the current preview was rejected."
              : "Execution is blocked until approval is recorded."
            : "Execution can be requested from the preview pane."),
      tone: executionResult
        ? executionResult.executed
          ? "ready"
          : "active"
        : !previewResult
          ? "pending"
          : previewResult.requiresApproval && selectedTurn?.status !== "approved"
            ? "pending"
            : "active"
    }
  ] satisfies StudioTimelineEntry[];

  $: reloadNote =
    selectedTurn && !relayPacketText && !validationResult && !previewResult && selectedTurn.itemIds.length > 0
      ? "This turn was reloaded from local storage. Packet, validation, preview, and approval runtime state are not resumable yet, so regenerate preview and re-record approval in the current app run before execution."
      : "";

  $: approvalGranted = previewResult
    ? !previewResult.requiresApproval
      || selectedTurn?.status === "approved"
      || approvalResult?.readyForExecution
    : false;

  $: executionBlockedReason =
    !previewResult
      ? "Request preview after validation succeeds."
      : previewResult.requiresApproval && !approvalGranted
        ? approvalResult?.decision === "rejected"
          ? "Approval was rejected. Record an approved decision to continue."
          : "Approve the current preview before execution can be requested."
        : "Execution can be requested for the current preview.";

  $: if ($studioState.rawResponse !== lastRawResponse) {
    lastRawResponse = $studioState.rawResponse;

    if (!validationPending && !previewPending && (validationResult || previewResult || validationError || previewError || validationSummary || previewSummary)) {
      clearValidationAndPreview(false);
    }
  }

  $: if (browser && draftPersistenceEnabled && currentSessionId) {
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
    <h1 class="ra-headline">Run the relay flow through preview, approval, and execution gating.</h1>
    <p class="ra-lede">
      Studio now loads persisted session detail, starts turns through the typed IPC layer,
      generates relay packets, validates pasted Copilot JSON responses, requests preview
      summaries from the Rust backend, and records approval decisions before execution can run.
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
        detail and lets you step through the current turn workflow in order.
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
            <button class="chip-button" type="button" on:click={prepareNewTurnDraft}>
              Prepare new turn
            </button>
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
                  class:selected-turn={turn.id === selectedTurnId}
                  class="turn-card"
                  type="button"
                  on:click={() => selectTurn(turn)}
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
            <li class={`timeline-item tone-${entry.tone}`}>
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
        The center pane now drives the real backend command surface: start a turn, generate
        the relay packet, paste the Copilot response, inspect validation feedback, and ask
        the backend for a preview before approval and execution controls unlock in the diff pane.
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
          {previewPending ? "Requesting preview..." : previewResult ? "Refresh preview" : "Request preview"}
        </button>

        <button class="ghost-button" type="button" on:click={prepareNewTurnDraft}>
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
            <h3>Pasted response</h3>
            <span class={`status-pill ${$studioState.rawResponse.trim() ? "status-ready" : "status-pending"}`}>
              {$studioState.rawResponse.trim() ? "captured" : "empty"}
            </span>
          </div>

          <p class="support-copy">
            Paste the Copilot response JSON here. The validation command checks the schema and
            tool/action payload shapes before preview is allowed.
          </p>

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

              {#if validationResult.repairPrompt}
                <div class="repair-card">
                  <p class="preview-label">Repair prompt</p>
                  <pre class="packet-preview">{validationResult.repairPrompt}</pre>
                </div>
              {/if}
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
    </article>

    <article class="ra-panel pane pane-preview">
      <div class="pane-header">
        <div>
          <p class="pane-label">Workbook preview</p>
          <h2>Diff, approval, and execution readiness</h2>
        </div>
        <span class={`status-pill ${previewResult || previewSnapshot ? "status-ready" : "status-pending"}`}>
          {#if previewResult}
            preview ready
          {:else if previewSnapshot}
            snapshot restored
          {:else}
            awaiting preview
          {/if}
        </span>
      </div>

      {#if previewError}
        <section class="feedback feedback-error" aria-live="polite">
          <strong>Preview issue</strong>
          <p>{previewError}</p>
        </section>
      {/if}

      <div class="preview-stack">
        <section class="preview-card">
          <p class="preview-label">Source path</p>
          <h3>{previewResult?.diffSummary.sourcePath || previewSnapshot?.sourcePath || $studioState.workbookPath || sessionDetail?.session.primaryWorkbookPath || "No workbook path has been staged yet."}</h3>
          <p>{$studioState.workbookFocus || "Sheet1"}</p>
        </section>

        <section class="preview-card">
          <p class="preview-label">Output and approval</p>
          <h3>{previewResult?.diffSummary.outputPath || previewSnapshot?.outputPath || "Preview output path will appear here."}</h3>
          <p>
            {#if previewResult}
              {previewResult.requiresApproval
                ? approvalResult?.decision === "rejected"
                  ? "Preview was rejected. Execution remains blocked until it is approved."
                  : approvalGranted
                    ? "Preview was approved. Execution can now be requested."
                    : "Preview includes write-capable actions, so approval will be required."
                : "Preview contains no approval-gated actions."}
            {:else if previewSnapshot}
              {previewSnapshot.requiresApproval
                ? "This restored snapshot came from an approval-gated preview. Request preview again before execution."
                : "This restored snapshot came from a read-only preview. Request preview again to refresh the backend state."}
            {:else}
              Request preview after validation succeeds to see the output target and gating.
            {/if}
          </p>
        </section>

        <section class="preview-card">
          <p class="preview-label">Diff headline</p>
          <h3>
            {#if previewResult}
              {previewResult.diffSummary.targetCount} target diff{previewResult.diffSummary.targetCount === 1 ? "" : "s"} staged
            {:else if previewSnapshot}
              {previewSnapshot.targetCount} target diff{previewSnapshot.targetCount === 1 ? "" : "s"} restored
            {:else}
              Diff preview has not been requested yet.
            {/if}
          </h3>
          <p>
            {#if previewResult}
              {previewResult.diffSummary.estimatedAffectedRows} row{previewResult.diffSummary.estimatedAffectedRows === 1 ? "" : "s"} estimated across the staged target{previewResult.diffSummary.targetCount === 1 ? "" : "s"}.
            {:else if previewSnapshot}
              {previewSnapshot.estimatedAffectedRows} row{previewSnapshot.estimatedAffectedRows === 1 ? "" : "s"} were estimated in the restored snapshot from the last run.
            {:else}
              The right pane will show the backend diff summary once preview is available.
            {/if}
          </p>

          {#if previewSummary}
            <p class="support-copy">{previewSummary}</p>
          {/if}
        </section>

        <section class="preview-card">
          <p class="preview-label">Approval decision</p>
          <h3>
            {#if !previewResult}
              {previewSnapshot ? "Preview snapshot restored" : "Approval waits for preview."}
            {:else if !previewResult.requiresApproval}
              No approval required
            {:else if approvalGranted}
              Approved for execution
            {:else if approvalResult?.decision === "rejected"}
              Rejected for now
            {:else}
              Decision required
            {/if}
          </h3>
          <p>
            {approvalSummary || (!previewResult
              ? previewSnapshot
                ? "A previous preview summary was restored, but you still need a fresh preview before approval or execution."
                : "Generate preview first so the current diff can be reviewed."
              : !previewResult.requiresApproval
                ? "This preview is read-only, so execution is already available."
                : "Record an approval decision before write execution can proceed.")}
          </p>

          {#if approvalError}
            <p class="subpanel-error">{approvalError}</p>
          {/if}

          {#if previewResult && previewResult.requiresApproval}
            <label class="field">
              <span>Approval note</span>
              <textarea
                on:input={(event) => (approvalNote = (event.currentTarget as HTMLTextAreaElement).value)}
                placeholder="Optional note for why this preview is safe to run."
                rows="3"
              >{approvalNote}</textarea>
            </label>

            <div class="action-row action-row-compact">
              <button
                class="primary-button"
                disabled={approvalPending}
                type="button"
                on:click={() => void handleApproval("approved")}
              >
                {approvalPending ? "Recording approval..." : "Approve preview"}
              </button>

              <button
                class="ghost-button"
                disabled={approvalPending}
                type="button"
                on:click={() => void handleApproval("rejected")}
              >
                Reject preview
              </button>
            </div>
          {/if}
        </section>

        <section class="preview-card">
          <p class="preview-label">Execution readiness</p>
          <h3>
            {#if !previewResult}
              Execution is locked
            {:else if approvalGranted}
              Ready to request execution
            {:else}
              Approval still required
            {/if}
          </h3>
          <p>{executionSummary || executionBlockedReason}</p>

          {#if executionError}
            <p class="subpanel-error">{executionError}</p>
          {/if}

          <div class="action-row action-row-compact">
            <button
              class="secondary-button"
              disabled={!previewResult || executionPending || !approvalGranted}
              type="button"
              on:click={() => void handleExecution()}
            >
              {executionPending
                ? "Requesting execution..."
                : executionResult
                  ? "Request execution again"
                  : "Request execution"}
            </button>
          </div>

          {#if executionResult}
            <div class="result-grid">
              <div class="result-card">
                <p class="preview-label">Result</p>
                <h3>{executionResult.executed ? "Executed" : "Recorded only"}</h3>
                <p>{executionResult.outputPath || "No output path was produced."}</p>
              </div>
            </div>

            {#if executionResult.warnings.length > 0}
              <div class="warning-list">
                {#each executionResult.warnings as warning}
                  <span>{warning}</span>
                {/each}
              </div>
            {/if}
          {/if}
        </section>

        <section class="preview-card">
          <p class="preview-label">Warnings</p>
          <div class="warning-list">
            {#if previewResult && previewResult.warnings.length > 0}
              {#each previewResult.warnings as warning}
                <span>{warning}</span>
              {/each}
            {:else if previewSnapshot && previewSnapshot.warnings.length > 0}
              {#each previewSnapshot.warnings as warning}
                <span>{warning}</span>
              {/each}
            {:else}
              <span>Preview warnings will appear here after the backend diff is generated.</span>
            {/if}
          </div>
        </section>

        <section class="preview-card">
          <p class="preview-label">Sheet diff summary</p>

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
              <h3>No preview yet</h3>
              <p>Generate a packet, validate a pasted response, and request preview to fill this pane with backend diff data.</p>
            </div>
          {/if}
        </section>
      </div>
    </article>
  </section>
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
    outline: 2px solid rgba(138, 90, 23, 0.18);
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
  }
</style>
