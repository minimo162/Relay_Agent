import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadataCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMetadataCache.ts",
);
const filenameIndexPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFilenameIndex.ts",
);
const queryPlanPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryPlan.ts",
);
const contractPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchContract.ts",
);
const evidencePackPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchEvidencePack.ts",
);
const jobStorePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchJobStore.ts",
);
const userMemoryPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchUserMemory.ts",
);
const parsedDocumentIrPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayParsedDocumentIr.ts",
);
const parsedDocumentCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayParsedDocumentCache.ts",
);
const derivedContentIndexPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchDerivedContentIndex.ts",
);
const cacheActionsPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchCacheActions.ts",
);
const indexDbPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexDb.ts",
);
const indexCoordinatorPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexCoordinator.ts",
);
const backgroundSchedulerPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchBackgroundScheduler.ts",
);
const failureRegistryPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFailureRegistry.ts",
);
const indexMaintenancePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexMaintenance.ts",
);

function transpile(path) {
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  assert.deepEqual(
    (compiled.diagnostics ?? []).map((diagnostic) => diagnostic.messageText),
    [],
  );
  return compiled.outputText;
}

async function loadIndexMaintenanceModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchMetadataCache.mjs"), transpile(metadataCachePath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchQueryPlan.mjs"), transpile(queryPlanPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchFilenameIndex.mjs"),
    transpile(filenameIndexPath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchJobStore.mjs"), transpile(jobStorePath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchUserMemory.mjs"),
    transpile(userMemoryPath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayParsedDocumentIr.mjs"),
    transpile(parsedDocumentIrPath).replace(
      "from './relayDocumentSearchMetadataCache';",
      "from './relayDocumentSearchMetadataCache.mjs';",
    ),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayParsedDocumentCache.mjs"),
    transpile(parsedDocumentCachePath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayParsedDocumentIr';", "from './relayParsedDocumentIr.mjs';"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchDerivedContentIndex.mjs"),
    transpile(derivedContentIndexPath)
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';")
      .replace("from './relayParsedDocumentIr';", "from './relayParsedDocumentIr.mjs';"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchCacheActions.mjs"),
    transpile(cacheActionsPath)
      .replace("from './relayDocumentSearchFilenameIndex';", "from './relayDocumentSearchFilenameIndex.mjs';")
      .replace("from './relayDocumentSearchDerivedContentIndex';", "from './relayDocumentSearchDerivedContentIndex.mjs';")
      .replace("from './relayDocumentSearchJobStore';", "from './relayDocumentSearchJobStore.mjs';")
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchUserMemory';", "from './relayDocumentSearchUserMemory.mjs';")
      .replace("from './relayParsedDocumentCache';", "from './relayParsedDocumentCache.mjs';"),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchIndexDb.mjs"), transpile(indexDbPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchIndexCoordinator.mjs"), transpile(indexCoordinatorPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchBackgroundScheduler.mjs"), transpile(backgroundSchedulerPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchFailureRegistry.mjs"), transpile(failureRegistryPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchEvidencePack.mjs"),
    transpile(evidencePackPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchIndexMaintenance.mjs"),
    transpile(indexMaintenancePath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayParsedDocumentCache';", "from './relayParsedDocumentCache.mjs';")
      .replace("from './relayParsedDocumentIr';", "from './relayParsedDocumentIr.mjs';")
      .replace("from './relayDocumentSearchDerivedContentIndex';", "from './relayDocumentSearchDerivedContentIndex.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';")
      .replace("from './relayDocumentSearchEvidencePack';", "from './relayDocumentSearchEvidencePack.mjs';")
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchCacheActions';", "from './relayDocumentSearchCacheActions.mjs';")
      .replace("from './relayDocumentSearchIndexDb';", "from './relayDocumentSearchIndexDb.mjs';")
      .replace("from './relayDocumentSearchIndexCoordinator';", "from './relayDocumentSearchIndexCoordinator.mjs';")
      .replace("from './relayDocumentSearchFailureRegistry';", "from './relayDocumentSearchFailureRegistry.mjs';")
      .replace("from './relayDocumentSearchBackgroundScheduler';", "from './relayDocumentSearchBackgroundScheduler.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchIndexMaintenance.mjs")).href),
      schedulerModule: await import(pathToFileURL(resolve(dir, "relayDocumentSearchBackgroundScheduler.mjs")).href),
      failureRegistryModule: await import(pathToFileURL(resolve(dir, "relayDocumentSearchFailureRegistry.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function writeCacheFile(dir, file, content = "{}") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, file), content, "utf8");
}

function rootScopedCacheFileName(root) {
  return `${createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24)}.json`;
}

test("index maintenance integrity-check reports invalid JSON stores", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-"));
  const metadataCacheDir = resolve(root, "metadata-cache");
  writeCacheFile(metadataCacheDir, "ok.json", "{}");
  writeCacheFile(metadataCacheDir, "bad.json", "{");

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("integrity-check", {
      metadataCacheDir,
      filenameIndexDir: resolve(root, "filename-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.schemaVersion, "RelayDocumentSearchIndexMaintenance.v1");
    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.equal(result.indexDb.schemaVersion, "RelayDocumentSearchIndexDbHealth.v1");
    assert.equal(result.indexDb.backend, "json_stores");
    assert.equal(result.indexDb.sqliteFtsEnabled, false);
    assert.equal(result.indexDb.status, "not_enabled");
    assert.equal(result.indexDb.schemaRevision, 2);
    assert.equal(result.indexDb.requiredTables.includes("content_nodes_fts"), true);
    assert.equal(result.indexDb.requiredTables.includes("index_schema_migrations"), true);
    assert.equal(result.indexDb.contentBearingTables.includes("preview_spans"), true);
    assert.equal(result.indexDb.initializedTables.length, 0);
    assert.deepEqual(result.indexDb.missingTables, []);
    assert.equal(result.indexDb.requiredMigrations.includes("20260510_preview_spans_anchor_json"), true);
    assert.deepEqual(result.indexDb.pendingMigrations, []);
    assert.equal(result.indexDb.ftsReady, false);
    assert.equal(result.indexDb.wal.inspected, false);
    assert.equal(result.indexDb.migrationSafe, true);
    assert.equal(result.checks.find((check) => check.store === "metadataCache").checkedJsonFiles, 2);
    assert.equal(result.checks.find((check) => check.store === "metadataCache").invalidJsonFiles, 1);
    assert.deepEqual(result.healthEvents.map((event) => event.kind), ["maintenance_failed"]);
    assert.equal(result.healthEvents[0].details.action, "integrity-check");
    assert.equal(result.healthEvents[0].details.invalidJsonFileCount, 1);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance rebuild-derived-indexes clears only rebuildable stores", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-repair-"));
  const metadataCacheDir = resolve(root, "metadata-cache");
  const filenameIndexDir = resolve(root, "filename-index");
  const derivedContentIndexDir = resolve(root, "derived-content-index");
  const parsedDocumentCacheDir = resolve(root, "parsed-document-cache");
  writeCacheFile(metadataCacheDir, "metadata.json");
  writeCacheFile(filenameIndexDir, "index.json");
  writeCacheFile(derivedContentIndexDir, "derived.json");
  writeCacheFile(parsedDocumentCacheDir, "parsed.json");

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("rebuild-derived-indexes", {
      metadataCacheDir,
      filenameIndexDir,
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "repaired");
    assert.ok(result.warnings.includes("derived_indexes_will_rebuild_on_next_search"));
    assert.equal(result.cacheAction.cancelled, false);
    assert.deepEqual(result.cacheAction.removedStores.sort(), ["derivedContentIndex", "filenameIndex", "parsedDocumentCache"]);
    assert.deepEqual(result.healthEvents.map((event) => event.kind), ["maintenance_completed"]);
    assert.equal(result.healthEvents[0].details.action, "rebuild-derived-indexes");
    assert.equal(result.healthEvents[0].details.status, "repaired");
    assert.deepEqual(result.healthEvents[0].details.storeNames, [
      "metadataCache",
      "filenameIndex",
      "derivedContentIndex",
      "parsedDocumentCache",
      "jobStore",
      "userMemory",
    ]);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance marks DB-only actions not applicable before an index DB exists", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-db-"));
  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("wal-checkpoint", {
      metadataCacheDir: resolve(root, "metadata-cache"),
      filenameIndexDir: resolve(root, "filename-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "not_applicable");
    assert.deepEqual(result.warnings, ["index_db_not_enabled"]);
    assert.equal(result.indexDb.sqliteFtsRequested, false);
    assert.equal(result.indexDb.sqliteFtsEnabled, false);
    assert.deepEqual(
      result.indexDb.dbOnlyActions,
      ["wal-checkpoint", "compact"],
    );
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance reports schema migration gates and read-only downgrades", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-schema-gate-"));
  const workspace = resolve(root, "workspace");
  const metadataCacheDir = resolve(root, "metadata-cache");
  const metadataFile = rootScopedCacheFileName(workspace);
  writeCacheFile(metadataCacheDir, metadataFile, JSON.stringify({
    schemaVersion: "RelayDocumentSearchMetadataCache.v1",
    cacheVersion: 99,
    root: workspace,
    generatedAt: "2026-05-10T00:00:00.000Z",
    files: [],
    stats: { fileCount: 0, truncated: false, inaccessiblePathCount: 0 },
  }));
  const sqlStatements = [];
  class FakeDatabaseSync {
    exec(sql) {
      sqlStatements.push(sql);
    }

    prepare(sql) {
      return {
        all() {
          if (/PRAGMA user_version/.test(sql)) return [{ user_version: 99 }];
          return [];
        },
        run() {},
      };
    }

    close() {}
  }

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("integrity-check", {
      root: workspace,
      metadataCacheDir,
      filenameIndexDir: resolve(root, "filename-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      derivedContentIndexDir: resolve(root, "derived-content-index"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexDbPath: resolve(root, "document-search.sqlite"),
      enableIndexDb: true,
      sqliteModule: { DatabaseSync: FakeDatabaseSync },
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.indexDb.status, "read_only");
    assert.equal(result.indexDb.readOnly, true);
    assert.equal(result.indexDb.detectedSchemaRevision, 99);
    assert.equal(result.indexDb.schemaGate.schemaVersion, "RelayDocumentSearchSchemaMigrationGate.v1");
    assert.equal(result.indexDb.schemaGate.status, "read_only");
    assert.equal(result.indexDb.schemaGate.readOnlyComponentCount, 2);
    assert.equal(result.indexDb.schemaGate.userStatePreserved, true);
    assert.equal(
      result.indexDb.schemaGate.components.some((component) =>
        component.name === "metadata_cache" &&
          component.status === "read_only_downgrade" &&
          component.detectedVersion === 99
      ),
      true,
    );
    assert.equal(
      result.indexDb.schemaGate.components.some((component) =>
        component.name === "sqlite_fts" &&
          component.status === "read_only_downgrade" &&
          component.detectedVersion === 99
      ),
      true,
    );
    assert.equal(sqlStatements.some((sql) => /CREATE TABLE/.test(sql)), false);
    assert.equal(result.healthEvents[0].details.schemaGateStatus, "read_only");
    assert.equal(result.healthEvents[0].details.schemaGateReadOnlyComponentCount, 2);
    assert.equal(result.healthEvents[0].details.userStatePreserved, true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance rebuild-previews clears only preview-bearing derived content caches", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-previews-"));
  const metadataCacheDir = resolve(root, "metadata-cache");
  const filenameIndexDir = resolve(root, "filename-index");
  const derivedContentIndexDir = resolve(root, "derived-content-index");
  const parsedDocumentCacheDir = resolve(root, "parsed-document-cache");
  writeCacheFile(metadataCacheDir, "metadata.json");
  writeCacheFile(filenameIndexDir, "index.json");
  writeCacheFile(derivedContentIndexDir, "derived.json");
  writeCacheFile(parsedDocumentCacheDir, "parsed.json");

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("rebuild-previews", {
      metadataCacheDir,
      filenameIndexDir,
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "repaired");
    assert.equal(result.cacheAction.action, "clear-derived-content-index");
    assert.deepEqual(result.cacheAction.removedStores, ["derivedContentIndex"]);
    assert.ok(result.warnings.includes("preview_indexes_will_rebuild_on_next_search"));
    assert.equal(result.cacheAction.after.find((store) => store.name === "derivedContentIndex").exists, false);
    assert.equal(result.cacheAction.after.find((store) => store.name === "filenameIndex").exists, true);
    assert.equal(result.cacheAction.after.find((store) => store.name === "parsedDocumentCache").exists, true);
    assert.deepEqual(result.healthEvents.map((event) => event.kind), ["maintenance_completed"]);
    assert.equal(result.healthEvents[0].details.action, "rebuild-previews");
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance full-rescan clears metadata and rebuildable indexes while preserving user state", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-full-rescan-"));
  const metadataCacheDir = resolve(root, "metadata-cache");
  const filenameIndexDir = resolve(root, "filename-index");
  const derivedContentIndexDir = resolve(root, "derived-content-index");
  const parsedDocumentCacheDir = resolve(root, "parsed-document-cache");
  const jobStoreDir = resolve(root, "jobs");
  const userMemoryDir = resolve(root, "user-memory");
  writeCacheFile(metadataCacheDir, "metadata.json");
  writeCacheFile(filenameIndexDir, "index.json");
  writeCacheFile(derivedContentIndexDir, "derived.json");
  writeCacheFile(parsedDocumentCacheDir, "parsed.json");
  writeCacheFile(jobStoreDir, "job.json");
  writeCacheFile(userMemoryDir, "user-memory.json");

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("full-rescan", {
      metadataCacheDir,
      filenameIndexDir,
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir,
      userMemoryDir,
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "repaired");
    assert.equal(result.cacheAction.action, "clear-rescan-caches");
    assert.deepEqual(result.cacheAction.removedStores.sort(), [
      "derivedContentIndex",
      "filenameIndex",
      "metadataCache",
      "parsedDocumentCache",
    ]);
    assert.ok(result.warnings.includes("workspace_metadata_and_indexes_will_rebuild_on_next_search"));
    assert.equal(result.cacheAction.after.find((store) => store.name === "metadataCache").exists, false);
    assert.equal(result.cacheAction.after.find((store) => store.name === "derivedContentIndex").exists, false);
    assert.equal(result.cacheAction.after.find((store) => store.name === "jobStore").exists, true);
    assert.equal(result.cacheAction.after.find((store) => store.name === "userMemory").exists, true);
    assert.deepEqual(result.healthEvents.map((event) => event.kind), ["maintenance_completed"]);
    assert.equal(result.healthEvents[0].details.action, "full-rescan");
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance rebuild-root clears one root cache and optional SQLite rows", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-root-"));
  const workspaceA = resolve(root, "workspace-a");
  const workspaceB = resolve(root, "workspace-b");
  const metadataCacheDir = resolve(root, "metadata-cache");
  const filenameIndexDir = resolve(root, "filename-index");
  const workspaceAFile = rootScopedCacheFileName(workspaceA);
  const workspaceBFile = rootScopedCacheFileName(workspaceB);
  writeCacheFile(metadataCacheDir, workspaceAFile);
  writeCacheFile(metadataCacheDir, `${workspaceAFile}.lock`);
  writeCacheFile(metadataCacheDir, workspaceBFile);
  writeCacheFile(filenameIndexDir, workspaceAFile);
  writeCacheFile(filenameIndexDir, workspaceBFile);
  writeCacheFile(resolve(root, "jobs"), "job.json");
  writeCacheFile(resolve(root, "user-memory"), "user-memory.json");

  const sqlStatements = [];
  const migrationColumns = [
    "entry_id",
    "entry_kind",
    "title",
    "location_label",
    "source_metadata_version",
    "parsed_document_uid",
    "parser_version",
    "anchor_json",
  ];
  class FakeDatabaseSync {
    exec(sql) {
      sqlStatements.push(sql);
    }

    prepare(sql) {
      return {
        all() {
          if (/PRAGMA table_info\(preview_spans\)/.test(sql)) {
            return migrationColumns.map((name) => ({ name }));
          }
          if (/COUNT\(\*\) AS count FROM file_metadata/.test(sql)) return [{ count: 4 }];
          if (/COUNT\(\*\) AS count FROM parsed_documents/.test(sql)) return [{ count: 0 }];
          return [];
        },
        run() {},
      };
    }

    close() {}
  }

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("rebuild-root", {
      root: workspaceA,
      metadataCacheDir,
      filenameIndexDir,
      derivedContentIndexDir: resolve(root, "derived-content-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexDbPath: resolve(root, "document-search.sqlite"),
      enableIndexDb: true,
      sqliteModule: { DatabaseSync: FakeDatabaseSync },
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "repaired");
    assert.equal(result.cacheAction.action, "clear-root-caches");
    assert.deepEqual(result.cacheAction.removedStores.sort(), ["filenameIndex", "metadataCache"]);
    assert.equal(result.indexDbRootInvalidation.rootRequested, true);
    assert.equal(result.indexDbRootInvalidation.rootMetadataRowCount, 4);
    assert.ok(result.warnings.includes("root_metadata_and_indexes_will_rebuild_on_next_search"));
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceAFile)), false);
    assert.equal(existsSync(resolve(metadataCacheDir, `${workspaceAFile}.lock`)), false);
    assert.equal(existsSync(resolve(filenameIndexDir, workspaceAFile)), false);
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceBFile)), true);
    assert.equal(existsSync(resolve(filenameIndexDir, workspaceBFile)), true);
    assert.ok(sqlStatements.some((sql) => /DELETE FROM file_metadata/.test(sql) && sql.includes("workspace-a")));
    assert.deepEqual(result.healthEvents.map((event) => event.kind), ["maintenance_completed"]);
    assert.equal(result.healthEvents[0].details.action, "rebuild-root");
    assert.equal(result.healthEvents[0].details.indexDbRootInvalidatedFileCount, 4);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance remove-root deletes selected root caches and SQLite rows after confirmation", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-remove-root-"));
  const workspaceA = resolve(root, "workspace-a");
  const workspaceB = resolve(root, "workspace-b");
  const metadataCacheDir = resolve(root, "metadata-cache");
  const filenameIndexDir = resolve(root, "filename-index");
  const parsedDocumentCacheDir = resolve(root, "parsed-document-cache");
  const derivedContentIndexDir = resolve(root, "derived-content-index");
  const workspaceAFile = rootScopedCacheFileName(workspaceA);
  const workspaceBFile = rootScopedCacheFileName(workspaceB);
  writeCacheFile(metadataCacheDir, workspaceAFile);
  writeCacheFile(metadataCacheDir, `${workspaceAFile}.lock`);
  writeCacheFile(metadataCacheDir, workspaceBFile);
  writeCacheFile(filenameIndexDir, workspaceAFile);
  writeCacheFile(filenameIndexDir, workspaceBFile);
  writeCacheFile(resolve(parsedDocumentCacheDir, "aa"), "a.json", JSON.stringify({
    schemaVersion: "RelayParsedDocumentCache.v1",
    root: workspaceA,
    fileId: "file-a",
    sourcePath: resolve(workspaceA, "a.xlsx"),
  }));
  writeCacheFile(resolve(parsedDocumentCacheDir, "bb"), "b.json", JSON.stringify({
    schemaVersion: "RelayParsedDocumentCache.v1",
    root: workspaceB,
    fileId: "file-b",
    sourcePath: resolve(workspaceB, "b.xlsx"),
  }));
  writeCacheFile(resolve(derivedContentIndexDir, "aa"), "a.json", JSON.stringify({
    schemaVersion: "RelayDocumentSearchDerivedContentIndexCache.v1",
    sourceFileId: "file-a",
    sourcePath: resolve(workspaceA, "a.xlsx"),
  }));
  writeCacheFile(resolve(derivedContentIndexDir, "bb"), "b.json", JSON.stringify({
    schemaVersion: "RelayDocumentSearchDerivedContentIndexCache.v1",
    sourceFileId: "file-b",
    sourcePath: resolve(workspaceB, "b.xlsx"),
  }));
  writeCacheFile(resolve(root, "jobs"), "job.json");
  writeCacheFile(resolve(root, "user-memory"), "user-memory.json");

  const sqlStatements = [];
  const migrationColumns = [
    "entry_id",
    "entry_kind",
    "title",
    "location_label",
    "source_metadata_version",
    "parsed_document_uid",
    "parser_version",
    "anchor_json",
  ];
  class FakeDatabaseSync {
    exec(sql) {
      sqlStatements.push(sql);
    }

    prepare(sql) {
      return {
        all() {
          if (/PRAGMA table_info\(preview_spans\)/.test(sql)) {
            return migrationColumns.map((name) => ({ name }));
          }
          if (/COUNT\(\*\) AS count FROM file_metadata/.test(sql)) return [{ count: 3 }];
          if (/COUNT\(\*\) AS count FROM parsed_documents/.test(sql)) return [{ count: 0 }];
          return [];
        },
        run() {},
      };
    }

    close() {}
  }

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("remove-root", {
      root: workspaceA,
      metadataCacheDir,
      filenameIndexDir,
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexDbPath: resolve(root, "document-search.sqlite"),
      enableIndexDb: true,
      sqliteModule: { DatabaseSync: FakeDatabaseSync },
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      confirmRootRemoval: true,
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "repaired");
    assert.equal(result.cacheAction.action, "remove-root-caches");
    assert.deepEqual(result.cacheAction.removedStores.sort(), [
      "derivedContentIndex",
      "filenameIndex",
      "metadataCache",
      "parsedDocumentCache",
    ]);
    assert.equal(result.cacheAction.removedPathCounts.parsedDocumentCache, 1);
    assert.equal(result.cacheAction.removedPathCounts.derivedContentIndex, 1);
    assert.equal(result.indexDbRootInvalidation.rootRequested, true);
    assert.equal(result.indexDbRootInvalidation.rootMetadataRowCount, 3);
    assert.ok(result.warnings.includes("root_removed_from_document_search_caches"));
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceAFile)), false);
    assert.equal(existsSync(resolve(filenameIndexDir, workspaceAFile)), false);
    assert.equal(existsSync(resolve(parsedDocumentCacheDir, "aa", "a.json")), false);
    assert.equal(existsSync(resolve(derivedContentIndexDir, "aa", "a.json")), false);
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceBFile)), true);
    assert.equal(existsSync(resolve(filenameIndexDir, workspaceBFile)), true);
    assert.equal(existsSync(resolve(parsedDocumentCacheDir, "bb", "b.json")), true);
    assert.equal(existsSync(resolve(derivedContentIndexDir, "bb", "b.json")), true);
    assert.ok(sqlStatements.some((sql) => /DELETE FROM preview_spans/.test(sql) && sql.includes("workspace-a")));
    assert.deepEqual(result.healthEvents.map((event) => event.kind), ["maintenance_completed"]);
    assert.equal(result.healthEvents[0].details.action, "remove-root");
    assert.equal(result.healthEvents[0].details.indexDbRootInvalidatedFileCount, 3);
    assert.equal(result.healthEvents[0].details.rootRemovalParsedCacheRemovedPathCount, 1);
    assert.equal(result.healthEvents[0].details.rootRemovalDerivedCacheRemovedPathCount, 1);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance remove-root requires explicit confirmation before deletion", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-remove-root-confirm-"));
  const workspaceA = resolve(root, "workspace-a");
  const metadataCacheDir = resolve(root, "metadata-cache");
  const workspaceAFile = rootScopedCacheFileName(workspaceA);
  writeCacheFile(metadataCacheDir, workspaceAFile);

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("remove-root", {
      root: workspaceA,
      metadataCacheDir,
      filenameIndexDir: resolve(root, "filename-index"),
      derivedContentIndexDir: resolve(root, "derived-content-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.equal(result.cacheAction.action, "remove-root-caches");
    assert.deepEqual(result.cacheAction.removedStores, []);
    assert.ok(result.errors.includes("root_removal_confirmation_required"));
    assert.equal(result.indexDbRootInvalidation, undefined);
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceAFile)), true);
    assert.deepEqual(result.healthEvents.map((event) => event.kind), ["maintenance_failed"]);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance retry-failed-files queues failed root state for retry", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-retry-failed-"));
  const workspaceA = resolve(root, "workspace-a");
  const workspaceB = resolve(root, "workspace-b");
  const metadataCacheDir = resolve(root, "metadata-cache");
  const filenameIndexDir = resolve(root, "filename-index");
  const parsedDocumentCacheDir = resolve(root, "parsed-document-cache");
  const derivedContentIndexDir = resolve(root, "derived-content-index");
  const failureRegistryDir = resolve(root, "failure-registry");
  const failedFileId = "failed-file-a";
  const failedFilePath = resolve(workspaceA, "failed.docx");
  const workspaceAFile = rootScopedCacheFileName(workspaceA);
  const workspaceBFile = rootScopedCacheFileName(workspaceB);
  writeCacheFile(metadataCacheDir, workspaceAFile);
  writeCacheFile(metadataCacheDir, workspaceBFile);
  writeCacheFile(filenameIndexDir, workspaceAFile);
  writeCacheFile(filenameIndexDir, workspaceBFile);
  writeCacheFile(resolve(parsedDocumentCacheDir, "aa"), "failed.json", JSON.stringify({
    schemaVersion: "RelayParsedDocumentCache.v1",
    root: workspaceA,
    fileId: failedFileId,
    sourcePath: failedFilePath,
  }));
  writeCacheFile(resolve(parsedDocumentCacheDir, "bb"), "other.json", JSON.stringify({
    schemaVersion: "RelayParsedDocumentCache.v1",
    root: workspaceB,
    fileId: "other-file-b",
    sourcePath: resolve(workspaceB, "other.pdf"),
  }));
  writeCacheFile(resolve(derivedContentIndexDir, "aa"), "failed.json", JSON.stringify({
    schemaVersion: "RelayDocumentSearchDerivedContentIndexCache.v1",
    sourceFileId: failedFileId,
    sourcePath: failedFilePath,
  }));
  writeCacheFile(resolve(derivedContentIndexDir, "bb"), "other.json", JSON.stringify({
    schemaVersion: "RelayDocumentSearchDerivedContentIndexCache.v1",
    sourceFileId: "other-file-b",
    sourcePath: resolve(workspaceB, "other.pdf"),
  }));

  const { module, failureRegistryModule, cleanup } = await loadIndexMaintenanceModule();
  try {
    await failureRegistryModule.recordRelayDocumentSearchFailure(
      {
        root: workspaceA,
        path: failedFilePath,
        fileId: failedFileId,
        kind: "parser",
        code: "docx_parse_failed",
        source: "parsed-document-cache",
      },
      {
        failureRegistryDir,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );
    await failureRegistryModule.recordRelayDocumentSearchFailure(
      {
        root: workspaceB,
        path: resolve(workspaceB, "other.pdf"),
        kind: "content",
        code: "pdf_extract_failed",
        source: "parsed-document-cache",
      },
      {
        failureRegistryDir,
        now: new Date("2026-05-10T00:01:00.000Z"),
      },
    );

    const result = await module.runRelayDocumentSearchIndexMaintenance("retry-failed-files", {
      root: workspaceA,
      metadataCacheDir,
      filenameIndexDir,
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      failureRegistryDir,
      failedFileRetryLimit: 1,
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:02:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "repaired");
    assert.equal(result.cacheAction, undefined);
    assert.equal(result.failureRetryPlan.failedFileCount, 1);
    assert.equal(result.failureRetryPlan.selectedFailureCount, 1);
    assert.equal(result.failureRetryPlan.selectedFailures[0].root, workspaceA);
    assert.equal(result.failureRetryExecution.invalidatedParsedDocumentCacheCount, 1);
    assert.equal(result.failureRetryExecution.invalidatedDerivedContentIndexCount, 1);
    assert.ok(result.warnings.includes("failed_files_will_retry_on_next_search"));
    assert.ok(result.warnings.includes("failed_file_retry_plan_recorded"));
    assert.ok(result.warnings.includes("failed_file_retry_uses_per_file_invalidation"));
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceAFile)), true);
    assert.equal(existsSync(resolve(filenameIndexDir, workspaceAFile)), true);
    assert.equal(existsSync(resolve(metadataCacheDir, workspaceBFile)), true);
    assert.equal(existsSync(resolve(filenameIndexDir, workspaceBFile)), true);
    assert.equal(existsSync(resolve(parsedDocumentCacheDir, "aa", "failed.json")), false);
    assert.equal(existsSync(resolve(derivedContentIndexDir, "aa", "failed.json")), false);
    assert.equal(existsSync(resolve(parsedDocumentCacheDir, "bb", "other.json")), true);
    assert.equal(existsSync(resolve(derivedContentIndexDir, "bb", "other.json")), true);
    assert.deepEqual(result.healthEvents.map((event) => event.kind), ["maintenance_completed"]);
    assert.equal(result.healthEvents[0].details.action, "retry-failed-files");
    assert.equal(result.healthEvents[0].details.failedFileRetryCandidateCount, 1);
    assert.equal(result.healthEvents[0].details.failedFileRetrySelectedCount, 1);
    assert.equal(result.healthEvents[0].details.failedFileRetryParsedCacheInvalidatedCount, 1);
    assert.equal(result.healthEvents[0].details.failedFileRetryDerivedCacheInvalidatedCount, 1);
    const registry = await failureRegistryModule.readRelayDocumentSearchFailureRegistry({
      failureRegistryDir,
    });
    assert.equal(registry.failures.find((failure) => failure.root === workspaceA).retryRequestedCount, 1);
    assert.equal(registry.failures.find((failure) => failure.root === workspaceB).retryRequestedCount, 0);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance reports cancelled repair actions without removing caches", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-cancel-"));
  const filenameIndexDir = resolve(root, "filename-index");
  const derivedContentIndexDir = resolve(root, "derived-content-index");
  const parsedDocumentCacheDir = resolve(root, "parsed-document-cache");
  writeCacheFile(filenameIndexDir, "index.json");
  writeCacheFile(derivedContentIndexDir, "derived.json");
  writeCacheFile(parsedDocumentCacheDir, "parsed.json");
  const controller = new AbortController();
  controller.abort();

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("rebuild-derived-indexes", {
      metadataCacheDir: resolve(root, "metadata-cache"),
      filenameIndexDir,
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      allowUnsafeCacheDirForTests: true,
      signal: controller.signal,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "cancelled");
    assert.ok(result.warnings.includes("operation_cancelled"));
    assert.deepEqual(result.cacheAction, undefined);
    assert.deepEqual(result.healthEvents.map((event) => event.kind), ["maintenance_failed"]);
    assert.equal(result.healthEvents[0].details.cancelled, true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance repairs can run through the background scheduler", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-scheduled-"));
  const derivedContentIndexDir = resolve(root, "derived-content-index");
  const parsedDocumentCacheDir = resolve(root, "parsed-document-cache");
  writeCacheFile(derivedContentIndexDir, "derived.json");
  writeCacheFile(parsedDocumentCacheDir, "parsed.json");

  const { module, schedulerModule, cleanup } = await loadIndexMaintenanceModule();
  const scheduler = new schedulerModule.RelayDocumentSearchBackgroundScheduler({
    maxConcurrentJobs: 1,
    perRootConcurrency: 1,
    now: new Date("2026-05-10T00:00:00.000Z"),
  });
  try {
    const scheduled = await module.scheduleRelayDocumentSearchIndexMaintenance("rebuild-previews", {
      scheduler,
      drain: true,
      workId: "scheduled-preview-rebuild",
      root,
      metadataCacheDir: resolve(root, "metadata-cache"),
      filenameIndexDir: resolve(root, "filename-index"),
      derivedContentIndexDir,
      parsedDocumentCacheDir,
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      allowUnsafeCacheDirForTests: true,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(scheduled.schemaVersion, "RelayDocumentSearchIndexMaintenanceSchedule.v1");
    assert.equal(scheduled.action, "rebuild-previews");
    assert.equal(scheduled.work.workId, "scheduled-preview-rebuild");
    assert.equal(scheduled.work.kind, "index_maintenance");
    assert.equal(scheduled.work.lifecycle, "completed");
    assert.equal(scheduled.work.resultStatus, "ok");
    assert.equal(scheduled.result.status, "repaired");
    assert.deepEqual(scheduled.result.cacheAction.removedStores, ["derivedContentIndex"]);
    assert.equal(scheduled.scheduler.completedJobCount, 1);
    assert.equal(scheduled.scheduler.failedJobCount, 0);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance reports explicit SQLite FTS readiness without enabling a backend", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-fts-"));
  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("compact", {
      metadataCacheDir: resolve(root, "metadata-cache"),
      filenameIndexDir: resolve(root, "filename-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexDbPath: resolve(root, "document-search.sqlite"),
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "not_applicable");
    assert.equal(result.indexDb.sqliteFtsRequested, true);
    assert.equal(result.indexDb.sqliteFtsEnabled, false);
    assert.equal(result.indexDb.status, "unsupported");
    assert.match(result.indexDb.dbPath, /document-search\.sqlite$/);
    assert.ok(result.indexDb.warnings.includes("sqlite_fts_backend_not_enabled"));
    assert.deepEqual(result.warnings, ["index_db_not_enabled"]);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance initializes an enabled SQLite FTS backend and runs DB maintenance", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-enabled-db-"));
  const sqlStatements = [];
  const openedPaths = [];
  class FakeDatabaseSync {
    constructor(path) {
      openedPaths.push(path);
    }

    exec(sql) {
      sqlStatements.push(sql);
    }

    close() {}
  }

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("wal-checkpoint", {
      metadataCacheDir: resolve(root, "metadata-cache"),
      filenameIndexDir: resolve(root, "filename-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexDbPath: resolve(root, "document-search.sqlite"),
      enableIndexDb: true,
      sqliteModule: { DatabaseSync: FakeDatabaseSync },
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "repaired");
    assert.equal(result.indexDb.backend, "sqlite_fts");
    assert.equal(result.indexDb.sqliteFtsEnabled, true);
    assert.equal(result.indexDb.status, "ready");
    assert.equal(result.indexDb.schemaRevision, 2);
    assert.equal(result.indexDb.ftsReady, true);
    assert.equal(result.indexDb.staging.inspected, false);
    assert.equal(result.indexDb.wal.inspected, true);
    assert.equal(result.indexDb.wal.checkpointRecommended, false);
    assert.equal(result.indexDb.initializedTables.includes("content_nodes_fts"), true);
    assert.equal(result.indexDb.initializedTables.includes("index_schema_migrations"), true);
    assert.deepEqual(result.indexDb.missingTables, []);
    assert.equal(result.indexDb.appliedMigrations.includes("20260510_preview_spans_entry_id"), true);
    assert.deepEqual(result.indexDb.pendingMigrations, []);
    assert.deepEqual(result.warnings, ["index_db_wal_checkpoint_completed"]);
    assert.deepEqual(result.healthEvents.map((event) => event.kind), ["maintenance_completed"]);
    assert.equal(result.healthEvents[0].details.backend, "sqlite_fts");
    assert.equal(result.healthEvents[0].details.sqliteFtsEnabled, true);
    assert.equal(result.healthEvents[0].details.missingTableCount, 0);
    assert.equal(result.healthEvents[0].details.incompleteStagingRecordCount, 0);
    assert.equal(result.healthEvents[0].details.pendingMigrationCount, 0);
    assert.equal(result.healthEvents[0].details.walCheckpointRecommended, false);
    assert.equal(openedPaths.every((path) => /document-search\.sqlite$/.test(path)), true);
    assert.equal(
      sqlStatements.some((sql) => /CREATE VIRTUAL TABLE IF NOT EXISTS content_nodes_fts USING fts5/.test(sql)),
      true,
    );
    assert.equal(sqlStatements.includes("PRAGMA wal_checkpoint(TRUNCATE);"), true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance reports incomplete staging state without document contents", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-staging-"));
  const migrationColumns = [
    "entry_id",
    "entry_kind",
    "title",
    "location_label",
    "source_metadata_version",
    "parsed_document_uid",
    "parser_version",
    "anchor_json",
  ];
  class FakeDatabaseSync {
    exec() {}

    prepare(sql) {
      return {
        all() {
          if (/PRAGMA table_info\(preview_spans\)/.test(sql)) {
            return migrationColumns.map((name) => ({ name }));
          }
          if (/FROM parsed_documents[\s\S]+content_nodes_fts/.test(sql)) return [{ count: 2 }];
          if (/FROM parsed_documents[\s\S]+preview_spans/.test(sql)) return [{ count: 3 }];
          if (/FROM parsed_documents/.test(sql)) return [{ count: 5 }];
          return [];
        },
        run() {},
      };
    }

    close() {}
  }

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("integrity-check", {
      metadataCacheDir: resolve(root, "metadata-cache"),
      filenameIndexDir: resolve(root, "filename-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexDbPath: resolve(root, "document-search.sqlite"),
      enableIndexDb: true,
      sqliteModule: { DatabaseSync: FakeDatabaseSync },
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.indexDb.staging.inspected, true);
    assert.equal(result.indexDb.staging.parsedDocumentCount, 5);
    assert.equal(result.indexDb.staging.parsedWithoutDerivedRowsCount, 2);
    assert.equal(result.indexDb.staging.parsedWithoutPreviewSpanCount, 3);
    assert.equal(result.indexDb.staging.incompleteStagingRecordCount, 3);
    assert.ok(result.indexDb.warnings.includes("index_db_incomplete_staging_records_present"));
    assert.equal(result.healthEvents[0].details.incompleteStagingRecordCount, 3);
    assert.equal(result.healthEvents[0].details.parsedWithoutDerivedRowsCount, 2);
    assert.equal(result.healthEvents[0].details.parsedWithoutPreviewSpanCount, 3);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index maintenance reports WAL checkpoint state without exporting DB contents", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-maintenance-wal-"));
  writeFileSync(resolve(root, "document-search.sqlite-wal"), "wal-data", "utf8");
  writeFileSync(resolve(root, "document-search.sqlite-shm"), "shm", "utf8");

  class FakeDatabaseSync {
    exec() {}
    close() {}
  }

  const { module, cleanup } = await loadIndexMaintenanceModule();
  try {
    const result = await module.runRelayDocumentSearchIndexMaintenance("integrity-check", {
      metadataCacheDir: resolve(root, "metadata-cache"),
      filenameIndexDir: resolve(root, "filename-index"),
      parsedDocumentCacheDir: resolve(root, "parsed-document-cache"),
      jobStoreDir: resolve(root, "jobs"),
      userMemoryDir: resolve(root, "user-memory"),
      indexDbPath: resolve(root, "document-search.sqlite"),
      enableIndexDb: true,
      sqliteModule: { DatabaseSync: FakeDatabaseSync },
      indexCoordinatorDir: resolve(root, "index-coordinator"),
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.indexDb.wal.inspected, true);
    assert.equal(result.indexDb.wal.walFileBytes, 8);
    assert.equal(result.indexDb.wal.shmFileBytes, 3);
    assert.equal(result.indexDb.wal.checkpointRecommended, true);
    assert.ok(result.indexDb.warnings.includes("index_db_wal_checkpoint_recommended"));
    assert.equal(result.healthEvents[0].details.walFileBytes, 8);
    assert.equal(result.healthEvents[0].details.shmFileBytes, 3);
    assert.equal(result.healthEvents[0].details.walCheckpointRecommended, true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
