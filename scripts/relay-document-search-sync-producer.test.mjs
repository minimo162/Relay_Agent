import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const contractPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchContract.ts",
);
const backgroundSchedulerPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchBackgroundScheduler.ts",
);
const syncJournalPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchSyncJournal.ts",
);
const syncProducerPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchSyncProducer.ts",
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

async function loadSyncProducerModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-sync-producer-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchBackgroundScheduler.mjs"),
    transpile(backgroundSchedulerPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchSyncJournal.mjs"), transpile(syncJournalPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchSyncProducer.mjs"),
    transpile(syncProducerPath)
      .replace(
        "from './relayDocumentSearchBackgroundScheduler';",
        "from './relayDocumentSearchBackgroundScheduler.mjs';",
      )
      .replace("from './relayDocumentSearchSyncJournal';", "from './relayDocumentSearchSyncJournal.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchSyncProducer.mjs")).href),
      journalModule: await import(pathToFileURL(resolve(dir, "relayDocumentSearchSyncJournal.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("sync producer feeds watcher and periodic work into the background scheduler", async () => {
  const journalDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-sync-producer-journal-"));
  const { module, journalModule, cleanup } = await loadSyncProducerModule();
  try {
    const watchers = [];
    const intervals = [];
    const closedWatchers = [];
    const clearedIntervals = [];
    const startedWork = [];
    const watchImpl = (root, listener) => {
      const handle = {
        root,
        listener,
        close() {
          closedWatchers.push(root);
        },
      };
      watchers.push(handle);
      return handle;
    };
    const setIntervalImpl = (listener, intervalMs) => {
      const handle = { listener, intervalMs };
      intervals.push(handle);
      return handle;
    };
    const clearIntervalImpl = (handle) => {
      clearedIntervals.push(handle);
    };
    const runner = async (work) => {
      startedWork.push([work.kind, work.priority, work.roots[0]]);
      return {
        status: "ok",
        progress: { stage: work.kind, percent: 100, scannedFiles: 1, skippedFiles: 0 },
      };
    };

    const producer = await module.startRelayDocumentSearchSyncProducer({
      roots: ["/workspace"],
      watchImpl,
      setIntervalImpl,
      clearIntervalImpl,
      watcherRunner: runner,
      periodicRunner: runner,
      useSyncJournal: true,
      syncJournalDir: journalDir,
      watcherDebounceMs: 0,
      periodicScanIntervalMs: 5000,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(producer.snapshot().schemaVersion, "RelayDocumentSearchSyncProducer.v1");
    assert.equal(watchers.length, 1);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].intervalMs, 5000);

    watchers[0].listener("change", "決算メモ.txt");
    await producer.flushWatcherEvents();
    await producer.scheduler.drain();

    await producer.triggerPeriodicScan("/workspace");
    await producer.scheduler.drain();

    assert.deepEqual(startedWork, [
      ["watcher_sync", "foreground", resolve("/workspace")],
      ["periodic_sync", "idle", resolve("/workspace")],
    ]);

    const journal = await journalModule.readRelayDocumentSearchSyncJournal({
      syncJournalDir: journalDir,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });
    assert.deepEqual(
      journal.entries.map((entry) => entry.kind),
      ["watcher_started", "watcher_event", "periodic_scan_started", "periodic_scan_completed"],
    );
    assert.equal(journal.entries[1].path, resolve("/workspace/決算メモ.txt"));

    const stopped = await producer.stop();
    assert.equal(stopped.stopped, true);
    assert.deepEqual(closedWatchers, [resolve("/workspace")]);
    assert.equal(clearedIntervals.length, 1);
  } finally {
    cleanup();
    rmSync(journalDir, { recursive: true, force: true });
  }
});

test("sync producer can run with watcher or periodic producers disabled", async () => {
  const { module, cleanup } = await loadSyncProducerModule();
  try {
    const producer = await module.startRelayDocumentSearchSyncProducer({
      roots: ["/workspace"],
      useFilesystemWatcher: false,
      usePeriodicScan: false,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    const snapshot = producer.snapshot();
    assert.equal(snapshot.watcherEnabled, false);
    assert.equal(snapshot.periodicEnabled, false);
    assert.equal(snapshot.roots[0].watcherPolicy, "disabled");
    assert.equal(snapshot.roots[0].watcherPolicyReason, "filesystem_watcher_disabled");
    assert.equal(snapshot.roots[0].watcherState, "disabled");
    assert.equal(snapshot.roots[0].periodicState, "disabled");
    assert.equal(snapshot.scheduler.queueDepth, 0);
  } finally {
    cleanup();
  }
});

test("sync producer defaults network-share roots to periodic-only watcher policy", async () => {
  const { module, cleanup } = await loadSyncProducerModule();
  try {
    const watchers = [];
    const intervals = [];
    const producer = await module.startRelayDocumentSearchSyncProducer({
      roots: ["//server/share"],
      watchImpl: (root, listener) => {
        const handle = { root, listener, close() {} };
        watchers.push(handle);
        return handle;
      },
      setIntervalImpl: (listener, intervalMs) => {
        const handle = { listener, intervalMs };
        intervals.push(handle);
        return handle;
      },
      watcherDebounceMs: 0,
      periodicScanIntervalMs: 6000,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    const snapshot = producer.snapshot();
    assert.equal(snapshot.watcherEnabled, false);
    assert.equal(snapshot.periodicEnabled, true);
    assert.equal(snapshot.roots[0].watcherPolicy, "periodic_only");
    assert.equal(snapshot.roots[0].watcherPolicyReason, "network_share_periodic_default");
    assert.equal(snapshot.roots[0].watcherState, "disabled");
    assert.equal(snapshot.roots[0].periodicState, "scheduled");
    assert.equal(watchers.length, 0);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].intervalMs, 6000);

    producer.notifyWatcherEvent("//server/share", "change", "ignored.txt");
    assert.equal(producer.snapshot().queuedWatcherEventCount, 0);
    await producer.stop();
  } finally {
    cleanup();
  }
});

test("sync producer expands recursive watchers within explicit bounds", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-recursive-watchers-"));
  mkdirSync(resolve(workspace, "finance", "q1"), { recursive: true });
  mkdirSync(resolve(workspace, "ops"), { recursive: true });
  mkdirSync(resolve(workspace, "node_modules", "ignored"), { recursive: true });

  const { module, cleanup } = await loadSyncProducerModule();
  try {
    const watchers = [];
    const startedWork = [];
    const watchImpl = (root, listener) => {
      const handle = {
        root,
        listener,
        close() {},
      };
      watchers.push(handle);
      return handle;
    };

    const producer = await module.startRelayDocumentSearchSyncProducer({
      roots: [workspace],
      watchImpl,
      watcherRunner: async (work) => {
        startedWork.push([work.kind, work.roots[0]]);
      },
      usePeriodicScan: false,
      watcherDebounceMs: 0,
      watcherMaxDepth: 1,
      watcherMaxDirectories: 10,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.deepEqual(
      new Set(watchers.map((watcher) => watcher.root)),
      new Set([resolve(workspace), resolve(workspace, "finance"), resolve(workspace, "ops")]),
    );
    const rootState = producer.snapshot().roots[0];
    assert.equal(rootState.watchedDirectoryCount, 3);
    assert.equal(rootState.watcherLimitReached, false);

    watchers
      .find((watcher) => watcher.root === resolve(workspace, "finance"))
      .listener("rename", "決算メモ.txt");
    await producer.flushWatcherEvents();
    await producer.scheduler.drain();

    assert.deepEqual(startedWork, [["watcher_sync", resolve(workspace)]]);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("sync producer startup helper is gated by environment", async () => {
  const { module, cleanup } = await loadSyncProducerModule();
  try {
    const disabled = await module.startRelayDocumentSearchSyncProducerFromEnvironment({
      env: {
        RELAY_DOCUMENT_SEARCH_WORKSPACE: "/workspace",
      },
    });
    assert.equal(disabled, undefined);

    const producer = await module.startRelayDocumentSearchSyncProducerFromEnvironment({
      env: {
        RELAY_DOCUMENT_SEARCH_SYNC_PRODUCER: "1",
        RELAY_DOCUMENT_SEARCH_WORKSPACE: "/workspace",
        RELAY_DOCUMENT_SEARCH_WATCHER: "0",
        RELAY_DOCUMENT_SEARCH_PERIODIC_SCAN: "0",
      },
      now: new Date("2026-05-10T00:00:00.000Z"),
    });
    assert.equal(producer.snapshot().rootCount, 1);
    assert.equal(producer.snapshot().watcherEnabled, false);
    assert.equal(producer.snapshot().periodicEnabled, false);
    await producer.stop();
  } finally {
    cleanup();
  }
});
