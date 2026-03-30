<script lang="ts">
  import { onMount } from "svelte";
  import type {
    DiffSummary,
    GenerateRelayPacketResponse,
    PreflightWorkbookResponse,
    StartupIssue,
    ValidationIssue
  } from "@relay-agent/contracts";
  import {
    createSession,
    discardStudioDraft,
    generateRelayPacket,
    initializeApp,
    listRecoverableStudioDrafts,
    listRecentSessions,
    loadStudioDraft,
    markStudioDraftClean,
    pingDesktop,
    preflightWorkbook,
    previewExecution,
    rememberRecentFile,
    rememberRecentSession,
    respondToApproval,
    runExecution,
    saveStudioDraft,
    startTurn,
    submitCopilotResponse,
    type PersistedStudioDraft,
    type RecentSession
  } from "$lib";
  import { autoFixCopilotResponse } from "$lib/auto-fix";

  type GuidedStage = "setup" | "copilot" | "review-save";
  type ProgressStatus = "waiting" | "running" | "done" | "error";
  type ProgressItem = {
    id: string;
    label: string;
    status: ProgressStatus;
    message?: string;
  };
  type ValidationFeedback = {
    level: 1 | 2 | 3;
    title: string;
    summary: string;
    specificError: string;
    details: string[];
  };

  const expertDetailsStoragePrefix = "relay-agent.expert-details";
  const expectedResponseShape =
    '{ "version": "1.0", "summary": "...", "actions": [...] }';
  const expectedResponseTemplate = `{
  "version": "1.0",
  "summary": "何をするかを短く説明する",
  "actions": [
    {
      "tool": "table.filter_rows",
      "sheet": "Sheet1",
      "args": {
        "predicate": "[approved] == true"
      }
    },
    {
      "tool": "workbook.save_copy",
      "args": {
        "outputPath": "/absolute/path/output.copy.csv"
      }
    }
  ]
}`;
  const stepBanner = [
    {
      id: "setup" as const,
      number: "1",
      title: "はじめる",
      description: "ファイルとやりたいことを決めて、Copilot に渡す依頼を準備します。"
    },
    {
      id: "copilot" as const,
      number: "2",
      title: "Copilot に聞く",
      description: "Copilot の回答を貼り付けて、変更前の確認まで進めます。"
    },
    {
      id: "review-save" as const,
      number: "3",
      title: "確認して保存",
      description: "変更内容を見て、元ファイルを変えずに別コピーを保存します。"
    }
  ];

  let guidedStage: GuidedStage = "setup";
  let busy = false;
  let errorMsg = "";
  let settingsOpen = false;

  let startupIssue: StartupIssue | null = null;
  let storagePath: string | null = null;
  let sampleWorkbookPath: string | null = null;

  let filePath = "";
  let objectiveText = "";
  let taskName = "";
  let taskNameEdited = false;
  let preflight: PreflightWorkbookResponse | null = null;

  let sessionId = "";
  let turnId = "";
  let relayPacket: GenerateRelayPacketResponse | null = null;
  let relayPacketText = "";
  let copilotInstructionText = "";
  let copiedInstructionNotice = "";
  let copilotResponse = "";
  let originalCopilotResponse = "";
  let autoFixMessages: string[] = [];
  let validationFeedback: ValidationFeedback | null = null;
  let retryPrompt = "";
  let showInstructionPreview = false;

  let previewSummary = "";
  let previewTargetCount = 0;
  let previewAffectedRows = 0;
  let previewOutputPath = "";
  let previewWarnings: string[] = [];
  let previewRequiresApproval = false;
  let previewChangeDetails: string[] = [];
  let previewSheetDiffs: DiffSummary["sheets"] = [];
  let showDetailedChanges = false;
  let executionDone = false;
  let executionSummary = "";

  let recentSessions: RecentSession[] = [];
  let recoverableDraftSessionIds: string[] = [];
  let showRecent = false;
  let progressItems: ProgressItem[] = [];
  let expertDetailsOpen = false;
  let hydratingDraft = false;
  let lastSavedDraftSignature = "";

  const templates = [
    {
      label: "ファイルを安全に確認",
      objective: "ファイルを開いて、変更予定を表示し、安全なコピーを保存する"
    },
    {
      label: "必要な行だけ抽出",
      objective: "必要な行だけ残して、結果を説明し、別コピーとして保存する"
    },
    {
      label: "条件で行を絞り込む",
      objective: "条件に合う行だけ残して、変更点を確認できるコピーを保存する"
    },
    {
      label: "列名を変更",
      objective: "指定した列名を変更して、影響を表示し、別コピーとして保存する"
    },
    {
      label: "合計を集計",
      objective: "指定した行の合計を集計して、結果を説明し、別コピーとして保存する"
    }
  ];

  function toError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return "予期しないエラーが発生しました";
  }

  function deriveTitle(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
      return "新しい作業";
    }

    const first = trimmed.split(/[,.、。]/)[0].trim();
    return first.length > 30 ? `${first.slice(0, 30)}…` : first;
  }

  function updateObjective(nextObjective: string): void {
    objectiveText = nextObjective;

    if (!taskNameEdited || !taskName.trim()) {
      taskName = deriveTitle(nextObjective);
    }
  }

  function handleTaskNameInput(nextTaskName: string): void {
    taskNameEdited = true;
    taskName = nextTaskName;

    if (!taskName.trim()) {
      taskNameEdited = false;
      taskName = deriveTitle(objectiveText);
    }
  }

  function isBundledRevenueDemo(path: string): boolean {
    return /(^|[\\/])revenue-workflow-demo\.csv$/i.test(path.trim());
  }

  function buildCopilotInstructionText(
    packet: GenerateRelayPacketResponse,
    workbookPath: string,
    title: string
  ): string {
    const toolLines = [...packet.allowedReadTools, ...packet.allowedWriteTools].map(
      (tool) => `- ${tool.id}: ${tool.description}`
    );
    const example = isBundledRevenueDemo(workbookPath)
      ? `{
  "version": "1.0",
  "summary": "approved が true の行だけ残し、amount の確認列を追加して別コピーを保存します。",
  "actions": [
    {
      "tool": "table.filter_rows",
      "sheet": "Sheet1",
      "args": {
        "predicate": "[approved] == true"
      }
    },
    {
      "tool": "table.derive_column",
      "sheet": "Sheet1",
      "args": {
        "column": "amount_check",
        "expression": "[amount]",
        "position": "end"
      }
    },
    {
      "tool": "workbook.save_copy",
      "args": {
        "outputPath": "/absolute/path/revenue-workflow-demo.reviewed.csv"
      }
    }
  ]
}`
      : `{
  "version": "1.0",
  "summary": "条件に合う行だけ残して別コピーを保存します。",
  "actions": [
    {
      "tool": "table.filter_rows",
      "sheet": "Sheet1",
      "args": {
        "predicate": "[approved] == true"
      }
    },
    {
      "tool": "workbook.save_copy",
      "args": {
        "outputPath": "/absolute/path/reviewed-output.copy.csv"
      }
    }
  ]
}`;

    return [
      "Relay Agent からの依頼です。",
      "",
      "1. やりたいこと",
      `- 作業名: ${title}`,
      `- 目的: ${packet.objective}`,
      "",
      "2. 対象ファイル",
      `- ファイル: ${workbookPath}`,
      "",
      "3. 使ってよい操作",
      ...toolLines,
      "",
      "4. 回答ルール",
      "- JSON のみを返してください。",
      "- ``` で囲まないでください。",
      "- パス区切りは / を使ってください。",
      "- 上にない tool は使わないでください。",
      "",
      "5. 回答テンプレート",
      expectedResponseTemplate,
      "",
      "6. 回答例",
      example
    ].join("\n");
  }

  function allowedToolIds(): string[] {
    if (!relayPacket) {
      return [];
    }

    return [...relayPacket.allowedReadTools, ...relayPacket.allowedWriteTools].map(
      (tool) => tool.id
    );
  }

  function classifyValidationIssues(
    issues: ValidationIssue[],
    allowedTools: string[]
  ): ValidationFeedback {
    const invalidJsonIssue = issues.find((issue) => issue.code === "invalid_json");
    if (invalidJsonIssue) {
      return {
        level: 1,
        title: "JSON の書き方を直してください",
        summary: "回答を JSON として読めませんでした。余分な記号やカンマを確認してください。",
        specificError: invalidJsonIssue.message,
        details: [
          "JSON だけを返してください。",
          "``` は付けないでください。",
          "カンマや引用符の閉じ忘れを確認してください。"
        ]
      };
    }

    const unknownToolIssue = issues.find((issue) => issue.code === "unknown_tool");
    if (unknownToolIssue) {
      return {
        level: 3,
        title: "使える操作名が違います",
        summary: "書式は読めましたが、許可されていない tool 名が含まれています。",
        specificError: unknownToolIssue.message,
        details: [
          `使える tool: ${allowedTools.join(", ")}`,
          "tool 名はそのまま使ってください。"
        ]
      };
    }

    return {
      level: 2,
      title: "必要な項目が足りないか、形が違います",
      summary: "JSON には見えましたが、Relay Agent が必要とする項目がそろっていません。",
      specificError:
        issues[0]?.message ?? "summary または actions の形を確認してください。",
      details: [
        "version / summary / actions を含めてください。",
        "actions は配列で返してください。",
        `期待する形式: ${expectedResponseShape}`
      ]
    };
  }

  function buildRetryPrompt(
    feedback: ValidationFeedback,
    allowedTools: string[]
  ): string {
    return [
      "先ほどの回答は Relay Agent で受け付けられませんでした。",
      `問題: ${feedback.specificError}`,
      "",
      "次の3つを守って、同じ内容を JSON だけで返してください。",
      "1. ``` で囲まない",
      "2. パスは / 区切りで書く",
      "3. JSON 以外の説明文を付けない",
      "",
      `使える tool: ${allowedTools.join(", ")}`,
      "",
      "期待するテンプレート:",
      expectedResponseTemplate
    ].join("\n");
  }

  function stepState(candidate: GuidedStage): "completed" | "current" | "waiting" {
    const order: GuidedStage[] = ["setup", "copilot", "review-save"];
    const currentIndex = order.indexOf(guidedStage);
    const candidateIndex = order.indexOf(candidate);

    if (candidateIndex < currentIndex) {
      return "completed";
    }

    if (candidateIndex === currentIndex) {
      return "current";
    }

    return "waiting";
  }

  function setProgress(labels: string[]): void {
    progressItems = labels.map((label, index) => ({
      id: `${index}-${label}`,
      label,
      status: index === 0 ? "running" : "waiting"
    }));
  }

  function markProgress(index: number, status: ProgressStatus, message?: string): void {
    if (index < 0) {
      return;
    }

    progressItems = progressItems.map((item, itemIndex) => {
      if (itemIndex < index && item.status !== "error") {
        return { ...item, status: "done" };
      }

      if (itemIndex === index) {
        return { ...item, status, message };
      }

      if (itemIndex === index + 1 && status === "done" && item.status === "waiting") {
        return { ...item, status: "running" };
      }

      return item;
    });
  }

  function failCurrentProgress(message: string): void {
    const index = progressItems.findIndex((item) => item.status === "running");
    markProgress(index, "error", message);
  }

  function clearProgress(): void {
    progressItems = [];
  }

  function loadExpertDetails(): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    const key = `${expertDetailsStoragePrefix}:${sessionId || "draft"}`;
    expertDetailsOpen = localStorage.getItem(key) === "open";
  }

  function persistExpertDetails(): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    const key = `${expertDetailsStoragePrefix}:${sessionId || "draft"}`;
    localStorage.setItem(key, expertDetailsOpen ? "open" : "closed");
  }

  function toggleExpertDetails(): void {
    expertDetailsOpen = !expertDetailsOpen;
    persistExpertDetails();
  }

  function refreshContinuityState(): void {
    recentSessions = listRecentSessions();
    recoverableDraftSessionIds = listRecoverableStudioDrafts().map((draft) => draft.sessionId);
  }

  function hasRecoverableDraft(sessionId: string): boolean {
    return recoverableDraftSessionIds.includes(sessionId);
  }

  function parseRelayPacket(
    packetText: string
  ): GenerateRelayPacketResponse | null {
    if (!packetText.trim()) {
      return null;
    }

    try {
      return JSON.parse(packetText) as GenerateRelayPacketResponse;
    } catch {
      return null;
    }
  }

  function applyRecentSessionFallback(session: RecentSession): void {
    guidedStage = "setup";
    errorMsg = "";
    copiedInstructionNotice = "";
    validationFeedback = null;
    retryPrompt = "";
    clearProgress();
    sessionId = "";
    turnId = "";
    relayPacket = null;
    relayPacketText = "";
    copilotInstructionText = "";
    copilotResponse = "";
    originalCopilotResponse = "";
    autoFixMessages = [];
    previewSummary = "";
    previewTargetCount = 0;
    previewAffectedRows = 0;
    previewOutputPath = "";
    previewWarnings = [];
    previewRequiresApproval = false;
    previewChangeDetails = [];
    previewSheetDiffs = [];
    showDetailedChanges = false;
    executionDone = false;
    executionSummary = "";
    filePath = session.workbookPath;
    if (session.lastTurnTitle.trim()) {
      taskNameEdited = true;
      taskName = session.lastTurnTitle;
    }
    loadExpertDetails();
  }

  function applyRecoverableDraft(
    draft: PersistedStudioDraft,
    session: RecentSession
  ): void {
    hydratingDraft = true;

    guidedStage = "copilot";
    errorMsg = "";
    copiedInstructionNotice = "";
    validationFeedback = null;
    retryPrompt = "";
    clearProgress();
    preflight = null;
    sessionId = draft.sessionId;
    turnId = draft.selectedTurnId ?? "";
    filePath = draft.workbookPath || session.workbookPath;
    objectiveText = draft.turnObjective;
    taskName = draft.turnTitle || session.lastTurnTitle || session.title;
    taskNameEdited = Boolean(taskName.trim());
    relayPacketText = draft.relayPacketText;
    const restoredPacket = parseRelayPacket(draft.relayPacketText);
    relayPacket = restoredPacket;
    copilotInstructionText = restoredPacket
      ? buildCopilotInstructionText(restoredPacket, filePath, taskName)
      : "";
    copilotResponse = draft.rawResponse;
    originalCopilotResponse = "";
    autoFixMessages = [];
    previewSummary = draft.previewSummary;
    previewTargetCount = draft.previewSnapshot?.targetCount ?? 0;
    previewAffectedRows = draft.previewSnapshot?.estimatedAffectedRows ?? 0;
    previewOutputPath = draft.previewSnapshot?.outputPath ?? "";
    previewWarnings = draft.previewSnapshot?.warnings ?? [];
    previewRequiresApproval = draft.previewSnapshot?.requiresApproval ?? false;
    previewChangeDetails = [];
    previewSheetDiffs = [];
    showDetailedChanges = false;
    executionDone = false;
    executionSummary = draft.executionSummary;
    showRecent = false;
    loadExpertDetails();
    hydratingDraft = false;
  }

  function handleRecentSessionClick(session: RecentSession): void {
    const recoverableDraft = hasRecoverableDraft(session.sessionId)
      ? loadStudioDraft(session.sessionId)
      : null;

    if (recoverableDraft) {
      applyRecoverableDraft(recoverableDraft, session);
    } else {
      applyRecentSessionFallback(session);
    }

    rememberRecentSession({
      ...session,
      lastOpenedAt: new Date().toISOString()
    });
    refreshContinuityState();
  }

  async function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }

  async function copyCopilotInstruction(): Promise<void> {
    if (!copilotInstructionText.trim()) {
      return;
    }

    await copyToClipboard(copilotInstructionText);
    copiedInstructionNotice = "Copilot に渡すテキストをコピーしました。";
  }

  function undoAutoFix(): void {
    if (!originalCopilotResponse.trim()) {
      return;
    }

    copilotResponse = originalCopilotResponse;
    autoFixMessages = [];
    originalCopilotResponse = "";
  }

  async function copyRetryPrompt(): Promise<void> {
    if (!retryPrompt.trim()) {
      return;
    }

    await copyToClipboard(retryPrompt);
  }

  function goToSetup(): void {
    guidedStage = "setup";
    errorMsg = "";
    clearProgress();
  }

  function goToCopilot(): void {
    guidedStage = "copilot";
    errorMsg = "";
    clearProgress();
  }

  function resetAll(): void {
    if (sessionId) {
      discardStudioDraft(sessionId);
    }

    guidedStage = "setup";
    busy = false;
    errorMsg = "";
    filePath = "";
    objectiveText = "";
    taskName = "";
    taskNameEdited = false;
    preflight = null;
    sessionId = "";
    turnId = "";
    relayPacket = null;
    relayPacketText = "";
    copilotInstructionText = "";
    copiedInstructionNotice = "";
    copilotResponse = "";
    originalCopilotResponse = "";
    autoFixMessages = [];
    validationFeedback = null;
    retryPrompt = "";
    showInstructionPreview = false;
    previewSummary = "";
    previewTargetCount = 0;
    previewAffectedRows = 0;
    previewOutputPath = "";
    previewWarnings = [];
    previewRequiresApproval = false;
    previewChangeDetails = [];
    previewSheetDiffs = [];
    showDetailedChanges = false;
    executionDone = false;
    executionSummary = "";
    clearProgress();
    loadExpertDetails();
    refreshContinuityState();
    lastSavedDraftSignature = "";
  }

  async function handleSetupStage(): Promise<void> {
    errorMsg = "";
    copiedInstructionNotice = "";
    validationFeedback = null;
    retryPrompt = "";
    busy = true;
    setProgress([
      "ファイルの状態を確認しています",
      "新しい作業を作成しています",
      "Copilot への依頼を開始しています",
      "Copilot への依頼文を準備しています"
    ]);

    try {
      const path = filePath.trim();
      if (!path) {
        failCurrentProgress("ファイルを選ぶと開始できます。");
        errorMsg = "ファイルパスを入力してください";
        return;
      }

      if (!objectiveText.trim()) {
        failCurrentProgress("やりたいことを入れると次へ進めます。");
        errorMsg = "やりたいことを入力してください";
        return;
      }

      const title = taskName.trim() || deriveTitle(objectiveText);
      taskName = title;

      const result = await preflightWorkbook({ workbookPath: path });
      preflight = result;
      if (result.status === "blocked") {
        failCurrentProgress(result.summary);
        errorMsg = result.summary;
        return;
      }
      markProgress(0, "done");

      const session = await createSession({
        title,
        objective: objectiveText,
        primaryWorkbookPath: path
      });
      sessionId = session.id;
      rememberRecentSession({
        sessionId: session.id,
        title: session.title,
        workbookPath: path,
        lastOpenedAt: new Date().toISOString(),
        lastTurnTitle: title
      });
      rememberRecentFile({
        path,
        lastUsedAt: new Date().toISOString(),
        sessionId: session.id,
        source: "session"
      });
      loadExpertDetails();
      markProgress(1, "done");

      const turnResponse = await startTurn({
        sessionId: session.id,
        title,
        objective: objectiveText,
        mode: "plan"
      });
      turnId = turnResponse.turn.id;
      markProgress(2, "done");

      const packet = await generateRelayPacket({
        sessionId: session.id,
        turnId: turnResponse.turn.id
      });
      relayPacket = packet;
      relayPacketText = JSON.stringify(packet, null, 2);
      copilotInstructionText = buildCopilotInstructionText(packet, path, title);
      markProgress(3, "done");
      guidedStage = "copilot";
    } catch (error) {
      const failure = toError(error);
      failCurrentProgress(failure);
      errorMsg = failure;
    } finally {
      busy = false;
    }
  }

  async function handleCopilotStage(): Promise<void> {
    errorMsg = "";
    copiedInstructionNotice = "";
    validationFeedback = null;
    retryPrompt = "";
    busy = true;
    setProgress([
      "回答の書式を自動で整えています",
      "回答の形式を確認しています",
      "保存前の変更内容を準備しています"
    ]);

    try {
      if (!copilotResponse.trim()) {
        failCurrentProgress("Copilot の回答を貼り付けてください。");
        errorMsg = "Copilot の返答を貼り付けてください";
        return;
      }

      const fixResult = autoFixCopilotResponse(copilotResponse);
      autoFixMessages = fixResult.fixes;
      originalCopilotResponse =
        fixResult.fixed !== fixResult.originalPreserved ? fixResult.originalPreserved : "";
      copilotResponse = fixResult.fixed;
      markProgress(0, "done");

      const submitResult = await submitCopilotResponse({
        sessionId,
        turnId,
        rawResponse: fixResult.fixed
      });

      if (!submitResult.accepted) {
        const feedback = classifyValidationIssues(
          submitResult.validationIssues as ValidationIssue[],
          allowedToolIds()
        );
        validationFeedback = feedback;
        retryPrompt = buildRetryPrompt(feedback, allowedToolIds());
        markProgress(1, "error", feedback.summary);
        errorMsg = feedback.specificError;
        return;
      }

      markProgress(1, "done");

      const preview = await previewExecution({ sessionId, turnId });
      const diff = preview.diffSummary;
      previewSummary =
        submitResult.parsedResponse?.summary ??
        diff.sheets[0]?.target.label ??
        `${diff.targetCount} 件の変更を確認できます。`;
      previewTargetCount = diff.targetCount;
      previewAffectedRows = diff.estimatedAffectedRows;
      previewOutputPath = diff.outputPath;
      previewWarnings = [...diff.warnings, ...preview.warnings];
      previewSheetDiffs = diff.sheets;
      previewRequiresApproval = preview.requiresApproval;
      previewChangeDetails = diff.sheets.map((sheet) => {
        const changedColumns =
          sheet.changedColumns.length > 0
            ? `変更列: ${sheet.changedColumns.join("、")}`
            : "変更列の追加情報はありません。";
        return `${sheet.target.label} / ${sheet.estimatedAffectedRows} 行 / ${changedColumns}`;
      });
      showDetailedChanges = false;
      markProgress(2, "done");
      guidedStage = "review-save";
    } catch (error) {
      const failure = toError(error);
      failCurrentProgress(failure);
      errorMsg = failure;
    } finally {
      busy = false;
    }
  }

  async function handleReviewSaveStage(): Promise<void> {
    errorMsg = "";
    busy = true;
    setProgress([
      "変更内容の確認を記録しています",
      "新しいコピーを保存しています"
    ]);

    try {
      if (previewRequiresApproval) {
        await respondToApproval({ sessionId, turnId, decision: "approved" });
      }
      markProgress(0, "done");

      const result = await runExecution({ sessionId, turnId });
      if (result.outputPath) {
        previewOutputPath = result.outputPath;
      }

      executionSummary = result.executed
        ? `保存しました: ${result.outputPath ?? "保存先を確認してください"}`
        : result.reason || "保存できませんでした";

      markProgress(
        1,
        result.executed ? "done" : "error",
        result.executed ? executionSummary : result.reason
      );

      if (!result.executed) {
        errorMsg = executionSummary;
        return;
      }

      executionDone = true;
    } catch (error) {
      const failure = toError(error);
      failCurrentProgress(failure);
      errorMsg = failure;
    } finally {
      busy = false;
    }
  }

  function retryCurrentStage(): void {
    if (guidedStage === "setup") {
      void handleSetupStage();
      return;
    }

    if (guidedStage === "copilot") {
      void handleCopilotStage();
      return;
    }

    void handleReviewSaveStage();
  }

  onMount(async () => {
    loadExpertDetails();

    try {
      await pingDesktop();
      const app = await initializeApp();
      startupIssue = app.startupIssue ?? null;
      storagePath = app.storagePath ?? null;
      sampleWorkbookPath = app.sampleWorkbookPath ?? null;
    } catch (error) {
      errorMsg = toError(error);
    }

    refreshContinuityState();
  });

  $: if (sessionId && !hydratingDraft) {
    const previewSnapshotBase = previewOutputPath
      ? {
          sourcePath: filePath,
          outputPath: previewOutputPath,
          targetCount: previewTargetCount,
          estimatedAffectedRows: previewAffectedRows,
          warnings: previewWarnings,
          requiresApproval: previewRequiresApproval
        }
      : null;

    const draftBase = {
      sessionId,
      selectedTurnId: turnId || null,
      selectedTurnTitle: taskName,
      turnTitle: taskName,
      turnObjective: objectiveText,
      relayMode: "plan" as const,
      workbookPath: filePath,
      workbookFocus: "Sheet1",
      relayPacketText,
      relayPacketSummary: previewSummary,
      rawResponse: copilotResponse,
      validationSummary: validationFeedback?.summary ?? "",
      previewSummary,
      approvalSummary: previewRequiresApproval ? "保存前確認が必要です" : "",
      executionSummary,
      previewSnapshot: previewSnapshotBase,
      cleanShutdown: executionDone
    };

    const nextSignature = JSON.stringify(draftBase);
    if (nextSignature !== lastSavedDraftSignature) {
      saveStudioDraft({
        ...draftBase,
        previewSnapshot: previewSnapshotBase
          ? {
              ...previewSnapshotBase,
              lastGeneratedAt: new Date().toISOString()
            }
          : null,
        lastUpdatedAt: new Date().toISOString(),
        cleanShutdown: executionDone
      });

      if (executionDone) {
        markStudioDraftClean(sessionId);
      }

      lastSavedDraftSignature = nextSignature;
      refreshContinuityState();
    }
  }
</script>

<svelte:head>
  <title>Relay Agent</title>
</svelte:head>

<header class="header">
  <div class="header-left">
    <span class="header-icon">📋</span>
    <span class="header-title">Relay Agent</span>
  </div>
  <button
    class="header-settings"
    type="button"
    on:click={() => (settingsOpen = !settingsOpen)}
    aria-label="設定を開く"
  >⚙</button>
</header>

{#if recentSessions.length > 0 && guidedStage === "setup" && !executionDone}
  <button
    class="recent-toggle"
    type="button"
    on:click={() => (showRecent = !showRecent)}
  >
    {showRecent ? "最近の作業を閉じる" : `最近の作業（${recentSessions.length}件）`}
  </button>

    {#if showRecent}
      <div class="recent-list">
        {#each recentSessions.slice(0, 5) as rs}
          <button class="recent-item" type="button" on:click={() => handleRecentSessionClick(rs)}>
            <div class="recent-copy">
              <span class="recent-title">{rs.title}</span>
              {#if rs.workbookPath}
                <span class="recent-path">{rs.workbookPath}</span>
              {/if}
            </div>
            {#if hasRecoverableDraft(rs.sessionId)}
              <span class="recent-badge">下書きを再開</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
{/if}

<section class="step-banner" aria-label="guided workflow">
  <div class="step-banner-grid">
    {#each stepBanner as step}
      <article class="step-card" data-state={stepState(step.id)}>
        <div class="step-pill">
          <span class="step-number">{step.number}</span>
          <span class="step-title">{step.title}</span>
        </div>
        <p class="step-state">
          {#if stepState(step.id) === "completed"}
            完了
          {:else if stepState(step.id) === "current"}
            今ここ
          {:else}
            待機中
          {/if}
        </p>
      </article>
    {/each}
  </div>
  <p class="step-description">
    {stepBanner.find((step) => step.id === guidedStage)?.description}
  </p>
</section>

{#if guidedStage === "review-save" && previewSummary && !executionDone}
  <section class="change-strip" aria-label="change summary">
    <article class="change-card">
      <span class="change-label">何が変わる</span>
      <strong class="change-value">{previewSummary}</strong>
    </article>
    <article class="change-card">
      <span class="change-label">何行に影響するか</span>
      <strong class="change-value">{previewAffectedRows} 行</strong>
    </article>
    <article class="change-card">
      <span class="change-label">保存先</span>
      <strong class="change-value path">{previewOutputPath || "自動で決まります"}</strong>
      <span class="change-note">元ファイルは変わりません</span>
    </article>
  </section>
{/if}

{#if startupIssue}
  <section class="card card-warn">
    <strong>{startupIssue.problem}</strong>
    <p>{startupIssue.reason}</p>
  </section>
{/if}

{#if guidedStage === "setup"}
  <section class="card">
    <h2 class="panel-title">1. はじめる</h2>

    <label class="field-label" for="file-path">ファイルパス</label>
    <div class="file-row">
      <input
        id="file-path"
        type="text"
        class="input"
        bind:value={filePath}
        placeholder="例: /Users/you/data.csv"
        disabled={busy}
      />
      {#if sampleWorkbookPath}
        <button
          class="chip"
          type="button"
          on:click={() => {
            filePath = sampleWorkbookPath ?? "";
          }}
          disabled={busy}
        >練習用サンプル</button>
      {/if}
    </div>

    {#if preflight && preflight.status === "warning"}
      <p class="field-warn">⚠ {preflight.summary}</p>
    {/if}

    <label class="field-label" for="objective">やりたいこと</label>
    <div class="template-row">
      {#each templates as template}
        <button
          class="chip"
          type="button"
          on:click={() => updateObjective(template.objective)}
          disabled={busy}
        >{template.label}</button>
      {/each}
    </div>
    <textarea
      id="objective"
      class="textarea"
      value={objectiveText}
      on:input={(event) =>
        updateObjective((event.currentTarget as HTMLTextAreaElement).value)}
      placeholder="どんな変更をしたいか、自由に書いてください"
      rows="3"
      disabled={busy}
    ></textarea>

    <label class="field-label" for="task-name">タスク名</label>
    <input
      id="task-name"
      type="text"
      class="input"
      value={taskName}
      on:input={(event) =>
        handleTaskNameInput((event.currentTarget as HTMLInputElement).value)}
      placeholder="やりたいことから自動で入ります"
      disabled={busy}
    />
    <p class="field-hint">やりたいことを選ぶと自動で入ります。必要なら編集できます。</p>

    {#if progressItems.length > 0}
      <div class="progress-panel">
        {#each progressItems as item}
          <div class="progress-item" data-status={item.status}>
            <span class="progress-mark">
              {#if item.status === "done"}
                ✓
              {:else if item.status === "running"}
                …
              {:else if item.status === "error"}
                ✗
              {:else}
                ・
              {/if}
            </span>
            <div>
              <p class="progress-label">{item.label}</p>
              {#if item.message}
                <p class="progress-message">{item.message}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if errorMsg}
      <p class="field-error">{errorMsg}</p>
    {/if}

    <button
      class="btn btn-primary"
      type="button"
      on:click={handleSetupStage}
      disabled={busy || !filePath.trim() || !objectiveText.trim()}
    >
      {busy ? "開始を準備しています…" : "始める"}
    </button>
    <p class="action-note">ファイル確認、作業作成、Copilot への依頼準備を続けて行います。</p>
  </section>
{:else if guidedStage === "copilot"}
  <section class="card">
    <h2 class="panel-title">2. Copilot に聞く</h2>

    <div class="step-summary">
      <span class="step-summary-label">タスク名:</span> {taskName}
      <br />
      <span class="step-summary-label">ファイル:</span> {filePath}
      <br />
      <span class="step-summary-label">やりたいこと:</span> {objectiveText}
    </div>

    <p class="instruction-text">
      下のボタンで Copilot に渡す依頼をコピーしてください。返ってきた JSON をそのまま下の欄に貼り付けるだけで、保存前の確認まで進めます。
    </p>

    <div class="copy-row">
      <button class="btn btn-accent" type="button" on:click={copyCopilotInstruction} disabled={busy}>
        Copilot 用にコピー
      </button>
      <button
        class="btn-link"
        type="button"
        on:click={() => (showInstructionPreview = !showInstructionPreview)}
      >
        {showInstructionPreview ? "依頼文を閉じる" : "依頼文を見る"}
      </button>
    </div>

    {#if copiedInstructionNotice}
      <p class="field-success">{copiedInstructionNotice}</p>
    {/if}

    {#if showInstructionPreview}
      <pre class="preview-block">{copilotInstructionText}</pre>
    {/if}

    <label class="field-label" for="copilot-response">Copilot の返答</label>
    <textarea
      id="copilot-response"
      class="textarea textarea-tall"
      bind:value={copilotResponse}
      placeholder="Copilot から返ってきた JSON をここに貼り付け"
      rows="8"
      disabled={busy}
    ></textarea>

    <div class="response-shape">
      <strong>期待する形式:</strong> {expectedResponseShape}
      <br />
      JSON のみ。``` 不要。パスは / 区切り。
    </div>

    {#if autoFixMessages.length > 0}
      <div class="autofix-notice">
        {#each autoFixMessages as message}
          <span class="autofix-chip">✓ {message}</span>
        {/each}
        {#if originalCopilotResponse}
          <button class="btn-link inline-link" type="button" on:click={undoAutoFix}>
            Undo auto-fix
          </button>
        {/if}
      </div>
    {/if}

    {#if validationFeedback}
      <div class="validation-card" data-level={validationFeedback.level}>
        <p class="validation-kicker">レベル {validationFeedback.level}</p>
        <h3>{validationFeedback.title}</h3>
        <p>{validationFeedback.summary}</p>
        <p class="validation-specific">{validationFeedback.specificError}</p>
        {#each validationFeedback.details as detail}
          <p class="validation-detail">{detail}</p>
        {/each}
        <button class="btn btn-secondary" type="button" on:click={copyRetryPrompt}>
          修正を依頼するテキストをコピー
        </button>
      </div>
    {/if}

    {#if progressItems.length > 0}
      <div class="progress-panel">
        {#each progressItems as item}
          <div class="progress-item" data-status={item.status}>
            <span class="progress-mark">
              {#if item.status === "done"}
                ✓
              {:else if item.status === "running"}
                …
              {:else if item.status === "error"}
                ✗
              {:else}
                ・
              {/if}
            </span>
            <div>
              <p class="progress-label">{item.label}</p>
              {#if item.message}
                <p class="progress-message">{item.message}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if errorMsg}
      <p class="field-error">{errorMsg}</p>
    {/if}

    <div class="btn-row">
      <button class="btn btn-secondary" type="button" on:click={goToSetup} disabled={busy}>
        戻る
      </button>
      <button
        class="btn btn-primary"
        type="button"
        on:click={handleCopilotStage}
        disabled={busy || !copilotResponse.trim()}
      >
        {busy ? "変更を確認しています…" : "変更を確認する"}
      </button>
    </div>
    <p class="action-note">回答を自動補正し、形式を確認して、保存前の変更確認まで進めます。</p>
    {#if !busy && progressItems.some((item) => item.status === "error")}
      <button class="btn btn-secondary retry-button" type="button" on:click={retryCurrentStage}>
        やり直す
      </button>
    {/if}
  </section>
{:else if guidedStage === "review-save" && !executionDone}
  <section class="card">
    <h2 class="panel-title">3. 確認して保存</h2>

    <div class="step-summary">
      <span class="step-summary-label">タスク名:</span> {taskName}
      <br />
      <span class="step-summary-label">ファイル:</span> {filePath}
    </div>

    <button
      class="btn-link"
      type="button"
      on:click={() => (showDetailedChanges = !showDetailedChanges)}
    >
      {showDetailedChanges ? "詳細を閉じる" : "詳細を見る"}
    </button>

    {#if showDetailedChanges}
      <div class="summary-grid">
        <div class="summary-item">
          <span class="summary-label">変更対象</span>
          <span class="summary-value">{previewTargetCount} 件</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">影響行数</span>
          <span class="summary-value">{previewAffectedRows} 行</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">保存先</span>
          <span class="summary-value summary-path">{previewOutputPath || "自動決定"}</span>
        </div>
      </div>

      {#if previewChangeDetails.length > 0}
        <div class="detail-list">
          {#each previewChangeDetails as detail}
            <p class="detail-item">{detail}</p>
          {/each}
        </div>
      {/if}

      {#if previewSheetDiffs.length > 0}
        <div class="sheet-diff-grid">
          {#each previewSheetDiffs as sheetDiff}
            <article class="sheet-diff-card">
              <div class="sheet-diff-header">
                <div>
                  <p class="sheet-diff-title">{sheetDiff.target.label}</p>
                  <p class="sheet-diff-meta">{sheetDiff.estimatedAffectedRows} 行に影響</p>
                </div>
              </div>

              <div class="sheet-diff-groups">
                <div class="sheet-diff-group">
                  <span class="sheet-diff-label">追加された列</span>
                  <div class="sheet-diff-badges">
                    {#if sheetDiff.addedColumns.length > 0}
                      {#each sheetDiff.addedColumns as column}
                        <span class="sheet-diff-badge" data-kind="added">{column}</span>
                      {/each}
                    {:else}
                      <span class="sheet-diff-empty">なし</span>
                    {/if}
                  </div>
                </div>

                <div class="sheet-diff-group">
                  <span class="sheet-diff-label">変わる列</span>
                  <div class="sheet-diff-badges">
                    {#if sheetDiff.changedColumns.length > 0}
                      {#each sheetDiff.changedColumns as column}
                        <span class="sheet-diff-badge" data-kind="changed">{column}</span>
                      {/each}
                    {:else}
                      <span class="sheet-diff-empty">なし</span>
                    {/if}
                  </div>
                </div>

                <div class="sheet-diff-group">
                  <span class="sheet-diff-label">消える列</span>
                  <div class="sheet-diff-badges">
                    {#if sheetDiff.removedColumns.length > 0}
                      {#each sheetDiff.removedColumns as column}
                        <span class="sheet-diff-badge" data-kind="removed">{column}</span>
                      {/each}
                    {:else}
                      <span class="sheet-diff-empty">なし</span>
                    {/if}
                  </div>
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    {/if}

    {#if previewWarnings.length > 0}
      <div class="warnings">
        {#each previewWarnings as warning}
          <p class="field-warn">⚠ {warning}</p>
        {/each}
      </div>
    {/if}

    <p class="safety-note">
      元のファイルはそのまま残ります。変更は別のコピーに保存されます。
    </p>

    {#if progressItems.length > 0}
      <div class="progress-panel">
        {#each progressItems as item}
          <div class="progress-item" data-status={item.status}>
            <span class="progress-mark">
              {#if item.status === "done"}
                ✓
              {:else if item.status === "running"}
                …
              {:else if item.status === "error"}
                ✗
              {:else}
                ・
              {/if}
            </span>
            <div>
              <p class="progress-label">{item.label}</p>
              {#if item.message}
                <p class="progress-message">{item.message}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if errorMsg}
      <p class="field-error">{errorMsg}</p>
    {/if}

    <div class="btn-row">
      <button class="btn btn-secondary" type="button" on:click={goToCopilot} disabled={busy}>
        内容を見直す
      </button>
      <button class="btn btn-primary btn-save" type="button" on:click={handleReviewSaveStage} disabled={busy}>
        {busy ? "コピーを保存しています…" : "コピーを保存する"}
      </button>
    </div>
    <p class="action-note">内容の確認を記録してから、新しいコピーを保存します。</p>
    {#if !busy && progressItems.some((item) => item.status === "error")}
      <button class="btn btn-secondary retry-button" type="button" on:click={retryCurrentStage}>
        やり直す
      </button>
    {/if}
  </section>
{:else if executionDone}
  <section class="card card-success">
    <h2 class="panel-title">保存が完了しました</h2>
    <p class="execution-summary">{executionSummary}</p>
    {#if previewOutputPath}
      <p class="output-path">保存先: <code>{previewOutputPath}</code></p>
    {/if}
    <div class="btn-row">
      <button class="btn btn-primary" type="button" on:click={resetAll}>
        新しい作業を始める
      </button>
      <button class="btn btn-secondary" type="button" on:click={goToSetup}>
        ホームに戻る
      </button>
    </div>
  </section>
{/if}

<section class="card expert-card">
  <button class="expert-toggle" type="button" on:click={toggleExpertDetails}>
    {expertDetailsOpen ? "詳細表示を閉じる" : "詳細表示"}
  </button>

  {#if expertDetailsOpen}
    <div class="expert-grid">
      <div>
        <h3 class="expert-title">現在の作業情報</h3>
        <p class="expert-copy">sessionId: {sessionId || "未作成"}</p>
        <p class="expert-copy">turnId: {turnId || "未開始"}</p>
        <p class="expert-copy">保存先候補: {previewOutputPath || "未作成"}</p>
      </div>
      <div>
        <h3 class="expert-title">期待するテンプレート</h3>
        <pre class="preview-block expert-block">{expectedResponseTemplate}</pre>
      </div>
    </div>

    {#if relayPacketText}
      <h3 class="expert-title">Raw relay packet</h3>
      <pre class="preview-block expert-block">{relayPacketText}</pre>
    {/if}

    {#if retryPrompt}
      <h3 class="expert-title">再依頼テキスト</h3>
      <pre class="preview-block expert-block">{retryPrompt}</pre>
    {/if}
  {/if}
</section>

{#if settingsOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" on:click|self={() => (settingsOpen = false)}>
    <div class="modal">
      <div class="modal-header">
        <h2>設定</h2>
        <button class="modal-close" type="button" on:click={() => (settingsOpen = false)}>✕</button>
      </div>

      <div class="modal-body">
        <h3>実行ポリシー</h3>
        <ul class="settings-list">
          <li>書き込み操作はプレビューと確認を経てから実行されます</li>
          <li>保存先は常に別コピーです（元ファイルを直接変更しません）</li>
          <li>元のファイルは読み取り専用として扱われます</li>
        </ul>

        <h3>データの保存場所</h3>
        <ul class="settings-list">
          <li>作業・ログ・設定はこのデバイスにのみ保存されます</li>
          <li>アプリの外に自動送信されるデータはありません</li>
          <li>Copilot に渡すテキストのみ、手動でコピーした場合に外部へ出ます</li>
        </ul>

        {#if storagePath}
          <h3>ローカルストレージ</h3>
          <code class="storage-path">{storagePath}</code>
          <p class="settings-hint">
            保存データを削除するには、アプリを閉じてからこのフォルダを削除してください。
          </p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding-top: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .header-icon {
    font-size: 1.3rem;
  }

  .header-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--ra-text);
  }

  .header-settings {
    background: none;
    border: none;
    font-size: 1.3rem;
    color: var(--ra-text-muted);
    padding: 0.25rem 0.5rem;
    border-radius: var(--ra-radius-sm);
    transition: color 0.15s;
  }

  .header-settings:hover {
    color: var(--ra-text);
    background: var(--ra-surface);
  }

  .recent-toggle {
    display: block;
    background: none;
    border: none;
    color: var(--ra-text-secondary);
    font-size: 0.85rem;
    padding: 0.25rem 0;
    margin-bottom: 0.5rem;
  }

  .recent-toggle:hover {
    color: var(--ra-accent);
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: var(--ra-surface);
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
  }

  .recent-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface);
    text-align: left;
  }

  .recent-item:hover {
    border-color: var(--ra-accent-border);
    background: var(--ra-accent-light);
  }

  .recent-copy {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .recent-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--ra-text);
  }

  .recent-path {
    font-size: 0.78rem;
    color: var(--ra-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-badge {
    flex-shrink: 0;
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--ra-accent-border);
    border-radius: 999px;
    background: var(--ra-accent-light);
    color: var(--ra-accent);
    font-size: 0.76rem;
    font-weight: 700;
  }

  .step-banner {
    position: sticky;
    top: 0;
    z-index: 20;
    margin: 1rem 0 1.25rem;
    padding: 1rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius);
    background: color-mix(in srgb, var(--ra-surface) 92%, white 8%);
    box-shadow: var(--ra-shadow);
    backdrop-filter: blur(8px);
  }

  .step-banner-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .step-card {
    padding: 0.85rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface-muted);
  }

  .step-card[data-state="completed"] {
    border-color: var(--ra-success-border);
    background: var(--ra-success-light);
  }

  .step-card[data-state="current"] {
    border-color: var(--ra-accent-border);
    background: var(--ra-accent-light);
  }

  .step-pill {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 700;
    color: var(--ra-text);
  }

  .step-number {
    display: inline-flex;
    width: 1.7rem;
    height: 1.7rem;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: white;
    border: 1px solid currentColor;
    font-size: 0.82rem;
  }

  .step-title {
    font-size: 0.95rem;
  }

  .step-state {
    margin: 0.45rem 0 0;
    font-size: 0.82rem;
    color: var(--ra-text-secondary);
  }

  .step-description {
    margin: 0.85rem 0 0;
    font-size: 0.9rem;
    color: var(--ra-text-secondary);
  }

  .change-strip {
    position: sticky;
    top: 9rem;
    z-index: 15;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .change-card {
    padding: 0.9rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface);
    box-shadow: var(--ra-shadow);
  }

  .change-label {
    display: block;
    margin-bottom: 0.4rem;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--ra-text-muted);
  }

  .change-value {
    display: block;
    color: var(--ra-text);
    line-height: 1.5;
  }

  .path {
    word-break: break-all;
  }

  .change-note {
    display: block;
    margin-top: 0.45rem;
    font-size: 0.78rem;
    color: var(--ra-success);
  }

  .card {
    background: var(--ra-surface);
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius);
    padding: 1.5rem;
    margin-bottom: 1.25rem;
    box-shadow: var(--ra-shadow);
  }

  .card-warn {
    border-color: #f59e0b;
    background: var(--ra-warn-light);
  }

  .card-success {
    border-color: var(--ra-success-border);
    background: var(--ra-success-light);
  }

  .panel-title {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0 0 1rem;
    color: var(--ra-text);
  }

  .field-label {
    display: block;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ra-text-secondary);
    margin-bottom: 0.35rem;
    margin-top: 1rem;
  }

  .field-label:first-of-type {
    margin-top: 0;
  }

  .input,
  .textarea {
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface);
    color: var(--ra-text);
    outline: none;
    transition: border-color 0.15s;
  }

  .input:focus,
  .textarea:focus {
    border-color: var(--ra-accent);
  }

  .textarea {
    resize: vertical;
    line-height: 1.5;
  }

  .textarea-tall {
    min-height: 10rem;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .file-row .input {
    flex: 1;
  }

  .chip {
    display: inline-block;
    padding: 0.3rem 0.7rem;
    font-size: 0.82rem;
    border: 1px solid var(--ra-border);
    border-radius: 2rem;
    background: var(--ra-surface-muted);
    color: var(--ra-text-secondary);
    transition: all 0.15s;
    white-space: nowrap;
  }

  .chip:hover:not(:disabled) {
    border-color: var(--ra-accent-border);
    color: var(--ra-accent);
    background: var(--ra-accent-light);
  }

  .chip:disabled {
    opacity: 0.5;
  }

  .template-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.6rem 1.2rem;
    border: none;
    border-radius: var(--ra-radius-sm);
    font-weight: 600;
    font-size: 0.95rem;
    transition: all 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--ra-accent);
    color: white;
    margin-top: 1rem;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--ra-accent-hover);
  }

  .btn-secondary {
    background: var(--ra-surface-muted);
    color: var(--ra-text-secondary);
    border: 1px solid var(--ra-border);
    margin-top: 1rem;
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--ra-surface);
    border-color: var(--ra-border-strong);
  }

  .btn-accent {
    background: var(--ra-accent);
    color: white;
  }

  .btn-accent:hover:not(:disabled) {
    background: var(--ra-accent-hover);
  }

  .btn-link {
    background: none;
    border: none;
    color: var(--ra-text-muted);
    font-size: 0.85rem;
    padding: 0.25rem 0;
  }

  .btn-link:hover {
    color: var(--ra-accent);
  }

  .inline-link {
    padding: 0;
  }

  .btn-row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .btn-save {
    min-width: 10rem;
  }

  .field-error {
    color: var(--ra-error);
    font-size: 0.88rem;
    margin: 0.5rem 0 0;
  }

  .field-warn {
    color: #b45309;
    font-size: 0.88rem;
    margin: 0.5rem 0 0;
  }

  .field-success {
    color: var(--ra-success);
    font-size: 0.88rem;
    margin: 0.5rem 0 0;
  }

  .field-hint,
  .action-note {
    color: var(--ra-text-muted);
    font-size: 0.82rem;
    line-height: 1.5;
    margin: 0.4rem 0 0;
  }

  .step-summary {
    padding: 0.6rem 0.75rem;
    background: var(--ra-surface-muted);
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    font-size: 0.85rem;
    color: var(--ra-text-secondary);
    margin-bottom: 1rem;
    line-height: 1.6;
  }

  .step-summary-label {
    font-weight: 600;
    color: var(--ra-text);
  }

  .instruction-text {
    font-size: 0.9rem;
    color: var(--ra-text-secondary);
    margin: 0 0 0.75rem;
    line-height: 1.6;
  }

  .copy-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }

  .preview-block {
    background: var(--ra-surface-muted);
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    padding: 0.75rem;
    font-size: 0.8rem;
    overflow-x: auto;
    max-height: 16rem;
    margin-bottom: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .response-shape {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface-muted);
    font-size: 0.84rem;
    color: var(--ra-text-secondary);
    line-height: 1.6;
  }

  .autofix-notice {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.6rem;
  }

  .autofix-chip {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    background: var(--ra-success-light);
    border: 1px solid var(--ra-success-border);
    border-radius: 2rem;
    color: var(--ra-success);
  }

  .validation-card {
    margin-top: 0.85rem;
    padding: 1rem;
    border-radius: var(--ra-radius-sm);
    border: 1px solid var(--ra-border);
    background: var(--ra-surface-muted);
  }

  .validation-card[data-level="1"] {
    border-color: var(--ra-error-border);
    background: var(--ra-error-light);
  }

  .validation-card[data-level="2"] {
    border-color: #e6b870;
    background: #fff8ea;
  }

  .validation-card[data-level="3"] {
    border-color: var(--ra-accent-border);
    background: var(--ra-accent-light);
  }

  .validation-card h3 {
    margin: 0.2rem 0 0.35rem;
    font-size: 1rem;
  }

  .validation-kicker {
    margin: 0;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ra-text-muted);
  }

  .validation-specific {
    font-weight: 600;
    color: var(--ra-text);
  }

  .validation-detail {
    margin: 0.35rem 0 0;
    font-size: 0.84rem;
    color: var(--ra-text-secondary);
  }

  .progress-panel {
    display: grid;
    gap: 0.65rem;
    margin-top: 1rem;
    padding: 0.9rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface-muted);
  }

  .progress-item {
    display: grid;
    grid-template-columns: 1.25rem 1fr;
    gap: 0.65rem;
    align-items: start;
  }

  .progress-item[data-status="error"] .progress-mark {
    color: var(--ra-error);
  }

  .progress-item[data-status="done"] .progress-mark {
    color: var(--ra-success);
  }

  .progress-item[data-status="running"] .progress-mark {
    color: var(--ra-accent);
  }

  .progress-mark {
    font-weight: 700;
    line-height: 1.4;
  }

  .progress-label {
    margin: 0;
    font-size: 0.88rem;
    color: var(--ra-text);
  }

  .progress-message {
    margin: 0.18rem 0 0;
    font-size: 0.8rem;
    color: var(--ra-text-muted);
    line-height: 1.5;
  }

  .retry-button {
    margin-top: 0.75rem;
  }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    margin: 1rem 0;
  }

  .summary-item {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.6rem;
    background: var(--ra-surface-muted);
    border-radius: var(--ra-radius-sm);
    text-align: center;
  }

  .summary-label {
    font-size: 0.78rem;
    color: var(--ra-text-muted);
    font-weight: 600;
  }

  .summary-value {
    font-size: 1rem;
    font-weight: 700;
    color: var(--ra-text);
  }

  .summary-path {
    font-size: 0.78rem;
    font-weight: 500;
    word-break: break-all;
  }

  .detail-list {
    display: grid;
    gap: 0.45rem;
    margin-bottom: 1rem;
  }

  .detail-item {
    margin: 0;
    padding: 0.75rem;
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface-muted);
    color: var(--ra-text-secondary);
    font-size: 0.84rem;
    line-height: 1.6;
  }

  .sheet-diff-grid {
    display: grid;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .sheet-diff-card {
    padding: 0.9rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface-muted);
  }

  .sheet-diff-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.85rem;
  }

  .sheet-diff-title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--ra-text);
  }

  .sheet-diff-meta {
    margin: 0.2rem 0 0;
    font-size: 0.8rem;
    color: var(--ra-text-muted);
  }

  .sheet-diff-groups {
    display: grid;
    gap: 0.7rem;
  }

  .sheet-diff-group {
    display: grid;
    gap: 0.35rem;
  }

  .sheet-diff-label {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--ra-text-secondary);
  }

  .sheet-diff-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .sheet-diff-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.22rem 0.6rem;
    border: 1px solid var(--ra-border);
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .sheet-diff-badge[data-kind="added"] {
    border-color: var(--ra-success-border);
    background: var(--ra-success-light);
    color: var(--ra-success);
  }

  .sheet-diff-badge[data-kind="changed"] {
    border-color: var(--ra-accent-border);
    background: var(--ra-accent-light);
    color: var(--ra-accent);
  }

  .sheet-diff-badge[data-kind="removed"] {
    border-color: var(--ra-error-border);
    background: var(--ra-error-light);
    color: var(--ra-error);
  }

  .sheet-diff-empty {
    font-size: 0.8rem;
    color: var(--ra-text-muted);
  }

  .warnings {
    margin-bottom: 0.75rem;
  }

  .safety-note {
    font-size: 0.82rem;
    color: var(--ra-text-muted);
    background: var(--ra-success-light);
    border: 1px solid var(--ra-success-border);
    border-radius: var(--ra-radius-sm);
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.5rem;
  }

  .execution-summary {
    font-size: 0.95rem;
    color: var(--ra-text);
    margin: 0.5rem 0 1rem;
  }

  .output-path {
    font-size: 0.88rem;
    color: var(--ra-text-secondary);
    margin-bottom: 1rem;
  }

  .output-path code {
    background: rgba(0, 0, 0, 0.06);
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
    font-size: 0.85rem;
  }

  .expert-card {
    margin-top: 1rem;
  }

  .expert-toggle {
    background: none;
    border: none;
    color: var(--ra-text-secondary);
    font-size: 0.9rem;
    font-weight: 600;
    padding: 0;
  }

  .expert-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }

  .expert-title {
    margin: 0 0 0.5rem;
    font-size: 0.92rem;
  }

  .expert-copy {
    margin: 0.25rem 0;
    color: var(--ra-text-secondary);
    font-size: 0.84rem;
    word-break: break-all;
  }

  .expert-block {
    margin-top: 0.5rem;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: var(--ra-surface);
    border-radius: var(--ra-radius);
    width: min(520px, 90vw);
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: var(--ra-shadow-lg);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--ra-border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 1.2rem;
    color: var(--ra-text-muted);
    padding: 0.25rem 0.5rem;
    border-radius: var(--ra-radius-sm);
  }

  .modal-close:hover {
    color: var(--ra-text);
    background: var(--ra-surface-muted);
  }

  .modal-body {
    padding: 1.25rem;
  }

  .modal-body h3 {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--ra-text);
    margin: 1.25rem 0 0.5rem;
  }

  .modal-body h3:first-child {
    margin-top: 0;
  }

  .settings-list {
    margin: 0;
    padding-left: 1.2rem;
    font-size: 0.88rem;
    color: var(--ra-text-secondary);
    line-height: 1.7;
  }

  .storage-path {
    display: block;
    padding: 0.6rem 0.75rem;
    background: var(--ra-surface-muted);
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    font-size: 0.85rem;
    word-break: break-all;
  }

  .settings-hint {
    font-size: 0.82rem;
    color: var(--ra-text-muted);
    margin-top: 0.5rem;
  }

  @media (max-width: 720px) {
    .step-banner-grid,
    .change-strip,
    .summary-grid,
    .expert-grid {
      grid-template-columns: 1fr;
    }

    .change-strip {
      top: 8.5rem;
    }
  }
</style>
