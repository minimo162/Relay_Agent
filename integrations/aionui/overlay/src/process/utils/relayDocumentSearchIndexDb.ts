import { homedir } from 'os';
import { dirname, join, resolve, sep } from 'path';
import { mkdir } from 'fs/promises';

import type { RelayDocumentSearchCachedFileMetadata } from './relayDocumentSearchMetadataCache';
import type {
  RelayDocumentSearchDerivedSearchStoreRow,
  RelayDocumentSearchDerivedSearchStoreV1,
} from './relayDocumentSearchDerivedContentIndex';

export const RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT = 'RelayDocumentSearchIndexDb.v1' as const;
export const RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION = 2 as const;
const RELAY_DOCUMENT_SEARCH_INDEX_DB_PATH_ENV = 'RELAY_DOCUMENT_SEARCH_INDEX_DB_PATH';

export type RelayDocumentSearchIndexDbStatus = 'ready' | 'unavailable' | 'failed' | 'read_only';

export type RelayDocumentSearchSqliteStatement = {
  run(...params: unknown[]): unknown;
  all?(...params: unknown[]): unknown[];
};

export type RelayDocumentSearchSqliteDatabase = {
  exec(sql: string): unknown;
  prepare?(sql: string): RelayDocumentSearchSqliteStatement;
  close(): void;
};

export type RelayDocumentSearchSqliteModule = {
  DatabaseSync: new (path: string) => RelayDocumentSearchSqliteDatabase;
};

export type RelayDocumentSearchIndexDbOptions = {
  indexDbPath?: string;
  sqliteModule?: RelayDocumentSearchSqliteModule;
  now?: Date;
};

export type RelayDocumentSearchIndexDbSchemaReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT;
  schemaRevision: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION;
  status: RelayDocumentSearchIndexDbStatus;
  dbPath?: string;
  requiredTables: string[];
  contentBearingTables: string[];
  initializedTables: string[];
  requiredMigrations: string[];
  appliedMigrations: string[];
  existingMigrations: string[];
  detectedSchemaRevision?: number;
  readOnly: boolean;
  ftsReady: boolean;
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchIndexDbStagingState = {
  inspected: boolean;
  parsedDocumentCount: number;
  parsedWithoutDerivedRowsCount: number;
  parsedWithoutPreviewSpanCount: number;
  incompleteStagingRecordCount: number;
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchIndexDbRootInvalidationReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT;
  schemaRevision: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION;
  status: RelayDocumentSearchIndexDbStatus;
  dbPath?: string;
  rootRequested: boolean;
  rootMetadataRowCount: number;
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchIndexDbFileInvalidationTarget = {
  root: string;
  fileId?: string;
  path?: string;
  pathHash?: string;
};

export type RelayDocumentSearchIndexDbFileInvalidationReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT;
  schemaRevision: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION;
  status: RelayDocumentSearchIndexDbStatus;
  dbPath?: string;
  targetFileCount: number;
  matchedFileCount: number;
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchIndexDbWriteReport = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT;
  schemaRevision: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION;
  status: RelayDocumentSearchIndexDbStatus;
  dbPath?: string;
  fileMetadataRowCount: number;
  ftsRowCount: number;
  previewSpanRowCount: number;
  requiredMigrations: string[];
  appliedMigrations: string[];
  existingMigrations: string[];
  warnings: string[];
  errors: string[];
};

export type RelayDocumentSearchIndexDbSearchRow = {
  file_id: string;
  entry_id: string;
  entry_kind: 'text' | 'table_cell';
  text: string;
  rank?: number;
  bm25_score?: number;
  fts_snippet?: string;
  span_id?: string;
  preview_text?: string;
  title?: string;
  location_label?: string;
  source_metadata_version?: string;
  parsed_document_uid?: string;
  parser_version?: string;
  anchor?: Record<string, unknown>;
};

export type RelayDocumentSearchIndexDbSearchResult = {
  schemaVersion: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT;
  schemaRevision: typeof RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION;
  status: RelayDocumentSearchIndexDbStatus;
  dbPath?: string;
  query: string;
  maxRows: number;
  rawRowCount: number;
  textRawRowCount: number;
  tableCellRawRowCount: number;
  droppedRowCount: number;
  truncated: boolean;
  rows: RelayDocumentSearchIndexDbSearchRow[];
  requiredMigrations: string[];
  appliedMigrations: string[];
  existingMigrations: string[];
  warnings: string[];
  errors: string[];
};

export const RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_TABLES = [
  'index_schema_migrations',
  'workspace_roots',
  'file_metadata',
  'parsed_documents',
  'content_nodes_fts',
  'table_cells_fts',
  'preview_spans',
  'sync_journal',
  'index_health_events',
] as const;

export const RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTENT_BEARING_TABLES = [
  'parsed_documents',
  'content_nodes_fts',
  'table_cells_fts',
  'preview_spans',
] as const;

const INDEX_DB_SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS workspace_roots (
  root_id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL UNIQUE,
  scan_policy TEXT NOT NULL DEFAULT 'metadata_first',
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS index_schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_metadata (
  file_id TEXT PRIMARY KEY,
  root_id TEXT,
  path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  extension TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  modified_at TEXT NOT NULL,
  source_metadata_version TEXT NOT NULL,
  content_state TEXT NOT NULL DEFAULT 'unknown',
  access_state TEXT NOT NULL DEFAULT 'unknown',
  updated_at TEXT NOT NULL,
  FOREIGN KEY(root_id) REFERENCES workspace_roots(root_id)
);

CREATE TABLE IF NOT EXISTS parsed_documents (
  file_id TEXT PRIMARY KEY,
  parser_version TEXT NOT NULL,
  source_metadata_version TEXT NOT NULL,
  parsed_document_json TEXT NOT NULL,
  parser_confidence REAL NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL,
  FOREIGN KEY(file_id) REFERENCES file_metadata(file_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS content_nodes_fts USING fts5(
  file_id UNINDEXED,
  node_id UNINDEXED,
  text,
  headings,
  tokenize = 'unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS table_cells_fts USING fts5(
  file_id UNINDEXED,
  table_id UNINDEXED,
  cell_ref UNINDEXED,
  text,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS preview_spans (
  file_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  entry_id TEXT,
  entry_kind TEXT,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  preview_text TEXT NOT NULL,
  title TEXT,
  location_label TEXT,
  source_metadata_version TEXT,
  parsed_document_uid TEXT,
  parser_version TEXT,
  anchor_json TEXT,
  generated_at TEXT NOT NULL,
  PRIMARY KEY(file_id, span_id),
  FOREIGN KEY(file_id) REFERENCES file_metadata(file_id)
);

CREATE TABLE IF NOT EXISTS sync_journal (
  event_id TEXT PRIMARY KEY,
  event_kind TEXT NOT NULL,
  root_path TEXT,
  path_hash TEXT,
  recorded_at TEXT NOT NULL,
  details_json TEXT
);

CREATE TABLE IF NOT EXISTS index_health_events (
  event_id TEXT PRIMARY KEY,
  event_kind TEXT NOT NULL,
  owner_id TEXT,
  recorded_at TEXT NOT NULL,
  details_json TEXT
);
`;

const INDEX_DB_BEST_EFFORT_MIGRATIONS = [
  {
    id: '20260510_preview_spans_entry_id',
    column: 'entry_id',
    sql: 'ALTER TABLE preview_spans ADD COLUMN entry_id TEXT',
  },
  {
    id: '20260510_preview_spans_entry_kind',
    column: 'entry_kind',
    sql: 'ALTER TABLE preview_spans ADD COLUMN entry_kind TEXT',
  },
  {
    id: '20260510_preview_spans_title',
    column: 'title',
    sql: 'ALTER TABLE preview_spans ADD COLUMN title TEXT',
  },
  {
    id: '20260510_preview_spans_location_label',
    column: 'location_label',
    sql: 'ALTER TABLE preview_spans ADD COLUMN location_label TEXT',
  },
  {
    id: '20260510_preview_spans_source_metadata_version',
    column: 'source_metadata_version',
    sql: 'ALTER TABLE preview_spans ADD COLUMN source_metadata_version TEXT',
  },
  {
    id: '20260510_preview_spans_parsed_document_uid',
    column: 'parsed_document_uid',
    sql: 'ALTER TABLE preview_spans ADD COLUMN parsed_document_uid TEXT',
  },
  {
    id: '20260510_preview_spans_parser_version',
    column: 'parser_version',
    sql: 'ALTER TABLE preview_spans ADD COLUMN parser_version TEXT',
  },
  {
    id: '20260510_preview_spans_anchor_json',
    column: 'anchor_json',
    sql: 'ALTER TABLE preview_spans ADD COLUMN anchor_json TEXT',
  },
] as const;

export const RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_MIGRATIONS =
  INDEX_DB_BEST_EFFORT_MIGRATIONS.map((migration) => migration.id);

function defaultIndexDbDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir();
  return join(base, 'Relay Agent', 'document-search', 'index-db');
}

export function relayDocumentSearchIndexDbPathForOptions(
  options: RelayDocumentSearchIndexDbOptions = {},
): string {
  const configured = options.indexDbPath || process.env[RELAY_DOCUMENT_SEARCH_INDEX_DB_PATH_ENV];
  return resolve(configured && configured.trim() ? configured : join(defaultIndexDbDir(), 'document-search.sqlite'));
}

async function loadSqliteModule(): Promise<RelayDocumentSearchSqliteModule | undefined> {
  try {
    const sqliteModule = await import('node:sqlite');
    return sqliteModule as unknown as RelayDocumentSearchSqliteModule;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requirePrepare(db: RelayDocumentSearchSqliteDatabase): NonNullable<RelayDocumentSearchSqliteDatabase['prepare']> {
  if (!db.prepare) {
    throw new Error('sqlite_prepare_unavailable');
  }
  return db.prepare.bind(db);
}

function isDuplicateColumnError(error: unknown): boolean {
  return /duplicate column|already exists/iu.test(errorMessage(error));
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function previewSpanColumns(db: RelayDocumentSearchSqliteDatabase): Set<string> | undefined {
  const statement = db.prepare?.('PRAGMA table_info(preview_spans)');
  const rows = statement?.all?.();
  if (!rows) return undefined;
  return new Set(
    rows
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
      .map((row) => typeof row.name === 'string' ? row.name : '')
      .filter(Boolean),
  );
}

function indexDbUserVersion(db: RelayDocumentSearchSqliteDatabase): number | undefined {
  const rows = db.prepare?.('PRAGMA user_version').all?.();
  const first = rows?.[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return undefined;
  const value = (first as Record<string, unknown>).user_version;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function recordMigration(
  db: RelayDocumentSearchSqliteDatabase,
  migrationId: string,
  appliedAt: string,
): void {
  const sql = 'INSERT OR IGNORE INTO index_schema_migrations (migration_id, applied_at) VALUES (?, ?)';
  const statement = db.prepare?.(sql);
  if (statement) {
    statement.run(migrationId, appliedAt);
    return;
  }
  db.exec(
    `INSERT OR IGNORE INTO index_schema_migrations (migration_id, applied_at) VALUES (` +
      `${sqlString(migrationId)}, ${sqlString(appliedAt)});`,
  );
}

function runBestEffortMigrations(
  db: RelayDocumentSearchSqliteDatabase,
  appliedAt: string,
): { appliedMigrations: string[]; existingMigrations: string[] } {
  const columns = previewSpanColumns(db);
  const appliedMigrations: string[] = [];
  const existingMigrations: string[] = [];
  for (const migration of INDEX_DB_BEST_EFFORT_MIGRATIONS) {
    if (columns?.has(migration.column)) {
      existingMigrations.push(migration.id);
      recordMigration(db, migration.id, appliedAt);
      continue;
    }
    try {
      db.exec(migration.sql);
      appliedMigrations.push(migration.id);
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
      existingMigrations.push(migration.id);
    }
    recordMigration(db, migration.id, appliedAt);
  }
  db.exec(`PRAGMA user_version = ${RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION};`);
  return { appliedMigrations, existingMigrations };
}

function schemaMigrationFields(schema: RelayDocumentSearchIndexDbSchemaReport): Pick<
  RelayDocumentSearchIndexDbWriteReport,
  'schemaRevision' | 'requiredMigrations' | 'appliedMigrations' | 'existingMigrations'
> {
  return {
    schemaRevision: schema.schemaRevision,
    requiredMigrations: schema.requiredMigrations,
    appliedMigrations: schema.appliedMigrations,
    existingMigrations: schema.existingMigrations,
  };
}

function countFromRows(rows: unknown[] | undefined): number {
  const first = rows?.[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return 0;
  const value = (first as Record<string, unknown>).count;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function countQuery(db: RelayDocumentSearchSqliteDatabase, sql: string): number | undefined {
  const rows = db.prepare?.(sql).all?.();
  return countFromRows(rows);
}

function rootPathPredicateSql(root: string): string {
  const normalizedRoot = resolve(root);
  const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  return `path = ${sqlString(normalizedRoot)} OR substr(path, 1, ${rootPrefix.length}) = ${sqlString(rootPrefix)}`;
}

function fileInvalidationPredicateSql(targets: RelayDocumentSearchIndexDbFileInvalidationTarget[]): string | undefined {
  const clauses = targets.flatMap((target) => {
    const out: string[] = [];
    if (target.fileId) out.push(`file_id = ${sqlString(target.fileId)}`);
    if (target.path) out.push(`path = ${sqlString(resolve(target.path))}`);
    return out;
  });
  return clauses.length ? clauses.map((clause) => `(${clause})`).join(' OR ') : undefined;
}

export async function inspectRelayDocumentSearchIndexDbStagingState(
  options: RelayDocumentSearchIndexDbOptions = {},
): Promise<RelayDocumentSearchIndexDbStagingState> {
  const dbPath = relayDocumentSearchIndexDbPathForOptions(options);
  const sqliteModule = options.sqliteModule ?? await loadSqliteModule();
  if (!sqliteModule) {
    return {
      inspected: false,
      parsedDocumentCount: 0,
      parsedWithoutDerivedRowsCount: 0,
      parsedWithoutPreviewSpanCount: 0,
      incompleteStagingRecordCount: 0,
      warnings: ['node_sqlite_unavailable'],
      errors: [],
    };
  }

  let db: RelayDocumentSearchSqliteDatabase | undefined;
  try {
    db = new sqliteModule.DatabaseSync(dbPath);
    if (!db.prepare) {
      return {
        inspected: false,
        parsedDocumentCount: 0,
        parsedWithoutDerivedRowsCount: 0,
        parsedWithoutPreviewSpanCount: 0,
        incompleteStagingRecordCount: 0,
        warnings: ['sqlite_prepare_unavailable_for_staging_health'],
        errors: [],
      };
    }
    const parsedDocumentCount = countQuery(db, 'SELECT COUNT(*) AS count FROM parsed_documents') ?? 0;
    const parsedWithoutDerivedRowsCount = countQuery(
      db,
      `SELECT COUNT(*) AS count
       FROM parsed_documents
       WHERE NOT EXISTS (
         SELECT 1 FROM content_nodes_fts WHERE content_nodes_fts.file_id = parsed_documents.file_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM table_cells_fts WHERE table_cells_fts.file_id = parsed_documents.file_id
       )`,
    ) ?? 0;
    const parsedWithoutPreviewSpanCount = countQuery(
      db,
      `SELECT COUNT(*) AS count
       FROM parsed_documents
       WHERE NOT EXISTS (
         SELECT 1 FROM preview_spans WHERE preview_spans.file_id = parsed_documents.file_id
       )`,
    ) ?? 0;
    return {
      inspected: true,
      parsedDocumentCount,
      parsedWithoutDerivedRowsCount,
      parsedWithoutPreviewSpanCount,
      incompleteStagingRecordCount: Math.max(parsedWithoutDerivedRowsCount, parsedWithoutPreviewSpanCount),
      warnings: [],
      errors: [],
    };
  } catch (error) {
    return {
      inspected: false,
      parsedDocumentCount: 0,
      parsedWithoutDerivedRowsCount: 0,
      parsedWithoutPreviewSpanCount: 0,
      incompleteStagingRecordCount: 0,
      warnings: [],
      errors: [errorMessage(error)],
    };
  } finally {
    db?.close();
  }
}

async function openReadyIndexDb(
  options: RelayDocumentSearchIndexDbOptions,
): Promise<{
  schema: RelayDocumentSearchIndexDbSchemaReport;
  sqliteModule?: RelayDocumentSearchSqliteModule;
  db?: RelayDocumentSearchSqliteDatabase;
}> {
  const schema = await initializeRelayDocumentSearchIndexDb(options);
  if (schema.status !== 'ready') return { schema };
  const sqliteModule = options.sqliteModule ?? await loadSqliteModule();
  if (!sqliteModule) return { schema: { ...schema, status: 'unavailable', ftsReady: false } };
  return {
    schema,
    sqliteModule,
    db: new sqliteModule.DatabaseSync(schema.dbPath as string),
  };
}

export async function initializeRelayDocumentSearchIndexDb(
  options: RelayDocumentSearchIndexDbOptions = {},
): Promise<RelayDocumentSearchIndexDbSchemaReport> {
  const dbPath = relayDocumentSearchIndexDbPathForOptions(options);
  const sqliteModule = options.sqliteModule ?? await loadSqliteModule();
  let migrationResult: { appliedMigrations: string[]; existingMigrations: string[] } = {
    appliedMigrations: [],
    existingMigrations: [],
  };
  if (!sqliteModule) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: 'unavailable',
      dbPath,
      requiredTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_TABLES],
      contentBearingTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTENT_BEARING_TABLES],
      initializedTables: [],
      requiredMigrations: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_MIGRATIONS],
      appliedMigrations: [],
      existingMigrations: [],
      readOnly: false,
      ftsReady: false,
      warnings: ['node_sqlite_unavailable'],
      errors: [],
    };
  }

  let db: RelayDocumentSearchSqliteDatabase | undefined;
  try {
    await mkdir(dirname(dbPath), { recursive: true });
    db = new sqliteModule.DatabaseSync(dbPath);
    const detectedSchemaRevision = indexDbUserVersion(db) ?? 0;
    if (detectedSchemaRevision > RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION) {
      return {
        schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
        schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
        detectedSchemaRevision,
        status: 'read_only',
        dbPath,
        requiredTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_TABLES],
        contentBearingTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTENT_BEARING_TABLES],
        initializedTables: [],
        requiredMigrations: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_MIGRATIONS],
        appliedMigrations: [],
        existingMigrations: [],
        readOnly: true,
        ftsReady: false,
        warnings: ['index_db_newer_schema_opened_read_only'],
        errors: [],
      };
    }
    db.exec(INDEX_DB_SCHEMA_SQL);
    migrationResult = runBestEffortMigrations(db, (options.now ?? new Date()).toISOString());
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      detectedSchemaRevision,
      status: 'ready',
      dbPath,
      requiredTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_TABLES],
      contentBearingTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTENT_BEARING_TABLES],
      initializedTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_TABLES],
      requiredMigrations: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_MIGRATIONS],
      appliedMigrations: migrationResult.appliedMigrations,
      existingMigrations: migrationResult.existingMigrations,
      readOnly: false,
      ftsReady: true,
      warnings: [],
      errors: [],
    };
  } catch (error) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: 'failed',
      dbPath,
      requiredTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_TABLES],
      contentBearingTables: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTENT_BEARING_TABLES],
      initializedTables: [],
      requiredMigrations: [...RELAY_DOCUMENT_SEARCH_INDEX_DB_REQUIRED_MIGRATIONS],
      appliedMigrations: migrationResult.appliedMigrations,
      existingMigrations: migrationResult.existingMigrations,
      readOnly: false,
      ftsReady: false,
      warnings: [],
      errors: [errorMessage(error)],
    };
  } finally {
    db?.close();
  }
}

export async function runRelayDocumentSearchIndexDbMaintenanceSql(
  sql: string,
  options: RelayDocumentSearchIndexDbOptions = {},
): Promise<RelayDocumentSearchIndexDbSchemaReport> {
  const initialized = await initializeRelayDocumentSearchIndexDb(options);
  if (initialized.status !== 'ready') return initialized;
  const sqliteModule = options.sqliteModule ?? await loadSqliteModule();
  if (!sqliteModule) return initialized;

  let db: RelayDocumentSearchSqliteDatabase | undefined;
  try {
    db = new sqliteModule.DatabaseSync(initialized.dbPath as string);
    db.exec(sql);
    return initialized;
  } catch (error) {
    return {
      ...initialized,
      status: 'failed',
      ftsReady: false,
      errors: [errorMessage(error)],
    };
  } finally {
    db?.close();
  }
}

export async function invalidateRelayDocumentSearchIndexDbRoot(
  root: string | undefined,
  options: RelayDocumentSearchIndexDbOptions = {},
): Promise<RelayDocumentSearchIndexDbRootInvalidationReport> {
  const initialized = await initializeRelayDocumentSearchIndexDb(options);
  if (!root) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: initialized.status,
      dbPath: initialized.dbPath,
      rootRequested: false,
      rootMetadataRowCount: 0,
      warnings: ['root_required'],
      errors: [],
    };
  }
  if (initialized.status !== 'ready') {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: initialized.status,
      dbPath: initialized.dbPath,
      rootRequested: true,
      rootMetadataRowCount: 0,
      warnings: initialized.warnings,
      errors: initialized.errors,
    };
  }
  const sqliteModule = options.sqliteModule ?? await loadSqliteModule();
  if (!sqliteModule) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: initialized.status,
      dbPath: initialized.dbPath,
      rootRequested: true,
      rootMetadataRowCount: 0,
      warnings: ['node_sqlite_unavailable'],
      errors: [],
    };
  }

  let db: RelayDocumentSearchSqliteDatabase | undefined;
  try {
    db = new sqliteModule.DatabaseSync(initialized.dbPath as string);
    const predicate = rootPathPredicateSql(root);
    const fileIds = `SELECT file_id FROM file_metadata WHERE ${predicate}`;
    const rootMetadataRowCount = countQuery(db, `SELECT COUNT(*) AS count FROM file_metadata WHERE ${predicate}`) ?? 0;
    db.exec(`
      DELETE FROM content_nodes_fts WHERE file_id IN (${fileIds});
      DELETE FROM table_cells_fts WHERE file_id IN (${fileIds});
      DELETE FROM preview_spans WHERE file_id IN (${fileIds});
      DELETE FROM parsed_documents WHERE file_id IN (${fileIds});
      DELETE FROM file_metadata WHERE ${predicate};
    `);
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: 'ready',
      dbPath: initialized.dbPath,
      rootRequested: true,
      rootMetadataRowCount,
      warnings: [],
      errors: [],
    };
  } catch (error) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: 'failed',
      dbPath: initialized.dbPath,
      rootRequested: true,
      rootMetadataRowCount: 0,
      warnings: [],
      errors: [errorMessage(error)],
    };
  } finally {
    db?.close();
  }
}

export async function invalidateRelayDocumentSearchIndexDbFiles(
  targets: RelayDocumentSearchIndexDbFileInvalidationTarget[],
  options: RelayDocumentSearchIndexDbOptions = {},
): Promise<RelayDocumentSearchIndexDbFileInvalidationReport> {
  const initialized = await initializeRelayDocumentSearchIndexDb(options);
  const targetFileCount = targets.filter((target) => target.fileId || target.path).length;
  if (targetFileCount === 0) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: initialized.status,
      dbPath: initialized.dbPath,
      targetFileCount,
      matchedFileCount: 0,
      warnings: ['failed_file_retry_candidate_missing_file_identity'],
      errors: [],
    };
  }
  if (initialized.status !== 'ready') {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: initialized.status,
      dbPath: initialized.dbPath,
      targetFileCount,
      matchedFileCount: 0,
      warnings: initialized.warnings,
      errors: initialized.errors,
    };
  }
  const sqliteModule = options.sqliteModule ?? await loadSqliteModule();
  if (!sqliteModule) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: initialized.status,
      dbPath: initialized.dbPath,
      targetFileCount,
      matchedFileCount: 0,
      warnings: ['node_sqlite_unavailable'],
      errors: [],
    };
  }

  let db: RelayDocumentSearchSqliteDatabase | undefined;
  try {
    db = new sqliteModule.DatabaseSync(initialized.dbPath as string);
    const predicate = fileInvalidationPredicateSql(targets);
    if (!predicate) {
      return {
        schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
        schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
        status: initialized.status,
        dbPath: initialized.dbPath,
        targetFileCount,
        matchedFileCount: 0,
        warnings: ['failed_file_retry_candidate_missing_file_identity'],
        errors: [],
      };
    }
    const fileIds = `SELECT file_id FROM file_metadata WHERE ${predicate}`;
    const matchedFileCount = countQuery(db, `SELECT COUNT(*) AS count FROM file_metadata WHERE ${predicate}`) ?? 0;
    db.exec(`
      DELETE FROM content_nodes_fts WHERE file_id IN (${fileIds});
      DELETE FROM table_cells_fts WHERE file_id IN (${fileIds});
      DELETE FROM preview_spans WHERE file_id IN (${fileIds});
      DELETE FROM parsed_documents WHERE file_id IN (${fileIds});
    `);
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: 'ready',
      dbPath: initialized.dbPath,
      targetFileCount,
      matchedFileCount,
      warnings: [],
      errors: [],
    };
  } catch (error) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      schemaRevision: RELAY_DOCUMENT_SEARCH_INDEX_DB_SCHEMA_REVISION,
      status: 'failed',
      dbPath: initialized.dbPath,
      targetFileCount,
      matchedFileCount: 0,
      warnings: [],
      errors: [errorMessage(error)],
    };
  } finally {
    db?.close();
  }
}

export async function writeRelayDocumentSearchIndexDbMetadata(
  files: RelayDocumentSearchCachedFileMetadata[],
  options: RelayDocumentSearchIndexDbOptions = {},
): Promise<RelayDocumentSearchIndexDbWriteReport> {
  const opened = await openReadyIndexDb(options);
  const { schema, db } = opened;
  if (!db || schema.status !== 'ready') {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      ...schemaMigrationFields(schema),
      status: schema.status,
      dbPath: schema.dbPath,
      fileMetadataRowCount: 0,
      ftsRowCount: 0,
      previewSpanRowCount: 0,
      warnings: schema.warnings,
      errors: schema.errors,
    };
  }

  try {
    const prepare = requirePrepare(db);
    const updatedAt = (options.now ?? new Date()).toISOString();
    const upsert = prepare(`
      INSERT INTO file_metadata (
        file_id,
        root_id,
        path,
        display_name,
        extension,
        size_bytes,
        modified_at,
        source_metadata_version,
        content_state,
        access_state,
        updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET
        path = excluded.path,
        display_name = excluded.display_name,
        extension = excluded.extension,
        size_bytes = excluded.size_bytes,
        modified_at = excluded.modified_at,
        source_metadata_version = excluded.source_metadata_version,
        content_state = excluded.content_state,
        access_state = excluded.access_state,
        updated_at = excluded.updated_at
    `);
    for (const file of files) {
      upsert.run(
        file.fileId,
        resolve(file.path),
        file.name,
        file.extension,
        file.size,
        file.modifiedTime,
        file.sourceMetadataVersion,
        'metadata_ready',
        file.accessSnapshots?.metadata?.state ?? 'unknown',
        updatedAt,
      );
    }
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      ...schemaMigrationFields(schema),
      status: 'ready',
      dbPath: schema.dbPath,
      fileMetadataRowCount: files.length,
      ftsRowCount: 0,
      previewSpanRowCount: 0,
      warnings: [],
      errors: [],
    };
  } catch (error) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      ...schemaMigrationFields(schema),
      status: 'failed',
      dbPath: schema.dbPath,
      fileMetadataRowCount: 0,
      ftsRowCount: 0,
      previewSpanRowCount: 0,
      warnings: [],
      errors: [errorMessage(error)],
    };
  } finally {
    db.close();
  }
}

export async function writeRelayDocumentSearchIndexDbDerivedSearchStore(
  searchStore: RelayDocumentSearchDerivedSearchStoreV1,
  options: RelayDocumentSearchIndexDbOptions = {},
): Promise<RelayDocumentSearchIndexDbWriteReport> {
  const opened = await openReadyIndexDb(options);
  const { schema, db } = opened;
  if (!db || schema.status !== 'ready') {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      ...schemaMigrationFields(schema),
      status: schema.status,
      dbPath: schema.dbPath,
      fileMetadataRowCount: 0,
      ftsRowCount: 0,
      previewSpanRowCount: 0,
      warnings: schema.warnings,
      errors: schema.errors,
    };
  }

  try {
    const prepare = requirePrepare(db);
    const generatedAt = (options.now ?? new Date()).toISOString();
    db.exec('BEGIN IMMEDIATE;');
    prepare('DELETE FROM content_nodes_fts WHERE file_id = ?').run(searchStore.source_file_id);
    prepare('DELETE FROM table_cells_fts WHERE file_id = ?').run(searchStore.source_file_id);
    prepare('DELETE FROM preview_spans WHERE file_id = ?').run(searchStore.source_file_id);
    const insertText = prepare(`
      INSERT INTO content_nodes_fts (file_id, node_id, text, headings)
      VALUES (?, ?, ?, ?)
    `);
    const insertTable = prepare(`
      INSERT INTO table_cells_fts (file_id, table_id, cell_ref, text)
      VALUES (?, ?, ?, ?)
    `);
    const insertPreview = prepare(`
      INSERT INTO preview_spans (
        file_id,
        span_id,
        entry_id,
        entry_kind,
        start_offset,
        end_offset,
        preview_text,
        title,
        location_label,
        source_metadata_version,
        parsed_document_uid,
        parser_version,
        anchor_json,
        generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let ftsRowCount = 0;
    for (const row of searchStore.rows) {
      if (row.entry_kind === 'table_cell') {
        insertTable.run(searchStore.source_file_id, row.entry_id, row.preview.locationLabel, row.normalized_text);
      } else {
        insertText.run(searchStore.source_file_id, row.entry_id, row.normalized_text, row.preview.title);
      }
      insertPreview.run(
        searchStore.source_file_id,
        row.row_id,
        row.entry_id,
        row.entry_kind,
        0,
        row.preview.snippet.length,
        row.preview.snippet,
        row.preview.title,
        row.preview.locationLabel,
        row.preview.sourceMetadataVersion,
        row.preview.parsedDocumentUid,
        row.preview.parserVersion,
        JSON.stringify(row.anchor),
        generatedAt,
      );
      ftsRowCount += 1;
    }
    db.exec('COMMIT;');
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      ...schemaMigrationFields(schema),
      status: 'ready',
      dbPath: schema.dbPath,
      fileMetadataRowCount: 0,
      ftsRowCount,
      previewSpanRowCount: searchStore.rows.length,
      warnings: [],
      errors: [],
    };
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // If SQLite never entered a transaction or already rolled back, keep the
      // original write error as the actionable failure.
    }
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      ...schemaMigrationFields(schema),
      status: 'failed',
      dbPath: schema.dbPath,
      fileMetadataRowCount: 0,
      ftsRowCount: 0,
      previewSpanRowCount: 0,
      warnings: [],
      errors: [errorMessage(error)],
    };
  } finally {
    db.close();
  }
}

function ftsQuery(terms: string[]): string {
  return terms
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' OR ');
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function rootFilterSql(
  alias: string,
  fileIdExpression: string,
  roots: string[] | undefined,
): { joinSql: string; whereSql: string; params: string[] } {
  const normalizedRoots = [...new Set((roots ?? []).map((root) => resolve(root)).filter(Boolean))];
  if (!normalizedRoots.length) return { joinSql: '', whereSql: '', params: [] };
  const clauses: string[] = [];
  const params: string[] = [];
  for (const root of normalizedRoots) {
    const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
    clauses.push(`(${alias}.path = ? OR ${alias}.path LIKE ? ESCAPE '\\')`);
    params.push(root, `${escapeLikePattern(rootPrefix)}%`);
  }
  return {
    joinSql: `JOIN file_metadata ${alias} ON ${alias}.file_id = ${fileIdExpression}`,
    whereSql: `AND (${clauses.join(' OR ')})`,
    params,
  };
}

function boundedSearchMaxRows(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? 20, 100));
}

function parseSearchRows(rows: unknown[], kind: 'text' | 'table_cell'): RelayDocumentSearchIndexDbSearchRow[] {
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      const parsed: RelayDocumentSearchIndexDbSearchRow = {
        file_id: String(row.file_id ?? ''),
        entry_id: String(row.entry_id ?? ''),
        entry_kind: kind,
        text: String(row.text ?? ''),
      };
      if (typeof row.rank === 'number' && Number.isFinite(row.rank)) parsed.rank = row.rank;
      if (typeof row.bm25_score === 'number' && Number.isFinite(row.bm25_score)) parsed.bm25_score = row.bm25_score;
      if (typeof row.fts_snippet === 'string') parsed.fts_snippet = row.fts_snippet;
      if (typeof row.span_id === 'string') parsed.span_id = row.span_id;
      if (typeof row.preview_text === 'string') parsed.preview_text = row.preview_text;
      if (typeof row.title === 'string') parsed.title = row.title;
      if (typeof row.location_label === 'string') parsed.location_label = row.location_label;
      if (typeof row.source_metadata_version === 'string') parsed.source_metadata_version = row.source_metadata_version;
      if (typeof row.parsed_document_uid === 'string') parsed.parsed_document_uid = row.parsed_document_uid;
      if (typeof row.parser_version === 'string') parsed.parser_version = row.parser_version;
      const anchor = parseAnchorJson(row.anchor_json);
      if (anchor) parsed.anchor = anchor;
      return parsed;
    })
    .filter((row) => row.file_id && row.entry_id);
}

function parseAnchorJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  return undefined;
}

export async function searchRelayDocumentSearchIndexDbFts(
  terms: string[],
  options: RelayDocumentSearchIndexDbOptions & { maxRows?: number; roots?: string[] } = {},
): Promise<RelayDocumentSearchIndexDbSearchResult> {
  const query = ftsQuery(terms);
  const maxRows = boundedSearchMaxRows(options.maxRows);
  const opened = await openReadyIndexDb(options);
  const { schema, db } = opened;
  if (!db || schema.status !== 'ready') {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      ...schemaMigrationFields(schema),
      status: schema.status,
      dbPath: schema.dbPath,
      query,
      maxRows,
      rawRowCount: 0,
      textRawRowCount: 0,
      tableCellRawRowCount: 0,
      droppedRowCount: 0,
      truncated: false,
      rows: [],
      warnings: schema.warnings,
      errors: schema.errors,
    };
  }

  try {
    if (!query) {
      return {
        schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
        ...schemaMigrationFields(schema),
        status: 'ready',
        dbPath: schema.dbPath,
        query,
        maxRows,
        rawRowCount: 0,
        textRawRowCount: 0,
        tableCellRawRowCount: 0,
        droppedRowCount: 0,
        truncated: false,
        rows: [],
        warnings: ['empty_fts_query'],
        errors: [],
      };
    }
    const prepare = requirePrepare(db);
    const contentRootFilter = rootFilterSql('content_file_metadata', 'content_nodes_fts.file_id', options.roots);
    const tableRootFilter = rootFilterSql('table_file_metadata', 'table_cells_fts.file_id', options.roots);
    const textRows = prepare(`
      SELECT
        content_nodes_fts.file_id,
        content_nodes_fts.node_id AS entry_id,
        content_nodes_fts.text,
        bm25(content_nodes_fts) AS bm25_score,
        snippet(content_nodes_fts, 2, '[[HL]]', '[[/HL]]', '...', 48) AS fts_snippet,
        preview_spans.span_id,
        preview_spans.preview_text,
        preview_spans.title,
        preview_spans.location_label,
        preview_spans.source_metadata_version,
        preview_spans.parsed_document_uid,
        preview_spans.parser_version,
        preview_spans.anchor_json
      FROM content_nodes_fts
      ${contentRootFilter.joinSql}
      LEFT JOIN preview_spans
        ON preview_spans.file_id = content_nodes_fts.file_id
        AND preview_spans.entry_id = content_nodes_fts.node_id
      WHERE content_nodes_fts MATCH ?
      ${contentRootFilter.whereSql}
      ORDER BY bm25_score ASC, content_nodes_fts.file_id ASC, content_nodes_fts.node_id ASC
      LIMIT ?
    `).all?.(query, ...contentRootFilter.params, maxRows) ?? [];
    const tableRows = prepare(`
      SELECT
        table_cells_fts.file_id,
        table_cells_fts.table_id AS entry_id,
        table_cells_fts.text,
        bm25(table_cells_fts) AS bm25_score,
        snippet(table_cells_fts, 3, '[[HL]]', '[[/HL]]', '...', 48) AS fts_snippet,
        preview_spans.span_id,
        preview_spans.preview_text,
        preview_spans.title,
        preview_spans.location_label,
        preview_spans.source_metadata_version,
        preview_spans.parsed_document_uid,
        preview_spans.parser_version,
        preview_spans.anchor_json
      FROM table_cells_fts
      ${tableRootFilter.joinSql}
      LEFT JOIN preview_spans
        ON preview_spans.file_id = table_cells_fts.file_id
        AND preview_spans.entry_id = table_cells_fts.table_id
      WHERE table_cells_fts MATCH ?
      ${tableRootFilter.whereSql}
      ORDER BY bm25_score ASC, table_cells_fts.file_id ASC, table_cells_fts.table_id ASC
      LIMIT ?
    `).all?.(query, ...tableRootFilter.params, maxRows) ?? [];
    const rows = [
      ...parseSearchRows(textRows, 'text'),
      ...parseSearchRows(tableRows, 'table_cell'),
    ];
    const returnedRows = rows.slice(0, maxRows);
    const droppedRowCount = Math.max(0, rows.length - returnedRows.length);
    const truncated = droppedRowCount > 0 ||
      textRows.length >= maxRows ||
      tableRows.length >= maxRows;
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      ...schemaMigrationFields(schema),
      status: 'ready',
      dbPath: schema.dbPath,
      query,
      maxRows,
      rawRowCount: rows.length,
      textRawRowCount: textRows.length,
      tableCellRawRowCount: tableRows.length,
      droppedRowCount,
      truncated,
      rows: returnedRows,
      warnings: truncated ? ['fts_result_limit_reached'] : [],
      errors: [],
    };
  } catch (error) {
    return {
      schemaVersion: RELAY_DOCUMENT_SEARCH_INDEX_DB_CONTRACT,
      ...schemaMigrationFields(schema),
      status: 'failed',
      dbPath: schema.dbPath,
      query,
      maxRows,
      rawRowCount: 0,
      textRawRowCount: 0,
      tableCellRawRowCount: 0,
      droppedRowCount: 0,
      truncated: false,
      rows: [],
      warnings: [],
      errors: [errorMessage(error)],
    };
  } finally {
    db.close();
  }
}
