import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const providerPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchPolishProvider.ts",
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

async function loadProviderModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-polish-provider-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchPolishProvider.mjs"), transpile(providerPath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchPolishProvider.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function readyPolishRequest(overrides = {}) {
  return {
    schemaVersion: "RelayDocumentSearchPolishRequest.v1",
    status: "ready",
    reason: "ready_for_copilot",
    generated_at: "2026-05-10T00:00:00.000Z",
    prompt_template_id: "relay_answer_polish_prompt.v1",
    expected_output_schema: "RelayDocumentSearchPolishedAnswer.v1",
    evidence_pack_id: "evidence-pack-1",
    local_draft_id: "local-draft-1",
    query: "キャッシュフロー",
    correlation: {
      relayJobId: "job-1",
      queryId: "query-1",
      evidencePackId: "evidence-pack-1",
      localDraftId: "local-draft-1",
    },
    redaction_policy: "snippets_allowed",
    redacted_evidence_count: 1,
    citation_ids: ["E1"],
    evidence_ids: ["evidence-1"],
    payload: {
      evidence_pack_id: "evidence-pack-1",
      local_draft_id: "local-draft-1",
      query: "キャッシュフロー",
      local_draft_summary: "根拠があります。",
      citations: [{ citation_id: "E1", evidence_id: "evidence-1", label: "CFS.xlsx" }],
      redacted_evidence: [{ evidence_id: "evidence-1", citation_id: "E1", snippet: "キャッシュフロー計算書" }],
    },
    prompt:
      'Prompt template: relay_answer_polish_prompt.v1\nReturn only JSON.\n{"evidence_pack_id":"evidence-pack-1","local_draft_id":"local-draft-1"}',
    warnings: [],
    ai_boundary: {
      localFirst: true,
      originalFilesIncluded: false,
      fullPathsIncluded: false,
      extractedContentIncludedOnlyAfterRedaction: true,
      expectsStructuredPolishedAnswer: true,
    },
    ...overrides,
  };
}

function polishedCandidate() {
  return {
    schemaVersion: "RelayDocumentSearchPolishedAnswer.v1",
    polished_answer_id: "polished-1",
    prompt_template_id: "relay_answer_polish_prompt.v1",
    evidence_pack_id: "evidence-pack-1",
    local_draft_id: "local-draft-1",
    answer: "CFS.xlsx に根拠があります [E1]。",
    citations: [{ citation_id: "E1", evidence_id: "evidence-1" }],
  };
}

test("Polish provider posts a bounded OpenAI request and extracts a JSON candidate", async () => {
  const { module, cleanup } = await loadProviderModule();
  try {
    let capturedUrl = "";
    let capturedInit;
    const candidate = polishedCandidate();
    const result = await module.invokeRelayDocumentSearchPolishProvider({
      polishRequest: readyPolishRequest(),
      enabled: true,
      baseUrl: "http://127.0.0.1:18080/v1",
      apiKey: "test-token",
      model: "m365-copilot",
      generatedAt: "2026-05-10T00:00:00.000Z",
      fetchImpl: async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              choices: [{ message: { content: JSON.stringify(candidate) } }],
            });
          },
        };
      },
    });

    assert.equal(capturedUrl, "http://127.0.0.1:18080/v1/chat/completions");
    assert.equal(capturedInit.headers.authorization, "Bearer test-token");
    const body = JSON.parse(capturedInit.body);
    assert.equal(body.model, "m365-copilot");
    assert.equal(body.stream, false);
    assert.equal(body.relay_stage_label, "document_search_polish");
    assert.equal(body.relay_force_fresh_chat, true);
    assert.equal(body.tools, undefined);
    assert.match(body.messages[1].content, /relay_answer_polish_prompt\.v1/);
    assert.equal(result.report.schemaVersion, "RelayDocumentSearchPolishProvider.v1");
    assert.equal(result.report.state, "candidate_received");
    assert.equal(result.report.reason, "candidate_received");
    assert.equal(result.report.endpoint_origin, "http://127.0.0.1:18080");
    assert.equal(result.report.candidate_received, true);
    assert.equal(result.candidate.answer, "CFS.xlsx に根拠があります [E1]。");
    assert.deepEqual(module.validateRelayDocumentSearchPolishProviderReport(result.report), { ok: true, errors: [] });
  } finally {
    cleanup();
  }
});

test("Polish provider can use an injected live runner without requiring network", async () => {
  const { module, cleanup } = await loadProviderModule();
  try {
    const result = await module.invokeRelayDocumentSearchPolishProvider({
      polishRequest: readyPolishRequest(),
      provider: async ({ polishRequest, copilotRequestId }) => ({
        candidate: {
          ...polishedCandidate(),
          evidence_pack_id: polishRequest.evidence_pack_id,
          local_draft_id: polishRequest.local_draft_id,
        },
        copilotRequestId,
        copilotTurnId: "turn-1",
        responseCharacterCount: 128,
      }),
      generatedAt: "2026-05-10T00:00:00.000Z",
    });

    assert.equal(result.report.provider_kind, "callback");
    assert.equal(result.report.state, "candidate_received");
    assert.equal(result.report.copilot_turn_id, "turn-1");
    assert.equal(result.report.response_character_count, 128);
    assert.equal(result.candidate.schemaVersion, "RelayDocumentSearchPolishedAnswer.v1");
  } finally {
    cleanup();
  }
});

test("Polish provider stays local when disabled or request is not ready", async () => {
  const { module, cleanup } = await loadProviderModule();
  try {
    const disabled = await module.invokeRelayDocumentSearchPolishProvider({
      polishRequest: readyPolishRequest(),
      enabled: false,
      generatedAt: "2026-05-10T00:00:00.000Z",
    });
    assert.equal(disabled.report.state, "not_requested");
    assert.equal(disabled.report.reason, "disabled");
    assert.equal(disabled.candidate, undefined);

    const notAllowed = await module.invokeRelayDocumentSearchPolishProvider({
      polishRequest: readyPolishRequest({ status: "not_allowed", prompt: undefined }),
      enabled: true,
      generatedAt: "2026-05-10T00:00:00.000Z",
    });
    assert.equal(notAllowed.report.state, "not_allowed");
    assert.equal(notAllowed.report.reason, "request_not_ready");
    assert.equal(notAllowed.report.local_search_blocked, false);
  } finally {
    cleanup();
  }
});

test("Polish provider reports invalid Copilot output without producing a candidate", async () => {
  const { module, cleanup } = await loadProviderModule();
  try {
    const result = await module.invokeRelayDocumentSearchPolishProvider({
      polishRequest: readyPolishRequest(),
      enabled: true,
      baseUrl: "http://127.0.0.1:18080/v1",
      apiKey: "test-token",
      generatedAt: "2026-05-10T00:00:00.000Z",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ choices: [{ message: { content: "了解しました。根拠があります。" } }] });
        },
      }),
    });

    assert.equal(result.report.state, "failed");
    assert.equal(result.report.reason, "invalid_provider_response");
    assert.equal(result.report.candidate_received, false);
    assert.equal(result.candidate, undefined);
    assert.ok(result.report.warnings.some((warning) => warning.code === "invalid_provider_response"));
  } finally {
    cleanup();
  }
});
