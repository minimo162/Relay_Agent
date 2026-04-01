import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCompressedContext,
  buildErrorRecoveryPrompt,
  buildFollowUpPromptV2,
  buildPlanningPromptV2,
  buildStepExecutionPrompt,
  summarizeTurn
} from "./prompt-templates";

test("buildPlanningPromptV2 includes reasoning instructions and JSON example", () => {
  const prompt = buildPlanningPromptV2({
    objective: "approved が true の行だけ残してください",
    workbookContext: "ファイル: /tmp/demo.csv\n列: approved, amount",
    readTools: ["workbook.inspect", "sheet.preview"],
    writeTools: ["table.filter_rows"]
  });

  assert.match(prompt, /思考プロセス/);
  assert.match(prompt, /workbook\.inspect/);
  assert.match(prompt, /"status": "plan_proposed"/);
  assert.match(prompt, /"executionPlan"/);
});

test("buildCompressedContext compresses older turns and keeps latest turns out of summary", () => {
  const compressed = buildCompressedContext(
    [
      { turn: 1, toolsUsed: ["workbook.inspect"], keyFindings: ["列を確認"], status: "thinking" },
      { turn: 2, toolsUsed: ["sheet.preview"], keyFindings: ["先頭行を確認"], status: "thinking" },
      { turn: 3, toolsUsed: ["sheet.profile_columns"], keyFindings: ["型を確認"], status: "thinking" },
      { turn: 4, toolsUsed: ["session.diff_from_base"], keyFindings: ["差分確認"], status: "thinking" },
      { turn: 5, toolsUsed: ["table.filter_rows"], keyFindings: ["保存候補"], status: "ready_to_write" }
    ],
    2
  );

  assert.match(compressed, /ターン 1/);
  assert.match(compressed, /ターン 3/);
  assert.doesNotMatch(compressed, /ターン 4/);
  assert.doesNotMatch(compressed, /ターン 5/);
});

test("buildErrorRecoveryPrompt changes by retry level", () => {
  const level1 = buildErrorRecoveryPrompt({
    originalTask: "CSV を絞り込む",
    errorDescription: "Unexpected token",
    retryLevel: 1
  });
  const level2 = buildErrorRecoveryPrompt({
    originalTask: "CSV を絞り込む",
    errorDescription: "Unexpected token",
    retryLevel: 2,
    lastValidResponse: "not-json"
  });
  const level3 = buildErrorRecoveryPrompt({
    originalTask: "CSV を絞り込む",
    errorDescription: "Unexpected token",
    retryLevel: 3
  });

  assert.match(level1, /解析できませんでした/);
  assert.match(level2, /シンプルに回答してください/);
  assert.match(level3, /手動モード/);
  assert.match(level3, /CSV を絞り込む/);
});

test("buildFollowUpPromptV2 includes compressed history and prior results", () => {
  const prompt = buildFollowUpPromptV2({
    originalTask: "approved が true の行だけ残してください",
    currentStep: { description: "サンプルデータを確認", tool: "sheet.preview" },
    priorResults: [{ tool: "workbook.inspect", ok: true, summary: "列: approved, amount" }],
    turn: 3,
    compressedHistory: "これまでの経緯:\n- ターン 1: workbook.inspect → 列を確認",
    conversationHistory: [
      {
        role: "user",
        content: "最初の依頼",
        timestamp: "2026-04-01T00:00:00.000Z"
      }
    ]
  });

  assert.match(prompt, /これまでの経緯/);
  assert.match(prompt, /直近の会話履歴/);
  assert.match(prompt, /workbook\.inspect/);
  assert.match(prompt, /sheet\.preview を使って/);
});

test("summarizeTurn extracts key findings from tool results", () => {
  const summary = summarizeTurn(2, "thinking", [
    { tool: "sheet.preview", ok: true, result: { rows: [{ approved: true }] } },
    { tool: "file.read_text", ok: false, error: "permission denied" }
  ]);

  assert.equal(summary.turn, 2);
  assert.deepEqual(summary.toolsUsed, ["sheet.preview", "file.read_text"]);
  assert.equal(summary.status, "thinking");
  assert.equal(summary.keyFindings.length, 2);
});

test("buildStepExecutionPrompt includes step tool and description", () => {
  const prompt = buildStepExecutionPrompt(
    "CSV を変換する",
    {
      id: "s1",
      tool: "sheet.filter_rows",
      description: "行をフィルタ",
      phase: "read",
      estimatedEffect: "条件に合う行を確認",
      args: {}
    },
    [],
    {}
  );

  assert.match(prompt, /sheet\.filter_rows/);
  assert.match(prompt, /行をフィルタ/);
});

test("buildCompressedContext returns a string when latest turns remain full", () => {
  const summaries = Array.from({ length: 5 }, (_, index) => ({
    turn: index + 1,
    toolsUsed: ["tool_a"],
    keyFindings: ["finding"],
    status: "thinking"
  }));

  const result = buildCompressedContext(summaries, 2);
  assert.equal(typeof result, "string");
  assert.match(result, /ターン 1/);
});
