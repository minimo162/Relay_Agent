import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProgressTextForUi, waitForDomResponse } from "./copilot_wait_dom_response.mjs";

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
