import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const metadataCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMetadataCache.ts",
);
const queryPlanPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryPlan.ts",
);
const groupingPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchResultGrouping.ts",
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

async function loadGroupingModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-result-grouping-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchMetadataCache.mjs"), transpile(metadataCachePath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchQueryPlan.mjs"), transpile(queryPlanPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchResultGrouping.mjs"),
    transpile(groupingPath)
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchResultGrouping.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function file(root, displayPath, name, modifiedTime = "2026-05-09T00:00:00.000Z") {
  return {
    fileId: `file-${displayPath}`,
    root,
    path: resolve(root, displayPath),
    displayPath,
    name,
    extension: "xlsx",
    size: 100,
    modifiedTime,
    sourceMetadataVersion: `source-${displayPath}`,
  };
}

test("result grouping collapses backup/copy variants under a non-variant representative", async () => {
  const root = resolve(mkdtempSync(resolve(tmpdir(), "relay-document-search-grouping-")));
  const { module, cleanup } = await loadGroupingModule();
  try {
    const current = { file: file(root, "作業/FY160-1Q_連結CFS精算表.xlsx", "FY160-1Q_連結CFS精算表.xlsx"), score: 12 };
    const backup = { file: file(root, "作業/backup/FY160-1Q_連結CFS精算表.xlsx", "FY160-1Q_連結CFS精算表.xlsx"), score: 20 };
    const copy = { file: file(root, "作業/FY160-1Q_連結CFS精算表 copy.xlsx", "FY160-1Q_連結CFS精算表 copy.xlsx"), score: 18 };
    const unrelated = { file: file(root, "作業/FY160-2Q_連結CFS精算表.xlsx", "FY160-2Q_連結CFS精算表.xlsx"), score: 10 };

    const grouped = module.groupRelayDocumentSearchCandidates([backup, copy, current, unrelated]);

    assert.equal(grouped.diagnostics.schemaVersion, "RelayDocumentSearchResultGrouping.v1");
    assert.equal(grouped.diagnostics.groupCount, 1);
    assert.equal(grouped.diagnostics.groupedCandidateCount, 3);
    assert.equal(grouped.diagnostics.collapsedCandidateCount, 2);
    assert.equal(grouped.candidates.length, 2);
    assert.equal(grouped.candidates[0].file.fileId, current.file.fileId);
    assert.equal(grouped.groups[0].representativeFileId, current.file.fileId);
    assert.equal(grouped.groups[0].memberCount, 3);
    assert.equal(grouped.groups[0].score_breakdown.score_breakdown_contract, "RelayDocumentSearchScoreBreakdown.v1");
    assert.equal(grouped.groups[0].score_breakdown.groupingScore, 0);
    assert.equal(grouped.groups[0].score_breakdown.representativeScore, 12);
    assert.equal(grouped.groups[0].score_breakdown.highestMemberScore, 20);
    assert.equal(grouped.groups[0].score_breakdown.collapsedMemberScoreTotal, 38);
    assert.ok(grouped.groups[0].variantReasons.includes("variant_path"));
    assert.ok(!grouped.groupsByFileId.has(unrelated.file.fileId));
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
