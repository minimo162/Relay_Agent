import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const queryPlanPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchQueryPlan.ts",
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

async function loadQueryPlanModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-query-plan-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchQueryPlan.mjs"), transpile(queryPlanPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchQueryPlan.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test("Relay document search query plan normalizes accounting terms and period hints", async () => {
  const { module, cleanup } = await loadQueryPlanModule();
  try {
    const plan = module.buildRelayDocumentSearchQueryPlan(
      {
        schemaVersion: "RelayDocumentSearchRequest.v1",
        query: "160期-1Q の C/F 精算表 Excel を探して",
        roots: ["H:/shr1/05_経理部"],
        intent: "answer_with_evidence",
        thoroughness: "thorough",
        fileTypes: ["any"],
        maxResults: 50,
        evidence: "required",
      },
      ["H:/shr1/05_経理部"],
    );

    assert.equal(plan.schemaVersion, "RelayDocumentSearchQueryPlan.v1");
    assert.equal(plan.normalizerVersion, "relay-query-normalizer-v1");
    assert.equal(plan.mode, "answer");
    assert.equal(plan.contentStrategy, "answer_required");
    assert.equal(plan.confirmationPolicy, "content_required");
    assert.equal(plan.timeScopeIntent, "explicit_period");
    assert.equal(plan.timeScopeReason, "period_hint_detected");
    assert.ok(plan.normalizedTerms.includes("キャッシュフロー"));
    assert.ok(plan.normalizedTerms.includes("cfs"));
    assert.ok(plan.normalizedTerms.includes("精算表"));
    assert.ok(plan.periodHints.includes("160期-1Q"));
    assert.ok(plan.periodHints.includes("FY160-1Q"));
    assert.deepEqual(plan.fileTypeHints, ["xlsx"]);
    assert.deepEqual(plan.synonymExpansions.map((item) => item.source), ["cash_flow", "adjustment"]);
  } finally {
    cleanup();
  }
});

test("Relay document search query plan extracts finance terms from unspaced Japanese requests", async () => {
  const { module, cleanup } = await loadQueryPlanModule();
  try {
    const plan = module.buildRelayDocumentSearchQueryPlan(
      {
        schemaVersion: "RelayDocumentSearchRequest.v1",
        query: "このフォルダからキャッシュフロー計算書に関係するファイルを探して",
        roots: ["H:/shr1/05_経理部/03_連結財務G/160連結"],
        intent: "find_files",
        thoroughness: "quick",
        fileTypes: ["any"],
        maxResults: 80,
        evidence: "candidate",
      },
      ["H:/shr1/05_経理部/03_連結財務G/160連結"],
    );

    assert.equal(plan.mode, "filename");
    assert.equal(plan.contentStrategy, "candidate_first");
    assert.equal(plan.recencyPreference, "neutral");
    assert.equal(plan.timeScopeIntent, "balanced");
    assert.ok(plan.normalizedTerms.includes("キャッシュフロー計算書"));
    assert.ok(plan.normalizedTerms.includes("キャッシュフロー"));
    assert.ok(plan.ignoredIntentTerms.some((term) => term.startsWith("folder_reference:")));
    assert.ok(plan.ignoredIntentTerms.some((term) => term.startsWith("search_instruction:")));
    assert.equal(plan.normalizedTerms.includes("このフォルダ"), false);
    assert.equal(plan.normalizedTerms.includes("ファイル"), false);
  } finally {
    cleanup();
  }
});

test("Relay document search query plan captures exclusion and recency hints", async () => {
  const { module, cleanup } = await loadQueryPlanModule();
  try {
    const plan = module.buildRelayDocumentSearchQueryPlan(
      {
        schemaVersion: "RelayDocumentSearchRequest.v1",
        query: "最新の連結CFS精算表を探して。バックアップ除外。",
        roots: ["C:/work"],
        intent: "find_files",
        thoroughness: "thorough",
        fileTypes: ["xlsx"],
        maxResults: 20,
        evidence: "candidate",
      },
      ["C:/work"],
    );

    assert.equal(plan.mode, "hybrid");
    assert.equal(plan.recencyPreference, "prefer_recent");
    assert.equal(plan.timeScopeIntent, "latest_first");
    assert.ok(plan.excludedTerms.includes("バックアップ"));
    assert.ok(plan.excludedTerms.includes("backup"));
    assert.ok(plan.normalizedTerms.includes("連結"));
    assert.ok(plan.normalizedTerms.includes("cfs"));
    assert.ok(plan.normalizedTerms.includes("精算表"));
    assert.equal(plan.normalizedTerms.includes("バックアップ除外"), false);
  } finally {
    cleanup();
  }
});

test("Relay document search query plan keeps quick searches candidate-only", async () => {
  const { module, cleanup } = await loadQueryPlanModule();
  try {
    const plan = module.buildRelayDocumentSearchQueryPlan(
      {
        schemaVersion: "RelayDocumentSearchRequest.v1",
        query: "BS",
        roots: ["C:/work"],
        intent: "find_files",
        thoroughness: "quick",
        fileTypes: ["pdf"],
        maxResults: 20,
        evidence: "candidate",
      },
      ["C:/work"],
    );

    assert.equal(plan.mode, "filename");
    assert.equal(plan.confirmationPolicy, "candidate_ok");
    assert.ok(plan.normalizedTerms.includes("貸借対照表"));
    assert.deepEqual(plan.fileTypeHints, ["pdf"]);
  } finally {
    cleanup();
  }
});

test("Relay document search query plan merges validated Copilot hint terms without excluding demoted outputs", async () => {
  const { module, cleanup } = await loadQueryPlanModule();
  try {
    const plan = module.buildRelayDocumentSearchQueryPlan(
      {
        schemaVersion: "RelayDocumentSearchRequest.v1",
        query: "このフォルダからキャッシュフロー計算書に関係するファイルを探して",
        roots: ["H:/shr1/05_経理部/03_連結財務G/160連結"],
        intent: "find_files",
        thoroughness: "quick",
        fileTypes: ["any"],
        maxResults: 80,
        evidence: "candidate",
        queryPlanHints: {
          schemaVersion: "RelayDocumentSearchCopilotQueryPlan.v1",
          rawQuery: "このフォルダからキャッシュフロー計算書に関係するファイルを探して",
          intent: "find_files",
          evidence: "candidate",
          thoroughness: "quick",
          expandedTerms: ["連結CF", "連結CFS"],
          supportTerms: ["精算表", "合算", "ADJ"],
          demoteTerms: ["ファイリング", "XSA", "監査"],
          fileTypeHints: ["xlsx", "xlsm"],
          timeScopeIntent: "historical_examples",
          summary: "CFS作業ファイルを広く拾う。",
        },
      },
      ["H:/shr1/05_経理部/03_連結財務G/160連結"],
    );

    assert.ok(plan.normalizedTerms.includes("連結cf"));
    assert.ok(plan.normalizedTerms.includes("adj"));
    assert.deepEqual(plan.synonymExpansions.at(-1), {
      source: "copilot_query_plan",
      terms: ["連結cf", "連結cfs", "精算表", "合算", "adj"],
    });
    assert.deepEqual(plan.demoteTerms, ["ファイリング", "xsa", "監査"]);
    assert.equal(plan.excludedTerms.includes("ファイリング"), false);
    assert.deepEqual(plan.fileTypeHints, ["xlsx", "xlsm"]);
    assert.equal(plan.timeScopeIntent, "historical_examples");
    assert.equal(plan.timeScopeReason, "validated_copilot_time_scope_hint");
    assert.equal(plan.copilotHintSummary, "CFS作業ファイルを広く拾う。");
  } finally {
    cleanup();
  }
});
