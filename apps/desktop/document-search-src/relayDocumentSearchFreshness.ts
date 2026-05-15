import type {
  RelayDocumentSearchAccessAction,
  RelayDocumentSearchAccessState,
  RelayDocumentSearchCachedFileMetadata,
} from './relayDocumentSearchMetadataCache';

export const RELAY_DOCUMENT_SEARCH_FRESHNESS_CONTRACT = 'RelayDocumentSearchFreshness.v1' as const;

export type RelayDocumentSearchFreshnessReason =
  | 'metadata_unchanged'
  | 'mtime_changed'
  | 'size_changed'
  | 'created'
  | 'deleted'
  | 'moved'
  | 'access_changed';

export type RelayDocumentSearchFreshnessChange = {
  file_id: string;
  display_path: string;
  path?: string;
  reason: RelayDocumentSearchFreshnessReason;
  previous_display_path?: string;
  current_display_path?: string;
  previous_path?: string;
  current_path?: string;
  previous_size?: number;
  current_size?: number;
  previous_modified_time?: string;
  current_modified_time?: string;
  previous_source_metadata_version?: string;
  current_source_metadata_version?: string;
  previous_file_id?: string;
  current_file_id?: string;
  previous_access_state?: Partial<Record<RelayDocumentSearchAccessAction, RelayDocumentSearchAccessState>>;
  current_access_state?: Partial<Record<RelayDocumentSearchAccessAction, RelayDocumentSearchAccessState>>;
  access_changed_actions: RelayDocumentSearchAccessAction[];
  access_warning_codes: string[];
  move_confidence?: 'high';
  tombstone: boolean;
  access_stale: boolean;
  access_unavailable: boolean;
  content_stale: boolean;
};

export type RelayDocumentSearchFreshnessReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_FRESHNESS_CONTRACT;
  root: string;
  generated_at: string;
  checked_file_count: number;
  unchanged_file_count: number;
  created_file_count: number;
  modified_file_count: number;
  deleted_file_count: number;
  moved_file_count: number;
  access_changed_file_count: number;
  access_unavailable_file_count: number;
  tombstone_count: number;
  content_stale_file_count: number;
  changes: RelayDocumentSearchFreshnessChange[];
  ai_boundary: {
    localMetadataOnly: true;
    extractedContentIncluded: false;
    originalFilesIncluded: false;
  };
};

export type RelayDocumentSearchFreshnessSummary = {
  schemaVersion: 'RelayDocumentSearchFreshnessSummary.v1';
  report_count: number;
  checked_file_count: number;
  created_file_count: number;
  modified_file_count: number;
  deleted_file_count: number;
  moved_file_count: number;
  access_changed_file_count: number;
  access_unavailable_file_count: number;
  tombstone_count: number;
  content_stale_file_count: number;
  reports: RelayDocumentSearchFreshnessReport[];
};

export type RelayDocumentSearchFreshnessInput = {
  root: string;
  generatedAt: string;
  previousFiles?: RelayDocumentSearchCachedFileMetadata[];
  currentFiles: RelayDocumentSearchCachedFileMetadata[];
};

const ACCESS_ACTIONS: readonly RelayDocumentSearchAccessAction[] = ['metadata', 'content', 'preview', 'open'];
const ACCESS_UNAVAILABLE_STATES = new Set<RelayDocumentSearchAccessState>([
  'access_denied',
  'not_found',
  'offline_share',
  'locked_file',
  'policy_denied',
]);

function changedReason(
  previous: RelayDocumentSearchCachedFileMetadata,
  current: RelayDocumentSearchCachedFileMetadata,
): RelayDocumentSearchFreshnessReason {
  if (previous.size !== current.size) return 'size_changed';
  if (previous.modifiedTime !== current.modifiedTime) return 'mtime_changed';
  if (previous.sourceMetadataVersion !== current.sourceMetadataVersion) return 'mtime_changed';
  if (accessChangedActions(previous, current).length > 0) return 'access_changed';
  return 'metadata_unchanged';
}

function accessStateByAction(
  file: RelayDocumentSearchCachedFileMetadata | undefined,
): Partial<Record<RelayDocumentSearchAccessAction, RelayDocumentSearchAccessState>> {
  const snapshots = file?.accessSnapshots;
  if (!snapshots) return {};
  return Object.fromEntries(
    ACCESS_ACTIONS
      .map((action) => [action, snapshots[action]?.state])
      .filter((entry): entry is [RelayDocumentSearchAccessAction, RelayDocumentSearchAccessState] =>
        Boolean(entry[1]),
      ),
  );
}

function accessChangedActions(
  previous: RelayDocumentSearchCachedFileMetadata | undefined,
  current: RelayDocumentSearchCachedFileMetadata | undefined,
): RelayDocumentSearchAccessAction[] {
  if (!previous || !current) return [];
  const previousAccess = accessStateByAction(previous);
  const currentAccess = accessStateByAction(current);
  return ACCESS_ACTIONS.filter((action) =>
    previousAccess[action] !== undefined &&
      currentAccess[action] !== undefined &&
      previousAccess[action] !== currentAccess[action],
  );
}

function accessUnavailable(
  accessState: Partial<Record<RelayDocumentSearchAccessAction, RelayDocumentSearchAccessState>>,
): boolean {
  return ACCESS_ACTIONS.some((action) => {
    const state = accessState[action];
    return state ? ACCESS_UNAVAILABLE_STATES.has(state) : false;
  });
}

function accessWarningCodes(
  file: RelayDocumentSearchCachedFileMetadata | undefined,
): string[] {
  const snapshots = file?.accessSnapshots;
  if (!snapshots) return [];
  const warnings = ACCESS_ACTIONS.flatMap((action) => {
    const snapshot = snapshots[action];
    if (!snapshot || !ACCESS_UNAVAILABLE_STATES.has(snapshot.state)) return [];
    return [snapshot.warningCode ?? snapshot.state];
  });
  return [...new Set(warnings)];
}

function changeFromFiles(
  previous: RelayDocumentSearchCachedFileMetadata | undefined,
  current: RelayDocumentSearchCachedFileMetadata | undefined,
  forcedReason?: RelayDocumentSearchFreshnessReason,
): RelayDocumentSearchFreshnessChange {
  const reason = forcedReason ?? (previous && current ? changedReason(previous, current) : previous ? 'deleted' : 'created');
  const file = current ?? previous;
  const moved = reason === 'moved';
  const previousAccess = accessStateByAction(previous);
  const currentAccess = accessStateByAction(current);
  const changedAccess = accessChangedActions(previous, current);
  const unavailable = accessUnavailable(currentAccess);
  const accessStale = changedAccess.length > 0 || unavailable;
  return {
    file_id: moved ? previous?.fileId ?? current?.fileId ?? '' : file?.fileId ?? '',
    display_path: current?.displayPath ?? previous?.displayPath ?? '',
    path: current?.path ?? previous?.path,
    reason,
    previous_display_path: previous?.displayPath,
    current_display_path: current?.displayPath,
    previous_path: previous?.path,
    current_path: current?.path,
    previous_size: previous?.size,
    current_size: current?.size,
    previous_modified_time: previous?.modifiedTime,
    current_modified_time: current?.modifiedTime,
    previous_source_metadata_version: previous?.sourceMetadataVersion,
    current_source_metadata_version: current?.sourceMetadataVersion,
    previous_file_id: previous?.fileId,
    current_file_id: current?.fileId,
    previous_access_state: Object.keys(previousAccess).length ? previousAccess : undefined,
    current_access_state: Object.keys(currentAccess).length ? currentAccess : undefined,
    access_changed_actions: changedAccess,
    access_warning_codes: accessWarningCodes(current),
    move_confidence: moved ? 'high' : undefined,
    tombstone: reason === 'deleted' || moved,
    access_stale: accessStale,
    access_unavailable: unavailable,
    content_stale: reason !== 'metadata_unchanged' || accessStale,
  };
}

function moveFingerprint(file: RelayDocumentSearchCachedFileMetadata): string {
  return [
    file.extension,
    file.size,
    file.modifiedTime,
  ].join(':');
}

function highConfidenceMovePairs(
  deletedCandidates: RelayDocumentSearchCachedFileMetadata[],
  createdCandidates: RelayDocumentSearchCachedFileMetadata[],
): Array<{
  previous: RelayDocumentSearchCachedFileMetadata;
  current: RelayDocumentSearchCachedFileMetadata;
}> {
  const deletedByFingerprint = new Map<string, RelayDocumentSearchCachedFileMetadata[]>();
  const createdByFingerprint = new Map<string, RelayDocumentSearchCachedFileMetadata[]>();
  for (const file of deletedCandidates) {
    const key = moveFingerprint(file);
    deletedByFingerprint.set(key, [...(deletedByFingerprint.get(key) ?? []), file]);
  }
  for (const file of createdCandidates) {
    const key = moveFingerprint(file);
    createdByFingerprint.set(key, [...(createdByFingerprint.get(key) ?? []), file]);
  }
  const pairs: Array<{
    previous: RelayDocumentSearchCachedFileMetadata;
    current: RelayDocumentSearchCachedFileMetadata;
  }> = [];
  for (const [key, deletedFiles] of deletedByFingerprint.entries()) {
    const createdFiles = createdByFingerprint.get(key) ?? [];
    if (deletedFiles.length !== 1 || createdFiles.length !== 1) continue;
    pairs.push({ previous: deletedFiles[0], current: createdFiles[0] });
  }
  return pairs;
}

export function buildRelayDocumentSearchFreshnessReport(
  input: RelayDocumentSearchFreshnessInput,
): RelayDocumentSearchFreshnessReport {
  const previousByPath = new Map((input.previousFiles ?? []).map((file) => [file.displayPath, file]));
  const currentByPath = new Map(input.currentFiles.map((file) => [file.displayPath, file]));
  const sharedPaths = [...previousByPath.keys()]
    .filter((path) => currentByPath.has(path))
    .sort((left, right) => left.localeCompare(right));
  const deletedCandidates = [...previousByPath.entries()]
    .filter(([path]) => !currentByPath.has(path))
    .map(([, file]) => file);
  const createdCandidates = [...currentByPath.entries()]
    .filter(([path]) => !previousByPath.has(path))
    .map(([, file]) => file);
  const movePairs = highConfidenceMovePairs(deletedCandidates, createdCandidates);
  const movedPreviousPaths = new Set(movePairs.map((pair) => pair.previous.displayPath));
  const movedCurrentPaths = new Set(movePairs.map((pair) => pair.current.displayPath));
  const changes = [
    ...sharedPaths.map((path) => changeFromFiles(previousByPath.get(path), currentByPath.get(path))),
    ...movePairs.map((pair) => changeFromFiles(pair.previous, pair.current, 'moved')),
    ...deletedCandidates
      .filter((file) => !movedPreviousPaths.has(file.displayPath))
      .map((file) => changeFromFiles(file, undefined)),
    ...createdCandidates
      .filter((file) => !movedCurrentPaths.has(file.displayPath))
      .map((file) => changeFromFiles(undefined, file)),
  ].sort((left, right) => left.display_path.localeCompare(right.display_path));
  const changed = changes.filter((change) => change.content_stale);
  const created = changes.filter((change) => change.reason === 'created');
  const deleted = changes.filter((change) => change.reason === 'deleted');
  const moved = changes.filter((change) => change.reason === 'moved');
  const accessChanged = changes.filter((change) => change.access_stale);
  const accessUnavailableChanges = changes.filter((change) => change.access_unavailable);
  const modified = changes.filter((change) => change.reason === 'mtime_changed' || change.reason === 'size_changed');
  const tombstones = changes.filter((change) => change.tombstone);

  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_FRESHNESS_CONTRACT,
    root: input.root,
    generated_at: input.generatedAt,
    checked_file_count: changes.length,
    unchanged_file_count: changes.length - changed.length,
    created_file_count: created.length,
    modified_file_count: modified.length,
    deleted_file_count: deleted.length,
    moved_file_count: moved.length,
    access_changed_file_count: accessChanged.length,
    access_unavailable_file_count: accessUnavailableChanges.length,
    tombstone_count: tombstones.length,
    content_stale_file_count: changed.length,
    changes,
    ai_boundary: {
      localMetadataOnly: true,
      extractedContentIncluded: false,
      originalFilesIncluded: false,
    },
  };
}

export function summarizeRelayDocumentSearchFreshnessReports(
  reports: RelayDocumentSearchFreshnessReport[],
): RelayDocumentSearchFreshnessSummary {
  return {
    schemaVersion: 'RelayDocumentSearchFreshnessSummary.v1',
    report_count: reports.length,
    checked_file_count: reports.reduce((sum, report) => sum + report.checked_file_count, 0),
    created_file_count: reports.reduce((sum, report) => sum + report.created_file_count, 0),
    modified_file_count: reports.reduce((sum, report) => sum + report.modified_file_count, 0),
    deleted_file_count: reports.reduce((sum, report) => sum + report.deleted_file_count, 0),
    moved_file_count: reports.reduce((sum, report) => sum + report.moved_file_count, 0),
    access_changed_file_count: reports.reduce((sum, report) => sum + report.access_changed_file_count, 0),
    access_unavailable_file_count: reports.reduce((sum, report) => sum + report.access_unavailable_file_count, 0),
    tombstone_count: reports.reduce((sum, report) => sum + report.tombstone_count, 0),
    content_stale_file_count: reports.reduce((sum, report) => sum + report.content_stale_file_count, 0),
    reports,
  };
}
