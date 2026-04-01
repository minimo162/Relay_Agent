import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlanningPrompt,
  buildStepExecutionPrompt
} from "./agent-loop-prompts";

test("buildPlanningPrompt includes objective, tools, and plan template", () => {
  const prompt = buildPlanningPrompt(
    "approved が true の行だけ残してください",
    "ファイル: /tmp/demo.csv\n列: approved, amount",
    {
      read: ["workbook.inspect", "sheet.preview"],
      write: ["table.filter_rows", "workbook.save_copy"]
    }
  );

  assert.match(prompt, /approved が true の行だけ残してください/);
  assert.match(prompt, /workbook\.inspect/);
  assert.match(prompt, /table\.filter_rows/);
  assert.match(prompt, /"status": "plan_proposed"/);
  assert.match(prompt, /"executionPlan"/);
});

test("buildStepExecutionPrompt includes tool and description", () => {
  const prompt = buildStepExecutionPrompt(
    "CSV を変換する",
    {
      id: "step-1",
      tool: "sheet.preview",
      description: "データを確認する",
      phase: "read",
      estimatedEffect: "サンプル行を確認",
      args: {}
    },
    []
  );

  assert.match(prompt, /sheet\.preview/);
  assert.match(prompt, /データを確認する/);
});
