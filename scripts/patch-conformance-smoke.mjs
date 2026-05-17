#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvalMessages,
  assistantText,
  collectToolCall,
  hasRunFinished,
  postAgUi,
  readApprovalRequest,
} from "./lib/agui-smoke.mjs";

const token = "relay-patch-conformance-token";
const port = 17918;
const dataDir = mkdtempSync(join(tmpdir(), "relay-patch-conformance-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-patch-conformance-workspace-"));
const validBrokenPatch = "*** Begin Patch\n*** Add File: broken.md\n+recovered from invalid patch\n*** End Patch\n";
const validNestedPatch = "*** Begin Patch\n*** Add File: nested.md\n+nested recovered\n*** Add File: nested2.md\n+nested2 recovered\n*** End Patch\n";
const legacyMultiAddPatch = "*** Begin Patch\n*** Add File: valid.md\n+valid patch smoke\n*** Add File: docs/extra.md\n+extra patch smoke\n*** End Patch\n";
const validUpdatePatch = "*** Begin Patch\n*** Update File: valid.md\n@@\n-valid patch smoke\n+valid patch smoke updated\n*** End Patch\n";
const nestedSourcePatch = "*** Begin Patch\n*** Add File: sample-project/src/app.js\n+console.log(\"hello\");\n*** End Patch\n";
const suffixUpdatePatch = "*** Begin Patch\n*** Update File: src/app.js\n@@\n-console.log(\"hello\");\n+console.log(\"hello from resolved suffix\");\n*** End Patch\n";
const responses = [
  JSON.stringify({
    action: "tool",
    tool: "apply_patch",
    args: {
      patchText: "*** Begin Patch\n*** Add File: broken.txt\nbroken line without plus\n*** End Patch\n",
    },
  }),
  JSON.stringify({
    action: "tool",
    tool: "apply_patch",
    args: {
      patchText: validBrokenPatch,
    },
  }),
  JSON.stringify({ action: "final", answer: "invalid patch recovered" }),
  JSON.stringify({
    action: "tool",
    tool: "apply_patch",
    args: {
      patchText: "*** Begin Patch\n*** Add File: nested.md\n+nested\n*** End Patch\n*** Begin Patch\n*** Add File: nested2.md\n+nested2\n*** End Patch\n",
    },
  }),
  JSON.stringify({
    action: "tool",
    tool: "apply_patch",
    args: {
      patchText: validNestedPatch,
    },
  }),
  JSON.stringify({ action: "final", answer: "duplicate envelope recovered" }),
  JSON.stringify({
    action: "tool",
    tool: "apply_patch",
    args: {
      patch: legacyMultiAddPatch,
    },
  }),
  JSON.stringify({ action: "final", answer: "legacy patch applied" }),
  JSON.stringify({
    action: "tool",
    tool: "apply_patch",
    args: {
      patchText: validUpdatePatch,
    },
  }),
  JSON.stringify({ action: "final", answer: "update patch applied" }),
  JSON.stringify({
    action: "tool",
    tool: "apply_patch",
    args: {
      patchText: nestedSourcePatch,
    },
  }),
  JSON.stringify({ action: "final", answer: "nested source created" }),
  JSON.stringify({
    action: "tool",
    tool: "apply_patch",
    args: {
      patchText: suffixUpdatePatch,
    },
  }),
  JSON.stringify({ action: "final", answer: "suffix update applied" }),
];

const child = spawn("dotnet", ["run", "--project", "apps/sidecar/Relay.Sidecar.csproj", "--no-build", "--configuration", "Release"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    RELAY_PORT: String(port),
    RELAY_LAUNCH_TOKEN: token,
    RELAY_DATA_DIR: dataDir,
    RELAY_WORKBENCH_DIST: join(process.cwd(), "apps/sidecar/wwwroot"),
    RELAY_ALLOW_MOCK_COPILOT: "1",
    RELAY_COPILOT_MOCK_RESPONSES_JSON: JSON.stringify(responses),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

async function waitForStatus() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status?token=${encodeURIComponent(token)}`, {
        headers: { "X-Relay-Token": token },
      });
      if (response.ok) return;
    } catch {
      // Wait for Kestrel.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`sidecar did not become ready; stderr=${stderr}`);
}

function assertNoRunError(events, label) {
  const error = events.find((event) => event.type === "RUN_ERROR");
  if (error) throw new Error(`${label} unexpectedly failed: ${JSON.stringify(error)}`);
}

try {
  await waitForStatus();

  const invalid = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-invalid",
    instruction: "broken.md を作成して",
  });
  assertNoRunError(invalid.events, "invalid patch recovery");
  const invalidApprovalCall = collectToolCall(invalid.events, "request_approval");
  const invalidApproval = readApprovalRequest(invalidApprovalCall).request;
  if (invalidApproval.functionName !== "apply_patch") {
    throw new Error(`expected recovered apply_patch approval, got ${JSON.stringify(invalidApproval)}`);
  }
  const invalidApproved = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-invalid",
    instruction: "broken.md を作成して",
    messages: approvalMessages("patch-invalid", "broken.md を作成して", invalidApprovalCall, true),
  });
  if (!hasRunFinished(invalidApproved.events)) {
    throw new Error(`invalid recovery run did not finish: ${JSON.stringify(invalidApproved.events)}`);
  }
  if (!existsSync(join(workspace, "broken.md"))) {
    throw new Error("invalid patch recovery did not create broken.md");
  }

  const duplicate = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-duplicate-envelope",
    instruction: "nested.md と nested2.md を作成して",
  });
  assertNoRunError(duplicate.events, "duplicate patch recovery");
  const duplicateApprovalCall = collectToolCall(duplicate.events, "request_approval");
  const duplicateApproval = readApprovalRequest(duplicateApprovalCall).request;
  if (duplicateApproval.functionName !== "apply_patch") {
    throw new Error(`expected recovered duplicate apply_patch approval, got ${JSON.stringify(duplicateApproval)}`);
  }
  const duplicateApproved = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-duplicate-envelope",
    instruction: "nested.md と nested2.md を作成して",
    messages: approvalMessages("patch-duplicate-envelope", "nested.md と nested2.md を作成して", duplicateApprovalCall, true),
  });
  if (!hasRunFinished(duplicateApproved.events)) {
    throw new Error(`duplicate recovery run did not finish: ${JSON.stringify(duplicateApproved.events)}`);
  }
  if (!existsSync(join(workspace, "nested.md")) || !existsSync(join(workspace, "nested2.md"))) {
    throw new Error("duplicate patch recovery did not create nested files");
  }

  const legacy = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-legacy-valid",
    instruction: "valid.md と docs/extra.md を作成して",
  });
  const approvalCall = collectToolCall(legacy.events, "request_approval");
  const approval = readApprovalRequest(approvalCall).request;
  if (approval.functionName !== "apply_patch") {
    throw new Error(`expected apply_patch approval, got ${JSON.stringify(approval)}`);
  }

  const legacyApproved = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-legacy-valid",
    instruction: "valid.md と docs/extra.md を作成して",
    messages: approvalMessages("patch-legacy-valid", "valid.md と docs/extra.md を作成して", approvalCall, true),
  });
  if (!hasRunFinished(legacyApproved.events)) {
    throw new Error(`legacy approved run did not finish: ${JSON.stringify(legacyApproved.events)}`);
  }
  const text = assistantText(legacyApproved.events);
  if (text !== "legacy patch applied") {
    throw new Error(`unexpected final text: ${text}`);
  }
  const output = join(workspace, "valid.md");
  if (!existsSync(output) || !readFileSync(output, "utf8").includes("valid patch smoke")) {
    throw new Error(`valid patch did not create expected file: ${output}`);
  }
  const extra = join(workspace, "docs", "extra.md");
  if (!existsSync(extra) || !readFileSync(extra, "utf8").includes("extra patch smoke")) {
    throw new Error(`multi-file patch did not create expected file: ${extra}`);
  }

  const update = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-update-valid",
    instruction: "valid.md を更新して",
  });
  const updateApprovalCall = collectToolCall(update.events, "request_approval");
  const updateApproval = readApprovalRequest(updateApprovalCall).request;
  if (updateApproval.functionName !== "apply_patch") {
    throw new Error(`expected update apply_patch approval, got ${JSON.stringify(updateApproval)}`);
  }
  const updateApproved = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-update-valid",
    instruction: "valid.md を更新して",
    messages: approvalMessages("patch-update-valid", "valid.md を更新して", updateApprovalCall, true),
  });
  if (!hasRunFinished(updateApproved.events)) {
    throw new Error(`update run did not finish: ${JSON.stringify(updateApproved.events)}`);
  }
  const updateText = assistantText(updateApproved.events);
  if (updateText !== "update patch applied") {
    throw new Error(`unexpected update final text: ${updateText}`);
  }
  if (!readFileSync(output, "utf8").includes("valid patch smoke updated")) {
    throw new Error(`valid update patch did not update expected file: ${output}`);
  }

  const nested = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-nested-source",
    instruction: "sample-project/src/app.js を作成して",
  });
  const nestedApprovalCall = collectToolCall(nested.events, "request_approval");
  const nestedApproval = readApprovalRequest(nestedApprovalCall).request;
  if (nestedApproval.functionName !== "apply_patch") {
    throw new Error(`expected nested source apply_patch approval, got ${JSON.stringify(nestedApproval)}`);
  }
  const nestedApproved = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-nested-source",
    instruction: "sample-project/src/app.js を作成して",
    messages: approvalMessages("patch-nested-source", "sample-project/src/app.js を作成して", nestedApprovalCall, true),
  });
  if (!hasRunFinished(nestedApproved.events)) {
    throw new Error(`nested source run did not finish: ${JSON.stringify(nestedApproved.events)}`);
  }
  const nestedPath = join(workspace, "sample-project", "src", "app.js");
  if (!existsSync(nestedPath) || !readFileSync(nestedPath, "utf8").includes("hello")) {
    throw new Error(`nested source patch did not create expected file: ${nestedPath}`);
  }

  const suffix = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-suffix-update",
    instruction: "src/app.js を更新して",
  });
  const suffixApprovalCall = collectToolCall(suffix.events, "request_approval");
  const suffixApproval = readApprovalRequest(suffixApprovalCall).request;
  if (suffixApproval.functionName !== "apply_patch") {
    throw new Error(`expected suffix update apply_patch approval, got ${JSON.stringify(suffixApproval)}`);
  }
  const suffixApproved = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-suffix-update",
    instruction: "src/app.js を更新して",
    messages: approvalMessages("patch-suffix-update", "src/app.js を更新して", suffixApprovalCall, true),
  });
  if (!hasRunFinished(suffixApproved.events)) {
    throw new Error(`suffix update run did not finish: ${JSON.stringify(suffixApproved.events)}`);
  }
  if (!readFileSync(nestedPath, "utf8").includes("hello from resolved suffix")) {
    throw new Error(`suffix update did not update unique nested file: ${nestedPath}`);
  }
  if (existsSync(join(workspace, "src", "app.js"))) {
    throw new Error("suffix update created an unintended root src/app.js");
  }

  console.log("[patch-conformance-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
