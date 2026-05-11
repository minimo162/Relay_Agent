import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const storePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchJobStore.ts",
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

async function loadJobStoreModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-job-store-module-"));
  writeFileSync(
    resolve(dir, "relayDocumentSearchJobStore.mjs"),
    transpile(storePath).replace(
      "from './relayDocumentSearchJobLifecycle';",
      "from './relayDocumentSearchJobLifecycle.mjs';",
    ),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchJobStore.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: "RelayDocumentSearchJobLifecycle.v1",
    jobId: "job-store",
    queryId: "query-store",
    requestFingerprint: "fingerprint-a",
    lifecycle: "running",
    cancellable: true,
    retryToken: "job-store:retry",
    progress: { stage: "running", percent: 10, scannedFiles: 1, skippedFiles: 0 },
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    ...overrides,
  };
}

test("Relay document search job store persists and finds active snapshots by fingerprint", async () => {
  const storeDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-job-store-"));
  const { module, cleanup } = await loadJobStoreModule();
  try {
    module.writeRelayDocumentSearchJobSnapshot(snapshot(), { jobStoreDir: storeDir });

    const read = module.readRelayDocumentSearchJobSnapshot("job-store", { jobStoreDir: storeDir });
    assert.equal(read.jobId, "job-store");

    const active = module.findActiveRelayDocumentSearchJobByFingerprint("fingerprint-a", {
      jobStoreDir: storeDir,
      jobStoreActiveStaleMs: 60000,
      now: new Date("2026-05-09T00:00:10.000Z"),
    });
    assert.equal(active.jobId, "job-store");
  } finally {
    cleanup();
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("Relay document search job store marks stale active jobs abandoned", async () => {
  const storeDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-job-store-stale-"));
  const { module, cleanup } = await loadJobStoreModule();
  try {
    module.writeRelayDocumentSearchJobSnapshot(snapshot(), { jobStoreDir: storeDir });

    const active = module.findActiveRelayDocumentSearchJobByFingerprint("fingerprint-a", {
      jobStoreDir: storeDir,
      jobStoreActiveStaleMs: 1000,
      now: new Date("2026-05-09T00:05:00.000Z"),
    });
    assert.equal(active, undefined);

    const recovered = module.readRelayDocumentSearchJobSnapshot("job-store", { jobStoreDir: storeDir });
    assert.equal(recovered.lifecycle, "partial");
    assert.equal(recovered.cancellable, false);
    assert.equal(recovered.progress.stage, "abandoned");

    const recovery = module.recoverRelayDocumentSearchJobStore({
      jobStoreDir: storeDir,
      jobStoreActiveStaleMs: 1000,
      now: new Date("2026-05-09T00:10:00.000Z"),
    });
    assert.equal(recovery.schemaVersion, "RelayDocumentSearchJobStore.v1");
    assert.equal(recovery.abandoned.length, 0);
  } finally {
    cleanup();
    rmSync(storeDir, { recursive: true, force: true });
  }
});
