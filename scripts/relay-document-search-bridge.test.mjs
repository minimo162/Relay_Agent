import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
const bridgePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchBridge.ts",
);
const displayPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchDisplay.ts",
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

async function loadBridgeModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-bridge-module-"));
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
  writeFileSync(
    resolve(dir, "relayDocumentSearchDisplay.mjs"),
    transpile(displayPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchBridge.mjs"),
    transpile(bridgePath)
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchEvidencePack';", "from './relayDocumentSearchEvidencePack.mjs';")
      .replace("from './relayDocumentSearchDisplay';", "from './relayDocumentSearchDisplay.mjs';")
      .replace("from './relayDocumentSearchJobLifecycle';", "from './relayDocumentSearchJobLifecycle.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchBridge.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("Relay document search bridge exposes a contract-bound tool definition", async () => {
  const { module, cleanup } = await loadBridgeModule();
  try {
    const definition = module.relayDocumentSearchBridgeToolDefinition;
    assert.equal(definition.function.name, "relay_document_search");
    assert.equal(definition.requestContract, "RelayDocumentSearchRequest.v1");
    assert.equal(definition.resultContract, "RelayDocumentSearchResult.v1");
    assert.equal(definition.displayContract, "RelayDocumentSearchDisplay.v1");
    assert.equal(definition.resultFlowContract, "RelayDocumentSearchResultFlow.v1");
    assert.equal(definition.aionuiResultFlowContract, "RelayDocumentSearchAionUiResultFlow.v1");
    assert.equal(definition.jobContract, "RelayDocumentSearchJob.v1");
    assert.equal(definition.jobLifecycleContract, "RelayDocumentSearchJobLifecycle.v1");
    assert.equal(definition.backgroundSchedulerContract, "RelayDocumentSearchBackgroundScheduler.v1");
    assert.equal(definition.syncProducerContract, "RelayDocumentSearchSyncProducer.v1");
    assert.equal(definition.bridgeModule, "src/process/utils/relayDocumentSearchBridge.ts");
    assert.equal(definition.jobLifecycleModule, "src/process/utils/relayDocumentSearchJobLifecycle.ts");
    assert.equal(
      definition.backgroundSchedulerModule,
      "src/process/utils/relayDocumentSearchBackgroundScheduler.ts",
    );
    assert.equal(definition.syncProducerModule, "src/process/utils/relayDocumentSearchSyncProducer.ts");
    assert.equal(definition.jobLifecycleRunnerExport, "runRelayDocumentSearchJob");
    assert.equal(definition.backgroundSchedulerClassExport, "RelayDocumentSearchBackgroundScheduler");
    assert.equal(definition.syncProducerStartExport, "startRelayDocumentSearchSyncProducer");
    assert.equal(definition.handlerExport, "handleRelayDocumentSearchToolCall");
    assert.equal(definition.displayAdapterExport, "relayDocumentSearchResultToDisplayModel");
    assert.equal(definition.aionuiResultFlowExport, "relayDocumentSearchExecutionToAionUiResultFlow");
    assert.deepEqual(definition.resultFlowPolicy, {
      rendererOwner: "AionUi",
      structuredResultCardsPrimary: true,
      copilotProseSecondary: true,
      continuationAction: "show-more-results",
      stableSelectionKeyField: "ui_state.stableSelectionKey",
    });
  } finally {
    cleanup();
  }
});

test("Relay document search bridge executes exact OpenAI tool calls", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-bridge-workspace-"));
  mkdirSync(resolve(workspace, "finance"), { recursive: true });
  writeFileSync(resolve(workspace, "finance", "FY160-1Q_連結CFS精算表.xlsx"), "candidate", "utf8");

  const { module, cleanup } = await loadBridgeModule();
  try {
    const execution = await module.handleRelayDocumentSearchToolCall(
      {
        id: "call-search",
        function: {
          name: "relay_document_search",
          arguments: JSON.stringify({
            query: "キャッシュフロー 精算表",
            roots: [workspace],
            fileTypes: ["xlsx"],
          }),
        },
      },
      {
        jobId: "job-bridge",
        queryId: "query-bridge",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(execution.ok, true);
    assert.equal(execution.toolCallId, "call-search");
    assert.equal(execution.result.schemaVersion, "RelayDocumentSearchResult.v1");
    assert.equal(execution.result.job.jobId, "job-bridge");
    assert.equal(execution.display.schemaVersion, "RelayDocumentSearchDisplay.v1");
    assert.equal(execution.display.resultFlow.schemaVersion, "RelayDocumentSearchResultFlow.v1");
    assert.equal(execution.display.resultFlow.structuredResultCardsPrimary, true);
    assert.equal(execution.display.resultFlow.copilotProseSecondary, true);
    assert.equal(execution.aionuiResultFlow.schemaVersion, "RelayDocumentSearchAionUiResultFlow.v1");
    assert.equal(execution.aionuiResultFlow.result.schemaVersion, "RelayDocumentSearchResult.v1");
    assert.equal(execution.aionuiResultFlow.display.schemaVersion, "RelayDocumentSearchDisplay.v1");
    assert.equal(execution.aionuiResultFlow.presentation.structuredResultCardsPrimary, true);
    assert.equal(execution.aionuiResultFlow.presentation.copilotProseSecondary, true);
    assert.match(execution.content, /FY160-1Q_連結CFS精算表\.xlsx/);
    assert.match(execution.aionuiContent, /RelayDocumentSearchAionUiResultFlow\.v1/);
    assert.match(execution.aionuiContent, /RelayDocumentSearchDisplay\.v1/);

    const toolMessage = module.relayDocumentSearchExecutionToOpenAiToolMessage(execution);
    assert.deepEqual(toolMessage, {
      role: "tool",
      tool_call_id: "call-search",
      name: "relay_document_search",
      content: execution.content,
    });
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Relay document search bridge accepts aliases only from contract-bound advertised tools", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-bridge-alias-"));
  writeFileSync(resolve(workspace, "XSA_連結CF.xlsx"), "candidate", "utf8");

  const { module, cleanup } = await loadBridgeModule();
  try {
    const rejected = await module.handleRelayDocumentSearchToolCall({
      id: "call-untrusted",
      name: "workspace-search",
      parameters: {
        query: "連結CF",
        roots: [workspace],
      },
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.result.status, "failed");
    assert.equal(rejected.result.diagnostics.code, "untrusted_tool_alias");

    const accepted = await module.handleRelayDocumentSearchToolCall(
      {
        id: "call-trusted",
        name: "workspace-search",
        parameters: {
          query: "連結CF",
          roots: [workspace],
        },
      },
      {
        advertisedTools: [
          {
            name: "workspace-search",
            resultContract: "RelayDocumentSearchResult.v1",
          },
        ],
      },
    );
    assert.equal(accepted.ok, true);
    assert.equal(accepted.result.results[0].display_name, "XSA_連結CF.xlsx");
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("Relay document search bridge reports invalid JSON without fallback execution", async () => {
  const { module, cleanup } = await loadBridgeModule();
  try {
    const execution = await module.handleRelayDocumentSearchToolCall({
      id: "call-bad-json",
      function: {
        name: "relay_document_search",
        arguments: "{\"query\":",
      },
    });

    assert.equal(execution.ok, false);
    assert.equal(execution.result.status, "failed");
    assert.equal(execution.result.progress.stage, "bridge_rejected");
    assert.equal(execution.result.diagnostics.code, "invalid_tool_arguments");
    assert.match(execution.result.evidencePack.warnings[0].message, /valid JSON/);
  } finally {
    cleanup();
  }
});
