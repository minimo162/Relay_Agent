import { browser } from "$app/environment";

type RelayMode = "discover" | "plan" | "repair" | "followup";

const STORAGE_KEY = "relay-agent.continuity.v1";
const MAX_RECENT_SESSIONS = 6;
const MAX_RECENT_FILES = 6;
const MAX_AUDIT_HISTORY = 12;
const DEFAULT_BROWSER_AUTOMATION_SETTINGS = {
  cdpPort: 9222,
  timeoutMs: 60000,
  agentLoopEnabled: false,
  maxTurns: 10,
  loopTimeoutMs: 120000
} as const;

export type PersistedPreviewSnapshot = {
  sourcePath: string;
  outputPath: string;
  targetCount: number;
  estimatedAffectedRows: number;
  warnings: string[];
  requiresApproval: boolean;
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
  relayPacketText: string;
  relayPacketSummary: string;
  rawResponse: string;
  validationSummary: string;
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
  timeoutMs: number;
  agentLoopEnabled: boolean;
  maxTurns: number;
  loopTimeoutMs: number;
};

type ContinuityState = {
  version: 1;
  studioDrafts: Record<string, PersistedStudioDraft>;
  recentSessions: RecentSession[];
  recentFiles: RecentFile[];
  auditHistory: AuditHistoryEntry[];
  browserAutomation: BrowserAutomationSettings;
};

function createDefaultState(): ContinuityState {
  return {
    version: 1,
    studioDrafts: {},
    recentSessions: [],
    recentFiles: [],
    auditHistory: [],
    browserAutomation: { ...DEFAULT_BROWSER_AUTOMATION_SETTINGS }
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
      recentSessions: normalizeRecentSessions(parsed.recentSessions),
      recentFiles: normalizeRecentFiles(parsed.recentFiles),
      auditHistory: normalizeAuditHistory(parsed.auditHistory),
      browserAutomation: normalizeBrowserAutomationSettings(parsed.browserAutomation)
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
    relayPacketText: asString(record.relayPacketText) ?? "",
    relayPacketSummary: asString(record.relayPacketSummary) ?? "",
    rawResponse: asString(record.rawResponse) ?? "",
    validationSummary: asString(record.validationSummary) ?? "",
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
    lastGeneratedAt: asString(record.lastGeneratedAt) ?? new Date().toISOString()
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

function normalizeRelayMode(value: unknown): RelayMode | null {
  return value === "discover" ||
    value === "plan" ||
    value === "repair" ||
    value === "followup"
    ? value
    : null;
}

function normalizeBrowserAutomationSettings(value: unknown): BrowserAutomationSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_BROWSER_AUTOMATION_SETTINGS };
  }

  const record = value as Record<string, unknown>;

  return sanitizeBrowserAutomationSettings({
    cdpPort: asNumber(record.cdpPort) ?? DEFAULT_BROWSER_AUTOMATION_SETTINGS.cdpPort,
    timeoutMs: asNumber(record.timeoutMs) ?? DEFAULT_BROWSER_AUTOMATION_SETTINGS.timeoutMs,
    agentLoopEnabled:
      typeof record.agentLoopEnabled === "boolean"
        ? record.agentLoopEnabled
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.agentLoopEnabled,
    maxTurns: asNumber(record.maxTurns) ?? DEFAULT_BROWSER_AUTOMATION_SETTINGS.maxTurns,
    loopTimeoutMs:
      asNumber(record.loopTimeoutMs) ?? DEFAULT_BROWSER_AUTOMATION_SETTINGS.loopTimeoutMs
  });
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
        : DEFAULT_BROWSER_AUTOMATION_SETTINGS.loopTimeoutMs
  };
}

function hasMeaningfulDraft(draft: PersistedStudioDraft): boolean {
  return Boolean(
    draft.turnTitle.trim() ||
      draft.turnObjective.trim() ||
      draft.workbookPath.trim() ||
      draft.relayPacketText.trim() ||
      draft.rawResponse.trim() ||
      draft.validationSummary.trim() ||
      draft.previewSummary.trim() ||
      draft.approvalSummary.trim() ||
      draft.executionSummary.trim() ||
      draft.previewSnapshot
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
