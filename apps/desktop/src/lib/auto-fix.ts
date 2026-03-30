export type AutoFixResult = {
  fixed: string;
  fixes: string[];
  originalPreserved: string;
};

export function autoFixCopilotResponse(raw: string): AutoFixResult {
  const fixes: string[] = [];
  let s = raw;

  // 1. Strip markdown fences
  const fencePattern = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/;
  const fenceMatch = s.match(fencePattern);
  if (fenceMatch) {
    s = fenceMatch[1];
    fixes.push("Markdown の記号を除去しました");
  }

  // 2. Trim whitespace
  const hadBom = s.startsWith("\uFEFF");
  const trimmed = s.trim();
  if (trimmed !== s) {
    fixes.push("前後の余分な空白を除去しました");
    s = trimmed;
  }

  // 3. Remove BOM
  if (hadBom || s.startsWith("\uFEFF")) {
    fixes.push("先頭の不要な文字を除去しました");
    s = s.replace(/^\uFEFF/, "");
  }

  // 4. Normalize CRLF → LF
  if (s.includes("\r\n")) {
    fixes.push("改行コードをそろえました");
    s = s.replace(/\r\n/g, "\n");
  }

  // 5. Remove trailing commas in arrays and objects
  const beforeTrailingComma = s;
  s = s.replace(/,(\s*[}\]])/g, "$1");
  if (s !== beforeTrailingComma) {
    fixes.push("JSON の末尾カンマを修正しました");
  }

  // 6. Replace \\ with / in JSON string values only
  try {
    const parsed = JSON.parse(s);
    const didReplace = { value: false };
    const fixed = replaceBackslashesInStrings(parsed, didReplace);
    if (didReplace.value) {
      s = JSON.stringify(fixed, null, 2);
      fixes.push("ファイルパスの区切りを修正しました");
    }
  } catch {
    // JSON doesn't parse — skip step 6 to avoid corrupting broken JSON
  }

  return {
    fixed: s,
    fixes,
    originalPreserved: raw,
  };
}

function replaceBackslashesInStrings(
  value: unknown,
  didReplace: { value: boolean },
): unknown {
  if (typeof value === "string") {
    const replaced = value.replace(/\\/g, "/");
    if (replaced !== value) {
      didReplace.value = true;
    }
    return replaced;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceBackslashesInStrings(item, didReplace));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      result[key] = replaceBackslashesInStrings(obj[key], didReplace);
    }
    return result;
  }
  return value;
}
