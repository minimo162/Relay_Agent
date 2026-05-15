import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, utimesSync } from "node:fs";
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

async function loadExecutorModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-executor-module-"));
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
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchExecutor.mjs")).href),
      failureRegistryModule: await import(pathToFileURL(resolve(dir, "relayDocumentSearchFailureRegistry.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function stableIdForTest(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `file-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function sourceMetadataVersionForTest(path) {
  const info = statSync(path);
  return `${stableIdForTest(path)}:${info.size}:${Math.trunc(info.mtimeMs)}`;
}

function createFakeSqliteModule(options = {}) {
  const calls = [];
  const contentRows = [...(options.contentRows ?? [])];
  const tableRows = [...(options.tableRows ?? [])];
  const failSearch = Boolean(options.failSearch);
  const ignoreInsertedFtsRows = Boolean(options.ignoreInsertedFtsRows);

  class FakeDatabaseSync {
    exec(sql) {
      calls.push({ kind: "exec", sql });
    }

    prepare(sql) {
      calls.push({ kind: "prepare", sql });
      return {
        run: (...params) => {
          calls.push({ kind: "run", sql, params });
          if (!ignoreInsertedFtsRows && /INSERT INTO content_nodes_fts/.test(sql)) {
            contentRows.push({ file_id: params[0], entry_id: params[1], text: params[2] });
          }
          if (!ignoreInsertedFtsRows && /INSERT INTO table_cells_fts/.test(sql)) {
            tableRows.push({ file_id: params[0], entry_id: params[1], text: params[3] });
          }
        },
        all: (...params) => {
          calls.push({ kind: "all", sql, params });
          if (failSearch && /FROM (content_nodes_fts|table_cells_fts)/.test(sql)) {
            throw new Error("forced sqlite fts search failure");
          }
          if (/FROM content_nodes_fts/.test(sql)) return contentRows;
          if (/FROM table_cells_fts/.test(sql)) return tableRows;
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
    sqliteModule: { DatabaseSync: FakeDatabaseSync },
  };
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function minimalXlsx(entries = {}) {
  return createStoredZip({
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="CFS" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/sharedStrings.xml":
      '<sst><si><t>キャッシュフロー計算書</t></si><si><t>精算表</t></si></sst>',
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>SUM(C1:C2)</f><v>100</v></c></row></sheetData></worksheet>',
    ...entries,
  });
}

function metadataCachePathForRoot(root, cacheDir) {
  const hash = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24);
  return resolve(cacheDir, `${hash}.json`);
}

function writeMetadataCacheFixture(root, cacheDir, files, generatedAt = "2026-05-10T00:00:00.000Z") {
  writeFileSync(
    metadataCachePathForRoot(root, cacheDir),
    `${JSON.stringify({
      schemaVersion: "RelayDocumentSearchMetadataCache.v1",
      cacheVersion: 1,
      root: resolve(root),
      generatedAt,
      files,
      stats: {
        fileCount: files.length,
        truncated: false,
        inaccessiblePathCount: 0,
      },
    })}\n`,
    "utf8",
  );
}

test("executeRelayDocumentSearch returns filename-only candidates without parsing documents", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-workspace-"));
  const financeDir = resolve(workspace, "160連結", "160期-1Q", "作業");
  mkdirSync(financeDir, { recursive: true });
  writeFileSync(resolve(financeDir, "FY160-1Q_連結CFS精算表.xlsx"), "not a real xlsx; filename candidate only", "utf8");
  writeFileSync(resolve(financeDir, "XSA_連結CF.xlsx"), "not a real xlsx; filename candidate only", "utf8");
  mkdirSync(resolve(workspace, "node_modules"), { recursive: true });
  writeFileSync(resolve(workspace, "node_modules", "ignored-cfs.xlsx"), "ignored", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー CFS 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
        maxResults: 10,
        evidence: "candidate",
      },
      {
        jobId: "job-test",
        queryId: "query-test",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.schemaVersion, "RelayDocumentSearchResult.v1");
    assert.equal(result.status, "ok");
    assert.equal(result.job.jobId, "job-test");
    assert.equal(result.correlation.queryId, "query-test");
    assert.ok(result.progress.scannedFiles >= 2);
    assert.equal(result.results[0].evidence_state, "filename_only");
    assert.equal(result.results[0].index_state, "metadata_indexed");
    assert.equal(result.results[0].primary_source_index, "filename_index");
    assert.equal(result.results[0].source_indexes.some((sourceIndex) => sourceIndex.kind === "filename_index"), true);
    assert.match(result.display.beginnerSummary, /ファイル名とパスから候補/);
    assert.equal(result.diagnostics.fileMetadataOnly, true);
    assert.equal(result.diagnostics.documentMetadataParsed, false);
    assert.equal(result.diagnostics.noDuplicateDedocScan, true);
    assert.equal(result.diagnostics.quality.schemaVersion, "RelayDocumentSearchQuality.v1");
    assert.equal(result.diagnostics.quality.answerPolicy, "candidate_only");
    assert.equal(result.diagnostics.quality.canAskCopilotForFinalAnswer, false);
    assert.equal(result.localDraft.schemaVersion, "RelayDocumentSearchLocalDraft.v1");
    assert.equal(result.localDraft.answer_policy, "candidate_only");
    assert.equal(result.localDraft.citation_policy, "candidate_language_only");
    assert.equal(result.localDraft.can_replace_with_copilot_polish, false);
    assert.match(result.localDraft.summary, /ファイル名・パスの候補/);
    assert.equal(result.localDraft.validation.evidenceItemCount, 0);
    assert.equal(result.diagnostics.localDraft.localDraftId, result.localDraft.local_draft_id);
    assert.equal(result.diagnostics.polishValidation.schemaVersion, "RelayDocumentSearchPolishValidation.v1");
    assert.equal(result.diagnostics.polishValidation.state, "polish_skipped");
    assert.equal(
      result.diagnostics.polishValidation.prompt_template_ids.answerPolish,
      "relay_answer_polish_prompt.v1",
    );
    assert.equal(result.diagnostics.polishValidation.correlation.relayJobId, "job-test");
    assert.equal(result.diagnostics.polishValidation.correlation.queryId, "query-test");
    assert.equal(result.diagnostics.copilotState.schemaVersion, "RelayDocumentSearchCopilotState.v1");
    assert.equal(result.diagnostics.copilotState.state, "polish_skipped");
    assert.equal(result.diagnostics.copilotState.local_search_blocked, false);
    assert.equal(result.diagnostics.copilotState.should_wait_for_copilot, false);
    assert.equal(result.diagnostics.evidenceRedaction.schemaVersion, "RelayDocumentSearchEvidenceRedaction.v1");
    assert.equal(result.diagnostics.evidenceRedaction.policy, "local_only");
    assert.equal(result.diagnostics.evidenceRedaction.canSendToCopilot, false);
    assert.equal(result.diagnostics.queryTrace.schemaVersion, "RelayDocumentSearchQueryTrace.v1");
    assert.equal(result.diagnostics.queryTrace.plannerOwner, "relay");
    assert.equal(result.diagnostics.queryTrace.copilotRole, "optional_language_only");
    assert.equal(result.diagnostics.indexReport.schemaVersion, "RelayDocumentSearchIndexReport.v1");
    assert.equal(result.diagnostics.indexReport.summary.filenameSearchableFiles, 2);
    assert.equal(result.diagnostics.indexReport.roots[0].cache.filenameIndex, "disabled");
    assert.equal(
      result.diagnostics.queryTrace.stages.find((stage) => stage.name === "quality_gate").facts.answerPolicy,
      "candidate_only",
    );
    assert.ok(!result.results.some((candidate) => String(candidate.path).includes("node_modules")));
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch excludes folder-role-only files from compound parts-sales results", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-parts-sales-"));
  const baseDir = resolve(workspace, "160期-1Q", "連結決算", "08未実現利益-棚卸資産", "2_実績データ");
  mkdirSync(resolve(baseDir, "1_原価"), { recursive: true });
  mkdirSync(resolve(baseDir, "2_国内DL・部販"), { recursive: true });
  writeFileSync(
    resolve(baseDir, "1_原価", "301 自動車・部品他売上総利益(easyGKAJ)_160_1Q.xlsx"),
    "placeholder",
    "utf8",
  );
  writeFileSync(
    resolve(baseDir, "2_国内DL・部販", "FY160-1Q_販社・パーツ残高_DBLink.xlsx"),
    "placeholder",
    "utf8",
  );
  writeFileSync(
    resolve(baseDir, "1_原価", "302 自動車国別月別売上総利益(easyG009U)_160_1Q.xlsx"),
    "placeholder",
    "utf8",
  );

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "部品売上に関するファイルを探して",
        roots: [workspace],
        fileTypes: ["xlsx"],
        intent: "find_files",
        thoroughness: "thorough",
        evidence: "candidate",
        maxResults: 10,
      },
      {
        jobId: "job-parts-sales",
        queryId: "query-parts-sales",
        now: new Date("2026-05-09T00:00:00.000Z"),
        useIndexDb: false,
      },
    );

    const names = result.results.map((candidate) => candidate.display_name);
    assert.equal(result.status, "ok");
    assert.deepEqual(names, [
      "301 自動車・部品他売上総利益(easyGKAJ)_160_1Q.xlsx",
      "FY160-1Q_販社・パーツ残高_DBLink.xlsx",
    ]);
    assert.equal(names.some((name) => name.includes("302 自動車国別月別売上総利益")), false);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch keeps quick candidate searches out of content scan", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-quick-candidate-"));
  mkdirSync(workspace, { recursive: true });
  writeFileSync(resolve(workspace, "FY160-1Q_連結CFS精算表.txt"), "キャッシュフロー本文にも一致", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー CFS 精算表",
        roots: [workspace],
        fileTypes: ["txt"],
        intent: "find_files",
        thoroughness: "quick",
        evidence: "candidate",
        maxResults: 10,
      },
      {
        jobId: "job-quick-candidate",
        queryId: "query-quick-candidate",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.progress.stage, "filename_candidates");
    assert.equal(result.results[0].evidence_state, "filename_only");
    assert.equal(result.diagnostics.fileMetadataOnly, true);
    assert.equal(result.diagnostics.textContentScanned, 0);
    assert.equal(result.diagnostics.contentEvidenceGenerated, 0);
    assert.equal(result.evidencePack.coverage.contentScannedFiles, 0);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch keeps unparseable Office evidence requests as explicit partial candidates", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-office-candidate-"));
  const failureRegistryDir = resolve(workspace, ".relay-failures");
  writeFileSync(resolve(workspace, "FY160-1Q_連結CFS精算表.xlsx"), "placeholder", "utf8");

  const { module, failureRegistryModule, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
        intent: "answer_with_evidence",
        evidence: "required",
      },
      {
        jobId: "job-office-partial",
        queryId: "query-office-partial",
        failureRegistryDir,
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "partial");
    assert.equal(result.progress.stage, "partial_filename_candidates");
    assert.equal(result.results[0].evidence_state, "filename_only");
    assert.deepEqual(result.results[0].warnings, ["filename_only", "content_not_confirmed"]);
    assert.ok(result.evidencePack.warnings.some((warning) => warning.code === "content_not_confirmed"));
    assert.match(result.display.beginnerSummary, /中身まで確認できない候補/);
    assert.equal(result.diagnostics.contentNotConfirmedCount, 1);
    assert.equal(result.diagnostics.contentRequiredButUnconfirmed, true);
    assert.equal(result.queryPlan.readerCapabilities.xlsx.text, true);
    assert.equal(result.queryPlan.readerCapabilities.xlsx.cellAnchors, true);
    const failureRegistry = await failureRegistryModule.readRelayDocumentSearchFailureRegistry({
      failureRegistryDir,
    });
    assert.equal(failureRegistry.failures.length, 1);
    assert.equal(failureRegistry.failures[0].root, workspace);
    assert.equal(failureRegistry.failures[0].kind, "parser");
    assert.equal(failureRegistry.failures[0].code, "office_openxml_reader_failed");
    assert.equal(failureRegistry.failures[0].source, "relay-office-openxml");
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch treats cached access denial as stale unavailable evidence", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-access-denied-"));
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-access-cache-"));
  const deniedPath = resolve(workspace, "FY160-1Q_連結CFS精算表.xlsx");
  writeMetadataCacheFixture(workspace, cacheDir, [
    {
      fileId: "file-denied",
      root: resolve(workspace),
      path: deniedPath,
      displayPath: "FY160-1Q_連結CFS精算表.xlsx",
      name: "FY160-1Q_連結CFS精算表.xlsx",
      extension: "xlsx",
      size: 128,
      modifiedTime: "2026-05-10T00:00:00.000Z",
      sourceMetadataVersion: "file-denied:128:1",
      accessSnapshots: {
        metadata: { action: "metadata", state: "ok", checkedAt: "2026-05-10T00:00:00.000Z" },
        content: {
          action: "content",
          state: "access_denied",
          checkedAt: "2026-05-10T00:00:00.000Z",
          warningCode: "access_denied",
        },
        preview: {
          action: "preview",
          state: "access_denied",
          checkedAt: "2026-05-10T00:00:00.000Z",
          warningCode: "preview_denied",
        },
        open: {
          action: "open",
          state: "access_denied",
          checkedAt: "2026-05-10T00:00:00.000Z",
          warningCode: "open_denied",
        },
      },
    },
  ]);

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "連結CFS 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
        intent: "answer_with_evidence",
        evidence: "required",
      },
      {
        jobId: "job-access-denied",
        queryId: "query-access-denied",
        useMetadataCache: true,
        metadataCacheDir: cacheDir,
        now: new Date("2026-05-10T00:01:00.000Z"),
      },
    );

    assert.equal(result.status, "partial");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].preview_state, "preview_denied");
    assert.equal(result.results[0].open_state, "open_denied");
    assert.equal(result.results[0].ui_state.answerCitationAllowed, false);
    assert.equal(result.results[0].warnings.includes("access_denied"), true);
    assert.equal(result.results[0].warnings.includes("preview_denied"), true);
    assert.equal(result.results[0].warnings.includes("open_denied"), true);
    assert.equal(result.diagnostics.contentEvidenceGenerated, 0);
    assert.equal(result.diagnostics.accessUnavailableCount, 1);
    assert.equal(result.diagnostics.contentRequiredButUnconfirmed, true);
    assert.ok(result.evidencePack.warnings.some((warning) => warning.code === "access_changed"));
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch diversifies broad filename candidates across directories", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-diversity-"));
  const skewedDir = resolve(workspace, "160期-1Q", "ファイリング", "XSA");
  const otherDir = resolve(workspace, "160期-1Q", "監査資料");
  mkdirSync(skewedDir, { recursive: true });
  mkdirSync(otherDir, { recursive: true });
  for (let index = 1; index <= 5; index += 1) {
    writeFileSync(resolve(skewedDir, `CFS_candidate_${index}.xlsx`), "candidate", "utf8");
  }
  writeFileSync(resolve(otherDir, "CFS_other_folder.xlsx"), "candidate", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "CFS",
        roots: [workspace],
        fileTypes: ["xlsx"],
        maxResults: 3,
      },
      {
        jobId: "job-diversity",
        queryId: "query-diversity",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.results.length, 3);
    assert.ok(result.results.some((candidate) => String(candidate.display_path).includes("監査資料")));
    assert.equal(
      result.results.filter((candidate) => String(candidate.display_path).includes("ファイリング")).length,
      2,
    );
    assert.equal(result.diagnostics.diversity.enabled, true);
    assert.equal(result.diagnostics.diversity.perDirectoryLimit, 2);
    assert.equal(result.diagnostics.diversity.uniqueDirectoryCount, 2);
    assert.ok(result.diagnostics.diversity.deferredCandidateCount >= 3);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch allocates deterministic scan budget across period folders", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-period-budget-"));
  for (let fiscalYear = 150; fiscalYear <= 160; fiscalYear += 1) {
    const yearDir = resolve(workspace, `FY${fiscalYear}`);
    mkdirSync(yearDir, { recursive: true });
    for (let index = 1; index <= 20; index += 1) {
      writeFileSync(
        resolve(yearDir, `FY${fiscalYear}_連結CFS精算表_${String(index).padStart(2, "0")}.xlsx`),
        "candidate",
        "utf8",
      );
    }
  }

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "最新の連結CFS精算表を探して",
        roots: [workspace],
        fileTypes: ["xlsx"],
        maxResults: 50,
      },
      {
        jobId: "job-period-budget",
        queryId: "query-period-budget",
        maxScanFiles: 80,
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "partial");
    assert.equal(result.queryPlan.timeScopeIntent, "latest_first");
    assert.equal(result.diagnostics.searchBudget.schemaVersion, "RelayDocumentSearchScanBudgetSummary.v1");
    assert.equal(result.diagnostics.searchBudget.deterministic, true);
    const report = result.diagnostics.searchBudget.reports[0];
    assert.equal(report.strategy, "latest_first");
    assert.equal(report.folderCount, 11);
    assert.ok(report.minimumGuaranteePerFolder >= 1);
    const latest = report.folders.find((folder) => folder.displayPath === "FY160");
    const historical = report.folders.find((folder) => folder.displayPath === "FY150");
    assert.ok(latest);
    assert.ok(historical);
    assert.equal(latest.role, "latest");
    assert.equal(historical.role, "historical");
    assert.ok(latest.allocatedFiles > historical.allocatedFiles);
    assert.equal(report.folders.every((folder) => folder.scannedFiles >= 1), true);
    assert.ok(report.budgetTruncatedFolderCount > 0);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch groups backup and copy variants under one representative", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-grouped-results-"));
  const workDir = resolve(workspace, "160期-1Q", "作業");
  const backupDir = resolve(workDir, "backup");
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(resolve(workDir, "FY160-1Q_連結CFS精算表.xlsx"), "candidate", "utf8");
  writeFileSync(resolve(backupDir, "FY160-1Q_連結CFS精算表.xlsx"), "candidate", "utf8");
  writeFileSync(resolve(workDir, "FY160-1Q_連結CFS精算表 copy.xlsx"), "candidate", "utf8");
  writeFileSync(resolve(workDir, "FY160-2Q_連結CFS精算表.xlsx"), "candidate", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "連結CFS 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
        maxResults: 10,
      },
      {
        jobId: "job-result-grouping",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.diagnostics.resultGrouping.schemaVersion, "RelayDocumentSearchResultGrouping.v1");
    assert.equal(result.diagnostics.resultGrouping.groupCount, 1);
    assert.equal(result.diagnostics.resultGrouping.collapsedCandidateCount, 2);
    assert.equal(result.diagnostics.folderRoles.schemaVersion, "RelayDocumentSearchFolderRoles.v1");
    assert.equal(result.diagnostics.folderRoles.summary.work >= 1, true);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].product_result_contract, "RelayDocumentSearchProductResult.v1");
    assert.equal(result.results[0].display_name, "FY160-1Q_連結CFS精算表.xlsx");
    assert.equal(result.results[0].folder_role, "work");
    assert.equal(result.results[0].preview_state, "preview_pending");
    assert.equal(result.results[0].open_state, "open_ready");
    assert.equal(result.results[0].open_action.kind, "open_file");
    assert.equal(result.results[0].ui_state.openIndependentOfCopilot, true);
    assert.equal(result.results[0].result_group.memberCount, 3);
    assert.equal(result.results[0].result_group.collapsedCount, 2);
    assert.ok(
      String(result.results[0].display_path)
        .replace(/\\/gu, "/")
        .includes("作業/FY160-1Q_連結CFS精算表.xlsx"),
    );
    assert.ok(result.results.some((candidate) => String(candidate.display_name).includes("FY160-2Q")));
    assert.equal(
      result.diagnostics.queryTrace.stages.find((stage) => stage.name === "ranking").facts.collapsedCandidateCount,
      2,
    );
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch boosts pinned and recent user-confirmed candidates without hiding others", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-user-memory-"));
  const memoryDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-user-memory-executor-"));
  const pinnedDir = resolve(workspace, "02_CFS");
  const otherDir = resolve(workspace, "01_CFS");
  mkdirSync(pinnedDir, { recursive: true });
  mkdirSync(otherDir, { recursive: true });
  const pinnedPath = resolve(pinnedDir, "B_連結CFS精算表.xlsx");
  const otherPath = resolve(otherDir, "A_連結CFS精算表.xlsx");
  writeFileSync(pinnedPath, "candidate", "utf8");
  writeFileSync(otherPath, "candidate", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "連結CFS 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
        maxResults: 10,
      },
      {
        jobId: "job-user-memory",
        useUserMemory: true,
        userMemoryDir: memoryDir,
        pinnedTargets: [
          {
            kind: "folder",
            path: pinnedDir,
            createdAt: "2026-05-09T00:00:00.000Z",
          },
        ],
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].path, pinnedPath);
    assert.equal(result.results[0].score_breakdown.memory, 4);
    assert.equal(result.results[0].score_breakdown.score_breakdown_contract, "RelayDocumentSearchScoreBreakdown.v1");
    assert.equal(result.results[0].score_breakdown.components.pin_history.score, 4);
    assert.equal(result.results[0].score_breakdown.components.hybrid_merge.applied, true);
    assert.equal(result.diagnostics.userMemory.contract, "RelayDocumentSearchUserMemory.v1");
    assert.equal(result.diagnostics.userMemory.pinCount, 1);
    assert.equal(result.diagnostics.userMemory.boostedFileCount, 1);
    assert.equal(result.diagnostics.userMemory.recordedRecentSearch, true);
    assert.equal(
      result.diagnostics.queryTrace.stages.find((stage) => stage.name === "ranking").facts.userMemoryBoostedFileCount,
      1,
    );

    const second = await module.executeRelayDocumentSearch(
      {
        query: "連結CFS 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
        maxResults: 10,
      },
      {
        jobId: "job-user-memory-second",
        useUserMemory: true,
        userMemoryDir: memoryDir,
        now: new Date("2026-05-09T00:01:00.000Z"),
      },
    );
    assert.equal(second.diagnostics.userMemory.recentSearchCount, 1);
    assert.equal(second.results[0].path, pinnedPath);
    assert.equal(second.results[0].score_breakdown.memory, 5);
    assert.equal(second.results[0].score_breakdown.components.pin_history.score, 5);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(memoryDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch promotes OOXML spreadsheet cell matches to content evidence", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-xlsx-workspace-"));
  writeFileSync(resolve(workspace, "monthly_workbook.xlsx"), minimalXlsx());

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
        intent: "answer_with_evidence",
        evidence: "required",
      },
      {
        jobId: "job-xlsx-content",
        queryId: "query-xlsx-content",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.progress.stage, "content_candidates");
    assert.equal(result.results[0].match_mode, "content");
    assert.equal(result.results[0].evidence_state, "content_confirmed");
    assert.equal(result.results[0].anchors[0].type, "cell_excerpt");
    assert.equal(result.results[0].anchors[0].parser_profile, "spreadsheet");
    assert.equal(result.results[0].anchors[0].sheet_name, "CFS");
    assert.equal(result.results[0].anchors[0].cell_address, "A1");
    assert.equal(result.results[0].anchors[0].row, 1);
    assert.equal(result.results[0].anchors[0].column, 1);
    assert.equal(result.results[0].anchors[0].preview_anchor_contract, "RelayDocumentSearchPreviewAnchor.v1");
    assert.equal(result.results[0].anchors[0].preview.schemaVersion, "RelayDocumentSearchPreviewAnchor.v1");
    assert.equal(result.results[0].anchors[0].anchor_confidence, "high");
    assert.match(result.results[0].anchors[0].snippet, /キャッシュフロー計算書/);
    assert.equal(result.results[0].primary_source_index, "table_index");
    assert.equal(result.results[0].source_indexes.some((sourceIndex) => sourceIndex.kind === "derived_content_index"), true);
    assert.equal(result.results[0].source_indexes.some((sourceIndex) => sourceIndex.kind === "table_index"), true);
    assert.equal(result.results[0].source_indexes.some((sourceIndex) => sourceIndex.kind === "preview_anchor_index"), true);
    assert.equal(result.evidencePack.evidence[0].anchor.type, "cell_excerpt");
    assert.equal(result.evidencePack.evidence[0].structure_profile.schemaVersion, "RelayParsedDocumentStructureProfile.v1");
    assert.equal(result.evidencePack.evidence[0].structure_profile.profile, "spreadsheet");
    assert.equal(result.evidencePack.evidence[0].structure_profile.status, "valid");
    assert.equal(result.evidencePack.evidence[0].structure_profile.cellCount, 2);
    assert.equal(result.localDraft.answer_policy, "evidence_confirmed");
    assert.equal(result.localDraft.citation_policy, "evidence_pack_ids_required");
    assert.equal(result.localDraft.can_replace_with_copilot_polish, true);
    assert.equal(result.localDraft.citations[0].evidence_id, result.evidencePack.evidence[0].evidence_id);
    assert.match(result.localDraft.sections.find((section) => section.kind === "confirmed_evidence").items[0].text, /monthly_workbook\.xlsx/);
    assert.equal(result.diagnostics.polishValidation.state, "polish_skipped");
    assert.ok(result.diagnostics.polishValidation.warnings.some((warning) => warning.code === "redaction_blocks_copilot"));
    assert.equal(result.queryPlan.readerCapabilities.xlsx.tables, true);
    assert.equal(result.queryPlan.readerCapabilities.xlsx.cachedFormulas, true);
    assert.equal(result.diagnostics.contentRequiredButUnconfirmed, false);
    assert.equal(result.diagnostics.quality.answerPolicy, "evidence_confirmed");
    assert.equal(result.diagnostics.quality.canAskCopilotForFinalAnswer, true);
    assert.equal(result.diagnostics.derivedContentIndex.schemaVersion, "RelayDocumentSearchDerivedContentIndex.v1");
    assert.equal(result.diagnostics.derivedContentIndex.builtDocumentCount, 1);
    assert.equal(result.diagnostics.derivedContentIndex.tableCellEntryCount > 0, true);
    assert.equal(result.diagnostics.derivedContentIndex.searchStoreTableCellRowCount > 0, true);
    assert.equal(result.diagnostics.derivedContentIndex.previewSpanSeedCount > 0, true);
    assert.equal(result.diagnostics.derivedContentIndex.returnedAnchorCount >= 1, true);
    assert.equal(result.diagnostics.derivedContentIndex.structureProfile.schemaVersion, "RelayParsedDocumentStructureProfile.v1");
    assert.equal(result.diagnostics.derivedContentIndex.structureProfile.validCount, 1);
    assert.equal(result.diagnostics.parsedDocumentStructureProfile.profiles.spreadsheet, 1);
    assert.equal(result.diagnostics.evidenceRedaction.canSendToCopilot, false);
    assert.ok(result.diagnostics.evidenceRedaction.sourceEvidenceCount >= 1);
    assert.equal(
      result.diagnostics.queryTrace.stages.find((stage) => stage.name === "content_scan").state,
      "completed",
    );
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch can prepare redacted evidence for optional Copilot polish", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-redacted-evidence-"));
  writeFileSync(resolve(workspace, "monthly_workbook.xlsx"), minimalXlsx());

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
        intent: "answer_with_evidence",
        evidence: "required",
      },
      {
        jobId: "job-redacted-evidence",
        queryId: "query-redacted-evidence",
        evidenceRedactionPolicy: "snippets_allowed",
        copilotPolishState: "copilot_sign_in_required",
        copilotPolishStateMessage: "Copilot sign-in is required before optional polish.",
        copilotRequestId: "copilot-request-redacted-evidence",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.diagnostics.evidenceRedaction.canSendToCopilot, true);
    assert.equal(result.polishRequest.schemaVersion, "RelayDocumentSearchPolishRequest.v1");
    assert.equal(result.polishRequest.status, "ready");
    assert.equal(result.polishRequest.reason, "ready_for_copilot");
    assert.equal(result.polishRequest.expected_output_schema, "RelayDocumentSearchPolishedAnswer.v1");
    assert.match(result.polishRequest.prompt, /relay_answer_polish_prompt\.v1/);
    assert.doesNotMatch(result.polishRequest.prompt, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(result.diagnostics.polishRequest.status, "ready");
    assert.ok(result.diagnostics.polishRequest.promptCharacterCount > 0);
    assert.equal(result.diagnostics.polishValidation.state, "polish_pending");
    assert.equal(result.answer.schemaVersion, "RelayDocumentSearchAnswer.v1");
    assert.equal(result.answer.source, "local_draft");
    assert.equal(result.answer.replacement.reason, "copilot_polish_pending");
    assert.equal(result.answer.replacement.canReplaceAgain, false);
    assert.equal(result.diagnostics.copilotState.state, "copilot_sign_in_required");
    assert.equal(result.diagnostics.copilotState.local_search_blocked, false);
    assert.equal(result.diagnostics.copilotState.should_wait_for_copilot, false);
    assert.equal(result.diagnostics.copilotState.correlation.copilotRequestId, "copilot-request-redacted-evidence");
    assert.ok(result.diagnostics.evidenceRedaction.redactedEvidence.length >= 1);
    assert.equal(result.diagnostics.evidenceRedaction.redactedEvidence[0].path, undefined);
    assert.match(result.diagnostics.evidenceRedaction.redactedEvidence[0].anchor.snippet, /キャッシュフロー計算書/);
    assert.equal(
      result.diagnostics.queryTrace.stages.find((stage) => stage.name === "quality_gate").facts.redactionPolicy,
      "snippets_allowed",
    );
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch can invoke an optional Copilot polish provider", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-provider-polish-"));
  writeFileSync(resolve(workspace, "monthly_workbook.xlsx"), minimalXlsx());

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
        intent: "answer_with_evidence",
        evidence: "required",
      },
      {
        jobId: "job-provider-polish",
        queryId: "query-provider-polish",
        evidenceRedactionPolicy: "snippets_allowed",
        now: new Date("2026-05-09T00:00:00.000Z"),
        copilotPolishProvider: async ({ polishRequest, copilotRequestId }) => ({
          candidate: {
            schemaVersion: "RelayDocumentSearchPolishedAnswer.v1",
            polished_answer_id: "polished-answer-provider",
            prompt_template_id: "relay_answer_polish_prompt.v1",
            evidence_pack_id: polishRequest.evidence_pack_id,
            local_draft_id: polishRequest.local_draft_id,
            answer: `monthly_workbook.xlsx にキャッシュフロー計算書の根拠があります [${polishRequest.citation_ids[0]}]。`,
            citations: [
              {
                citation_id: polishRequest.citation_ids[0],
                evidence_id: polishRequest.evidence_ids[0],
              },
            ],
          },
          copilotRequestId,
          copilotTurnId: "provider-turn-1",
          responseCharacterCount: 256,
        }),
      },
    );

    assert.equal(result.polishProvider.schemaVersion, "RelayDocumentSearchPolishProvider.v1");
    assert.equal(result.polishProvider.state, "candidate_received");
    assert.equal(result.polishProvider.reason, "candidate_received");
    assert.equal(result.polishProvider.provider_kind, "callback");
    assert.equal(result.polishProvider.response_character_count, 256);
    assert.equal(result.diagnostics.polishProvider.state, "candidate_received");
    assert.equal(result.diagnostics.polishValidation.state, "polish_accepted");
    assert.equal(result.answer.source, "copilot_polish");
    assert.equal(result.answer.polished_answer_id, "polished-answer-provider");
    assert.equal(result.diagnostics.copilotState.state, "polish_accepted");
    assert.equal(result.diagnostics.copilotState.correlation.copilotTurnId, "provider-turn-1");
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch accepts citation-bound Copilot polish as the final answer", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-accepted-polish-"));
  writeFileSync(resolve(workspace, "monthly_workbook.xlsx"), minimalXlsx());

  const { module, cleanup } = await loadExecutorModule();
  try {
    const request = {
      query: "キャッシュフロー 精算表",
      roots: [workspace],
      fileTypes: ["xlsx"],
      intent: "answer_with_evidence",
      evidence: "required",
    };
    const options = {
      jobId: "job-accepted-polish",
      queryId: "query-accepted-polish",
      evidenceRedactionPolicy: "snippets_allowed",
      now: new Date("2026-05-09T00:00:00.000Z"),
    };
    const first = await module.executeRelayDocumentSearch(request, options);
    const citation = first.localDraft.citations[0];
    const candidate = {
      schemaVersion: "RelayDocumentSearchPolishedAnswer.v1",
      polished_answer_id: "polished-answer-accepted",
      prompt_template_id: "relay_answer_polish_prompt.v1",
      evidence_pack_id: first.evidencePack.evidence_pack_id,
      local_draft_id: first.localDraft.local_draft_id,
      answer: `monthly_workbook.xlsx にキャッシュフロー計算書の根拠があります [${citation.citation_id}]。`,
      citations: [{ citation_id: citation.citation_id, evidence_id: citation.evidence_id }],
    };

    const result = await module.executeRelayDocumentSearch(request, {
      ...options,
      copilotPolishCandidate: candidate,
      copilotRequestId: "copilot-request-accepted-polish",
      copilotTurnId: "copilot-turn-accepted-polish",
    });

    assert.equal(result.diagnostics.polishValidation.state, "polish_accepted");
    assert.equal(result.diagnostics.polishValidation.accepted, true);
    assert.equal(result.diagnostics.polishValidation.polished_answer_id, "polished-answer-accepted");
    assert.equal(result.answer.source, "copilot_polish");
    assert.equal(result.answer.polished_answer_id, "polished-answer-accepted");
    assert.equal(result.answer.replacement.localDraftCommitted, true);
    assert.equal(result.answer.replacement.replacementCount, 1);
    assert.equal(result.answer.replacement.canReplaceAgain, false);
    assert.equal(result.answer.validation.acceptedPolish, true);
    assert.deepEqual(result.answer.citation_ids, [citation.citation_id]);
    assert.match(result.answer.text, /monthly_workbook\.xlsx/);
    assert.equal(result.diagnostics.answer.source, "copilot_polish");
    assert.equal(result.diagnostics.answer.replacementCount, 1);
    assert.equal(result.diagnostics.copilotState.state, "polish_accepted");
    assert.equal(result.diagnostics.copilotState.correlation.copilotRequestId, "copilot-request-accepted-polish");
    assert.equal(result.diagnostics.copilotState.local_search_blocked, false);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch promotes PDF text matches when LiteParse runner is available", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-pdf-workspace-"));
  const runner = mkdtempSync(resolve(tmpdir(), "relay-document-search-pdf-runner-"));
  writeFileSync(resolve(workspace, "report.pdf"), "%PDF fake", "utf8");
  writeFileSync(
    resolve(runner, "parse.mjs"),
    "process.stdout.write('連結キャッシュフロー計算書\\n営業活動によるキャッシュフロー');",
    "utf8",
  );
  const previousRunner = process.env.RELAY_LITEPARSE_RUNNER_ROOT;
  process.env.RELAY_LITEPARSE_RUNNER_ROOT = runner;

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
        fileTypes: ["pdf"],
        intent: "answer_with_evidence",
        evidence: "required",
      },
      {
        jobId: "job-pdf-content",
        queryId: "query-pdf-content",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.progress.stage, "content_candidates");
    assert.equal(result.results[0].match_mode, "content");
    assert.equal(result.results[0].evidence_state, "content_confirmed");
    assert.equal(result.results[0].anchors[0].parser_profile, "default");
    assert.equal(result.results[0].anchors[0].parsed_document_version, "relay-ir-v1");
    assert.equal(result.results[0].anchors[0].page_id, "doc");
    assert.equal(result.results[0].anchors[0].page_anchors_available, false);
    assert.equal(result.results[0].anchors[0].anchor_confidence, "medium");
    assert.match(result.results[0].anchors[0].snippet, /キャッシュフロー計算書/);
    assert.equal(result.queryPlan.readerCapabilities.pdf.text, true);
    assert.equal(result.queryPlan.readerCapabilities.pdf.textLayerOnly, true);
    assert.equal(result.diagnostics.contentReaderUnavailableCount, 0);
    assert.equal(result.evidencePack.evidence[0].structure_profile.status, "degraded");
    assert.equal(result.evidencePack.evidence[0].structure_profile.unsupportedWarningCount > 0, true);
    assert.equal(result.diagnostics.parsedDocumentStructureProfile.degradedCount, 1);
  } finally {
    if (previousRunner === undefined) {
      delete process.env.RELAY_LITEPARSE_RUNNER_ROOT;
    } else {
      process.env.RELAY_LITEPARSE_RUNNER_ROOT = previousRunner;
    }
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runner, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch reuses durable ParsedDocument cache before rerunning PDF extraction", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-pdf-cache-workspace-"));
  const runner = mkdtempSync(resolve(tmpdir(), "relay-document-search-pdf-cache-runner-"));
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-pdf-cache-"));
  const pdfPath = resolve(workspace, "cached-report.pdf");
  const parseScriptPath = resolve(runner, "parse.mjs");
  writeFileSync(pdfPath, "%PDF fake", "utf8");
  writeFileSync(
    parseScriptPath,
    "process.stdout.write('連結キャッシュフロー計算書\\nPDF本文');",
    "utf8",
  );
  const previousRunner = process.env.RELAY_LITEPARSE_RUNNER_ROOT;
  process.env.RELAY_LITEPARSE_RUNNER_ROOT = runner;

  const { module, cleanup } = await loadExecutorModule();
  try {
    const first = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
        fileTypes: ["pdf"],
        intent: "answer_with_evidence",
        evidence: "required",
      },
      {
        jobId: "job-pdf-cache-first",
        queryId: "query-pdf-cache-first",
        useParsedDocumentCache: true,
        parsedDocumentCacheDir: cacheDir,
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(first.status, "ok");
    assert.deepEqual(first.diagnostics.parsedDocumentCache.hits, []);
    assert.deepEqual(first.diagnostics.parsedDocumentCache.misses, [pdfPath]);
    assert.deepEqual(first.diagnostics.parsedDocumentCache.writes, [pdfPath]);

    rmSync(parseScriptPath, { force: true });
    delete process.env.RELAY_LITEPARSE_RUNNER_ROOT;

    const second = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
        fileTypes: ["pdf"],
        intent: "answer_with_evidence",
        evidence: "required",
      },
      {
        jobId: "job-pdf-cache-second",
        queryId: "query-pdf-cache-second",
        useParsedDocumentCache: true,
        parsedDocumentCacheDir: cacheDir,
        now: new Date("2026-05-09T00:01:00.000Z"),
      },
    );

    assert.equal(second.status, "ok");
    assert.equal(second.results[0].evidence_state, "content_confirmed");
    assert.match(second.results[0].anchors[0].snippet, /キャッシュフロー計算書/);
    assert.deepEqual(second.diagnostics.parsedDocumentCache.hits, [pdfPath]);
    assert.deepEqual(second.diagnostics.parsedDocumentCache.misses, []);
    assert.deepEqual(second.diagnostics.parsedDocumentCache.writes, []);
  } finally {
    if (previousRunner === undefined) {
      delete process.env.RELAY_LITEPARSE_RUNNER_ROOT;
    } else {
      process.env.RELAY_LITEPARSE_RUNNER_ROOT = previousRunner;
    }
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(runner, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch promotes bounded text matches to content evidence", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-content-"));
  writeFileSync(
    resolve(workspace, "memo.md"),
    [
      "# 作業メモ",
      "",
      "このメモには160期のキャッシュフロー計算書と連結CFS精算表の確認事項があります。",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(resolve(workspace, "unrelated.xlsx"), "binary placeholder", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー 精算表",
        roots: [workspace],
        fileTypes: ["md"],
        maxResults: 10,
        evidence: "required",
      },
      {
        jobId: "job-content",
        queryId: "query-content",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.progress.stage, "content_candidates");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].display_name, "memo.md");
    assert.equal(result.results[0].match_mode, "content");
    assert.equal(result.results[0].evidence_state, "content_confirmed");
    assert.equal(result.results[0].index_state, "content_indexed");
    assert.equal(result.results[0].anchors[0].type, "text_excerpt");
    assert.equal(result.results[0].anchors[0].preview_anchor_contract, "RelayDocumentSearchPreviewAnchor.v1");
    assert.equal(result.results[0].anchors[0].preview.schemaVersion, "RelayDocumentSearchPreviewAnchor.v1");
    assert.equal(result.results[0].anchors[0].preview_span.schemaVersion, "RelayDocumentSearchPreviewSpan.v1");
    assert.equal(result.results[0].anchors[0].preview_span.highlights.length > 0, true);
    assert.equal(result.results[0].anchors[0].parsed_document_version, "relay-ir-v1");
    assert.equal(result.results[0].anchors[0].parser_profile, "technical_document");
    assert.match(result.results[0].anchors[0].snippet, /キャッシュフロー計算書/);
    assert.equal(result.results[0].primary_source_index, "derived_content_index");
    assert.equal(result.results[0].source_indexes.some((sourceIndex) => sourceIndex.kind === "derived_content_index"), true);
    assert.equal(result.results[0].source_indexes.some((sourceIndex) => sourceIndex.kind === "preview_anchor_index"), true);
    assert.equal(result.evidencePack.evidence.length, 1);
    assert.equal(result.evidencePack.schemaVersion, "RelayDocumentSearchEvidencePack.v1");
    assert.equal(result.evidencePack.evidence_pack_id, "evidence-pack-query-content");
    assert.equal(result.evidencePack.coverage.contentEvidenceFileCount, 1);
    assert.equal(result.evidencePack.candidate_files[0].file_id, result.results[0].file_id);
    assert.equal(result.evidencePack.evidence[0].result_id, result.results[0].result_id);
    assert.equal(result.evidencePack.ai_boundary.copilotMayUseOnlyEvidencePack, true);
    assert.equal(result.evidencePack.ai_boundary.originalFilesIncluded, false);
    assert.match(result.evidencePack.evidence[0].parsed_document_uid, /^parsed-/);
    assert.equal(result.evidencePack.warnings[0].code, "content_confirmed");
    assert.match(result.display.beginnerSummary, /中身を確認できた候補/);
    assert.equal(result.diagnostics.fileMetadataOnly, false);
    assert.equal(result.diagnostics.parsedDocumentIrVersion, "relay-ir-v1");
    assert.equal(result.diagnostics.parsedDocumentsGenerated, 1);
    assert.equal(result.diagnostics.textContentScanned, 1);
    assert.equal(result.diagnostics.contentEvidenceGenerated, 1);
    assert.equal(result.diagnostics.derivedContentIndex.returnedPreviewSpanCount, 1);
    assert.equal(result.diagnostics.derivedContentIndex.searchStoreRowCount > 0, true);
    assert.equal(result.diagnostics.derivedContentIndex.previewSpanSeedCount > 0, true);
    assert.ok(!result.results.some((candidate) => String(candidate.path).endsWith("unrelated.xlsx")));
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch applies deterministic warning penalties during ranking", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-ranking-"));
  writeFileSync(resolve(workspace, "CFS_filename_only.md"), "このファイルには対象語がありません。", "utf8");
  writeFileSync(resolve(workspace, "notes.md"), "キャッシュフロー計算書の作成手順を確認します。", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー CFS",
        roots: [workspace],
        fileTypes: ["md"],
        intent: "answer_with_evidence",
        evidence: "required",
        maxResults: 10,
      },
      {
        jobId: "job-ranking-warning-penalty",
        queryId: "query-ranking-warning-penalty",
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "partial");
    assert.equal(result.results[0].display_name, "notes.md");
    assert.equal(result.results[0].primary_source_index, "derived_content_index");
    const filenameOnly = result.results.find((candidate) => candidate.display_name === "CFS_filename_only.md");
    assert.ok(filenameOnly);
    assert.equal(filenameOnly.primary_source_index, "filename_index");
    assert.equal(filenameOnly.warnings.includes("content_not_confirmed"), true);
    assert.equal(filenameOnly.score_breakdown.score_breakdown_contract, "RelayDocumentSearchScoreBreakdown.v1");
    assert.equal(filenameOnly.score_breakdown.warning_penalty > 0, true);
    assert.equal(filenameOnly.score_breakdown.components.warning_penalty.applied, true);
    assert.equal(filenameOnly.score_breakdown.components.warning_penalty.rawScore, filenameOnly.score_breakdown.warning_penalty);
    assert.equal(filenameOnly.score_breakdown.base_score > filenameOnly.score_breakdown.final_score, true);
    assert.equal(filenameOnly.score_breakdown.totals.finalScore, filenameOnly.score_breakdown.final_score);
    assert.equal(filenameOnly.score, filenameOnly.score_breakdown.final_score);
    assert.equal(result.diagnostics.ranking.deterministic, true);
    assert.equal(result.diagnostics.ranking.scoreBreakdown.score_breakdown_contract, "RelayDocumentSearchScoreBreakdown.v1");
    assert.equal(result.diagnostics.ranking.scoreBreakdown.componentTotals.warning_penalty < 0, true);
    assert.equal(result.diagnostics.ranking.warningPenaltyAppliedCount >= 1, true);
    assert.equal(
      result.diagnostics.queryTrace.stages.find((stage) => stage.name === "ranking").facts.warningPenaltyAppliedCount >= 1,
      true,
    );
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch reports ParsedDocument cache policy without blocking local evidence", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-policy-"));
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-policy-store-"));
  writeFileSync(resolve(workspace, "memo.md"), "キャッシュフロー計算書\n精算表", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
        fileTypes: ["md"],
        evidence: "required",
      },
      {
        jobId: "job-cache-policy",
        useParsedDocumentCache: true,
        parsedDocumentCacheDir: cacheDir,
        parsedDocumentCacheProtectionMode: "protection_required",
        parsedDocumentCacheProtectedAtRest: false,
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.results[0].evidence_state, "content_confirmed");
    assert.deepEqual(result.diagnostics.parsedDocumentCache.writes, []);
    assert.equal(result.diagnostics.parsedDocumentCache.policy[0].schemaVersion, "RelayParsedDocumentCachePolicy.v1");
    assert.equal(result.diagnostics.parsedDocumentCache.policy[0].writeAllowed, false);
    assert.equal(result.diagnostics.parsedDocumentCache.policy[0].reason, "protection_required_but_unavailable");
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch reuses durable derived content indexes before searching ParsedDocument entries", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-derived-index-workspace-"));
  const derivedIndexDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-derived-index-cache-"));
  writeFileSync(
    resolve(workspace, "memo.md"),
    "キャッシュフロー計算書と精算表の確認メモ",
    "utf8",
  );

  const { module, cleanup } = await loadExecutorModule();
  try {
    const request = {
      query: "キャッシュフロー 精算表",
      roots: [workspace],
      fileTypes: ["md"],
      evidence: "required",
    };
    const first = await module.executeRelayDocumentSearch(request, {
      jobId: "job-derived-index-first",
      useDerivedContentIndexCache: true,
      derivedContentIndexDir: derivedIndexDir,
      now: new Date("2026-05-09T00:00:00.000Z"),
    });
    assert.equal(first.status, "ok");
    assert.deepEqual(first.diagnostics.derivedContentIndex.cache.hits, []);
    assert.equal(first.diagnostics.derivedContentIndex.cache.misses.length, 1);
    assert.equal(first.diagnostics.derivedContentIndex.cache.writes.length, 1);

    const second = await module.executeRelayDocumentSearch(request, {
      jobId: "job-derived-index-second",
      useDerivedContentIndexCache: true,
      derivedContentIndexDir: derivedIndexDir,
      now: new Date("2026-05-09T00:01:00.000Z"),
    });
    assert.equal(second.status, "ok");
    assert.equal(second.diagnostics.derivedContentIndex.cache.hits.length, 1);
    assert.equal(second.diagnostics.derivedContentIndex.cache.misses.length, 0);
    assert.equal(second.diagnostics.derivedContentIndex.searchStoreRowCount > 0, true);
    assert.equal(second.diagnostics.derivedContentIndex.previewSpanSeedCount > 0, true);
    assert.match(second.results[0].anchors[0].snippet, /キャッシュフロー計算書/);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(derivedIndexDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch commits content indexes only after staged artifacts complete", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-content-commit-workspace-"));
  const parsedCacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-content-commit-parsed-"));
  const derivedIndexDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-content-commit-derived-"));
  const coordinatorDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-content-commit-coordinator-"));
  writeFileSync(
    resolve(workspace, "memo.md"),
    "キャッシュフロー計算書と精算表の確認メモ",
    "utf8",
  );
  const fileId = stableIdForTest(`${resolve(workspace)}:memo.md`);
  const pointerHash = createHash("sha256").update(fileId).digest("hex").slice(0, 32);

  const { module, cleanup } = await loadExecutorModule();
  try {
    const request = {
      query: "キャッシュフロー 精算表",
      roots: [workspace],
      fileTypes: ["md"],
      evidence: "required",
    };
    const first = await module.executeRelayDocumentSearch(request, {
      jobId: "job-content-index-commit-first",
      useParsedDocumentCache: true,
      parsedDocumentCacheDir: parsedCacheDir,
      useDerivedContentIndexCache: true,
      derivedContentIndexDir: derivedIndexDir,
      useIndexCoordinator: true,
      indexCoordinatorDir: coordinatorDir,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    assert.equal(first.status, "ok");
    assert.equal(first.diagnostics.contentIndexCommit.enabled, true);
    assert.equal(first.diagnostics.contentIndexCommit.attemptedCount, 1);
    assert.equal(first.diagnostics.contentIndexCommit.committedCount, 1);
    assert.equal(first.diagnostics.contentIndexCommit.staleFallbackCount, 0);
    assert.equal(first.diagnostics.parsedDocumentCache.writes.length, 1);
    assert.equal(first.diagnostics.derivedContentIndex.cache.writes.length, 1);
    assert.equal(
      first.diagnostics.indexDb.recentHealthEvents.some((event) => event.kind === "content_index_committed"),
      true,
    );
    const pointer = JSON.parse(readFileSync(
      resolve(coordinatorDir, "content-index-active", `${pointerHash}.json`),
      "utf8",
    ));
    assert.equal(pointer.schemaVersion, "RelayDocumentSearchContentIndexActivePointer.v1");
    assert.equal(pointer.state, "active");
    assert.equal(pointer.sourceFileId, fileId);
    assert.equal(pointer.parsedCacheKey, first.diagnostics.contentIndexCommit.reports[0].active.parsedCacheKey);
    assert.equal(pointer.derivedCacheKey, first.diagnostics.contentIndexCommit.reports[0].active.derivedCacheKey);

    const second = await module.executeRelayDocumentSearch(request, {
      jobId: "job-content-index-commit-second",
      useParsedDocumentCache: true,
      parsedDocumentCacheDir: parsedCacheDir,
      useDerivedContentIndexCache: true,
      derivedContentIndexDir: derivedIndexDir,
      useIndexCoordinator: true,
      indexCoordinatorDir: coordinatorDir,
      now: new Date("2026-05-10T00:01:00.000Z"),
    });
    assert.equal(second.status, "ok");
    assert.equal(second.diagnostics.parsedDocumentCache.hits.length, 1);
    assert.equal(second.diagnostics.derivedContentIndex.cache.hits.length, 1);
    assert.equal(second.diagnostics.contentIndexCommit.attemptedCount, 0);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(parsedCacheDir, { recursive: true, force: true });
    rmSync(derivedIndexDir, { recursive: true, force: true });
    rmSync(coordinatorDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch mirrors metadata and derived rows into the optional SQLite FTS index", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-workspace-"));
  writeFileSync(
    resolve(workspace, "memo.md"),
    "キャッシュフロー計算書と精算表の確認メモ",
    "utf8",
  );
  const filePath = resolve(workspace, "memo.md");
  const fileId = stableIdForTest(`${resolve(workspace)}:memo.md`);
  const sourceMetadataVersion = sourceMetadataVersionForTest(filePath);
  const fake = createFakeSqliteModule({
    contentRows: [1, 2, 3, 4].map((index) => ({
      file_id: fileId,
      entry_id: `text-preexisting-${index}`,
      text: `キャッシュフロー既存索引${index}`,
      preview_text: `キャッシュフロー既存索引${index}`,
      title: `既存索引${index}`,
      location_label: "本文",
      source_metadata_version: sourceMetadataVersion,
      parsed_document_uid: "parsed-memo",
      parser_version: "parser-v1",
      anchor_json: JSON.stringify({
        type: "text_excerpt",
        snippet: `キャッシュフロー既存索引${index}`,
        preview_anchor_contract: "RelayDocumentSearchPreviewAnchor.v1",
        anchor_confidence: "medium",
      }),
    })),
  });

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
        fileTypes: ["md"],
        evidence: "required",
      },
      {
        jobId: "job-index-db",
        useIndexDb: true,
        indexDbPrimaryMode: "primary",
        indexDbSearchMaxRows: 3,
        indexDbPath: resolve(workspace, "document-search.sqlite"),
        sqliteModule: fake.sqliteModule,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.results[0].primary_source_index, "derived_content_index");
    assert.equal(result.results[0].source_indexes.some((sourceIndex) => sourceIndex.kind === "sqlite_fts_index"), true);
    assert.equal(result.results[0].score_breakdown.sqlite_fts, 8);
    assert.equal(result.results[0].score_breakdown.sqlite_fts_uncapped >= result.results[0].score_breakdown.sqlite_fts, true);
    assert.equal(result.results[0].score_breakdown.sqlite_fts_cap_loss >= 0, true);
    assert.equal(
      result.results[0].score_breakdown.components.sqlite_fts.rawScore,
      result.results[0].score_breakdown.sqlite_fts_uncapped,
    );
    assert.equal(
      result.results[0].score_breakdown.components.sqlite_fts.capLoss,
      result.results[0].score_breakdown.sqlite_fts_cap_loss,
    );
    assert.equal(result.diagnostics.indexDb.enabled, true);
    assert.equal(result.diagnostics.indexDb.contract, "RelayDocumentSearchIndexDb.v1");
    assert.equal(result.diagnostics.indexDb.backend, "sqlite_fts");
    assert.equal(result.diagnostics.indexDb.schemaRevision, 2);
    assert.equal(result.diagnostics.indexDb.requiredMigrations.includes("20260510_preview_spans_anchor_json"), true);
    assert.equal(result.diagnostics.indexDb.appliedMigrations.includes("20260510_preview_spans_entry_id"), true);
    assert.equal(result.diagnostics.indexDb.metadataWrite.status, "ready");
    assert.equal(result.diagnostics.indexDb.metadataWrite.schemaRevision, 2);
    assert.equal(result.diagnostics.indexDb.metadataWrite.fileMetadataRowCount, 1);
    assert.equal(result.diagnostics.indexDb.derivedWrites.length, 1);
    assert.equal(result.diagnostics.indexDb.derivedWrites[0].schemaRevision, 2);
    assert.equal(result.diagnostics.indexDb.derivedWrites[0].ftsRowCount > 0, true);
    assert.equal(result.diagnostics.indexDb.search.status, "ready");
    assert.equal(result.diagnostics.indexDb.search.schemaRevision, 2);
    assert.equal(result.diagnostics.indexDb.search.maxRows, 3);
    assert.equal(result.diagnostics.indexDb.search.rawRowCount, 5);
    assert.equal(result.diagnostics.indexDb.search.droppedRowCount, 2);
    assert.equal(result.diagnostics.indexDb.search.truncated, true);
    assert.equal(result.diagnostics.indexDb.search.textRowCount > 0, true);
    assert.equal(result.diagnostics.indexDb.search.rowCount, result.diagnostics.indexDb.search.textRowCount);
    assert.equal(result.diagnostics.indexDb.search.matchedFileCount, 1);
    assert.equal(result.diagnostics.indexDb.currentScanFtsRowCount, 3);
    assert.equal(result.diagnostics.indexDb.currentScanFtsFileCount, 1);
    assert.equal(result.diagnostics.indexDb.freshCurrentScanFtsRowCount, 3);
    assert.equal(result.diagnostics.indexDb.freshCurrentScanFtsFileCount, 1);
    assert.equal(result.diagnostics.indexDb.staleCurrentScanFtsRowCount, 0);
    assert.equal(result.diagnostics.indexDb.staleCurrentScanFtsFileCount, 0);
    assert.equal(result.diagnostics.indexDb.staleEvidenceRowCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.candidateCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.returnedResultCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.searchMatchedFileCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.currentScanMatchedFileCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.freshCurrentScanMatchedFileCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.staleCurrentScanMatchedFileCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.outsideCurrentScanMatchedFileCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoredCandidateCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoredResultCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.promotedCandidateCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.promotedResultCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.candidateScoreTotal, 8);
    assert.equal(result.diagnostics.indexDb.resultUsage.maxCandidateScore, 8);
    assert.equal(result.diagnostics.indexDb.resultUsage.returnedScoreTotal, 8);
    assert.equal(result.diagnostics.indexDb.resultUsage.maxReturnedScore, 8);
    assert.equal(result.diagnostics.indexDb.resultUsage.candidateUncappedScoreTotal, 12);
    assert.equal(result.diagnostics.indexDb.resultUsage.returnedUncappedScoreTotal, 12);
    assert.equal(result.diagnostics.indexDb.resultUsage.candidateScoreCapLossTotal, 4);
    assert.equal(result.diagnostics.indexDb.resultUsage.returnedScoreCapLossTotal, 4);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoreCappedCandidateCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoreCappedResultCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.nonReturnedScoredCandidateCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.nonReturnedPromotedCandidateCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.nonReturnedScoreTotal, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoreTotal > 0, true);
    assert.equal(result.diagnostics.indexDb.resultUsage.maxScore > 0, true);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.status, "degraded");
    assert.equal(result.diagnostics.indexDb.primaryPathGate.mode, "primary");
    assert.equal(result.diagnostics.indexDb.primaryPathGate.activePath, "filename_content");
    assert.equal(result.diagnostics.indexDb.primaryPathGate.eligible, false);
    assert.equal(result.diagnostics.indexDb.primaryPathGate.rollbackActive, true);
    assert.equal(
      result.diagnostics.indexDb.primaryPathGate.reasons.includes("primary_rollback_to_filename_content"),
      true,
    );
    assert.equal(
      result.diagnostics.indexDb.primaryPathGate.reasons.includes("fts_result_limit_reached"),
      true,
    );
    assert.equal(
      result.diagnostics.indexDb.cutoverReadiness.reasons.includes("fts_result_limit_reached"),
      true,
    );
    const indexDbTraceStage = result.diagnostics.queryTrace.stages.find((stage) => stage.name === "index_db");
    assert.equal(indexDbTraceStage.state, "partial");
    assert.equal(indexDbTraceStage.facts.readinessStatus, "degraded");
    assert.equal(indexDbTraceStage.facts.primaryPathGate.activePath, "filename_content");
    assert.equal(indexDbTraceStage.facts.primaryPathGate.rollbackActive, true);
    assert.equal(indexDbTraceStage.facts.schemaReady, true);
    assert.equal(indexDbTraceStage.facts.migrationReady, true);
    assert.equal(indexDbTraceStage.facts.writeReady, true);
    assert.equal(indexDbTraceStage.facts.searchReady, true);
    assert.equal(indexDbTraceStage.facts.evidencePromotionReady, true);
    assert.equal(indexDbTraceStage.facts.resultUsage.searchMatchedFileCount, 1);
    assert.equal(indexDbTraceStage.facts.resultUsage.scoredResultCount, 1);
    assert.equal(indexDbTraceStage.facts.resultUsage.promotedResultCount, 0);
    assert.equal(indexDbTraceStage.facts.resultUsage.candidateScoreTotal, 8);
    assert.equal(indexDbTraceStage.facts.resultUsage.returnedScoreTotal, 8);
    assert.equal(indexDbTraceStage.facts.resultUsage.candidateUncappedScoreTotal, 12);
    assert.equal(indexDbTraceStage.facts.resultUsage.returnedUncappedScoreTotal, 12);
    assert.equal(indexDbTraceStage.facts.resultUsage.candidateScoreCapLossTotal, 4);
    assert.equal(indexDbTraceStage.facts.resultUsage.returnedScoreCapLossTotal, 4);
    assert.equal(indexDbTraceStage.facts.resultUsage.scoreCappedCandidateCount, 1);
    assert.equal(indexDbTraceStage.facts.resultUsage.scoreCappedResultCount, 1);
    assert.equal(indexDbTraceStage.facts.resultUsage.nonReturnedScoredCandidateCount, 0);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.schemaReady, true);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.migrationReady, true);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.writeReady, true);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.searchReady, true);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.evidencePromotionReady, true);
    assert.equal(
      result.diagnostics.indexDb.cutoverReadiness.reasons.includes("no_fts_evidence_promoted_in_this_query"),
      false,
    );
    assert.equal(
      fake.calls.some((call) => call.kind === "run" && /INSERT INTO content_nodes_fts/.test(call.sql)),
      true,
    );
    assert.equal(
      fake.calls.some((call) => call.kind === "all" && /FROM content_nodes_fts/.test(call.sql)),
      true,
    );
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch activates SQLite FTS primary path only behind a ready gate", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-primary-workspace-"));
  const filePath = resolve(workspace, "fts-primary.md");
  writeFileSync(filePath, "unrelated local body", "utf8");
  const modified = new Date("2026-05-10T00:00:00.000Z");
  utimesSync(filePath, modified, modified);
  const fileId = stableIdForTest(`${resolve(workspace)}:fts-primary.md`);
  const sourceMetadataVersion = sourceMetadataVersionForTest(filePath);
  const fake = createFakeSqliteModule({
    ignoreInsertedFtsRows: true,
    contentRows: [
      {
        file_id: fileId,
        entry_id: "text-primary",
        text: "キャッシュフロー台帳",
        span_id: "row-primary",
        preview_text: "キャッシュフロー台帳",
        title: "fts-primary.md",
        location_label: "本文",
        source_metadata_version: sourceMetadataVersion,
        parsed_document_uid: "parsed-primary",
        parser_version: "parser-v1",
        anchor_json: JSON.stringify({
          type: "text_excerpt",
          snippet: "キャッシュフロー台帳",
          preview_anchor_contract: "RelayDocumentSearchPreviewAnchor.v1",
          anchor_confidence: "medium",
        }),
      },
    ],
  });

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
        fileTypes: ["md"],
        evidence: "required",
      },
      {
        jobId: "job-index-db-primary",
        useIndexDb: true,
        indexDbPrimaryMode: "primary",
        indexDbPath: resolve(workspace, "document-search.sqlite"),
        sqliteModule: fake.sqliteModule,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.results[0].file_id, fileId);
    assert.equal(result.results[0].primary_source_index, "sqlite_fts_index");
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.status, "ready");
    assert.equal(result.diagnostics.indexDb.primaryPathGate.mode, "primary");
    assert.equal(result.diagnostics.indexDb.primaryPathGate.activePath, "sqlite_fts_primary");
    assert.equal(result.diagnostics.indexDb.primaryPathGate.eligible, true);
    assert.equal(result.diagnostics.indexDb.primaryPathGate.rollbackActive, false);
    assert.equal(
      result.diagnostics.indexDb.primaryPathGate.reasons.includes("sqlite_fts_primary_active"),
      true,
    );
    assert.equal(result.diagnostics.indexDb.search.truncated, false);
    assert.equal(result.diagnostics.indexDb.staleEvidenceRowCount, 0);
    assert.equal(result.diagnostics.indexDb.outsideCurrentScanFtsRowCount, 0);
    const indexDbTraceStage = result.diagnostics.queryTrace.stages.find((stage) => stage.name === "index_db");
    assert.equal(indexDbTraceStage.state, "completed");
    assert.equal(indexDbTraceStage.facts.primaryPathGate.activePath, "sqlite_fts_primary");
    assert.equal(indexDbTraceStage.facts.primaryPathGate.eligible, true);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch promotes fresh SQLite FTS rows to evidence when parsed anchors are available", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-evidence-workspace-"));
  const filePath = resolve(workspace, "fts-only.md");
  writeFileSync(filePath, "unrelated local body", "utf8");
  const modified = new Date("2026-05-10T00:00:00.000Z");
  utimesSync(filePath, modified, modified);
  const fileId = stableIdForTest(`${resolve(workspace)}:fts-only.md`);
  const sourceMetadataVersion = sourceMetadataVersionForTest(filePath);
  const fake = createFakeSqliteModule({
    contentRows: [
      {
        file_id: fileId,
        entry_id: "text-fts-only",
        text: "キャッシュフロー台帳",
        span_id: "row-fts-only",
        preview_text: "キャッシュフロー台帳",
        title: "fts-only.md",
        location_label: "本文",
        source_metadata_version: sourceMetadataVersion,
        parsed_document_uid: "parsed-fts-only",
        parser_version: "parser-v1",
        anchor_json: JSON.stringify({
          type: "text_excerpt",
          snippet: "キャッシュフロー台帳",
          preview_anchor_contract: "RelayDocumentSearchPreviewAnchor.v1",
          anchor_confidence: "medium",
        }),
      },
      {
        file_id: "file-outside-current-scan",
        entry_id: "text-old-workspace",
        text: "キャッシュフロー旧索引",
        span_id: "row-old-workspace",
        preview_text: "キャッシュフロー旧索引",
        title: "old-workspace.md",
        location_label: "本文",
        source_metadata_version: "old-version",
        parsed_document_uid: "parsed-old-workspace",
        parser_version: "parser-v1",
        anchor_json: JSON.stringify({
          type: "text_excerpt",
          snippet: "キャッシュフロー旧索引",
          preview_anchor_contract: "RelayDocumentSearchPreviewAnchor.v1",
          anchor_confidence: "medium",
        }),
      },
    ],
  });

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
        fileTypes: ["md"],
        evidence: "required",
      },
      {
        jobId: "job-index-db-evidence",
        useIndexDb: true,
        indexDbPath: resolve(workspace, "document-search.sqlite"),
        sqliteModule: fake.sqliteModule,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.results[0].file_id, fileId);
    assert.equal(result.results[0].primary_source_index, "sqlite_fts_index");
    assert.equal(result.results[0].source_indexes.some((sourceIndex) => sourceIndex.kind === "sqlite_fts_index"), true);
    assert.equal(result.results[0].source_indexes.some((sourceIndex) => sourceIndex.kind === "derived_content_index"), false);
    assert.equal(result.results[0].score_breakdown.content, 0);
    assert.equal(result.results[0].score_breakdown.sqlite_fts, 4);
    assert.equal(result.results[0].anchors[0].source_index, "sqlite_fts_index");
    assert.equal(result.results[0].anchors[0].snippet, "キャッシュフロー台帳");
    assert.equal(result.evidencePack.evidence[0].parsed_document_uid, "parsed-fts-only");
    assert.equal(result.evidencePack.evidence[0].anchor.source_index, "sqlite_fts_index");
    assert.equal(result.diagnostics.indexDb.promotedEvidenceFileCount, 1);
    assert.equal(result.diagnostics.indexDb.staleEvidenceRowCount, 1);
    assert.equal(result.diagnostics.indexDb.staleEvidenceReasons.missing_source_metadata_version, 1);
    assert.equal(result.diagnostics.indexDb.staleEvidenceReasons.missing_parsed_document_uid, 1);
    assert.equal(result.diagnostics.indexDb.staleEvidenceReasons.missing_preview_text, 1);
    assert.equal(result.diagnostics.indexDb.staleEvidenceReasons.missing_anchor, 1);
    assert.equal(result.diagnostics.indexDb.currentScanFtsRowCount, 2);
    assert.equal(result.diagnostics.indexDb.currentScanFtsFileCount, 1);
    assert.equal(result.diagnostics.indexDb.freshCurrentScanFtsRowCount, 1);
    assert.equal(result.diagnostics.indexDb.freshCurrentScanFtsFileCount, 1);
    assert.equal(result.diagnostics.indexDb.metadataBoostedFreshFtsRowCount, 1);
    assert.equal(result.diagnostics.indexDb.metadataBoostedFreshFtsFileCount, 1);
    assert.equal(result.diagnostics.indexDb.titleBoostedFreshFtsRowCount, 1);
    assert.equal(result.diagnostics.indexDb.titleBoostedFreshFtsFileCount, 1);
    assert.equal(result.diagnostics.indexDb.locationBoostedFreshFtsRowCount, 1);
    assert.equal(result.diagnostics.indexDb.locationBoostedFreshFtsFileCount, 1);
    assert.equal(result.diagnostics.indexDb.staleCurrentScanFtsRowCount, 1);
    assert.equal(result.diagnostics.indexDb.staleCurrentScanFtsFileCount, 1);
    assert.equal(result.diagnostics.indexDb.outsideCurrentScanFtsRowCount, 1);
    assert.equal(result.diagnostics.indexDb.outsideCurrentScanFtsFileCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.candidateCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.returnedResultCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.searchMatchedFileCount, 2);
    assert.equal(result.diagnostics.indexDb.resultUsage.currentScanMatchedFileCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.freshCurrentScanMatchedFileCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.staleCurrentScanMatchedFileCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.outsideCurrentScanMatchedFileCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoredCandidateCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoredResultCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.promotedCandidateCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.promotedResultCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.candidateScoreTotal > 0, true);
    assert.equal(result.diagnostics.indexDb.resultUsage.maxCandidateScore > 0, true);
    assert.equal(result.diagnostics.indexDb.resultUsage.returnedScoreTotal > 0, true);
    assert.equal(result.diagnostics.indexDb.resultUsage.maxReturnedScore > 0, true);
    assert.equal(result.diagnostics.indexDb.resultUsage.candidateUncappedScoreTotal, 4);
    assert.equal(result.diagnostics.indexDb.resultUsage.returnedUncappedScoreTotal, 4);
    assert.equal(result.diagnostics.indexDb.resultUsage.candidateScoreCapLossTotal, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.returnedScoreCapLossTotal, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoreCappedCandidateCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoreCappedResultCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.nonReturnedScoredCandidateCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.nonReturnedPromotedCandidateCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.nonReturnedScoreTotal, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoreTotal > 0, true);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.status, "degraded");
    const indexDbTraceStage = result.diagnostics.queryTrace.stages.find((stage) => stage.name === "index_db");
    assert.equal(indexDbTraceStage.facts.resultUsage.promotedResultCount, 1);
    assert.equal(indexDbTraceStage.facts.resultUsage.candidateScoreTotal > 0, true);
    assert.equal(indexDbTraceStage.facts.resultUsage.returnedScoreTotal > 0, true);
    assert.equal(indexDbTraceStage.facts.resultUsage.candidateUncappedScoreTotal, 4);
    assert.equal(indexDbTraceStage.facts.resultUsage.returnedUncappedScoreTotal, 4);
    assert.equal(indexDbTraceStage.facts.resultUsage.candidateScoreCapLossTotal, 0);
    assert.equal(indexDbTraceStage.facts.resultUsage.returnedScoreCapLossTotal, 0);
    assert.equal(indexDbTraceStage.facts.resultUsage.scoreCappedCandidateCount, 0);
    assert.equal(indexDbTraceStage.facts.resultUsage.scoreCappedResultCount, 0);
    assert.equal(indexDbTraceStage.facts.resultUsage.nonReturnedScoreTotal, 0);
    assert.equal(indexDbTraceStage.facts.resultUsage.staleCurrentScanMatchedFileCount, 1);
    assert.equal(indexDbTraceStage.facts.staleEvidenceReasons.missing_anchor, 1);
    assert.equal(indexDbTraceStage.facts.currentScanFtsRowCount, 2);
    assert.equal(indexDbTraceStage.facts.currentScanFtsFileCount, 1);
    assert.equal(indexDbTraceStage.facts.freshCurrentScanFtsRowCount, 1);
    assert.equal(indexDbTraceStage.facts.freshCurrentScanFtsFileCount, 1);
    assert.equal(indexDbTraceStage.facts.metadataBoostedFreshFtsRowCount, 1);
    assert.equal(indexDbTraceStage.facts.metadataBoostedFreshFtsFileCount, 1);
    assert.equal(indexDbTraceStage.facts.titleBoostedFreshFtsRowCount, 1);
    assert.equal(indexDbTraceStage.facts.titleBoostedFreshFtsFileCount, 1);
    assert.equal(indexDbTraceStage.facts.locationBoostedFreshFtsRowCount, 1);
    assert.equal(indexDbTraceStage.facts.locationBoostedFreshFtsFileCount, 1);
    assert.equal(indexDbTraceStage.facts.staleCurrentScanFtsRowCount, 1);
    assert.equal(indexDbTraceStage.facts.staleCurrentScanFtsFileCount, 1);
    assert.equal(indexDbTraceStage.facts.outsideCurrentScanFtsRowCount, 1);
    assert.equal(indexDbTraceStage.facts.outsideCurrentScanFtsFileCount, 1);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.evidencePromotionReady, true);
    assert.equal(
      result.diagnostics.indexDb.cutoverReadiness.reasons.includes("stale_or_incomplete_fts_rows_present"),
      true,
    );
    assert.equal(
      result.diagnostics.indexDb.cutoverReadiness.reasons.includes("fts_rows_outside_current_scan"),
      true,
    );
    assert.equal(result.diagnostics.contentEvidenceGenerated, 1);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch marks SQLite FTS cutover blocked when backend search reports errors", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-db-search-error-workspace-"));
  const fake = createFakeSqliteModule({ failSearch: true });
  writeFileSync(
    resolve(workspace, "memo.md"),
    "キャッシュフロー計算書と精算表の確認メモ",
    "utf8",
  );

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
        fileTypes: ["md"],
        evidence: "required",
      },
      {
        jobId: "job-index-db-search-error",
        useIndexDb: true,
        indexDbPath: resolve(workspace, "document-search.sqlite"),
        sqliteModule: fake.sqliteModule,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.results[0].primary_source_index, "derived_content_index");
    assert.equal(result.diagnostics.indexDb.search.status, "failed");
    assert.equal(result.diagnostics.indexDb.search.errors.includes("forced sqlite fts search failure"), true);
    assert.equal(result.diagnostics.indexDb.resultUsage.candidateCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.returnedResultCount, 1);
    assert.equal(result.diagnostics.indexDb.resultUsage.searchMatchedFileCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.scoredResultCount, 0);
    assert.equal(result.diagnostics.indexDb.resultUsage.promotedResultCount, 0);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.status, "blocked");
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.schemaReady, true);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.migrationReady, true);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.writeReady, true);
    assert.equal(result.diagnostics.indexDb.cutoverReadiness.searchReady, false);
    const indexDbTraceStage = result.diagnostics.queryTrace.stages.find((stage) => stage.name === "index_db");
    assert.equal(indexDbTraceStage.state, "partial");
    assert.equal(indexDbTraceStage.facts.readinessStatus, "blocked");
    assert.equal(indexDbTraceStage.facts.schemaReady, true);
    assert.equal(indexDbTraceStage.facts.migrationReady, true);
    assert.equal(indexDbTraceStage.facts.writeReady, true);
    assert.equal(indexDbTraceStage.facts.searchReady, false);
    assert.equal(indexDbTraceStage.facts.evidencePromotionReady, false);
    assert.equal(indexDbTraceStage.facts.searchErrorCount, 1);
    assert.equal(
      result.diagnostics.indexDb.cutoverReadiness.reasons.includes("search_report_errors_present"),
      true,
    );
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch reuses a durable metadata cache when enabled", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-workspace-"));
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-cache-"));
  writeFileSync(resolve(workspace, "FY160-1Q_連結CFS精算表.xlsx"), "candidate", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const first = await module.executeRelayDocumentSearch(
      {
        query: "連結CFS",
        roots: [workspace],
        fileTypes: ["xlsx"],
      },
      {
        jobId: "job-cache-first",
        useMetadataCache: true,
        metadataCacheDir: cacheDir,
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );
    assert.deepEqual(first.diagnostics.metadataCache.hits, []);
    assert.deepEqual(first.diagnostics.metadataCache.misses, [resolve(workspace)]);
    assert.deepEqual(first.diagnostics.metadataCache.writes, [resolve(workspace)]);

    const second = await module.executeRelayDocumentSearch(
      {
        query: "連結CFS",
        roots: [workspace],
        fileTypes: ["xlsx"],
      },
      {
        jobId: "job-cache-second",
        useMetadataCache: true,
        metadataCacheDir: cacheDir,
        now: new Date("2026-05-09T00:01:00.000Z"),
      },
    );

    assert.deepEqual(second.diagnostics.metadataCache.hits, [resolve(workspace)]);
    assert.deepEqual(second.diagnostics.metadataCache.misses, []);
    assert.equal(second.progress.stage, "filename_candidates");
    assert.equal(second.results[0].display_name, "FY160-1Q_連結CFS精算表.xlsx");
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch reports stale content when cached mtime or size changes", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-freshness-workspace-"));
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-freshness-cache-"));
  const filePath = resolve(workspace, "FY160-1Q_連結CFS精算表.xlsx");
  writeFileSync(filePath, "candidate", "utf8");
  utimesSync(filePath, new Date("2026-05-09T00:00:00.000Z"), new Date("2026-05-09T00:00:00.000Z"));

  const { module, cleanup } = await loadExecutorModule();
  try {
    await module.executeRelayDocumentSearch(
      {
        query: "連結CFS",
        roots: [workspace],
        fileTypes: ["xlsx"],
      },
      {
        jobId: "job-freshness-first",
        useMetadataCache: true,
        metadataCacheDir: cacheDir,
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    writeFileSync(filePath, "candidate updated", "utf8");
    utimesSync(filePath, new Date("2026-05-09T00:05:00.000Z"), new Date("2026-05-09T00:05:00.000Z"));
    const second = await module.executeRelayDocumentSearch(
      {
        query: "連結CFS",
        roots: [workspace],
        fileTypes: ["xlsx"],
      },
      {
        jobId: "job-freshness-second",
        useMetadataCache: true,
        metadataCacheDir: cacheDir,
        metadataCacheMaxAgeMs: 0,
        now: new Date("2026-05-09T00:10:00.000Z"),
      },
    );

    assert.equal(second.diagnostics.freshness.schemaVersion, "RelayDocumentSearchFreshnessSummary.v1");
    assert.equal(second.diagnostics.freshness.report_count, 1);
    assert.equal(second.diagnostics.freshness.modified_file_count, 1);
    assert.equal(second.diagnostics.freshness.content_stale_file_count, 1);
    assert.equal(second.diagnostics.freshness.reports[0].schemaVersion, "RelayDocumentSearchFreshness.v1");
    assert.equal(second.diagnostics.freshness.reports[0].changes[0].content_stale, true);
    assert.equal(second.diagnostics.freshness.reports[0].changes[0].reason, "size_changed");
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch migrates user pins and history for high-confidence moves before ranking", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-move-memory-workspace-"));
  const cacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-move-memory-cache-"));
  const parsedDocumentCacheDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-move-parsed-cache-"));
  const oldPath = resolve(workspace, "old/FY160-1Q_連結CFS精算表.xlsx");
  const newDir = resolve(workspace, "new");
  const newPath = resolve(newDir, "FY160-1Q_連結CFS精算表.xlsx");
  mkdirSync(newDir, { recursive: true });
  writeFileSync(newPath, "candidate", "utf8");
  utimesSync(newPath, new Date("2026-05-09T00:00:00.000Z"), new Date("2026-05-09T00:00:00.000Z"));
  writeMetadataCacheFixture(workspace, cacheDir, [
    {
      fileId: "old-file-id",
      root: resolve(workspace),
      path: oldPath,
      displayPath: "old/FY160-1Q_連結CFS精算表.xlsx",
      name: "FY160-1Q_連結CFS精算表.xlsx",
      extension: "xlsx",
      size: Buffer.byteLength("candidate"),
      modifiedTime: "2026-05-09T00:00:00.000Z",
      sourceMetadataVersion: "old-file-id:9:1",
    },
  ], "2026-05-09T00:00:00.000Z");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "連結CFS",
        roots: [workspace],
        fileTypes: ["xlsx"],
      },
      {
        jobId: "job-move-memory",
        useMetadataCache: true,
        metadataCacheDir: cacheDir,
        metadataCacheMaxAgeMs: 0,
        useParsedDocumentCache: true,
        parsedDocumentCacheDir,
        pinnedTargets: [
          {
            kind: "file",
            path: oldPath,
            label: "old CFS",
            createdAt: "2026-05-09T00:00:00.000Z",
          },
        ],
        recentSearches: [
          {
            query: "連結CFS",
            normalizedTerms: ["連結cfs"],
            roots: [workspace],
            fileTypes: ["xlsx"],
            createdAt: "2026-05-09T00:00:00.000Z",
            resultFileIds: ["old-file-id"],
            resultPaths: [oldPath],
          },
        ],
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );

    assert.equal(result.diagnostics.freshness.moved_file_count, 1);
    assert.equal(result.diagnostics.userMemory.moveMigration.highConfidenceMoveCount, 1);
    assert.equal(result.diagnostics.userMemory.moveMigration.migratedPinCount, 1);
    assert.equal(result.diagnostics.userMemory.moveMigration.migratedRecentSearchCount, 1);
    assert.equal(result.diagnostics.derivedContentIndex.ownership.schemaVersion, "RelayDocumentSearchDerivedIndexOwnership.v1");
    assert.equal(result.diagnostics.derivedContentIndex.ownership.highConfidenceMoveCount, 1);
    assert.equal(result.diagnostics.derivedContentIndex.ownership.transferOnRebuildCount, 1);
    assert.equal(result.diagnostics.derivedContentIndex.ownership.moves[0].ownership_owner_file_id, result.results[0].file_id);
    assert.equal(result.diagnostics.derivedContentIndex.ownership.moves[0].cache_reuse_allowed, false);
    assert.equal(result.diagnostics.parsedDocumentCache.moveMigration.schemaVersion, "RelayParsedDocumentCacheMoveMigration.v1");
    assert.equal(result.diagnostics.parsedDocumentCache.moveMigration.highConfidenceMoveCount, 1);
    assert.equal(result.diagnostics.parsedDocumentCache.moveMigration.skippedMissingCacheCount, 1);
    assert.equal(result.results[0].path, newPath);
    assert.equal(result.results[0].score_breakdown.memory, 7);
    assert.equal(result.results[0].source_indexes.some((sourceIndex) => sourceIndex.kind === "user_memory"), true);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
    rmSync(parsedDocumentCacheDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch builds a filename/path index from metadata for ranking diagnostics", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-filename-index-workspace-"));
  const indexDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-filename-index-executor-"));
  writeFileSync(resolve(workspace, "FY160-1Q_連結CFS精算表.xlsx"), "candidate", "utf8");
  writeFileSync(resolve(workspace, "議事録.pdf"), "candidate", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const first = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー CFS 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
      },
      {
        jobId: "job-filename-index-first",
        useFilenameIndex: true,
        filenameIndexDir: indexDir,
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(first.status, "ok");
    assert.equal(first.results[0].display_name, "FY160-1Q_連結CFS精算表.xlsx");
    assert.equal(first.diagnostics.filenameIndex.enabled, true);
    assert.equal(first.diagnostics.filenameIndex.contract, "RelayDocumentSearchFilenameIndex.v1");
    assert.equal(first.diagnostics.filenameIndex.mode, "persistent");
    assert.equal(first.diagnostics.filenameIndex.inMemoryFileCount, 1);
    assert.ok(first.diagnostics.filenameIndex.inMemoryTermCount >= 1);
    assert.equal(first.results[0].score_breakdown.components.rrf.applied, true);
    assert.ok(first.results[0].score_breakdown.rrf_score > 0);
    assert.deepEqual(first.diagnostics.filenameIndex.readHits, []);
    assert.deepEqual(first.diagnostics.filenameIndex.readMisses, [resolve(workspace)]);
    assert.deepEqual(first.diagnostics.filenameIndex.writes, [resolve(workspace)]);
    assert.equal(
      first.diagnostics.queryTrace.stages.find((stage) => stage.name === "metadata_scan").facts.filenameIndex.enabled,
      true,
    );

    const second = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー CFS 精算表",
        roots: [workspace],
        fileTypes: ["xlsx"],
      },
      {
        jobId: "job-filename-index-second",
        useFilenameIndex: true,
        filenameIndexDir: indexDir,
        now: new Date("2026-05-09T00:01:00.000Z"),
      },
    );

    assert.deepEqual(second.diagnostics.filenameIndex.readHits, [resolve(workspace)]);
    assert.deepEqual(second.diagnostics.filenameIndex.readMisses, []);
    assert.equal(second.results[0].display_name, "FY160-1Q_連結CFS精算表.xlsx");
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(indexDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch reports advisory index coordinator events when enabled", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-workspace-"));
  const coordinatorDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-coordinator-"));
  writeFileSync(resolve(workspace, "FY160-1Q_連結CFS精算表.xlsx"), "candidate", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "連結CFS",
        roots: [workspace],
        fileTypes: ["xlsx"],
      },
      {
        jobId: "job-index-coordinator",
        useIndexCoordinator: true,
        indexCoordinatorDir: coordinatorDir,
        now: new Date("2026-05-09T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.diagnostics.indexCoordinator.enabled, true);
    assert.equal(result.diagnostics.indexCoordinator.mode, "advisory");
    assert.equal(result.diagnostics.indexCoordinator.acquired, true);
    assert.equal(result.diagnostics.indexCoordinator.busy, false);
    assert.deepEqual(
      result.diagnostics.indexCoordinator.events.map((event) => event.kind),
      ["lock_acquired", "job_started", "job_finished", "lock_released"],
    );
    assert.deepEqual(
      result.diagnostics.indexDb.recentHealthEvents.map((event) => event.kind),
      ["lock_acquired", "job_started", "job_finished", "lock_released"],
    );
    const indexDbTraceStage = result.diagnostics.queryTrace.stages.find((stage) => stage.name === "index_db");
    assert.equal(indexDbTraceStage.facts.recentHealthEventCount, 4);
    assert.deepEqual(indexDbTraceStage.facts.recentHealthEventKinds, [
      "lock_acquired",
      "job_started",
      "job_finished",
      "lock_released",
    ]);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(coordinatorDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch reports scheduler and backpressure diagnostics", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-scheduler-workspace-"));
  for (let index = 0; index < 5; index += 1) {
    writeFileSync(resolve(workspace, `キャッシュフロー-${index}.txt`), "キャッシュフロー", "utf8");
  }

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
        fileTypes: ["txt"],
        evidence: "required",
        maxResults: 5,
      },
      {
        jobId: "job-scheduler",
        maxContentInspectFiles: 2,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );

    assert.equal(result.diagnostics.scheduler.schemaVersion, "RelayDocumentSearchSchedulerReport.v1");
    assert.equal(result.diagnostics.scheduler.state, "throttled");
    assert.equal(result.diagnostics.scheduler.queueDepth, 3);
    assert.equal(
      result.diagnostics.scheduler.reasons.includes("content_inspection_budget_reached"),
      true,
    );
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch writes a metadata-only sync journal when enabled", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-sync-journal-workspace-"));
  const journalDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-sync-journal-"));
  const fake = createFakeSqliteModule();
  writeFileSync(resolve(workspace, "cashflow-notes.txt"), "document body text about キャッシュフロー", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
        fileTypes: ["txt"],
        evidence: "required",
      },
      {
        jobId: "job-sync-journal",
        queryId: "query-sync-journal",
        useSyncJournal: true,
        syncJournalDir: journalDir,
        useIndexDb: true,
        indexDbSearchMaxRows: 3,
        indexDbPath: resolve(workspace, "document-search.sqlite"),
        sqliteModule: fake.sqliteModule,
        now: new Date("2026-05-10T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.diagnostics.syncJournal.enabled, true);
    assert.equal(result.diagnostics.syncJournal.writtenEventCount >= 3, true);
    assert.equal(result.diagnostics.syncJournal.reconciliation.schemaVersion, "RelayDocumentSearchSyncReconciliation.v1");
    assert.equal(result.diagnostics.syncJournal.reconciliation.rootCount, 1);
    assert.equal(result.diagnostics.syncJournal.reconciliation.periodicDueRootCount, 1);
    assert.equal(result.diagnostics.syncJournal.reconciliation.roots[0].periodicState, "due");
    const journal = JSON.parse(readFileSync(resolve(journalDir, "sync-journal.json"), "utf8"));
    assert.equal(journal.schemaVersion, "RelayDocumentSearchSyncJournal.v1");
    assert.ok(journal.entries.some((entry) => entry.kind === "search_started"));
    assert.ok(journal.entries.some((entry) => entry.kind === "metadata_scan_completed"));
    assert.ok(journal.entries.some((entry) => entry.kind === "content_scan_completed"));
    assert.ok(journal.entries.some((entry) => entry.kind === "search_completed"));
    const completed = journal.entries.find((entry) => entry.kind === "search_completed");
    assert.equal(completed.details.indexDbEnabled, true);
    assert.equal(completed.details.indexDbReadiness, "degraded");
    assert.equal(completed.details.indexDbSchemaReady, true);
    assert.equal(completed.details.indexDbMigrationReady, true);
    assert.equal(completed.details.indexDbWriteReady, true);
    assert.equal(completed.details.indexDbSearchReady, true);
    assert.equal(completed.details.indexDbEvidencePromotionReady, false);
    assert.equal(completed.details.indexDbSearchMatchedFileCount, 1);
    assert.equal(completed.details.indexDbCurrentScanMatchedFileCount, 1);
    assert.equal(completed.details.indexDbFreshCurrentScanMatchedFileCount, 0);
    assert.equal(completed.details.indexDbStaleCurrentScanMatchedFileCount, 1);
    assert.equal(completed.details.indexDbOutsideCurrentScanMatchedFileCount, 0);
    assert.equal(completed.details.indexDbStaleEvidenceRowCount, 1);
    assert.equal(
      completed.details.indexDbStaleEvidenceReasons,
      "missing_anchor=1,missing_parsed_document_uid=1,missing_preview_text=1,missing_source_metadata_version=1",
    );
    assert.equal(completed.details.indexDbCandidateScoreTotal, 0);
    assert.equal(completed.details.indexDbMaxCandidateScore, 0);
    assert.equal(completed.details.indexDbReturnedScoreTotal, 0);
    assert.equal(completed.details.indexDbMaxReturnedScore, 0);
    assert.equal(completed.details.indexDbCandidateUncappedScoreTotal, 0);
    assert.equal(completed.details.indexDbReturnedUncappedScoreTotal, 0);
    assert.equal(completed.details.indexDbCandidateScoreCapLossTotal, 0);
    assert.equal(completed.details.indexDbReturnedScoreCapLossTotal, 0);
    assert.equal(completed.details.indexDbScoreCappedCandidateCount, 0);
    assert.equal(completed.details.indexDbScoreCappedResultCount, 0);
    assert.equal(completed.details.indexDbNonReturnedScoredCandidateCount, 0);
    assert.equal(completed.details.indexDbNonReturnedPromotedCandidateCount, 0);
    assert.equal(completed.details.indexDbNonReturnedScoreTotal, 0);
    assert.equal(completed.details.indexDbScoredCandidateCount, 0);
    assert.equal(completed.details.indexDbScoredResultCount, 0);
    assert.equal(completed.details.indexDbPromotedCandidateCount, 0);
    assert.equal(completed.details.indexDbPromotedResultCount, 0);
    assert.equal(completed.details.indexDbSearchMaxRows, 3);
    assert.equal(completed.details.indexDbSearchRawRowCount, 1);
    assert.equal(completed.details.indexDbSearchDroppedRowCount, 0);
    assert.equal(completed.details.indexDbSearchTruncated, false);
    assert.equal(completed.details.indexDbCurrentScanFtsRowCount, 1);
    assert.equal(completed.details.indexDbFreshCurrentScanFtsRowCount, 0);
    assert.equal(completed.details.indexDbMetadataBoostedFreshFtsRowCount, 0);
    assert.equal(completed.details.indexDbMetadataBoostedFreshFtsFileCount, 0);
    assert.equal(completed.details.indexDbTitleBoostedFreshFtsRowCount, 0);
    assert.equal(completed.details.indexDbTitleBoostedFreshFtsFileCount, 0);
    assert.equal(completed.details.indexDbLocationBoostedFreshFtsRowCount, 0);
    assert.equal(completed.details.indexDbLocationBoostedFreshFtsFileCount, 0);
    assert.equal(completed.details.indexDbStaleCurrentScanFtsRowCount, 1);
    assert.equal(completed.details.indexDbStaleCurrentScanFtsFileCount, 1);
    assert.equal(JSON.stringify(journal).includes("document body text"), false);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
    rmSync(journalDir, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch applies query-plan exclusions, recency boost, and candidate buckets", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-query-plan-filter-workspace-"));
  const workDir = resolve(workspace, "02CFS-作業-精算表");
  const backupDir = resolve(workspace, "backup");
  const filingDir = resolve(workspace, "ファイリング");
  mkdirSync(workDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(filingDir, { recursive: true });
  const currentWorkpaper = resolve(workDir, "FY160_連結CFS精算表.xlsx");
  const oldWorkpaper = resolve(workDir, "FY159_連結CFS精算表.xlsx");
  const backupWorkpaper = resolve(backupDir, "FY160_連結CFS精算表_backup.xlsx");
  const filingOutput = resolve(filingDir, "Final_連結キャッシュフロー計算書.xlsx");
  writeFileSync(currentWorkpaper, "placeholder", "utf8");
  writeFileSync(oldWorkpaper, "placeholder", "utf8");
  writeFileSync(backupWorkpaper, "placeholder", "utf8");
  writeFileSync(filingOutput, "placeholder", "utf8");
  const currentTime = new Date("2026-05-10T00:00:00.000Z");
  const oldTime = new Date("2024-05-10T00:00:00.000Z");
  utimesSync(currentWorkpaper, currentTime, currentTime);
  utimesSync(oldWorkpaper, oldTime, oldTime);
  utimesSync(backupWorkpaper, currentTime, currentTime);
  utimesSync(filingOutput, currentTime, currentTime);

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "最新の連結キャッシュフロー計算書 精算表を探して。バックアップ除外。",
        roots: [workspace],
        fileTypes: ["xlsx"],
        evidence: "candidate",
        thoroughness: "quick",
      },
      {
        jobId: "job-query-plan-filter",
        now: new Date("2026-05-12T00:00:00.000Z"),
      },
    );

    assert.equal(result.status, "ok");
    assert.equal(result.queryPlan.recencyPreference, "prefer_recent");
    assert.ok(result.queryPlan.excludedTerms.includes("バックアップ"));
    assert.equal(result.coverage.excludedByQueryPlanCount, 1);
    assert.equal(
      result.results.some((candidate) => String(candidate.path).includes("backup")),
      false,
    );
    assert.equal(result.results[0].path, currentWorkpaper);
    assert.equal(result.results[0].candidate_bucket, "direct_source_workpaper");
    assert.equal(result.evidencePack.candidate_files[0].candidate_bucket, "direct_source_workpaper");
    assert.equal(result.localDraft.sections.some((section) => section.kind === "candidate_map"), true);
    assert.equal(result.results[0].score_breakdown.recency > 0, true);
    assert.equal(result.diagnostics.candidateBuckets.direct_source_workpaper >= 1, true);
    assert.equal(result.diagnostics.queryFiltering.excludedByQueryPlanCount, 1);
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch asks for a folder when no roots are supplied", async () => {
  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch({
      query: "資料を探して",
    });

    assert.equal(result.status, "needs_input");
    assert.match(result.display.beginnerSummary, /フォルダを選んでください/);
  } finally {
    cleanup();
  }
});

test("executeRelayDocumentSearch returns a timeout partial instead of blocking broad scans", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-timeout-"));
  writeFileSync(resolve(workspace, "FY160-1Q_連結CFS精算表.xlsx"), "candidate", "utf8");

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
      },
      {
        jobId: "job-timeout",
        timeoutMs: 0,
      },
    );

    assert.equal(result.status, "partial");
    assert.equal(result.progress.stage, "timeout_partial");
    assert.equal(result.diagnostics.timedOut, true);
    assert.ok(result.evidencePack.warnings.some((warning) => warning.code === "timeout_partial"));
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("executeRelayDocumentSearch returns a cancelled partial when the signal is already aborted", async () => {
  const workspace = mkdtempSync(resolve(tmpdir(), "relay-document-search-cancelled-"));
  writeFileSync(resolve(workspace, "FY160-1Q_連結CFS精算表.xlsx"), "candidate", "utf8");
  const controller = new AbortController();
  controller.abort();

  const { module, cleanup } = await loadExecutorModule();
  try {
    const result = await module.executeRelayDocumentSearch(
      {
        query: "キャッシュフロー",
        roots: [workspace],
      },
      {
        jobId: "job-cancelled",
        signal: controller.signal,
      },
    );

    assert.equal(result.status, "partial");
    assert.equal(result.progress.stage, "cancelled");
    assert.equal(result.job.lifecycle, "cancelled");
    assert.equal(result.diagnostics.cancelled, true);
    assert.ok(result.evidencePack.warnings.some((warning) => warning.code === "cancelled"));
  } finally {
    cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
});
