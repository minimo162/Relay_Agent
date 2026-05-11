import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexDbPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexDb.ts",
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

async function loadIndexDbModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchIndexDb.mjs"), transpile(indexDbPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchIndexDb.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

const legacyPreviewSpanColumns = [
  "file_id",
  "span_id",
  "start_offset",
  "end_offset",
  "preview_text",
  "generated_at",
];

function createFakeSqliteModule(options = {}) {
  const calls = [];
  const openedPaths = [];
  const previewSpanColumns = options.previewSpanColumns ?? legacyPreviewSpanColumns;
  const userVersion = options.userVersion ?? 0;
  const contentRows = options.contentRows ?? [{
    file_id: "file-1",
    entry_id: "text-1",
    text: "キャッシュフロー本文",
    span_id: "row-text-1",
    preview_text: "キャッシュフロー本文",
    title: "fy.xlsx",
    location_label: "本文",
    source_metadata_version: "file-1:123:1",
    parsed_document_uid: "parsed-1",
    parser_version: "parser-v1",
    anchor_json: JSON.stringify({ kind: "text" }),
  }];
  const tableRows = options.tableRows ?? [{
    file_id: "file-1",
    entry_id: "table-1",
    text: "キャッシュフロー表",
    span_id: "row-table-1",
    preview_text: "キャッシュフロー表",
    title: "fy.xlsx",
    location_label: "Sheet1!A1",
    source_metadata_version: "file-1:123:1",
    parsed_document_uid: "parsed-1",
    parser_version: "parser-v1",
    anchor_json: JSON.stringify({ kind: "table_cell" }),
  }];

  class FakeDatabaseSync {
    constructor(path) {
      openedPaths.push(path);
    }

    exec(sql) {
      calls.push({ kind: "exec", sql });
    }

    prepare(sql) {
      calls.push({ kind: "prepare", sql });
      return {
        run: (...params) => {
          calls.push({ kind: "run", sql, params });
        },
        all: (...params) => {
          calls.push({ kind: "all", sql, params });
          if (/PRAGMA user_version/.test(sql)) {
            return [{ user_version: userVersion }];
          }
          if (/PRAGMA table_info\(preview_spans\)/.test(sql)) {
            return previewSpanColumns.map((name) => ({ name }));
          }
          if (/FROM content_nodes_fts/.test(sql)) {
            return contentRows;
          }
          if (/FROM table_cells_fts/.test(sql)) {
            return tableRows;
          }
          return [];
        },
      };
    }

    close() {
      calls.push({ kind: "close" });
    }
  }

  return {
    calls,
    openedPaths,
    sqliteModule: { DatabaseSync: FakeDatabaseSync },
  };
}

function fileMetadata() {
  return {
    fileId: "file-1",
    root: "/workspace",
    path: "/workspace/fy.xlsx",
    displayPath: "fy.xlsx",
    name: "fy.xlsx",
    extension: "xlsx",
    size: 123,
    modifiedTime: "2026-05-10T00:00:00.000Z",
    sourceMetadataVersion: "file-1:123:1",
    accessSnapshots: {
      metadata: {
        action: "metadata",
        state: "ok",
        checkedAt: "2026-05-10T00:00:00.000Z",
      },
    },
  };
}

function preview(kind, snippet) {
  return {
    schemaVersion: "RelayDocumentSearchPreviewAnchor.v1",
    kind,
    title: "fy.xlsx",
    locationLabel: kind === "table_cell" ? "Sheet1!A1" : "本文",
    snippet,
    sourceFileId: "file-1",
    sourceMetadataVersion: "file-1:123:1",
    parsedDocumentUid: "parsed-1",
    parserVersion: "parser-v1",
  };
}

function derivedSearchStore() {
  return {
    schemaVersion: "RelayDocumentSearchDerivedSearchStore.v1",
    source_file_id: "file-1",
    source_metadata_version: "file-1:123:1",
    parsed_document_uid: "parsed-1",
    parsed_document_version: "relay-ir-v1",
    parser: {
      name: "unit",
      version: "parser-v1",
      profile: "test",
    },
    rows: [
      {
        row_id: "row-text-1",
        entry_id: "text-1",
        entry_kind: "text",
        normalized_text: "キャッシュフロー本文",
        anchor: { kind: "text" },
        preview: preview("text", "キャッシュフロー本文"),
      },
      {
        row_id: "row-table-1",
        entry_id: "table-1",
        entry_kind: "table_cell",
        normalized_text: "キャッシュフロー表",
        anchor: { kind: "table_cell" },
        preview: preview("table_cell", "キャッシュフロー表"),
      },
    ],
    diagnostics: {
      rowCount: 2,
      textRowCount: 1,
      tableCellRowCount: 1,
      previewSpanSeedCount: 2,
    },
  };
}

test("index DB reports schema revision and records preview-span migrations", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-migration-"));
  const fake = createFakeSqliteModule();
  const { module, cleanup } = await loadIndexDbModule();
  try {
    const report = await module.initializeRelayDocumentSearchIndexDb({
      indexDbPath: resolve(root, "document-search.sqlite"),
      sqliteModule: fake.sqliteModule,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(report.schemaVersion, "RelayDocumentSearchIndexDb.v1");
    assert.equal(report.schemaRevision, 2);
    assert.equal(report.status, "ready");
    assert.equal(report.requiredTables.includes("index_schema_migrations"), true);
    assert.equal(report.requiredMigrations.length, 8);
    assert.equal(report.appliedMigrations.includes("20260510_preview_spans_entry_id"), true);
    assert.equal(report.appliedMigrations.includes("20260510_preview_spans_anchor_json"), true);
    assert.equal(report.existingMigrations.length, 0);
    assert.equal(
      fake.calls.some((call) =>
        call.kind === "run" &&
          /INSERT OR IGNORE INTO index_schema_migrations/.test(call.sql) &&
          call.params[0] === "20260510_preview_spans_entry_id"
      ),
      true,
    );
    assert.equal(fake.calls.some((call) => call.kind === "exec" && /PRAGMA user_version = 2/.test(call.sql)), true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index DB treats already-expanded preview-span columns as existing migrations", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-existing-migration-"));
  const fake = createFakeSqliteModule({
    previewSpanColumns: [
      ...legacyPreviewSpanColumns,
      "entry_id",
      "entry_kind",
      "title",
      "location_label",
      "source_metadata_version",
      "parsed_document_uid",
      "parser_version",
      "anchor_json",
    ],
  });
  const { module, cleanup } = await loadIndexDbModule();
  try {
    const report = await module.initializeRelayDocumentSearchIndexDb({
      indexDbPath: resolve(root, "document-search.sqlite"),
      sqliteModule: fake.sqliteModule,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(report.status, "ready");
    assert.equal(report.appliedMigrations.length, 0);
    assert.equal(report.existingMigrations.includes("20260510_preview_spans_anchor_json"), true);
    assert.equal(
      fake.calls.some((call) => call.kind === "exec" && /ALTER TABLE preview_spans ADD COLUMN anchor_json/.test(call.sql)),
      false,
    );
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index DB opens newer schemas read-only without applying migrations", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-read-only-"));
  const fake = createFakeSqliteModule({ userVersion: 99 });
  const { module, cleanup } = await loadIndexDbModule();
  try {
    const options = {
      indexDbPath: resolve(root, "document-search.sqlite"),
      sqliteModule: fake.sqliteModule,
      now: new Date("2026-05-10T00:00:00.000Z"),
    };
    const report = await module.initializeRelayDocumentSearchIndexDb(options);
    const write = await module.writeRelayDocumentSearchIndexDbMetadata([fileMetadata()], options);

    assert.equal(report.status, "read_only");
    assert.equal(report.readOnly, true);
    assert.equal(report.detectedSchemaRevision, 99);
    assert.ok(report.warnings.includes("index_db_newer_schema_opened_read_only"));
    assert.equal(write.status, "read_only");
    assert.equal(write.fileMetadataRowCount, 0);
    assert.equal(
      fake.calls.some((call) => call.kind === "exec" && /CREATE TABLE IF NOT EXISTS file_metadata/.test(call.sql)),
      false,
    );
    assert.equal(
      fake.calls.some((call) => call.kind === "run" && /INSERT INTO file_metadata/.test(call.sql)),
      false,
    );
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index DB writes metadata and derived search-store rows into SQLite FTS tables", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-"));
  const fake = createFakeSqliteModule();
  const { module, cleanup } = await loadIndexDbModule();
  try {
    const options = {
      indexDbPath: resolve(root, "document-search.sqlite"),
      sqliteModule: fake.sqliteModule,
      now: new Date("2026-05-10T00:00:00.000Z"),
    };
    const metadata = await module.writeRelayDocumentSearchIndexDbMetadata([fileMetadata()], options);
    const derived = await module.writeRelayDocumentSearchIndexDbDerivedSearchStore(derivedSearchStore(), options);

    assert.equal(metadata.status, "ready");
    assert.equal(metadata.schemaRevision, 2);
    assert.equal(metadata.requiredMigrations.includes("20260510_preview_spans_anchor_json"), true);
    assert.equal(metadata.fileMetadataRowCount, 1);
    assert.equal(derived.status, "ready");
    assert.equal(derived.schemaRevision, 2);
    assert.equal(derived.ftsRowCount, 2);
    assert.equal(derived.previewSpanRowCount, 2);
    assert.equal(fake.openedPaths.every((path) => /document-search\.sqlite$/.test(path)), true);
    assert.equal(
      fake.calls.some(
        (call) => call.kind === "exec" && /CREATE VIRTUAL TABLE IF NOT EXISTS content_nodes_fts USING fts5/.test(call.sql),
      ),
      true,
    );

    const metadataRun = fake.calls.find(
      (call) => call.kind === "run" && /INSERT INTO file_metadata/.test(call.sql),
    );
    assert.ok(metadataRun);
    assert.deepEqual(metadataRun.params.slice(0, 4), ["file-1", "/workspace/fy.xlsx", "fy.xlsx", "xlsx"]);
    assert.equal(metadataRun.params.at(-1), "2026-05-10T00:00:00.000Z");

    const textRun = fake.calls.find(
      (call) => call.kind === "run" && /INSERT INTO content_nodes_fts/.test(call.sql),
    );
    assert.ok(textRun);
    assert.deepEqual(textRun.params, ["file-1", "text-1", "キャッシュフロー本文", "fy.xlsx"]);

    const tableRun = fake.calls.find(
      (call) => call.kind === "run" && /INSERT INTO table_cells_fts/.test(call.sql),
    );
    assert.ok(tableRun);
    assert.deepEqual(tableRun.params, ["file-1", "table-1", "Sheet1!A1", "キャッシュフロー表"]);

    const previewRuns = fake.calls.filter(
      (call) => call.kind === "run" && /INSERT INTO preview_spans/.test(call.sql),
    );
    assert.equal(previewRuns.length, 2);
    assert.deepEqual(previewRuns[0].params, [
      "file-1",
      "row-text-1",
      "text-1",
      "text",
      0,
      "キャッシュフロー本文".length,
      "キャッシュフロー本文",
      "fy.xlsx",
      "本文",
      "file-1:123:1",
      "parsed-1",
      "parser-v1",
      JSON.stringify({ kind: "text" }),
      "2026-05-10T00:00:00.000Z",
    ]);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index DB writes derived search-store rows with real SQLite bindings", async (t) => {
  let sqliteModule;
  try {
    sqliteModule = await import("node:sqlite");
  } catch {
    t.skip("node:sqlite is unavailable in this Node runtime");
    return;
  }
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-real-"));
  const { module, cleanup } = await loadIndexDbModule();
  try {
    const options = {
      indexDbPath: resolve(root, "document-search.sqlite"),
      sqliteModule,
      now: new Date("2026-05-10T00:00:00.000Z"),
    };
    const store = derivedSearchStore();
    store.rows = store.rows.map((row) => ({
      ...row,
      normalized_text: `${row.normalized_text} cashflow`,
    }));
    const metadata = await module.writeRelayDocumentSearchIndexDbMetadata([fileMetadata()], options);
    const derived = await module.writeRelayDocumentSearchIndexDbDerivedSearchStore(store, options);
    const search = await module.searchRelayDocumentSearchIndexDbFts(["cashflow"], options);

    assert.equal(metadata.status, "ready");
    assert.equal(derived.status, "ready");
    assert.equal(derived.ftsRowCount, 2);
    assert.equal(derived.previewSpanRowCount, 2);
    assert.equal(search.status, "ready");
    assert.equal(search.rows.length, 2);
    assert.equal(search.rows.some((row) => row.entry_kind === "text" && row.title === "fy.xlsx"), true);
    assert.equal(search.rows.some((row) => row.entry_kind === "table_cell" && row.location_label === "Sheet1!A1"), true);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index DB searches content and table FTS rows with bounded quoted queries", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-search-"));
  const fake = createFakeSqliteModule();
  const { module, cleanup } = await loadIndexDbModule();
  try {
    const result = await module.searchRelayDocumentSearchIndexDbFts(["キャッシュフロー", 'CFS "quote"'], {
      indexDbPath: resolve(root, "document-search.sqlite"),
      sqliteModule: fake.sqliteModule,
      maxRows: 7,
    });

    assert.equal(result.schemaVersion, "RelayDocumentSearchIndexDb.v1");
    assert.equal(result.schemaRevision, 2);
    assert.equal(result.status, "ready");
    assert.equal(result.requiredMigrations.includes("20260510_preview_spans_anchor_json"), true);
    assert.equal(result.query, '"キャッシュフロー" OR "CFS ""quote"""');
    assert.equal(result.maxRows, 7);
    assert.equal(result.rawRowCount, 2);
    assert.equal(result.textRawRowCount, 1);
    assert.equal(result.tableCellRawRowCount, 1);
    assert.equal(result.droppedRowCount, 0);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.rows, [
      {
        file_id: "file-1",
        entry_id: "text-1",
        entry_kind: "text",
        text: "キャッシュフロー本文",
        span_id: "row-text-1",
        preview_text: "キャッシュフロー本文",
        title: "fy.xlsx",
        location_label: "本文",
        source_metadata_version: "file-1:123:1",
        parsed_document_uid: "parsed-1",
        parser_version: "parser-v1",
        anchor: { kind: "text" },
      },
      {
        file_id: "file-1",
        entry_id: "table-1",
        entry_kind: "table_cell",
        text: "キャッシュフロー表",
        span_id: "row-table-1",
        preview_text: "キャッシュフロー表",
        title: "fy.xlsx",
        location_label: "Sheet1!A1",
        source_metadata_version: "file-1:123:1",
        parsed_document_uid: "parsed-1",
        parser_version: "parser-v1",
        anchor: { kind: "table_cell" },
      },
    ]);

    const allCalls = fake.calls.filter(
      (call) => call.kind === "all" && /WHERE (content_nodes_fts|table_cells_fts) MATCH/.test(call.sql),
    );
    assert.equal(allCalls.length, 2);
    assert.deepEqual(allCalls.map((call) => call.params), [
      ['"キャッシュフロー" OR "CFS ""quote"""', 7],
      ['"キャッシュフロー" OR "CFS ""quote"""', 7],
    ]);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index DB reports FTS result-limit truncation without returning raw DB rows", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-search-limit-"));
  const fake = createFakeSqliteModule({
    contentRows: [
      { file_id: "file-1", entry_id: "text-1", text: "キャッシュフロー本文1" },
      { file_id: "file-2", entry_id: "text-2", text: "キャッシュフロー本文2" },
    ],
    tableRows: [
      { file_id: "file-3", entry_id: "table-1", text: "キャッシュフロー表1" },
      { file_id: "file-4", entry_id: "table-2", text: "キャッシュフロー表2" },
    ],
  });
  const { module, cleanup } = await loadIndexDbModule();
  try {
    const result = await module.searchRelayDocumentSearchIndexDbFts(["キャッシュフロー"], {
      indexDbPath: resolve(root, "document-search.sqlite"),
      sqliteModule: fake.sqliteModule,
      maxRows: 3,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.maxRows, 3);
    assert.equal(result.rawRowCount, 4);
    assert.equal(result.textRawRowCount, 2);
    assert.equal(result.tableCellRawRowCount, 2);
    assert.equal(result.rows.length, 3);
    assert.equal(result.droppedRowCount, 1);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.warnings, ["fts_result_limit_reached"]);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("index DB invalidates content rows for selected failed files without deleting metadata", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-file-invalidate-"));
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
          if (/COUNT\(\*\) AS count FROM file_metadata/.test(sql)) return [{ count: 2 }];
          return [];
        },
        run() {},
      };
    }

    close() {}
  }

  const { module, cleanup } = await loadIndexDbModule();
  try {
    const result = await module.invalidateRelayDocumentSearchIndexDbFiles(
      [
        { root, fileId: "failed-file-a", path: resolve(root, "failed-a.docx") },
        { root, path: resolve(root, "failed-b.pdf") },
      ],
      {
        indexDbPath: resolve(root, "document-search.sqlite"),
        sqliteModule: { DatabaseSync: FakeDatabaseSync },
      },
    );

    assert.equal(result.schemaVersion, "RelayDocumentSearchIndexDb.v1");
    assert.equal(result.status, "ready");
    assert.equal(result.targetFileCount, 2);
    assert.equal(result.matchedFileCount, 2);
    const deletionSql = sqlStatements.find((sql) => /DELETE FROM content_nodes_fts/.test(sql));
    assert.match(deletionSql, /DELETE FROM content_nodes_fts/);
    assert.match(deletionSql, /DELETE FROM table_cells_fts/);
    assert.match(deletionSql, /DELETE FROM preview_spans/);
    assert.match(deletionSql, /DELETE FROM parsed_documents/);
    assert.equal(/DELETE FROM file_metadata/.test(deletionSql), false);
    assert.match(deletionSql, /failed-file-a/);
    assert.match(deletionSql, /failed-b\.pdf/);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
