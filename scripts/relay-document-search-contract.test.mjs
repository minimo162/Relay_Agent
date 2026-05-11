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

async function loadContractModule() {
  const source = readFileSync(contractPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: contractPath,
    reportDiagnostics: true,
  });
  const diagnostics = compiled.diagnostics ?? [];
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.messageText),
    [],
  );
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-contract-"));
  const modulePath = resolve(dir, "contract.mjs");
  writeFileSync(modulePath, compiled.outputText, "utf8");
  try {
    return await import(pathToFileURL(modulePath).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Relay document search contract exports stable high-level tool metadata", async () => {
  const contract = await loadContractModule();

  assert.equal(contract.RELAY_DOCUMENT_SEARCH_REQUEST_CONTRACT, "RelayDocumentSearchRequest.v1");
  assert.equal(contract.RELAY_DOCUMENT_SEARCH_RESULT_CONTRACT, "RelayDocumentSearchResult.v1");
  assert.equal(contract.RELAY_DOCUMENT_SEARCH_PRODUCT_RESULT_CONTRACT, "RelayDocumentSearchProductResult.v1");
  assert.equal(contract.RELAY_DOCUMENT_SEARCH_JOB_CONTRACT, "RelayDocumentSearchJob.v1");
  assert.equal(contract.RELAY_DOCUMENT_SEARCH_TOOL_NAME, "relay_document_search");
  assert.deepEqual(contract.RELAY_DOCUMENT_SEARCH_APPROVED_ALIASES, [
    "relay_document_search",
    "relay-document-search",
    "workspace_document_search",
    "workspace-search",
    "find-files",
  ]);
  assert.deepEqual(Object.values(contract.RELAY_DOCUMENT_SEARCH_PROMPT_TEMPLATES), [
    "relay_document_search_tool_prompt.v1",
    "relay_document_search_repair_prompt.v1",
    "relay_query_suggestion_prompt.v1",
    "relay_answer_polish_prompt.v1",
    "relay_polish_repair_prompt.v1",
  ]);
});

test("Relay document search OpenAI schema exposes only model-owned request fields", async () => {
  const contract = await loadContractModule();
  const schema = contract.relayDocumentSearchOpenAiToolSchema;

  assert.equal(schema.type, "function");
  assert.equal(schema.function.name, "relay_document_search");
  assert.equal(schema.function.parameters.additionalProperties, false);
  assert.deepEqual(schema.function.parameters.required, ["query"]);
  assert.deepEqual(Object.keys(schema.function.parameters.properties), [
    "query",
    "roots",
    "intent",
    "thoroughness",
    "fileTypes",
    "maxResults",
    "evidence",
  ]);
  assert.equal(schema.function.parameters.properties.maxResults.maximum, 300);
  assert.equal(schema.function.parameters.properties.roots.maxItems, 16);
});

test("Relay document search request validator rejects Relay-controlled fields", async () => {
  const contract = await loadContractModule();
  const valid = contract.validateRelayDocumentSearchRequest({
    query: "160連結 キャッシュフロー",
    roots: ["H:/shr1/05_経理部/03_連結財務G/160連結"],
    intent: "answer_with_evidence",
    thoroughness: "thorough",
    fileTypes: [".xlsx", "pdf"],
    maxResults: 80,
    evidence: "required",
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.value.schemaVersion, "RelayDocumentSearchRequest.v1");
  assert.deepEqual(valid.value.fileTypes, ["xlsx", "pdf"]);

  const invalid = contract.validateRelayDocumentSearchRequest({
    query: "cash flow",
    job_id: "copilot-must-not-set-this",
    parserVersion: "parser-v999",
  });

  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /job_id is Relay-controlled/);
  assert.match(invalid.errors.join("\n"), /parserVersion is Relay-controlled/);
});

test("Relay document search alias policy requires matching contract metadata for aliases", async () => {
  const contract = await loadContractModule();

  assert.equal(
    contract.acceptsRelayDocumentSearchAlias({
      name: "relay_document_search",
    }),
    true,
  );
  assert.equal(
    contract.acceptsRelayDocumentSearchAlias({
      name: "workspace-search",
      resultContract: "RelayDocumentSearchResult.v1",
    }),
    true,
  );
  assert.equal(
    contract.acceptsRelayDocumentSearchAlias({
      name: "workspace-search",
    }),
    false,
  );
  assert.equal(
    contract.acceptsRelayDocumentSearchAlias({
      function: {
        name: "find-files",
      },
      requestContract: "RelayDocumentSearchRequest.v1",
    }),
    true,
  );
});

test("Relay document search result validator requires product result boundaries", async () => {
  const contract = await loadContractModule();
  const result = contract.validateRelayDocumentSearchResult({
    schemaVersion: "RelayDocumentSearchResult.v1",
    status: "partial",
    progress: { stage: "filename_search", percent: 40 },
    job: { jobId: "job-1", lifecycle: "running", cancellable: true },
    correlation: { aionuiMessageId: "message-1", relayJobId: "job-1" },
    queryPlan: {},
    coverage: {},
    results: [],
    evidencePack: {},
    display: { beginnerSummary: "候補を表示中です。" },
    diagnostics: {},
  });

  assert.equal(result.ok, true);

  const invalid = contract.validateRelayDocumentSearchResult({
    schemaVersion: "RelayDocumentSearchResult.v1",
    status: "ok",
    display: {},
  });

  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join("\n"), /progress is required/);
  assert.match(invalid.errors.join("\n"), /display\.beginnerSummary is required/);

  const invalidProductResult = contract.validateRelayDocumentSearchResult({
    schemaVersion: "RelayDocumentSearchResult.v1",
    status: "ok",
    progress: { stage: "done", percent: 100 },
    job: { jobId: "job-1", lifecycle: "completed", cancellable: false },
    correlation: {},
    queryPlan: {},
    coverage: {},
    results: [{ result_id: "result-1" }],
    evidencePack: {},
    display: { beginnerSummary: "検索できました。" },
    diagnostics: {},
  });

  assert.equal(invalidProductResult.ok, false);
  assert.match(invalidProductResult.errors.join("\n"), /product_result_contract/);
  assert.match(invalidProductResult.errors.join("\n"), /preview_state is required/);
});
