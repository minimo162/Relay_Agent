export type AutoFixResult = {
  fixed: string;
  fixes: string[];
  originalPreserved: string;
};

export function autoFixCopilotResponse(raw: string): AutoFixResult {
  const fixes: string[] = [];
  let s = raw;

  // 1. Normalize smart quotes to ASCII before any JSON extraction/parsing
  const beforeSmartQuotes = s;
  s = s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  if (s !== beforeSmartQuotes) {
    fixes.push("引用符の種類を標準の記号にそろえました");
  }

  // 2. Normalize full-width spaces
  const beforeFullWidthSpaces = s;
  s = s.replace(/\u3000/g, " ");
  if (s !== beforeFullWidthSpaces) {
    fixes.push("全角スペースを半角スペースにそろえました");
  }

  // 3. Strip markdown fences
  const fencePattern = /^\s*(?:```|~~~)(?:json)?\s*\n([\s\S]*?)\n(?:```|~~~)\s*$/;
  const fenceMatch = s.match(fencePattern);
  if (fenceMatch) {
    s = fenceMatch[1];
    fixes.push("Markdown の記号を除去しました");
  }

  // 4. Trim whitespace
  const hadBom = s.startsWith("\uFEFF");
  const trimmed = s.trim();
  if (trimmed !== s) {
    fixes.push("前後の余分な空白を除去しました");
    s = trimmed;
  }

  // 5. Remove BOM
  if (hadBom || s.startsWith("\uFEFF")) {
    fixes.push("先頭の不要な文字を除去しました");
    s = s.replace(/^\uFEFF/, "");
  }

  // 6. Normalize CRLF → LF
  if (s.includes("\r\n")) {
    fixes.push("改行コードをそろえました");
    s = s.replace(/\r\n/g, "\n");
  }

  // 7. Extract a JSON object from surrounding prose
  if (!s.trimStart().startsWith("{") && s.includes("{")) {
    const extracted = extractJsonObjectBlock(s);
    if (extracted) {
      s = extracted;
      fixes.push("JSON 部分だけを取り出しました");
    }
  }

  // 8. Remove common markdown-style escaping that breaks JSON and tool names
  const beforeMarkdownEscapes = s;
  s = s.replace(/\\([\[\]_])/g, "$1");
  if (s !== beforeMarkdownEscapes) {
    fixes.push("Markdown 由来の不要なエスケープを除去しました");
  }

  // 9. Remove trailing commas in arrays and objects
  const beforeTrailingComma = s;
  s = s.replace(/,(\s*[}\]])/g, "$1");
  if (s !== beforeTrailingComma) {
    fixes.push("JSON の末尾カンマを修正しました");
  }

  // 10. Replace \\ with / in JSON string values only
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
    originalPreserved: raw
  };
}

function extractJsonObjectBlock(input: string): string | null {
  const start = input.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, index + 1);
      }
    }
  }

  return null;
}

function replaceBackslashesInStrings(
  value: unknown,
  didReplace: { value: boolean }
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
