<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
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
    AgentApprovalNeededEventPayload,
    AgentErrorEventPayload,
    AgentToolResultEventPayload,
    AgentToolStartEventPayload,
    AgentTurnResponse,
    AgentTurnCompleteEventPayload,
    DiffSummary,
    McpTransport,
    McpServerConfig,
    OutputArtifact,
    Pipeline,
    PipelineInputSource,
    PipelineStep,
    PipelineStepUpdateEvent,
    Project,
    ReadTurnArtifactsResponse,
    Session,
    StartupIssue,
    ToolRegistration,
    TurnDetailsViewModel,
    WorkflowTemplate,
    WorkflowTemplateCategory
  } from "@relay-agent/contracts";
  import {
    addInboxFile,
    addProjectMemory,
    batchCreate,
    batchGetStatus,
    batchRun,
    batchSkipTarget,
    connectMcpServer,
    createProject,
    discardDelegationDraft,
    discardStudioDraft,
    getFriendlyError,
    initializeApp,
    isWithinProjectScope,
    linkSessionToProject,
    listTools,
    listSessions,
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
    previewExecution,
    readTurnArtifacts,
    readSession,
    removeProjectMemory,
    removeInboxFile,
    rememberRecentFile,
    rememberRecentSession,
    respondToApproval,
    runExecution,
    validateOutputQuality,
    saveApprovalPolicy,
    saveBrowserAutomationSettings,
    saveDelegationDraft,
    saveSelectedProjectId,
    saveToolSettings,
    saveStudioDraft,
    setSessionProject,
    setApprovalPolicy,
    setToolEnabled,
    templateDelete,
    templateFromSession,
    templateList,
    validateProjectScopeActions,
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
  type AgentContentBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
    | { type: "tool_result"; toolUseId: string; content: string; isError: boolean };
  type AgentMessage = {
    role: "user" | "assistant";
    content: AgentContentBlock[];
  };
  type AgentSessionHistory = {
    sessionId: string;
    running: boolean;
    messages: AgentMessage[];
  };
  type AgentSessionStatus =
    | "idle"
    | "running"
    | "awaiting_approval"
    | "completed"
    | "error"
    | "cancelled";
  type AgentSessionState = {
    sessionId: string | null;
    running: boolean;
    status: AgentSessionStatus;
    messages: AgentMessage[];
    lastStopReason: string | null;
    lastError: string | null;
  };
  type AgentPendingApproval = {
    sessionId: string;
    approvalId: string;
    toolName: string;
    description: string;
    target?: string;
    input: unknown;
  };
  type AgentApprovalState = {
    pending: AgentPendingApproval | null;
  };
  type AgentFeedEntryType =
    | "session_started"
    | "tool_start"
    | "tool_result"
    | "approval_needed"
    | "turn_complete"
    | "error";
  type AgentFeedEntry = {
    id: string;
    sessionId: string;
    type: AgentFeedEntryType;
    title: string;
    detail?: string;
    toolName?: string;
    toolUseId?: string;
    isError?: boolean;
    timestamp: string;
  };
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
  const MAX_AGENT_FEED_ENTRIES = 200;
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
  const TOOL_ARGS_REFERENCE = `file.copy   : { "tool": "file.copy", "args": { "sourcePath": "/path/to/source.txt", "destPath": "/path/to/copy.txt" } }
file.move   : { "tool": "file.move", "args": { "sourcePath": "/path/to/source.txt", "destPath": "/path/to/moved.txt" } }
file.delete : { "tool": "file.delete", "args": { "path": "/path/to/file.txt", "toRecycleBin": true } }
text.replace: { "tool": "text.replace", "args": { "path": "/path/to/file.txt", "pattern": "old", "replacement": "new", "createBackup": true } }
重要: すべての引数は args の中に書いてください。`;

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

  let filePath = "";
  let objectiveText = "";
  let taskName = "";
  let taskNameEdited = false;
  let selectedTemplateKey: TemplateKey | null = null;
  let sessionId = "";
  let turnId = "";
  let copilotInstructionText = "";
  let copiedBrowserCommandNotice = "";
  let isSendingToCopilot = false;
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
  let maxTurns = 10;
  let approvalPolicy: ApprovalPolicy = "safe";

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
  let scopeApprovalResponse: AgentTurnResponse | null = null;
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
  let agentFeedState: AgentFeedEntry[] = [];
  let agentSessionState: AgentSessionState = {
    sessionId: null,
    running: false,
    status: "idle",
    messages: [],
    lastStopReason: null,
    lastError: null
  };
  let agentApprovalState: AgentApprovalState = {
    pending: null
  };
  let activeAgentSessionId: string | null = null;
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

  function openScopeApproval(options: {
    source: ScopeApprovalSource;
    rootFolder: string;
    violations: string[];
    responseSummary: string;
    parsedResponse: AgentTurnResponse;
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

  function buildExpectedResponseTemplate(): string {
    return `{
  "version": "1.0",
  "status": "ready_to_write",
  "summary": "何をするかを短く説明する",
  "actions": []
}`;
  }

  function buildCopilotInstructionText(
    objective: string,
    title: string,
    attachedFiles: string[],
    availableTools: ToolRegistration[],
    projectContext = ""
  ): string {
    const toolLines = availableTools.map(
      (tool) => `- ${tool.id}: ${tool.description}`
    );
    const fileLines =
      attachedFiles.length > 0
        ? attachedFiles.map((path) => `- ${path}`)
        : ["- 添付ファイルなし"];

    return [
      "Relay Agent からの依頼です。",
      "",
      ...(projectContext.trim() ? [projectContext.trim(), ""] : []),
      "1. やりたいこと",
      `- 作業名: ${title}`,
      `- 目的: ${objective}`,
      "",
      "2. 対象ファイル",
      ...fileLines,
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
      "- 上にない tool は使わないでください。",
      "",
      "6. 回答テンプレート",
      buildExpectedResponseTemplate()
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

  function resetAgentLoopState(): void {}

  function resetPlanExecutionState(): void {}

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
      lastUpdatedAt: new Date().toISOString()
    });
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

  function stringifyStructuredResponse(response: AgentTurnResponse): string {
    return JSON.stringify(response, null, 2);
  }

  function nextAgentFeedEntryId(): string {
    return typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function isActiveAgentSession(sessionId: string): boolean {
    return activeAgentSessionId === sessionId;
  }

  function pushAgentFeed(
    entry: Omit<AgentFeedEntry, "id" | "timestamp">
  ): void {
    agentFeedState = [
      ...agentFeedState,
      {
        ...entry,
        id: nextAgentFeedEntryId(),
        timestamp: new Date().toISOString()
      }
    ].slice(-MAX_AGENT_FEED_ENTRIES);
  }

  function resetAgentUiState(): void {
    activeAgentSessionId = null;
    agentFeedState = [];
    agentApprovalState = {
      pending: null
    };
    agentSessionState = {
      sessionId: null,
      running: false,
      status: "idle",
      messages: [],
      lastStopReason: null,
      lastError: null
    };
  }

  async function refreshAgentSessionHistory(
    sessionId: string | null = activeAgentSessionId
  ): Promise<AgentSessionHistory | null> {
    if (!sessionId) {
      return null;
    }

    const history = await invoke<AgentSessionHistory>("get_session_history", {
      request: { sessionId }
    });
    if (!isActiveAgentSession(history.sessionId)) {
      return history;
    }

    agentSessionState = {
      ...agentSessionState,
      sessionId: history.sessionId,
      running: history.running,
      messages: history.messages
    };
    return history;
  }

  async function handleAgentToolStart(
    payload: AgentToolStartEventPayload
  ): Promise<void> {
    if (!isActiveAgentSession(payload.sessionId)) {
      return;
    }

    pushAgentFeed({
      sessionId: payload.sessionId,
      type: "tool_start",
      title: `ツール開始: ${payload.toolName}`,
      detail: payload.toolUseId,
      toolName: payload.toolName,
      toolUseId: payload.toolUseId
    });
  }

  async function handleAgentToolResult(
    payload: AgentToolResultEventPayload
  ): Promise<void> {
    if (!isActiveAgentSession(payload.sessionId)) {
      return;
    }

    pushAgentFeed({
      sessionId: payload.sessionId,
      type: "tool_result",
      title: payload.isError
        ? `ツール失敗: ${payload.toolName}`
        : `ツール完了: ${payload.toolName}`,
      detail: payload.content,
      toolName: payload.toolName,
      toolUseId: payload.toolUseId,
      isError: payload.isError
    });
    await refreshAgentSessionHistory(payload.sessionId);
  }

  async function handleAgentApprovalNeeded(
    payload: AgentApprovalNeededEventPayload
  ): Promise<void> {
    if (!isActiveAgentSession(payload.sessionId)) {
      return;
    }

    agentApprovalState = {
      pending: {
        sessionId: payload.sessionId,
        approvalId: payload.approvalId,
        toolName: payload.toolName,
        description: payload.description,
        target: payload.target,
        input: payload.input
      }
    };
    agentSessionState = {
      ...agentSessionState,
      status: "awaiting_approval"
    };
    pushAgentFeed({
      sessionId: payload.sessionId,
      type: "approval_needed",
      title: `承認待ち: ${payload.toolName}`,
      detail: payload.target ?? payload.description,
      toolName: payload.toolName
    });
  }

  async function handleAgentTurnComplete(
    payload: AgentTurnCompleteEventPayload
  ): Promise<void> {
    if (!isActiveAgentSession(payload.sessionId)) {
      return;
    }

    agentApprovalState = {
      pending: null
    };
    agentSessionState = {
      ...agentSessionState,
      running: false,
      status: "completed",
      lastStopReason: payload.stopReason
    };
    pushAgentFeed({
      sessionId: payload.sessionId,
      type: "turn_complete",
      title: "エージェントが完了しました",
      detail: payload.assistantMessage
    });
    await refreshAgentSessionHistory(payload.sessionId);
  }

  async function handleAgentError(
    payload: AgentErrorEventPayload
  ): Promise<void> {
    if (!isActiveAgentSession(payload.sessionId)) {
      return;
    }

    agentApprovalState = {
      pending: null
    };
    agentSessionState = {
      ...agentSessionState,
      running: false,
      status: payload.cancelled ? "cancelled" : "error",
      lastError: payload.error
    };
    pushAgentFeed({
      sessionId: payload.sessionId,
      type: "error",
      title: payload.cancelled
        ? "エージェントをキャンセルしました"
        : "エージェントでエラーが発生しました",
      detail: payload.error,
      isError: true
    });
    await refreshAgentSessionHistory(payload.sessionId);
  }

  async function bindAgentEventListeners(): Promise<Array<() => void>> {
    return Promise.all([
      listen<AgentToolStartEventPayload>("agent:tool_start", (event) => {
        void handleAgentToolStart(event.payload);
      }),
      listen<AgentToolResultEventPayload>("agent:tool_result", (event) => {
        void handleAgentToolResult(event.payload);
      }),
      listen<AgentApprovalNeededEventPayload>("agent:approval_needed", (event) => {
        void handleAgentApprovalNeeded(event.payload);
      }),
      listen<AgentTurnCompleteEventPayload>("agent:turn_complete", (event) => {
        void handleAgentTurnComplete(event.payload);
      }),
      listen<AgentErrorEventPayload>("agent:error", (event) => {
        void handleAgentError(event.payload);
      })
    ]);
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
    resetAgentUiState();

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
    }

    try {
      const startedSessionId = await invoke<string>("start_agent", {
        request: {
        goal,
        files: attachedFiles,
        cwd: selectedProject?.rootFolder || undefined,
        browserSettings: {
          cdpPort,
          autoLaunchEdge,
          timeoutMs
        },
        maxTurns
        }
      });
      activeAgentSessionId = startedSessionId;
      agentSessionState = {
        sessionId: startedSessionId,
        running: true,
        status: "running",
        messages: [],
        lastStopReason: null,
        lastError: null
      };
      pushAgentFeed({
        sessionId: startedSessionId,
        type: "session_started",
        title: "エージェントを開始しました",
        detail: attachedFiles.length ? `${goal}\n${attachedFiles.join("\n")}` : goal
      });
      await refreshAgentSessionHistory(startedSessionId);
      sessionId = startedSessionId;
      await syncInboxFilesFromSession(startedSessionId);
      await refreshSessions();
    } catch (error) {
      copilotAutoError = toError(error);
      addToast(copilotAutoError, "error");
    }
  }

  async function handleAgentApprovalDecision(approved: boolean): Promise<void> {
    const pending = agentApprovalState.pending;
    if (!pending) {
      return;
    }

    try {
      await invoke("respond_approval", {
        request: {
          sessionId: pending.sessionId,
          approvalId: pending.approvalId,
          approved
        }
      });
      agentApprovalState = {
        pending: null
      };
      agentSessionState = {
        ...agentSessionState,
        status: approved ? "running" : agentSessionState.status
      };
      await refreshAgentSessionHistory();
    } catch (error) {
      copilotAutoError = toError(error);
      addToast(copilotAutoError, "error");
    }
  }

  async function handleAgentReset(): Promise<void> {
    if (agentSessionState.running && activeAgentSessionId) {
      try {
        await invoke("cancel_agent", {
          request: {
            sessionId: activeAgentSessionId
          }
        });
      } catch (error) {
        copilotAutoError = toError(error);
      }
    }

    resetAgentUiState();
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
      maxTurns
    });
    cdpPort = saved.cdpPort;
    autoLaunchEdge = saved.autoLaunchEdge;
    timeoutMs = saved.timeoutMs;
    maxTurns = saved.maxTurns;
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
    sessionId = "";
    turnId = "";
    copilotInstructionText = "";
    copiedBrowserCommandNotice = "";
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

  async function openPreviewFromStructuredResponse(
    parsedResponse: AgentTurnResponse,
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

      executionDone = true;
      delegationStore.complete();
      pushDelegationEvent("completed", "保存と自律実行が完了しました。", {
        detail: executionSummary
      });

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

  async function handleApproveScopeOverride(): Promise<void> {
    if (!scopeApprovalVisible || !scopeApprovalResponse) {
      return;
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
      if (agentSessionState.running) {
        void handleAgentReset();
      } else if (scopeApprovalVisible) {
        handleBackFromScopeApproval();
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
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
      unlistenFns.push(...(await bindAgentEventListeners()));
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
      maxTurns = browserAutomationSettings.maxTurns;
      approvalPolicy = saveApprovalPolicy(loadApprovalPolicy());

      try {
        await pingDesktop();
        const app = await initializeApp();
        startupIssue = app.startupIssue ?? null;
        storagePath = app.storagePath ?? null;
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
          attachedFiles: delegationDraft.attachedFiles
        });
        activityFeedStore.hydrate(delegationDraft.activityFeedSnapshot);
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
      for (const unlisten of unlistenFns) {
        unlisten();
      }
    };
  });

  $: agentFeedEntries = agentFeedState.map(mapAgentFeedEntry);
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
          taskName.trim() || deriveTitle(objectiveText),
          [filePath, ...inboxFiles.map((file) => file.path)].filter(
            (path, index, allPaths) => path.trim() && allPaths.indexOf(path) === index
          ),
          currentAllowedTools(),
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
      {#if agentSessionState.status === "completed"}
        <CompletionCard
          summary={extractLatestAssistantText(agentSessionState.messages) || executionSummary || previewSummary}
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
        <UnifiedFeed entries={agentFeedEntries} isRunning={agentSessionState.running} />
      {/if}
    </section>

    <div class="delegation-intervention">
      {#if agentApprovalState.pending}
        <ApprovalCard
          phase="write"
          previewSummary={`ツール ${agentApprovalState.pending.toolName} の実行許可を待っています。`}
          previewOutputPath={agentApprovalState.pending.target ?? ""}
          previewWarnings={[
            agentApprovalState.pending.description,
            ...(agentApprovalState.pending.target ? [`target: ${agentApprovalState.pending.target}`] : [])
          ]}
          reviewStepAvailable={true}
          on:approve={() => {
            void handleAgentApprovalDecision(true);
          }}
          on:back={() => {
            void handleAgentApprovalDecision(false);
          }}
        />
      {:else if agentSessionState.status === "error" || agentSessionState.status === "cancelled"}
        <section class="card card-warn">
          <strong>{agentSessionState.status === "cancelled" ? "エージェントをキャンセルしました" : "エージェントでエラーが発生しました"}</strong>
          <p>{agentSessionState.lastError || "実行結果を Unified Feed で確認してください。"}</p>
          {#if agentSessionState.lastStopReason}
            <p>stop: {agentSessionState.lastStopReason}</p>
          {/if}
          <div class="inline-actions">
            <button class="btn btn-secondary" type="button" on:click={() => resetAgentUiState()}>
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
      mode={agentSessionState.running ? "busy" : agentSessionState.sessionId ? "active" : "idle"}
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
