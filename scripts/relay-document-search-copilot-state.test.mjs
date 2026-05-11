import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const copilotStatePath = resolve(
  repoRoot,
  "integrations/aionui/overlay/src/process/utils/relayDocumentSearchCopilotState.ts",
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

async function loadCopilotStateModule() {
  const dir = mkdtempSync(resolve(tmpdir(), "relay-document-search-copilot-state-module-"));
  writeFileSync(resolve(dir, "relayDocumentSearchCopilotState.mjs"), transpile(copilotStatePath), "utf8");
  try {
    return {
      module: await import(pathToFileURL(resolve(dir, "relayDocumentSearchCopilotState.mjs")).href),
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function polishValidation(overrides = {}) {
  return {
    schemaVersion: "RelayDocumentSearchPolishValidation.v1",
    state: "polish_pending",
    accepted: false,
    generated_at: "2026-05-10T00:00:00.000Z",
    evidence_pack_id: "evidence-pack-1",
    local_draft_id: "local-draft-1",
    citation_ids: [],
    evidence_ids: [],
    repair_attempt: 0,
    prompt_template_ids: {
      answerPolish: "relay_answer_polish_prompt.v1",
      polishRepair: "relay_polish_repair_prompt.v1",
    },
    correlation: {
      relayJobId: "job-1",
      queryId: "query-1",
      aionuiConversationId: "conversation-1",
      aionuiMessageId: "message-1",
      evidencePackId: "evidence-pack-1",
      localDraftId: "local-draft-1",
    },
    errors: [],
    warnings: [],
    ai_boundary: {
      localFirst: true,
      originalFilesIncluded: false,
      acceptsOnlyEvidencePackCitations: true,
      repairAtMostOnce: true,
    },
    ...overrides,
  };
}

test("Copilot state report derives ready and terminal states from polish validation", async () => {
  const { module, cleanup } = await loadCopilotStateModule();
  try {
    const ready = module.buildRelayDocumentSearchCopilotStateReport({
      polishValidation: polishValidation(),
    });
    assert.equal(ready.schemaVersion, "RelayDocumentSearchCopilotState.v1");
    assert.equal(ready.state, "copilot_ready");
    assert.equal(ready.phase, "ready_for_optional_polish");
    assert.equal(ready.local_search_blocked, false);
    assert.equal(ready.local_draft_blocked, false);
    assert.equal(ready.preview_open_blocked, false);
    assert.equal(ready.should_wait_for_copilot, false);
    assert.equal(ready.optional_polish_retry_available, true);

    const accepted = module.buildRelayDocumentSearchCopilotStateReport({
      polishValidation: polishValidation({
        state: "polish_accepted",
        accepted: true,
        polished_answer_id: "polished-1",
      }),
    });
    assert.equal(accepted.state, "polish_accepted");
    assert.equal(accepted.phase, "polish_terminal");
    assert.equal(accepted.correlation.polishedAnswerId, "polished-1");
  } finally {
    cleanup();
  }
});

test("Copilot state report keeps Copilot failures optional and visible", async () => {
  const { module, cleanup } = await loadCopilotStateModule();
  try {
    const report = module.buildRelayDocumentSearchCopilotStateReport({
      requestedState: "copilot_sign_in_required",
      message: "Copilot sign-in is required before optional polish.",
      polishValidation: polishValidation(),
      correlation: {
        copilotRequestId: "copilot-request-1",
      },
    });

    assert.equal(report.state, "copilot_sign_in_required");
    assert.equal(report.phase, "copilot_unavailable");
    assert.equal(report.visible_to_user, true);
    assert.equal(report.local_search_blocked, false);
    assert.equal(report.should_wait_for_copilot, false);
    assert.equal(report.correlation.copilotRequestId, "copilot-request-1");
    assert.ok(report.warnings.some((warning) => warning.code === "copilot_sign_in_required"));
    assert.match(report.beginner_label, /サインイン/);
  } finally {
    cleanup();
  }
});
