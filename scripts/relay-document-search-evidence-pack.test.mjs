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
const queryPlanPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryPlan.ts",
);
const evidencePackPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchEvidencePack.ts",
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

async function loadEvidencePackModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-evidence-pack-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(resolve(dir, "relayDocumentSearchQueryPlan.mjs"), transpile(queryPlanPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchEvidencePack.mjs"),
    transpile(evidencePackPath)
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchQueryPlan';", "from './relayDocumentSearchQueryPlan.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchEvidencePack.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("Evidence Pack contract separates candidates, evidence, coverage, and AI boundary", async () => {
  const { module, cleanup } = await loadEvidencePackModule();
  try {
    const pack = module.buildRelayDocumentSearchEvidencePack({
      jobId: "job-1",
      queryId: "query-1",
      generatedAt: "2026-05-10T00:00:00.000Z",
      request: {
        schemaVersion: "RelayDocumentSearchRequest.v1",
        query: "キャッシュフロー 精算表",
        roots: ["H:/shr1"],
        intent: "answer_with_evidence",
        thoroughness: "thorough",
        fileTypes: ["xlsx"],
        maxResults: 10,
        evidence: "required",
      },
      queryPlan: {
        schemaVersion: "RelayDocumentSearchQueryPlan.v1",
        normalizerVersion: "relay-query-normalizer-v1",
        mode: "evidence",
        originalQuery: "キャッシュフロー 精算表",
        normalizedTerms: ["キャッシュフロー", "精算表"],
        synonymExpansions: [],
        periodHints: ["160-1Q"],
        fileTypeHints: ["xlsx"],
        rejectedTokens: [],
        confirmationPolicy: "content_required",
        readerCapabilities: {},
      },
      roots: ["H:/shr1"],
      metadataScannedFiles: 25,
      contentScannedFiles: 3,
      skippedFiles: 1,
      inaccessiblePathCount: 0,
      truncated: false,
      cancelled: false,
      timedOut: false,
      results: [
        {
          result_id: "result-file-1",
          file_id: "file-1",
          path: "H:/shr1/CFS.xlsx",
          display_path: "CFS.xlsx",
          display_name: "CFS.xlsx",
          file_type: "xlsx",
          source_metadata_version: "file-1:100:1",
          match_mode: "content",
          evidence_state: "content_confirmed",
          index_state: "content_indexed",
          score: 10,
          score_breakdown: { content: 10 },
          source_indexes: [{ kind: "derived_content_index", label: "本文索引", state: "used" }],
          warnings: [],
          anchors: [{ type: "cell_excerpt", cell_address: "A1" }],
        },
      ],
      contentEvidence: [
        {
          fileId: "file-1",
          parsedDocumentUid: "parsed-file-1",
          parsedDocumentVersion: "relay-ir-v1",
          parser: { name: "relay-office-openxml", version: "v1", profile: "spreadsheet" },
          documentMetadata: {
            uid: "parsed-file-1",
            file_name: "CFS.xlsx",
            file_type: "xlsx",
            size: 100,
            modified_time: 1,
            extra_data: {
              sheet_count: 1,
              structure_profile: {
                schemaVersion: "RelayParsedDocumentStructureProfile.v1",
                profile: "spreadsheet",
                status: "valid",
                treeNodeCount: 3,
                tableCount: 1,
                cellCount: 2,
                annotationCount: 0,
                warningCount: 0,
                lossyWarningCount: 0,
                unsupportedWarningCount: 0,
              },
            },
          },
          warnings: [{ code: "hidden_sheet", severity: "warning" }],
          evidence: [
            {
              file_id: "file-1",
              path: "H:/shr1/CFS.xlsx",
              display_path: "CFS.xlsx",
              evidence_state: "content_confirmed",
              source_metadata_version: "file-1:100:1",
              parsed_document_uid: "parsed-file-1",
              anchor: { type: "cell_excerpt", sheet_name: "CF", cell_address: "A1", snippet: "キャッシュフロー" },
            },
          ],
        },
      ],
      warnings: [{ code: "content_confirmed", message: "Some candidates include local text evidence." }],
    });

    assert.equal(pack.schemaVersion, "RelayDocumentSearchEvidencePack.v1");
    assert.equal(pack.evidence_pack_id, "evidence-pack-query-1");
    assert.equal(pack.coverage.metadataScannedFiles, 25);
    assert.equal(pack.coverage.contentEvidenceFileCount, 1);
    assert.equal(pack.candidate_files[0].result_id, "result-file-1");
    assert.equal(pack.evidence[0].result_id, "result-file-1");
    assert.equal(pack.evidence[0].document_metadata.file_name, "CFS.xlsx");
    assert.equal(pack.evidence[0].parser.profile, "spreadsheet");
    assert.equal(pack.evidence[0].structure_profile.schemaVersion, "RelayParsedDocumentStructureProfile.v1");
    assert.equal(pack.evidence[0].structure_profile.profile, "spreadsheet");
    assert.equal(pack.evidence[0].structure_profile.status, "valid");
    assert.equal(pack.evidence[0].structure_profile.cellCount, 2);
    assert.equal(pack.ai_boundary.originalFilesIncluded, false);
    assert.equal(pack.ai_boundary.parsedDocumentPayloadIncluded, false);
    assert.deepEqual(module.validateRelayDocumentSearchEvidencePack(pack), { ok: true, errors: [] });
  } finally {
    cleanup();
  }
});

test("Evidence Pack validator rejects missing AI boundary", async () => {
  const { module, cleanup } = await loadEvidencePackModule();
  try {
    const invalid = module.validateRelayDocumentSearchEvidencePack({
      schemaVersion: "RelayDocumentSearchEvidencePack.v1",
      evidence_pack_id: "evidence-pack-x",
      job_id: "job-x",
      generated_at: "2026-05-10T00:00:00.000Z",
      query_plan: {},
      coverage: {},
      candidate_files: [],
      evidence: [],
      warnings: [],
    });

    assert.equal(invalid.ok, false);
    assert.match(invalid.errors.join("\n"), /ai_boundary is required/);
  } finally {
    cleanup();
  }
});
