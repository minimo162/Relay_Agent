import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCopilotVisibleText,
  normalizeProgressTextForUi,
  waitForDomResponse,
} from "./copilot_wait_dom_response.mjs";

test("normalizeProgressTextForUi suppresses an unchanged baseline reply", () => {
  assert.equal(normalizeProgressTextForUi("HTMLでテトリスを作成します！", "HTMLでテトリスを作成します！"), "");
});

test("normalizeProgressTextForUi trims a repeated baseline prefix from a new reply", () => {
  assert.equal(
    normalizeProgressTextForUi(
      "HTMLでテトリスを作成します！\n\nテトリスの HTML ファイルを作成しました ✅",
      "HTMLでテトリスを作成します！",
    ),
    "テトリスの HTML ファイルを作成しました ✅",
  );
});

test("normalizeProgressTextForUi keeps clearly new reply text intact", () => {
  assert.equal(
    normalizeProgressTextForUi("新しい回答の冒頭です。", "HTMLでテトリスを作成します！"),
    "新しい回答の冒頭です。",
  );
});

test("normalizeCopilotVisibleText strips transient image status noise and duplicate paragraphs", () => {
  assert.equal(
    normalizeCopilotVisibleText(
      [
        "Loading image",
        "了解しました。",
        "了解しました。",
        "",
        "Image has been generated",
        "",
        "最終結果です。",
        "",
        "最終結果です。",
      ].join("\n"),
    ),
    "了解しました。\n\n最終結果です。",
  );
});

test("normalizeProgressTextForUi keeps append-only progress after transient image noise is removed", () => {
  assert.equal(
    normalizeProgressTextForUi(
      "了解しました。\nLoading image\nImage has been generated\n\n最終結果です。",
      "了解しました。",
    ),
    "最終結果です。",
  );
});

test("waitForDomResponse emits streamed progress beyond the previous-turn baseline", async () => {
  const snapshots = [
    { generating: false, reply: "HTMLでテトリスを作成します！" },
    { generating: true, reply: "HTMLでテトリスを作成します！" },
    {
      generating: true,
      reply: "HTMLでテトリスを作成します！\n\nテトリスの HTML ファイルを作成しました ✅",
    },
    {
      generating: false,
      reply: "HTMLでテトリスを作成します！\n\nテトリスの HTML ファイルを作成しました ✅",
    },
  ];
  let pollIndex = 0;
  const session = {
    async evaluate() {
      const snapshot = snapshots[Math.min(pollIndex, snapshots.length - 1)];
      pollIndex += 1;
      return { value: snapshot };
    },
  };
  const progress = [];

  const response = await waitForDomResponse(session, null, 0, null, {
    timeoutMs: 2_500,
    onProgress: async (snapshot) => {
      progress.push(snapshot);
    },
  });

  assert.equal(
    response,
    "HTMLでテトリスを作成します！\n\nテトリスの HTML ファイルを作成しました ✅",
  );
  assert.deepEqual(
    progress.map((snapshot) => snapshot.visibleText),
    ["テトリスの HTML ファイルを作成しました ✅"],
  );
});

test("waitForDomResponse suppresses transient image noise from streamed progress and final text", async () => {
  const snapshots = [
    { generating: false, reply: "了解しました。" },
    { generating: true, reply: "了解しました。\nLoading image" },
    {
      generating: true,
      reply: "了解しました。\nLoading image\nImage has been generated\n\n最終結果です。",
    },
    {
      generating: false,
      reply: "了解しました。\nLoading image\nImage has been generated\n\n最終結果です。",
    },
  ];
  let pollIndex = 0;
  const session = {
    async evaluate() {
      const snapshot = snapshots[Math.min(pollIndex, snapshots.length - 1)];
      pollIndex += 1;
      return { value: snapshot };
    },
  };
  const progress = [];

  const response = await waitForDomResponse(session, null, 0, null, {
    timeoutMs: 2_500,
    onProgress: async (snapshot) => {
      progress.push(snapshot);
    },
  });

  assert.equal(response, "了解しました。\n\n最終結果です。");
  assert.deepEqual(
    progress.map((snapshot) => snapshot.visibleText),
    ["最終結果です。"],
  );
});
