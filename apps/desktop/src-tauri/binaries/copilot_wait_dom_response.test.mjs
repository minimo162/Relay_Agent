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

test("normalizeProgressTextForUi drops internal thinking-style draft text", () => {
  assert.equal(
    normalizeProgressTextForUi(
      "The user wants me to create a Tetris game in HTML. I'll create a complete, playable Tetris game as a single HTML file.",
      "",
    ),
    "",
  );
});

test("normalizeProgressTextForUi trims relay_tool blocks from streamed text", () => {
  assert.equal(
    normalizeProgressTextForUi(
      [
        "ファイルを作成します。",
        "",
        "```relay_tool",
        '{"name":"write_file","relay_tool_call":true,"input":{"path":"tetris.html"}}',
        "```",
      ].join("\n"),
      "",
    ),
    "ファイルを作成します。",
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

test("normalizeCopilotVisibleText strips internal reasoning lead-ins and search-planning paragraphs", () => {
  assert.equal(
    normalizeCopilotVisibleText(
      "推論が 2 ステップで完了しました 了解しました。\n\n最終結果です。",
    ),
    "了解しました。\n\n最終結果です。",
  );
  assert.equal(
    normalizeCopilotVisibleText(
      "Show**Considering search options**I’m evaluating the best approach to gather HTML Tetris code using available tools, specifically focusing on the office365_search for relevant files.",
    ),
    "",
  );
});

test("normalizeCopilotVisibleText strips M365 source and streaming chrome from short answers", () => {
  assert.equal(
    normalizeCopilotVisibleText(
      [
        "Copilot said:",
        "Copilot",
        "東京",
        "bing",
        "",
        "Generating response",
        "Sources",
      ].join("\n"),
    ),
    "東京",
  );
});

test("normalizeCopilotVisibleText strips plain-text wrapper chrome around fenced tool output", () => {
  assert.equal(
    normalizeCopilotVisibleText(
      [
        "Plain Text",
        "relay_tool isn’t fully supported. Syntax highlighting is based on Plain Text.",
        '{"relay_tool_call":true,"name":"noop","input":{}}',
      ].join("\n"),
    ),
    '{"relay_tool_call":true,"name":"noop","input":{}}',
  );
});

test("normalizeCopilotVisibleText strips a Copilot prefix glued to the visible reply", () => {
  assert.equal(normalizeCopilotVisibleText("CopilotOK"), "OK");
});

test("normalizeCopilotVisibleText strips reasoning chrome, show-more chrome, and code badges", () => {
  assert.equal(
    normalizeCopilotVisibleText(
      [
        "Reasoning completed in 5 steps",
        "了解です。",
        "cloud",
        "",
        "HTML",
        "<!doctype html>",
        "<html lang=\"en\">",
        "Show more lines",
      ].join("\n"),
    ),
    ["了解です。", "", "<!doctype html>", "<html lang=\"en\">"].join("\n"),
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

test("waitForDomResponse suppresses internal draft progress and keeps only visible rewrites", async () => {
  const snapshots = [
    { generating: false, reply: "" },
    {
      generating: true,
      reply: "The user wants me to create a Tetris game in HTML. I'll create a complete, playable Tetris game.",
    },
    {
      generating: true,
      reply: "HTML で遊べるテトリスを 1 ファイルで作成します。",
    },
    {
      generating: false,
      reply: "HTML で遊べるテトリスを 1 ファイルで作成します。",
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

  assert.equal(response, "HTML で遊べるテトリスを 1 ファイルで作成します。");
  assert.deepEqual(
    progress.map((snapshot) => snapshot.visibleText),
    ["HTML で遊べるテトリスを 1 ファイルで作成します。"],
  );
});

test("waitForDomResponse prefers a fuller assistant turn over a short reply-div candidate", async () => {
  const shortReply = "HTMLでテトリスを作成します！";
  const fullReply = [
    "HTMLでテトリスを作成します！",
    "",
    "次の手順で 1 ファイルの実装を作成します。",
    "",
    "1. キャンバスを配置します。",
    "2. 落下ロジックを実装します。",
  ].join("\n");
  const snapshots = [
    { generating: false, reply: "" },
    { generating: true, reply: shortReply },
    { generating: false, reply: shortReply },
  ];
  let pollIndex = 0;
  const session = {
    async evaluate(script) {
      if (String(script).includes("reply: replyRaw")) {
        const snapshot = snapshots[Math.min(pollIndex, snapshots.length - 1)];
        pollIndex += 1;
        return { value: snapshot };
      }
      if (String(script).includes("const includeGenericSelectors = false")) {
        return { value: fullReply };
      }
      if (String(script).includes("const includeGenericSelectors = true")) {
        return { value: fullReply };
      }
      return { value: "" };
    },
  };
  const progress = [];

  const response = await waitForDomResponse(session, null, 0, null, {
    timeoutMs: 2_500,
    onProgress: async (snapshot) => {
      progress.push(snapshot);
    },
  });

  assert.equal(response, fullReply);
  assert.deepEqual(
    progress.map((snapshot) => snapshot.visibleText),
    [shortReply],
  );
});

test("waitForDomResponse returns the full relay_tool reply while progress stays tool-free", async () => {
  const shortReply = "HTMLでテトリスを作成します！";
  const fullReply = [
    "HTMLでテトリスを作成します！",
    "",
    "```relay_tool",
    '{"name":"write_file","relay_tool_call":true,"input":{"path":"tetris.html"}}',
    "```",
    "",
    "`tetris.html` をワークスペースに作成しました。",
  ].join("\n");
  const snapshots = [
    { generating: false, reply: "" },
    { generating: true, reply: shortReply },
    { generating: false, reply: shortReply },
  ];
  let pollIndex = 0;
  const session = {
    async evaluate(script) {
      if (String(script).includes("reply: replyRaw")) {
        const snapshot = snapshots[Math.min(pollIndex, snapshots.length - 1)];
        pollIndex += 1;
        return { value: snapshot };
      }
      if (String(script).includes("const includeGenericSelectors = false")) {
        return { value: fullReply };
      }
      if (String(script).includes("const includeGenericSelectors = true")) {
        return { value: fullReply };
      }
      return { value: "" };
    },
  };
  const progress = [];

  const response = await waitForDomResponse(session, null, 0, null, {
    timeoutMs: 2_500,
    onProgress: async (snapshot) => {
      progress.push(snapshot);
    },
  });

  assert.equal(response, fullReply);
  assert.deepEqual(
    progress.map((snapshot) => snapshot.visibleText),
    [shortReply],
  );
});

test("waitForDomResponse keeps a short valid DOM reply over longer thought-like network text", async () => {
  const snapshots = [
    { generating: false, reply: "" },
    { generating: true, reply: "最終結果です。" },
    { generating: false, reply: "最終結果です。" },
  ];
  let pollIndex = 0;
  const session = {
    async evaluate() {
      const snapshot = snapshots[Math.min(pollIndex, snapshots.length - 1)];
      pollIndex += 1;
      return { value: snapshot };
    },
  };
  const netCapture = {
    async pickBestOver(domText) {
      assert.equal(domText, "最終結果です。");
      return "Show**Considering search options**I’m evaluating the best approach to gather HTML Tetris code using available tools, specifically focusing on the office365_search for relevant files.";
    },
  };

  const response = await waitForDomResponse(session, netCapture, 0, null, {
    timeoutMs: 2_500,
  });

  assert.equal(response, "最終結果です。");
});

test("waitForDomResponse waits past progress-only search UI until a real assistant reply appears", async () => {
  const finalReply = [
    "了解です。単一 HTML のテトリスを作成します。",
    "",
    "```html",
    "<!doctype html>",
    "<html lang=\"en\">",
    "```",
  ].join("\n");
  const snapshots = [
    {
      generating: false,
      reply: "",
      progressOnly: false,
      hasVisibleAssistantChat: false,
      hasExpandableCodeBlock: false,
    },
    {
      generating: true,
      reply: "Get a quick answer\nRetrying searches\n\nOK, I'll search for 'html テトリス'...",
      progressOnly: true,
      hasVisibleAssistantChat: false,
      hasExpandableCodeBlock: false,
    },
    {
      generating: false,
      reply: "Get a quick answer\nRetrying searches\n\nIt seems there was an error retrieving the expected results, so I'm planning to retry with separate calls and also conduct a web search for the Tetris HTML file.",
      progressOnly: true,
      hasVisibleAssistantChat: false,
      hasExpandableCodeBlock: false,
    },
    {
      generating: false,
      reply: finalReply,
      progressOnly: false,
      hasVisibleAssistantChat: true,
      hasExpandableCodeBlock: false,
    },
    {
      generating: false,
      reply: finalReply,
      progressOnly: false,
      hasVisibleAssistantChat: true,
      hasExpandableCodeBlock: false,
    },
    {
      generating: false,
      reply: finalReply,
      progressOnly: false,
      hasVisibleAssistantChat: true,
      hasExpandableCodeBlock: false,
    },
  ];
  let pollIndex = 0;
  const progress = [];
  const session = {
    async evaluate(script) {
      if (String(script).includes("reply: replyRaw")) {
        const snapshot = snapshots[Math.min(pollIndex, snapshots.length - 1)];
        pollIndex += 1;
        return { value: snapshot };
      }
      if (String(script).includes("const includeGenericSelectors = false")) {
        return { value: finalReply };
      }
      if (String(script).includes("const includeGenericSelectors = true")) {
        return { value: finalReply };
      }
      return { value: "" };
    },
  };

  const response = await waitForDomResponse(session, null, 0, null, {
    timeoutMs: 3_500,
    onProgress: async (snapshot) => {
      progress.push(snapshot.visibleText);
    },
  });

  assert.equal(response, finalReply);
  assert.equal(progress.some((text) => /Get a quick answer|Retrying searches|I'll search/i.test(text)), false);
  assert.equal(progress.at(-1), finalReply);
});

test("waitForDomResponse expands show-more code blocks before returning the assistant reply", async () => {
  const truncatedReply = [
    "了解です。",
    "<!doctype html>",
    "Show more lines",
  ].join("\n");
  const fullReply = [
    "了解です。",
    "<!doctype html>",
    "<html lang=\"en\">",
    "<body></body>",
    "</html>",
  ].join("\n");
  let expanded = false;
  let expandCalls = 0;
  let pollIndex = 0;
  const session = {
    async evaluate(script) {
      const source = String(script);
      if (source.includes("reply: replyRaw")) {
        pollIndex += 1;
        return {
          value: {
            generating: false,
            reply: expanded ? fullReply : truncatedReply,
            progressOnly: false,
            hasVisibleAssistantChat: true,
            hasExpandableCodeBlock: !expanded,
          },
        };
      }
      if (source.includes("const includeGenericSelectors = false")) {
        return { value: expanded ? fullReply : truncatedReply };
      }
      if (source.includes("const includeGenericSelectors = true")) {
        return { value: expanded ? fullReply : truncatedReply };
      }
      if (source.includes("show more lines|show more|もっと表示")) {
        expandCalls += 1;
        expanded = true;
        return { value: { clicked: true, label: "Show more lines" } };
      }
      return { value: "" };
    },
  };

  const response = await waitForDomResponse(session, null, 0, null, {
    timeoutMs: 8_500,
  });

  assert.equal(response, fullReply);
  assert.equal(expandCalls, 1);
  assert.ok(pollIndex >= 3);
});
