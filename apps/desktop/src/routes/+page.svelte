<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { open } from "@tauri-apps/plugin-shell";
  import ApprovalCard from "$lib/components/ApprovalCard.svelte";
  import BatchDashboard from "$lib/components/BatchDashboard.svelte";
  import BatchTargetSelector from "$lib/components/BatchTargetSelector.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import CompletionCard from "$lib/components/CompletionCard.svelte";
  import PipelineBuilder from "$lib/components/PipelineBuilder.svelte";
  import PipelineProgress from "$lib/components/PipelineProgress.svelte";
  import ProjectSelector from "$lib/components/ProjectSelector.svelte";
  import RecentSessions from "$lib/components/RecentSessions.svelte";
  import SettingsModal from "$lib/components/SettingsModal.svelte";
  import AppSidebar from "$lib/components/AppSidebar.svelte";
  import ContextPanel from "$lib/components/ContextPanel.svelte";
  import StatusStrip from "$lib/components/StatusStrip.svelte";
  import TaskInput from "$lib/components/TaskInput.svelte";
  import TemplateBrowser from "$lib/components/TemplateBrowser.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import UnifiedFeed from "$lib/components/UnifiedFeed.svelte";
  import {
    activityFeedStore,
    delegationStore,
    type ActivityFeedEvent
  } from "$lib/stores/delegation";
  import type {
    ApprovalPolicy,
    BatchJob,
    BatchTargetUpdateEvent,
    CopilotTurnResponse,
    DiffSummary,
    ExecutionPlan,
    McpTransport,
    McpServerConfig,
    OutputArtifact,
    PlanProgressResponse,
    PlanStep,
    PlanStepStatus,
    Pipeline,
    PipelineInputSource,
    PipelineStep,
    PipelineStepUpdateEvent,
    PreflightWorkbookResponse,
    Project,
    ReadTurnArtifactsResponse,
    Session,
    SheetColumnProfile,
    StartupIssue,
    ToolRegistration,
    ToolExecutionResult,
    TurnDetailsViewModel,
    WorkbookProfile,
    WorkflowTemplate,
    WorkflowTemplateCategory
  } from "@relay-agent/contracts";
  import {
    addInboxFile,
    addProjectMemory,
    approvePlan,
    assessCopilotHandoff,
    batchCreate,
    batchGetStatus,
    batchRun,
    batchSkipTarget,
    bindAgentUi,
    buildPlanningPrompt,
    cancelAgent as cancelDesktopAgent,
    connectMcpServer,
    createProject,
    createSession,
    discardDelegationDraft,
    discardStudioDraft,
    disposeAgentUi,
    feedStore,
    getPlanProgress,
    getCopilotBrowserErrorMessage,
    getActiveSessionState,
    getFriendlyError,
    inspectWorkbook,
    initializeApp,
    isWithinProjectScope,
    linkSessionToProject,
    listTools,
    listSessions,
    recordPlanProgress,
    recordScopeApproval,
    listRecentFiles,
    listProjects,
    listRecoverableStudioDrafts,
    listRecentSessions,
    loadApprovalPolicy,
    loadDelegationDraft,
    loadSelectedProjectId,
    loadStudioDraft,
    loadBrowserAutomationSettings,
    loadToolSettings,
    hasSeenWelcome,
    markWelcomeSeen,
    markStudioDraftClean,
    pingDesktop,
    pipelineCancel,
    pipelineCreate,
    pipelineGetStatus,
    pipelineRun,
    preflightWorkbook,
    previewExecution,
    readTurnArtifacts,
    readSession,
    recordStructuredResponse,
    removeProjectMemory,
    removeInboxFile,
    rememberRecentFile,
    rememberRecentSession,
    resumeAgentLoopWithPlan,
    runAgentLoop,
    respondToApproval,
    runExecution,
    validateOutputQuality,
    saveApprovalPolicy,
    saveBrowserAutomationSettings,
    saveDelegationDraft,
    saveSelectedProjectId,
    saveToolSettings,
    sendPromptViaBrowserTool,
    saveStudioDraft,
    sessionStore,
    setSessionProject,
    setApprovalPolicy,
    setToolEnabled,
    startAgent as startDesktopAgent,
    startTurn,
    templateDelete,
    templateFromSession,
    templateList,
    approvalStore,
    refreshSessionHistory as refreshDesktopAgentSessionHistory,
    resetAgentUi,
    respondApproval as respondDesktopAgentApproval,
    validateProjectScopeActions,
    type AgentLoopResult,
    type AgentFeedEntry,
    type BrowserCommandProgress,
    type CopilotConversationTurn,
    type PersistedStudioDraft,
    type RecentFile,
    type RecentSession,
    type ToolSettings,
  } from "$lib";
  import { buildProjectContext } from "$lib/prompt-templates";

  type AutomationTab = "pipeline" | "batch" | "template";
  type BatchTargetDraft = {
    path: string;
    name: string;
    size: number;
  };
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
  type FileWritePreviewAction = {
    tool: string;
    args: Record<string, unknown>;
  };
  type ScopeApprovalSource = "manual" | "agent-loop";
  type ScopeApprovalArtifactRecord = Extract<
    ReadTurnArtifactsResponse["artifacts"][number],
    { artifactType: "scope-approval" }
  >;
  type PreviewArtifactRecord = Extract<
    ReadTurnArtifactsResponse["artifacts"][number],
    { artifactType: "preview" }
  >;
  type ExecutionArtifactRecord = Extract<
    ReadTurnArtifactsResponse["artifacts"][number],
    { artifactType: "execution" }
  >;
  type UnifiedFeedEntry = {
    id: string;
    type: "tool" | "thinking" | "error";
    label: string;
    status: "running" | "done" | "error";
    startTime: number;
    endTime?: number;
    detail?: string;
    rawResult?: unknown;
  };
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
  const instructionColumnLimit = 20;
  const objectivePresets = [
    "approved が true の行だけ残してください",
    "amount 列の合計を新しい列として追加してください",
    "重複行を削除してシートを整理してください"
  ] as const;

  function wrapLegacyPreviewArtifacts(
    diffSummary: DiffSummary,
    fileWriteActions: FileWritePreviewAction[]
  ): OutputArtifact[] {
    const artifacts: OutputArtifact[] = [];

    if (diffSummary.sheets.length > 0) {
      artifacts.push({
        id: `artifact-diff-${Date.now()}`,
        type: "spreadsheet_diff",
        label: `${diffSummary.sourcePath.split(/[\\/]/).pop() ?? diffSummary.sourcePath} -> ${diffSummary.outputPath.split(/[\\/]/).pop() ?? diffSummary.outputPath}`,
        sourcePath: diffSummary.sourcePath,
        outputPath: diffSummary.outputPath,
        warnings: diffSummary.warnings,
        content: {
          type: "spreadsheet_diff",
          diffSummary
        }
      });
    }

    if (fileWriteActions.length > 0) {
      artifacts.push({
        id: `artifact-file-${Date.now()}`,
        type: "file_operation",
        label: `${fileWriteActions.length} file operation(s)`,
        sourcePath: diffSummary.sourcePath,
        outputPath: diffSummary.outputPath,
        warnings: [],
        content: {
          type: "file_operation",
          operations: fileWriteActions
        }
      });
    }

    return artifacts;
  }

  function collectInspectionOutputArtifacts(
    artifacts: ReadTurnArtifactsResponse["artifacts"]
  ): OutputArtifact[] {
    const executionArtifact = [...artifacts]
      .reverse()
      .find(
        (artifact): artifact is ExecutionArtifactRecord =>
          artifact.artifactType === "execution"
      );
    if (executionArtifact?.payload.artifacts?.length) {
      return executionArtifact.payload.artifacts;
    }

    const previewArtifact = [...artifacts]
      .reverse()
      .find(
        (artifact): artifact is PreviewArtifactRecord =>
          artifact.artifactType === "preview"
      );
    if (previewArtifact?.payload.artifacts?.length) {
      return previewArtifact.payload.artifacts;
    }

    return [];
  }

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

  let busy = false;
  let errorMsg = "";
  let settingsOpen = false;
  let showWelcome = false;
  let isDragOver = false;

  // Ink & Steel UI state
  let sidebarCollapsed = false;
  let showContextPanel = true;
  let inboxFiles: { path: string; size: number; addedAt: string }[] = [];
  let darkMode = false;
  let commandPaletteOpen = false;
  type NavView = "home" | "pipeline" | "batch" | "template" | "sessions" | "settings";
  let activeNavView: NavView = "home";
  type ToastItem = { id: string; message: string; type: "success" | "error" | "info" };
  let toasts: ToastItem[] = [];

  function addToast(message: string, type: ToastItem["type"] = "info") {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    toasts = [...toasts, { id, message, type }];
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
    }, 3000);
  }

  function mergeLocalInboxFile(path: string): void {
    const normalizedPath = path.trim();
    if (!normalizedPath || inboxFiles.some((file) => file.path === normalizedPath)) {
      return;
    }
    inboxFiles = [
      ...inboxFiles,
      { path: normalizedPath, size: 0, addedAt: new Date().toISOString() }
    ];
  }

  async function syncInboxFilesFromSession(targetSessionId: string): Promise<void> {
    if (!targetSessionId) {
      inboxFiles = [];
      return;
    }

    const detail = await readSession({ sessionId: targetSessionId });
    inboxFiles = detail.session.inboxFiles;
  }

  async function persistStagedInboxFiles(targetSessionId: string): Promise<void> {
    if (!targetSessionId || inboxFiles.length === 0) {
      return;
    }

    let latestInboxFiles = inboxFiles;
    for (const file of inboxFiles) {
      const updatedSession = await addInboxFile({
        sessionId: targetSessionId,
        path: file.path
      });
      latestInboxFiles = updatedSession.inboxFiles;
    }
    inboxFiles = latestInboxFiles;
  }

  async function handleInboxFileAdd(path: string): Promise<void> {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }

    if (!sessionId) {
      mergeLocalInboxFile(normalizedPath);
      return;
    }

    try {
      const updatedSession = await addInboxFile({
        sessionId,
        path: normalizedPath
      });
      inboxFiles = updatedSession.inboxFiles;
      await refreshSessions();
    } catch (error) {
      addToast(toError(error), "error");
    }
  }

  async function handleInboxFileRemove(path: string): Promise<void> {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }

    if (!sessionId) {
      inboxFiles = inboxFiles.filter((file) => file.path !== normalizedPath);
      return;
    }

    try {
      const updatedSession = await removeInboxFile({
        sessionId,
        path: normalizedPath
      });
      inboxFiles = updatedSession.inboxFiles;
      await refreshSessions();
    } catch (error) {
      addToast(toError(error), "error");
    }
  }

  function toggleDarkMode() {
    darkMode = !darkMode;
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("ra-theme", darkMode ? "dark" : "light");
  }

  function handleNavigation(event: CustomEvent<{ view: string }>) {
    const view = event.detail.view as NavView;
    activeNavView = view;
    if (view === "settings") {
      settingsOpen = true;
    } else {
      settingsOpen = false;
    }
  }

  function handleCommandPaletteAction(event: CustomEvent<{ id: string; category: string }>) {
    const actionId = event.detail.id;
    if (actionId.startsWith("nav:")) {
      const view = actionId.replace("nav:", "") as NavView;
      activeNavView = view;
      if (view === "settings") settingsOpen = true;
      else settingsOpen = false;
    } else if (actionId === "action:toggle-theme") {
      toggleDarkMode();
    } else if (actionId === "action:toggle-sidebar") {
      sidebarCollapsed = !sidebarCollapsed;
    } else if (actionId === "action:new-session") {
      activeNavView = "home";
      // Reset to new session state
    }
  }
  let cdpTestStatus: "idle" | "testing" | "ok" | "fail" = "idle";
  let cdpTestMessage = "";
  let hiddenFilePicker: HTMLInputElement | null = null;

  let startupIssue: StartupIssue | null = null;
  let storagePath: string | null = null;
  let sampleWorkbookPath: string | null = null;
  let handoffCaution: {
    headline: string;
    reasons: Array<{ text: string; source: string }>;
  } | null = null;

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
  let copilotInstructionText = "";
  let copiedBrowserCommandNotice = "";
  let isSendingToCopilot = false;
  let sendStatusMessage = "";
  let copilotAutoError: string | null = null;
  let cdpPort = AUTO_CDP_PORT_RANGE_START;
  let autoLaunchEdge = true;
  let timeoutMs = 60000;
  let tools: ToolRegistration[] = [];
  let mcpServerUrl = "";
  let mcpServerName = "";
  let mcpTransport: McpTransport = "sse";
  let connectingMcp = false;
  let toolInfoMessage = "";
  let toolErrorMessage = "";
  let agentLoopEnabled = false;
  let maxTurns = 10;
  let loopTimeoutMs = 120000;
  let planningEnabled = true;
  let autoApproveReadSteps = true;
  let pauseBetweenSteps = false;
  let approvalPolicy: ApprovalPolicy = "safe";
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
  let previewArtifacts: OutputArtifact[] = [];
  let scopeApprovalVisible = false;
  let scopeApprovalSource: ScopeApprovalSource | null = null;
  let scopeApprovalSummary = "";
  let scopeApprovalRootFolder = "";
  let scopeApprovalViolations: string[] = [];
  let scopeApprovalResponse: CopilotTurnResponse | null = null;
  let scopeApprovalRawResponse = "";
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
  let agentFeedEntries: UnifiedFeedEntry[] = [];
  let recoverableDraftSessionIds: string[] = [];
  let showRecent = false;
  let progressItems: ProgressItem[] = [];
  let expertDetailsOpen = false;
  let turnInspectionDetails: TurnDetailsViewModel | null = null;
  let turnInspectionArtifacts: ReadTurnArtifactsResponse["artifacts"] = [];
  let inspectionOutputArtifacts: OutputArtifact[] = [];
  let scopeApprovalArtifacts: ScopeApprovalArtifactRecord[] = [];
  let turnInspectionStorageMode = "";
  let turnInspectionLoading = false;
  let turnInspectionError = "";
  let turnInspectionRefreshNonce = 0;
  let hydratingDraft = false;
  let lastSavedDraftSignature = "";
  let automationTab: AutomationTab = "pipeline";
  let pipelineTitle = "連続ワークフロー";
  let pipelineInitialInputPath = "";
  let pipelineDraftSteps: PipelineStep[] = [
    {
      id: crypto.randomUUID(),
      order: 0,
      goal: "最初の確認用コピーを作成する",
      inputSource: "user",
      status: "pending"
    },
    {
      id: crypto.randomUUID(),
      order: 1,
      goal: "前ステップの出力を次の作業へ引き継ぐ",
      inputSource: "prev_step_output",
      status: "pending"
    }
  ];
  let activePipeline: Pipeline | null = null;
  let batchGoal = "";
  let batchTargets: BatchTargetDraft[] = [];
  let activeBatchJob: BatchJob | null = null;
  let workflowTemplates: WorkflowTemplate[] = [];
  let filteredTemplates: WorkflowTemplate[] = [];
  let templateSearchQuery = "";
  let templateCategory: WorkflowTemplateCategory | "all" = "all";

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
    previewArtifacts = [];
    showDetailedChanges = false;
  }

  function clearScopeApproval(): void {
    scopeApprovalVisible = false;
    scopeApprovalSource = null;
    scopeApprovalSummary = "";
    scopeApprovalRootFolder = "";
    scopeApprovalViolations = [];
    scopeApprovalResponse = null;
    scopeApprovalRawResponse = "";
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
    return source === "agent-loop" ? "自律実行" : "スタジオ";
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
    parsedResponse: CopilotTurnResponse;
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
    scopeApprovalResponse = options.parsedResponse;
    scopeApprovalRawResponse = options.rawResponse?.trim() ?? "";
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
    objective: string,
    workbookPath: string,
    title: string,
    profile: WorkbookProfile | null,
    columnProfiles: SheetColumnProfile[],
    availableTools: ToolRegistration[],
    templateKey: TemplateKey | null,
    projectContext = ""
  ): string {
    const toolLines = availableTools.map(
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
      `- 目的: ${objective}`,
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

  function currentAllowedTools(): ToolRegistration[] {
    return tools.filter((tool) => tool.enabled);
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
      badgeLabel?: string;
      detail?: string;
      expandable?: boolean;
      actionRequired?: boolean;
    }
  ): void {
    activityFeedStore.push({
      type,
      message,
      icon: delegationEventIcons[type],
      badgeLabel: options?.badgeLabel,
      detail: options?.detail,
      expandable: options?.expandable,
      actionRequired: options?.actionRequired
    });
  }


  function refreshContinuityState(): void {
    recentSessions = listRecentSessions();
    recentFiles = listRecentFiles();
    recoverableDraftSessionIds = listRecoverableStudioDrafts().map((draft) => draft.sessionId);
  }

  async function refreshWorkflowTemplates(): Promise<void> {
    workflowTemplates = await templateList(
      templateCategory === "all" ? {} : { category: templateCategory }
    );
  }

  async function syncApprovalPolicy(): Promise<void> {
    const savedPolicy = saveApprovalPolicy(approvalPolicy);
    approvalPolicy = savedPolicy;
    await setApprovalPolicy({ policy: savedPolicy });
  }

  function refilterTemplates(): void {
    const query = templateSearchQuery.trim().toLowerCase();
    filteredTemplates = workflowTemplates.filter((template) => {
      const categoryMatches =
        templateCategory === "all" || template.category === templateCategory;
      if (!categoryMatches) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        template.title,
        template.description,
        template.goal,
        ...template.tags,
        ...template.expectedTools
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  function normalizePipelineSteps(steps: PipelineStep[]): PipelineStep[] {
    return steps.map((step, index) => ({
      ...step,
      order: index
    }));
  }

  function addPipelineStep(): void {
    pipelineDraftSteps = normalizePipelineSteps([
      ...pipelineDraftSteps,
      {
        id: crypto.randomUUID(),
        order: pipelineDraftSteps.length,
        goal: "",
        inputSource: pipelineDraftSteps.length === 0 ? "user" : "prev_step_output",
        status: "pending"
      }
    ]);
  }

  function movePipelineDraftStep(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= pipelineDraftSteps.length) {
      return;
    }
    const nextSteps = [...pipelineDraftSteps];
    const [step] = nextSteps.splice(index, 1);
    nextSteps.splice(nextIndex, 0, step);
    pipelineDraftSteps = normalizePipelineSteps(nextSteps);
  }

  function removePipelineDraftStep(index: number): void {
    pipelineDraftSteps = normalizePipelineSteps(
      pipelineDraftSteps.filter((_, candidate) => candidate !== index)
    );
  }

  async function handlePipelineStart(): Promise<void> {
    try {
      const pipeline = await pipelineCreate({
        title: pipelineTitle,
        initialInputPath: pipelineInitialInputPath || filePath,
        projectId: selectedProjectId ?? undefined,
        steps: pipelineDraftSteps.map((step) => ({
          goal: step.goal,
          inputSource: step.inputSource
        }))
      });
      activePipeline = pipeline;
      await pipelineRun({ pipelineId: pipeline.id });
      activePipeline = await pipelineGetStatus({ pipelineId: pipeline.id });
    } catch (error) {
      errorMsg = toError(error);
    }
  }

  async function handleBatchStart(): Promise<void> {
    try {
      const job = await batchCreate({
        workflowGoal: batchGoal,
        projectId: selectedProjectId ?? undefined,
        targetPaths: batchTargets.map((target) => target.path),
        stopOnFirstError: false
      });
      activeBatchJob = job;
      await batchRun({ batchId: job.id });
    } catch (error) {
      errorMsg = toError(error);
    }
  }

  async function handleBatchSkip(path: string): Promise<void> {
    if (!activeBatchJob) {
      return;
    }
    try {
      await batchSkipTarget({ batchId: activeBatchJob.id, targetPath: path });
      activeBatchJob = await batchGetStatus({ batchId: activeBatchJob.id });
    } catch (error) {
      errorMsg = toError(error);
    }
  }

  async function handleSaveCurrentSessionAsTemplate(): Promise<void> {
    if (!sessionId) {
      return;
    }
    try {
      await templateFromSession({
        sessionId,
        title: taskName.trim() || undefined,
        category: "custom",
        description: previewSummary
      });
      await refreshWorkflowTemplates();
      refilterTemplates();
      automationTab = "template";
    } catch (error) {
      errorMsg = toError(error);
    }
  }

  async function handleTemplateDelete(template: WorkflowTemplate): Promise<void> {
    try {
      await templateDelete({ id: template.id });
      await refreshWorkflowTemplates();
      refilterTemplates();
    } catch (error) {
      errorMsg = toError(error);
    }
  }

  function handleTemplateSelect(template: WorkflowTemplate): void {
    updateObjective(template.goal, null);
    automationTab = "pipeline";
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
    const availableTools = currentAllowedTools();
    const workbookSummary = [
      filePath.trim() ? `File: ${filePath.trim()}` : "File: not selected",
      ...formatWorkbookContextLines(workbookProfile, workbookColumnProfiles)
    ].join("\n");

    return {
      workbookSummary,
      availableTools: {
        read: availableTools
          .filter((tool) => tool.phase === "read")
          .map((tool) => tool.id),
        write: availableTools
          .filter((tool) => tool.phase === "write")
          .map((tool) => tool.id)
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

  function applyRecentSessionFallback(session: RecentSession): void {
    errorMsg = "";
    copiedBrowserCommandNotice = "";
    copilotAutoError = null;
    isSendingToCopilot = false;
    clearScopeApproval();
    resetAgentLoopState();
    resetPlanExecutionState();
    clearProgress();
    sessionId = "";
    turnId = "";
    copilotInstructionText = "";
    clearPreviewState();
    resetTurnInspectionState();
    executionDone = false;
    executionSummary = "";
    inboxFiles = [];
    workbookProfile = null;
    workbookColumnProfiles = [];
    filePath = session.workbookPath;
    selectedTemplateKey = null;
    if (session.lastTurnTitle.trim()) {
      taskNameEdited = true;
      taskName = session.lastTurnTitle;
    }
    loadExpertDetails();
  }

  function mapAgentFeedEntry(entry: AgentFeedEntry): UnifiedFeedEntry {
    const timestamp = Date.parse(entry.timestamp);
    const startTime = Number.isFinite(timestamp) ? timestamp : Date.now();
    const status =
      entry.type === "error"
        ? "error"
        : entry.type === "tool_start"
          ? "running"
          : entry.isError
            ? "error"
            : "done";

    return {
      id: entry.id,
      type: entry.type === "error" ? "error" : entry.type === "tool_start" ? "tool" : "thinking",
      label: entry.title,
      status,
      startTime,
      endTime: status === "running" ? undefined : startTime,
      detail: entry.detail,
      rawResult: entry.detail
    };
  }

  function extractLatestAssistantText(
    messages: Array<{ role: string; content: Array<Record<string, unknown>> }>
  ): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "assistant") {
        continue;
      }

      const textBlocks = message.content
        .filter((block) => block?.type === "text")
        .map((block) => (typeof block.text === "string" ? block.text.trim() : ""))
        .filter(Boolean);

      if (textBlocks.length > 0) {
        return textBlocks.join("\n\n");
      }
    }

    return "";
  }

  function stringifyStructuredResponse(response: CopilotTurnResponse): string {
    return JSON.stringify(response, null, 2);
  }

  function currentAgentOutputPath(): string {
    if (previewOutputPath.trim()) {
      return previewOutputPath.trim();
    }

    return recentFiles[0]?.path?.trim() ?? "";
  }

  async function handleAgentTaskSubmit(
    event: CustomEvent<{ goal: string; files: string[] }>
  ): Promise<void> {
    const goal = event.detail.goal.trim();
    if (!goal) {
      return;
    }

    const attachedFiles = inferDelegationFiles(goal, event.detail.files);
    const primaryFile = attachedFiles[0] ?? "";

    copilotAutoError = null;
    executionDone = false;
    executionSummary = "";
    previewOutputPath = "";
    previewSummary = "";
    previewWarnings = [];
    previewArtifacts = [];
    discardDelegationDraft();
    resetAgentUi();

    updateObjective(goal);
    taskName = deriveTitle(goal);
    taskNameEdited = false;
    filePath = primaryFile;
    pipelineInitialInputPath = primaryFile;

    if (primaryFile) {
      rememberRecentFile({
        path: primaryFile,
        lastUsedAt: new Date().toISOString(),
        sessionId: sessionId || null,
        source: "draft"
      });
      recentFiles = listRecentFiles();
      await refreshWorkbookContext(primaryFile);
    }

    try {
      const startedSessionId = await startDesktopAgent({
        goal,
        files: attachedFiles,
        cwd: selectedProject?.rootFolder || undefined,
        browserSettings: {
          cdpPort,
          autoLaunchEdge,
          timeoutMs
        },
        maxTurns
      });
      sessionId = startedSessionId;
      await syncInboxFilesFromSession(startedSessionId);
      await refreshSessions();
    } catch (error) {
      copilotAutoError = toError(error);
      addToast(copilotAutoError, "error");
    }
  }

  async function handleAgentApprovalDecision(approved: boolean): Promise<void> {
    const pending = $approvalStore.pending;
    if (!pending) {
      return;
    }

    try {
      await respondDesktopAgentApproval(pending.approvalId, approved);
      await refreshDesktopAgentSessionHistory();
    } catch (error) {
      copilotAutoError = toError(error);
      addToast(copilotAutoError, "error");
    }
  }

  async function handleAgentReset(): Promise<void> {
    const activeSession = getActiveSessionState();
    if (activeSession.running) {
      try {
        await cancelDesktopAgent();
      } catch (error) {
        copilotAutoError = toError(error);
      }
    }

    resetAgentUi();
    discardDelegationDraft();
  }

  function applyRecoverableDraft(
    draft: PersistedStudioDraft,
    session: RecentSession
  ): void {
    hydratingDraft = true;

    errorMsg = "";
    copiedBrowserCommandNotice = "";
    copilotAutoError = null;
    isSendingToCopilot = false;
    clearScopeApproval();
    resetAgentLoopState();
    resetPlanExecutionState();
    clearProgress();
    preflight = null;
    sessionId = draft.sessionId;
    turnId = draft.selectedTurnId ?? "";
    filePath = draft.workbookPath || session.workbookPath;
    objectiveText = draft.turnObjective;
    selectedTemplateKey = inferTemplateKey(draft.turnObjective);
    taskName = draft.turnTitle || session.lastTurnTitle || session.title;
    taskNameEdited = Boolean(taskName.trim());
    previewSummary = draft.previewSummary;
    previewTargetCount = draft.previewSnapshot?.targetCount ?? 0;
    previewAffectedRows = draft.previewSnapshot?.estimatedAffectedRows ?? 0;
    previewOutputPath = draft.previewSnapshot?.outputPath ?? "";
    previewWarnings = draft.previewSnapshot?.warnings ?? [];
    previewRequiresApproval = draft.previewSnapshot?.requiresApproval ?? false;
    previewChangeDetails = [];
    previewSheetDiffs = [];
    previewFileWriteActions = draft.previewSnapshot?.fileWriteActions ?? [];
    previewArtifacts =
      draft.previewSnapshot?.artifacts ??
      wrapLegacyPreviewArtifacts(
        {
          sourcePath: draft.previewSnapshot?.sourcePath ?? filePath,
          outputPath: draft.previewSnapshot?.outputPath ?? "",
          mode: "preview",
          targetCount: draft.previewSnapshot?.targetCount ?? 0,
          estimatedAffectedRows: draft.previewSnapshot?.estimatedAffectedRows ?? 0,
          sheets: [],
          warnings: draft.previewSnapshot?.warnings ?? []
        },
        draft.previewSnapshot?.fileWriteActions ?? []
      );
    showDetailedChanges = false;
    resetTurnInspectionState();
    executionDone = false;
    executionSummary = draft.executionSummary;
    showRecent = false;
    void refreshWorkbookContext(filePath);
    void syncInboxFilesFromSession(draft.sessionId);
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

  async function persistSettings(): Promise<void> {
    persistBrowserAutomationSettings();
    await syncApprovalPolicy();
  }

  function currentToolSettings(): ToolSettings {
    return loadToolSettings();
  }

  async function refreshTools(): Promise<void> {
    const response = await listTools();
    tools = response.tools;
    if (response.restoreWarnings.length > 0) {
      toolErrorMessage = response.restoreWarnings.join(" ");
    }
  }

  function persistToolSettings(next: ToolSettings): ToolSettings {
    return saveToolSettings(next);
  }

  async function applySavedToolSettings(): Promise<void> {
    const saved = currentToolSettings();
    let latestTools = tools;
    const connectedServers: McpServerConfig[] = [];

    for (const server of saved.mcpServers) {
      try {
        const response = await connectMcpServer(server);
        latestTools = response.tools;
        connectedServers.push(server);
      } catch (error) {
        toolErrorMessage = `MCP server \`${server.name}\` を復元できませんでした: ${toError(error)}`;
      }
    }

    tools = latestTools;

    for (const toolId of saved.disabledToolIds) {
      if (!tools.some((tool) => tool.id === toolId && tool.enabled)) {
        continue;
      }

      try {
        const updated = await setToolEnabled({ toolId, enabled: false });
        tools = tools.map((tool) => (tool.id === updated.id ? updated : tool));
      } catch (error) {
        toolErrorMessage = `ツール \`${toolId}\` の設定を復元できませんでした: ${toError(error)}`;
      }
    }

    persistToolSettings({
      disabledToolIds: saved.disabledToolIds.filter((toolId) =>
        tools.some((tool) => tool.id === toolId && !tool.enabled)
      ),
      mcpServers: connectedServers
    });
  }

  async function handleToolToggle(toolId: string, enabled: boolean): Promise<void> {
    toolErrorMessage = "";
    toolInfoMessage = "";

    try {
      const updated = await setToolEnabled({ toolId, enabled });
      tools = tools.map((tool) => (tool.id === updated.id ? updated : tool));
      const disabledToolIds = tools
        .filter((tool) => !tool.enabled)
        .map((tool) => tool.id);
      persistToolSettings({
        disabledToolIds,
        mcpServers: currentToolSettings().mcpServers
      });
      toolInfoMessage = enabled
        ? `ツール \`${updated.title}\` を有効化しました。`
        : `ツール \`${updated.title}\` を無効化しました。`;
    } catch (error) {
      toolErrorMessage = toError(error);
    }
  }

  async function handleConnectMcpServer(): Promise<void> {
    const url = mcpServerUrl.trim();
    const name = mcpServerName.trim();
    if (!url || !name) {
      toolErrorMessage = "MCP サーバー URL とサーバー名を入力してください。";
      return;
    }

    connectingMcp = true;
    toolErrorMessage = "";
    toolInfoMessage = "";
    try {
      const server: McpServerConfig = {
        url,
        name,
        transport: mcpTransport
      };
      const response = await connectMcpServer(server);
      tools = response.tools;
      const saved = currentToolSettings();
      persistToolSettings({
        disabledToolIds: saved.disabledToolIds,
        mcpServers: [
          ...saved.mcpServers.filter(
            (entry) => entry.url !== server.url || entry.name !== server.name
          ),
          server
        ]
      });
      toolInfoMessage = `${response.registeredToolIds.length} 件の MCP ツールを登録しました。`;
      mcpServerUrl = "";
      mcpServerName = "";
      mcpTransport = "sse";
    } catch (error) {
      toolErrorMessage = toError(error);
    } finally {
      connectingMcp = false;
    }
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
            pushDelegationEvent("copilot_turn", `ステップ ${index + 1} を開始しました: ${step.description}`, {
              detail: `${step.tool} / ${step.phase}`
            });

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
            pushDelegationEvent("error", `Copilot 応答の再試行 ${retryLevel}`, {
              detail: error,
              expandable: false
            });

          },
          onManualFallback: (_turn, _fallbackPrompt, error) => {
            const message = `Copilot の構造化応答を確定できなかったため停止しました: ${error}`;
            copilotAutoError = message;
            pushDelegationEvent("error", message, {
              expandable: true,
              actionRequired: true
            });
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
              parsedResponse,
              rawResponse
            });
            delegationStore.requestApproval();
            pushDelegationEvent("write_approval_requested", "プロジェクト範囲外アクセスの承認が必要です。", {
              detail: `${tool}\n許可されたルート: ${rootFolder}\n${violations.join("\n")}`,
              expandable: true,
              actionRequired: true
            });

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
              pushDelegationEvent(
                "tool_executed",
                `${toolResult.tool} を実行しました`,
                {
                  detail: summarizeToolResult(toolResult),
                  expandable: false
                }
              );

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

            void persistPlanProgressSnapshot();
          },
          onWriteStepReached: (step) => {
            currentPlanStepId = step.id;
            updatePlanStepState(step.id, { state: "pending" });
            delegationStore.requestApproval();
            pushDelegationEvent("write_approval_requested", `書き込み前の承認が必要です: ${step.description}`, {
              detail: step.tool,
              actionRequired: true
            });

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
        const rawResponse = stringifyStructuredResponse(result.finalResponse);
        isPlanExecuting = false;
        await recordStructuredResponse({
          sessionId,
          turnId,
          rawResponse,
          parsedResponse: result.finalResponse
        });
        const previewResult = await openPreviewFromStructuredResponse(result.finalResponse, {
          rawResponse,
          scopeApprovalSource: "agent-loop"
        });
        if (previewResult.blockedByScope) {
          copilotAutoError = previewResult.message;
          delegationStore.requestApproval();
          pushDelegationEvent("write_approval_requested", "プロジェクト範囲外アクセスの承認が必要です。", {
            detail: `${selectedProject?.rootFolder ?? "未設定"}\n${scopeApprovalViolations.join("\n")}`,
            expandable: true,
            actionRequired: true
          });
          return;
        }
        if (previewResult.preview.autoApproved) {
          delegationStore.resumeExecution();
          pushDelegationEvent("write_approved", "現在の承認ポリシーで自動承認されました。", {
            detail: `${previewResult.preview.approvalPolicy} / ${previewResult.preview.highestRisk}`,
            badgeLabel: "自動承認済み"
          });
          await handleReviewSaveStage();
          return;
        }
        delegationStore.requestApproval();
        pushDelegationEvent("write_approval_requested", "保存前の確認が必要です。", {
          detail: previewSummary,
          actionRequired: true
        });
        return;
      }

      if (result.status === "done") {
        currentPlanStepId = null;
        await persistPlanProgressSnapshot();
        executionSummary = result.summary;
        executionDone = true;
        delegationStore.complete();
        pushDelegationEvent("completed", "自律実行が完了しました。", {
          detail: result.summary
        });

        return;
      }

      if (result.status === "error") {
        copilotAutoError = result.summary;
        delegationStore.setError(result.summary);
        pushDelegationEvent("error", result.summary, { actionRequired: true });

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
        pushDelegationEvent("error", copilotAutoError, { actionRequired: true });

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
    delegationStore.setError("自律実行をキャンセルしました。");
    pushDelegationEvent("error", "自律実行をキャンセルしました。", {
      actionRequired: true
    });

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
            pushDelegationEvent("copilot_turn", `Copilot へ問い合わせています (turn ${turn})`);

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
            pushDelegationEvent("copilot_turn", `Copilot が応答しました (turn ${turn})`, {
              detail: response.summary,
              expandable: false
            });

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
              pushDelegationEvent("tool_executed", `Turn ${turn}: ${toolResult.tool}`, {
                detail: summarizeToolResult(toolResult)
              });

            }
          },
          onPlanProposed: (plan) => {
            agentLoopResult = null;
            planSteps = [...plan.steps];
            delegationStore.proposePlan(plan);
            pushDelegationEvent("plan_proposed", "実行計画が提案されました。", {
              detail: plan.summary,
              actionRequired: true
            });

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
            pushDelegationEvent("error", `Copilot 応答の再試行 ${retryLevel}`, {
              detail: error,
              expandable: false
            });

          },
          onManualFallback: (turn, _fallbackPrompt, error) => {
            const message = `Copilot の構造化応答を確定できなかったため停止しました: ${error}`;
            pushAgentLoopLog(
              `copilot.manual-fallback.${turn}`,
              `Turn ${turn}: 自動処理を停止`,
              "error",
              {
                detail: message,
                errorMessage: message,
                endTime: Date.now()
              }
            );
            copilotAutoError = message;
            pushDelegationEvent("error", message, {
              expandable: true,
              actionRequired: true
            });
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
              parsedResponse,
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
            delegationStore.requestApproval();
            pushDelegationEvent("write_approval_requested", "プロジェクト範囲外アクセスの承認が必要です。", {
              detail: `${tool}\n許可されたルート: ${rootFolder}\n${violations.join("\n")}`,
              expandable: true,
              actionRequired: true
            });

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
        return;
      }

      if (result.status === "ready_to_write" && result.finalResponse) {
        const rawResponse = stringifyStructuredResponse(result.finalResponse);
        await recordStructuredResponse({
          sessionId,
          turnId,
          rawResponse,
          parsedResponse: result.finalResponse
        });
        const previewResult = await openPreviewFromStructuredResponse(result.finalResponse, {
          rawResponse,
          scopeApprovalSource: "agent-loop"
        });
        if (previewResult.blockedByScope) {
          copilotAutoError = previewResult.message;
          delegationStore.requestApproval();
          pushDelegationEvent("write_approval_requested", "プロジェクト範囲外アクセスの承認が必要です。", {
            detail: `${selectedProject?.rootFolder ?? "未設定"}\n${scopeApprovalViolations.join("\n")}`,
            expandable: true,
            actionRequired: true
          });
          return;
        }
        if (previewResult.preview.autoApproved) {
          delegationStore.resumeExecution();
          pushDelegationEvent("write_approved", "現在の承認ポリシーで自動承認されました。", {
            detail: `${previewResult.preview.approvalPolicy} / ${previewResult.preview.highestRisk}`,
            badgeLabel: "自動承認済み"
          });
          await handleReviewSaveStage();
          return;
        }
        delegationStore.requestApproval();
        pushDelegationEvent("write_approval_requested", "保存前の確認が必要です。", {
          detail: previewSummary,
          actionRequired: true
        });
        return;
      }

      if (result.status === "error") {
        copilotAutoError = result.summary;
        delegationStore.setError(result.summary);
        pushDelegationEvent("error", result.summary, { actionRequired: true });

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
        delegationStore.setError(agentLoopSummary);
        pushDelegationEvent("error", agentLoopSummary, { actionRequired: true });

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
        delegationStore.setError(copilotAutoError);
        pushDelegationEvent("error", copilotAutoError, { actionRequired: true });

      }
    } finally {
      isSendingToCopilot = false;
      sendStatusMessage = "";
      agentLoopRunning = false;
      agentLoopAbortController = null;
    }
  }

  function resetAll(): void {
    if (sessionId) {
      discardStudioDraft(sessionId);
    }
    discardDelegationDraft();
    delegationStore.reset();
    activityFeedStore.clear();

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
    copilotInstructionText = "";
    copiedBrowserCommandNotice = "";
    handoffCaution = null;
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
  }

  async function handleSetupStage(): Promise<void> {
    errorMsg = "";
    copiedBrowserCommandNotice = "";
    copilotAutoError = null;
    handoffCaution = null;
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
      sessionId = session.id;
      if (selectedProjectId) {
        await linkSessionToProject({
          projectId: selectedProjectId,
          sessionId: session.id
        });
        await refreshProjects();
        projectInfoMsg = "新しいセッションを現在のプロジェクトに紐付けました。";
      }
      await persistStagedInboxFiles(session.id);
      await syncInboxFilesFromSession(session.id);
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
      try {
        const handoff = await assessCopilotHandoff({
          sessionId: session.id,
          turnId: turnResponse.turn.id
        });
        if (handoff.status === "caution") {
          handoffCaution = {
            headline: handoff.headline,
            reasons: handoff.reasons.map((reason) => ({
              text: `${reason.label}: ${reason.detail}`,
              source: reason.source
            }))
          };
        } else {
          handoffCaution = null;
        }
      } catch {
        handoffCaution = null;
      }
      markProgress(4, "done");
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

  async function openPreviewFromStructuredResponse(
    parsedResponse: CopilotTurnResponse,
    options: {
      allowScopeOverride?: boolean;
      rawResponse?: string;
      scopeApprovalSource?: ScopeApprovalSource;
    } = {}
  ): Promise<
    | { blockedByScope: true; message: string }
    | { blockedByScope: false; preview: Awaited<ReturnType<typeof previewExecution>> }
  > {
    const scopeViolations = validateProjectScopeActions(
      (parsedResponse.actions ?? []) as Array<{
        tool: string;
        args: Record<string, unknown>;
      }>,
      selectedProject?.rootFolder ?? ""
    );
    if (scopeViolations.length > 0 && !options.allowScopeOverride) {
      const firstViolation = scopeViolations[0];
      openScopeApproval({
        source: options.scopeApprovalSource ?? "manual",
        rootFolder: selectedProject?.rootFolder ?? "",
        violations: scopeViolations,
        responseSummary:
          parsedResponse.message ??
          parsedResponse.summary ??
          "Copilot がプロジェクトルート外へのファイル操作を提案しました。",
        parsedResponse,
        rawResponse: options.rawResponse
      });

      return {
        blockedByScope: true,
        message: `プロジェクトスコープ外のファイルアクセスが含まれています: ${firstViolation}`
      };
    }

    const preview = await previewExecution({ sessionId, turnId });
    const diff = preview.diffSummary;
    previewSummary =
      parsedResponse.summary ??
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
    previewArtifacts =
      preview.artifacts.length > 0
        ? preview.artifacts
        : wrapLegacyPreviewArtifacts(
            diff,
            preview.fileWriteActions as FileWritePreviewAction[]
          );
    previewRequiresApproval = preview.requiresApproval;
    previewChangeDetails = diff.sheets.map((sheet) => {
      const changedColumns =
        sheet.changedColumns.length > 0
          ? `変更列: ${sheet.changedColumns.join("、")}`
          : "変更列の追加情報はありません。";
      return `${sheet.target.label} / ${sheet.estimatedAffectedRows} 行 / ${changedColumns}`;
    });
    showDetailedChanges = false;

    return { blockedByScope: false, preview };
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
      delegationStore.resumeExecution();
      pushDelegationEvent("write_approved", "書き込みを承認しました。");


      const result = await runExecution({ sessionId, turnId });
      if (result.outputPath) {
        previewOutputPath = result.outputPath;
      }
      if (result.artifacts.length > 0) {
        previewArtifacts = result.artifacts;
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

      const qualitySourcePath =
        previewArtifacts.find((artifact) => artifact.sourcePath.trim())?.sourcePath ||
        filePath;
      const qualityOutputPath =
        result.outputPath ||
        result.outputPaths[0] ||
        previewArtifacts.find((artifact) => artifact.outputPath.trim())?.outputPath ||
        previewOutputPath;
      if (qualitySourcePath.trim() && qualityOutputPath.trim()) {
        try {
          const qualityResult = await validateOutputQuality({
            sourcePath: qualitySourcePath,
            outputPath: qualityOutputPath
          });
          if (qualityResult.passed) {
            activityFeedStore.push({
              type: "completed",
              message: `品質チェック通過（${qualityResult.checks.length} 項目）`,
              icon: "✅"
            });
          } else {
            activityFeedStore.push({
              type: "error",
              message: `品質チェック警告: ${qualityResult.warnings.join(" / ") || "失敗項目があります。"}`,
              icon: "⚠",
              detail: qualityResult.checks
                .filter((check) => !check.passed)
                .map((check) => `${check.name}: ${check.detail}`)
                .join("\n"),
              expandable: true
            });
          }
        } catch (error) {
          activityFeedStore.push({
            type: "error",
            message: "品質チェックを完了できませんでした。",
            icon: "⚠",
            detail: toError(error),
            expandable: true
          });
        }
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
      delegationStore.complete();
      pushDelegationEvent("completed", "保存と自律実行が完了しました。", {
        detail: executionSummary
      });

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
    if (!scopeApprovalVisible || !scopeApprovalResponse) {
      return;
    }

    if (currentPlanStepId) {
      pendingPlan = getRemainingPlanAfterCurrentStep();
    }
    pushDelegationEvent("write_approved", "プロジェクト範囲外アクセスを承認しました。");


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
    const approvedResponse = scopeApprovalResponse;
    const approvedRawResponse = scopeApprovalRawResponse;
    const approvedSource = scopeApprovalSource ?? "manual";
    clearScopeApproval();

    const previewResult = await openPreviewFromStructuredResponse(approvedResponse, {
      allowScopeOverride: true,
      rawResponse: approvedRawResponse,
      scopeApprovalSource: approvedSource
    });
    requestTurnInspectionRefresh();
    requestProjectApprovalAuditRefresh();
    if (previewResult.blockedByScope) {
      errorMsg = previewResult.message;
      copilotAutoError = previewResult.message;
      return;
    }
    if (previewResult.preview.autoApproved) {
      delegationStore.resumeExecution();
      pushDelegationEvent("write_approved", "現在の承認ポリシーで自動承認されました。", {
        detail: `${previewResult.preview.approvalPolicy} / ${previewResult.preview.highestRisk}`,
        badgeLabel: "自動承認済み"
      });
      await handleReviewSaveStage();
      return;
    }
    delegationStore.requestApproval();
    pushDelegationEvent("write_approval_requested", "保存前の確認が必要です。", {
      detail: previewSummary,
      actionRequired: true
    });
  }

  function handleBackFromScopeApproval(): void {
    errorMsg = "";
    copilotAutoError = null;
    clearScopeApproval();
    pushDelegationEvent("error", "プロジェクト範囲外アクセスの承認を保留しました。", {
      actionRequired: true
    });

  }

  function handleGlobalKeydown(event: KeyboardEvent): void {

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

      void handleReviewSaveStage();
    }
  }

  onMount(() => {
    // Initialize theme from storage or OS preference
    const savedTheme = localStorage.getItem("ra-theme");
    if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      darkMode = true;
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }

    // Panel shortcuts
    function handleCommandPaletteShortcut(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        commandPaletteOpen = !commandPaletteOpen;
      }
      // ⌘\ — toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        sidebarCollapsed = !sidebarCollapsed;
      }
      // ⌘/ — toggle context panel
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        showContextPanel = !showContextPanel;
      }
    }
    window.addEventListener("keydown", handleCommandPaletteShortcut);

    window.addEventListener("keydown", handleGlobalKeydown);
    const unlistenFns: Array<() => void> = [];

    void (async () => {
      await bindAgentUi();
      unlistenFns.push(
        await listen<PipelineStepUpdateEvent & { pipelineId?: string; error?: string }>(
          "pipeline:step_update",
          (event) => {
            if (event.payload.error) {
              errorMsg = event.payload.error;
              return;
            }

            activePipeline = event.payload.pipeline;
          }
        )
      );
      unlistenFns.push(
        await listen<BatchTargetUpdateEvent & { batchId?: string; error?: string }>(
          "batch:target_update",
          (event) => {
            if (event.payload.error) {
              errorMsg = event.payload.error;
              return;
            }

            activeBatchJob = event.payload.batchJob;
          }
        )
      );

      loadExpertDetails();
      showWelcome = !hasSeenWelcome();
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
      approvalPolicy = saveApprovalPolicy(loadApprovalPolicy());

      try {
        await pingDesktop();
        const app = await initializeApp();
        startupIssue = app.startupIssue ?? null;
        storagePath = app.storagePath ?? null;
        sampleWorkbookPath = app.sampleWorkbookPath ?? null;
        await refreshProjects();
        await refreshSessions();
        await refreshTools();
        await syncApprovalPolicy();
        await refreshWorkflowTemplates();
        refilterTemplates();
        if (!app.storagePath) {
          await applySavedToolSettings();
        }
      } catch (error) {
        errorMsg = toError(error);
      }

      refreshContinuityState();

      const delegationDraft = loadDelegationDraft();
      if (delegationDraft) {
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
          pipelineInitialInputPath = delegationDraft.attachedFiles[0];
        }
        if (delegationDraft.goal) {
          updateObjective(delegationDraft.goal);
        }
      }
    })();

    return () => {
      window.removeEventListener("keydown", handleGlobalKeydown);
      disposeAgentUi();
      for (const unlisten of unlistenFns) {
        unlisten();
      }
    };
  });

  $: agentFeedEntries = $feedStore.map(mapAgentFeedEntry);
  $: if (!pipelineInitialInputPath && filePath) {
    pipelineInitialInputPath = filePath;
  }
  $: {
    workflowTemplates;
    templateSearchQuery;
    templateCategory;
    refilterTemplates();
  }
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
  $: persistDelegationDraft();
  $: scopeApprovalArtifacts = turnInspectionArtifacts.filter(
    (
      artifact: ReadTurnArtifactsResponse["artifacts"][number]
    ): artifact is ScopeApprovalArtifactRecord => artifact.artifactType === "scope-approval"
  );
  $: inspectionOutputArtifacts = collectInspectionOutputArtifacts(turnInspectionArtifacts);
  $: if (expertDetailsOpen && sessionId && turnId && turnInspectionRefreshNonce >= 0) {
    void refreshTurnInspection();
  }

  $: copilotInstructionText =
    filePath.trim()
      ? buildCopilotInstructionText(
          objectiveText.trim(),
          filePath,
          taskName.trim() || deriveTitle(objectiveText),
          workbookProfile,
          workbookColumnProfiles,
          currentAllowedTools(),
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
          artifacts: previewArtifacts,
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

<!-- Command Palette -->
<CommandPalette
  open={commandPaletteOpen}
  recentSessions={recentSessions.map((s) => ({ id: s.sessionId, title: s.title ?? s.sessionId }))}
  on:close={() => (commandPaletteOpen = false)}
  on:action={handleCommandPaletteAction}
/>

<!-- Toast Notifications -->
<Toast {toasts} onDismiss={(id) => { toasts = toasts.filter(t => t.id !== id); }} />

{#if showWelcome}
  <div class="welcome-overlay">
    <div class="welcome-card">
      <div class="welcome-logo">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2 L22 8.5 L22 15.5 L12 22 L2 15.5 L2 8.5 Z" />
          <path d="M12 22 L12 15.5" />
          <path d="M22 8.5 L12 15.5 L2 8.5" />
        </svg>
      </div>
      <h1 class="welcome-title">Relay Agent</h1>
      <p class="welcome-subtitle">
        Copilot があなたの代わりに、<br />表計算を自動化します
      </p>
      <div class="welcome-steps">
        <div class="welcome-step">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6"/><path d="M9 13h6"/></svg>
          <span class="welcome-step-label">ファイルを選ぶ</span>
        </div>
        <div class="welcome-step-arrow">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--c-text-3)" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </div>
        <div class="welcome-step">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" stroke-width="1.5"><path d="M12 2 L22 8.5 L22 15.5 L12 22 L2 15.5 L2 8.5 Z"/><path d="M12 22 L12 15.5"/><path d="M22 8.5 L12 15.5 L2 8.5"/></svg>
          <span class="welcome-step-label">Copilot が処理</span>
        </div>
        <div class="welcome-step-arrow">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--c-text-3)" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </div>
        <div class="welcome-step">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--c-success)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
          <span class="welcome-step-label">確認して保存</span>
        </div>
      </div>
      <button class="welcome-btn btn btn-primary btn-lg" type="button" on:click={startFromWelcome}>
        始める
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </button>
    </div>
  </div>
{/if}

<!-- 3-pane workspace -->
<div
  class="workspace"
  class:show-context={showContextPanel}
  class:hide-sidebar={sidebarCollapsed}
>

<!-- Sidebar Navigation -->
<div class="sidebar-wrap">
  <AppSidebar
    sessions={recentSessions.map(s => ({ id: s.sessionId, title: s.title || s.lastTurnTitle || "無題", updatedAt: s.lastOpenedAt }))}
    currentSessionId={sessionId ?? ""}
    currentProjectName={selectedProjectId ? (projects.find(p => p.id === selectedProjectId)?.name ?? "") : ""}
    on:selectSession={(e) => handleRecentSessionSelectById(e.detail.id)}
    on:newTask={() => void handleAgentReset()}
  />
</div>

<!-- Main Content Area -->
<main class="main-content main-col">

<header class="header">
  <div class="header-left">
    <span class="header-title">
      {#if activeNavView === "home"}ホーム
      {:else if activeNavView === "pipeline"}パイプライン
      {:else if activeNavView === "batch"}バッチ
      {:else if activeNavView === "template"}テンプレート
      {:else if activeNavView === "sessions"}セッション履歴
      {:else if activeNavView === "settings"}設定
      {/if}
    </span>
  </div>
  <div class="header-actions">
    <button
      class="header-cmd-palette btn btn-ghost btn-sm"
      type="button"
      on:click={() => (commandPaletteOpen = true)}
      aria-label="コマンドパレット"
      data-tooltip="Ctrl+K"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
    <button
      class="header-settings btn btn-ghost btn-sm"
      type="button"
      on:click={() => { settingsOpen = !settingsOpen; if (settingsOpen) activeNavView = "settings"; }}
      aria-label="設定を開く"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
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
      {#if $sessionStore.status === "completed"}
        <CompletionCard
          summary={extractLatestAssistantText($sessionStore.messages) || executionSummary || previewSummary}
          outputPath={currentAgentOutputPath()}
          canSaveTemplate={Boolean(sessionId)}
          on:openOutput={() => {
            void openOutputFile();
          }}
          on:saveTemplate={() => {
            void handleSaveCurrentSessionAsTemplate();
          }}
          on:reset={() => {
            void handleAgentReset();
          }}
        />
      {:else}
        <UnifiedFeed entries={agentFeedEntries} isRunning={$sessionStore.running} />
      {/if}
    </section>

    <div class="delegation-intervention">
      {#if $approvalStore.pending}
        <ApprovalCard
          phase="write"
          previewSummary={`ツール ${$approvalStore.pending.toolName} の実行許可を待っています。`}
          previewOutputPath={$approvalStore.pending.target ?? ""}
          previewWarnings={[
            $approvalStore.pending.description,
            ...($approvalStore.pending.target ? [`target: ${$approvalStore.pending.target}`] : [])
          ]}
          reviewStepAvailable={true}
          on:approve={() => {
            void handleAgentApprovalDecision(true);
          }}
          on:back={() => {
            void handleAgentApprovalDecision(false);
          }}
        />
      {:else if $sessionStore.status === "error" || $sessionStore.status === "cancelled"}
        <section class="card card-warn">
          <strong>{$sessionStore.status === "cancelled" ? "エージェントをキャンセルしました" : "エージェントでエラーが発生しました"}</strong>
          <p>{$sessionStore.lastError || "実行結果を Unified Feed で確認してください。"}</p>
          {#if $sessionStore.lastStopReason}
            <p>stop: {$sessionStore.lastStopReason}</p>
          {/if}
          <div class="inline-actions">
            <button class="btn btn-secondary" type="button" on:click={() => resetAgentUi()}>
              閉じる
            </button>
            <button class="btn btn-primary" type="button" on:click={() => { void handleAgentReset(); }}>
              最初からやり直す
            </button>
          </div>
        </section>
      {/if}
    </div>
  </section>

  <section class="automation-workbench card">
    <div class="automation-tabs">
      <button class:is-active={automationTab === "pipeline"} type="button" on:click={() => (automationTab = "pipeline")}>
        パイプライン
      </button>
      <button class:is-active={automationTab === "batch"} type="button" on:click={() => (automationTab = "batch")}>
        バッチ
      </button>
      <button class:is-active={automationTab === "template"} type="button" on:click={() => (automationTab = "template")}>
        テンプレート
      </button>
    </div>

    {#if automationTab === "pipeline"}
      <PipelineBuilder
        pipelineTitle={pipelineTitle}
        initialInputPath={pipelineInitialInputPath || filePath}
        steps={pipelineDraftSteps}
        busy={busy}
        onPipelineTitleChange={(value) => (pipelineTitle = value)}
        onInitialInputPathChange={(value) => (pipelineInitialInputPath = value)}
        onAddStep={addPipelineStep}
        onUpdateStepGoal={(index, value) =>
          (pipelineDraftSteps = normalizePipelineSteps(
            pipelineDraftSteps.map((step, candidate) =>
              candidate === index ? { ...step, goal: value } : step
            )
          ))}
        onUpdateStepInputSource={(index, value) =>
          (pipelineDraftSteps = normalizePipelineSteps(
            pipelineDraftSteps.map((step, candidate) =>
              candidate === index ? { ...step, inputSource: value } : step
            )
          ))}
        onMoveStep={movePipelineDraftStep}
        onRemoveStep={removePipelineDraftStep}
        onStart={() => {
          void handlePipelineStart();
        }}
      />
      <PipelineProgress pipeline={activePipeline} events={$activityFeedStore} />
      {#if activePipeline?.status === "running"}
        <button
          class="btn btn-secondary"
          type="button"
          on:click={() => {
            if (activePipeline) {
              void pipelineCancel({ pipelineId: activePipeline.id });
            }
          }}
        >
          パイプライン停止
        </button>
      {/if}
    {:else if automationTab === "batch"}
      <BatchTargetSelector
        goal={batchGoal}
        targets={batchTargets}
        busy={busy}
        onGoalChange={(value) => (batchGoal = value)}
        onTargetsChange={(value) => (batchTargets = value)}
        onStart={() => {
          void handleBatchStart();
        }}
      />
      <BatchDashboard
        batchJob={activeBatchJob}
        onOpenOutputDir={() => {
          if (activeBatchJob?.outputDir) {
            void open(activeBatchJob.outputDir);
          }
        }}
        onSkipTarget={(path) => {
          void handleBatchSkip(path);
        }}
      />
    {:else}
      <TemplateBrowser
        templates={filteredTemplates}
        activeCategory={templateCategory}
        searchQuery={templateSearchQuery}
        onCategoryChange={(value) => {
          templateCategory = value;
          void refreshWorkflowTemplates();
        }}
        onSearchChange={(value) => (templateSearchQuery = value)}
        onSelect={handleTemplateSelect}
        onDelete={(template) => {
          void handleTemplateDelete(template);
        }}
      />
    {/if}
  </section>

  <div class="delegation-composer-wrap">
    <TaskInput
      recentFiles={recentFiles}
      suggestions={delegationSuggestions}
      disabled={busy}
      mode={$sessionStore.running ? "busy" : $sessionStore.sessionId ? "active" : "idle"}
      initialGoal={objectiveText}
      initialFiles={filePath ? [filePath] : []}
      on:submit={handleAgentTaskSubmit}
      on:reset={() => {
        void handleAgentReset();
      }}
    />
  </div>

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
  bind:approvalPolicy
  {cdpTestStatus}
  {cdpTestMessage}
  {copiedBrowserCommandNotice}
  {tools}
  {toolInfoMessage}
  {toolErrorMessage}
  bind:mcpServerUrl
  bind:mcpServerName
  bind:mcpTransport
  {connectingMcp}
  edgeLaunchCommand={getEdgeLaunchCommand()}
  autoPortRangeLabel={`ポート ${AUTO_CDP_PORT_RANGE_START}-${AUTO_CDP_PORT_RANGE_END} から自動選択されます`}
  {storagePath}
  onClose={() => (settingsOpen = false)}
  onToggleAutoLaunch={() => {
    autoLaunchEdge = !autoLaunchEdge;
    void persistSettings();
  }}
  onPersist={() => {
    void persistSettings();
  }}
  onCopyCommand={copyEdgeLaunchCommand}
  onTestConnection={testCdpConnection}
  onToggleTool={(toolId, enabled) => {
    void handleToolToggle(toolId, enabled);
  }}
  onConnectMcpServer={() => {
    void handleConnectMcpServer();
  }}
/>

</main>

<!-- Context Panel (right pane) -->
{#if showContextPanel}
  <div class="context-panel-wrap">
    <ContextPanel
      {inboxFiles}
      mcpServers={[]}
      approvalPolicy={{ scope: approvalPolicy === "safe" ? "ask" : "always", patterns: [] }}
      projectName={selectedProjectId ? (projects.find(p => p.id === selectedProjectId)?.name ?? "") : ""}
      on:addFile={(e) => { void handleInboxFileAdd(e.detail.path); }}
      on:removeFile={(e) => { void handleInboxFileRemove(e.detail.path); }}
    />
  </div>
{/if}

</div><!-- end .workspace -->

<!-- Status Strip -->
<StatusStrip
  connected={cdpTestStatus === "ok"}
  connecting={cdpTestStatus === "testing"}
  projectName={selectedProjectId
    ? (projects.find(p => p.id === selectedProjectId)?.name ?? "")
    : ""}
  on:connectionClick={() => void testCdpConnection()}
/>

<style>
  .main-content {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--c-canvas);
    min-width: 0;
  }

  .welcome-overlay {
    position: fixed;
    inset: 0;
    background: var(--c-canvas);
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .welcome-card {
    width: min(480px, calc(100vw - var(--sp-8)));
    padding: var(--sp-12) var(--sp-8);
    text-align: center;
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: 16px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
  }

  .welcome-logo {
    font-size: var(--sz-xl);
    margin-bottom: var(--sp-4);
    line-height: 1;
  }

  .welcome-title {
    margin: 0 0 var(--sp-2);
    font-size: var(--sz-xl);
    font-weight: 700;
    font-family: var(--font-sans);
    color: var(--c-text);
  }

  .welcome-subtitle {
    margin: 0 0 var(--sp-10);
    font-size: var(--sz-lg);
    line-height: 1.45;
    color: var(--c-text-3);
  }

  .welcome-steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-10);
  }

  .welcome-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-1);
  }

  .welcome-step-label {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    white-space: nowrap;
  }

  .welcome-step-arrow {
    color: var(--c-accent);
    font-size: var(--sz-lg);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding-top: var(--sp-3);
    margin-bottom: var(--sp-2);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .header-title {
    font-size: 1.25rem;
    font-weight: 700;
    font-family: var(--font-sans);
    color: var(--c-text);
  }




  .project-strip {
    margin-bottom: var(--sp-4);
    padding-bottom: var(--sp-4);
    border-bottom: 1px solid var(--c-border-strong);
  }

  .project-audit-card {
    margin-top: var(--sp-4);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--c-border-strong);
  }

  .project-audit-header,
  .project-audit-topline,
  .project-audit-badges,
  .project-audit-actions {
    display: flex;
    gap: var(--sp-3);
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
    font-size: var(--sz-base);
    font-weight: 700;
  }

  .project-audit-copy {
    margin: var(--sp-1) 0 0;
    color: var(--c-text-3);
    font-size: var(--sz-sm);
    word-break: break-word;
  }

  .project-audit-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-3);
    margin-top: var(--sp-3);
  }

  .project-audit-row {
    padding: var(--sp-3);
    border: 1px solid var(--c-border-strong);
    border-radius: 16px;
    background: var(--c-surface);
  }

  .project-audit-badge {
    display: inline-flex;
    align-items: center;
    border-radius: var(--r-full);
    padding: var(--sp-1) var(--sp-2);
    font-size: var(--sz-xs);
    font-weight: 700;
    border: 1px solid var(--c-border-strong);
    background: #f0eeea;
    color: var(--c-text-2);
  }

  .project-audit-badge[data-tone="approved"] {
    border-color: var(--c-success-subtle);
    background: var(--c-success-subtle);
    color: var(--c-success);
  }

  .project-audit-badge[data-tone="rejected"] {
    border-color: var(--c-error-subtle);
    background: var(--c-error-subtle);
    color: var(--c-error);
  }

  .project-audit-badge[data-tone="pending"] {
    border-color: var(--c-warning-subtle);
    background: var(--c-warning-subtle);
    color: var(--c-warning);
  }

  .project-audit-badge[data-tone="not-required"],
  .project-audit-badge[data-tone="none"] {
    border-color: var(--c-border-strong);
    background: #f0eeea;
    color: var(--c-text-2);
  }

  .delegation-shell {
    display: grid;
    grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(280px, 360px);
    gap: var(--sp-4);
    min-height: calc(100vh - 14rem);
  }

  .delegation-sidebar,
  .delegation-main {
    min-height: 0;
  }

  .delegation-sidebar-note {
    margin-top: var(--sp-4);
    padding-top: var(--sp-4);
    border-top: 1px solid var(--c-border-strong);
    color: var(--c-text-3);
    font-size: var(--sz-sm);
  }

  .delegation-composer-wrap {
    position: sticky;
    bottom: 0;
    padding: var(--sp-2) var(--sp-4) var(--sp-4);
    background: var(--c-canvas);
    z-index: 10;
    flex-shrink: 0;
  }
</style>
