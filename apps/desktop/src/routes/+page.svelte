<script lang="ts">
  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-shell";
  import ActivityFeed from "$lib/components/ActivityFeed.svelte";
  import AgentActivityFeed from "$lib/components/AgentActivityFeed.svelte";
  import ApprovalGate from "$lib/components/ApprovalGate.svelte";
  import ChatComposer from "$lib/components/ChatComposer.svelte";
  import CompletionTimeline from "$lib/components/CompletionTimeline.svelte";
  import FileOpPreview from "$lib/components/FileOpPreview.svelte";
  import GoalInput from "$lib/components/GoalInput.svelte";
  import InterventionPanel from "$lib/components/InterventionPanel.svelte";
  import ProjectSelector from "$lib/components/ProjectSelector.svelte";
  import RecentSessions from "$lib/components/RecentSessions.svelte";
  import SettingsModal from "$lib/components/SettingsModal.svelte";
  import SheetDiffCard from "$lib/components/SheetDiffCard.svelte";
  import {
    activityFeedStore,
    delegationStore,
    type ActivityFeedEvent
  } from "$lib/stores/delegation";
  import type {
    CopilotTurnResponse,
    DiffSummary,
    ExecutionPlan,
    GenerateRelayPacketResponse,
    PlanProgressResponse,
    PlanStep,
    PlanStepStatus,
    PreflightWorkbookResponse,
    Project,
    ReadTurnArtifactsResponse,
    Session,
    SheetColumnProfile,
    StartupIssue,
    ToolExecutionResult,
    TurnDetailsViewModel,
    ValidationIssue,
    WorkbookProfile
  } from "@relay-agent/contracts";
  import {
    addProjectMemory,
    approvePlan,
    assessCopilotHandoff,
    buildPlanningPrompt,
    createProject,
    createSession,
    discardDelegationDraft,
    discardStudioDraft,
    generateRelayPacket,
    getPlanProgress,
    getCopilotBrowserErrorMessage,
    getFriendlyError,
    inspectWorkbook,
    initializeApp,
    isWithinProjectScope,
    linkSessionToProject,
    listSessions,
    recordPlanProgress,
    recordScopeApproval,
    listRecentFiles,
    listProjects,
    listRecoverableStudioDrafts,
    listRecentSessions,
    loadDelegationDraft,
    loadSelectedProjectId,
    loadStudioDraft,
    loadBrowserAutomationSettings,
    loadUiMode,
    hasSeenWelcome,
    markWelcomeSeen,
    markStudioDraftClean,
    pingDesktop,
    preflightWorkbook,
    previewExecution,
    readTurnArtifacts,
    readSession,
    removeProjectMemory,
    rememberRecentFile,
    rememberRecentSession,
    resumeAgentLoopWithPlan,
    runAgentLoop,
    respondToApproval,
    runExecution,
    saveBrowserAutomationSettings,
    saveDelegationDraft,
    saveSelectedProjectId,
    saveUiMode,
    sendToCopilot,
    saveStudioDraft,
    setSessionProject,
    startTurn,
    submitCopilotResponse,
    validateProjectScopeActions,
    type AgentLoopResult,
    type BrowserCommandProgress,
    type CopilotConversationTurn,
    type PersistedStudioDraft,
    type RecentFile,
    type RecentSession,
    type UiMode
  } from "$lib";
  import { autoFixCopilotResponse } from "$lib/auto-fix";
  import { buildProjectContext } from "$lib/prompt-templates";

  type GuidedStage = "setup" | "copilot" | "review-save";
  type ProgressStatus = "waiting" | "running" | "done" | "error";
  type ProgressItem = {
    id: string;
    label: string;
    status: ProgressStatus;
    message?: string;
  };
  type AgentLoopLogEntry = {
    id: string;
    tool: string;
    label: string;
    status: ProgressStatus;
    startTime: number;
    endTime?: number;
    detail?: string;
    errorMessage?: string;
    rawResult?: unknown;
    showDetail?: boolean;
  };
  type PlanExecutionStepState = PlanStepStatus["state"];
  type PlanExecutionStep = PlanStep & {
    state: PlanExecutionStepState;
    result?: unknown;
    error?: string;
  };
  type ProjectSessionSummary = {
    id: string;
    title: string;
    updatedAt: string;
    workbookPath?: string | null;
    assignedProjectName?: string | null;
  };
  type ValidationFeedback = {
    level: 1 | 2 | 3;
    title: string;
    summary: string;
    specificError: string;
    details: string[];
  };
  type FileWritePreviewAction = {
    tool: string;
    args: Record<string, unknown>;
  };
  type ScopeApprovalSource = "manual" | "agent-loop";
  type ScopeApprovalArtifactRecord = Extract<
    ReadTurnArtifactsResponse["artifacts"][number],
    { artifactType: "scope-approval" }
  >;
  type ProjectApprovalAuditRow = {
    sessionId: string;
    sessionTitle: string;
    workbookPath: string | null;
    turnId: string | null;
    turnTitle: string;
    turnUpdatedAt: string | null;
    turnStatus: string;
    approvalSummary: string;
    writeApprovalDecision: "approved" | "rejected" | "pending" | "not-required" | "none";
    readyForExecution: boolean;
    scopeOverrideCount: number;
    latestScopeDecision: "approved" | "rejected" | null;
    latestScopeSource: ScopeApprovalSource | null;
    latestScopeAt: string | null;
    outputPath: string | null;
  };
  type TemplateKey =
    | "inspect_safe_copy"
    | "filter_rows"
    | "rename_columns"
    | "cast_columns"
    | "derive_column"
    | "group_aggregate";
  type TemplateOption = {
    key: TemplateKey;
    label: string;
    objective: string;
  };

  const expertDetailsStoragePrefix = "relay-agent.expert-details";
  const AUTO_CDP_PORT_RANGE_START = 9333;
  const AUTO_CDP_PORT_RANGE_END = 9342;
  const expectedResponseShape =
    '{ "version": "1.0", "status": "thinking|ready_to_write|done|error", "summary": "...", "actions": [...] }';
  const instructionColumnLimit = 20;
  const objectivePresets = [
    "approved が true の行だけ残してください",
    "amount 列の合計を新しい列として追加してください",
    "重複行を削除してシートを整理してください"
  ] as const;

  // Exact args structure for each tool. This is embedded verbatim in the Copilot
  // instruction so the LLM uses the correct field names and nesting.
  const TOOL_ARGS_REFERENCE = `workbook.inspect   : { "tool": "workbook.inspect", "args": { "sourcePath": "/path/to/file.csv" } }
sheet.preview      : { "tool": "sheet.preview", "args": { "sheet": "Sheet1", "limit": 25 } }
sheet.profile_columns: { "tool": "sheet.profile_columns", "args": { "sheet": "Sheet1", "sampleSize": 250 } }
session.diff_from_base: { "tool": "session.diff_from_base", "args": {} }
table.filter_rows  : { "tool": "table.filter_rows", "sheet": "Sheet1", "args": { "predicate": "[approved] == true" } }
table.rename_columns: { "tool": "table.rename_columns", "sheet": "Sheet1", "args": { "renames": [{ "from": "old_name", "to": "new_name" }] } }
table.cast_columns : { "tool": "table.cast_columns", "sheet": "Sheet1", "args": { "casts": [{ "column": "amount", "toType": "number" }] } }
table.derive_column: { "tool": "table.derive_column", "sheet": "Sheet1", "args": { "column": "new_col", "expression": "[amount] * 2", "position": "end" } }
table.group_aggregate: { "tool": "table.group_aggregate", "sheet": "Sheet1", "args": { "groupBy": ["region"], "measures": [{ "column": "amount", "op": "sum", "as": "total_amount" }] } }
workbook.save_copy : { "tool": "workbook.save_copy", "args": { "outputPath": "/path/to/output.csv" } }
重要: sheet.preview / sheet.profile_columns / workbook.* / session.* は sheet を args の中に書く。table.* だけ sheet をトップレベルに書く。`;
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
  let showWelcome = false;
  let uiMode: UiMode = "delegation";
  let isDragOver = false;
  let cdpTestStatus: "idle" | "testing" | "ok" | "fail" = "idle";
  let cdpTestMessage = "";
  let hiddenFilePicker: HTMLInputElement | null = null;

  let startupIssue: StartupIssue | null = null;
  let storagePath: string | null = null;
  let sampleWorkbookPath: string | null = null;

  let filePath = "";
  let objectiveText = "";
  let taskName = "";
  let taskNameEdited = false;
  let selectedTemplateKey: TemplateKey | null = null;
  let preflight: PreflightWorkbookResponse | null = null;
  let workbookProfile: WorkbookProfile | null = null;
  let workbookColumnProfiles: SheetColumnProfile[] = [];

  let sessionId = "";
  let turnId = "";
  let relayPacket: GenerateRelayPacketResponse | null = null;
  let relayPacketText = "";
  let copilotInstructionText = "";
  let expectedResponseTemplate = "";
  let copiedInstructionNotice = "";
  let copiedBrowserCommandNotice = "";
  let copilotResponse = "";
  let originalCopilotResponse = "";
  let autoFixMessages: string[] = [];
  let validationFeedback: ValidationFeedback | null = null;
  let retryPrompt = "";
  let showInstructionPreview = false;
  let isSendingToCopilot = false;
  let sendStatusMessage = "";
  let copilotAutoError: string | null = null;
  let copilotResponseField: HTMLTextAreaElement | null = null;
  let cdpPort = AUTO_CDP_PORT_RANGE_START;
  let autoLaunchEdge = true;
  let timeoutMs = 60000;
  let agentLoopEnabled = false;
  let maxTurns = 10;
  let loopTimeoutMs = 120000;
  let planningEnabled = true;
  let autoApproveReadSteps = true;
  let pauseBetweenSteps = false;
  let agentLoopRunning = false;
  let agentLoopTurn = 0;
  let agentLoopLog: AgentLoopLogEntry[] = [];
  let agentLoopSummary = "";
  let agentLoopFinalStatus:
    | CopilotTurnResponse["status"]
    | "awaiting_plan_approval"
    | null = null;
  let agentLoopResult: AgentLoopResult | null = null;
  let agentLoopConversationHistory: CopilotConversationTurn[] = [];
  let agentLoopAbortController: AbortController | null = null;
  let activeAgentLoopEntryId: string | null = null;
  let planSteps: PlanStep[] = [];
  let showReplanFeedback = false;
  let replanFeedback = "";
  let approvedPlan: ExecutionPlan | null = null;
  let pendingPlan: ExecutionPlan | null = null;
  let executionStepStatuses: PlanExecutionStep[] = [];
  let currentPlanStepId: string | null = null;
  let isPlanExecuting = false;
  let isPlanPaused = false;
  let planPauseRequested = false;
  let planPauseReason = "";
  let planPauseResolver: (() => void) | null = null;

  let previewSummary = "";
  let previewTargetCount = 0;
  let previewAffectedRows = 0;
  let previewOutputPath = "";
  let previewWarnings: string[] = [];
  let previewRequiresApproval = false;
  let previewChangeDetails: string[] = [];
  let previewSheetDiffs: DiffSummary["sheets"] = [];
  let previewFileWriteActions: FileWritePreviewAction[] = [];
  let scopeApprovalVisible = false;
  let scopeApprovalSource: ScopeApprovalSource | null = null;
  let scopeApprovalSummary = "";
  let scopeApprovalRootFolder = "";
  let scopeApprovalViolations: string[] = [];
  let showDetailedChanges = false;
  let executionDone = false;
  let executionSummary = "";
  let projects: Project[] = [];
  let allSessions: Session[] = [];
  let linkedProjectSessions: ProjectSessionSummary[] = [];
  let availableProjectSessions: ProjectSessionSummary[] = [];
  let filteredLinkedProjectSessions: ProjectSessionSummary[] = [];
  let filteredAvailableProjectSessions: ProjectSessionSummary[] = [];
  let selectedProjectId: string | null = null;
  let selectedProject: Project | null = null;
  let projectContextText = "";
  let projectErrorMsg = "";
  let projectInfoMsg = "";
  let projectApprovalAuditRows: ProjectApprovalAuditRow[] = [];
  let filteredProjectApprovalAuditRows: ProjectApprovalAuditRow[] = [];
  let projectApprovalAuditLoading = false;
  let projectApprovalAuditError = "";
  let projectApprovalAuditRefreshNonce = 0;
  let projectApprovalAuditRequestKey = "";
  let creatingProject = false;
  let newProjectName = "";
  let newProjectRootFolder = "";
  let newProjectInstructions = "";
  let projectSessionQuery = "";
  let memoryDraftKey = "";
  let memoryDraftValue = "";
  let sessionToAssignId = "";

  let recentSessions: RecentSession[] = [];
  let recentFiles: RecentFile[] = [];
  let recoverableDraftSessionIds: string[] = [];
  let showRecent = false;
  let progressItems: ProgressItem[] = [];
  let expertDetailsOpen = false;
  let turnInspectionDetails: TurnDetailsViewModel | null = null;
  let turnInspectionArtifacts: ReadTurnArtifactsResponse["artifacts"] = [];
  let scopeApprovalArtifacts: ScopeApprovalArtifactRecord[] = [];
  let turnInspectionStorageMode = "";
  let turnInspectionLoading = false;
  let turnInspectionError = "";
  let turnInspectionRefreshNonce = 0;
  let hydratingDraft = false;
  let lastSavedDraftSignature = "";
  let step1Expanded = true;
  let preparedSetupSignature = "";
  let currentSetupSignature = "";
  let setupStepComplete = false;
  let copilotStepAvailable = false;
  let reviewStepAvailable = false;
  let workflowStartedAt: number | null = null;
  let completedAt: number | null = null;

  const templates: TemplateOption[] = [
    {
      key: "inspect_safe_copy",
      label: "ファイルを安全に確認",
      objective: "ファイルを開いて、変更予定を表示し、安全なコピーを保存する"
    },
    {
      key: "filter_rows",
      label: "必要な行だけ抽出",
      objective: "必要な行だけ残して、結果を説明し、別コピーとして保存する"
    },
    {
      key: "filter_rows",
      label: "条件で行を絞り込む",
      objective: "条件に合う行だけ残して、変更点を確認できるコピーを保存する"
    },
    {
      key: "rename_columns",
      label: "列名を変更",
      objective: "指定した列名を変更して、影響を表示し、別コピーとして保存する"
    },
    {
      key: "cast_columns",
      label: "列の型を整える",
      objective: "指定した列の型を整えて、変更点を確認し、別コピーとして保存する"
    },
    {
      key: "derive_column",
      label: "新しい列を追加",
      objective: "既存の列から新しい列を作って、結果を確認できるコピーを保存する"
    },
    {
      key: "group_aggregate",
      label: "合計を集計",
      objective: "指定した行の合計を集計して、結果を説明し、別コピーとして保存する"
    }
  ];

  const delegationSuggestions = templates.map((template) => ({
    label: template.label,
    value: template.objective
  }));

  const delegationEventIcons: Record<ActivityFeedEvent["type"], string> = {
    goal_set: "💬",
    file_attached: "📎",
    copilot_turn: "🤖",
    tool_executed: "🔧",
    plan_proposed: "📋",
    plan_approved: "✅",
    write_approval_requested: "⚠️",
    write_approved: "✓",
    step_completed: "✓",
    error: "❌",
    completed: "🎉"
  };

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

  function inferTemplateKey(nextObjective: string): TemplateKey | null {
    return (
      templates.find((template) => template.objective === nextObjective.trim())?.key ?? null
    );
  }

  function updateObjective(
    nextObjective: string,
    templateKey: TemplateKey | null = inferTemplateKey(nextObjective)
  ): void {
    objectiveText = nextObjective;
    selectedTemplateKey = templateKey;

    if (!taskNameEdited || !taskName.trim()) {
      taskName = deriveTitle(nextObjective);
    }
  }

  async function refreshProjects(): Promise<void> {
    const response = await listProjects();
    projects = response.projects;
    if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) {
      selectedProjectId = saveSelectedProjectId(null);
    }
  }

  async function refreshSessions(): Promise<void> {
    allSessions = await listSessions();
  }

  async function handleCreateProject(): Promise<void> {
    projectErrorMsg = "";
    projectInfoMsg = "";

    try {
      const project = await createProject({
        name: newProjectName,
        rootFolder: newProjectRootFolder,
        customInstructions: newProjectInstructions
      });
      await refreshProjects();
      selectedProjectId = saveSelectedProjectId(project.id);
      creatingProject = false;
      newProjectName = "";
      newProjectRootFolder = "";
      newProjectInstructions = "";
      requestProjectApprovalAuditRefresh();
    } catch (error) {
      projectErrorMsg = toError(error);
    }
  }

  async function handleAddProjectMemory(): Promise<void> {
    if (!selectedProjectId) {
      return;
    }

    projectErrorMsg = "";
    projectInfoMsg = "";
    try {
      await addProjectMemory({
        projectId: selectedProjectId,
        key: memoryDraftKey,
        value: memoryDraftValue,
        source: "user"
      });
      memoryDraftKey = "";
      memoryDraftValue = "";
      await refreshProjects();
    } catch (error) {
      projectErrorMsg = toError(error);
    }
  }

  async function handleRemoveProjectMemory(key: string): Promise<void> {
    if (!selectedProjectId) {
      return;
    }

    projectErrorMsg = "";
    projectInfoMsg = "";
    try {
      await removeProjectMemory({
        projectId: selectedProjectId,
        key
      });
      await refreshProjects();
    } catch (error) {
      projectErrorMsg = toError(error);
    }
  }

  async function handleAssignSessionToProject(): Promise<void> {
    if (!selectedProjectId || !sessionToAssignId) {
      return;
    }

    projectErrorMsg = "";
    projectInfoMsg = "";
    try {
      const response = await setSessionProject({
        sessionId: sessionToAssignId,
        projectId: selectedProjectId
      });
      projects = response.projects;
      await refreshSessions();
      const assignedSession = allSessions.find((session) => session.id === sessionToAssignId);
      sessionToAssignId = "";
      projectInfoMsg = assignedSession
        ? `セッションをプロジェクトへ割り当てました: ${assignedSession.title}`
        : "セッションをプロジェクトへ割り当てました。";
      requestProjectApprovalAuditRefresh();
    } catch (error) {
      projectErrorMsg = toError(error);
    }
  }

  async function handleDetachSessionFromProject(sessionIdToDetach: string): Promise<void> {
    projectErrorMsg = "";
    projectInfoMsg = "";
    try {
      const response = await setSessionProject({
        sessionId: sessionIdToDetach,
        projectId: null
      });
      projects = response.projects;
      await refreshSessions();
      const detachedSession = allSessions.find((session) => session.id === sessionIdToDetach);
      projectInfoMsg = detachedSession
        ? `セッションをプロジェクトから外しました: ${detachedSession.title}`
        : "セッションをプロジェクトから外しました。";
      requestProjectApprovalAuditRefresh();
    } catch (error) {
      projectErrorMsg = toError(error);
    }
  }

  function openProjectSession(sessionIdToOpen: string): void {
    const recentSession = recentSessions.find((session) => session.sessionId === sessionIdToOpen);
    if (recentSession) {
      handleRecentSessionClick(recentSession);
      return;
    }

    const session = allSessions.find((candidate) => candidate.id === sessionIdToOpen);
    if (!session) {
      projectErrorMsg = `session が見つかりません: ${sessionIdToOpen}`;
      return;
    }

    applyRecentSessionFallback({
      sessionId: session.id,
      title: session.title,
      workbookPath: session.primaryWorkbookPath ?? "",
      lastOpenedAt: new Date().toISOString(),
      lastTurnTitle: session.title
    });
  }

  function findAssignedProjectName(sessionId: string): string | null {
    return (
      projects.find((project) => project.sessionIds.includes(sessionId))?.name ?? null
    );
  }

  function matchesProjectSessionQuery(
    session: ProjectSessionSummary,
    query: string
  ): boolean {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return true;
    }

    return [
      session.title,
      session.workbookPath ?? "",
      session.assignedProjectName ?? ""
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  }

  async function handleAssignFilteredSessions(): Promise<void> {
    if (!selectedProjectId || filteredAvailableProjectSessions.length === 0) {
      return;
    }

    projectErrorMsg = "";
    projectInfoMsg = "";
    try {
      const targetCount = filteredAvailableProjectSessions.length;
      for (const session of filteredAvailableProjectSessions) {
        const response = await setSessionProject({
          sessionId: session.id,
          projectId: selectedProjectId
        });
        projects = response.projects;
      }
      await refreshSessions();
      projectInfoMsg = `${targetCount} 件のセッションをプロジェクトへ割り当てました。`;
      requestProjectApprovalAuditRefresh();
    } catch (error) {
      projectErrorMsg = toError(error);
    }
  }

  async function handleDetachFilteredSessions(): Promise<void> {
    if (filteredLinkedProjectSessions.length === 0) {
      return;
    }

    projectErrorMsg = "";
    projectInfoMsg = "";
    try {
      const targetCount = filteredLinkedProjectSessions.length;
      for (const session of filteredLinkedProjectSessions) {
        const response = await setSessionProject({
          sessionId: session.id,
          projectId: null
        });
        projects = response.projects;
      }
      await refreshSessions();
      projectInfoMsg = `${targetCount} 件のセッションをプロジェクトから外しました。`;
      requestProjectApprovalAuditRefresh();
    } catch (error) {
      projectErrorMsg = toError(error);
    }
  }

  function requestProjectApprovalAuditRefresh(): void {
    projectApprovalAuditRefreshNonce += 1;
  }

  function matchesProjectApprovalAuditQuery(
    row: ProjectApprovalAuditRow,
    query: string
  ): boolean {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return true;
    }

    return [
      row.sessionTitle,
      row.turnTitle,
      row.workbookPath ?? "",
      row.turnStatus,
      row.approvalSummary,
      row.outputPath ?? ""
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  }

  async function refreshProjectApprovalAudit(): Promise<void> {
    if (!selectedProject || linkedProjectSessions.length === 0) {
      projectApprovalAuditRows = [];
      projectApprovalAuditError = "";
      projectApprovalAuditLoading = false;
      return;
    }

    const targetProjectId = selectedProjectId;
    const sessionIdsSnapshot = linkedProjectSessions.map((session) => session.id);
    projectApprovalAuditLoading = true;
    projectApprovalAuditError = "";

    try {
      const rows = await Promise.all(
        linkedProjectSessions.map(async (sessionSummary) => {
          const detail = await readSession({ sessionId: sessionSummary.id });
          const latestTurnId = detail.session.latestTurnId;
          const latestTurn = latestTurnId
            ? detail.turns.find((turn) => turn.id === latestTurnId)
            : [...detail.turns].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

          if (!latestTurn) {
            return {
              sessionId: sessionSummary.id,
              sessionTitle: sessionSummary.title,
              workbookPath: sessionSummary.workbookPath ?? null,
              turnId: null,
              turnTitle: "turn 未作成",
              turnUpdatedAt: null,
              turnStatus: "draft",
              approvalSummary: "まだ turn が作成されていません。",
              writeApprovalDecision: "none",
              readyForExecution: false,
              scopeOverrideCount: 0,
              latestScopeDecision: null,
              latestScopeSource: null,
              latestScopeAt: null,
              outputPath: null
            } satisfies ProjectApprovalAuditRow;
          }

          const inspection = await readTurnArtifacts({
            sessionId: sessionSummary.id,
            turnId: latestTurn.id
          });
          const approvalPayload = inspection.turnDetails.approval.payload;
          const scopeArtifacts = inspection.artifacts
            .filter(
              (
                artifact: ReadTurnArtifactsResponse["artifacts"][number]
              ): artifact is ScopeApprovalArtifactRecord =>
                artifact.artifactType === "scope-approval"
            )
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          const latestScope = scopeArtifacts[0];

          const writeApprovalDecision = !approvalPayload
            ? "none"
            : approvalPayload.decision
              ? approvalPayload.decision
              : approvalPayload.requiresApproval
                ? "pending"
                : "not-required";

          return {
            sessionId: sessionSummary.id,
            sessionTitle: sessionSummary.title,
            workbookPath: sessionSummary.workbookPath ?? null,
            turnId: latestTurn.id,
            turnTitle: latestTurn.title,
            turnUpdatedAt: latestTurn.updatedAt,
            turnStatus: latestTurn.status,
            approvalSummary:
              inspection.turnDetails.approval.summary || "承認情報はまだありません。",
            writeApprovalDecision,
            readyForExecution: approvalPayload?.readyForExecution ?? false,
            scopeOverrideCount: scopeArtifacts.length,
            latestScopeDecision: latestScope?.payload.decision ?? null,
            latestScopeSource: latestScope?.payload.source ?? null,
            latestScopeAt: latestScope?.createdAt ?? null,
            outputPath: inspection.turnDetails.execution.payload?.outputPath ?? null
          } satisfies ProjectApprovalAuditRow;
        })
      );

      if (
        targetProjectId !== selectedProjectId ||
        JSON.stringify(sessionIdsSnapshot) !==
          JSON.stringify(linkedProjectSessions.map((session) => session.id))
      ) {
        return;
      }

      projectApprovalAuditRows = rows.sort((left, right) =>
        (right.turnUpdatedAt ?? "").localeCompare(left.turnUpdatedAt ?? "")
      );
    } catch (error) {
      projectApprovalAuditRows = [];
      projectApprovalAuditError = toError(error);
    } finally {
      projectApprovalAuditLoading = false;
    }
  }

  function clearPreviewState(): void {
    previewSummary = "";
    previewTargetCount = 0;
    previewAffectedRows = 0;
    previewOutputPath = "";
    previewWarnings = [];
    previewRequiresApproval = false;
    previewChangeDetails = [];
    previewSheetDiffs = [];
    previewFileWriteActions = [];
    showDetailedChanges = false;
  }

  function clearScopeApproval(): void {
    scopeApprovalVisible = false;
    scopeApprovalSource = null;
    scopeApprovalSummary = "";
    scopeApprovalRootFolder = "";
    scopeApprovalViolations = [];
  }

  function resetTurnInspectionState(): void {
    turnInspectionDetails = null;
    turnInspectionArtifacts = [];
    turnInspectionStorageMode = "";
    turnInspectionLoading = false;
    turnInspectionError = "";
  }

  function requestTurnInspectionRefresh(): void {
    turnInspectionRefreshNonce += 1;
  }

  async function refreshTurnInspection(): Promise<void> {
    if (!sessionId || !turnId) {
      resetTurnInspectionState();
      return;
    }

    turnInspectionLoading = true;
    turnInspectionError = "";

    try {
      const inspection = await readTurnArtifacts({ sessionId, turnId });
      if (inspection.turn.id !== turnId) {
        return;
      }

      turnInspectionDetails = inspection.turnDetails;
      turnInspectionArtifacts = inspection.artifacts;
      turnInspectionStorageMode = inspection.storageMode;
    } catch (error) {
      turnInspectionError = toError(error);
    } finally {
      turnInspectionLoading = false;
    }
  }

  function formatAuditTime(value?: string): string {
    if (!value) {
      return "未記録";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleString("ja-JP");
  }

  function formatApprovalDecision(decision?: "approved" | "rejected"): string {
    if (decision === "approved") {
      return "承認済み";
    }
    if (decision === "rejected") {
      return "却下";
    }
    return "未承認";
  }

  function formatWriteApprovalStatus(
    decision: ProjectApprovalAuditRow["writeApprovalDecision"]
  ): string {
    if (decision === "pending") {
      return "待ち";
    }
    if (decision === "not-required") {
      return "不要";
    }
    if (decision === "none") {
      return "未記録";
    }
    return formatApprovalDecision(decision);
  }

  function formatScopeApprovalSource(
    source?: ScopeApprovalSource | "manual" | "agent-loop"
  ): string {
    return source === "agent-loop" ? "自律実行" : "手動貼り付け";
  }

  function getRemainingPlanAfterCurrentStep(): ExecutionPlan | null {
    if (!approvedPlan || !currentPlanStepId) {
      return pendingPlan;
    }

    const currentIndex = approvedPlan.steps.findIndex((step) => step.id === currentPlanStepId);
    if (currentIndex < 0 || currentIndex >= approvedPlan.steps.length - 1) {
      return null;
    }

    const remainingSteps = approvedPlan.steps.slice(currentIndex + 1);
    return {
      ...approvedPlan,
      totalEstimatedSteps: remainingSteps.length,
      steps: remainingSteps
    };
  }

  function openScopeApproval(options: {
    source: ScopeApprovalSource;
    rootFolder: string;
    violations: string[];
    responseSummary: string;
    rawResponse?: string;
  }): void {
    const uniqueViolations = [...new Set(options.violations.filter((value) => value.trim()))];
    if (uniqueViolations.length === 0) {
      return;
    }

    scopeApprovalVisible = true;
    scopeApprovalSource = options.source;
    scopeApprovalSummary = options.responseSummary;
    scopeApprovalRootFolder = options.rootFolder;
    scopeApprovalViolations = uniqueViolations;
    guidedStage = "copilot";
    step1Expanded = false;
    if (options.rawResponse?.trim()) {
      copilotResponse = options.rawResponse;
      originalCopilotResponse = "";
      autoFixMessages = [];
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

  function suggestOutputPath(inputPath: string): string {
    const normalizedPath = inputPath.trim().replace(/\\/g, "/");
    if (!normalizedPath) {
      return "/path/to/output.copy.csv";
    }

    const lastSlashIndex = normalizedPath.lastIndexOf("/");
    const directory =
      lastSlashIndex >= 0 ? normalizedPath.slice(0, lastSlashIndex + 1) : "";
    const fileName =
      lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
    const extensionIndex = fileName.lastIndexOf(".");

    if (extensionIndex > 0) {
      return `${directory}${fileName.slice(0, extensionIndex)}.copy${fileName.slice(extensionIndex)}`;
    }

    return `${directory}${fileName}.copy`;
  }

  function buildSetupSignature(
    workbookPath: string,
    title: string,
    objective: string,
    templateKey: TemplateKey | null
  ): string {
    return JSON.stringify({
      workbookPath: workbookPath.trim(),
      title: title.trim(),
      objective: objective.trim(),
      templateKey
    });
  }

  function buildExpectedResponseTemplate(outputPath: string): string {
    return `{
  "version": "1.0",
  "status": "ready_to_write",
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
        "outputPath": "${outputPath}"
      }
    }
  ]
}`;
  }

  function formatWorkbookContextLines(
    profile: WorkbookProfile | null,
    columnProfiles: SheetColumnProfile[]
  ): string[] {
    if (!profile || profile.sheets.length === 0) {
      return ["- シート: 情報をまだ取得できていません"];
    }

    const lines: string[] = [];

    for (const sheet of profile.sheets) {
      lines.push(`- シート: ${sheet.name}`);

      const matchingProfile = columnProfiles.find(
        (columnProfile) => columnProfile.sheet === sheet.name
      );
      const typedColumns =
        matchingProfile?.columns.map((column) => `${column.column} (${column.inferredType})`) ??
        sheet.columns.map((column) => `${column} (string)`);

      if (typedColumns.length === 0) {
        lines.push("- 列（使える名前をそのまま使うこと）: 取得できませんでした");
        continue;
      }

      lines.push("- 列（使える名前をそのまま使うこと）:");
      const visibleColumns = typedColumns.slice(0, instructionColumnLimit);
      for (const column of visibleColumns) {
        lines.push(`  - ${column}`);
      }
      if (typedColumns.length > instructionColumnLimit) {
        lines.push(`  - （他 ${typedColumns.length - instructionColumnLimit} 列）`);
      }
    }

    return lines;
  }

  function buildTemplateExample(
    templateKey: TemplateKey | null,
    workbookPath: string,
    outputPath: string
  ): string {
    if (isBundledRevenueDemo(workbookPath)) {
      return `{
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
        "outputPath": "${outputPath}"
      }
    }
  ]
}`;
    }

    switch (templateKey) {
      case "rename_columns":
        return `{
  "version": "1.0",
  "summary": "列名を分かりやすい名前に変更して別コピーを保存します。",
  "actions": [
    {
      "tool": "table.rename_columns",
      "sheet": "Sheet1",
      "args": {
        "renames": [
          { "from": "name", "to": "customer_name" }
        ]
      }
    },
    {
      "tool": "workbook.save_copy",
      "args": {
        "outputPath": "${outputPath}"
      }
    }
  ]
}`;
      case "cast_columns":
        return `{
  "version": "1.0",
  "summary": "amount 列を number 型として扱えるように整えて別コピーを保存します。",
  "actions": [
    {
      "tool": "table.cast_columns",
      "sheet": "Sheet1",
      "args": {
        "casts": [
          { "column": "amount", "toType": "number" }
        ]
      }
    },
    {
      "tool": "workbook.save_copy",
      "args": {
        "outputPath": "${outputPath}"
      }
    }
  ]
}`;
      case "derive_column":
        return `{
  "version": "1.0",
  "summary": "新しい計算列を追加して別コピーを保存します。",
  "actions": [
    {
      "tool": "table.derive_column",
      "sheet": "Sheet1",
      "args": {
        "column": "amount_with_tax",
        "expression": "[amount] * 1.1",
        "position": "end"
      }
    },
    {
      "tool": "workbook.save_copy",
      "args": {
        "outputPath": "${outputPath}"
      }
    }
  ]
}`;
      case "group_aggregate":
        return `{
  "version": "1.0",
  "summary": "category ごとの amount 合計を集計して別コピーを保存します。",
  "actions": [
    {
      "tool": "table.group_aggregate",
      "sheet": "Sheet1",
      "args": {
        "groupBy": ["category"],
        "measures": [
          { "column": "amount", "op": "sum", "as": "total_amount" }
        ]
      }
    },
    {
      "tool": "workbook.save_copy",
      "args": {
        "outputPath": "${outputPath}"
      }
    }
  ]
}`;
      case "filter_rows":
      case "inspect_safe_copy":
      default:
        return `{
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
        "outputPath": "${outputPath}"
      }
    }
  ]
}`;
    }
  }

  function buildCopilotInstructionText(
    packet: GenerateRelayPacketResponse,
    workbookPath: string,
    title: string,
    profile: WorkbookProfile | null,
    columnProfiles: SheetColumnProfile[],
    templateKey: TemplateKey | null,
    projectContext = ""
  ): string {
    const toolLines = [...packet.allowedReadTools, ...packet.allowedWriteTools].map(
      (tool) => `- ${tool.id}: ${tool.description}`
    );
    const outputPath = suggestOutputPath(workbookPath);
    const example = buildTemplateExample(templateKey, workbookPath, outputPath);

    return [
      "Relay Agent からの依頼です。",
      "",
      ...(projectContext.trim() ? [projectContext.trim(), ""] : []),
      "1. やりたいこと",
      `- 作業名: ${title}`,
      `- 目的: ${packet.objective}`,
      "",
      "2. 対象ファイル",
      `- ファイル: ${workbookPath}`,
      ...formatWorkbookContextLines(profile, columnProfiles),
      "",
      "3. 使ってよい操作",
      ...toolLines,
      "",
      "4. 各 tool の正確な args 構造（この通りに書いてください）",
      TOOL_ARGS_REFERENCE,
      "",
      "5. 回答ルール",
      "- JSON のみを返してください。",
      "- ``` で囲まないでください。",
      "- パス区切りは / を使ってください。",
      "- _ や [ ] を \\_ や \\[ \\] にしないでください。",
      "- tool 名、args 名、列名は見えている文字をそのまま使ってください。",
      "- 上にない tool は使わないでください。",
      "",
      "6. 回答テンプレート",
      buildExpectedResponseTemplate(outputPath),
      "",
      "7. 回答例",
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
    const commonRules = [
      "``` で囲まない",
      "パスは / 区切りで書く",
      "JSON 以外の説明文を付けない",
      "_ や [ ] を \\_ や \\[ \\] にしない"
    ];

    if (feedback.level === 1) {
      return [
        "先ほどの回答は Relay Agent で受け付けられませんでした。",
        `JSON 構文エラー: ${feedback.specificError}`,
        "",
        "同じ内容のまま、JSON の書き方だけを直してください。",
        ...commonRules.map((rule, index) => `${index + 1}. ${rule}`),
        "5. カンマ、引用符、{ } と [ ] の閉じ忘れを直す",
        "",
        "期待するテンプレート:",
        expectedResponseTemplate
      ].join("\n");
    }

    if (feedback.level === 2) {
      return [
        "先ほどの回答は Relay Agent で受け付けられませんでした。",
        `スキーマエラー: ${feedback.specificError}`,
        "",
        "必要な項目をそろえて、同じ意図の JSON を返してください。",
        ...commonRules.map((rule, index) => `${index + 1}. ${rule}`),
        "5. version / summary / actions を必ず含める",
        "6. actions は配列で返す",
        "",
        "期待するテンプレート:",
        expectedResponseTemplate
      ].join("\n");
    }

    return [
      "先ほどの回答は Relay Agent で受け付けられませんでした。",
      `tool 名エラー: ${feedback.specificError}`,
      "",
      "使える tool 名だけに直して、同じ内容の JSON を返してください。",
      ...commonRules.map((rule, index) => `${index + 1}. ${rule}`),
      `5. 使える tool: ${allowedTools.join(", ")}`,
      "6. tool 名は見えている文字をそのまま使う",
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

  function currentStepNumber(): number {
    if (executionDone) {
      return 3;
    }

    if (guidedStage === "review-save") {
      return 3;
    }

    if (guidedStage === "copilot") {
      return 2;
    }

    return 1;
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

  function pushDelegationEvent(
    type: ActivityFeedEvent["type"],
    message: string,
    options?: {
      detail?: string;
      expandable?: boolean;
      actionRequired?: boolean;
    }
  ): void {
    activityFeedStore.push({
      type,
      message,
      icon: delegationEventIcons[type],
      detail: options?.detail,
      expandable: options?.expandable,
      actionRequired: options?.actionRequired
    });
  }

  function setUiMode(nextMode: UiMode): void {
    uiMode = saveUiMode(nextMode);
  }

  function refreshContinuityState(): void {
    recentSessions = listRecentSessions();
    recentFiles = listRecentFiles();
    recoverableDraftSessionIds = listRecoverableStudioDrafts().map((draft) => draft.sessionId);
  }

  function resetAgentLoopState(clearLog = true): void {
    agentLoopRunning = false;
    agentLoopTurn = 0;
    agentLoopSummary = "";
    agentLoopFinalStatus = null;
    agentLoopResult = null;
    agentLoopConversationHistory = [];
    agentLoopAbortController = null;
    activeAgentLoopEntryId = null;
    if (clearLog) {
      agentLoopLog = [];
    }
  }

  function resetPlanExecutionState(clearPlanReview = true): void {
    approvedPlan = null;
    pendingPlan = null;
    executionStepStatuses = [];
    currentPlanStepId = null;
    isPlanExecuting = false;
    isPlanPaused = false;
    planPauseRequested = false;
    planPauseReason = "";
    planPauseResolver = null;
    if (clearPlanReview) {
      planSteps = [];
      showReplanFeedback = false;
      replanFeedback = "";
    }
  }

  function buildFallbackPlanningContext(): {
    workbookSummary: string;
    availableTools: { read: string[]; write: string[] };
  } {
    const workbookSummary = [
      filePath.trim() ? `File: ${filePath.trim()}` : "File: not selected",
      ...formatWorkbookContextLines(workbookProfile, workbookColumnProfiles)
    ].join("\n");

    return {
      workbookSummary,
      availableTools: {
        read: relayPacket?.allowedReadTools.map((tool) => tool.id) ?? [],
        write: relayPacket?.allowedWriteTools.map((tool) => tool.id) ?? []
      }
    };
  }

  function initializePlanExecution(plan: ExecutionPlan): void {
    approvedPlan = plan;
    executionStepStatuses = plan.steps.map((step) => ({
      ...step,
      state: "pending"
    }));
    currentPlanStepId = null;
  }

  function applyPlanProgressSnapshot(progress: PlanProgressResponse): void {
    currentPlanStepId = progress.currentStepId;
    executionStepStatuses = executionStepStatuses.map((step) => {
      const persisted = progress.stepStatuses.find(
        (candidate) => candidate.stepId === step.id
      );

      return persisted
        ? {
            ...step,
            state: persisted.state,
            result: persisted.result,
            error: persisted.error
          }
        : step;
    });
  }

  function updatePlanStepState(
    stepId: string,
    patch: Partial<Pick<PlanExecutionStep, "state" | "result" | "error">>
  ): void {
    executionStepStatuses = executionStepStatuses.map((step) =>
      step.id === stepId ? { ...step, ...patch } : step
    );
  }

  function buildPlanProgressPayload() {
    return {
      sessionId,
      turnId,
      currentStepId: currentPlanStepId,
      completedCount: executionStepStatuses.filter((step) => step.state === "completed")
        .length,
      totalCount: executionStepStatuses.length,
      stepStatuses: executionStepStatuses.map((step) => ({
        stepId: step.id,
        state: step.state,
        result: step.result,
        error: step.error
      }))
    };
  }

  async function persistPlanProgressSnapshot(): Promise<void> {
    if (!sessionId || !turnId || executionStepStatuses.length === 0) {
      return;
    }

    await recordPlanProgress(buildPlanProgressPayload());
  }

  function releasePlanPause(): void {
    const resolver = planPauseResolver;
    planPauseResolver = null;
    isPlanPaused = false;
    planPauseReason = "";
    resolver?.();
  }

  async function waitForPlanContinuation(step: PlanStep): Promise<void> {
    const needsManualReadApproval = step.phase === "read" && !autoApproveReadSteps;
    const shouldPauseNow =
      pauseBetweenSteps || planPauseRequested || needsManualReadApproval;

    if (!shouldPauseNow) {
      return;
    }

    planPauseRequested = false;
    isPlanPaused = true;
    planPauseReason = needsManualReadApproval
      ? "読み取りステップの実行待ちです。"
      : "次のステップの開始前で一時停止しています。";

    await new Promise<void>((resolve) => {
      planPauseResolver = resolve;
    });
  }

  function requestPlanPause(): void {
    if (!isPlanExecuting) {
      return;
    }

    planPauseRequested = true;
    planPauseReason = "現在のステップ完了後に一時停止します。";
  }

  function resumePlanExecution(): void {
    releasePlanPause();
  }

  function pushAgentLoopLog(
    tool: string,
    label: string,
    status: ProgressStatus,
    options?: {
      detail?: string;
      errorMessage?: string;
      rawResult?: unknown;
      startTime?: number;
      endTime?: number;
      showDetail?: boolean;
    }
  ): string {
    const id = `${Date.now()}-${agentLoopLog.length}`;
    agentLoopLog = [
      ...agentLoopLog,
      {
        id,
        tool,
        label,
        status,
        startTime: options?.startTime ?? Date.now(),
        endTime: options?.endTime,
        detail: options?.detail,
        errorMessage: options?.errorMessage,
        rawResult: options?.rawResult,
        showDetail: options?.showDetail ?? false
      }
    ];

    return id;
  }

  function updateAgentLoopLog(
    id: string,
    patch: Partial<Omit<AgentLoopLogEntry, "id">>
  ): void {
    agentLoopLog = agentLoopLog.map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry
    );
  }

  function toggleAgentLoopDetail(id: string): void {
    agentLoopLog = agentLoopLog.map((entry) =>
      entry.id === id ? { ...entry, showDetail: !entry.showDetail } : entry
    );
  }

  function summarizeToolResult(result: ToolExecutionResult): string {
    if (!result.ok) {
      return result.error ?? "ツール実行に失敗しました。";
    }

    if (result.tool === "workbook.inspect") {
      const sheetCount = (result.result as { sheetCount?: number } | undefined)?.sheetCount;
      return typeof sheetCount === "number"
        ? `${sheetCount} シートを確認しました。`
        : "ブック情報を確認しました。";
    }

    if (result.tool === "sheet.preview") {
      const rows = (result.result as { rows?: unknown[] } | undefined)?.rows;
      return Array.isArray(rows) ? `${rows.length} 行をプレビューしました。` : "シートをプレビューしました。";
    }

    if (result.tool === "sheet.profile_columns") {
      const columns = (result.result as { columns?: unknown[] } | undefined)?.columns;
      return Array.isArray(columns) ? `${columns.length} 列を確認しました。` : "列型を確認しました。";
    }

    return "読み取りツールを実行しました。";
  }

  function cancelAgentLoop(): void {
    agentLoopAbortController?.abort();
    releasePlanPause();
  }

  function startFromWelcome(): void {
    markWelcomeSeen();
    showWelcome = false;
  }

  function openFilePicker(): void {
    hiddenFilePicker?.click();
  }

  function applyPickedFile(file: File | null): void {
    if (!file) {
      return;
    }

    const fileWithPath = file as File & { path?: string };
    filePath = fileWithPath.path?.trim() || file.name;
  }

  function handleFilePickerChange(event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    applyPickedFile(target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent): void {
    isDragOver = false;
    applyPickedFile(event.dataTransfer?.files?.[0] ?? null);
  }

  async function testCdpConnection(): Promise<void> {
    cdpTestStatus = "testing";
    cdpTestMessage = "";

    try {
      const ports = autoLaunchEdge
        ? Array.from(
            { length: AUTO_CDP_PORT_RANGE_END - AUTO_CDP_PORT_RANGE_START + 1 },
            (_, index) => AUTO_CDP_PORT_RANGE_START + index
          )
        : [cdpPort];

      let detectedPort: number | null = null;
      let payload: { Browser?: string } | null = null;

      for (const port of ports) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/version`);
          if (!response.ok) {
            continue;
          }

          detectedPort = port;
          payload = (await response.json()) as { Browser?: string };
          break;
        } catch {
          continue;
        }
      }

      if (detectedPort === null || payload === null) {
        throw new Error("not found");
      }

      const version = payload.Browser?.split("/")[1]?.split(".")[0] ?? "";
      cdpTestMessage = version
        ? `接続済み（Edge ${version} / ポート ${detectedPort}）`
        : `接続済み（ポート ${detectedPort}）`;
      cdpTestStatus = "ok";
    } catch {
      cdpTestMessage = autoLaunchEdge
        ? "起動済みの Edge は見つかりませんでした。送信時に自動起動されます。"
        : "Edge が起動しているか、ポート番号を確認してください。";
      cdpTestStatus = "fail";
    }
  }

  async function openOutputFile(): Promise<void> {
    if (!previewOutputPath.trim()) {
      return;
    }

    try {
      await open(previewOutputPath);
    } catch (error) {
      await copyToClipboard(previewOutputPath);
      errorMsg = toError(error);
    }
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
    if (expertDetailsOpen) {
      requestTurnInspectionRefresh();
    }
  }

  function hasRecoverableDraft(sessionId: string): boolean {
    return recoverableDraftSessionIds.includes(sessionId);
  }

  async function refreshWorkbookContext(path: string): Promise<void> {
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      workbookProfile = null;
      workbookColumnProfiles = [];
      return;
    }

    try {
      const inspection = await inspectWorkbook({ workbookPath: trimmedPath });
      workbookProfile = inspection.profile;
      workbookColumnProfiles = inspection.columnProfiles;
    } catch {
      workbookProfile = null;
      workbookColumnProfiles = [];
    }
  }

  function inferDelegationFiles(goal: string, files: string[]): string[] {
    if (files.length > 0) {
      return files;
    }

    const normalizedGoal = goal.toLowerCase();
    const matched = recentFiles.find((file) => {
      const fileName = file.path.split(/[\\/]/).pop()?.toLowerCase();
      return fileName ? normalizedGoal.includes(fileName) : false;
    });

    return matched ? [matched.path] : [];
  }

  function persistDelegationDraft(): void {
    if (uiMode !== "delegation") {
      return;
    }

    saveDelegationDraft({
      goal: $delegationStore.goal,
      attachedFiles: $delegationStore.attachedFiles,
      activityFeedSnapshot: $activityFeedStore,
      delegationState: $delegationStore.state,
      planSnapshot: $delegationStore.plan,
      conversationHistorySnapshot: agentLoopConversationHistory,
      currentStepIndex: $delegationStore.currentStepIndex,
      lastUpdatedAt: new Date().toISOString()
    });
  }

  async function handleDelegationSubmit(
    event: CustomEvent<{ goal: string; files: string[] }>
  ): Promise<void> {
    const goal = event.detail.goal.trim();
    const attachedFiles = inferDelegationFiles(goal, event.detail.files);

    delegationStore.reset();
    activityFeedStore.clear();
    delegationStore.setGoal(goal, attachedFiles);
    pushDelegationEvent("goal_set", `目標を設定しました: ${goal}`);

    for (const file of attachedFiles) {
      pushDelegationEvent("file_attached", `ファイルを関連付けました: ${file.split(/[\\/]/).pop()}`, {
        detail: file
      });
    }

    if (attachedFiles.length === 0) {
      delegationStore.setError("ファイルを添付するか、最近使ったファイル名を目標文に含めてください。");
      pushDelegationEvent("error", "対象ファイルがまだ選択されていません。", {
        actionRequired: true
      });
      return;
    }

    filePath = attachedFiles[0] ?? "";
    updateObjective(goal);
    taskName = deriveTitle(goal);
    taskNameEdited = false;
    guidedStage = "setup";
    clearProgress();
    delegationStore.startPlanning();
    pushDelegationEvent("copilot_turn", "作業の準備とプランニングを開始します。");

    await handleSetupStage();
    if (errorMsg) {
      delegationStore.setError(errorMsg);
      pushDelegationEvent("error", errorMsg, { actionRequired: true });
      return;
    }

    await handleAgentLoopAutoSend(undefined, true);
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
    step1Expanded = true;
    errorMsg = "";
    copiedInstructionNotice = "";
    copiedBrowserCommandNotice = "";
    copilotAutoError = null;
    isSendingToCopilot = false;
    clearScopeApproval();
    resetAgentLoopState();
    resetPlanExecutionState();
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
    clearPreviewState();
    resetTurnInspectionState();
    executionDone = false;
    executionSummary = "";
    workbookProfile = null;
    workbookColumnProfiles = [];
    preparedSetupSignature = "";
    filePath = session.workbookPath;
    selectedTemplateKey = null;
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
    step1Expanded = false;
    errorMsg = "";
    copiedInstructionNotice = "";
    copiedBrowserCommandNotice = "";
    copilotAutoError = null;
    isSendingToCopilot = false;
    clearScopeApproval();
    resetAgentLoopState();
    resetPlanExecutionState();
    validationFeedback = null;
    retryPrompt = "";
    clearProgress();
    preflight = null;
    sessionId = draft.sessionId;
    turnId = draft.selectedTurnId ?? "";
    filePath = draft.workbookPath || session.workbookPath;
    objectiveText = draft.turnObjective;
    selectedTemplateKey = inferTemplateKey(draft.turnObjective);
    taskName = draft.turnTitle || session.lastTurnTitle || session.title;
    taskNameEdited = Boolean(taskName.trim());
    preparedSetupSignature = buildSetupSignature(
      filePath,
      taskName,
      objectiveText,
      selectedTemplateKey
    );
    relayPacketText = draft.relayPacketText;
    const restoredPacket = parseRelayPacket(draft.relayPacketText);
    relayPacket = restoredPacket;
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
    previewFileWriteActions = draft.previewSnapshot?.fileWriteActions ?? [];
    showDetailedChanges = false;
    resetTurnInspectionState();
    executionDone = false;
    executionSummary = draft.executionSummary;
    showRecent = false;
    void refreshWorkbookContext(filePath);
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

  function handleRecentSessionSelectById(sessionIdToOpen: string): void {
    const session = recentSessions.find((candidate) => candidate.sessionId === sessionIdToOpen);
    if (session) {
      handleRecentSessionClick(session);
    }
  }

  async function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }

  function persistBrowserAutomationSettings(): void {
    const saved = saveBrowserAutomationSettings({
      cdpPort,
      autoLaunchEdge,
      timeoutMs,
      agentLoopEnabled,
      maxTurns,
      loopTimeoutMs,
      planningEnabled,
      autoApproveReadSteps,
      pauseBetweenSteps
    });
    cdpPort = saved.cdpPort;
    autoLaunchEdge = saved.autoLaunchEdge;
    timeoutMs = saved.timeoutMs;
    agentLoopEnabled = saved.agentLoopEnabled;
    maxTurns = saved.maxTurns;
    loopTimeoutMs = saved.loopTimeoutMs;
    planningEnabled = saved.planningEnabled;
    autoApproveReadSteps = saved.autoApproveReadSteps;
    pauseBetweenSteps = saved.pauseBetweenSteps;
    copiedBrowserCommandNotice = "";
    cdpTestStatus = "idle";
    cdpTestMessage = "";
  }

  async function copyCopilotInstruction(): Promise<void> {
    if (!copilotInstructionText.trim()) {
      return;
    }

    await copyToClipboard(copilotInstructionText);
    copiedInstructionNotice = "Copilot に渡すテキストをコピーしました。";
  }

  async function copyEdgeLaunchCommand(): Promise<void> {
    await copyToClipboard(getEdgeLaunchCommand());
    copiedBrowserCommandNotice = "Edge の起動コマンドをコピーしました。";
  }

  function getGuidePort(): number {
    return autoLaunchEdge ? AUTO_CDP_PORT_RANGE_START : cdpPort;
  }

  function getEdgeLaunchCommand(): string {
    return `msedge.exe --remote-debugging-port=${getGuidePort()} --no-first-run`;
  }

  function describeBrowserProgressStep(step: string): string {
    switch (step) {
      case "port_scan":
        return "空きポートを探索中…";
      case "edge_launch":
        return "Edge を起動中…";
      case "cdp_connect":
        return "接続しています…";
      default:
        return "Copilot に送信中…";
    }
  }

  function handleBrowserProgress(event: BrowserCommandProgress): void {
    sendStatusMessage = event.detail?.trim() || describeBrowserProgressStep(event.step);
  }

  function focusCopilotResponseField(): void {
    copilotResponseField?.focus();
    copilotResponseField?.scrollIntoView({ block: "center" });
  }

  async function handleSingleShotCopilotAutoSend(): Promise<void> {
    if (!copilotInstructionText.trim()) {
      return;
    }

    isSendingToCopilot = true;
    sendStatusMessage = "Copilot に送信中…";
    copilotAutoError = null;
    copiedInstructionNotice = "";
    clearScopeApproval();
    resetAgentLoopState();
    resetPlanExecutionState();

    try {
      const response = await sendToCopilot(copilotInstructionText, {
        onProgress: handleBrowserProgress
      });
      copilotResponse = response;
      originalCopilotResponse = "";
      autoFixMessages = [];
      validationFeedback = null;
      retryPrompt = "";
    } catch (error) {
      console.error("[copilot-browser] handleCopilotAutoSend error:", error);
      const friendlyMsg = getCopilotBrowserErrorMessage(error);
      const rawMsg = error instanceof Error ? error.message.trim() : String(error);
      copilotAutoError = rawMsg && rawMsg !== friendlyMsg
        ? `${friendlyMsg}\n[詳細: ${rawMsg}]`
        : friendlyMsg;
    } finally {
      isSendingToCopilot = false;
      sendStatusMessage = "";
    }
  }

  async function buildPlanningInstruction(extraFeedback = ""): Promise<string> {
    const fallback = buildFallbackPlanningContext();
    let planningContext = {
      workbookSummary: fallback.workbookSummary,
      availableTools: fallback.availableTools
    };

    try {
      const handoff = await assessCopilotHandoff({ sessionId, turnId });
      planningContext = handoff.planningContext ?? {
        workbookSummary: fallback.workbookSummary,
        availableTools: fallback.availableTools,
        suggestedApproach: handoff.suggestedActions
      };
    } catch {
      planningContext = fallback;
    }
    return buildPlanningPrompt(
      objectiveText.trim(),
      planningContext.workbookSummary,
      planningContext.availableTools,
      extraFeedback.trim() || undefined,
      projectContextText || undefined
    );
  }

  async function executeApprovedPlan(
    planToExecute: ExecutionPlan,
    options: { resetProgress?: boolean } = {}
  ): Promise<void> {
    if (planToExecute.steps.length === 0) {
      executionDone = true;
      executionSummary = executionSummary || "すべてのステップが完了しました。";
      completedAt = Date.now();
      return;
    }

    if (options.resetProgress ?? true) {
      initializePlanExecution(planToExecute);
      delegationStore.approvePlan();
      pushDelegationEvent("plan_approved", "承認した計画の実行を開始しました。");
      const persisted = await getPlanProgress({ sessionId, turnId });
      if (persisted.totalCount > 0) {
        applyPlanProgressSnapshot(persisted);
      }
    }

    pendingPlan = planToExecute;
    clearScopeApproval();
    isPlanExecuting = true;
    isSendingToCopilot = true;
    sendStatusMessage = "計画を実行しています…";
    agentLoopRunning = true;
    agentLoopTurn = 0;
    agentLoopSummary = "";
    agentLoopFinalStatus = null;
    copilotAutoError = null;

    const abortController = new AbortController();
    agentLoopAbortController = abortController;

    try {
      const result = await resumeAgentLoopWithPlan(
        {
          sessionId,
          turnId,
          initialPrompt: copilotInstructionText,
          maxTurns: Math.max(maxTurns, planToExecute.steps.length),
          loopTimeoutMs,
          abortSignal: abortController.signal,
          planningEnabled: false,
          initialConversationHistory: agentLoopConversationHistory,
          projectContext: projectContextText || undefined,
          projectRootFolder: selectedProject?.rootFolder || undefined
        },
        planToExecute,
        {
          onBrowserProgress: handleBrowserProgress,
          onTurnStart: (turn) => {
            agentLoopTurn = turn;
          },
          onStepStart: (step, index) => {
            agentLoopTurn = index + 1;
            currentPlanStepId = step.id;
            updatePlanStepState(step.id, {
              state: step.phase === "write" ? "pending" : "running",
              error: undefined
            });
            activeAgentLoopEntryId = pushAgentLoopLog(
              step.tool,
              `Step ${index + 1}: ${step.description}`,
              "running"
            );
            if (uiMode === "delegation") {
              pushDelegationEvent("copilot_turn", `ステップ ${index + 1} を開始しました: ${step.description}`, {
                detail: `${step.tool} / ${step.phase}`
              });
            }
            void persistPlanProgressSnapshot();
          },
          onCopilotResponse: (_turn, response) => {
            agentLoopSummary = response.summary;
            if (activeAgentLoopEntryId) {
              updateAgentLoopLog(activeAgentLoopEntryId, {
                status: "done",
                endTime: Date.now(),
                detail: response.message ?? response.summary,
                rawResult: response
              });
              activeAgentLoopEntryId = null;
            }
          },
          onRetry: (turn, retryLevel, error, retryPromptText) => {
            pushAgentLoopLog(
              `copilot.retry.${turn}.${retryLevel}`,
              `Step ${turn}: 再試行 ${retryLevel}`,
              "error",
              {
                detail: retryPromptText,
                errorMessage: error,
                endTime: Date.now()
              }
            );
            if (uiMode === "delegation") {
              pushDelegationEvent("error", `Copilot 応答の再試行 ${retryLevel}`, {
                detail: error,
                expandable: false
              });
            }
          },
          onManualFallback: (_turn, fallbackPrompt, error) => {
            retryPrompt = fallbackPrompt;
            if (uiMode === "delegation") {
              pushDelegationEvent("error", "手動フォールバックが必要です。", {
                detail: `${error}\n\n${fallbackPrompt}`,
                expandable: true,
                actionRequired: true
              });
            }
          },
          onScopeWarning: ({ violations, rootFolder, tool, rawResponse, parsedResponse }) => {
            const firstViolation = violations[0] ?? "";
            copilotAutoError = `プロジェクトスコープ外のファイルアクセスが検出されました: ${firstViolation}`;
            openScopeApproval({
              source: "agent-loop",
              rootFolder,
              violations,
              responseSummary:
                parsedResponse.message ??
                parsedResponse.summary ??
                "Copilot がプロジェクトルート外へのファイル操作を提案しました。",
              rawResponse
            });
            if (uiMode === "delegation") {
              delegationStore.requestApproval();
              pushDelegationEvent("write_approval_requested", "プロジェクト範囲外アクセスの承認が必要です。", {
                detail: `${tool}\n許可されたルート: ${rootFolder}\n${violations.join("\n")}`,
                expandable: true,
                actionRequired: true
              });
            }
          },
          onToolResults: (_turn, toolResults) => {
            for (const toolResult of toolResults) {
              pushAgentLoopLog(
                toolResult.tool,
                toolResult.tool,
                toolResult.ok ? "done" : "error",
                {
                  detail: summarizeToolResult(toolResult),
                  errorMessage: toolResult.error,
                  rawResult: toolResult.ok ? toolResult.result : { error: toolResult.error },
                  endTime: Date.now()
                }
              );
              if (uiMode === "delegation") {
                pushDelegationEvent(
                  "tool_executed",
                  `${toolResult.tool} を実行しました`,
                  {
                    detail: summarizeToolResult(toolResult),
                    expandable: false
                  }
                );
              }
            }
          },
          onStepComplete: (step, _index, result) => {
            updatePlanStepState(step.id, {
              state: result.ok ? "completed" : "failed",
              result: result.result,
              error: result.error
            });
            if (currentPlanStepId === step.id) {
              currentPlanStepId = null;
            }
            delegationStore.advanceStep();
            if (uiMode === "delegation") {
              pushDelegationEvent(
                result.ok ? "step_completed" : "error",
                result.ok
                  ? `ステップが完了しました: ${step.description}`
                  : `ステップが失敗しました: ${step.description}`,
                {
                  detail: result.ok ? summarizeToolResult(result) : result.error,
                  actionRequired: !result.ok
                }
              );
            }
            void persistPlanProgressSnapshot();
          },
          onWriteStepReached: (step) => {
            currentPlanStepId = step.id;
            updatePlanStepState(step.id, { state: "pending" });
            delegationStore.requestApproval();
            if (uiMode === "delegation") {
              pushDelegationEvent("write_approval_requested", `書き込み前の承認が必要です: ${step.description}`, {
                detail: step.tool,
                actionRequired: true
              });
            }
            void persistPlanProgressSnapshot();
          },
          waitForStepContinuation: waitForPlanContinuation
        }
      );

      agentLoopResult = result;
      agentLoopConversationHistory = result.conversationHistory;
      agentLoopSummary = result.summary;
      agentLoopFinalStatus = result.status === "cancelled" ? null : result.status;
      pendingPlan = result.proposedPlan ?? null;

      if (result.status === "ready_to_write" && result.finalResponse) {
        copilotResponse = JSON.stringify(result.finalResponse, null, 2);
        originalCopilotResponse = "";
        autoFixMessages = [];
        isPlanExecuting = false;
        await handleCopilotStage();
        return;
      }

      if (result.status === "done") {
        currentPlanStepId = null;
        await persistPlanProgressSnapshot();
        executionSummary = result.summary;
        executionDone = true;
        completedAt = Date.now();
        delegationStore.complete();
        if (uiMode === "delegation") {
          pushDelegationEvent("completed", "自律実行が完了しました。", {
            detail: result.summary
          });
        }
        return;
      }

      if (result.status === "error") {
        copilotAutoError = result.summary;
        delegationStore.setError(result.summary);
        if (uiMode === "delegation") {
          pushDelegationEvent("error", result.summary, { actionRequired: true });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        agentLoopSummary = "自律実行をキャンセルしました。";
      } else if (scopeApprovalVisible) {
        if (currentPlanStepId) {
          updatePlanStepState(currentPlanStepId, {
            state: "pending",
            error: undefined
          });
          void persistPlanProgressSnapshot();
        }
      } else {
        const friendlyMsg = getCopilotBrowserErrorMessage(error);
        const rawMsg = error instanceof Error ? error.message.trim() : String(error);
        copilotAutoError = rawMsg && rawMsg !== friendlyMsg
          ? `${friendlyMsg}\n[詳細: ${rawMsg}]`
          : friendlyMsg;
        if (currentPlanStepId) {
          updatePlanStepState(currentPlanStepId, {
            state: "failed",
            error: copilotAutoError
          });
          void persistPlanProgressSnapshot();
        }
        delegationStore.setError(copilotAutoError);
        if (uiMode === "delegation") {
          pushDelegationEvent("error", copilotAutoError, { actionRequired: true });
        }
      }
    } finally {
      isSendingToCopilot = false;
      sendStatusMessage = "";
      agentLoopRunning = false;
      agentLoopAbortController = null;
      isPlanExecuting = false;
    }
  }

  async function handleApprovePlan(): Promise<void> {
    if (!agentLoopResult?.proposedPlan || planSteps.length === 0) {
      return;
    }

    const response = await approvePlan({
      sessionId,
      turnId,
      approvedStepIds: planSteps.map((step) => step.id),
      modifiedSteps: planSteps
    });
    const approved = response.plan;
    agentLoopResult = null;
    showReplanFeedback = false;
    replanFeedback = "";
    initializePlanExecution(approved);
    delegationStore.proposePlan(approved);
    await executeApprovedPlan(approved);
  }

  function removePlanStep(index: number): void {
    planSteps = planSteps.filter((_, candidateIndex) => candidateIndex !== index);
  }

  function movePlanStep(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= planSteps.length) {
      return;
    }

    const nextSteps = [...planSteps];
    const [step] = nextSteps.splice(index, 1);
    nextSteps.splice(nextIndex, 0, step);
    planSteps = nextSteps;
  }

  async function handleReplan(): Promise<void> {
    if (!sessionId || !turnId) {
      return;
    }

    showReplanFeedback = false;
    const planningPrompt = await buildPlanningInstruction(replanFeedback);
    pushDelegationEvent("copilot_turn", "フィードバック付きで再計画します。", {
      detail: replanFeedback
    });
    replanFeedback = "";
    resetPlanExecutionState(false);
    agentLoopResult = null;
    planSteps = [];
    await handleAgentLoopAutoSend(planningPrompt, true);
  }

  function handleCancelPlan(): void {
    cancelAgentLoop();
    releasePlanPause();
    resetPlanExecutionState();
    agentLoopResult = null;
    if (uiMode === "delegation") {
      delegationStore.setError("自律実行をキャンセルしました。");
      pushDelegationEvent("error", "自律実行をキャンセルしました。", {
        actionRequired: true
      });
    }
  }

  async function handleAgentLoopAutoSend(
    initialPromptOverride?: string,
    forcePlanning = false
  ): Promise<void> {
    if (!copilotInstructionText.trim() && !initialPromptOverride?.trim()) {
      return;
    }

    const planningMode = forcePlanning || planningEnabled;
    isSendingToCopilot = true;
    sendStatusMessage = "Copilot に送信中…";
    agentLoopRunning = true;
    agentLoopTurn = 0;
    agentLoopLog = [];
    agentLoopSummary = "";
    agentLoopFinalStatus = null;
    agentLoopResult = null;
    agentLoopConversationHistory = [];
    copilotAutoError = null;
    copiedInstructionNotice = "";
    validationFeedback = null;
    retryPrompt = "";
    clearScopeApproval();
    if (planningMode) {
      resetPlanExecutionState();
      delegationStore.startPlanning();
    }

    const abortController = new AbortController();
    agentLoopAbortController = abortController;

    try {
      const initialPrompt =
        initialPromptOverride ??
        (planningMode
          ? await buildPlanningInstruction()
          : copilotInstructionText);
      const result = await runAgentLoop(
        {
          sessionId,
          turnId,
          initialPrompt,
          maxTurns,
          loopTimeoutMs,
          abortSignal: abortController.signal,
          planningEnabled: planningMode,
          initialConversationHistory: agentLoopConversationHistory,
          projectContext: projectContextText || undefined,
          projectRootFolder: selectedProject?.rootFolder || undefined
        },
        {
          onBrowserProgress: handleBrowserProgress,
          onTurnStart: (turn) => {
            agentLoopTurn = turn;
            activeAgentLoopEntryId = pushAgentLoopLog(
              `copilot.turn.${turn}`,
              `Turn ${turn}: Copilot に送信`,
              "running"
            );
            if (uiMode === "delegation") {
              pushDelegationEvent("copilot_turn", `Copilot へ問い合わせています (turn ${turn})`);
            }
          },
          onCopilotResponse: (turn, response) => {
            agentLoopSummary = response.summary;
            if (activeAgentLoopEntryId) {
              updateAgentLoopLog(activeAgentLoopEntryId, {
                status: "done",
                endTime: Date.now(),
                detail: response.message ?? response.summary,
                rawResult: response
              });
              activeAgentLoopEntryId = null;
            } else {
              pushAgentLoopLog(
                `copilot.turn.${turn}`,
                `Turn ${turn}: Copilot が ${response.status} を返しました`,
                "done",
                {
                  detail: response.message ?? response.summary,
                  rawResult: response,
                  endTime: Date.now()
                }
              );
            }
            if (uiMode === "delegation") {
              pushDelegationEvent("copilot_turn", `Copilot が応答しました (turn ${turn})`, {
                detail: response.summary,
                expandable: false
              });
            }
          },
          onToolResults: (turn, toolResults) => {
            if (toolResults.length === 0) {
              pushAgentLoopLog(
                `turn.${turn}.tools`,
                `Turn ${turn}: 実行できる read ツールはありません`,
                "done",
                { endTime: Date.now() }
              );
              return;
            }

            for (const toolResult of toolResults) {
              pushAgentLoopLog(
                toolResult.tool,
                `Turn ${turn}: ${toolResult.tool}`,
                toolResult.ok ? "done" : "error",
                {
                  detail: summarizeToolResult(toolResult),
                  errorMessage: toolResult.error,
                  rawResult: toolResult.ok ? toolResult.result : { error: toolResult.error },
                  endTime: Date.now()
                }
              );
              if (uiMode === "delegation") {
                pushDelegationEvent("tool_executed", `Turn ${turn}: ${toolResult.tool}`, {
                  detail: summarizeToolResult(toolResult)
                });
              }
            }
          },
          onPlanProposed: (plan) => {
            agentLoopResult = null;
            planSteps = [...plan.steps];
            delegationStore.proposePlan(plan);
            if (uiMode === "delegation") {
              pushDelegationEvent("plan_proposed", "実行計画が提案されました。", {
                detail: plan.summary,
                actionRequired: true
              });
            }
          },
          onRetry: (turn, retryLevel, error, retryPromptText) => {
            pushAgentLoopLog(
              `copilot.retry.${turn}.${retryLevel}`,
              `Turn ${turn}: 再試行 ${retryLevel}`,
              "error",
              {
                detail: retryPromptText,
                errorMessage: error,
                endTime: Date.now()
              }
            );
            if (uiMode === "delegation") {
              pushDelegationEvent("error", `Copilot 応答の再試行 ${retryLevel}`, {
                detail: error,
                expandable: false
              });
            }
          },
          onManualFallback: (turn, fallbackPrompt, error) => {
            retryPrompt = fallbackPrompt;
            pushAgentLoopLog(
              `copilot.manual-fallback.${turn}`,
              `Turn ${turn}: 手動フォールバック`,
              "error",
              {
                detail: fallbackPrompt,
                errorMessage: error,
                endTime: Date.now()
              }
            );
            if (uiMode === "delegation") {
              pushDelegationEvent("error", "手動フォールバックが必要です。", {
                detail: `${error}\n\n${fallbackPrompt}`,
                expandable: true,
                actionRequired: true
              });
            }
          },
          onScopeWarning: ({ violations, rootFolder, tool, rawResponse, parsedResponse }) => {
            const firstViolation = violations[0] ?? "";
            copilotAutoError = `プロジェクトスコープ外のファイルアクセスが検出されました: ${firstViolation}`;
            openScopeApproval({
              source: "agent-loop",
              rootFolder,
              violations,
              responseSummary:
                parsedResponse.message ??
                parsedResponse.summary ??
                "Copilot がプロジェクトルート外へのファイル操作を提案しました。",
              rawResponse
            });
            pushAgentLoopLog(
              `project-scope.${tool}`,
              "プロジェクトスコープ外アクセスを停止",
              "error",
              {
                detail: `${tool}\n許可されたルート: ${rootFolder}\n${violations.join("\n")}`,
                errorMessage: copilotAutoError,
                endTime: Date.now()
              }
            );
            if (uiMode === "delegation") {
              delegationStore.requestApproval();
              pushDelegationEvent("write_approval_requested", "プロジェクト範囲外アクセスの承認が必要です。", {
                detail: `${tool}\n許可されたルート: ${rootFolder}\n${violations.join("\n")}`,
                expandable: true,
                actionRequired: true
              });
            }
          }
        }
      );

      agentLoopResult = result;
      agentLoopConversationHistory = result.conversationHistory;
      agentLoopSummary = result.summary;
      agentLoopFinalStatus = result.status === "cancelled" ? null : result.status;

      if (result.proposedPlan) {
        planSteps = [...result.proposedPlan.steps];
      }

      if (result.status === "awaiting_plan_approval") {
        guidedStage = "copilot";
        return;
      }

      if (result.finalResponse) {
        copilotResponse = JSON.stringify(result.finalResponse, null, 2);
        originalCopilotResponse = "";
        autoFixMessages = [];
      }

      if (result.status === "ready_to_write" && result.finalResponse) {
        await handleCopilotStage();
        return;
      }

      if (result.status === "error") {
        copilotAutoError = result.summary;
        delegationStore.setError(result.summary);
        if (uiMode === "delegation") {
          pushDelegationEvent("error", result.summary, { actionRequired: true });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        agentLoopSummary = "エージェントループをキャンセルしました。手動入力に切り替えられます。";
        if (activeAgentLoopEntryId) {
          updateAgentLoopLog(activeAgentLoopEntryId, {
            status: "error",
            endTime: Date.now(),
            detail: agentLoopSummary,
            errorMessage: agentLoopSummary
          });
          activeAgentLoopEntryId = null;
        } else {
          pushAgentLoopLog("agent-loop", "エージェントループをキャンセルしました", "error", {
            detail: agentLoopSummary,
            errorMessage: agentLoopSummary,
            endTime: Date.now()
          });
        }
        if (uiMode === "delegation") {
          delegationStore.setError(agentLoopSummary);
          pushDelegationEvent("error", agentLoopSummary, { actionRequired: true });
        }
      } else if (scopeApprovalVisible) {
        if (activeAgentLoopEntryId) {
          updateAgentLoopLog(activeAgentLoopEntryId, {
            status: "error",
            endTime: Date.now(),
            detail: "プロジェクト範囲外アクセスの承認待ちです。"
          });
          activeAgentLoopEntryId = null;
        }
      } else {
        console.error("[agent-loop] handleAgentLoopAutoSend error:", error);
        const friendlyMsg = getCopilotBrowserErrorMessage(error);
        const rawMsg = error instanceof Error ? error.message.trim() : String(error);
        copilotAutoError = rawMsg && rawMsg !== friendlyMsg
          ? `${friendlyMsg}\n[詳細: ${rawMsg}]`
          : friendlyMsg;
        if (activeAgentLoopEntryId) {
          updateAgentLoopLog(activeAgentLoopEntryId, {
            status: "error",
            endTime: Date.now(),
            detail: copilotAutoError,
            errorMessage: copilotAutoError
          });
          activeAgentLoopEntryId = null;
        }
        pushAgentLoopLog("agent-loop", "エージェントループが失敗しました", "error", {
          detail: copilotAutoError,
          errorMessage: copilotAutoError,
          endTime: Date.now()
        });
        if (uiMode === "delegation") {
          delegationStore.setError(copilotAutoError);
          pushDelegationEvent("error", copilotAutoError, { actionRequired: true });
        }
      }
    } finally {
      isSendingToCopilot = false;
      sendStatusMessage = "";
      agentLoopRunning = false;
      agentLoopAbortController = null;
    }
  }

  async function handleCopilotAutoSend(): Promise<void> {
    if (agentLoopEnabled) {
      await handleAgentLoopAutoSend();
      return;
    }

    await handleSingleShotCopilotAutoSend();
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
    step1Expanded = true;
    errorMsg = "";
    copilotAutoError = null;
    clearScopeApproval();
    resetAgentLoopState();
    resetPlanExecutionState();
    clearProgress();
  }

  function goToCopilot(): void {
    guidedStage = "copilot";
    step1Expanded = false;
    errorMsg = "";
    copilotAutoError = null;
    clearScopeApproval();
    resetAgentLoopState(false);
    resetPlanExecutionState(false);
    clearProgress();
  }

  function resetAll(): void {
    if (sessionId) {
      discardStudioDraft(sessionId);
    }
    discardDelegationDraft();
    delegationStore.reset();
    activityFeedStore.clear();

    guidedStage = "setup";
    busy = false;
    errorMsg = "";
    filePath = "";
    objectiveText = "";
    taskName = "";
    taskNameEdited = false;
    selectedTemplateKey = null;
    preflight = null;
    workbookProfile = null;
    workbookColumnProfiles = [];
    sessionId = "";
    turnId = "";
    relayPacket = null;
    relayPacketText = "";
    copilotInstructionText = "";
    expectedResponseTemplate = "";
    copiedInstructionNotice = "";
    copiedBrowserCommandNotice = "";
    copilotResponse = "";
    originalCopilotResponse = "";
    autoFixMessages = [];
    validationFeedback = null;
    retryPrompt = "";
    showInstructionPreview = false;
    isSendingToCopilot = false;
    copilotAutoError = null;
    clearScopeApproval();
    resetAgentLoopState();
    resetPlanExecutionState();
    clearPreviewState();
    resetTurnInspectionState();
    executionDone = false;
    executionSummary = "";
    clearProgress();
    loadExpertDetails();
    refreshContinuityState();
    lastSavedDraftSignature = "";
    step1Expanded = true;
    preparedSetupSignature = "";
    workflowStartedAt = null;
    completedAt = null;
  }

  async function handleSetupStage(): Promise<void> {
    errorMsg = "";
    copiedInstructionNotice = "";
    copiedBrowserCommandNotice = "";
    copilotAutoError = null;
    validationFeedback = null;
    retryPrompt = "";
    workflowStartedAt = Date.now();
    completedAt = null;
    busy = true;
    setProgress([
      "ファイルの状態を確認しています",
      "列情報を読み取っています",
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
      if (selectedProject && !isWithinProjectScope(path, selectedProject.rootFolder)) {
        failCurrentProgress("選択したファイルはプロジェクトのルート外です。");
        errorMsg = `選択したファイルはプロジェクトルート外です: ${selectedProject.rootFolder}`;
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

      await refreshWorkbookContext(path);
      markProgress(1, "done");

      const session = await createSession({
        title,
        objective: objectiveText,
        primaryWorkbookPath: path
      });
      if (selectedProjectId) {
        await linkSessionToProject({
          projectId: selectedProjectId,
          sessionId: session.id
        });
        await refreshProjects();
        projectInfoMsg = "新しいセッションを現在のプロジェクトに紐付けました。";
      }
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
      markProgress(2, "done");

      const turnResponse = await startTurn({
        sessionId: session.id,
        title,
        objective: objectiveText,
        mode: "plan"
      });
      turnId = turnResponse.turn.id;
      markProgress(3, "done");

      const packet = await generateRelayPacket({
        sessionId: session.id,
        turnId: turnResponse.turn.id
      });
      relayPacket = packet;
      relayPacketText = JSON.stringify(packet, null, 2);
      preparedSetupSignature = buildSetupSignature(
        path,
        title,
        objectiveText,
        selectedTemplateKey
      );
      markProgress(4, "done");
      guidedStage = "copilot";
      step1Expanded = false;
      requestTurnInspectionRefresh();
    } catch (error) {
      const failure = toError(error);
      failCurrentProgress(failure);
      errorMsg = failure;
    } finally {
      requestTurnInspectionRefresh();
      requestProjectApprovalAuditRefresh();
      busy = false;
    }
  }

  async function handleCopilotStage(options: { allowScopeOverride?: boolean } = {}): Promise<void> {
    errorMsg = "";
    copiedInstructionNotice = "";
    copilotAutoError = null;
    validationFeedback = null;
    retryPrompt = "";
    clearPreviewState();
    if (!options.allowScopeOverride) {
      clearScopeApproval();
    }
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
      if (submitResult.autoLearnedMemory.length > 0) {
        await refreshProjects();
        projectInfoMsg = `プロジェクト設定を自動学習しました: ${submitResult.autoLearnedMemory
          .map((entry) => entry.key)
          .join("、")}`;
        if (uiMode === "delegation") {
          pushDelegationEvent("tool_executed", "プロジェクト設定を自動学習しました。", {
            detail: submitResult.autoLearnedMemory
              .map((entry) => `${entry.key}: ${entry.value}`)
              .join("\n")
          });
        }
      }

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

      const scopeViolations = validateProjectScopeActions(
        (submitResult.parsedResponse?.actions ?? []) as Array<{
          tool: string;
          args: Record<string, unknown>;
        }>,
        selectedProject?.rootFolder ?? ""
      );
      if (scopeViolations.length > 0 && !options.allowScopeOverride) {
        const firstViolation = scopeViolations[0];
        const message = `プロジェクトスコープ外のファイルアクセスが含まれています: ${firstViolation}`;
        markProgress(2, "error", message);
        errorMsg = message;
        openScopeApproval({
          source: "manual",
          rootFolder: selectedProject?.rootFolder ?? "",
          violations: scopeViolations,
          responseSummary:
            submitResult.parsedResponse?.message ??
            submitResult.parsedResponse?.summary ??
            "Copilot がプロジェクトルート外へのファイル操作を提案しました。",
          rawResponse: fixResult.fixed
        });
        if (uiMode === "delegation") {
          delegationStore.requestApproval();
          pushDelegationEvent("write_approval_requested", "プロジェクト範囲外アクセスの承認が必要です。", {
            detail: `許可ルート: ${selectedProject?.rootFolder ?? "未設定"}\n${scopeViolations.join("\n")}`,
            expandable: true,
            actionRequired: true
          });
        }
        return;
      }

      const preview = await previewExecution({ sessionId, turnId });
      const diff = preview.diffSummary;
      previewSummary =
        submitResult.parsedResponse?.summary ??
        diff.sheets[0]?.target.label ??
        `${diff.targetCount} 件の変更を確認できます。`;
      previewTargetCount = diff.targetCount;
      previewAffectedRows = diff.estimatedAffectedRows;
      previewOutputPath = diff.outputPath;
      previewWarnings = [
        ...(scopeViolations.length > 0
          ? [`プロジェクト範囲外アクセスを承認しました: ${scopeViolations.join(" / ")}`]
          : []),
        ...diff.warnings,
        ...preview.warnings
      ];
      previewSheetDiffs = diff.sheets;
      previewFileWriteActions = preview.fileWriteActions as FileWritePreviewAction[];
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
      if (uiMode === "delegation") {
        delegationStore.requestApproval();
        pushDelegationEvent("write_approval_requested", "保存前の確認が必要です。", {
          detail: previewSummary,
          actionRequired: true
        });
      }
    } catch (error) {
      const failure = toError(error);
      failCurrentProgress(failure);
      errorMsg = failure;
    } finally {
      requestTurnInspectionRefresh();
      requestProjectApprovalAuditRefresh();
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
      if (uiMode === "delegation") {
        delegationStore.resumeExecution();
        pushDelegationEvent("write_approved", "書き込みを承認しました。");
      }

      const result = await runExecution({ sessionId, turnId });
      if (result.outputPath) {
        previewOutputPath = result.outputPath;
      }

      executionSummary = result.executed
        ? result.outputPath
          ? `保存しました: ${result.outputPath}`
          : previewFileWriteActions.length > 0
            ? "承認したファイル操作を実行しました。"
            : "保存しました。"
        : result.reason || "保存できませんでした";

      markProgress(
        1,
        result.executed ? "done" : "error",
        result.executed ? executionSummary : result.reason
      );

      if (!result.executed) {
        if (currentPlanStepId) {
          updatePlanStepState(currentPlanStepId, {
            state: "failed",
            error: executionSummary
          });
          await persistPlanProgressSnapshot();
        }
        errorMsg = executionSummary;
        return;
      }

      if (currentPlanStepId) {
        updatePlanStepState(currentPlanStepId, { state: "completed" });
        currentPlanStepId = null;
        await persistPlanProgressSnapshot();
      }

      if (pendingPlan?.steps.length) {
        executionSummary = "保存が完了したため、残りのステップを続けます。";
        await executeApprovedPlan(pendingPlan, { resetProgress: false });
        return;
      }

      executionDone = true;
      completedAt = Date.now();
      if (uiMode === "delegation") {
        delegationStore.complete();
        pushDelegationEvent("completed", "保存と自律実行が完了しました。", {
          detail: executionSummary
        });
      }
    } catch (error) {
      const failure = toError(error);
      failCurrentProgress(failure);
      if (currentPlanStepId) {
        updatePlanStepState(currentPlanStepId, {
          state: "failed",
          error: failure
        });
        await persistPlanProgressSnapshot();
      }
      errorMsg = failure;
    } finally {
      requestTurnInspectionRefresh();
      requestProjectApprovalAuditRefresh();
      busy = false;
    }
  }

  async function handleApproveScopeOverride(): Promise<void> {
    if (!scopeApprovalVisible) {
      return;
    }

    if (currentPlanStepId) {
      pendingPlan = getRemainingPlanAfterCurrentStep();
    }

    if (uiMode === "delegation") {
      pushDelegationEvent("write_approved", "プロジェクト範囲外アクセスを承認しました。");
    }

    try {
      await recordScopeApproval({
        sessionId,
        turnId,
        decision: "approved",
        rootFolder: scopeApprovalRootFolder,
        violations: scopeApprovalViolations,
        source: scopeApprovalSource ?? "manual",
        note: scopeApprovalSummary.trim() || undefined
      });
    } catch (error) {
      const failure = toError(error);
      errorMsg = failure;
      copilotAutoError = failure;
      return;
    }

    errorMsg = "";
    copilotAutoError = null;
    clearScopeApproval();
    requestTurnInspectionRefresh();
    requestProjectApprovalAuditRefresh();
    await handleCopilotStage({ allowScopeOverride: true });
  }

  function handleBackFromScopeApproval(): void {
    errorMsg = "";
    copilotAutoError = null;
    clearScopeApproval();
    guidedStage = "copilot";
    step1Expanded = false;
    if (uiMode === "delegation") {
      pushDelegationEvent("error", "プロジェクト範囲外アクセスの承認を保留しました。", {
        actionRequired: true
      });
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

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (uiMode !== "delegation") {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      handleCancelPlan();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (agentLoopResult?.status === "awaiting_plan_approval" && planSteps.length > 0) {
        void handleApprovePlan();
        return;
      }

      if (scopeApprovalVisible) {
        void handleApproveScopeOverride();
        return;
      }

      if (guidedStage === "review-save" && reviewStepAvailable) {
        void handleReviewSaveStage();
      }
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleGlobalKeydown);

    void (async () => {
      loadExpertDetails();
      showWelcome = !hasSeenWelcome();
      uiMode = loadUiMode();
      selectedProjectId = loadSelectedProjectId();
      const browserAutomationSettings = loadBrowserAutomationSettings();
      cdpPort = browserAutomationSettings.cdpPort;
      autoLaunchEdge = browserAutomationSettings.autoLaunchEdge;
      timeoutMs = browserAutomationSettings.timeoutMs;
      agentLoopEnabled = browserAutomationSettings.agentLoopEnabled;
      maxTurns = browserAutomationSettings.maxTurns;
      loopTimeoutMs = browserAutomationSettings.loopTimeoutMs;
      planningEnabled = browserAutomationSettings.planningEnabled;
      autoApproveReadSteps = browserAutomationSettings.autoApproveReadSteps;
      pauseBetweenSteps = browserAutomationSettings.pauseBetweenSteps;

      try {
        await pingDesktop();
        const app = await initializeApp();
        startupIssue = app.startupIssue ?? null;
        storagePath = app.storagePath ?? null;
        sampleWorkbookPath = app.sampleWorkbookPath ?? null;
        await refreshProjects();
        await refreshSessions();
      } catch (error) {
        errorMsg = toError(error);
      }

      refreshContinuityState();

      const delegationDraft = loadDelegationDraft();
      if (uiMode === "delegation" && delegationDraft) {
        delegationStore.hydrate({
          state: delegationDraft.delegationState,
          goal: delegationDraft.goal,
          attachedFiles: delegationDraft.attachedFiles,
          plan: delegationDraft.planSnapshot,
          currentStepIndex: delegationDraft.currentStepIndex
        });
        activityFeedStore.hydrate(delegationDraft.activityFeedSnapshot);
        agentLoopConversationHistory = delegationDraft.conversationHistorySnapshot;
        if (delegationDraft.attachedFiles[0]) {
          filePath = delegationDraft.attachedFiles[0];
        }
        if (delegationDraft.goal) {
          updateObjective(delegationDraft.goal);
        }
      }
    })();

    return () => {
      window.removeEventListener("keydown", handleGlobalKeydown);
    };
  });

  $: expectedResponseTemplate = buildExpectedResponseTemplate(suggestOutputPath(filePath));
  $: selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? null;
  $: linkedProjectSessions = selectedProject
    ? selectedProject.sessionIds
        .map((sessionId) => allSessions.find((session) => session.id === sessionId))
        .filter((session): session is Session => Boolean(session))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          workbookPath: session.primaryWorkbookPath ?? null,
          assignedProjectName: selectedProject.name
        }))
    : [];
  $: availableProjectSessions = selectedProject
    ? allSessions
        .filter((session) => !selectedProject.sessionIds.includes(session.id))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          workbookPath: session.primaryWorkbookPath ?? null,
          assignedProjectName: findAssignedProjectName(session.id)
        }))
    : [];
  $: filteredLinkedProjectSessions = linkedProjectSessions.filter((session) =>
    matchesProjectSessionQuery(session, projectSessionQuery)
  );
  $: filteredAvailableProjectSessions = availableProjectSessions.filter((session) =>
    matchesProjectSessionQuery(session, projectSessionQuery)
  );
  $: filteredProjectApprovalAuditRows = projectApprovalAuditRows.filter((row) =>
    matchesProjectApprovalAuditQuery(row, projectSessionQuery)
  );
  $: projectContextText = selectedProject
    ? buildProjectContext(
        selectedProject.customInstructions,
        selectedProject.memory.map((entry) => ({ key: entry.key, value: entry.value }))
      )
    : "";
  $: {
    const nextAuditRequestKey = JSON.stringify({
      projectId: selectedProjectId,
      sessionIds: linkedProjectSessions.map((session) => session.id),
      refreshNonce: projectApprovalAuditRefreshNonce
    });
    if (nextAuditRequestKey !== projectApprovalAuditRequestKey) {
      projectApprovalAuditRequestKey = nextAuditRequestKey;
      void refreshProjectApprovalAudit();
    }
  }
  $: if (uiMode === "delegation") {
    persistDelegationDraft();
  }
  $: currentSetupSignature = buildSetupSignature(
    filePath,
    taskName.trim() || deriveTitle(objectiveText),
    objectiveText,
    selectedTemplateKey
  );
  $: setupStepComplete = Boolean(
    sessionId &&
      turnId &&
      relayPacket &&
      preparedSetupSignature &&
      preparedSetupSignature === currentSetupSignature
  );
  $: copilotStepAvailable = setupStepComplete;
  $: reviewStepAvailable = Boolean(
    setupStepComplete &&
      (previewSummary.trim() ||
        previewSheetDiffs.length > 0 ||
        previewOutputPath.trim() ||
        executionDone)
  );
  $: scopeApprovalArtifacts = turnInspectionArtifacts.filter(
    (
      artifact: ReadTurnArtifactsResponse["artifacts"][number]
    ): artifact is ScopeApprovalArtifactRecord => artifact.artifactType === "scope-approval"
  );
  $: if (expertDetailsOpen && sessionId && turnId && turnInspectionRefreshNonce >= 0) {
    void refreshTurnInspection();
  }

  $: copilotInstructionText =
    relayPacket && filePath.trim()
      ? buildCopilotInstructionText(
          relayPacket,
          filePath,
          taskName.trim() || deriveTitle(objectiveText),
          workbookProfile,
          workbookColumnProfiles,
          selectedTemplateKey,
          projectContextText
        )
      : "";

  $: if (sessionId && !hydratingDraft) {
    const previewSnapshotBase = previewOutputPath
      ? {
          sourcePath: filePath,
          outputPath: previewOutputPath,
          targetCount: previewTargetCount,
          estimatedAffectedRows: previewAffectedRows,
          warnings: previewWarnings,
          requiresApproval: previewRequiresApproval,
          fileWriteActions: previewFileWriteActions
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
      approvalSummary: scopeApprovalVisible
        ? "プロジェクト範囲外アクセスの承認が必要です"
        : previewRequiresApproval
          ? "保存前確認が必要です"
          : "",
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

{#if showWelcome}
  <div class="welcome-overlay">
    <div class="welcome-card">
      <div class="welcome-logo">🤖</div>
      <h1 class="welcome-title">Relay Agent</h1>
      <p class="welcome-subtitle">
        Copilot があなたの代わりに、<br />表計算を自動化します
      </p>
      <div class="welcome-steps">
        <div class="welcome-step">
          <span class="welcome-step-icon">📁</span>
          <span class="welcome-step-label">ファイルを選ぶ</span>
        </div>
        <div class="welcome-step-arrow">→</div>
        <div class="welcome-step">
          <span class="welcome-step-icon">🤖</span>
          <span class="welcome-step-label">Copilot が処理</span>
        </div>
        <div class="welcome-step-arrow">→</div>
        <div class="welcome-step">
          <span class="welcome-step-icon">✅</span>
          <span class="welcome-step-label">確認して保存</span>
        </div>
      </div>
      <button class="welcome-btn" type="button" on:click={startFromWelcome}>
        始める →
      </button>
    </div>
  </div>
{/if}

<header class="header">
  <div class="header-left">
    <span class="header-icon">📋</span>
    <span class="header-title">Relay Agent</span>
  </div>
  <div class="header-actions">
    <div class="mode-toggle-group" role="tablist" aria-label="ui mode">
      <button
        class="mode-toggle-btn"
        class:mode-toggle-active={uiMode === "delegation"}
        type="button"
        on:click={() => setUiMode("delegation")}
      >
        Delegation
      </button>
      <button
        class="mode-toggle-btn"
        class:mode-toggle-active={uiMode === "manual"}
        type="button"
        on:click={() => setUiMode("manual")}
      >
        Manual
      </button>
    </div>
    <button
      class="header-settings"
      type="button"
      on:click={() => (settingsOpen = !settingsOpen)}
      aria-label="設定を開く"
    >⚙</button>
  </div>
</header>

<section class="project-strip card">
  <ProjectSelector
    {projects}
    {selectedProjectId}
    linkedSessions={linkedProjectSessions}
    filteredLinkedSessions={filteredLinkedProjectSessions}
    filteredAvailableSessions={filteredAvailableProjectSessions}
    sessionQuery={projectSessionQuery}
    {sessionToAssignId}
    creating={creatingProject}
    createName={newProjectName}
    createRootFolder={newProjectRootFolder}
    createInstructions={newProjectInstructions}
    memoryKey={memoryDraftKey}
    memoryValue={memoryDraftValue}
    errorMessage={projectErrorMsg}
    infoMessage={projectInfoMsg}
    onSelect={(projectId) => {
      selectedProjectId = saveSelectedProjectId(projectId);
      projectErrorMsg = "";
      projectInfoMsg = "";
      projectSessionQuery = "";
      sessionToAssignId = "";
    }}
    onToggleCreate={() => {
      creatingProject = !creatingProject;
      projectErrorMsg = "";
      projectInfoMsg = "";
    }}
    onCreateNameInput={(value) => (newProjectName = value)}
    onCreateRootFolderInput={(value) => (newProjectRootFolder = value)}
    onCreateInstructionsInput={(value) => (newProjectInstructions = value)}
    onCreateProject={handleCreateProject}
    onMemoryKeyInput={(value) => (memoryDraftKey = value)}
    onMemoryValueInput={(value) => (memoryDraftValue = value)}
    onAddMemory={handleAddProjectMemory}
    onRemoveMemory={handleRemoveProjectMemory}
    onSessionQueryInput={(value) => (projectSessionQuery = value)}
    onSessionToAssignInput={(value) => (sessionToAssignId = value)}
    onAssignSession={handleAssignSessionToProject}
    onDetachSession={handleDetachSessionFromProject}
    onAssignFilteredSessions={handleAssignFilteredSessions}
    onDetachFilteredSessions={handleDetachFilteredSessions}
    onOpenSession={openProjectSession}
  />

  {#if selectedProject}
    <div class="project-audit-card">
      <div class="project-audit-header">
        <div>
          <h3 class="project-audit-title">横断承認レポート</h3>
          <p class="project-audit-copy">
            選択中プロジェクトに紐付く各セッションの最新 turn から、保存前承認と project scope override を横断表示します。
          </p>
        </div>
        <button class="btn btn-secondary" type="button" on:click={requestProjectApprovalAuditRefresh}>
          再読込
        </button>
      </div>

      {#if projectApprovalAuditLoading}
        <p class="project-audit-copy">レポートを読み込んでいます…</p>
      {:else if projectApprovalAuditError}
        <p class="field-warn">⚠ {projectApprovalAuditError}</p>
      {:else if filteredProjectApprovalAuditRows.length === 0}
        <p class="project-audit-copy">
          {projectSessionQuery.trim()
            ? "現在の検索条件に一致する承認履歴はありません。"
            : "承認レポートの対象になる turn がまだありません。"}
        </p>
      {:else}
        <div class="project-audit-grid">
          {#each filteredProjectApprovalAuditRows as row}
            <article class="project-audit-row">
              <div class="project-audit-topline">
                <div>
                  <strong>{row.sessionTitle}</strong>
                  <p class="project-audit-copy">{row.turnTitle}</p>
                </div>
                <div class="project-audit-badges">
                  <span class="project-audit-badge" data-tone={row.writeApprovalDecision}>
                    保存前承認: {formatWriteApprovalStatus(row.writeApprovalDecision)}
                  </span>
                  <span class="project-audit-badge" data-tone={row.latestScopeDecision ?? "none"}>
                    scope override: {row.scopeOverrideCount === 0 ? "なし" : formatApprovalDecision(row.latestScopeDecision ?? undefined)}
                  </span>
                </div>
              </div>
              <p class="project-audit-copy">status: {row.turnStatus}</p>
              <p class="project-audit-copy">更新: {formatAuditTime(row.turnUpdatedAt ?? undefined)}</p>
              {#if row.workbookPath}
                <p class="project-audit-copy">file: {row.workbookPath}</p>
              {/if}
              <p class="project-audit-copy">{row.approvalSummary}</p>
              <p class="project-audit-copy">
                scope override 件数: {row.scopeOverrideCount}
                {#if row.latestScopeAt}
                  / 最新: {formatAuditTime(row.latestScopeAt)}
                {/if}
              </p>
              {#if row.latestScopeSource}
                <p class="project-audit-copy">
                  最新 source: {formatScopeApprovalSource(row.latestScopeSource)}
                </p>
              {/if}
              {#if row.outputPath}
                <p class="project-audit-copy">output: {row.outputPath}</p>
              {/if}
              <div class="project-audit-actions">
                <button class="btn btn-secondary" type="button" on:click={() => openProjectSession(row.sessionId)}>
                  セッションを開く
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</section>

{#if uiMode === "delegation"}
  <section class="delegation-shell">
    <aside class="delegation-sidebar card">
      <RecentSessions
        recentSessions={recentSessions}
        {showRecent}
        hasRecoverableDraft={hasRecoverableDraft}
        onToggle={() => (showRecent = !showRecent)}
        onSelect={handleRecentSessionSelectById}
      />
      <div class="delegation-sidebar-note">
        <h3>最近のファイル</h3>
        {#if recentFiles.length === 0}
          <p>まだ履歴がありません。</p>
        {:else}
          {#each recentFiles.slice(0, 4) as file}
            <p>{file.path.split(/[\\/]/).pop()}</p>
          {/each}
        {/if}
      </div>
    </aside>

    <section class="delegation-main card">
      {#if executionDone && $activityFeedStore.length > 0}
        <CompletionTimeline
          events={$activityFeedStore}
          summary={executionSummary || previewSummary}
          outputPath={previewOutputPath}
          onOpenOutput={openOutputFile}
          onReset={resetAll}
        />
      {:else}
        <ActivityFeed events={$activityFeedStore} />
      {/if}
    </section>

    <div class="delegation-intervention">
      <InterventionPanel
        statusLabel={$delegationStore.state}
        planReviewVisible={agentLoopResult?.status === "awaiting_plan_approval" && planSteps.length > 0}
        {planSteps}
        planSummary={agentLoopResult?.proposedPlan?.summary || agentLoopSummary}
        {showReplanFeedback}
        {replanFeedback}
        {scopeApprovalVisible}
        scopeApprovalSummary={scopeApprovalSummary}
        scopeApprovalRootFolder={scopeApprovalRootFolder}
        scopeApprovalViolations={scopeApprovalViolations}
        writeApprovalVisible={guidedStage === "review-save" && reviewStepAvailable && !executionDone}
        {previewSummary}
        {previewAffectedRows}
        {previewOutputPath}
        {previewWarnings}
        {previewSheetDiffs}
        fileWriteActions={previewFileWriteActions}
        {reviewStepAvailable}
        {busy}
        errorMessage={scopeApprovalVisible ? "" : copilotAutoError || ($delegationStore.state === "error" ? $delegationStore.error ?? "" : "")}
        onApprovePlan={handleApprovePlan}
        onCancelPlan={handleCancelPlan}
        onToggleReplan={() => (showReplanFeedback = !showReplanFeedback)}
        onReplan={handleReplan}
        onMoveStep={movePlanStep}
        onRemoveStep={removePlanStep}
        onReplanFeedbackInput={(value) => (replanFeedback = value)}
        onBackFromScopeApproval={handleBackFromScopeApproval}
        onApproveScopeOverride={handleApproveScopeOverride}
        onBackFromApproval={() => {
          guidedStage = "copilot";
        }}
        onApproveWrite={handleReviewSaveStage}
        onRetry={retryCurrentStage}
      />
    </div>
  </section>

  <div class="delegation-composer-wrap">
    <ChatComposer
      recentFiles={recentFiles}
      suggestions={delegationSuggestions}
      disabled={busy || isSendingToCopilot}
      initialGoal={$delegationStore.goal}
      initialFiles={$delegationStore.attachedFiles}
      on:submit={handleDelegationSubmit}
    />
  </div>
{:else}

<RecentSessions
  recentSessions={recentSessions}
  {showRecent}
  visible={guidedStage === "setup" && !executionDone}
  hasRecoverableDraft={hasRecoverableDraft}
  onToggle={() => (showRecent = !showRecent)}
  onSelect={handleRecentSessionSelectById}
/>

<section class="step-progress-bar" aria-label="guided workflow">
  <div class="step-progress-row">
    {#each [
      { num: 1, icon: "📁", label: "ファイル選択" },
      { num: 2, icon: "🤖", label: "Copilot 処理" },
      { num: 3, icon: "✅", label: "確認・保存" }
    ] as step, index}
      <div
        class="step-node"
        class:current={currentStepNumber() === step.num}
        class:completed={currentStepNumber() > step.num}
      >
        <div class="step-circle">
          {#if currentStepNumber() > step.num}
            <span class="step-check">✓</span>
          {:else}
            <span class="step-icon">{step.icon}</span>
          {/if}
        </div>
        <span class="step-node-label">{step.label}</span>
      </div>
      {#if index < 2}
        <div class="step-connector" class:filled={currentStepNumber() > step.num}></div>
      {/if}
    {/each}
  </div>
  <p class="step-description">
    {stepBanner.find((step) => step.id === guidedStage)?.description}
  </p>
  <input
    bind:this={hiddenFilePicker}
    type="file"
    accept=".csv,.xlsx,.xlsm,.xls"
    class="hidden-file-input"
    on:change={handleFilePickerChange}
  />
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

<section class="card step-panel">
  <GoalInput
    {busy}
    {filePath}
    {sampleWorkbookPath}
    preflightWarning={preflight?.status === "warning" ? preflight.summary : ""}
    {objectiveText}
    templates={templates}
    objectivePresets={[...objectivePresets]}
    {taskName}
    {setupStepComplete}
    stepExpanded={step1Expanded}
    progressItems={guidedStage === "setup" ? progressItems : []}
    errorMessage={errorMsg && guidedStage === "setup" ? getFriendlyError(errorMsg).message : ""}
    errorHint={errorMsg && guidedStage === "setup" ? getFriendlyError(errorMsg).hint ?? "" : ""}
    onEdit={goToSetup}
    onOpenFilePicker={openFilePicker}
    onFileDrop={handleDrop}
    onFileDragOver={() => {
      isDragOver = true;
    }}
    onFileDragLeave={() => {
      isDragOver = false;
    }}
    onObjectiveChange={(value, templateKey) =>
      updateObjective(value, (templateKey as TemplateKey | null | undefined) ?? inferTemplateKey(value))}
    onTaskNameChange={handleTaskNameInput}
    onFilePathChange={(value) => {
      filePath = value;
    }}
    onStart={handleSetupStage}
    {isDragOver}
  />
</section>

<section
  class="card step-panel"
  role="group"
  aria-disabled={!copilotStepAvailable}
  data-disabled={!copilotStepAvailable}
>
  <div class="step-panel-header">
    <h2 class="panel-title">2. Copilot に聞く</h2>
  </div>

  {#if !copilotStepAvailable}
    <p class="step-panel-note">ステップ 1 を完了すると、ここで依頼文をコピーして Copilot の返答を確認できます。</p>
  {/if}

  <div class="step-summary">
    <span class="step-summary-label">タスク名:</span> {taskName || "未設定"}
    <br />
    <span class="step-summary-label">ファイル:</span> {filePath || "未設定"}
    <br />
    <span class="step-summary-label">やりたいこと:</span> {objectiveText || "未設定"}
  </div>

  <p class="instruction-text">
    下のボタンで Copilot に渡す依頼をコピーしてください。返ってきた JSON をそのまま下の欄に貼り付けるだけで、保存前の確認まで進めます。
  </p>

  <div class="loop-toggle-row">
    <label class="checkbox-row" for="agent-loop-enabled">
      <input
        id="agent-loop-enabled"
        type="checkbox"
        bind:checked={agentLoopEnabled}
        disabled={busy || isSendingToCopilot}
        on:change={persistBrowserAutomationSettings}
      />
      <span>エージェントループモード</span>
    </label>
    {#if agentLoopEnabled}
      <span class="loop-settings-summary">
        最大 {maxTurns} ターン / タイムアウト {Math.round(loopTimeoutMs / 1000)} 秒 / {planningEnabled ? "計画あり" : "直接実行"}
      </span>
    {/if}
  </div>

  <div class="copy-row">
    <button
      class="btn btn-accent"
      type="button"
      on:click={copyCopilotInstruction}
      disabled={busy || isSendingToCopilot || !copilotStepAvailable}
    >
      依頼をコピー
    </button>
    <button
      class="btn btn-secondary"
      type="button"
      on:click={handleCopilotAutoSend}
      disabled={busy || isSendingToCopilot || !copilotStepAvailable}
    >
      {#if isSendingToCopilot}
        {agentLoopEnabled ? `Turn ${agentLoopTurn || 1} を実行しています…` : "送信しています…"}
      {:else}
        {agentLoopEnabled ? "Copilotで自動ループ開始 ▶" : "Copilotに自動送信 ▶"}
      {/if}
    </button>
    {#if agentLoopRunning}
      <button class="btn btn-secondary" type="button" on:click={cancelAgentLoop}>
        キャンセル
      </button>
    {/if}
    <button
      class="btn-link"
      type="button"
      on:click={() => (showInstructionPreview = !showInstructionPreview)}
      disabled={!copilotStepAvailable}
    >
      {showInstructionPreview ? "依頼文を閉じる" : "依頼文を見る"}
    </button>
  </div>

  {#if isSendingToCopilot}
    <div class="send-status" aria-live="polite">
      <span class="spinner send-status-spinner">⟳</span>
      <span class="send-status-text">{sendStatusMessage || "Copilot に送信中…"}</span>
    </div>
  {/if}

  {#if copiedInstructionNotice}
    <p class="field-success">{copiedInstructionNotice}</p>
  {/if}

  <AgentActivityFeed
    visible={agentLoopEnabled}
    {agentLoopEnabled}
    {agentLoopTurn}
    {maxTurns}
    entries={agentLoopLog}
    summary={agentLoopSummary}
    finalStatus={agentLoopFinalStatus}
    onToggleDetail={toggleAgentLoopDetail}
  />

  {#if agentLoopResult?.status === "awaiting_plan_approval" && planSteps.length > 0}
    <div class="plan-review-panel">
      <div class="plan-review-header">
        <div>
          <h3 class="plan-review-title">実行計画の確認</h3>
          <p class="plan-review-summary">
            {agentLoopResult.proposedPlan?.summary || agentLoopSummary}
          </p>
        </div>
      </div>

      <div class="plan-step-list">
        {#each planSteps as step, index (step.id)}
          <article class="plan-step-card" data-phase={step.phase}>
            <div class="plan-step-index">{index + 1}</div>
            <div class="plan-step-body">
              <div class="plan-step-topline">
                <span class="plan-step-phase">{step.phase === "read" ? "read" : "write"}</span>
                <span class="plan-step-tool">{step.tool}</span>
              </div>
              <p class="plan-step-description">{step.description}</p>
              {#if step.estimatedEffect}
                <p class="plan-step-effect">{step.estimatedEffect}</p>
              {/if}
            </div>
            <div class="plan-step-actions">
              <button
                class="btn btn-secondary"
                type="button"
                on:click={() => movePlanStep(index, -1)}
                disabled={index === 0 || isSendingToCopilot || busy}
              >
                ↑
              </button>
              <button
                class="btn btn-secondary"
                type="button"
                on:click={() => movePlanStep(index, 1)}
                disabled={index === planSteps.length - 1 || isSendingToCopilot || busy}
              >
                ↓
              </button>
              <button
                class="plan-step-remove"
                type="button"
                on:click={() => removePlanStep(index)}
                disabled={isSendingToCopilot || busy}
              >
                削除
              </button>
            </div>
          </article>
        {/each}
      </div>

      <div class="btn-row">
        <button
          class="btn btn-primary"
          type="button"
          on:click={handleApprovePlan}
          disabled={busy || isSendingToCopilot || planSteps.length === 0}
        >
          計画を承認して実行する
        </button>
        <button
          class="btn btn-secondary"
          type="button"
          on:click={() => (showReplanFeedback = !showReplanFeedback)}
          disabled={busy || isSendingToCopilot}
        >
          再計画する
        </button>
        <button
          class="btn btn-secondary"
          type="button"
          on:click={handleCancelPlan}
          disabled={busy || isSendingToCopilot}
        >
          キャンセル
        </button>
      </div>

      {#if showReplanFeedback}
        <label class="field-label" for="replan-feedback">再計画フィードバック</label>
        <textarea
          id="replan-feedback"
          class="textarea"
          bind:value={replanFeedback}
          rows="4"
          placeholder="例: 先に列名を確認してください / ステップを減らしてください"
        ></textarea>
        <div class="btn-row">
          <button
            class="btn btn-secondary"
            type="button"
            on:click={handleReplan}
            disabled={busy || isSendingToCopilot}
          >
            フィードバック付きで再計画
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if executionStepStatuses.length > 0}
    <div class="plan-progress-panel">
      <div class="plan-progress-header">
        <div>
          <strong>自律実行の進行状況</strong>
          <div class="plan-progress-summary">
            {executionStepStatuses.filter((step) => step.state === "completed").length} / {executionStepStatuses.length} 完了
            {#if currentPlanStepId}
              ・ 現在: {executionStepStatuses.find((step) => step.id === currentPlanStepId)?.description}
            {/if}
          </div>
        </div>
        <div class="plan-progress-actions">
          {#if isPlanPaused}
            <button class="btn btn-secondary" type="button" on:click={resumePlanExecution}>
              再開
            </button>
          {:else}
            <button
              class="btn btn-secondary"
              type="button"
              on:click={requestPlanPause}
              disabled={!isPlanExecuting}
            >
              一時停止
            </button>
          {/if}
          <button
            class="btn btn-secondary"
            type="button"
            on:click={handleCancelPlan}
            disabled={!isPlanExecuting && !isPlanPaused}
          >
            キャンセル
          </button>
        </div>
      </div>

      {#if planPauseReason}
        <p class="plan-progress-note">{planPauseReason}</p>
      {/if}

      <div class="plan-progress-list">
        {#each executionStepStatuses as step (step.id)}
          <article class="plan-progress-step" data-state={step.state} data-phase={step.phase}>
            <div class="plan-progress-mark">
              {#if step.state === "completed"}
                ✓
              {:else if step.state === "running"}
                …
              {:else if step.state === "failed"}
                ✗
              {:else}
                ○
              {/if}
            </div>
            <div class="plan-progress-body">
              <div class="plan-progress-topline">
                <span>{step.description}</span>
                <span class="plan-progress-phase">{step.phase}</span>
              </div>
              <div class="plan-progress-tool">{step.tool}</div>
              {#if step.error}
                <div class="timeline-error-msg">{step.error}</div>
              {:else if step.phase === "write" && currentPlanStepId === step.id && guidedStage === "review-save"}
                <div class="progress-message">書き込み内容の確認待ちです。</div>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    </div>
  {/if}

  {#if copilotAutoError && !scopeApprovalVisible}
    {@const fe = getFriendlyError(copilotAutoError)}
    <div class="friendly-error">
      <span class="fe-icon">{fe.icon}</span>
      <div class="fe-body">
        <div class="fe-message">{fe.message}</div>
        {#if fe.hint}
          <div class="fe-hint">{fe.hint}</div>
        {/if}
      </div>
    </div>
    <button class="btn-link inline-link" type="button" on:click={focusCopilotResponseField}>
      手動入力に切り替え
    </button>
  {/if}

  {#if scopeApprovalVisible}
    <div class="validation-card scope-approval-card" data-level="2">
      <p class="validation-kicker">追加承認</p>
      <h3>プロジェクト範囲外アクセスの承認</h3>
      <p class="validation-detail">
        {scopeApprovalSource === "agent-loop"
          ? "自律実行がプロジェクト範囲外のファイル操作を提案しました。"
          : "貼り付けた Copilot 回答がプロジェクト範囲外のファイル操作を含んでいます。"}
      </p>
      <p>{scopeApprovalSummary}</p>
      <p class="validation-specific">許可ルート: {scopeApprovalRootFolder}</p>
      {#each scopeApprovalViolations as violation}
        <p class="validation-detail">{violation}</p>
      {/each}
      <p class="validation-detail">
        承認すると、選択中プロジェクトのルート外に対するファイル操作を許可したうえで確認画面へ進みます。
      </p>
      <ApprovalGate
        busy={busy}
        approvalEnabled={scopeApprovalVisible}
        backLabel="回答を見直す"
        approveLabel="このアクセスを許可して続行"
        onBack={handleBackFromScopeApproval}
        onApprove={handleApproveScopeOverride}
      />
    </div>
  {/if}

  {#if showInstructionPreview && copilotStepAvailable}
    <pre class="preview-block">{copilotInstructionText}</pre>
  {/if}

  <label class="field-label" for="copilot-response">Copilot の返答</label>
  <textarea
    id="copilot-response"
    class="textarea textarea-tall"
    bind:value={copilotResponse}
    bind:this={copilotResponseField}
    placeholder="Copilot から返ってきた JSON をここに貼り付け"
    rows="8"
    disabled={busy || isSendingToCopilot || agentLoopRunning || !copilotStepAvailable || agentLoopResult?.status === "awaiting_plan_approval"}
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
      <button
        class="btn btn-secondary"
        type="button"
        on:click={copyRetryPrompt}
        disabled={!copilotStepAvailable}
      >
        修正を依頼するテキストをコピー
      </button>
    </div>
  {/if}

  {#if progressItems.length > 0 && guidedStage === "copilot"}
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

  {#if errorMsg && guidedStage === "copilot" && !scopeApprovalVisible}
    {@const fe = getFriendlyError(errorMsg)}
    <div class="friendly-error">
      <span class="fe-icon">{fe.icon}</span>
      <div class="fe-body">
        <div class="fe-message">{fe.message}</div>
        {#if fe.hint}
          <div class="fe-hint">{fe.hint}</div>
        {/if}
      </div>
    </div>
  {/if}

  <div class="btn-row">
    <button
      class="btn btn-secondary"
      type="button"
      on:click={goToSetup}
      disabled={busy || isSendingToCopilot || !copilotStepAvailable}
    >
      戻る
    </button>
    <button
      class="btn btn-primary"
      type="button"
      on:click={() => {
        void handleCopilotStage();
      }}
      disabled={busy || isSendingToCopilot || !copilotStepAvailable || !copilotResponse.trim() || agentLoopResult?.status === "awaiting_plan_approval"}
    >
      {busy && guidedStage === "copilot" ? "変更を確認しています…" : "確認する"}
    </button>
  </div>
  <p class="action-note">回答を自動補正し、形式を確認して、保存前の変更確認まで進めます。</p>
  {#if !busy && guidedStage === "copilot" && progressItems.some((item) => item.status === "error")}
    <button class="btn btn-secondary retry-button" type="button" on:click={retryCurrentStage}>
      やり直す
    </button>
  {/if}
</section>

<section
  class="card step-panel"
  role="group"
  aria-disabled={!reviewStepAvailable && !executionDone}
  data-disabled={!reviewStepAvailable && !executionDone}
>
  <div class="step-panel-header">
    <h2 class="panel-title">3. 確認して保存</h2>
  </div>

  {#if !reviewStepAvailable && !executionDone}
    <p class="step-panel-note">ステップ 2 の確認が終わると、ここで差分を見て別コピーの保存に進めます。</p>
  {/if}

  <div class="step-summary">
    <span class="step-summary-label">タスク名:</span> {taskName || "未設定"}
    <br />
    <span class="step-summary-label">ファイル:</span> {filePath || "未設定"}
  </div>

  {#if executionDone}
    <div class="completion-screen">
      <div class="completion-icon">✅</div>
      <h2 class="completion-title">完了しました！</h2>
      <p class="completion-summary">{executionSummary || previewSummary}</p>

      <div class="completion-stats">
        {#if previewOutputPath}
          <div class="stat-item">
            <span class="stat-icon">📄</span>
            <span class="stat-label">出力ファイル</span>
            <span class="stat-value">{previewOutputPath.split(/[\\/]/).pop()}</span>
          </div>
        {/if}
        {#if workflowStartedAt && completedAt}
          <div class="stat-item">
            <span class="stat-icon">⏱</span>
            <span class="stat-label">所要時間</span>
            <span class="stat-value">{Math.max(1, Math.round((completedAt - workflowStartedAt) / 1000))} 秒</span>
          </div>
        {/if}
      </div>

      <div class="completion-actions">
        {#if previewOutputPath}
          <button class="completion-open-btn" type="button" on:click={openOutputFile}>
            📂 出力ファイルを開く
          </button>
        {/if}
        <button class="completion-reset-btn" type="button" on:click={resetAll}>
          もう一度
        </button>
      </div>
    </div>
  {:else}
    <button
      class="btn-link"
      type="button"
      on:click={() => (showDetailedChanges = !showDetailedChanges)}
      disabled={!reviewStepAvailable}
    >
      {showDetailedChanges ? "詳細を閉じる" : "詳細を見る"}
    </button>

    {#if showDetailedChanges && reviewStepAvailable}
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
            <SheetDiffCard {sheetDiff} />
          {/each}
        </div>
      {/if}

      {#if previewFileWriteActions.length > 0}
        <FileOpPreview actions={previewFileWriteActions} />
      {/if}
    {/if}

    {#if previewWarnings.length > 0}
      <div class="warnings">
        {#each previewWarnings as warning}
          <p class="field-warn">⚠ {warning}</p>
        {/each}
      </div>
    {/if}

    {#if progressItems.length > 0 && guidedStage === "review-save"}
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

    {#if errorMsg && guidedStage === "review-save"}
      {@const fe = getFriendlyError(errorMsg)}
      <div class="friendly-error">
        <span class="fe-icon">{fe.icon}</span>
        <div class="fe-body">
          <div class="fe-message">{fe.message}</div>
          {#if fe.hint}
            <div class="fe-hint">{fe.hint}</div>
          {/if}
        </div>
      </div>
    {/if}

    <ApprovalGate
      {busy}
      {reviewStepAvailable}
      showRetry={!busy && guidedStage === "review-save" && progressItems.some((item) => item.status === "error")}
      onBack={goToCopilot}
      onApprove={handleReviewSaveStage}
      onRetry={retryCurrentStage}
    />
  {/if}
</section>

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

    <div class="expert-section">
      <div class="expert-section-header">
        <h3 class="expert-title">承認履歴</h3>
        {#if sessionId && turnId}
          <button
            class="btn-link"
            type="button"
            on:click={() => {
              requestTurnInspectionRefresh();
            }}
          >
            再読込
          </button>
        {/if}
      </div>

      {#if !sessionId || !turnId}
        <p class="expert-copy">turn が作成されると、ここに保存前承認と project scope override の履歴を表示します。</p>
      {:else if turnInspectionLoading}
        <p class="expert-copy">承認履歴を読み込んでいます…</p>
      {:else if turnInspectionError}
        <p class="field-warn">⚠ {turnInspectionError}</p>
      {:else if turnInspectionDetails?.approval.payload}
        <div class="approval-history-grid">
          <article class="approval-history-card">
            <div class="approval-history-topline">
              <strong>保存前承認</strong>
              <span>{formatApprovalDecision(turnInspectionDetails.approval.payload.decision)}</span>
            </div>
            <p class="expert-copy">{turnInspectionDetails.approval.summary}</p>
            <p class="expert-copy">
              保存前承認: {turnInspectionDetails.approval.payload.requiresApproval ? "必要" : "不要"}
            </p>
            <p class="expert-copy">
              実行可否: {turnInspectionDetails.approval.payload.readyForExecution ? "実行可能" : "未解放"}
            </p>
            <p class="expert-copy">
              記録時刻: {formatAuditTime(turnInspectionDetails.approval.payload.approvedAt)}
            </p>
            {#if turnInspectionDetails.approval.payload.note}
              <p class="expert-copy">メモ: {turnInspectionDetails.approval.payload.note}</p>
            {/if}
            {#if turnInspectionDetails.approval.artifactId}
              <p class="expert-copy">artifact: {turnInspectionDetails.approval.artifactId}</p>
            {/if}
            <p class="expert-copy">storage: {turnInspectionStorageMode || "unknown"}</p>
          </article>

          <article class="approval-history-card">
            <div class="approval-history-topline">
              <strong>Project Scope Override</strong>
              <span>{scopeApprovalArtifacts.length} 件</span>
            </div>
            {#if scopeApprovalArtifacts.length === 0}
              <p class="expert-copy">この turn ではまだ project scope override の記録はありません。</p>
            {:else}
              <div class="approval-history-list">
                {#each scopeApprovalArtifacts as artifact}
                  <div class="approval-history-item">
                    <div class="approval-history-topline">
                      <span>{formatApprovalDecision(artifact.payload.decision)}</span>
                      <span>{formatAuditTime(artifact.createdAt)}</span>
                    </div>
                    <p class="expert-copy">source: {formatScopeApprovalSource(artifact.payload.source)}</p>
                    <p class="expert-copy">root: {artifact.payload.rootFolder}</p>
                    <p class="expert-copy">paths: {artifact.payload.violations.join(" / ")}</p>
                    {#if artifact.payload.note}
                      <p class="expert-copy">note: {artifact.payload.note}</p>
                    {/if}
                    <p class="expert-copy">artifact: {artifact.artifactId}</p>
                  </div>
                {/each}
              </div>
            {/if}
          </article>
        </div>
      {:else}
        <p class="expert-copy">承認履歴はまだありません。</p>
      {/if}
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

{/if}

<SettingsModal
  open={settingsOpen}
  bind:autoLaunchEdge
  bind:cdpPort
  bind:timeoutMs
  bind:maxTurns
  bind:loopTimeoutMs
  bind:agentLoopEnabled
  bind:planningEnabled
  bind:autoApproveReadSteps
  bind:pauseBetweenSteps
  {cdpTestStatus}
  {cdpTestMessage}
  {copiedBrowserCommandNotice}
  edgeLaunchCommand={getEdgeLaunchCommand()}
  autoPortRangeLabel={`ポート ${AUTO_CDP_PORT_RANGE_START}-${AUTO_CDP_PORT_RANGE_END} から自動選択されます`}
  {storagePath}
  onClose={() => (settingsOpen = false)}
  onToggleAutoLaunch={() => {
    autoLaunchEdge = !autoLaunchEdge;
    persistBrowserAutomationSettings();
  }}
  onPersist={persistBrowserAutomationSettings}
  onCopyCommand={copyEdgeLaunchCommand}
  onTestConnection={testCdpConnection}
/>

<style>
  .welcome-overlay {
    position: fixed;
    inset: 0;
    background: var(--ra-bg);
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .welcome-card {
    width: min(480px, calc(100vw - 2rem));
    padding: 3rem 2rem;
    text-align: center;
  }

  .welcome-logo {
    font-size: 4rem;
    margin-bottom: 1rem;
  }

  .welcome-title {
    margin: 0 0 0.5rem;
    font-size: 2.2rem;
    font-weight: 700;
    color: var(--ra-text);
  }

  .welcome-subtitle {
    margin: 0 0 2.5rem;
    font-size: 1.1rem;
    line-height: 1.7;
    color: var(--ra-text-muted);
  }

  .welcome-steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin-bottom: 2.5rem;
  }

  .welcome-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }

  .welcome-step-icon {
    font-size: 1.8rem;
  }

  .welcome-step-label {
    font-size: 0.78rem;
    color: var(--ra-text-muted);
    white-space: nowrap;
  }

  .welcome-step-arrow {
    color: var(--ra-accent);
    font-size: 1.2rem;
  }

  .welcome-btn {
    background: var(--ra-accent);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.85rem 2.5rem;
    font-size: 1.05rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .welcome-btn:hover {
    opacity: 0.88;
  }

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

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
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

  .mode-toggle-group {
    display: inline-flex;
    padding: 0.2rem;
    border: 1px solid var(--ra-border);
    border-radius: 999px;
    background: var(--ra-surface);
  }

  .mode-toggle-btn {
    border: none;
    background: transparent;
    color: var(--ra-text-muted);
    padding: 0.45rem 0.85rem;
    border-radius: 999px;
  }

  .mode-toggle-active {
    background: color-mix(in srgb, var(--ra-accent) 12%, var(--ra-surface));
    color: var(--ra-text);
    font-weight: 600;
  }

  .project-strip {
    margin-bottom: 1rem;
  }

  .project-audit-card {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--ra-border);
  }

  .project-audit-header,
  .project-audit-topline,
  .project-audit-badges,
  .project-audit-actions {
    display: flex;
    gap: 0.75rem;
  }

  .project-audit-header,
  .project-audit-topline {
    align-items: start;
    justify-content: space-between;
  }

  .project-audit-badges {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .project-audit-title {
    margin: 0;
    font-size: 0.96rem;
  }

  .project-audit-copy {
    margin: 0.25rem 0 0;
    color: var(--ra-text-muted);
    font-size: 0.84rem;
    word-break: break-word;
  }

  .project-audit-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem;
    margin-top: 0.85rem;
  }

  .project-audit-row {
    padding: 0.9rem;
    border: 1px solid var(--ra-border);
    border-radius: 14px;
    background: var(--ra-surface);
  }

  .project-audit-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
    font-size: 0.76rem;
    font-weight: 700;
    border: 1px solid var(--ra-border);
    background: var(--ra-surface-muted);
    color: var(--ra-text-secondary);
  }

  .project-audit-badge[data-tone="approved"] {
    border-color: #77b98f;
    background: #edf8f0;
    color: #216842;
  }

  .project-audit-badge[data-tone="rejected"] {
    border-color: #cf786c;
    background: #fff3f1;
    color: #9b3e33;
  }

  .project-audit-badge[data-tone="pending"] {
    border-color: #d2a55d;
    background: #fff8eb;
    color: #8a5c12;
  }

  .project-audit-badge[data-tone="not-required"],
  .project-audit-badge[data-tone="none"] {
    border-color: var(--ra-border);
    background: var(--ra-surface-muted);
    color: var(--ra-text-secondary);
  }

  .delegation-shell {
    display: grid;
    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(280px, 360px);
    gap: 1rem;
    min-height: calc(100vh - 14rem);
  }

  .delegation-sidebar,
  .delegation-main {
    min-height: 0;
  }

  .delegation-sidebar-note {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--ra-border);
    color: var(--ra-text-muted);
    font-size: 0.86rem;
  }

  .delegation-composer-wrap {
    position: sticky;
    bottom: 0;
    margin-top: 1rem;
    z-index: 10;
  }

  .step-progress-bar {
    position: sticky;
    top: 0;
    z-index: 20;
    margin: 1rem 0 1.25rem;
    padding: 1rem 1.25rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius);
    background: var(--ra-surface);
    box-shadow: var(--ra-shadow);
  }

  .step-progress-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
  }

  .step-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    opacity: 0.4;
    transition: opacity 0.3s;
  }

  .step-node.current,
  .step-node.completed {
    opacity: 1;
  }

  .step-circle {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    background: var(--ra-bg);
    border: 2px solid var(--ra-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    transition: background 0.3s, border-color 0.3s;
  }

  .step-node.current .step-circle {
    border-color: var(--ra-accent);
    background: var(--ra-accent);
    color: white;
  }

  .step-node.completed .step-circle {
    border-color: var(--ra-success);
    background: var(--ra-success);
    color: white;
  }

  .step-check {
    font-size: 1rem;
    font-weight: 700;
  }

  .step-node-label {
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--ra-text-muted);
  }

  .step-node.current .step-node-label {
    color: var(--ra-accent);
    font-weight: 600;
  }

  .step-connector {
    flex: 1;
    height: 2px;
    background: var(--ra-border);
    min-width: 2rem;
    max-width: 4rem;
    transition: background 0.4s;
  }

  .step-connector.filled {
    background: var(--ra-success);
  }

  .step-description {
    margin: 0.85rem 0 0;
    text-align: center;
    font-size: 0.9rem;
    color: var(--ra-text-secondary);
  }

  .hidden-file-input {
    display: none;
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

  .step-panel {
    transition: opacity 0.15s ease, filter 0.15s ease;
  }

  .step-panel[data-disabled="true"] {
    opacity: 0.58;
    filter: grayscale(0.18);
  }

  .step-panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .step-panel-note {
    margin: 0 0 1rem;
    padding: 0.65rem 0.8rem;
    border: 1px dashed var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface-muted);
    color: var(--ra-text-muted);
    font-size: 0.84rem;
    line-height: 1.6;
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

  .btn-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  .friendly-error {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    margin-top: 0.75rem;
    background: color-mix(in srgb, var(--ra-error) 8%, var(--ra-surface));
    border: 1px solid color-mix(in srgb, var(--ra-error) 30%, transparent);
    border-radius: 8px;
    padding: 0.75rem 1rem;
  }

  .fe-icon {
    font-size: 1.3rem;
    flex-shrink: 0;
  }

  .fe-body {
    flex: 1;
  }

  .fe-message {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--ra-error);
  }

  .fe-hint {
    font-size: 0.8rem;
    color: var(--ra-text-muted);
    margin-top: 0.2rem;
    line-height: 1.5;
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

  .loop-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
    padding: 0.75rem 0.9rem;
    border: 1px solid var(--ra-border);
    border-radius: var(--ra-radius-sm);
    background: var(--ra-surface-muted);
  }

  .checkbox-row {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.88rem;
    color: var(--ra-text);
  }

  .loop-settings-summary {
    font-size: 0.8rem;
    color: var(--ra-text-muted);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .spinner {
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  .timeline-error-msg {
    font-size: 0.78rem;
    color: var(--ra-error);
    margin-top: 0.2rem;
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

  .scope-approval-card :global(.safety-note) {
    margin-top: 0.8rem;
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

  .warnings {
    margin-bottom: 0.75rem;
  }

  .completion-screen {
    text-align: center;
    padding: 3rem 2rem;
  }

  .completion-icon {
    font-size: 4rem;
    animation: pulse 0.6s ease-out;
  }

  @keyframes pulse {
    0% {
      transform: scale(0.5);
      opacity: 0;
    }

    70% {
      transform: scale(1.15);
    }

    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .completion-title {
    font-size: 1.8rem;
    font-weight: 700;
    margin: 0.75rem 0 0.5rem;
  }

  .completion-summary {
    font-size: 0.95rem;
    color: var(--ra-text-muted);
    max-width: 400px;
    margin: 0 auto 1.5rem;
    line-height: 1.6;
  }

  .completion-stats {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--ra-surface);
    border-radius: 10px;
    padding: 1rem 1.5rem;
    max-width: 380px;
    margin: 0 auto 2rem;
    border: 1px solid var(--ra-border);
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.85rem;
  }

  .stat-icon {
    font-size: 1rem;
  }

  .stat-label {
    color: var(--ra-text-muted);
    flex: 1;
    text-align: left;
  }

  .stat-value {
    font-weight: 600;
  }

  .completion-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .completion-open-btn {
    background: var(--ra-accent);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.7rem 1.5rem;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .completion-reset-btn {
    background: var(--ra-surface);
    color: var(--ra-text);
    border: 1px solid var(--ra-border);
    border-radius: 8px;
    padding: 0.7rem 1.5rem;
    font-size: 0.9rem;
    cursor: pointer;
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

  .expert-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--ra-border);
  }

  .expert-section-header,
  .approval-history-topline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .approval-history-grid,
  .approval-history-list {
    display: grid;
    gap: 0.9rem;
    margin-top: 0.75rem;
  }

  .approval-history-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .approval-history-card,
  .approval-history-item {
    border: 1px solid var(--ra-border);
    border-radius: 12px;
    background: var(--ra-surface-muted);
    padding: 0.85rem;
  }

  .send-status {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: 0.75rem;
    font-size: 0.88rem;
    color: var(--ra-text-secondary);
  }

  .send-status-spinner {
    color: var(--ra-accent);
  }

  .send-status-text {
    line-height: 1.4;
  }

  .plan-review-panel,
  .plan-progress-panel {
    margin-top: 1rem;
    padding: 1rem;
    border: 1px solid var(--ra-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--ra-surface) 88%, white);
  }

  .plan-review-header,
  .plan-progress-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  .plan-review-title {
    margin: 0;
    font-size: 1rem;
  }

  .plan-review-summary,
  .plan-progress-summary,
  .plan-progress-note {
    margin: 0.35rem 0 0;
    color: var(--ra-text-muted);
    font-size: 0.9rem;
  }

  .plan-step-list,
  .plan-progress-list {
    display: grid;
    gap: 0.75rem;
    margin-top: 0.85rem;
  }

  .plan-step-card,
  .plan-progress-step {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.75rem;
    align-items: start;
    padding: 0.85rem;
    border-radius: 10px;
    border: 1px solid var(--ra-border);
    background: var(--ra-surface);
  }

  .plan-progress-step {
    grid-template-columns: auto 1fr;
  }

  .plan-step-card[data-phase="write"],
  .plan-progress-step[data-phase="write"] {
    border-color: color-mix(in srgb, var(--ra-accent) 45%, var(--ra-border));
  }

  .plan-step-index,
  .plan-progress-mark {
    width: 1.75rem;
    height: 1.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ra-accent) 12%, var(--ra-surface));
    color: var(--ra-accent);
    font-weight: 700;
    font-size: 0.85rem;
  }

  .plan-step-topline,
  .plan-progress-topline,
  .plan-progress-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .plan-step-phase,
  .plan-progress-phase,
  .plan-step-tool,
  .plan-progress-tool {
    font-size: 0.8rem;
    color: var(--ra-text-muted);
  }

  .plan-step-description,
  .plan-step-effect {
    margin: 0.35rem 0 0;
  }

  .plan-step-effect {
    color: var(--ra-text-muted);
    font-size: 0.88rem;
  }

  .plan-step-remove {
    align-self: center;
  }

  .plan-step-actions {
    display: grid;
    gap: 0.4rem;
  }

  .plan-progress-step[data-state="running"] {
    border-color: var(--ra-accent);
  }

  .plan-progress-step[data-state="completed"] .plan-progress-mark {
    background: color-mix(in srgb, #3dbb7a 18%, var(--ra-surface));
    color: #238a55;
  }

  .plan-progress-step[data-state="failed"] .plan-progress-mark {
    background: color-mix(in srgb, #d05a4b 15%, var(--ra-surface));
    color: #b43d30;
  }

  @media (max-width: 720px) {
    .delegation-shell {
      grid-template-columns: 1fr;
    }

    .change-strip,
    .summary-grid,
    .expert-grid,
    .approval-history-grid,
    .project-audit-grid {
      grid-template-columns: 1fr;
    }

    .welcome-steps,
    .step-progress-row,
    .completion-actions,
    .plan-review-header,
    .plan-progress-header,
    .header-actions {
      flex-direction: column;
    }

    .step-progress-row {
      gap: 0.75rem;
    }

    .step-connector {
      width: 2px;
      height: 1.5rem;
      min-width: 0;
    }

    .loop-toggle-row {
      align-items: flex-start;
      flex-direction: column;
    }

    .change-strip {
      top: 8.5rem;
    }
  }
</style>
