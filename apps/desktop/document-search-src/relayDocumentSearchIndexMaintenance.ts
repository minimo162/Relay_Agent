/**
 * Index health checks and repair actions for Relay Document Search.
 *
 * The current implementation uses JSON-backed metadata and derived stores, not
 * a persistent SQLite index DB. DB-specific actions therefore return explicit
 * not-applicable results until that backend exists, while integrity checks and
 * rebuild-derived-indexes are real local maintenance operations.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';

import {
  RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT,
  RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION,
  inspectRelayDocumentSearchMetadataCacheMigration,
  type RelayDocumentSearchMetadataCacheMigrationState,
} from './relayDocumentSearchMetadataCache';
import {
  RELAY_PARSED_DOCUMENT_CACHE_CONTRACT,
  RELAY_PARSED_DOCUMENT_CACHE_VERSION,
  RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION,
} from './relayParsedDocumentCache';
import {
  RELAY_PARSED_DOCUMENT_IR_VERSION,
  RELAY_READER_CAPABILITY_REGISTRY_CONTRACT,
  RELAY_STRUCTURE_PATTERN_VERSION,
  RELAY_TEXT_READER_VERSION,
  RELAY_PDF_READER_VERSION,
  RELAY_OFFICE_OPENXML_READER_VERSION,
} from './relayParsedDocumentIr';
import {
  RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CONTRACT,
  RELAY_DOCUMENT_SEARCH_DERIVED_SEARCH_STORE_CONTRACT,
  RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_CONTRACT,
} from './relayDocumentSearchDerivedContentIndex';
import { RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION } from './relayDocumentSearchQueryPlan';
import { RELAY_DOCUMENT_SEARCH_EVIDENCE_PACK_CONTRACT } from './relayDocumentSearchEvidencePack';
import { RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT } from './relayDocumentSearchContract';
import {
  inspectRelayDocumentSearchCaches,
  runRelayDocumentSearchCacheAction,
  type RelayDocumentSearchCacheActionOptions,
  type RelayDocumentSearchCacheActionResult,
  type RelayDocumentSearchCacheStoreName,
  type RelayDocumentSearchCacheStoreReport,
} from './relayDocumentSearchCacheActions';
import {
  RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTENT_BEARING_TABLES,
  RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
  RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_MIGRATIONS,
  RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_TABLES,
  RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
  initializeRelayDocumentSearchIndexDb,
  invalidateRelayDocumentSearchIndexDbFiles,
  invalidateRelayDocumentSearchIndexDbRoot,
  inspectRelayDocumentSearchIndexDbStagingState,
  runRelayDocumentSearchIndexDbMaintenanceSql,
  type RelayDocumentSearchIndexDbFileInvalidationReport,
  type RelayDocumentSearchIndexDbRootInvalidationReport,
  type RelayDocumentSearchIndexDbSchemaReport,
  type RelayDocumentSearchIndexDbStagingState,
  type RelayDocumentSearchSqliteModule,
} from './relayDocumentSearchIndexDb';
import {
  recordRelayDocumentSearchIndexHealthEvent,
  type RelayDocumentSearchIndexHealthEvent,
} from './relayDocumentSearchIndexCoordinator';
import {
  executeRelayDocumentSearchFailedFileRetries,
  requestRelayDocumentSearchFailedFileRetries,
  type RelayDocumentSearchFailedFileRetryExecution,
  type RelayDocumentSearchFailedFileRetryExecutionOptions,
  type RelayDocumentSearchFailedFileRetryOptions,
  type RelayDocumentSearchFailedFileRetryPlan,
} from './relayDocumentSearchFailureRegistry';
import type {
  RelayDocumentSearchBackgroundSchedulerSnapshot,
  RelayDocumentSearchBackgroundWorkInput,
  RelayDocumentSearchBackgroundWorkPriority,
  RelayDocumentSearchBackgroundWorkResult,
  RelayDocumentSearchBackgroundWorkRunner,
  RelayDocumentSearchBackgroundWorkSnapshot,
} from './relayDocumentSearchBackgroundScheduler';

export const RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT = 'RelayDocumentSearchIndexMaintenance.v1' as const;
export const RELAY_DOCUMENT_SEARCH_INDEX_DB_HEALTH_CONTRACT = 'RelayDocumentSearchIndexDbHealth.v1' as const;
export const RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_SCHEDULE_CONTRACT =
  'RelayDocumentSearchIndexMaintenanceSchedule.v1' as const;
export const RELAY_DOCUMENT_SEARCH_SCHEMA_MIGRATION_GATE_CONTRACT =
  'RelayDocumentSearchSchemaMigrationGate.v1' as const;

export type RelayDocumentSearchIndexMaintenanceAction =
  | 'integrity-check'
  | 'wal-checkpoint'
  | 'compact'
  | 'rebuild-derived-indexes'
  | 'rebuild-previews'
  | 'rebuild-root'
  | 'remove-root'
  | 'full-rescan'
  | 'retry-failed-files';

export type RelayDocumentSearchIndexMaintenanceStatus =
  | 'ok'
  | 'repaired'
  | 'not_applicable'
  | 'cancelled'
  | 'failed';

export type RelayDocumentSearchIndexMaintenanceOptions = RelayDocumentSearchCacheActionOptions & {
  root?: string;
  indexDbPath?: string;
  enableIndexDb?: boolean;
  sqliteModule?: RelayDocumentSearchSqliteModule;
  indexCoordinatorDir?: string;
  ownerId?: string;
  appVersion?: string;
  recordIndexHealthEvents?: boolean;
  failureRegistryDir?: string;
  failureRegistryMaxEntries?: number;
  failedFileRetryLimit?: number;
};

export type RelayDocumentSearchStoreIntegrityCheck = {
  store: RelayDocumentSearchCacheStoreName;
  path: string;
  checkedJsonFiles: number;
  invalidJsonFiles: number;
  errors: string[];
};

export type RelayDocumentSearchIndexDbWalState = {
  inspected: boolean;
  walFileBytes: number;
  shmFileBytes: number;
  checkpointRecommended: boolean;
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchIndexDbHealth = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_HEALTH_CONTRACT;
  backend: 'json_stores' | 'sqlite_fts';
  sqliteFtsRequested: boolean;
  sqliteFtsEnabled: boolean;
  status: 'not_enabled' | 'unsupported' | 'ready' | 'unavailable' | 'failed' | 'read_only';
  dbPath?: string;
  schemaRevision: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION;
  detectedSchemaRevision?: number;
  readOnly: boolean;
  requiredTables: string[];
  contentBearingTables: string[];
  initializedTables: string[];
  missingTables: string[];
  requiredMigrations: string[];
  appliedMigrations: string[];
  existingMigrations: string[];
  pendingMigrations: string[];
  ftsReady: boolean;
  staging: RelayDocumentSearchIndexDbStagingState;
  wal: RelayDocumentSearchIndexDbWalState;
  dbOnlyActions: Array<Extract<
    RelayDocumentSearchIndexMaintenanceAction,
    'wal-checkpoint' | 'compact'
  >>;
  migrationSafe: boolean;
  schemaGate: RelayDocumentSearchSchemaMigrationGate;
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchSchemaMigrationComponent = {
  name:
    | 'metadata_cache'
    | 'parsed_document_cache'
    | 'query_analyzer'
    | 'parser_pipeline'
    | 'derived_indexes'
    | 'sqlite_fts'
    | 'evidence_pack'
    | 'result_contract'
    | 'user_state';
  kind: 'durable_store' | 'rebuildable_store' | 'versioned_contract';
  status: 'compatible' | 'missing' | 'rebuild_required' | 'read_only_downgrade' | 'invalid';
  currentSchemaVersion: string;
  currentVersion?: string | number;
  detectedSchemaVersion?: string;
  detectedVersion?: string | number;
  readOnly: boolean;
  rebuildRequired: boolean;
  durableDataPreserved: boolean;
  userStatePreserved: boolean;
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchSchemaMigrationGate = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_SCHEMA_MIGRATION_GATE_CONTRACT;
  status: 'ready' | 'rebuild_required' | 'read_only' | 'blocked';
  components: RelayDocumentSearchSchemaMigrationComponent[];
  componentCount: number;
  readOnlyComponentCount: number;
  rebuildRequiredComponentCount: number;
  invalidComponentCount: number;
  durableDataPreserved: boolean;
  userStatePreserved: boolean;
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchIndexMaintenanceResult = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT;
  action: RelayDocumentSearchIndexMaintenanceAction;
  generatedAt: string;
  ok: boolean;
  status: RelayDocumentSearchIndexMaintenanceStatus;
  indexDb: RelayDocumentSearchIndexDbHealth;
  stores: RelayDocumentSearchCacheStoreReport[];
  checks: RelayDocumentSearchStoreIntegrityCheck[];
  cacheAction?: RelayDocumentSearchCacheActionResult;
  indexDbRootInvalidation?: RelayDocumentSearchIndexDbRootInvalidationReport;
  indexDbFileInvalidation?: RelayDocumentSearchIndexDbFileInvalidationReport;
  failureRetryPlan?: RelayDocumentSearchFailedFileRetryPlan;
  failureRetryExecution?: RelayDocumentSearchFailedFileRetryExecution;
  healthEvents?: RelayDocumentSearchIndexHealthEvent[];
  healthEventErrors?: string[];
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchIndexMaintenanceScheduler = {
  enqueue: (
    input: RelayDocumentSearchBackgroundWorkInput,
    runner: RelayDocumentSearchBackgroundWorkRunner,
  ) => RelayDocumentSearchBackgroundWorkSnapshot;
  snapshot: () => RelayDocumentSearchBackgroundSchedulerSnapshot;
  drain?: () => Promise<RelayDocumentSearchBackgroundSchedulerSnapshot>;
};

export type RelayDocumentSearchIndexMaintenanceScheduleOptions = RelayDocumentSearchIndexMaintenanceOptions & {
  scheduler: RelayDocumentSearchIndexMaintenanceScheduler;
  workId?: string;
  priority?: RelayDocumentSearchBackgroundWorkPriority;
  drain?: boolean;
};

export type RelayDocumentSearchIndexMaintenanceScheduleResult = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_SCHEDULE_CONTRACT;
  action: RelayDocumentSearchIndexMaintenanceAction;
  scheduled: true;
  work: RelayDocumentSearchBackgroundWorkSnapshot;
  scheduler: RelayDocumentSearchBackgroundSchedulerSnapshot;
  result?: RelayDocumentSearchIndexMaintenanceResult;
  errors: string[];
};

const INDEX_DB_ONLY_ACTIONS = [
  'wal-checkpoint',
  'compact',
] as const;

const EMPTY_WAL_STATE: RelayDocumentSearchIndexDbWalState = {
  inspected: false,
  walFileBytes: 0,
  shmFileBytes: 0,
  checkpointRecommended: false,
  warnings: [],
  errors: [],
};

const EMPTY_STAGING_STATE: RelayDocumentSearchIndexDbStagingState = {
  inspected: false,
  parsedDocumentCount: 0,
  parsedWithoutDerivedRowsCount: 0,
  parsedWithoutPreviewSpanCount: 0,
  incompleteStagingRecordCount: 0,
  warnings: [],
  errors: [],
};

function versionedContractComponent(
  name: RelayDocumentSearchSchemaMigrationComponent['name'],
  currentSchemaVersion: string,
  currentVersion?: string | number,
): RelayDocumentSearchSchemaMigrationComponent {
  return {
    name,
    kind: 'versioned_contract',
    status: 'compatible',
    currentSchemaVersion,
    currentVersion,
    readOnly: false,
    rebuildRequired: false,
    durableDataPreserved: true,
    userStatePreserved: true,
    warnings: [],
    errors: [],
  };
}

function metadataCacheComponent(
  migration: RelayDocumentSearchMetadataCacheMigrationState | undefined,
): RelayDocumentSearchSchemaMigrationComponent {
  return {
    name: 'metadata_cache',
    kind: 'durable_store',
    status: migration?.status ?? 'missing',
    currentSchemaVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_CONTRACT,
    currentVersion: RELAY_DOCUMENT_SEARCH_METADATA_CACHE_VERSION,
    detectedSchemaVersion: migration?.detectedSchemaVersion,
    detectedVersion: migration?.detectedCacheVersion,
    readOnly: migration?.readOnly ?? false,
    rebuildRequired: migration?.rebuildRequired ?? false,
    durableDataPreserved: migration?.durableDataPreserved ?? true,
    userStatePreserved: true,
    warnings: migration?.warnings ?? [],
    errors: migration?.errors ?? [],
  };
}

function parsedDocumentCacheComponent(): RelayDocumentSearchSchemaMigrationComponent {
  return {
    name: 'parsed_document_cache',
    kind: 'rebuildable_store',
    status: 'compatible',
    currentSchemaVersion: RELAY_PARSED_DOCUMENT_CACHE_CONTRACT,
    currentVersion: `${RELAY_PARSED_DOCUMENT_CACHE_VERSION}:${RELAY_PARSED_DOCUMENT_CACHE_KEY_VERSION}`,
    readOnly: false,
    rebuildRequired: false,
    durableDataPreserved: true,
    userStatePreserved: true,
    warnings: [],
    errors: [],
  };
}

function sqliteFtsComponent(
  schema?: RelayDocumentSearchIndexDbSchemaReport,
): RelayDocumentSearchSchemaMigrationComponent {
  return {
    name: 'sqlite_fts',
    kind: 'rebuildable_store',
    status: schema?.status === 'read_only'
      ? 'read_only_downgrade'
      : schema?.status === 'failed'
        ? 'invalid'
        : schema?.status === 'ready'
          ? 'compatible'
          : 'missing',
    currentSchemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
    currentVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
    detectedVersion: schema?.detectedSchemaRevision,
    readOnly: schema?.readOnly ?? false,
    rebuildRequired: schema?.status === 'failed',
    durableDataPreserved: true,
    userStatePreserved: true,
    warnings: schema?.warnings ?? [],
    errors: schema?.errors ?? [],
  };
}

async function buildSchemaMigrationGate(
  options: RelayDocumentSearchIndexMaintenanceOptions,
  schema?: RelayDocumentSearchIndexDbSchemaReport,
): Promise<RelayDocumentSearchSchemaMigrationGate> {
  let metadataMigration: RelayDocumentSearchMetadataCacheMigrationState | undefined;
  if (options.root) {
    metadataMigration = await inspectRelayDocumentSearchMetadataCacheMigration(options.root, {
      cacheDir: options.metadataCacheDir,
      now: options.now,
    });
  }
  const components: RelayDocumentSearchSchemaMigrationComponent[] = [
    metadataCacheComponent(metadataMigration),
    parsedDocumentCacheComponent(),
    versionedContractComponent('query_analyzer', 'RelayDocumentSearchQueryAnalyzer.v1', RELAY_DOCUMENT_SEARCH_QUERY_NORMALIZER_VERSION),
    versionedContractComponent(
      'parser_pipeline',
      RELAY_PARSED_DOCUMENT_IR_VERSION,
      [
        RELAY_READER_CAPABILITY_REGISTRY_CONTRACT,
        RELAY_STRUCTURE_PATTERN_VERSION,
        RELAY_TEXT_READER_VERSION,
        RELAY_PDF_READER_VERSION,
        RELAY_OFFICE_OPENXML_READER_VERSION,
      ].join('|'),
    ),
    versionedContractComponent(
      'derived_indexes',
      RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CONTRACT,
      `${RELAY_DOCUMENT_SEARCH_DERIVED_SEARCH_STORE_CONTRACT}:${RELAY_DOCUMENT_SEARCH_DERIVED_CONTENT_INDEX_CACHE_CONTRACT}`,
    ),
    sqliteFtsComponent(schema),
    versionedContractComponent('evidence_pack', RELAY_DOCUMENT_SEARCH_EVIDENCE_PACK_CONTRACT),
    versionedContractComponent('result_contract', RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT),
    {
      name: 'user_state',
      kind: 'durable_store',
      status: 'compatible',
      currentSchemaVersion: 'RelayDocumentSearchUserStatePolicy.v1',
      currentVersion: 'preserve_roots_jobs_user_memory_pins_history',
      readOnly: false,
      rebuildRequired: false,
      durableDataPreserved: true,
      userStatePreserved: true,
      warnings: [],
      errors: [],
    },
  ];
  const readOnlyComponentCount = components.filter((component) => component.readOnly).length;
  const rebuildRequiredComponentCount = components.filter((component) => component.rebuildRequired).length;
  const invalidComponentCount = components.filter((component) => component.status === 'invalid').length;
  const warnings = components.flatMap((component) => component.warnings);
  const errors = components.flatMap((component) => component.errors);
  const status: RelayDocumentSearchSchemaMigrationGate['status'] = readOnlyComponentCount > 0
    ? 'read_only'
    : errors.length > 0 || invalidComponentCount > 0
      ? 'blocked'
      : rebuildRequiredComponentCount > 0
        ? 'rebuild_required'
        : 'ready';
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_SCHEMA_MIGRATION_GATE_CONTRACT,
    status,
    components,
    componentCount: components.length,
    readOnlyComponentCount,
    rebuildRequiredComponentCount,
    invalidComponentCount,
    durableDataPreserved: components.every((component) => component.durableDataPreserved),
    userStatePreserved: components.every((component) => component.userStatePreserved),
    warnings,
    errors,
  };
}

const EMPTY_SCHEMA_GATE: RelayDocumentSearchSchemaMigrationGate = {
  schemaVersion: RELAY_DOCUMENT_SEARCH_SCHEMA_MIGRATION_GATE_CONTRACT,
  status: 'ready',
  components: [],
  componentCount: 0,
  readOnlyComponentCount: 0,
  rebuildRequiredComponentCount: 0,
  invalidComponentCount: 0,
  durableDataPreserved: true,
  userStatePreserved: true,
  warnings: [],
  errors: [],
};

async function checkJsonFiles(path: string): Promise<{ checked: number; invalid: number; errors: string[] }> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return { checked: 0, invalid: 0, errors: [] };
  }
  if (info.isFile()) {
    if (!path.endsWith('.json')) return { checked: 0, invalid: 0, errors: [] };
    try {
      JSON.parse(await readFile(path, 'utf8'));
      return { checked: 1, invalid: 0, errors: [] };
    } catch (error) {
      return {
        checked: 1,
        invalid: 1,
        errors: [`${path}: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
  if (!info.isDirectory()) return { checked: 0, invalid: 0, errors: [`${path}: not_a_directory`] };

  const out = { checked: 0, invalid: 0, errors: [] as string[] };
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    return {
      checked: 0,
      invalid: 0,
      errors: [`${path}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  for (const entry of entries) {
    const child = await checkJsonFiles(join(path, entry.name));
    out.checked += child.checked;
    out.invalid += child.invalid;
    out.errors.push(...child.errors);
  }
  return out;
}

async function integrityChecks(
  stores: RelayDocumentSearchCacheStoreReport[],
): Promise<RelayDocumentSearchStoreIntegrityCheck[]> {
  const checks: RelayDocumentSearchStoreIntegrityCheck[] = [];
  for (const store of stores) {
    const check = await checkJsonFiles(store.path);
    checks.push({
      store: store.name,
      path: store.path,
      checkedJsonFiles: check.checked,
      invalidJsonFiles: check.invalid,
      errors: check.errors,
    });
  }
  return checks;
}

async function optionalFileBytes(path: string): Promise<{ bytes: number; error?: string }> {
  try {
    const info = await stat(path);
    return { bytes: info.isFile() ? info.size : 0 };
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'ENOENT') return { bytes: 0 };
    return { bytes: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

async function inspectWalState(dbPath: string | undefined): Promise<RelayDocumentSearchIndexDbWalState> {
  if (!dbPath) return { ...EMPTY_WAL_STATE };
  const wal = await optionalFileBytes(`${dbPath}-wal`);
  const shm = await optionalFileBytes(`${dbPath}-shm`);
  const errors = [wal.error, shm.error].filter((error): error is string => Boolean(error));
  const checkpointRecommended = wal.bytes > 0;
  return {
    inspected: true,
    walFileBytes: wal.bytes,
    shmFileBytes: shm.bytes,
    checkpointRecommended,
    warnings: checkpointRecommended ? ['index_db_wal_checkpoint_recommended'] : [],
    errors,
  };
}

async function withWalState(
  health: RelayDocumentSearchIndexDbHealth,
  options: RelayDocumentSearchIndexMaintenanceOptions,
): Promise<RelayDocumentSearchIndexDbHealth> {
  const wal = await inspectWalState(health.dbPath ?? options.indexDbPath);
  return {
    ...health,
    wal,
    warnings: [...health.warnings, ...wal.warnings],
    errors: [...health.errors, ...wal.errors],
  };
}

async function withStagingState(
  health: RelayDocumentSearchIndexDbHealth,
  options: RelayDocumentSearchIndexMaintenanceOptions,
): Promise<RelayDocumentSearchIndexDbHealth> {
  if (!health.sqliteFtsEnabled) return health;
  const staging = await inspectRelayDocumentSearchIndexDbStagingState(options);
  return {
    ...health,
    staging,
    warnings: [
      ...health.warnings,
      ...staging.warnings,
      ...(staging.incompleteStagingRecordCount > 0 ? ['index_db_incomplete_staging_records_present'] : []),
    ],
    errors: [...health.errors, ...staging.errors],
  };
}

function disabledIndexDbHealth(
  options: RelayDocumentSearchIndexMaintenanceOptions,
): RelayDocumentSearchIndexDbHealth {
  const requested = options.enableIndexDb === true || Boolean(options.indexDbPath);
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_HEALTH_CONTRACT,
    backend: 'json_stores',
    sqliteFtsRequested: requested,
    sqliteFtsEnabled: false,
    status: requested ? 'unsupported' : 'not_enabled',
    dbPath: options.indexDbPath,
    schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
    readOnly: false,
    requiredTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_TABLES],
    contentBearingTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTENT_BEARING_TABLES],
    initializedTables: [],
    missingTables: [],
    requiredMigrations: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_MIGRATIONS],
    appliedMigrations: [],
    existingMigrations: [],
    pendingMigrations: [],
    ftsReady: false,
    staging: { ...EMPTY_STAGING_STATE },
    wal: { ...EMPTY_WAL_STATE },
    dbOnlyActions: [...INDEX_DB_ONLY_ACTIONS],
    migrationSafe: true,
    schemaGate: EMPTY_SCHEMA_GATE,
    warnings: requested
      ? ['sqlite_fts_backend_not_enabled', 'json_store_backend_active']
      : ['json_store_backend_active'],
    errors: [],
  };
}

function missingValues(required: string[], existing: string[]): string[] {
  const existingValues = new Set(existing);
  return required.filter((value) => !existingValues.has(value));
}

function enabledIndexDbHealth(
  schema: RelayDocumentSearchIndexDbSchemaReport,
  schemaGate: RelayDocumentSearchSchemaMigrationGate,
): RelayDocumentSearchIndexDbHealth {
  const missingTables = missingValues(schema.requiredTables, schema.initializedTables);
  const pendingMigrations = missingValues(
    schema.requiredMigrations,
    [...schema.appliedMigrations, ...schema.existingMigrations],
  );
  const warnings = [
    ...schema.warnings,
    ...(missingTables.length ? ['index_db_required_tables_missing'] : []),
    ...(pendingMigrations.length ? ['index_db_required_migrations_pending'] : []),
  ];
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_HEALTH_CONTRACT,
    backend: schema.status === 'ready' ? 'sqlite_fts' : 'json_stores',
    sqliteFtsRequested: true,
    sqliteFtsEnabled: schema.status === 'ready',
    status: schema.status,
    dbPath: schema.dbPath,
    schemaRevision: schema.schemaRevision,
    detectedSchemaRevision: schema.detectedSchemaRevision,
    readOnly: schema.readOnly,
    requiredTables: schema.requiredTables,
    contentBearingTables: schema.contentBearingTables,
    initializedTables: schema.initializedTables,
    missingTables,
    requiredMigrations: schema.requiredMigrations,
    appliedMigrations: schema.appliedMigrations,
    existingMigrations: schema.existingMigrations,
    pendingMigrations,
    ftsReady: schema.ftsReady,
    staging: { ...EMPTY_STAGING_STATE },
    wal: { ...EMPTY_WAL_STATE },
    dbOnlyActions: [...INDEX_DB_ONLY_ACTIONS],
    migrationSafe: schema.status !== 'failed' && schema.status !== 'read_only' && pendingMigrations.length === 0,
    schemaGate,
    warnings: schema.status === 'ready' && missingTables.length === 0 && pendingMigrations.length === 0
      ? schemaGate.warnings
      : [...warnings, ...schemaGate.warnings, 'json_store_backend_active'],
    errors: [...schema.errors, ...schemaGate.errors],
  };
}

async function indexDbHealth(
  options: RelayDocumentSearchIndexMaintenanceOptions,
): Promise<RelayDocumentSearchIndexDbHealth> {
  if (options.enableIndexDb !== true) {
    const schemaGate = await buildSchemaMigrationGate(options);
    return withWalState({
      ...disabledIndexDbHealth(options),
      schemaGate,
      migrationSafe: schemaGate.status !== 'read_only' && schemaGate.status !== 'blocked',
      warnings: [
        ...disabledIndexDbHealth(options).warnings,
        ...schemaGate.warnings,
      ],
      errors: schemaGate.errors,
    }, options);
  }
  const schema = await initializeRelayDocumentSearchIndexDb(options);
  const schemaGate = await buildSchemaMigrationGate(options, schema);
  return withWalState(
    await withStagingState(enabledIndexDbHealth(schema, schemaGate), options),
    options,
  );
}

function notApplicableResult(
  action: RelayDocumentSearchIndexMaintenanceAction,
  stores: RelayDocumentSearchCacheStoreReport[],
  checks: RelayDocumentSearchStoreIntegrityCheck[],
  indexDb: RelayDocumentSearchIndexDbHealth,
  warning: string,
  options: RelayDocumentSearchIndexMaintenanceOptions,
): RelayDocumentSearchIndexMaintenanceResult {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
    action,
    generatedAt: (options.now ?? new Date()).toISOString(),
    ok: true,
    status: 'not_applicable',
    indexDb,
    stores,
    checks,
    warnings: [warning],
    errors: [],
  };
}

function operationCancelled(options: RelayDocumentSearchIndexMaintenanceOptions): boolean {
  return options.signal?.aborted === true;
}

function cancelledResult(
  action: RelayDocumentSearchIndexMaintenanceAction,
  stores: RelayDocumentSearchCacheStoreReport[],
  checks: RelayDocumentSearchStoreIntegrityCheck[],
  indexDb: RelayDocumentSearchIndexDbHealth,
  options: RelayDocumentSearchIndexMaintenanceOptions,
): RelayDocumentSearchIndexMaintenanceResult {
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
    action,
    generatedAt: (options.now ?? new Date()).toISOString(),
    ok: false,
    status: 'cancelled',
    indexDb,
    stores,
    checks,
    warnings: ['operation_cancelled'],
    errors: ['operation_cancelled'],
  };
}

function statusFromCacheAction(
  cacheAction: RelayDocumentSearchCacheActionResult,
): RelayDocumentSearchIndexMaintenanceStatus {
  if (cacheAction.cancelled) return 'cancelled';
  return cacheAction.ok ? 'repaired' : 'failed';
}

function failedFileRetryOptions(
  options: RelayDocumentSearchIndexMaintenanceOptions,
): RelayDocumentSearchFailedFileRetryOptions {
  return {
    root: options.root,
    failureRegistryDir: options.failureRegistryDir,
    failureRegistryMaxEntries: options.failureRegistryMaxEntries,
    maxFailures: options.failedFileRetryLimit,
    now: options.now,
  };
}

function failedFileRetryExecutionOptions(
  options: RelayDocumentSearchIndexMaintenanceOptions,
): RelayDocumentSearchFailedFileRetryExecutionOptions {
  return {
    parsedDocumentCacheDir: options.parsedDocumentCacheDir,
    derivedContentIndexDir: options.derivedContentIndexDir,
    allowUnsafeCacheDirForTests: options.allowUnsafeCacheDirForTests,
    signal: options.signal,
    now: options.now,
  };
}

async function dbMaintenanceResult(
  action: Extract<RelayDocumentSearchIndexMaintenanceAction, 'wal-checkpoint' | 'compact'>,
  sql: string,
  successWarning: string,
  stores: RelayDocumentSearchCacheStoreReport[],
  checks: RelayDocumentSearchStoreIntegrityCheck[],
  indexDb: RelayDocumentSearchIndexDbHealth,
  options: RelayDocumentSearchIndexMaintenanceOptions,
): Promise<RelayDocumentSearchIndexMaintenanceResult> {
  if (!indexDb.sqliteFtsEnabled) {
    return notApplicableResult(
      action,
      stores,
      checks,
      indexDb,
      indexDb.status === 'unavailable' ? 'index_db_unavailable' : 'index_db_not_enabled',
      options,
    );
  }
  const schema = await runRelayDocumentSearchIndexDbMaintenanceSql(sql, options);
  const schemaGate = await buildSchemaMigrationGate(options, schema);
  const maintenance = await withWalState(
    await withStagingState(enabledIndexDbHealth(schema, schemaGate), options),
    options,
  );
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
    action,
    generatedAt: (options.now ?? new Date()).toISOString(),
    ok: maintenance.status === 'ready',
    status: maintenance.status === 'ready' ? 'repaired' : 'failed',
    indexDb: maintenance,
    stores,
    checks,
    warnings: maintenance.status === 'ready' ? [successWarning] : maintenance.warnings,
    errors: maintenance.errors,
  };
}

function shouldRecordHealthEvent(options: RelayDocumentSearchIndexMaintenanceOptions): boolean {
  return options.recordIndexHealthEvents === true || Boolean(options.indexCoordinatorDir);
}

function maintenanceHealthEventDetails(
  result: RelayDocumentSearchIndexMaintenanceResult,
  options: RelayDocumentSearchIndexMaintenanceOptions,
): Record<string, unknown> {
  return {
    action: result.action,
    status: result.status,
    ok: result.ok,
    cancelled: result.status === 'cancelled',
    automatic: false,
    userStarted: true,
    rootRequested: Boolean(options.root),
    storeNames: result.stores.map((store) => store.name),
    storeCount: result.stores.length,
    checkCount: result.checks.length,
    invalidJsonFileCount: result.checks.reduce((sum, check) => sum + check.invalidJsonFiles, 0),
    backend: result.indexDb.backend,
    indexDbStatus: result.indexDb.status,
    sqliteFtsEnabled: result.indexDb.sqliteFtsEnabled,
    schemaRevision: result.indexDb.schemaRevision,
    detectedSchemaRevision: result.indexDb.detectedSchemaRevision,
    schemaGateStatus: result.indexDb.schemaGate.status,
    schemaGateComponentCount: result.indexDb.schemaGate.componentCount,
    schemaGateReadOnlyComponentCount: result.indexDb.schemaGate.readOnlyComponentCount,
    schemaGateRebuildRequiredComponentCount: result.indexDb.schemaGate.rebuildRequiredComponentCount,
    schemaGateInvalidComponentCount: result.indexDb.schemaGate.invalidComponentCount,
    durableDataPreserved: result.indexDb.schemaGate.durableDataPreserved,
    userStatePreserved: result.indexDb.schemaGate.userStatePreserved,
    missingTableCount: result.indexDb.missingTables.length,
    incompleteStagingRecordCount: result.indexDb.staging.incompleteStagingRecordCount,
    parsedWithoutDerivedRowsCount: result.indexDb.staging.parsedWithoutDerivedRowsCount,
    parsedWithoutPreviewSpanCount: result.indexDb.staging.parsedWithoutPreviewSpanCount,
    walFileBytes: result.indexDb.wal.walFileBytes,
    shmFileBytes: result.indexDb.wal.shmFileBytes,
    walCheckpointRecommended: result.indexDb.wal.checkpointRecommended,
    requiredMigrations: result.indexDb.requiredMigrations,
    appliedMigrationCount: result.indexDb.appliedMigrations.length,
    existingMigrationCount: result.indexDb.existingMigrations.length,
    pendingMigrationCount: result.indexDb.pendingMigrations.length,
    indexDbRootInvalidatedFileCount: result.indexDbRootInvalidation?.rootMetadataRowCount ?? 0,
    indexDbFileInvalidatedFileCount: result.indexDbFileInvalidation?.matchedFileCount ?? 0,
    cacheActionRemovedPathCounts: result.cacheAction?.removedPathCounts ?? {},
    rootRemovalParsedCacheRemovedPathCount: result.cacheAction?.removedPathCounts.parsedDocumentCache ?? 0,
    rootRemovalDerivedCacheRemovedPathCount: result.cacheAction?.removedPathCounts.derivedContentIndex ?? 0,
    failedFileRetryCandidateCount: result.failureRetryPlan?.failedFileCount ?? 0,
    failedFileRetrySelectedCount: result.failureRetryPlan?.selectedFailureCount ?? 0,
    failedFileRetryParsedCacheInvalidatedCount: result.failureRetryExecution?.invalidatedParsedDocumentCacheCount ?? 0,
    failedFileRetryDerivedCacheInvalidatedCount: result.failureRetryExecution?.invalidatedDerivedContentIndexCount ?? 0,
    warningCount: result.warnings.length,
    errorCount: result.errors.length,
  };
}

async function withMaintenanceHealthEvent(
  result: RelayDocumentSearchIndexMaintenanceResult,
  options: RelayDocumentSearchIndexMaintenanceOptions,
): Promise<RelayDocumentSearchIndexMaintenanceResult> {
  if (!shouldRecordHealthEvent(options)) return result;
  try {
    const item = await recordRelayDocumentSearchIndexHealthEvent(
      result.ok ? 'maintenance_completed' : 'maintenance_failed',
      {
        coordinatorDir: options.indexCoordinatorDir,
        now: options.now,
        ownerId: options.ownerId ?? `maintenance-${result.action}`,
        appVersion: options.appVersion,
      },
      maintenanceHealthEventDetails(result, options),
      result.action,
    );
    return { ...result, healthEvents: [item], healthEventErrors: [] };
  } catch (error) {
    return {
      ...result,
      healthEvents: [],
      healthEventErrors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function runRelayDocumentSearchIndexMaintenance(
  action: RelayDocumentSearchIndexMaintenanceAction,
  options: RelayDocumentSearchIndexMaintenanceOptions = {},
): Promise<RelayDocumentSearchIndexMaintenanceResult> {
  const stores = await inspectRelayDocumentSearchCaches(options);
  const indexDb = await indexDbHealth(options);
  if (operationCancelled(options)) {
    return withMaintenanceHealthEvent(cancelledResult(action, stores, [], indexDb, options), options);
  }
  const checks = action === 'integrity-check' ? await integrityChecks(stores) : [];
  if (action === 'integrity-check') {
    const errors = checks.flatMap((check) => check.errors);
    return withMaintenanceHealthEvent({
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
      action,
      generatedAt: (options.now ?? new Date()).toISOString(),
      ok: errors.length === 0,
      status: errors.length === 0 ? 'ok' : 'failed',
      indexDb,
      stores,
      checks,
      warnings: [],
      errors,
    }, options);
  }

  if (action === 'rebuild-derived-indexes') {
    const cacheAction = await runRelayDocumentSearchCacheAction('clear-derived-caches', options);
    const status = statusFromCacheAction(cacheAction);
    return withMaintenanceHealthEvent({
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
      action,
      generatedAt: (options.now ?? new Date()).toISOString(),
      ok: cacheAction.ok,
      status,
      indexDb,
      stores,
      checks,
      cacheAction,
      warnings: [
        ...cacheAction.warnings,
        ...(status === 'repaired' ? ['derived_indexes_will_rebuild_on_next_search'] : []),
      ],
      errors: cacheAction.errors.map((error) => error.message),
    }, options);
  }

  if (action === 'wal-checkpoint') {
    return withMaintenanceHealthEvent(await dbMaintenanceResult(
      action,
      'PRAGMA wal_checkpoint(TRUNCATE);',
      'index_db_wal_checkpoint_completed',
      stores,
      checks,
      indexDb,
      options,
    ), options);
  }
  if (action === 'compact') {
    return withMaintenanceHealthEvent(await dbMaintenanceResult(
      action,
      'VACUUM;',
      'index_db_compact_completed',
      stores,
      checks,
      indexDb,
      options,
    ), options);
  }
  if (action === 'rebuild-previews') {
    const cacheAction = await runRelayDocumentSearchCacheAction('clear-derived-content-index', options);
    const status = statusFromCacheAction(cacheAction);
    return withMaintenanceHealthEvent({
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
      action,
      generatedAt: (options.now ?? new Date()).toISOString(),
      ok: cacheAction.ok,
      status,
      indexDb,
      stores,
      checks,
      cacheAction,
      warnings: [
        ...cacheAction.warnings,
        ...(status === 'repaired' ? ['preview_indexes_will_rebuild_on_next_search'] : []),
      ],
      errors: cacheAction.errors.map((error) => error.message),
    }, options);
  }
  if (action === 'rebuild-root') {
    if (!options.root) {
      return withMaintenanceHealthEvent(
        notApplicableResult(action, stores, checks, indexDb, 'root_required', options),
        options,
      );
    }
    const cacheAction = await runRelayDocumentSearchCacheAction('clear-root-caches', options);
    const indexDbRootInvalidation = indexDb.sqliteFtsEnabled
      ? await invalidateRelayDocumentSearchIndexDbRoot(options.root, options)
      : undefined;
    const dbErrors = indexDbRootInvalidation?.errors ?? [];
    const status = dbErrors.length > 0 ? 'failed' : statusFromCacheAction(cacheAction);
    return withMaintenanceHealthEvent({
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
      action,
      generatedAt: (options.now ?? new Date()).toISOString(),
      ok: cacheAction.ok && dbErrors.length === 0,
      status,
      indexDb,
      stores,
      checks,
      cacheAction,
      indexDbRootInvalidation,
      warnings: [
        ...cacheAction.warnings,
        ...(indexDbRootInvalidation?.warnings ?? []),
        ...(status === 'repaired' ? ['root_metadata_and_indexes_will_rebuild_on_next_search'] : []),
      ],
      errors: [
        ...cacheAction.errors.map((error) => error.message),
        ...dbErrors,
      ],
    }, options);
  }
  if (action === 'remove-root') {
    if (!options.root) {
      return withMaintenanceHealthEvent(
        notApplicableResult(action, stores, checks, indexDb, 'root_required', options),
        options,
      );
    }
    const cacheAction = await runRelayDocumentSearchCacheAction('remove-root-caches', options);
    const indexDbRootInvalidation = cacheAction.ok && indexDb.sqliteFtsEnabled
      ? await invalidateRelayDocumentSearchIndexDbRoot(options.root, options)
      : undefined;
    const dbErrors = indexDbRootInvalidation?.errors ?? [];
    const status = dbErrors.length > 0 ? 'failed' : statusFromCacheAction(cacheAction);
    return withMaintenanceHealthEvent({
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
      action,
      generatedAt: (options.now ?? new Date()).toISOString(),
      ok: cacheAction.ok && dbErrors.length === 0,
      status,
      indexDb,
      stores,
      checks,
      cacheAction,
      indexDbRootInvalidation,
      warnings: [
        ...cacheAction.warnings,
        ...(indexDbRootInvalidation?.warnings ?? []),
        ...(status === 'repaired' ? ['root_removed_from_document_search_caches'] : []),
      ],
      errors: [
        ...cacheAction.errors.map((error) => error.message),
        ...dbErrors,
      ],
    }, options);
  }
  if (action === 'retry-failed-files') {
    if (!options.root) {
      return withMaintenanceHealthEvent(
        notApplicableResult(action, stores, checks, indexDb, 'root_required', options),
        options,
      );
    }
    const failureRetryPlan = await requestRelayDocumentSearchFailedFileRetries(failedFileRetryOptions(options));
    if (failureRetryPlan.selectedFailureCount > 0) {
      const failureRetryExecution = await executeRelayDocumentSearchFailedFileRetries(
        failureRetryPlan,
        failedFileRetryExecutionOptions(options),
      );
      const indexDbFileInvalidation = indexDb.sqliteFtsEnabled
        ? await invalidateRelayDocumentSearchIndexDbFiles(failureRetryPlan.selectedFailures, options)
        : undefined;
      const dbErrors = indexDbFileInvalidation?.errors ?? [];
      const errors = [
        ...failureRetryExecution.errors,
        ...dbErrors,
      ];
      const status: RelayDocumentSearchIndexMaintenanceStatus = errors.length > 0 ? 'failed' : 'repaired';
      return withMaintenanceHealthEvent({
        schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
        action,
        generatedAt: (options.now ?? new Date()).toISOString(),
        ok: errors.length === 0,
        status,
        indexDb,
        stores,
        checks,
        indexDbFileInvalidation,
        failureRetryPlan,
        failureRetryExecution,
        warnings: [
          ...failureRetryPlan.warnings,
          ...failureRetryExecution.warnings,
          ...(indexDbFileInvalidation?.warnings ?? []),
          ...(status === 'repaired'
            ? [
                'failed_files_will_retry_on_next_search',
                'failed_file_retry_plan_recorded',
                'failed_file_retry_uses_per_file_invalidation',
              ]
            : []),
        ],
        errors,
      }, options);
    }

    const cacheAction = await runRelayDocumentSearchCacheAction('clear-root-caches', options);
    const indexDbRootInvalidation = indexDb.sqliteFtsEnabled
      ? await invalidateRelayDocumentSearchIndexDbRoot(options.root, options)
      : undefined;
    const dbErrors = indexDbRootInvalidation?.errors ?? [];
    const status = dbErrors.length > 0 ? 'failed' : statusFromCacheAction(cacheAction);
    return withMaintenanceHealthEvent({
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
      action,
      generatedAt: (options.now ?? new Date()).toISOString(),
      ok: cacheAction.ok && dbErrors.length === 0,
      status,
      indexDb,
      stores,
      checks,
      cacheAction,
      indexDbRootInvalidation,
      failureRetryPlan,
      warnings: [
        ...cacheAction.warnings,
        ...failureRetryPlan.warnings,
        ...(indexDbRootInvalidation?.warnings ?? []),
        ...(status === 'repaired'
          ? [
              'failed_files_will_retry_on_next_search',
              'failed_file_retry_registry_empty_root_rescan_fallback',
            ]
          : []),
      ],
      errors: [
        ...cacheAction.errors.map((error) => error.message),
        ...dbErrors,
      ],
    }, options);
  }
  if (action === 'full-rescan') {
    const cacheAction = await runRelayDocumentSearchCacheAction('clear-rescan-caches', options);
    const status = statusFromCacheAction(cacheAction);
    return withMaintenanceHealthEvent({
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
      action,
      generatedAt: (options.now ?? new Date()).toISOString(),
      ok: cacheAction.ok,
      status,
      indexDb,
      stores,
      checks,
      cacheAction,
      warnings: [
        ...cacheAction.warnings,
        ...(status === 'repaired' ? ['workspace_metadata_and_indexes_will_rebuild_on_next_search'] : []),
      ],
      errors: cacheAction.errors.map((error) => error.message),
    }, options);
  }

  return withMaintenanceHealthEvent({
    schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_CONTRACT,
    action,
    generatedAt: (options.now ?? new Date()).toISOString(),
    ok: false,
    status: 'failed',
    indexDb,
    stores,
    checks,
    warnings: [],
    errors: [`Unsupported maintenance action: ${action}`],
  }, options);
}

function schedulerResultForMaintenance(
  result: RelayDocumentSearchIndexMaintenanceResult,
): RelayDocumentSearchBackgroundWorkResult {
  if (result.status === 'cancelled') return { status: 'partial' };
  return { status: result.ok ? 'ok' : 'failed' };
}

export async function scheduleRelayDocumentSearchIndexMaintenance(
  action: RelayDocumentSearchIndexMaintenanceAction,
  options: RelayDocumentSearchIndexMaintenanceScheduleOptions,
): Promise<RelayDocumentSearchIndexMaintenanceScheduleResult> {
  let result: RelayDocumentSearchIndexMaintenanceResult | undefined;
  const work = options.scheduler.enqueue(
    {
      workId: options.workId,
      kind: 'index_maintenance',
      priority: options.priority ?? 'idle',
      roots: options.root ? [options.root] : [],
    },
    async (_work, context) => {
      result = await runRelayDocumentSearchIndexMaintenance(action, {
        ...options,
        signal: options.signal?.aborted ? options.signal : context.signal,
      });
      if (!result.ok && result.status !== 'cancelled') {
        throw new Error(result.errors[0] ?? `Relay document search maintenance failed: ${action}`);
      }
      return schedulerResultForMaintenance(result);
    },
  );
  const scheduler = options.drain && options.scheduler.drain
    ? await options.scheduler.drain()
    : options.scheduler.snapshot();
  return {
    schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_MAINTENANCE_SCHEDULE_CONTRACT,
    action,
    scheduled: true,
    work: scheduler.items.find((item) => item.workId === work.workId) ?? work,
    scheduler,
    result,
    errors: result?.errors ?? [],
  };
}
