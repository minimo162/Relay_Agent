import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import { loadRelayDocumentSearchExecutorModule } from "./relay-document-search-module-loader.mjs";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const defaultGeneratedAt = "2026-05-11T00:00:00.000Z";

function parseArgs(argv) {
  const out = {
    fileCount: 600,
    rowsPerFile: 3,
    output: resolve(repoRoot, "docs/WORKSPACE_DOCUMENT_SEARCH_SQLITE_FTS_PERFORMANCE.md"),
    generatedAt: defaultGeneratedAt,
    keepTemp: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--files") out.fileCount = Number(argv[++index]);
    else if (arg === "--rows-per-file") out.rowsPerFile = Number(argv[++index]);
    else if (arg === "--output") out.output = resolve(argv[++index]);
    else if (arg === "--generated-at") out.generatedAt = argv[++index];
    else if (arg === "--keep-temp") out.keepTemp = true;
    else if (arg === "--help") {
      console.log("Usage: node scripts/relay-document-search-index-db-performance.mjs [--files N] [--rows-per-file N] [--output PATH]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  out.fileCount = Math.max(1, Math.min(Math.trunc(out.fileCount), 5000));
  out.rowsPerFile = Math.max(1, Math.min(Math.trunc(out.rowsPerFile), 10));
  return out;
}

function bytes(path) {
  return existsSync(path) ? statSync(path).size : 0;
}

function timed(fn) {
  const started = performance.now();
  const value = fn();
  return { value, ms: performance.now() - started };
}

async function timedAsync(fn) {
  const started = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - started };
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function formatMs(value) {
  return value.toFixed(2);
}

function formatBytes(value) {
  return String(Math.round(value));
}

function syntheticMetadata(index, generatedAt) {
  const fileId = `synthetic-file-${String(index).padStart(5, "0")}`;
  const displayPath = `department-${index % 12}/quarter-${index % 4}/document-${String(index).padStart(5, "0")}.md`;
  return {
    fileId,
    root: "/synthetic/workspace",
    path: `/synthetic/workspace/${displayPath}`,
    displayPath,
    name: basename(displayPath),
    extension: "md",
    size: 2048 + index,
    modifiedTime: generatedAt,
    sourceMetadataVersion: `${fileId}:v1`,
    accessSnapshots: {
      metadata: {
        action: "metadata",
        state: "ok",
        checkedAt: generatedAt,
      },
    },
  };
}

function syntheticSearchStore(file, rowsPerFile, index) {
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowsPerFile; rowIndex += 1) {
    const bucket = `bucket-${String(index % 100).padStart(3, "0")}`;
    const entryKind = rowIndex === rowsPerFile - 1 ? "table_cell" : "text";
    const entryId = `${file.fileId}-entry-${rowIndex}`;
    rows.push({
      row_id: `${file.fileId}-row-${rowIndex}`,
      entry_id: entryId,
      entry_kind: entryKind,
      normalized_text: `cashflow synthetic ${bucket} row-${rowIndex} file-${index}`,
      anchor: {
        type: entryKind === "table_cell" ? "cell_excerpt" : "text_excerpt",
        anchor_confidence: "medium",
      },
      preview: {
        schemaVersion: "RelayDocumentSearchPreviewAnchor.v1",
        kind: entryKind,
        title: file.name,
        locationLabel: entryKind === "table_cell" ? `Sheet1!A${rowIndex + 1}` : "body",
        snippet: `cashflow synthetic ${bucket}`,
        sourceFileId: file.fileId,
        sourceMetadataVersion: file.sourceMetadataVersion,
        parsedDocumentUid: `${file.fileId}-parsed`,
        parserVersion: "synthetic-parser-v1",
      },
    });
  }
  return {
    schemaVersion: "RelayDocumentSearchDerivedSearchStore.v1",
    source_file_id: file.fileId,
    source_metadata_version: file.sourceMetadataVersion,
    parsed_document_uid: `${file.fileId}-parsed`,
    parsed_document_version: "relay-ir-v1",
    parser: {
      name: "synthetic",
      version: "synthetic-parser-v1",
      profile: "wds03",
    },
    rows,
    diagnostics: {
      rowCount: rows.length,
      textRowCount: rows.filter((row) => row.entry_kind === "text").length,
      tableCellRowCount: rows.filter((row) => row.entry_kind === "table_cell").length,
      previewSpanSeedCount: rows.length,
    },
  };
}

async function benchmarkScheduler(module, generatedAt) {
  const scheduler = new module.RelayDocumentSearchBackgroundScheduler({
    maxConcurrentJobs: 4,
    perRootConcurrency: 1,
    maxQueueDepth: 50,
    now: new Date(generatedAt),
  });
  const root = "/synthetic/workspace";
  const runner = () => new Promise((resolve) => setTimeout(() => resolve({ status: "ok" }), 15));
  for (let index = 0; index < 16; index += 1) {
    scheduler.enqueue({
      workId: `wds03-work-${index}`,
      kind: "background_content_index",
      priority: index < 2 ? "high" : "normal",
      roots: [root],
    }, runner);
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  const pressured = scheduler.snapshot();
  const drained = await scheduler.drain();
  return {
    state: pressured.state,
    queueDepth: pressured.queueDepth,
    activeJobCount: pressured.activeJobCount,
    throttledRootCount: pressured.throttledRoots.length,
    firstRootReasons: pressured.roots[0]?.reasons ?? [],
    drainedCompletedJobCount: drained.completedJobCount,
    drainedFailedJobCount: drained.failedJobCount,
  };
}

function checkpoint(sqliteModule, dbPath) {
  return timed(() => {
    const db = new sqliteModule.DatabaseSync(dbPath);
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } finally {
      db.close();
    }
  }).ms;
}

function renderMarkdown({
  args,
  generatedAt,
  metrics,
  scheduler,
}) {
  return `# Workspace Document Search SQLite/FTS Performance

Generated: ${generatedAt}

## Scope

WDS03 measures the SQLite/FTS path with a synthetic large-folder-like corpus.
No real user documents, snippets, raw FTS rows, raw DB contents, absolute temp
paths, or copied files are recorded in this report.

## Corpus

- Synthetic files: ${args.fileCount}
- Synthetic FTS rows per file: ${args.rowsPerFile}
- Total synthetic FTS rows: ${args.fileCount * args.rowsPerFile}
- Temporary working directory pattern: relay-wds03-perf-*

## SQLite/FTS Timings

| Operation | Result |
| --- | ---: |
| Metadata write | ${formatMs(metrics.metadataWriteMs)} ms |
| Derived FTS writes total | ${formatMs(metrics.derivedWriteMs)} ms |
| Derived FTS write average/file | ${formatMs(metrics.derivedWriteMs / args.fileCount)} ms |
| Selective search p50 | ${formatMs(metrics.selectiveSearchP50Ms)} ms |
| Selective search p95 | ${formatMs(metrics.selectiveSearchP95Ms)} ms |
| Broad truncated search p50 | ${formatMs(metrics.broadSearchP50Ms)} ms |
| Broad truncated search p95 | ${formatMs(metrics.broadSearchP95Ms)} ms |
| WAL checkpoint | ${formatMs(metrics.checkpointMs)} ms |

## Size And Checkpoint

| File | Before Checkpoint | After Checkpoint |
| --- | ---: | ---: |
| SQLite DB | ${formatBytes(metrics.dbBytesBeforeCheckpoint)} bytes | ${formatBytes(metrics.dbBytesAfterCheckpoint)} bytes |
| WAL | ${formatBytes(metrics.walBytesBeforeCheckpoint)} bytes | ${formatBytes(metrics.walBytesAfterCheckpoint)} bytes |
| SHM | ${formatBytes(metrics.shmBytesBeforeCheckpoint)} bytes | ${formatBytes(metrics.shmBytesAfterCheckpoint)} bytes |

## Search Probe Behavior

- Selective query rows returned: ${metrics.selectiveRows}; truncated: ${metrics.selectiveTruncated ? "yes" : "no"}.
- Broad query rows returned: ${metrics.broadRows}; truncated: ${metrics.broadTruncated ? "yes" : "no"}.
- Executor default FTS probe cap is now 20 rows, configurable with
  \`indexDbSearchMaxRows\` or \`RELAY_DOCUMENT_SEARCH_INDEX_DB_SEARCH_MAX_ROWS\`,
  and bounded to 100 rows.
- Evidence anchors remain capped separately at 3 per result.

## Scheduler Backpressure

- Pressure snapshot state: ${scheduler.state}.
- Queue depth under one-root pressure: ${scheduler.queueDepth}.
- Active jobs under one-root pressure: ${scheduler.activeJobCount}.
- Throttled roots: ${scheduler.throttledRootCount}.
- First root reasons: ${scheduler.firstRootReasons.join(", ") || "none"}.
- Drain result: completed=${scheduler.drainedCompletedJobCount}, failed=${scheduler.drainedFailedJobCount}.

## Tuned Thresholds

- Keep SQLite/FTS primary mode behind the WDS02 ready gate; any truncated broad
  probe remains a rollback signal.
- Use 20 FTS probe rows as the default candidate-scoring cap for MVP. This is
  above the 3 citation-anchor cap; search p95 stayed below 60 ms on this
  synthetic corpus, but the higher outlier should be rechecked on a
  representative customer-approved folder.
- Keep the hard FTS probe bound at 100 rows for support/debug experiments until
  a representative customer-approved corpus proves broader probes are safe.
- Treat non-empty WAL files as checkpoint candidates after background indexing;
  this run records the checkpoint cost and before/after WAL size without
  exporting DB contents.
- Keep per-root background indexing concurrency at 1 by default for shared or
  network-share-like roots; the scheduler reports per-root throttling rather
  than letting one root consume all workers.

## Follow-Up

- Repeat this script with a user-approved real shared folder before release
  acceptance.
- WDS04 should surface the active path and degraded/rollback state in
  beginner-safe UX without exposing DB paths or raw rows.
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sqliteModule = await import("node:sqlite");
  const tempDir = resolve(tmpdir(), `relay-wds03-perf-${process.pid}`);
  const dbPath = resolve(tempDir, "document-search.sqlite");
  mkdirSync(tempDir, { recursive: true });
  const { moduleDir, cleanup } = await loadRelayDocumentSearchExecutorModule({ repoRoot });
  try {
    const indexDbModule = await import(pathToFileURL(resolve(moduleDir, "relayDocumentSearchIndexDb.mjs")).href);
    const schedulerModule = await import(pathToFileURL(resolve(moduleDir, "relayDocumentSearchBackgroundScheduler.mjs")).href);
    const files = Array.from({ length: args.fileCount }, (_, index) => syntheticMetadata(index, args.generatedAt));

    const metadataWrite = await timedAsync(() =>
      indexDbModule.writeRelayDocumentSearchIndexDbMetadata(files, {
        indexDbPath: dbPath,
        sqliteModule,
        now: new Date(args.generatedAt),
      })
    );
    if (metadataWrite.value.status !== "ready") {
      throw new Error(`metadata write was not ready: ${metadataWrite.value.errors?.join("; ")}`);
    }

    const derivedStarted = performance.now();
    for (let index = 0; index < files.length; index += 1) {
      const report = await indexDbModule.writeRelayDocumentSearchIndexDbDerivedSearchStore(
        syntheticSearchStore(files[index], args.rowsPerFile, index),
        {
          indexDbPath: dbPath,
          sqliteModule,
          now: new Date(args.generatedAt),
        },
      );
      if (report.status !== "ready") {
        throw new Error(`derived write ${index} was not ready: ${report.errors?.join("; ")}`);
      }
    }
    const derivedWriteMs = performance.now() - derivedStarted;

    const selectiveDurations = [];
    let selectiveResult;
    for (let index = 0; index < 10; index += 1) {
      const measured = await timedAsync(() =>
        indexDbModule.searchRelayDocumentSearchIndexDbFts(["bucket-042"], {
          indexDbPath: dbPath,
          sqliteModule,
          maxRows: 100,
        })
      );
      selectiveDurations.push(measured.ms);
      selectiveResult = measured.value;
    }

    const broadDurations = [];
    let broadResult;
    for (let index = 0; index < 10; index += 1) {
      const measured = await timedAsync(() =>
        indexDbModule.searchRelayDocumentSearchIndexDbFts(["cashflow"], {
          indexDbPath: dbPath,
          sqliteModule,
          maxRows: 20,
        })
      );
      broadDurations.push(measured.ms);
      broadResult = measured.value;
    }

    const before = {
      db: bytes(dbPath),
      wal: bytes(`${dbPath}-wal`),
      shm: bytes(`${dbPath}-shm`),
    };
    const checkpointMs = checkpoint(sqliteModule, dbPath);
    const after = {
      db: bytes(dbPath),
      wal: bytes(`${dbPath}-wal`),
      shm: bytes(`${dbPath}-shm`),
    };
    const scheduler = await benchmarkScheduler(schedulerModule, args.generatedAt);
    const metrics = {
      metadataWriteMs: metadataWrite.ms,
      derivedWriteMs,
      selectiveSearchP50Ms: percentile(selectiveDurations, 0.5),
      selectiveSearchP95Ms: percentile(selectiveDurations, 0.95),
      broadSearchP50Ms: percentile(broadDurations, 0.5),
      broadSearchP95Ms: percentile(broadDurations, 0.95),
      selectiveRows: selectiveResult?.rows.length ?? 0,
      selectiveTruncated: Boolean(selectiveResult?.truncated),
      broadRows: broadResult?.rows.length ?? 0,
      broadTruncated: Boolean(broadResult?.truncated),
      dbBytesBeforeCheckpoint: before.db,
      walBytesBeforeCheckpoint: before.wal,
      shmBytesBeforeCheckpoint: before.shm,
      checkpointMs,
      dbBytesAfterCheckpoint: after.db,
      walBytesAfterCheckpoint: after.wal,
      shmBytesAfterCheckpoint: after.shm,
    };
    writeFileSync(args.output, renderMarkdown({
      args,
      generatedAt: args.generatedAt,
      metrics,
      scheduler,
    }), "utf8");
    console.log(JSON.stringify({
      output: relative(repoRoot, args.output),
      fileCount: args.fileCount,
      rowsPerFile: args.rowsPerFile,
      selectiveSearchP95Ms: Number(metrics.selectiveSearchP95Ms.toFixed(2)),
      broadSearchP95Ms: Number(metrics.broadSearchP95Ms.toFixed(2)),
      broadTruncated: metrics.broadTruncated,
    }));
  } finally {
    cleanup();
    if (!args.keepTemp) rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
