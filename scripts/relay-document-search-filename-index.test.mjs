import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadataCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMetadataCache.ts",
);
const queryPlanPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryPlan.ts",
);
const filenameIndexPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchFilenameIndex.ts",
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

async function loadFilenameIndexModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-filename-index-module-"));
  await import("node:fs").then(({ writeFileSync }) => {
    writeFileSync(resolve(dir, "relayDocumentSearchMetadataCache.mjs"), transpile(metadataCachePath), "utf8");
    writeFileSync(resolve(dir, "relayDocumentSearchQueryPlan.mjs"), transpile(queryPlanPath), "utf8");
    writeFileSync(
      resolve(dir, "relayDocumentSearchFilenameIndex.mjs"),
      transpile(filenameIndexPath)
        .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';")
        .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
      "utf8",
    );
  });
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchFilenameIndex.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function file(root, displayPath, name, extension) {
  return {
    fileId: `file-${name}`,
    root,
    path: resolve(root, displayPath),
    displayPath,
    name,
    extension,
    size: 128,
    modifiedTime: "2026-05-09T00:00:00.000Z",
    sourceMetadataVersion: `source-${name}`,
  };
}

test("filename index ranks CJK and accounting filename/path matches without content", async () => {
  const root = resolve(mkdtempSync(resolve(tmpdir(), "relay-document-search-filename-index-")));
  const { module, cleanup } = await loadFilenameIndexModule();
  try {
    const index = module.buildRelayDocumentSearchFilenameIndex(
      root,
      [
        file(root, "160期-1Q/作業/FY160-1Q_連結CFS精算表.xlsx", "FY160-1Q_連結CFS精算表.xlsx", "xlsx"),
        file(root, "160期-1Q/監査資料/XSA_連結CF.xlsx", "XSA_連結CF.xlsx", "xlsx"),
        file(root, "総務/議事録.pdf", "議事録.pdf", "pdf"),
      ],
      { now: new Date("2026-05-09T00:00:00.000Z") },
    );

    assert.equal(index.schemaVersion, "RelayDocumentSearchFilenameIndex.v1");
    assert.equal(index.indexVersion, 2);
    assert.equal(index.normalizerVersion, "relay-query-normalizer-v1");
    assert.equal(index.stats.fileCount, 3);
    assert.ok(index.stats.termCount >= 3);
    assert.ok(index.stats.postingCount >= index.stats.termCount);
    assert.ok(index.invertedIndex.cfs.includes("file-FY160-1Q_連結CFS精算表.xlsx"));

    const matches = module.searchRelayDocumentSearchFilenameIndex(
      index,
      ["キャッシュフロー", "cfs", "cf", "精算表"],
      { fileTypes: ["xlsx"], maxResults: 10 },
    );
    assert.equal(matches[0].displayPath, "160期-1Q/作業/FY160-1Q_連結CFS精算表.xlsx");
    assert.ok(matches[0].score > matches[1].score);
    assert.ok(matches[0].reasons.some((reason) => reason.startsWith("filename:")));
    assert.ok(matches.every((match) => match.displayPath.endsWith(".xlsx")));
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("filename index uses inverted postings for partial Latin and CJK narrowing", async () => {
  const root = resolve(mkdtempSync(resolve(tmpdir(), "relay-document-search-filename-index-inverted-")));
  const { module, cleanup } = await loadFilenameIndexModule();
  try {
    const index = module.buildRelayDocumentSearchFilenameIndex(
      root,
      [
        file(root, "作業/Cashflow_Workpaper.xlsx", "Cashflow_Workpaper.xlsx", "xlsx"),
        file(root, "作業/連結キャッシュフロー計算書.xlsx", "連結キャッシュフロー計算書.xlsx", "xlsx"),
        file(root, "作業/Presentation.pptx", "Presentation.pptx", "pptx"),
      ],
      { now: new Date("2026-05-09T00:00:00.000Z") },
    );

    const latin = module.searchRelayDocumentSearchFilenameIndex(index, ["cash"], { maxResults: 10 });
    assert.equal(latin.length, 1);
    assert.equal(latin[0].displayPath, "作業/Cashflow_Workpaper.xlsx");

    const cjk = module.searchRelayDocumentSearchFilenameIndex(index, ["キャッシュフロー"], { maxResults: 10 });
    assert.equal(cjk.length, 1);
    assert.equal(cjk[0].displayPath, "作業/連結キャッシュフロー計算書.xlsx");
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("filename index avoids CJK ngram-only broadening when direct compound matches exist", async () => {
  const root = resolve(mkdtempSync(resolve(tmpdir(), "relay-document-search-filename-index-compound-")));
  const { module, cleanup } = await loadFilenameIndexModule();
  try {
    const index = module.buildRelayDocumentSearchFilenameIndex(
      root,
      [
        file(
          root,
          "160期-1Q/連結決算/08未実現利益-棚卸資産/2_実績データ/1_原価/301 自動車・部品他売上総利益(easyGKAJ)_160_1Q.xlsx",
          "301 自動車・部品他売上総利益(easyGKAJ)_160_1Q.xlsx",
          "xlsx",
        ),
        file(
          root,
          "160期-1Q/連結決算/08未実現利益-棚卸資産/2_実績データ/2_国内DL・部販/FY160-1Q_販社・パーツ残高_DBLink.xlsx",
          "FY160-1Q_販社・パーツ残高_DBLink.xlsx",
          "xlsx",
        ),
        file(
          root,
          "160期-1Q/連結決算/08未実現利益-棚卸資産/2_実績データ/1_原価/302 自動車国別月別売上総利益(easyG009U)_160_1Q.xlsx",
          "302 自動車国別月別売上総利益(easyG009U)_160_1Q.xlsx",
          "xlsx",
        ),
      ],
      { now: new Date("2026-05-09T00:00:00.000Z") },
    );

    const matches = module.searchRelayDocumentSearchFilenameIndex(
      index,
      ["部品売上", "部品他売上", "部販", "パーツ"],
      { fileTypes: ["xlsx"], maxResults: 10 },
    );
    assert.deepEqual(
      matches.map((match) => match.displayPath),
      [
        "160期-1Q/連結決算/08未実現利益-棚卸資産/2_実績データ/2_国内DL・部販/FY160-1Q_販社・パーツ残高_DBLink.xlsx",
        "160期-1Q/連結決算/08未実現利益-棚卸資産/2_実績データ/1_原価/301 自動車・部品他売上総利益(easyGKAJ)_160_1Q.xlsx",
      ],
    );
    assert.equal(
      matches.some((match) => match.displayPath.includes("302 自動車国別月別売上総利益")),
      false,
    );
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});

test("filename index persists and rejects stale normalizer-compatible records by age", async () => {
  const root = resolve(mkdtempSync(resolve(tmpdir(), "relay-document-search-filename-index-store-")));
  const indexDir = mkdtempSync(resolve(tmpdir(), "relay-document-search-filename-index-store-dir-"));
  const { module, cleanup } = await loadFilenameIndexModule();
  try {
    await module.writeRelayDocumentSearchFilenameIndex(
      root,
      [file(root, "作業/FY160-1Q_連結CFS精算表.xlsx", "FY160-1Q_連結CFS精算表.xlsx", "xlsx")],
      { indexDir, now: new Date("2026-05-09T00:00:00.000Z") },
    );

    const fresh = await module.readRelayDocumentSearchFilenameIndex(root, {
      indexDir,
      maxAgeMs: 10 * 60 * 1000,
      now: new Date("2026-05-09T00:05:00.000Z"),
    });
    assert.equal(fresh.stats.fileCount, 1);

    const stale = await module.readRelayDocumentSearchFilenameIndex(root, {
      indexDir,
      maxAgeMs: 10 * 60 * 1000,
      now: new Date("2026-05-09T00:11:00.000Z"),
    });
    assert.equal(stale, undefined);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
    rmSync(indexDir, { recursive: true, force: true });
  }
});
