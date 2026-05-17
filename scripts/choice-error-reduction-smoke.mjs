#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
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

const token = "relay-choice-error-reduction-token";
const port = 17928;
const dataDir = mkdtempSync(join(tmpdir(), "relay-choice-error-data-"));
const promptDumpDir = mkdtempSync(join(tmpdir(), "relay-choice-error-prompts-"));
const workspace = mkdtempSync(join(tmpdir(), "relay-choice-error-workspace-"));
const responses = [
  JSON.stringify({ action: "tool", tool: "glob", args: { pattern: "**/*seed*", limit: 10 } }),
  JSON.stringify({ action: "final", answer: "検索しました。" }),
  JSON.stringify({ action: "tool", tool: "read", args: { file_path: "seed.txt", limit: 12000 } }),
  JSON.stringify({ action: "final", answer: "読みました。" }),
  JSON.stringify({ action: "tool", tool: "write", args: { file_path: "out.md", content: "# Done\n" } }),
  JSON.stringify({ action: "final", answer: "作成しました。" }),
  JSON.stringify({
    action: "tool",
    tool: "write",
    args: {
      file_path: "escaped.html",
      content: "\\u003c!doctype html\\u003e\n\\u003chtml\\u003e\\u003cbody\\u003eOK\\u003c/body\\u003e\\u003c/html\\u003e\n",
    },
  }),
  JSON.stringify({ action: "final", answer: "HTMLを作成しました。" }),
];

await writeFile(join(workspace, "seed.txt"), "choice error seed\n", "utf8");

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

async function getMetrics() {
  const response = await fetch(`http://127.0.0.1:${port}/api/prevention-metrics?token=${encodeURIComponent(token)}`, {
    headers: { "X-Relay-Token": token },
  });
  if (!response.ok) throw new Error(`metrics endpoint failed: ${response.status}`);
  return response.json();
}

function assertZeroRepairMetrics(metrics) {
  for (const key of ["guardRepairs", "protocolRejections", "hiddenToolViolations", "invalidFinalAttempts", "invalidAskUserAttempts"]) {
    if (metrics[key] !== 0) {
      throw new Error(`expected zero-repair normal path, but ${key}=${metrics[key]} metrics=${JSON.stringify(metrics)}`);
    }
  }
}

function assertPromptProjection() {
  const prompts = readdirSync(promptDumpDir)
    .filter((name) => name.includes("-prompt-"))
    .map((name) => ({ name, text: readFileSync(join(promptDumpDir, name), "utf8") }))
    .filter(({ text }) => text.includes("RELAY_ADMISSIBLE_ACTION_ENVELOPE"));

  if (prompts.length === 0) {
    throw new Error("expected AAE prompt dumps");
  }

  const preTerminal = prompts.filter(({ text }) => text.includes('"phase":"NeedsObservation"') || text.includes('"phase":"NeedsExactRead"') || text.includes('"phase":"NeedsMutation"'));
  if (preTerminal.length === 0) {
    throw new Error(`expected pre-terminal AAE prompts, got ${prompts.map((p) => p.name).join(", ")}`);
  }

  for (const { name, text } of preTerminal) {
    if (text.includes('For final answer: {"action":"final"')) {
      throw new Error(`pre-terminal prompt exposed final answer template: ${name}`);
    }
    if (/^- ask_user\(/m.test(text)) {
      throw new Error(`pre-terminal known-objective prompt exposed ask_user: ${name}`);
    }
  }

  const needsObservation = prompts.find(({ text }) => text.includes('"phase":"NeedsObservation"'));
  if (!needsObservation) throw new Error("expected a NeedsObservation prompt");
  for (const hidden of ["bash", "write", "patch", "officecli_mutate", "ask_user"]) {
    if (new RegExp(`^- ${hidden}\\(`, "m").test(needsObservation.text)) {
      throw new Error(`NeedsObservation prompt exposed hidden tool ${hidden}`);
    }
  }
}

try {
  await waitForStatus();

  const search = await postAgUi({
    port,
    token,
    workspace,
    runId: "choice-search",
    instruction: "seed を探して",
  });
  collectToolCall(search.events, "glob");
  if (!hasRunFinished(search.events) || assistantText(search.events) !== "検索しました。") {
    throw new Error(`search run did not finish cleanly: ${JSON.stringify(search.events)}`);
  }

  const read = await postAgUi({
    port,
    token,
    workspace,
    runId: "choice-read",
    instruction: "seed.txt を読んで",
  });
  collectToolCall(read.events, "read");
  if (!hasRunFinished(read.events) || assistantText(read.events) !== "読みました。") {
    throw new Error(`read run did not finish cleanly: ${JSON.stringify(read.events)}`);
  }

  const writePrompt = "out.md を作成して";
  const writeStart = await postAgUi({
    port,
    token,
    workspace,
    runId: "choice-write-start",
    instruction: writePrompt,
  });
  const approvalCall = collectToolCall(writeStart.events, "request_approval");
  const approval = readApprovalRequest(approvalCall).request;
  if (approval.functionName !== "write") {
    throw new Error(`write did not use framework approval: ${JSON.stringify(approval)}`);
  }
  if (existsSync(join(workspace, "out.md"))) {
    throw new Error("write executed before approval");
  }

  const writeApproved = await postAgUi({
    port,
    token,
    workspace,
    runId: "choice-write-approved",
    instruction: writePrompt,
    messages: approvalMessages("choice-write-approved", writePrompt, approvalCall, true),
  });
  if (!hasRunFinished(writeApproved.events) || assistantText(writeApproved.events) !== "作成しました。") {
    throw new Error(`approved write run did not finish cleanly: ${JSON.stringify(writeApproved.events)}`);
  }

  const escapedPrompt = "escaped.html を作成して";
  const escapedStart = await postAgUi({
    port,
    token,
    workspace,
    runId: "choice-escaped-html-start",
    instruction: escapedPrompt,
  });
  const escapedApprovalCall = collectToolCall(escapedStart.events, "request_approval");
  const escapedApproval = readApprovalRequest(escapedApprovalCall).request;
  if (escapedApproval.functionName !== "write") {
    throw new Error(`escaped HTML write did not use framework approval: ${JSON.stringify(escapedApproval)}`);
  }

  const escapedApproved = await postAgUi({
    port,
    token,
    workspace,
    runId: "choice-escaped-html-approved",
    instruction: escapedPrompt,
    messages: approvalMessages("choice-escaped-html-approved", escapedPrompt, escapedApprovalCall, true),
  });
  if (!hasRunFinished(escapedApproved.events) || assistantText(escapedApproved.events) !== "HTMLを作成しました。") {
    throw new Error(`approved escaped HTML run did not finish cleanly: ${JSON.stringify(escapedApproved.events)}`);
  }
  const escapedHtml = readFileSync(join(workspace, "escaped.html"), "utf8");
  if (!escapedHtml.startsWith("<!doctype html>") || escapedHtml.includes("\\u003c")) {
    throw new Error(`escaped HTML content was not normalized: ${JSON.stringify(escapedHtml)}`);
  }

  assertPromptProjection();
  assertZeroRepairMetrics(await getMetrics());

  console.log("[choice-error-reduction-smoke] ok");
} finally {
  child.kill("SIGTERM");
}
