import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const metadataCachePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchMetadataCache.ts",
);
const indexReportPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchIndexReport.ts",
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

async function loadIndexReportModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-index-report-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchMetadataCache.mjs"), transpile(metadataCachePath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchIndexReport.mjs"),
    transpile(indexReportPath)
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchMetadataCache';", "from './relayDocumentSearchMetadataCache.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchIndexReport.mjs")).href),
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
    size: 100,
    modifiedTime: "2026-05-09T00:00:00.000Z",
    sourceMetadataVersion: `source-${name}`,
  };
}

test("index report summarizes per-root metadata, filename, content, and cache state", async () => {
  const root = resolve(mkdtempSync(resolve(tmpdir(), "relay-document-search-index-report-")));
  const { module, cleanup } = await loadIndexReportModule();
  try {
    const xlsx = file(root, "作業/FY160-1Q_連結CFS精算表.xlsx", "FY160-1Q_連結CFS精算表.xlsx", "xlsx");
    const pdf = file(root, "ファイリング/議事録.pdf", "議事録.pdf", "pdf");
    const report = module.buildRelayDocumentSearchIndexReport({
      generatedAt: "2026-05-09T00:00:00.000Z",
      status: "partial",
      roots: [root],
      allFiles: [xlsx, pdf],
      filteredFiles: [xlsx],
      results: [{ file_id: xlsx.fileId }],
      contentEvidenceFileIds: [],
      inaccessiblePaths: [resolve(root, "denied")],
      requestedFileTypes: ["xlsx"],
      cancelled: false,
      timedOut: false,
      truncated: false,
      metadataCache: { hits: [], misses: [root], writes: [root], writeErrors: [] },
      filenameIndex: { enabled: true, readHits: [], readMisses: [root], writes: [root], writeErrors: [] },
      contentCaches: {
        parsedDocument: {
          enabled: true,
          policies: [{ readAllowed: false, writeAllowed: false }],
          quotas: [
            {
              entryCount: 2,
              totalBytes: 2048,
              maxCacheEntries: 3,
              maxCacheBytes: 4096,
              quotaPressure: false,
              evicted: [{ bytes: 512 }],
            },
          ],
          writeErrors: [],
        },
        derivedContentIndex: {
          enabled: true,
          policies: [{ readAllowed: true, writeAllowed: true }],
          quotas: [
            {
              entryCount: 1,
              totalBytes: 1024,
              maxCacheEntries: 2,
              maxCacheBytes: 2048,
              quotaPressure: true,
              evicted: [],
            },
          ],
          writeErrors: [{ path: "ignored-in-report" }],
        },
      },
    });

    assert.equal(report.schemaVersion, "RelayDocumentSearchIndexReport.v1");
    assert.equal(report.summary.rootCount, 1);
    assert.equal(report.summary.scannedFiles, 2);
    assert.equal(report.summary.filenameSearchableFiles, 1);
    assert.equal(report.summary.contentReadyFiles, 0);
    assert.equal(report.summary.incompleteRootCount, 1);
    assert.equal(report.roots[0].state, "partial");
    assert.equal(report.roots[0].cache.metadata, "written");
    assert.equal(report.roots[0].cache.filenameIndex, "written");
    assert.equal(report.roots[0].skippedExtensionCounts.pdf, 1);
    assert.equal(report.cache.parsedDocument.policyDenied, true);
    assert.equal(report.cache.parsedDocument.totalBytes, 2048);
    assert.equal(report.cache.parsedDocument.evictedBytes, 512);
    assert.equal(report.cache.derivedContentIndex.quotaPressure, true);
    assert.equal(report.cache.derivedContentIndex.writeErrorCount, 1);
    assert.deepEqual(report.roots[0].warnings, [
      "inaccessible_paths",
      "extension_filter_applied",
      "filename_only_candidates",
    ]);
  } finally {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
