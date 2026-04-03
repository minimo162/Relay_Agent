import { browser } from "$app/environment";
import type {
  ApprovalPolicy,
  ExecutionPlan,
  McpServerConfig,
  OutputArtifact
} from "@relay-agent/contracts";

import type {
  ActivityFeedEvent,
  DelegationState
} from "./stores/delegation";
import type { CopilotConversationTurn } from "./prompt-templates";

type RelayMode = "discover" | "plan" | "repair" | "followup";
export type UiMode = "delegation";

const STORAGE_KEY = "relay-agent.continuity.v1";
const MAX_RECENT_SESSIONS = 6;
const MAX_RECENT_FILES = 6;
const MAX_AUDIT_HISTORY = 12;
const DEFAULT_BROWSER_AUTOMATION_SETTINGS = {
  cdpPort: 9333,
  autoLaunchEdge: true,
  timeoutMs: 60000,
  agentLoopEnabled: false,
  maxTurns: 10,
  loopTimeoutMs: 120000,
  planningEnabled: true,
  autoApproveReadSteps: true,
  pauseBetweenSteps: false
} as const;
const DEFAULT_TOOL_SETTINGS = {
  disabledToolIds: [],
  mcpServers: []
} as const;
const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = "safe";

export type PersistedPreviewSnapshot = {
  sourcePath: string;
  outputPath: string;
  targetCount: number;
  estimatedAffectedRows: number;
  warnings: string[];
  requiresApproval: boolean;
  artifacts: OutputArtifact[];
  fileWriteActions: Array<{
    tool: string;
    args: Record<string, unknown>;
  }>;
  lastGeneratedAt: string;
};

export type PersistedStudioDraft = {
  sessionId: string;
  selectedTurnId: string | null;
  selectedTurnTitle: string;
  turnTitle: string;
  turnObjective: string;
  relayMode: RelayMode;
  workbookPath: string;
  workbookFocus: string;
  previewSummary: string;
  approvalSummary: string;
  executionSummary: string;
  previewSnapshot: PersistedPreviewSnapshot | null;
  lastUpdatedAt: string;
  cleanShutdown: boolean;
};

export type RecentSession = {
  sessionId: string;
  title: string;
  workbookPath: string;
  lastOpenedAt: string;
  lastTurnTitle: string;
};

export type RecentFile = {
  path: string;
  lastUsedAt: string;
  sessionId: string | null;
  source: "session" | "draft" | "preflight";
};

export type AuditHistoryEntry = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  turnId: string | null;
  turnTitle: string;
  sourcePath: string;
  outputPath: string;
  executedAt: string;
  summary: string;
  targetCount: number;
  affectedRows: number;
  warnings: string[];
};

export type BrowserAutomationSettings = {
  cdpPort: number;
  autoLaunchEdge: boolean;
  timeoutMs: number;
  agentLoopEnabled: boolean;
  maxTurns: number;
  loopTimeoutMs: number;
  planningEnabled: boolean;
  autoApproveReadSteps: boolean;
  pauseBetweenSteps: boolean;
};

export type ToolSettings = {
  disabledToolIds: string[];
  mcpServers: McpServerConfig[];
};

export type PersistedDelegationDraft = {
  goal: string;
  attachedFiles: string[];
  activityFeedSnapshot: ActivityFeedEvent[];
  delegationState: DelegationState;
  planSnapshot: ExecutionPlan | null;
  conversationHistorySnapshot: CopilotConversationTurn[];
  currentStepIndex: number;
  lastUpdatedAt: string;
};

type ContinuityState = {
  version: 1;
  studioDrafts: Record<string, PersistedStudioDraft>;
  delegationDrafts: Record<string, PersistedDelegationDraft>;
  recentSessions: RecentSession[];
  recentFiles: RecentFile[];
  auditHistory: AuditHistoryEntry[];
  selectedProjectId: string | null;
  browserAutomation: BrowserAutomationSettings;
  toolSettings: ToolSettings;
  approvalPolicy: ApprovalPolicy;
};

function createDefaultState(): ContinuityState {
  return {
    version: 1,
    studioDrafts: {},
    delegationDrafts: {},
    recentSessions: [],
    recentFiles: [],
    auditHistory: [],
    selectedProjectId: null,
    browserAutomation: { ...DEFAULT_BROWSER_AUTOMATION_SETTINGS },
    toolSettings: {
      disabledToolIds: [],
      mcpServers: []
    },
    approvalPolicy: DEFAULT_APPROVAL_POLICY
  };
}

function readState(): ContinuityState {
  if (!browser) {
    return createDefaultState();
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY);
  if (!rawValue) {
    return createDefaultState();
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;

    return {
      version: 1,
      studioDrafts: normalizeDraftRecord(parsed.studioDrafts),
      delegationDrafts: normalizeDelegationDraftRecord(parsed.delegationDrafts),
      recentSessions: normalizeRecentSessions(parsed.recentSessions),
      recentFiles: normalizeRecentFiles(parsed.recentFiles),
      auditHistory: normalizeAuditHistory(parsed.auditHistory),
      selectedProjectId: asOptionalString(parsed.selectedProjectId),
      browserAutomation: normalizeBrowserAutomationSettings(parsed.browserAutomation),
      toolSettings: normalizeToolSettings(parsed.toolSettings),
      approvalPolicy: normalizeApprovalPolicy(parsed.approvalPolicy)
    };
  } catch {
    return createDefaultState();
  }
}

function writeState(state: ContinuityState): void {
  if (!browser) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function updateState(mutator: (current: ContinuityState) => ContinuityState): void {
  const current = readState();
  writeState(mutator(current));
}

function normalizeDraftRecord(value: unknown): Record<string, PersistedStudioDraft> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([sessionId, draft]) => [sessionId, normalizeDraft(draft)] as const)
    .filter((entry): entry is [string, PersistedStudioDraft] => Boolean(entry[1]));

  return Object.fromEntries(entries);
}

function normalizeDelegationDraftRecord(
  value: unknown
): Record<string, PersistedDelegationDraft> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, draft]) => [key, normalizeDelegationDraft(draft)] as const)
    .filter((entry): entry is [string, PersistedDelegationDraft] => Boolean(entry[1]));

  return Object.fromEntries(entries);
}

function normalizeDraft(value: unknown): PersistedStudioDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sessionId = asString(record.sessionId);
  const relayMode = normalizeRelayMode(record.relayMode);

  if (!sessionId || !relayMode) {
    return null;
  }

  return {
    sessionId,
    selectedTurnId: asOptionalString(record.selectedTurnId),
    selectedTurnTitle: asString(record.selectedTurnTitle) ?? "",
    turnTitle: asString(record.turnTitle) ?? "",
    turnObjective: asString(record.turnObjective) ?? "",
    relayMode,
    workbookPath: asString(record.workbookPath) ?? "",
    workbookFocus: asString(record.workbookFocus) ?? "Sheet1",
    previewSummary: asString(record.previewSummary) ?? "",
    approvalSummary: asString(record.approvalSummary) ?? "",
    executionSummary: asString(record.executionSummary) ?? "",
    previewSnapshot: normalizePreviewSnapshot(record.previewSnapshot),
    lastUpdatedAt: asString(record.lastUpdatedAt) ?? new Date().toISOString(),
    cleanShutdown: Boolean(record.cleanShutdown)
  };
}

function normalizePreviewSnapshot(value: unknown): PersistedPreviewSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sourcePath = asString(record.sourcePath);
  const outputPath = asString(record.outputPath);

  if (!sourcePath || !outputPath) {
    return null;
  }

  return {
    sourcePath,
    outputPath,
    targetCount: asNumber(record.targetCount) ?? 0,
    estimatedAffectedRows: asNumber(record.estimatedAffectedRows) ?? 0,
    warnings: asStringArray(record.warnings),
    requiresApproval: Boolean(record.requiresApproval),
    artifacts: normalizeOutputArtifacts(record.artifacts),
    fileWriteActions: normalizePreviewActions(record.fileWriteActions),
    lastGeneratedAt: asString(record.lastGeneratedAt) ?? new Date().toISOString()
  };
}

function normalizePreviewActions(
  value: unknown
): Array<{ tool: string; args: Record<string, unknown> }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const tool = asString(record.tool);
      const args = record.args;

      if (!tool || !args || typeof args !== "object" || Array.isArray(args)) {
        return null;
      }

      return {
        tool,
        args: { ...(args as Record<string, unknown>) }
      };
    })
    .filter(
      (entry): entry is { tool: string; args: Record<string, unknown> } => Boolean(entry)
    );
}

function normalizeOutputArtifacts(value: unknown): OutputArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeOutputArtifact(entry))
    .filter((entry): entry is OutputArtifact => Boolean(entry));
}

function normalizeOutputArtifact(value: unknown): OutputArtifact | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = asString(record.id);
  const type = asString(record.type);
  const label = asString(record.label);
  const content = record.content;
  if (!id || !type || !label || !content || typeof content !== "object" || Array.isArray(content)) {
    return null;
  }

  return {
    id,
    type: type as OutputArtifact["type"],
    label,
    sourcePath: asString(record.sourcePath) ?? "",
    outputPath: asString(record.outputPath) ?? "",
    warnings: asStringArray(record.warnings),
    content: { ...(content as Record<string, unknown>) }
  };
}

function normalizeDelegationDraft(value: unknown): PersistedDelegationDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const delegationState = normalizeDelegationState(record.delegationState);
  const lastUpdatedAt = asString(record.lastUpdatedAt);

  if (!delegationState || !lastUpdatedAt) {
    return null;
  }

  return {
    goal: asString(record.goal) ?? "",
    attachedFiles: asStringArray(record.attachedFiles),
    activityFeedSnapshot: normalizeActivityFeedSnapshot(record.activityFeedSnapshot),
    delegationState,
    planSnapshot: normalizeExecutionPlan(record.planSnapshot),
    conversationHistorySnapshot: normalizeConversationHistorySnapshot(
      record.conversationHistorySnapshot
    ),
    currentStepIndex: asNumber(record.currentStepIndex) ?? -1,
    lastUpdatedAt
  };
}

function normalizeRecentSessions(value: unknown): RecentSession[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeRecentSession(entry))
    .filter((entry): entry is RecentSession => Boolean(entry))
    .slice(0, MAX_RECENT_SESSIONS);
}

function normalizeRecentSession(value: unknown): RecentSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sessionId = asString(record.sessionId);
  const title = asString(record.title);
  const lastOpenedAt = asString(record.lastOpenedAt);

  if (!sessionId || !title || !lastOpenedAt) {
    return null;
  }

  return {
    sessionId,
    title,
    workbookPath: asString(record.workbookPath) ?? "",
    lastOpenedAt,
    lastTurnTitle: asString(record.lastTurnTitle) ?? ""
  };
}

function normalizeRecentFiles(value: unknown): RecentFile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeRecentFile(entry))
    .filter((entry): entry is RecentFile => Boolean(entry))
    .slice(0, MAX_RECENT_FILES);
}

function normalizeRecentFile(value: unknown): RecentFile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const path = asString(record.path);
  const lastUsedAt = asString(record.lastUsedAt);
  const source = record.source;

  if (
    !path ||
    !lastUsedAt ||
    (source !== "session" && source !== "draft" && source !== "preflight")
  ) {
    return null;
  }

  return {
    path,
    lastUsedAt,
    sessionId: asOptionalString(record.sessionId),
    source
  };
}

function normalizeAuditHistory(value: unknown): AuditHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeAuditHistoryEntry(entry))
    .filter((entry): entry is AuditHistoryEntry => Boolean(entry))
    .slice(0, MAX_AUDIT_HISTORY);
}

function normalizeAuditHistoryEntry(value: unknown): AuditHistoryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = asString(record.id);
  const sessionId = asString(record.sessionId);
  const sessionTitle = asString(record.sessionTitle);
  const executedAt = asString(record.executedAt);
  const summary = asString(record.summary);

  if (!id || !sessionId || !sessionTitle || !executedAt || !summary) {
    return null;
  }

  return {
    id,
    sessionId,
    sessionTitle,
    turnId: asOptionalString(record.turnId),
    turnTitle: asString(record.turnTitle) ?? "",
    sourcePath: asString(record.sourcePath) ?? "",
    outputPath: asString(record.outputPath) ?? "",
    executedAt,
    summary,
    targetCount: asNumber(record.targetCount) ?? 0,
    affectedRows: asNumber(record.affectedRows) ?? 0,
    warnings: asStringArray(record.warnings)
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeActivityFeedSnapshot(value: unknown): ActivityFeedEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeActivityFeedEvent(entry))
    .filter((entry): entry is ActivityFeedEvent => Boolean(entry));
}

function normalizeActivityFeedEvent(value: unknown): ActivityFeedEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = asString(record.id);
  const timestamp = asString(record.timestamp);
  const type = normalizeActivityEventType(record.type);
  const message = asString(record.message);
  const icon = asString(record.icon);

  if (!id || !timestamp || !type || !message || !icon) {
    return null;
  }

  return {
    id,
    timestamp,
    type,
    message,
    icon,
    detail: asOptionalString(record.detail) ?? undefined,
    expandable: typeof record.expandable === "boolean" ? record.expandable : undefined,
    actionRequired:
      typeof record.actionRequired === "boolean" ? record.actionRequired : undefined
  };
}

function normalizeConversationHistorySnapshot(
  value: unknown
): CopilotConversationTurn[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeConversationTurn(entry))
    .filter((entry): entry is CopilotConversationTurn => Boolean(entry));
}

function normalizeConversationTurn(value: unknown): CopilotConversationTurn | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const role = record.role;
  const content = asString(record.content);
  const timestamp = asString(record.timestamp);

  if (
    (role !== "user" && role !== "assistant") ||
    !content ||
    !timestamp
  ) {
    return null;
  }

  return {
    role,
    content,
    timestamp
  };
}

function normalizeRelayMode(value: unknown): RelayMode | null {
  return value === "discover" ||
    value === "plan" ||
    value === "repair" ||
    value === "followup"
    ? value
    : null;
}


function normalizeDelegationState(value: unknown): DelegationState | null {
  return value === "idle" ||
    value === "goal_entered" ||
    value === "planning" ||
    value === "plan_review" ||
    value === "executing" ||
    value === "awaiting_approval" ||
    value === "completed" ||
    value === "error"
    ? value
    : null;
}

function normalizeActivityEventType(value: unknown): ActivityFeedEvent["type"] | null {
  return value === "goal_set" ||
    value === "file_attached" ||
    value === "copilot_turn" ||
    value === "tool_executed" ||
    value === "plan_proposed" ||
    value === "plan_approved" ||
    value === "write_approval_requested" ||
    value === "write_approved" ||
    value === "step_completed" ||
    value === "error" ||
    value === "completed"
    ? value
    : null;
}

function normalizeExecutionPlan(value: unknown): ExecutionPlan | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.steps) || typeof record.summary !== "string") {
    return null;
  }

  return {
    steps: record.steps as ExecutionPlan["steps"],
    summary: record.summary,
    totalEstimatedSteps:
      typeof record.totalEstimatedSteps === "number"
        ? record.totalEstimatedSteps
        : record.steps.length
  };
}

function normalizeBrowserAutomationSettings(value: unknown): BrowserAutomationSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_BROWSER_AUTOMATION_SETTINGS };
  }

  const record = value as Record<string, unknown>;

  return sanitizeBrowserAutomationSettings({
    cdpPort: asNumber(record.cdpPort) ?? DEFAULT_BROWSER_AUTOMATION_SETTINGS.cdpPort,
    autoLaunchEdge:
      typeof record.autoLaunchEdge === "boolean"
        ? record.autoLaunchEdge
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.autoLaunchEdge,
    timeoutMs: asNumber(record.timeoutMs) ?? DEFAULT_BROWSER_AUTOMATION_SETTINGS.timeoutMs,
    agentLoopEnabled:
      typeof record.agentLoopEnabled === "boolean"
        ? record.agentLoopEnabled
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.agentLoopEnabled,
    maxTurns: asNumber(record.maxTurns) ?? DEFAULT_BROWSER_AUTOMATION_SETTINGS.maxTurns,
    loopTimeoutMs:
      asNumber(record.loopTimeoutMs) ?? DEFAULT_BROWSER_AUTOMATION_SETTINGS.loopTimeoutMs,
    planningEnabled:
      typeof record.planningEnabled === "boolean"
        ? record.planningEnabled
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.planningEnabled,
    autoApproveReadSteps:
      typeof record.autoApproveReadSteps === "boolean"
        ? record.autoApproveReadSteps
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.autoApproveReadSteps,
    pauseBetweenSteps:
      typeof record.pauseBetweenSteps === "boolean"
        ? record.pauseBetweenSteps
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.pauseBetweenSteps
  });
}

function normalizeToolSettings(value: unknown): ToolSettings {
  if (!value || typeof value !== "object") {
    return {
      disabledToolIds: [...DEFAULT_TOOL_SETTINGS.disabledToolIds],
      mcpServers: [...DEFAULT_TOOL_SETTINGS.mcpServers]
    };
  }

  const record = value as Record<string, unknown>;
  const disabledToolIds = Array.isArray(record.disabledToolIds)
    ? record.disabledToolIds.filter((entry): entry is string => typeof entry === "string")
    : [];
  const mcpServers = Array.isArray(record.mcpServers)
    ? record.mcpServers
        .map((entry) => normalizeMcpServer(entry))
        .filter((entry): entry is McpServerConfig => Boolean(entry))
    : [];

  return {
    disabledToolIds: Array.from(new Set(disabledToolIds.map((entry) => entry.trim()).filter(Boolean))),
    mcpServers
  };
}

function normalizeMcpServer(value: unknown): McpServerConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const url = asString(record.url)?.trim();
  const name = asString(record.name)?.trim();
  const transport = record.transport === "stdio" ? "stdio" : "sse";

  if (!url || !name) {
    return null;
  }

  return {
    url,
    name,
    transport
  };
}

function normalizeApprovalPolicy(value: unknown): ApprovalPolicy {
  if (value === "standard" || value === "fast") {
    return value;
  }
  if (value !== undefined && value !== null && value !== DEFAULT_APPROVAL_POLICY) {
    console.warn(
      `[continuity] unexpected approvalPolicy value: ${JSON.stringify(value)}, falling back to "${DEFAULT_APPROVAL_POLICY}"`
    );
  }
  return DEFAULT_APPROVAL_POLICY;
}

function sanitizeBrowserAutomationSettings(
  value: BrowserAutomationSettings
): BrowserAutomationSettings {
  const nextPort = Math.trunc(value.cdpPort);
  const nextTimeout = Math.trunc(value.timeoutMs);
  const nextMaxTurns = Math.trunc(value.maxTurns);
  const nextLoopTimeout = Math.trunc(value.loopTimeoutMs);

  return {
    cdpPort:
      Number.isFinite(nextPort) && nextPort >= 1 && nextPort <= 65535
        ? nextPort
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.cdpPort,
    autoLaunchEdge: Boolean(value.autoLaunchEdge),
    timeoutMs:
      Number.isFinite(nextTimeout) && nextTimeout >= 1000
        ? nextTimeout
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.timeoutMs,
    agentLoopEnabled: Boolean(value.agentLoopEnabled),
    maxTurns:
      Number.isFinite(nextMaxTurns) && nextMaxTurns >= 1 && nextMaxTurns <= 20
        ? nextMaxTurns
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.maxTurns,
    loopTimeoutMs:
      Number.isFinite(nextLoopTimeout) &&
      nextLoopTimeout >= 30_000 &&
      nextLoopTimeout <= 300_000
        ? nextLoopTimeout
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.loopTimeoutMs,
    planningEnabled: Boolean(value.planningEnabled),
    autoApproveReadSteps: Boolean(value.autoApproveReadSteps),
    pauseBetweenSteps: Boolean(value.pauseBetweenSteps)
  };
}

function hasMeaningfulDraft(draft: PersistedStudioDraft): boolean {
  return Boolean(
    draft.turnTitle.trim() ||
      draft.turnObjective.trim() ||
      draft.workbookPath.trim() ||
      draft.previewSummary.trim() ||
      draft.approvalSummary.trim() ||
      draft.executionSummary.trim() ||
      draft.previewSnapshot
  );
}

function hasMeaningfulDelegationDraft(draft: PersistedDelegationDraft): boolean {
  return Boolean(
    draft.goal.trim() ||
      draft.attachedFiles.length > 0 ||
      draft.activityFeedSnapshot.length > 0 ||
      draft.planSnapshot ||
      draft.conversationHistorySnapshot.length > 0
  );
}

function upsertRecentSession(
  items: RecentSession[],
  entry: RecentSession
): RecentSession[] {
  return [entry, ...items.filter((item) => item.sessionId !== entry.sessionId)].slice(
    0,
    MAX_RECENT_SESSIONS
  );
}

function upsertRecentFile(items: RecentFile[], entry: RecentFile): RecentFile[] {
  return [entry, ...items.filter((item) => item.path !== entry.path)].slice(
    0,
    MAX_RECENT_FILES
  );
}

function upsertAuditHistory(
  items: AuditHistoryEntry[],
  entry: AuditHistoryEntry
): AuditHistoryEntry[] {
  return [entry, ...items.filter((item) => item.id !== entry.id)].slice(
    0,
    MAX_AUDIT_HISTORY
  );
}

export function loadStudioDraft(sessionId: string): PersistedStudioDraft | null {
  return readState().studioDrafts[sessionId] ?? null;
}

export function saveStudioDraft(draft: PersistedStudioDraft): void {
  updateState((current) => {
    const nextDrafts = { ...current.studioDrafts };

    if (hasMeaningfulDraft(draft)) {
      nextDrafts[draft.sessionId] = draft;
    } else {
      delete nextDrafts[draft.sessionId];
    }

    return {
      ...current,
      studioDrafts: nextDrafts
    };
  });
}

export function loadDelegationDraft(key = "global"): PersistedDelegationDraft | null {
  return readState().delegationDrafts[key] ?? null;
}

export function saveDelegationDraft(
  draft: PersistedDelegationDraft,
  key = "global"
): void {
  updateState((current) => {
    const nextDrafts = { ...current.delegationDrafts };

    if (hasMeaningfulDelegationDraft(draft)) {
      nextDrafts[key] = draft;
    } else {
      delete nextDrafts[key];
    }

    return {
      ...current,
      delegationDrafts: nextDrafts
    };
  });
}

export function discardDelegationDraft(key = "global"): void {
  updateState((current) => {
    const nextDrafts = { ...current.delegationDrafts };
    delete nextDrafts[key];

    return {
      ...current,
      delegationDrafts: nextDrafts
    };
  });
}

export function discardStudioDraft(sessionId: string): void {
  updateState((current) => {
    const nextDrafts = { ...current.studioDrafts };
    delete nextDrafts[sessionId];

    return {
      ...current,
      studioDrafts: nextDrafts
    };
  });
}

export function markStudioDraftClean(sessionId: string): void {
  updateState((current) => {
    const draft = current.studioDrafts[sessionId];
    if (!draft) {
      return current;
    }

    return {
      ...current,
      studioDrafts: {
        ...current.studioDrafts,
        [sessionId]: {
          ...draft,
          cleanShutdown: true,
          lastUpdatedAt: new Date().toISOString()
        }
      }
    };
  });
}

export function rememberRecentSession(entry: RecentSession): void {
  updateState((current) => ({
    ...current,
    recentSessions: upsertRecentSession(current.recentSessions, entry)
  }));
}

export function rememberRecentFile(entry: RecentFile): void {
  updateState((current) => ({
    ...current,
    recentFiles: upsertRecentFile(current.recentFiles, entry)
  }));
}

export function listRecentSessions(): RecentSession[] {
  return readState().recentSessions;
}

export function listRecentFiles(): RecentFile[] {
  return readState().recentFiles;
}

export function listRecoverableStudioDrafts(): PersistedStudioDraft[] {
  return Object.values(readState().studioDrafts)
    .filter((draft) => !draft.cleanShutdown && hasMeaningfulDraft(draft))
    .sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt));
}

export function rememberAuditHistory(entry: AuditHistoryEntry): void {
  updateState((current) => ({
    ...current,
    auditHistory: upsertAuditHistory(current.auditHistory, entry)
  }));
}

export function listAuditHistory(): AuditHistoryEntry[] {
  return readState().auditHistory;
}

export function loadBrowserAutomationSettings(): BrowserAutomationSettings {
  return readState().browserAutomation;
}

export function loadToolSettings(): ToolSettings {
  return readState().toolSettings;
}

export function loadApprovalPolicy(): ApprovalPolicy {
  return readState().approvalPolicy;
}


export function loadSelectedProjectId(): string | null {
  return readState().selectedProjectId;
}


export function saveSelectedProjectId(projectId: string | null): string | null {
  const nextProjectId = projectId?.trim() || null;

  updateState((current) => ({
    ...current,
    selectedProjectId: nextProjectId
  }));

  return nextProjectId;
}

export function saveBrowserAutomationSettings(
  value: BrowserAutomationSettings
): BrowserAutomationSettings {
  const nextSettings = sanitizeBrowserAutomationSettings(value);

  updateState((current) => ({
    ...current,
    browserAutomation: nextSettings
  }));

  return nextSettings;
}

export function saveToolSettings(value: ToolSettings): ToolSettings {
  const nextSettings = normalizeToolSettings(value);

  updateState((current) => ({
    ...current,
    toolSettings: nextSettings
  }));

  return nextSettings;
}

export function saveApprovalPolicy(value: ApprovalPolicy): ApprovalPolicy {
  const nextPolicy = normalizeApprovalPolicy(value);

  updateState((current) => ({
    ...current,
    approvalPolicy: nextPolicy
  }));

  return nextPolicy;
}
