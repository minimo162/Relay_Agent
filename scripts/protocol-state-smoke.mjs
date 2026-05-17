#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, collectToolCall, hasRunFinished, postAgUi, readApprovalRequest } from "./lib/agui-smoke.mjs";

const token = "relay-protocol-state-token";
const port = 17908;
const dataDir = mkdtempSync(join(tmpdir(), "relay-protocol-state-data-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-protocol-state-workspace-"));
const responses = [
  JSON.stringify({ action: "final", answer: "ローカルツールは利用できません。" }),
  JSON.stringify({ action: "final", answer: "検索を完了しました。" }),
  JSON.stringify({ action: "tool", tool: "ask_user", args: { question: "何を探しますか？" } }),
  JSON.stringify({ action: "final", answer: "確認しました。" }),
  JSON.stringify({ action: "tool", tool: "bash", args: { argv: ["cat", "seed.txt"] } }),
  JSON.stringify({ action: "final", answer: "読み取りました。" }),
  JSON.stringify({ action: "final", answer: "作成しました。" }),
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: "src/app.js" } }),
  JSON.stringify({
    action: "tool",
    tool: "apply_patch",
    args: {
      patchText: "*** Begin Patch\n*** Add File: README.md\n+# Project\n+\n+relayTeamTaskBoard.v1\n*** End Patch\n",
    },
  }),
];

writeFileSync(join(workspace, "seed.txt"), "protocol state seed\n", "utf8");
writeFileSync(join(workspace, "README.md"), "# Project\n", "utf8");
await import("node:fs/promises").then(({ mkdir }) => mkdir(join(workspace, "src"), { recursive: true }));
writeFileSync(join(workspace, "src", "app.js"), "const STORAGE_KEY = 'old';\n", "utf8");

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

function assertFinal(events, expected) {
  if (!hasRunFinished(events)) throw new Error(`run did not finish: ${JSON.stringify(events)}`);
  const text = assistantText(events);
  if (text !== expected) throw new Error(`final text mismatch: expected=${expected} actual=${text}`);
}

function assertRunError(events, expectedText) {
  const error = events.find((event) => event.type === "RUN_ERROR");
  if (!error) throw new Error(`expected RUN_ERROR but got: ${JSON.stringify(events)}`);
  const text = `${error.message ?? ""}\n${error.code ?? ""}`;
  if (!text.includes(expectedText)) {
    throw new Error(`RUN_ERROR did not include ${expectedText}: ${JSON.stringify(error)}`);
  }
}

try {
  await waitForStatus();

  const finalBeforeSearch = await postAgUi({
    port,
    token,
    workspace,
    runId: "protocol-final-before-search",
    instruction: "seed に関するファイルを探して",
  });
  const searchCall = collectToolCall(finalBeforeSearch.events, "glob");
  if (!searchCall.args.includes("seed")) {
    throw new Error(`initial search policy did not keep the search keyword: ${searchCall.args}`);
  }
  assertFinal(finalBeforeSearch.events, "検索を完了しました。");

  const askBeforeSearch = await postAgUi({
    port,
    token,
    workspace,
    runId: "protocol-ask-before-search",
    instruction: "seed に関するファイルを探して",
  });
  collectToolCall(askBeforeSearch.events, "glob");
  if (askBeforeSearch.events.some((event) => event.type === "TOOL_CALL_START" && event.toolCallName === "ask_user")) {
    throw new Error(`ask_user reached the tool layer even though search could proceed: ${JSON.stringify(askBeforeSearch.events)}`);
  }
  assertFinal(askBeforeSearch.events, "確認しました。");

  const bashCat = await postAgUi({
    port,
    token,
    workspace,
    runId: "protocol-bash-cat-normalized",
    instruction: "seed.txt を読んで",
  });
  const readCall = collectToolCall(bashCat.events, "read");
  if (!readCall.args.includes("seed.txt")) {
    throw new Error(`bash cat normalization did not preserve file path: ${readCall.args}`);
  }
  assertFinal(bashCat.events, "読み取りました。");

  const mutationFinal = await postAgUi({
    port,
    token,
    workspace,
    runId: "protocol-mutation-final-rejected",
    instruction: "protocol-output.md を作成して",
  });
  assertRunError(mutationFinal.events, "before a required mutation tool");

  const projectCodeMutation = await postAgUi({
    port,
    token,
    workspace,
    runId: "protocol-project-code-mutation",
    instruction: "README.md と src/app.js を更新して、localStorage キー relayTeamTaskBoard.v1 を使うように改善して",
  });
  const projectReadCall = collectToolCall(projectCodeMutation.events, "read");
  if (!projectReadCall.args.includes("src/app.js")) {
    throw new Error(`project/code mutation should read code files before mutation: ${projectReadCall.args}`);
  }
  const approvalCall = collectToolCall(projectCodeMutation.events, "request_approval");
  const approval = readApprovalRequest(approvalCall).request;
  if (approval.functionName !== "apply_patch") {
    throw new Error(`project/code mutation should expose apply_patch, not Office tools: ${JSON.stringify(approval)}`);
  }

  console.log("[protocol-state-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
