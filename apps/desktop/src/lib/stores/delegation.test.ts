import assert from "node:assert/strict";
import test from "node:test";

import { get } from "svelte/store";

import { activityFeedStore, delegationStore } from "./delegation";

test("delegation store supports goal to approval lifecycle", () => {
  delegationStore.reset();
  delegationStore.setGoal("approved が true の行だけ残す", ["/tmp/demo.csv"]);
  delegationStore.startPlanning();
  delegationStore.requestApproval();

  const state = get(delegationStore);
  assert.equal(state.state, "awaiting_approval");
  assert.equal(state.goal, "approved が true の行だけ残す");
  assert.deepEqual(state.attachedFiles, ["/tmp/demo.csv"]);
});

test("delegation store complete lifecycle: goal to completed", () => {
  delegationStore.reset();
  delegationStore.setGoal("テスト目標", ["/tmp/a.csv"]);
  delegationStore.startPlanning();
  delegationStore.proposePlan({
    summary: "テスト計画",
    totalEstimatedSteps: 2,
    steps: [
      {
        id: "s1",
        tool: "table.filter_rows",
        description: "フィルタ",
        phase: "read",
        estimatedEffect: "条件に合う行を確認",
        args: {}
      },
      {
        id: "s2",
        tool: "workbook.save_copy",
        description: "書き出し",
        phase: "write",
        estimatedEffect: "保存用コピーを作成",
        args: {}
      }
    ]
  });

  let state = get(delegationStore);
  assert.equal(state.state, "plan_review");
  assert.ok(state.plan !== null);

  delegationStore.approvePlan();
  state = get(delegationStore);
  assert.equal(state.state, "executing");
  assert.equal(state.currentStepIndex, 0);

  delegationStore.advanceStep();
  state = get(delegationStore);
  assert.equal(state.currentStepIndex, 1);

  delegationStore.complete();
  state = get(delegationStore);
  assert.equal(state.state, "completed");
});

test("delegation store hydrate restores state", () => {
  delegationStore.reset();
  delegationStore.hydrate({
    state: "executing",
    goal: "復元テスト",
    attachedFiles: ["/tmp/b.csv"],
    currentStepIndex: 3
  });

  const state = get(delegationStore);
  assert.equal(state.state, "executing");
  assert.equal(state.goal, "復元テスト");
  assert.equal(state.currentStepIndex, 3);
});

test("delegation store error state", () => {
  delegationStore.reset();
  delegationStore.setGoal("失敗テスト", []);
  delegationStore.startPlanning();
  delegationStore.setError("Copilot connection failed");

  const state = get(delegationStore);
  assert.equal(state.state, "error");
  assert.equal(state.error, "Copilot connection failed");
});

test("activity feed store appends timestamped events", () => {
  activityFeedStore.clear();
  activityFeedStore.push({
    type: "goal_set",
    message: "goal",
    icon: "💬"
  });

  const events = get(activityFeedStore);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "goal_set");
  assert.match(events[0]?.id ?? "", /^evt-/);
  assert.ok(events[0]?.timestamp);
});

test("activity feed store trims old events beyond max size", () => {
  activityFeedStore.clear();

  for (let index = 0; index < 205; index += 1) {
    activityFeedStore.push({
      type: "tool_executed",
      message: `event-${index}`,
      icon: "🧪"
    });
  }

  const events = get(activityFeedStore);
  assert.equal(events.length, 200);
  assert.equal(events[0]?.message, "event-5");
  assert.equal(events.at(-1)?.message, "event-204");
});
