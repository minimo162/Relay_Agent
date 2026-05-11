import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const executorPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchExecutor.ts",
);
const metadataCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMetadataCache.ts",
);
const filenameIndexPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFilenameIndex.ts",
);
const indexCoordinatorPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexCoordinator.ts",
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
const indexDbPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexDb.ts",
);
const queryPlanPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryPlan.ts",
);
const indexReportPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexReport.ts",
);
const resultGroupingPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchResultGrouping.ts",
);
const productResultPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchProductResult.ts",
);
const folderRolesPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFolderRoles.ts",
);
const userMemoryPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchUserMemory.ts",
);
const qualityGatesPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQualityGates.ts",
);
const queryTracePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryTrace.ts",
);
const evidenceRedactionPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchEvidenceRedaction.ts",
);
const polishRequestPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchPolishRequest.ts",
);
const polishProviderPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchPolishProvider.ts",
);
const evidencePackPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchEvidencePack.ts",
);
const localDraftPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchLocalDraft.ts",
);
const polishValidationPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchPolishValidation.ts",
);
const answerPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchAnswer.ts",
);
const copilotStatePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchCopilotState.ts",
);
const freshnessPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFreshness.ts",
);
const syncJournalPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchSyncJournal.ts",
);
const failureRegistryPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFailureRegistry.ts",
);
const schedulerReportPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchSchedulerReport.ts",
);
const jobStorePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchJobStore.ts",
);
const jobLifecyclePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchJobLifecycle.ts",
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

async function loadJobLifecycleModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-job-lifecycle-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchMetadataCache.mjs"), transpile(metadataCachePath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchFilenameIndex.mjs"),
    transpile(filenameIndexPath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchIndexCoordinator.mjs"), transpile(indexCoordinatorPath), "utf8");
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
  writeFileSync(resolve(dir, "relayDocumentSearchQueryPlan.mjs"), transpile(queryPlanPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchDerivedContentIndex.mjs"),
    transpile(derivedContentIndexPath)
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';")
      .replace("from './relayParsedDocumentIr';", "from './relayParsedDocumentIr.mjs';"),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchIndexDb.mjs"), transpile(indexDbPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchIndexReport.mjs"),
    transpile(indexReportPath)
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchResultGrouping.mjs"),
    transpile(resultGroupingPath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchProductResult.mjs"),
    transpile(productResultPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchFolderRoles.mjs"), transpile(folderRolesPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchUserMemory.mjs"),
    transpile(userMemoryPath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchQualityGates.mjs"), transpile(qualityGatesPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchQueryTrace.mjs"), transpile(queryTracePath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchEvidenceRedaction.mjs"), transpile(evidenceRedactionPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchPolishRequest.mjs"),
    transpile(polishRequestPath)
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchPolishValidation';", "from './relayDocumentSearchPolishValidation.mjs';"),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchPolishProvider.mjs"), transpile(polishProviderPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchEvidencePack.mjs"),
    transpile(evidencePackPath)
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchLocalDraft.mjs"), transpile(localDraftPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchPolishValidation.mjs"),
    transpile(polishValidationPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  writeFileSync(resolve(dir, "relayDocumentSearchAnswer.mjs"), transpile(answerPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchCopilotState.mjs"), transpile(copilotStatePath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchFreshness.mjs"), transpile(freshnessPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchSyncJournal.mjs"), transpile(syncJournalPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchFailureRegistry.mjs"), transpile(failureRegistryPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchSchedulerReport.mjs"), transpile(schedulerReportPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchJobStore.mjs"),
    transpile(jobStorePath).replace(
      "from './relayDocumentSearchJobLifecycle';",
      "from './relayDocumentSearchJobLifecycle.mjs';",
    ),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchExecutor.mjs"),
    transpile(executorPath)
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchFilenameIndex';", "from './relayDocumentSearchFilenameIndex.mjs';")
      .replace("from './relayDocumentSearchIndexCoordinator';", "from './relayDocumentSearchIndexCoordinator.mjs';")
      .replace("from './relayParsedDocumentCache';", "from './relayParsedDocumentCache.mjs';")
      .replace("from './relayParsedDocumentIr';", "from './relayParsedDocumentIr.mjs';")
      .replace("from './relayDocumentSearchDerivedContentIndex';", "from './relayDocumentSearchDerivedContentIndex.mjs';")
      .replace("from './relayDocumentSearchIndexDb';", "from './relayDocumentSearchIndexDb.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';")
      .replace("from './relayDocumentSearchIndexReport';", "from './relayDocumentSearchIndexReport.mjs';")
      .replace("from './relayDocumentSearchResultGrouping';", "from './relayDocumentSearchResultGrouping.mjs';")
      .replace("from './relayDocumentSearchProductResult';", "from './relayDocumentSearchProductResult.mjs';")
      .replace("from './relayDocumentSearchFolderRoles';", "from './relayDocumentSearchFolderRoles.mjs';")
      .replace("from './relayDocumentSearchUserMemory';", "from './relayDocumentSearchUserMemory.mjs';")
      .replace("from './relayDocumentSearchEvidenceRedaction';", "from './relayDocumentSearchEvidenceRedaction.mjs';")
      .replace("from './relayDocumentSearchPolishRequest';", "from './relayDocumentSearchPolishRequest.mjs';")
      .replace("from './relayDocumentSearchPolishProvider';", "from './relayDocumentSearchPolishProvider.mjs';")
      .replace("from './relayDocumentSearchEvidencePack';", "from './relayDocumentSearchEvidencePack.mjs';")
      .replace("from './relayDocumentSearchLocalDraft';", "from './relayDocumentSearchLocalDraft.mjs';")
      .replace("from './relayDocumentSearchPolishValidation';", "from './relayDocumentSearchPolishValidation.mjs';")
      .replace("from './relayDocumentSearchCopilotState';", "from './relayDocumentSearchCopilotState.mjs';")
      .replace("from './relayDocumentSearchFreshness';", "from './relayDocumentSearchFreshness.mjs';")
      .replace("from './relayDocumentSearchAnswer';", "from './relayDocumentSearchAnswer.mjs';")
      .replace("from './relayDocumentSearchQualityGates';", "from './relayDocumentSearchQualityGates.mjs';")
      .replace("from './relayDocumentSearchQueryTrace';", "from './relayDocumentSearchQueryTrace.mjs';")
      .replace("from './relayDocumentSearchSyncJournal';", "from './relayDocumentSearchSyncJournal.mjs';")
      .replace("from './relayDocumentSearchFailureRegistry';", "from './relayDocumentSearchFailureRegistry.mjs';")
      .replace("from './relayDocumentSearchSchedulerReport';", "from './relayDocumentSearchSchedulerReport.mjs';"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchJobLifecycle.mjs"),
    transpile(jobLifecyclePath)
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchExecutor';", "from './relayDocumentSearchExecutor.mjs';")
      .replace("from './relayDocumentSearchEvidencePack';", "from './relayDocumentSearchEvidencePack.mjs';")
      .replace("from './relayDocumentSearchJobStore';", "from './relayDocumentSearchJobStore.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchJobLifecycle.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function okResult(jobId, queryId, progress = { stage: "filename_candidates", percent: 100, scannedFiles: 3, skippedFiles: 0 }) {
  return {
    schemaVersion: "RelayDocumentSearchResult.v1",
    status: "ok",
    progress,
    job: { jobId, lifecycle: "completed", cancellable: false },
    correlation: { relayJobId: jobId, queryId },
    queryPlan: {},
    coverage: { searchedRoots: ["/workspace"], incompleteRoots: [] },
    results: [],
    evidencePack: { evidence: [], warnings: [] },
    display: { beginnerSummary: "検索が完了しました。", emptyStateGuidance: [] },
    diagnostics: {},
  };
}

test("Relay document search job lifecycle wraps runner progress and terminal metadata", async () => {
  const { module, cleanup } = await loadJobLifecycleModule();
  try {
    const registry = new module.RelayDocumentSearchJobRegistry();
    const progressSeen = [];
    const result = await module.runRelayDocumentSearchJob(
      { query: "キャッシュフロー", roots: ["/workspace"] },
      {
        jobRegistry: registry,
        jobId: "job-life",
        queryId: "query-life",
        now: new Date("2026-05-09T00:00:00.000Z"),
        onProgress: (progress) => progressSeen.push(progress),
      },
      async (_rawRequest, options) => {
        options.onProgress?.({ stage: "metadata_scan", percent: 30, scannedFiles: 2, skippedFiles: 1 });
        return okResult(options.jobId, options.queryId);
      },
    );

    assert.equal(result.job.jobId, "job-life");
    assert.equal(result.job.lifecycle, "completed");
    assert.equal(result.job.retryToken, "job-life:retry");
    assert.equal(result.correlation.relayJobId, "job-life");
    assert.equal(result.correlation.queryId, "query-life");
    assert.equal(result.diagnostics.jobLifecycle, "RelayDocumentSearchJobLifecycle.v1");
    assert.equal(result.diagnostics.retryToken, "job-life:retry");
    assert.deepEqual(progressSeen, [{ stage: "metadata_scan", percent: 30, scannedFiles: 2, skippedFiles: 1 }]);

    const snapshot = registry.get("job-life");
    assert.equal(snapshot.lifecycle, "completed");
    assert.equal(snapshot.cancellable, false);
    assert.equal(snapshot.progress.stage, "filename_candidates");
  } finally {
    cleanup();
  }
});

test("Relay document search job lifecycle attaches duplicate submits to the active job", async () => {
  const { module, cleanup } = await loadJobLifecycleModule();
  try {
    const registry = new module.RelayDocumentSearchJobRegistry();
    let runnerCount = 0;
    let releaseRunner;
    const request = { query: "連結CFS", roots: ["/workspace"] };

    const first = module.runRelayDocumentSearchJob(
      request,
      { jobRegistry: registry, jobId: "job-duplicate", queryId: "query-first" },
      async (_rawRequest, options) => {
        runnerCount += 1;
        await new Promise((resolve) => {
          releaseRunner = resolve;
        });
        return okResult(options.jobId, options.queryId);
      },
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runnerCount, 1);

    const duplicate = await module.runRelayDocumentSearchJob(
      request,
      { jobRegistry: registry, queryId: "query-second" },
      async () => {
        runnerCount += 1;
        throw new Error("duplicate must not start a second runner");
      },
    );

    assert.equal(runnerCount, 1);
    assert.equal(duplicate.status, "partial");
    assert.equal(duplicate.job.jobId, "job-duplicate");
    assert.equal(duplicate.job.lifecycle, "running");
    assert.match(duplicate.job.duplicateSubmitCorrelationId, /^dup-/);
    assert.equal(duplicate.evidencePack.warnings[0].code, "duplicate_submit_attached");
    assert.equal(duplicate.coverage.duplicateSubmit, true);

    releaseRunner();
    const firstResult = await first;
    assert.equal(firstResult.job.lifecycle, "completed");
  } finally {
    cleanup();
  }
});

test("Relay document search job lifecycle attaches duplicate submits from the durable job store", async () => {
  const storeDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-lifecycle-store-"));
  const { module, cleanup } = await loadJobLifecycleModule();
  try {
    const firstRegistry = new module.RelayDocumentSearchJobRegistry();
    const secondRegistry = new module.RelayDocumentSearchJobRegistry();
    let firstRelease;
    let secondRunnerCount = 0;
    const request = { query: "連結CFS", roots: ["/workspace"] };

    const first = module.runRelayDocumentSearchJob(
      request,
      {
        jobRegistry: firstRegistry,
        jobId: "job-store-duplicate",
        queryId: "query-store-first",
        useJobStore: true,
        jobStoreDir: storeDir,
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
      async (_rawRequest, options) => {
        await new Promise((resolve) => {
          firstRelease = resolve;
        });
        return okResult(options.jobId, options.queryId);
      },
    );

    await new Promise((resolve) => setImmediate(resolve));

    const duplicate = await module.runRelayDocumentSearchJob(
      request,
      {
        jobRegistry: secondRegistry,
        queryId: "query-store-second",
        useJobStore: true,
        jobStoreDir: storeDir,
        jobStoreActiveStaleMs: 60000,
        now: new Date("2026-05-09T00:00:10.000Z"),
      },
      async () => {
        secondRunnerCount += 1;
        throw new Error("durable duplicate must not start a second runner");
      },
    );

    assert.equal(secondRunnerCount, 0);
    assert.equal(duplicate.status, "partial");
    assert.equal(duplicate.job.jobId, "job-store-duplicate");
    assert.equal(duplicate.diagnostics.duplicateSubmitSource, "job_store");
    assert.equal(duplicate.diagnostics.jobStoreAttached, true);

    firstRelease();
    const firstResult = await first;
    assert.equal(firstResult.job.lifecycle, "completed");
  } finally {
    cleanup();
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("Relay document search job lifecycle abandons stale durable jobs before starting a new scan", async () => {
  const storeDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-lifecycle-stale-store-"));
  const { module, cleanup } = await loadJobLifecycleModule();
  try {
    const staleRegistry = new module.RelayDocumentSearchJobRegistry();
    const freshRegistry = new module.RelayDocumentSearchJobRegistry();
    const request = { query: "連結CFS", roots: ["/workspace"] };

    staleRegistry.begin(request, {
      jobId: "job-stale-store",
      queryId: "query-stale",
      useJobStore: true,
      jobStoreDir: storeDir,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });
    staleRegistry.markRunning("job-stale-store", {
      useJobStore: true,
      jobStoreDir: storeDir,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });

    let runnerCount = 0;
    const result = await module.runRelayDocumentSearchJob(
      request,
      {
        jobRegistry: freshRegistry,
        jobId: "job-after-stale",
        queryId: "query-after-stale",
        useJobStore: true,
        jobStoreDir: storeDir,
        jobStoreActiveStaleMs: 1000,
        now: new Date("2026-05-09T00:05:00.000Z"),
      },
      async (_rawRequest, options) => {
        runnerCount += 1;
        return okResult(options.jobId, options.queryId);
      },
    );

    assert.equal(runnerCount, 1);
    assert.equal(result.job.jobId, "job-after-stale");
    const staleSnapshot = JSON.parse(
      readFileSync(resolve(storeDir, `${encodeURIComponent("job-stale-store")}.json`), "utf8"),
    );
    assert.equal(staleSnapshot.lifecycle, "partial");
    assert.equal(staleSnapshot.progress.stage, "abandoned");
  } finally {
    cleanup();
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("Relay document search job lifecycle propagates cancellation into the runner", async () => {
  const { module, cleanup } = await loadJobLifecycleModule();
  try {
    const registry = new module.RelayDocumentSearchJobRegistry();
    const run = module.runRelayDocumentSearchJob(
      { query: "資料", roots: ["/workspace"] },
      { jobRegistry: registry, jobId: "job-cancel", queryId: "query-cancel" },
      async (_rawRequest, options) => {
        await new Promise((resolve) => {
          options.signal.addEventListener("abort", resolve, { once: true });
        });
        return {
          ...okResult(options.jobId, options.queryId, {
            stage: "cancelled",
            percent: 100,
            scannedFiles: 10,
            skippedFiles: 0,
          }),
          status: "partial",
          job: {
            jobId: options.jobId,
            lifecycle: "cancelled",
            cancellable: false,
            retryToken: `${options.jobId}:retry`,
          },
          display: {
            beginnerSummary: "検索をキャンセルしました。",
            emptyStateGuidance: [],
          },
        };
      },
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(registry.requestCancel("job-cancel"), true);

    const result = await run;
    assert.equal(result.status, "partial");
    assert.equal(result.job.lifecycle, "cancelled");
    assert.equal(result.job.retryToken, "job-cancel:retry");
    assert.equal(result.progress.stage, "cancelled");
    assert.equal(registry.get("job-cancel").lifecycle, "cancelled");
  } finally {
    cleanup();
  }
});
