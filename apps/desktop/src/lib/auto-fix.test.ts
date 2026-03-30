import test from "node:test";
import assert from "node:assert/strict";

import { autoFixCopilotResponse } from "./auto-fix";

test("strips markdown fences", () => {
  const result = autoFixCopilotResponse('```json\n{"summary":"ok","actions":[]}\n```');

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
  const result = autoFixCopilotResponse('{"summary":"ok","actions":[{"tool":"workbook.save_copy","args":{"outputPath":"/tmp/out.csv"}},]}');

  assert.equal(
    result.fixed,
    '{"summary":"ok","actions":[{"tool":"workbook.save_copy","args":{"outputPath":"/tmp/out.csv"}}]}'
  );
  assert.ok(result.fixes.includes("JSON の末尾カンマを修正しました"));
});

test("converts escaped windows paths after parsing", () => {
  const result = autoFixCopilotResponse(
    '{"summary":"ok","actions":[{"tool":"workbook.save_copy","args":{"outputPath":"C:\\\\temp\\\\out.csv"}}]}'
  );

  assert.match(result.fixed, /"outputPath": "C:\/temp\/out\.csv"/);
  assert.ok(result.fixes.includes("ファイルパスの区切りを修正しました"));
});

test("applies multiple fixes together", () => {
  const result = autoFixCopilotResponse(
    '  ```json\r\n{\r\n  "summary":"ok",\r\n  "actions":[{"tool":"workbook.save_copy","args":{"outputPath":"C:\\\\temp\\\\out.csv"}},],\r\n}\r\n```  '
  );

  assert.match(result.fixed, /"outputPath": "C:\/temp\/out\.csv"/);
  assert.ok(result.fixes.includes("Markdown の記号を除去しました"));
  assert.ok(result.fixes.includes("前後の余分な空白を除去しました"));
  assert.ok(result.fixes.includes("改行コードをそろえました"));
  assert.ok(result.fixes.includes("JSON の末尾カンマを修正しました"));
  assert.ok(result.fixes.includes("ファイルパスの区切りを修正しました"));
});
