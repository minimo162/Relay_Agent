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
  const result = autoFixCopilotResponse('{"summary":"ok","actions":[{"tool":"workbook.save_copy","args":{"outputPath":"/tmp/out.csv"}},]}');

  assert.equal(
    result.fixed,
    '{"summary":"ok","actions":[{"tool":"workbook.save_copy","args":{"outputPath":"/tmp/out.csv"}}]}'
  );
  assert.ok(result.fixes.includes("JSON の末尾カンマを修正しました"));
});

test("removes markdown-style escaping from underscores and brackets", () => {
  const result = autoFixCopilotResponse(
    '{\n"summary":"ok","actions": \\[\n{"tool":"table.group\\_aggregate","sheet":"Sheet1","args":{"groupBy": \\["__all\\_rows"],"measures": \\[{"column":"amount","op":"sum","as":"total\\_amount"}\\]}}\n\\]\n}'
  );

  assert.match(result.fixed, /"actions": \[/);
  assert.match(result.fixed, /"tool":"table.group_aggregate"/);
  assert.match(result.fixed, /"groupBy": \["__all_rows"\]/);
  assert.match(result.fixed, /"as":"total_amount"/);
  assert.ok(result.fixes.includes("Markdown 由来の不要なエスケープを除去しました"));
});

test("converts escaped windows paths after parsing", () => {
  const result = autoFixCopilotResponse(
    '{"summary":"ok","actions":[{"tool":"workbook.save_copy","args":{"outputPath":"C:\\\\temp\\\\out.csv"}}]}'
  );

  assert.match(result.fixed, /"outputPath": "C:\/temp\/out\.csv"/);
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
    '以下が JSON です。\n{"summary":"ok","actions":[{"tool":"workbook.save_copy","args":{"outputPath":"/tmp/out.csv"}}]}\nよろしくお願いします。'
  );

  assert.equal(
    result.fixed,
    '{"summary":"ok","actions":[{"tool":"workbook.save_copy","args":{"outputPath":"/tmp/out.csv"}}]}'
  );
  assert.ok(result.fixes.includes("JSON 部分だけを取り出しました"));
});

test("applies multiple fixes together", () => {
  const result = autoFixCopilotResponse(
    '  ~~~json\r\n\u3000{\r\n  “summary”:“ok”,\r\n  “actions”:[{"tool":"workbook.save_copy","args":{"outputPath":"C:\\\\temp\\\\out.csv"}},],\r\n}\r\n~~~  '
  );

  assert.match(result.fixed, /"outputPath": "C:\/temp\/out\.csv"/);
  assert.ok(result.fixes.includes("Markdown の記号を除去しました"));
  assert.ok(result.fixes.includes("引用符の種類を標準の記号にそろえました"));
  assert.ok(result.fixes.includes("全角スペースを半角スペースにそろえました"));
  assert.ok(result.fixes.includes("前後の余分な空白を除去しました"));
  assert.ok(result.fixes.includes("改行コードをそろえました"));
  assert.ok(result.fixes.includes("JSON の末尾カンマを修正しました"));
  assert.ok(result.fixes.includes("ファイルパスの区切りを修正しました"));
});
