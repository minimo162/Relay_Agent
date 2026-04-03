import test from "node:test";
import assert from "node:assert/strict";

import { autoFixCopilotResponse } from "./auto-fix";

test("strips markdown fences", () => {
  const result = autoFixCopilotResponse('```json\n{"summary":"ok","actions":[]}\n```');

  assert.equal(result.fixed, '{"summary":"ok","actions":[]}');
  assert.deepEqual(result.fixes, ["Markdown の記号を除去しました"]);
});

test("strips tilde markdown fences", () => {
  const result = autoFixCopilotResponse('~~~json\n{"summary":"ok","actions":[]}\n~~~');

  assert.equal(result.fixed, '{"summary":"ok","actions":[]}');
  assert.deepEqual(result.fixes, ["Markdown の記号を除去しました"]);
});

test("removes bom and normalizes line endings", () => {
  const result = autoFixCopilotResponse("\uFEFF{\r\n\"summary\":\"ok\",\r\n\"actions\":[]\r\n}");

  assert.equal(result.fixed, '{\n"summary":"ok",\n"actions":[]\n}');
  assert.ok(result.fixes.includes("先頭の不要な文字を除去しました"));
  assert.ok(result.fixes.includes("改行コードをそろえました"));
});

test("removes trailing commas", () => {
  const result = autoFixCopilotResponse('{"summary":"ok","actions":[{"tool":"file.copy","args":{"sourcePath":"/tmp/in.csv","destPath":"/tmp/out.csv"}},]}');

  assert.equal(
    result.fixed,
    '{"summary":"ok","actions":[{"tool":"file.copy","args":{"sourcePath":"/tmp/in.csv","destPath":"/tmp/out.csv"}}]}'
  );
  assert.ok(result.fixes.includes("JSON の末尾カンマを修正しました"));
});

test("removes markdown-style escaping from underscores and brackets", () => {
  const result = autoFixCopilotResponse(
    '{\n"summary":"ok","actions": \\[\n{"tool":"text.replace","args":{"path":"C:\\\\tmp\\\\notes.txt","pattern":"draft\\_copy","replacement":"approved\\_copy"}}\n\\]\n}'
  );

  assert.match(result.fixed, /"actions": \[/);
  assert.match(result.fixed, /"tool":"text.replace"/);
  assert.match(result.fixed, /"pattern":"draft_copy"/);
  assert.match(result.fixed, /"replacement":"approved_copy"/);
  assert.ok(result.fixes.includes("Markdown 由来の不要なエスケープを除去しました"));
});

test("converts escaped windows paths after parsing", () => {
  const result = autoFixCopilotResponse(
    '{"summary":"ok","actions":[{"tool":"file.copy","args":{"sourcePath":"C:\\\\temp\\\\in.csv","destPath":"C:\\\\temp\\\\out.csv"}}]}'
  );

  assert.match(result.fixed, /"sourcePath": "C:\/temp\/in\.csv"/);
  assert.match(result.fixed, /"destPath": "C:\/temp\/out\.csv"/);
  assert.ok(result.fixes.includes("ファイルパスの区切りを修正しました"));
});

test("normalizes smart quotes and full-width spaces", () => {
  const result = autoFixCopilotResponse(
    '\u3000{\n  “summary”: “ok”,\n  “actions”: []\n}'
  );

  assert.equal(result.fixed, '{\n  "summary": "ok",\n  "actions": []\n}');
  assert.ok(result.fixes.includes("引用符の種類を標準の記号にそろえました"));
  assert.ok(result.fixes.includes("全角スペースを半角スペースにそろえました"));
});

test("extracts a json object from surrounding prose", () => {
  const result = autoFixCopilotResponse(
    '以下が JSON です。\n{"summary":"ok","actions":[{"tool":"file.delete","args":{"path":"/tmp/out.csv","toRecycleBin":false}}]}\nよろしくお願いします。'
  );

  assert.equal(
    result.fixed,
    '{"summary":"ok","actions":[{"tool":"file.delete","args":{"path":"/tmp/out.csv","toRecycleBin":false}}]}'
  );
  assert.ok(result.fixes.includes("JSON 部分だけを取り出しました"));
});

test("applies multiple fixes together", () => {
  const result = autoFixCopilotResponse(
    '  ~~~json\r\n\u3000{\r\n  “summary”:“ok”,\r\n  “actions”:[{"tool":"file.move","args":{"sourcePath":"C:\\\\temp\\\\in.csv","destPath":"C:\\\\temp\\\\out.csv"}},],\r\n}\r\n~~~  '
  );

  assert.match(result.fixed, /"sourcePath": "C:\/temp\/in\.csv"/);
  assert.match(result.fixed, /"destPath": "C:\/temp\/out\.csv"/);
  assert.ok(result.fixes.includes("Markdown の記号を除去しました"));
  assert.ok(result.fixes.includes("引用符の種類を標準の記号にそろえました"));
  assert.ok(result.fixes.includes("全角スペースを半角スペースにそろえました"));
  assert.ok(result.fixes.includes("前後の余分な空白を除去しました"));
  assert.ok(result.fixes.includes("改行コードをそろえました"));
  assert.ok(result.fixes.includes("JSON の末尾カンマを修正しました"));
  assert.ok(result.fixes.includes("ファイルパスの区切りを修正しました"));
});
