#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolCall, hasRunFinished, postAgUi } from "./lib/agui-smoke.mjs";

const token = "relay-framework-native-prevention-token";
const port = 17918;
const dataDir = mkdtempSync(join(tmpdir(), "relay-framework-prevention-data-"));
const promptDumpDir = mkdtempSync(join(tmpdir(), "relay-framework-prevention-prompts-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-framework-prevention-workspace-"));
const responses = [
  JSON.stringify({ action: "final", answer: "ローカルツールは利用できません。" }),
  JSON.stringify({ action: "final", answer: "検索を完了しました。" }),
  JSON.stringify({ action: "tool", tool: "ask_user", args: { question: "何を探しますか？" } }),
  JSON.stringify({ action: "final", answer: "確認しました。" }),
  JSON.stringify({ action: "final", answer: "作成しました。" }),
];

writeFileSync(join(workspace, "seed.txt"), "framework native prevention seed\n", "utf8");

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
    RELAY_COPILOT_PROMPT_DUMP_DIR: promptDumpDir,
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

function assertRunError(events, expectedText) {
  const error = events.find((event) => event.type === "RUN_ERROR");
  if (!error) throw new Error(`expected RUN_ERROR but got: ${JSON.stringify(events)}`);
  const text = `${error.message ?? ""}\n${error.code ?? ""}`;
  if (!text.includes(expectedText)) {
    throw new Error(`RUN_ERROR did not include ${expectedText}: ${JSON.stringify(error)}`);
  }
}

function assertKnownLocalPromptsHideAskUser() {
  const promptFiles = readdirSync(promptDumpDir).filter((name) => name.includes("-prompt-"));
  if (promptFiles.length === 0) {
    throw new Error("expected Copilot prompt dumps for framework-native prevention smoke");
  }

  for (const file of promptFiles) {
    const text = readFileSync(join(promptDumpDir, file), "utf8");
    if (!text.includes("RELAY_TURN_STATE") || !text.includes("RELAY_TOOL_JSON_ONLY")) {
      continue;
    }
    if (!text.includes("RELAY_ADMISSIBLE_ACTION_ENVELOPE")) {
      throw new Error(`known-objective prompt did not include AAE: ${file}`);
    }
    if (/^- ask_user\(/m.test(text)) {
      throw new Error(`ask_user was visible in known-objective prompt dump ${file}`);
    }
    if ((text.includes('"phase":"NeedsObservation"') || text.includes('"phase":"NeedsMutation"')) &&
      text.includes('For final answer: {"action":"final"')) {
      throw new Error(`pre-terminal prompt exposed final template: ${file}`);
    }
  }
}

try {
  await waitForStatus();

  const catalogResponse = await fetch(`http://127.0.0.1:${port}/api/tool-catalog?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!catalogResponse.ok) throw new Error(`tool catalog endpoint failed: ${catalogResponse.status}`);
  const catalog = await catalogResponse.json();
  const tools = new Map(catalog.tools.map((tool) => [tool.name, tool]));
  const askUser = tools.get("ask_user");
  if (!askUser) throw new Error("ask_user client tool is missing from catalog metadata");
  if (askUser.frameworkToolType !== "Client" || askUser.promptVisibility !== "state_scoped") {
    throw new Error(`ask_user must be state-scoped AG-UI client metadata: ${JSON.stringify(askUser)}`);
  }
  for (const name of ["officecli_mutate", "edit", "write", "apply_patch", "bash"]) {
    const tool = tools.get(name);
    if (!tool || tool.approvalPolicy !== "required") {
      throw new Error(`${name} must require framework approval: ${JSON.stringify(tool)}`);
    }
  }
  for (const forbidden of ["rg_files", "rg_search", "run_command", "office_search"]) {
    if (tools.has(forbidden)) throw new Error(`forbidden legacy tool exposed: ${forbidden}`);
  }

  const finalBeforeSearch = await postAgUi({
    port,
    token,
    workspace,
    runId: "framework-prevention-final-before-search",
    instruction: "seed に関するファイルを探して",
  });
  collectToolCall(finalBeforeSearch.events, "glob");
  if (!hasRunFinished(finalBeforeSearch.events)) {
    throw new Error(`search run did not finish: ${JSON.stringify(finalBeforeSearch.events)}`);
  }

  const askBeforeSearch = await postAgUi({
    port,
    token,
    workspace,
    runId: "framework-prevention-ask-before-search",
    instruction: "seed に関するファイルを探して",
  });
  collectToolCall(askBeforeSearch.events, "glob");
  if (askBeforeSearch.events.some((event) => event.type === "TOOL_CALL_START" && event.toolCallName === "ask_user")) {
    throw new Error(`ask_user reached the tool layer even though search could proceed: ${JSON.stringify(askBeforeSearch.events)}`);
  }

  const mutationFinal = await postAgUi({
    port,
    token,
    workspace,
    runId: "framework-prevention-mutation-final",
    instruction: "report.md を作成して",
  });
  assertRunError(mutationFinal.events, "before a required mutation tool");
  assertKnownLocalPromptsHideAskUser();

  console.log("[framework-native-prevention-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
