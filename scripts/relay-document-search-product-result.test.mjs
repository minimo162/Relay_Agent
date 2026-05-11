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
const productResultPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchProductResult.ts",
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

async function loadProductResultModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-product-result-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchProductResult.mjs"),
    transpile(productResultPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchProductResult.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function baseInput(overrides = {}) {
  return {
    resultId: "result-file-1",
    fileId: "file-1",
    path: "H:/shr1/160連結/CFS.xlsx",
    displayName: "CFS.xlsx",
    displayPath: "160連結/CFS.xlsx",
    extension: "xlsx",
    modifiedTime: "2026-05-10T00:00:00.000Z",
    sourceMetadataVersion: "file-1:100:1",
    matchMode: "content",
    evidenceState: "content_confirmed",
    indexState: "content_indexed",
    score: 12,
    scoreBreakdown: { filename: 1, content: 10, base_score: 12, final_score: 12 },
    anchors: [{ type: "cell_excerpt", cell_address: "A1", snippet: "キャッシュフロー" }],
    warnings: [],
    actions: ["preview", "open-file", "copy-path", "pin-result", "use-as-evidence"],
    ...overrides,
  };
}

test("product result contract builds preview/open actions independent of Copilot", async () => {
  const { module, cleanup } = await loadProductResultModule();
  try {
    const result = module.buildRelayDocumentSearchProductResult(baseInput());
    assert.equal(result.product_result_contract, "RelayDocumentSearchProductResult.v1");
    assert.equal(result.preview_state, "preview_ready");
    assert.equal(result.open_state, "open_ready");
    assert.equal(result.preview_action.kind, "preview");
    assert.equal(result.preview_action.enabled, true);
    assert.equal(result.open_action.kind, "open_file");
    assert.equal(result.open_action.enabled, true);
    assert.equal(result.score_breakdown.score_breakdown_contract, "RelayDocumentSearchScoreBreakdown.v1");
    assert.equal(result.score_breakdown.rankingVersion, "relay-deterministic-ranker-v1");
    assert.equal(result.score_breakdown.deterministic, true);
    assert.equal(result.score_breakdown.components.content.score, 10);
    assert.equal(result.score_breakdown.totals.finalScore, 12);
    assert.deepEqual(result.score_breakdown.tieBreakers, [
      "score",
      "content_evidence",
      "pin_history",
      "base_score",
      "warning_penalty",
      "modified_time",
      "display_path",
      "file_id",
    ]);
    assert.equal(result.primary_source_index, "table_index");
    assert.equal(result.source_indexes.some((sourceIndex) => sourceIndex.kind === "derived_content_index"), true);
    assert.equal(result.source_indexes.some((sourceIndex) => sourceIndex.kind === "table_index"), true);
    assert.equal(result.source_indexes.some((sourceIndex) => sourceIndex.kind === "preview_anchor_index"), true);
    assert.equal(result.ui_state.answerCitationAllowed, true);
    assert.equal(result.ui_state.previewIndependentOfCopilot, true);
    assert.equal(result.ui_state.openIndependentOfCopilot, true);
    assert.equal(result.ui_state.stableSelectionKey, "file-1");
    assert.equal(result.ui_state.stableSelectionKeyStrategy, "file_id");
    assert.ok(result.action_models.some((action) => action.kind === "open_containing_folder"));
    assert.deepEqual(module.validateRelayDocumentSearchProductResult(result), { ok: true, errors: [] });
  } finally {
    cleanup();
  }
});

test("product result contract keeps selection keys stable across metadata refresh", async () => {
  const { module, cleanup } = await loadProductResultModule();
  try {
    const before = module.buildRelayDocumentSearchProductResult(baseInput({ sourceMetadataVersion: "file-1:100:1" }));
    const after = module.buildRelayDocumentSearchProductResult(baseInput({ sourceMetadataVersion: "file-1:200:2" }));
    assert.equal(before.ui_state.stableSelectionKey, "file-1");
    assert.equal(after.ui_state.stableSelectionKey, "file-1");
    assert.equal(after.ui_state.stableSelectionKeyStrategy, "file_id");
  } finally {
    cleanup();
  }
});

test("product result contract keeps filename-only candidates non-citable", async () => {
  const { module, cleanup } = await loadProductResultModule();
  try {
    const result = module.buildRelayDocumentSearchProductResult(
      baseInput({
        matchMode: "filename",
        evidenceState: "filename_only",
        indexState: "metadata_indexed",
        anchors: [],
        warnings: ["filename_only"],
        actions: ["preview", "open-file", "copy-path", "pin-result", "refine-search"],
      }),
    );
    assert.equal(result.preview_state, "preview_pending");
    assert.equal(result.open_state, "open_ready");
    assert.equal(result.score_breakdown.components.filename.count, 1);
    assert.equal(result.primary_source_index, "filename_fallback");
    assert.equal(result.source_indexes.some((sourceIndex) => sourceIndex.kind === "filename_fallback"), true);
    assert.equal(result.ui_state.evidenceLinkable, false);
    assert.equal(result.ui_state.answerCitationAllowed, false);
    assert.equal(result.action_models.find((action) => action.kind === "use_as_evidence"), undefined);
  } finally {
    cleanup();
  }
});

test("product result contract maps access warnings to preview and open states", async () => {
  const { module, cleanup } = await loadProductResultModule();
  try {
    const denied = module.buildRelayDocumentSearchProductResult(
      baseInput({
        warnings: ["access_denied", "preview_denied", "open_denied"],
      }),
    );
    assert.equal(denied.preview_state, "preview_denied");
    assert.equal(denied.open_state, "open_denied");
    assert.equal(denied.preview_action.enabled, false);
    assert.equal(denied.open_action.enabled, false);
    assert.equal(denied.ui_state.answerCitationAllowed, false);

    const offline = module.buildRelayDocumentSearchProductResult(
      baseInput({
        warnings: ["offline_share", "open_offline"],
      }),
    );
    assert.equal(offline.preview_state, "preview_unavailable");
    assert.equal(offline.open_state, "open_offline");
  } finally {
    cleanup();
  }
});

test("product result contract adds repair actions for stale or failed index states", async () => {
  const { module, cleanup } = await loadProductResultModule();
  try {
    const result = module.buildRelayDocumentSearchProductResult(
      baseInput({
        evidenceState: "stale",
        indexState: "stale",
        warnings: ["stale", "failed"],
        actions: ["preview", "open-file", "copy-path"],
      }),
    );
    const retry = result.action_models.find((action) => action.kind === "retry_result");
    const rebuild = result.action_models.find((action) => action.kind === "rebuild_index");
    assert.equal(retry.enabled, true);
    assert.equal(rebuild.enabled, true);
    assert.equal(result.preview_state, "preview_stale");
  } finally {
    cleanup();
  }
});
