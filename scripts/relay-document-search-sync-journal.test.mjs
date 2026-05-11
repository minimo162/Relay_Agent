import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const syncJournalPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchSyncJournal.ts",
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

async function loadSyncJournalModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-sync-journal-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchSyncJournal.mjs"), transpile(syncJournalPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchSyncJournal.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("sync journal appends capped metadata-only filesystem and search events", async () => {
  const journalDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-sync-journal-store-"));
  const { module, cleanup } = await loadSyncJournalModule();
  try {
    await module.appendRelayDocumentSearchSyncJournalEvents(
      [
        {
          kind: "created",
          jobId: "job-sync",
          root: "C:/workspace",
          path: "C:/workspace/CFS.xlsx",
          details: { source: "watcher", ignoredObject: { no: "objects" } },
        },
        {
          kind: "modified",
          jobId: "job-sync",
          root: "C:/workspace",
          path: "C:/workspace/CFS.xlsx",
        },
        {
          kind: "search_completed",
          jobId: "job-sync",
          queryId: "query-sync",
          query: "キャッシュフロー",
          status: "ok",
          resultCount: 1,
          warningCodes: ["content_confirmed"],
        },
      ],
      {
        syncJournalDir: journalDir,
        syncJournalMaxEntries: 2,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );

    const journal = await module.readRelayDocumentSearchSyncJournal({
      syncJournalDir: journalDir,
      syncJournalMaxEntries: 2,
    });
    assert.equal(journal.schemaVersion, "RelayDocumentSearchSyncJournal.v1");
    assert.equal(journal.entries.length, 2);
    assert.deepEqual(journal.entries.map((entry) => entry.kind), ["modified", "search_completed"]);
    assert.equal(journal.entries[0].path.endsWith("CFS.xlsx"), true);
    assert.equal(typeof journal.entries[0].pathHash, "string");
    assert.equal(JSON.stringify(journal).includes("document body text"), false);
    assert.equal(JSON.stringify(journal).includes("ignoredObject"), false);
  } finally {
    cleanup();
    rmSync(journalDir, { recursive: true, force: true });
  }
});

test("sync journal enablement and default directory are explicit", async () => {
  const { module, cleanup } = await loadSyncJournalModule();
  try {
    assert.equal(module.relayDocumentSearchSyncJournalEnabled({ useSyncJournal: true }), true);
    assert.equal(module.relayDocumentSearchSyncJournalEnabled({ useSyncJournal: false }), false);
    assert.match(
      module.relayDocumentSearchSyncJournalDir({ syncJournalDir: "relative-sync-journal" }),
      /relative-sync-journal$/,
    );
  } finally {
    cleanup();
  }
});

test("sync reconciliation combines watcher freshness with periodic scan due state", async () => {
  const journalDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-sync-reconciliation-"));
  const root = resolve(journalDir, "workspace");
  const { module, cleanup } = await loadSyncJournalModule();
  try {
    await module.appendRelayDocumentSearchSyncJournalEvent(
      {
        kind: "watcher_event",
        root,
        path: resolve(root, "CFS.xlsx"),
        details: { source: "watcher" },
      },
      {
        syncJournalDir: journalDir,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );
    const journal = await module.appendRelayDocumentSearchSyncJournalEvent(
      {
        kind: "periodic_scan_completed",
        root,
        count: 1,
        details: { source: "periodic_scan" },
      },
      {
        syncJournalDir: journalDir,
        now: new Date("2026-05-10T00:09:00.000Z"),
      },
    );
    const report = module.buildRelayDocumentSearchSyncReconciliationReport(journal, {
      roots: [root],
      watcherStaleMs: 5 * 60 * 1000,
      periodicScanIntervalMs: 15 * 60 * 1000,
      now: new Date("2026-05-10T00:10:00.000Z"),
    });

    assert.equal(report.schemaVersion, "RelayDocumentSearchSyncReconciliation.v1");
    assert.equal(report.rootCount, 1);
    assert.equal(report.watcherRootCount, 0);
    assert.equal(report.periodicDueRootCount, 0);
    assert.equal(report.roots[0].watcherEventCount, 1);
    assert.equal(report.roots[0].periodicScanEventCount, 1);
    assert.equal(report.roots[0].watcherState, "stale");
    assert.equal(report.roots[0].periodicState, "fresh");
    assert.equal(report.roots[0].reconciliationMode, "periodic");
    assert.equal(report.ai_boundary.originalFilesIncluded, false);
  } finally {
    cleanup();
    rmSync(journalDir, { recursive: true, force: true });
  }
});
