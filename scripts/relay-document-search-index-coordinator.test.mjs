import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coordinatorPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexCoordinator.ts",
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

async function loadCoordinatorModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-coordinator-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchIndexCoordinator.mjs"), transpile(coordinatorPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchIndexCoordinator.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("Relay document search index coordinator serializes writer ownership and records health events", async () => {
  const coordinatorDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-coordinator-"));
  const { module, cleanup } = await loadCoordinatorModule();
  try {
    const writer = await module.acquireRelayDocumentSearchIndexWriter({
      coordinatorDir,
      ownerId: "owner-a",
      appVersion: "test-version",
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    assert.equal(writer.snapshot.ownerId, "owner-a");
    assert.equal(writer.snapshot.appVersion, "test-version");
    assert.ok(existsSync(resolve(coordinatorDir, "writer.lock.json")));

    await writer.beginJob("job-a");
    assert.deepEqual(writer.snapshot.activeJobIds, ["job-a"]);
    await writer.finishJob("job-a");
    assert.deepEqual(writer.snapshot.activeJobIds, []);
    await writer.release();
    assert.equal(existsSync(resolve(coordinatorDir, "writer.lock.json")), false);

    const events = await module.readRelayDocumentSearchIndexHealthEvents({ coordinatorDir }, 10);
    assert.deepEqual(
      events.map((event) => event.kind),
      ["lock_acquired", "job_started", "job_finished", "lock_released"],
    );
  } finally {
    cleanup();
    rmSync(coordinatorDir, { recursive: true, force: true });
  }
});

test("Relay document search index coordinator recovers stale writer locks", async () => {
  const coordinatorDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-stale-"));
  const { module, cleanup } = await loadCoordinatorModule();
  try {
    writeFileSync(
      resolve(coordinatorDir, "writer.lock.json"),
      JSON.stringify(
        {
          schemaVersion: "RelayDocumentSearchIndexLock.v1",
          ownerId: "old-owner",
          pid: 12345,
          acquiredAt: "2026-05-09T00:00:00.000Z",
          heartbeatAt: "2026-05-09T00:00:00.000Z",
          activeJobIds: ["old-job"],
        },
        null,
        2,
      ),
      "utf8",
    );

    const writer = await module.acquireRelayDocumentSearchIndexWriter({
      coordinatorDir,
      ownerId: "owner-b",
      lockStaleMs: 1000,
      now: new Date("2026-05-09T00:05:00.000Z"),
    });
    await writer.release();

    const events = await module.readRelayDocumentSearchIndexHealthEvents({ coordinatorDir }, 10);
    assert.deepEqual(
      events.map((event) => event.kind),
      ["stale_lock_recovered", "lock_acquired", "lock_released"],
    );
    assert.equal(events[0].details.previousOwnerId, "old-owner");
  } finally {
    cleanup();
    rmSync(coordinatorDir, { recursive: true, force: true });
  }
});

test("Relay document search index coordinator reports a busy active writer without taking over", async () => {
  const coordinatorDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-busy-"));
  const { module, cleanup } = await loadCoordinatorModule();
  try {
    const writer = await module.acquireRelayDocumentSearchIndexWriter({
      coordinatorDir,
      ownerId: "owner-active",
      lockStaleMs: 60000,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });
    await writer.beginJob("job-active");

    await assert.rejects(
      () =>
        module.acquireRelayDocumentSearchIndexWriter({
          coordinatorDir,
          ownerId: "owner-contender",
          lockStaleMs: 60000,
          now: new Date("2026-05-09T00:00:10.000Z"),
        }),
      { name: "RelayDocumentSearchIndexWriterBusyError" },
    );

    const events = await module.readRelayDocumentSearchIndexHealthEvents({ coordinatorDir }, 10);
    assert.deepEqual(events.map((event) => event.kind), ["lock_acquired", "job_started", "lock_busy"]);

    await writer.finishJob("job-active");
    await writer.release();
  } finally {
    cleanup();
    rmSync(coordinatorDir, { recursive: true, force: true });
  }
});

test("Relay document search index coordinator atomically swaps active content index pointers", async () => {
  const coordinatorDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-content-index-pointer-"));
  const { module, cleanup } = await loadCoordinatorModule();
  try {
    const first = await module.commitRelayDocumentSearchContentIndexActivePointer(
      {
        jobId: "job-pointer-a",
        sourceFileId: "file-pointer",
        sourcePath: "/workspace/memo.md",
        sourceMetadataVersion: "meta-v1",
        parsedDocumentUid: "parsed-v1",
        parsedDocumentVersion: "relay-ir-v1",
        parserVersion: "relay-text-reader-v1",
        parsedCacheKey: "parsed-key-v1",
        derivedCacheKey: "derived-key-v1",
        searchStoreRowCount: 2,
        ftsRowCount: 2,
        previewSpanCount: 2,
      },
      {
        coordinatorDir,
        ownerId: "owner-pointer",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(first.schemaVersion, "RelayDocumentSearchContentIndexCommit.v1");
    assert.equal(first.status, "committed");
    assert.equal(first.active.state, "active");
    assert.equal(first.active.sourceMetadataVersion, "meta-v1");

    const stale = await module.markRelayDocumentSearchContentIndexActivePointerStale(
      "file-pointer",
      "derived_index_build_failed",
      {
        coordinatorDir,
        ownerId: "owner-pointer",
        jobId: "job-pointer-b",
        message: "forced failure",
        now: new Date("2026-05-09T00:01:00.000Z"),
      },
    );

    assert.equal(stale.status, "stale_previous_active");
    assert.equal(stale.active.state, "stale");
    assert.equal(stale.active.lastFailure.reason, "derived_index_build_failed");
    const pointer = await module.readRelayDocumentSearchContentIndexActivePointer("file-pointer", { coordinatorDir });
    assert.equal(pointer.state, "stale");
    assert.equal(pointer.sourceMetadataVersion, "meta-v1");

    const second = await module.commitRelayDocumentSearchContentIndexActivePointer(
      {
        jobId: "job-pointer-c",
        sourceFileId: "file-pointer",
        sourcePath: "/workspace/memo.md",
        sourceMetadataVersion: "meta-v2",
        parsedDocumentUid: "parsed-v2",
        parsedDocumentVersion: "relay-ir-v1",
        parserVersion: "relay-text-reader-v1",
        parsedCacheKey: "parsed-key-v2",
        derivedCacheKey: "derived-key-v2",
        searchStoreRowCount: 3,
        ftsRowCount: 3,
        previewSpanCount: 3,
      },
      {
        coordinatorDir,
        ownerId: "owner-pointer",
        now: new Date("2026-05-09T00:02:00.000Z"),
      },
    );

    assert.equal(second.status, "committed");
    assert.equal(second.active.sourceMetadataVersion, "meta-v2");
    assert.equal(second.active.previous.state, "stale");
    assert.equal(second.active.previous.sourceMetadataVersion, "meta-v1");

    const events = await module.readRelayDocumentSearchIndexHealthEvents({ coordinatorDir }, 10);
    assert.deepEqual(events.map((event) => event.kind), [
      "content_index_committed",
      "content_index_commit_failed",
      "content_index_committed",
    ]);
  } finally {
    cleanup();
    rmSync(coordinatorDir, { recursive: true, force: true });
  }
});
