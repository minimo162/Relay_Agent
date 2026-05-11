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
const polishValidationPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchPolishValidation.ts",
);
const polishRequestPath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchPolishRequest.ts",
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

async function loadPolishRequestModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-polish-request-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchContract.mjs"), transpile(contractPath), "utf8");
  writeFileSync(
    resolve(dir, "relayDocumentSearchPolishValidation.mjs"),
    transpile(polishValidationPath).replace(
      "from './relayDocumentSearchContract';",
      "from './relayDocumentSearchContract.mjs';",
    ),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "relayDocumentSearchPolishRequest.mjs"),
    transpile(polishRequestPath)
      .replace("from './relayDocumentSearchContract';", "from './relayDocumentSearchContract.mjs';")
      .replace("from './relayDocumentSearchPolishValidation';", "from './relayDocumentSearchPolishValidation.mjs';"),
    "utf8",
  );
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchPolishRequest.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function evidencePack() {
  return {
    schemaVersion: "RelayDocumentSearchEvidencePack.v1",
    evidence_pack_id: "evidence-pack-1",
    job_id: "job-1",
    query_id: "query-1",
    generated_at: "2026-05-10T00:00:00.000Z",
    query: "キャッシュフロー",
    query_plan: { mode: "hybrid", terms: ["キャッシュフロー"], file_types: ["xlsx"], period_hints: [], evidence: "required" },
    coverage: {},
    candidate_files: [],
    evidence: [],
    warnings: [],
    ai_boundary: {
      localFirst: true,
      copilotMayUseOnlyEvidencePack: true,
      originalFilesIncluded: false,
      parsedDocumentPayloadIncluded: false,
    },
  };
}

function localDraft(canReplace = true) {
  return {
    schemaVersion: "RelayDocumentSearchLocalDraft.v1",
    local_draft_id: "local-draft-1",
    evidence_pack_id: "evidence-pack-1",
    job_id: "job-1",
    query_id: "query-1",
    generated_at: "2026-05-10T00:00:00.000Z",
    query: "キャッシュフロー",
    answer_policy: canReplace ? "evidence_confirmed" : "candidate_only",
    citation_policy: canReplace ? "evidence_pack_ids_required" : "candidate_language_only",
    can_replace_with_copilot_polish: canReplace,
    summary: "中身を確認できた根拠が1件あります。",
    sections: [],
    citations: [
      {
        citation_id: "E1",
        evidence_id: "evidence-1",
        label: "CFS.xlsx",
        anchor_summary: "CFS!A1",
      },
    ],
    caveats: [],
    next_actions: [],
    validation: {
      groundedInEvidencePack: true,
      unsupportedClaims: [],
      evidenceItemCount: 1,
      candidateFileCount: 1,
      warningCodes: [],
    },
    ai_boundary: {
      localFirst: true,
      copilotMayOnlyPolish: true,
      copilotPolishRequiresCitationValidation: true,
      originalFilesIncluded: false,
    },
  };
}

function redaction(canSendToCopilot = true) {
  return {
    schemaVersion: "RelayDocumentSearchEvidenceRedaction.v1",
    policy: canSendToCopilot ? "snippets_allowed" : "local_only",
    canSendToCopilot,
    sourceEvidenceCount: 1,
    redactedEvidenceCount: canSendToCopilot ? 1 : 0,
    omittedEvidenceCount: canSendToCopilot ? 0 : 1,
    redactedEvidence: canSendToCopilot
      ? [
          {
            file_id: "file-1",
            display_path: "160連結/CFS.xlsx",
            evidence_state: "content_confirmed",
            anchor: {
              type: "cell_excerpt",
              sheet_name: "CFS",
              cell_address: "A1",
              snippet: "キャッシュフロー計算書の根拠",
            },
          },
        ]
      : [],
    warnings: canSendToCopilot ? [] : [{ code: "local_only_policy", message: "local only" }],
  };
}

test("Polish request builds a bounded Copilot prompt from redacted evidence", async () => {
  const { module, cleanup } = await loadPolishRequestModule();
  try {
    const request = module.buildRelayDocumentSearchPolishRequest({
      evidencePack: evidencePack(),
      localDraft: localDraft(true),
      redaction: redaction(true),
      correlation: {
        aionuiConversationId: "conversation-1",
        aionuiMessageId: "message-1",
        copilotRequestId: "copilot-request-1",
      },
    });

    assert.equal(request.schemaVersion, "RelayDocumentSearchPolishRequest.v1");
    assert.equal(request.status, "ready");
    assert.equal(request.reason, "ready_for_copilot");
    assert.equal(request.prompt_template_id, "relay_answer_polish_prompt.v1");
    assert.equal(request.expected_output_schema, "RelayDocumentSearchPolishedAnswer.v1");
    assert.equal(request.redacted_evidence_count, 1);
    assert.deepEqual(request.citation_ids, ["E1"]);
    assert.match(request.prompt, /Return only a JSON object/);
    assert.match(request.prompt, /キャッシュフロー計算書の根拠/);
    assert.doesNotMatch(request.prompt, /H:\/secret/u);
    assert.equal(request.correlation.copilotRequestId, "copilot-request-1");
    assert.equal(request.ai_boundary.originalFilesIncluded, false);
    assert.equal(request.ai_boundary.fullPathsIncluded, false);
    assert.equal(module.validateRelayDocumentSearchPolishRequest(request).ok, true);
  } finally {
    cleanup();
  }
});

test("Polish request refuses prompt creation when redaction or local draft blocks Copilot", async () => {
  const { module, cleanup } = await loadPolishRequestModule();
  try {
    const blockedByRedaction = module.buildRelayDocumentSearchPolishRequest({
      evidencePack: evidencePack(),
      localDraft: localDraft(true),
      redaction: redaction(false),
    });
    assert.equal(blockedByRedaction.status, "not_allowed");
    assert.equal(blockedByRedaction.reason, "redaction_policy_blocks_copilot");
    assert.equal(blockedByRedaction.prompt, undefined);
    assert.equal(module.validateRelayDocumentSearchPolishRequest(blockedByRedaction).ok, true);

    const blockedByDraft = module.buildRelayDocumentSearchPolishRequest({
      evidencePack: evidencePack(),
      localDraft: localDraft(false),
      redaction: redaction(true),
    });
    assert.equal(blockedByDraft.status, "not_allowed");
    assert.equal(blockedByDraft.reason, "local_draft_not_polishable");
    assert.equal(blockedByDraft.prompt, undefined);
    assert.ok(blockedByDraft.warnings.some((warning) => warning.code === "local_draft_not_polishable"));
  } finally {
    cleanup();
  }
});
