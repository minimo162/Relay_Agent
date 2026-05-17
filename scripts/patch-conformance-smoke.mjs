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
const legacyMultiAddPatch = "*** Begin Patch\n*** Add File: valid.md\n+valid patch smoke\n*** Add File: docs/extra.md\n+extra patch smoke\n*** End Patch\n";
const validUpdatePatch = "*** Begin Patch\n*** Update File: valid.md\n@@\n-valid patch smoke\n+valid patch smoke updated\n*** End Patch\n";
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
      patchText: "*** Begin Patch\n*** Add File: nested.md\n+nested\n*** End Patch\n*** Begin Patch\n*** Add File: nested2.md\n+nested2\n*** End Patch\n",
    },
  }),
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

function assertRunError(events, expected) {
  const error = events.find((event) => event.type === "RUN_ERROR");
  if (!error) throw new Error(`expected RUN_ERROR but got: ${JSON.stringify(events)}`);
  const text = `${error.message ?? ""}\n${error.code ?? ""}`;
  if (!text.includes(expected)) {
    throw new Error(`RUN_ERROR did not include ${expected}: ${JSON.stringify(error)}`);
  }
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
  assertRunError(invalid.events, "apply_patch_invalid");
  if (invalid.events.some((event) => event.type === "TOOL_CALL_START" && event.toolCallName === "request_approval")) {
    throw new Error(`invalid apply_patch reached approval layer: ${JSON.stringify(invalid.events)}`);
  }

  const duplicate = await postAgUi({
    port,
    token,
    workspace,
    runId: "patch-duplicate-envelope",
    instruction: "duplicate patch envelope を試して",
  });
  assertRunError(duplicate.events, "apply_patch_invalid");
  if (duplicate.events.some((event) => event.type === "TOOL_CALL_START" && event.toolCallName === "request_approval")) {
    throw new Error(`duplicate envelope apply_patch reached approval layer: ${JSON.stringify(duplicate.events)}`);
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

  console.log("[patch-conformance-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
