# Codex プロンプト 15 — 汎用ファイル操作（Tasks 144–149）

## 対象タスク

- **Task 144**: バックエンド — file.copy / file.move / file.delete 実装
- **Task 145**: バックエンド — text.search / text.replace ツール実装
- **Task 146**: バックエンド — Word/PowerPoint/PDF 読み取りサポート
- **Task 147**: Contracts 拡張 — text & document ツールスキーマ
- **Task 148**: フロントエンド — ファイル操作のプレビュー UI
- **Task 149**: E2E 検証 — 汎用ファイル操作（手動）

## 概要

Phase 1–3 はスプレッドシート専用だった。Phase 7 で任意ファイル操作に拡張する。
read ツールは自動実行、write ツールは承認ゲート経由。

**基本方針:**
- `file.copy` / `file.move` / `file.delete` は既に Contracts に定義済み（`packages/contracts/src/file.ts`）
- `text.search` / `text.replace` / `document.read_text` は新規 Contracts 追加
- バックエンドは Rust で実装し、既存の `executeReadActions` / approval フローに統合
- `file.delete` はゴミ箱移動（`trash` クレート）、`text.replace` はバックアップ作成

## 前提

### 既存 Contracts — `packages/contracts/src/file.ts`

```typescript
// 既に定義済み:
fileListActionSchema       // file.list    — read
fileReadTextActionSchema   // file.read_text — read
fileStatActionSchema       // file.stat    — read
fileCopyActionSchema       // file.copy    — write (sourcePath, destPath, overwrite)
fileMoveActionSchema       // file.move    — write (sourcePath, destPath, overwrite)
fileDeleteActionSchema     // file.delete  — write (path, toRecycleBin)

fileActionSchema = z.discriminatedUnion("tool", [...all above...])
```

### 既存 Contracts — `packages/contracts/src/relay.ts`

```typescript
relayActionSchema = z.union([spreadsheetActionSchema, fileActionSchema])
```

### 既存バックエンド

- `apps/desktop/src-tauri/src/execution.rs` — `execute_read_actions` コマンド（スプレッドシート read tools のみ対応）
- `apps/desktop/src-tauri/src/storage.rs` — `execute_read_actions()` / `preview_execution()` / `run_execution()`
- Rust の `SpreadsheetAction` struct は `tool: String, args: Value` で汎用的

---

## Task 147: Contracts 拡張 — text & document ツールスキーマ

**実装順序: 最初（スキーマ定義が先）**

### `packages/contracts/src/file.ts` に追加

```typescript
// --- Text tools ---

export const textSearchActionSchema = z.object({
  tool: z.literal("text.search"),
  args: z.object({
    path: nonEmptyStringSchema,
    pattern: nonEmptyStringSchema,           // 正規表現パターン
    maxMatches: z.number().int().positive().max(500).default(50),
    contextLines: z.number().int().nonnegative().max(10).default(2)
  })
});

export const textReplaceActionSchema = z.object({
  tool: z.literal("text.replace"),
  args: z.object({
    path: nonEmptyStringSchema,
    pattern: nonEmptyStringSchema,           // 正規表現パターン
    replacement: z.string(),
    createBackup: z.boolean().default(true)
  })
});

// --- Document tools ---

export const documentReadTextActionSchema = z.object({
  tool: z.literal("document.read_text"),
  args: z.object({
    path: nonEmptyStringSchema,
    maxChars: z.number().int().positive().max(500_000).default(50_000)
  })
});

export type TextSearchAction = z.infer<typeof textSearchActionSchema>;
export type TextReplaceAction = z.infer<typeof textReplaceActionSchema>;
export type DocumentReadTextAction = z.infer<typeof documentReadTextActionSchema>;
```

### `fileActionSchema` に追加

```typescript
export const fileActionSchema = z.discriminatedUnion("tool", [
  fileListActionSchema,
  fileReadTextActionSchema,
  fileStatActionSchema,
  fileCopyActionSchema,
  fileMoveActionSchema,
  fileDeleteActionSchema,
  textSearchActionSchema,       // 追加
  textReplaceActionSchema,       // 追加
  documentReadTextActionSchema   // 追加
]);
```

### 確認

- `pnpm -C packages/contracts build` がパスすること
- `packages/contracts/src/index.ts` は `export * from "./file"` 済みなので追加不要

---

## Task 144: バックエンド — file.copy / file.move / file.delete 実装

### 新規ファイル: `apps/desktop/src-tauri/src/file_ops.rs`

```rust
use std::path::Path;
use serde_json::Value;

/// file.copy — ファイルをコピー
pub fn execute_file_copy(args: &Value) -> Result<Value, String> {
    let source = args.get("sourcePath")
        .and_then(Value::as_str)
        .ok_or("sourcePath is required")?;
    let dest = args.get("destPath")
        .and_then(Value::as_str)
        .ok_or("destPath is required")?;
    let overwrite = args.get("overwrite")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let source_path = Path::new(source);
    let dest_path = Path::new(dest);

    if !source_path.exists() {
        return Err(format!("source file not found: {}", source));
    }
    if dest_path.exists() && !overwrite {
        return Err(format!("destination already exists: {} (set overwrite: true to replace)", dest));
    }

    // 親ディレクトリが存在しなければ作成
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create destination directory: {}", e))?;
    }

    let bytes_copied = std::fs::copy(source_path, dest_path)
        .map_err(|e| format!("file copy failed: {}", e))?;

    Ok(serde_json::json!({
        "ok": true,
        "sourcePath": source,
        "destPath": dest,
        "bytesCopied": bytes_copied
    }))
}

/// file.move — ファイルを移動/リネーム
pub fn execute_file_move(args: &Value) -> Result<Value, String> {
    let source = args.get("sourcePath")
        .and_then(Value::as_str)
        .ok_or("sourcePath is required")?;
    let dest = args.get("destPath")
        .and_then(Value::as_str)
        .ok_or("destPath is required")?;
    let overwrite = args.get("overwrite")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let source_path = Path::new(source);
    let dest_path = Path::new(dest);

    if !source_path.exists() {
        return Err(format!("source file not found: {}", source));
    }
    if dest_path.exists() && !overwrite {
        return Err(format!("destination already exists: {}", dest));
    }

    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create destination directory: {}", e))?;
    }

    std::fs::rename(source_path, dest_path)
        .map_err(|e| format!("file move failed: {}", e))?;

    Ok(serde_json::json!({
        "ok": true,
        "sourcePath": source,
        "destPath": dest
    }))
}

/// file.delete — ファイルをゴミ箱に移動（安全削除）
pub fn execute_file_delete(args: &Value) -> Result<Value, String> {
    let path = args.get("path")
        .and_then(Value::as_str)
        .ok_or("path is required")?;
    let to_recycle_bin = args.get("toRecycleBin")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let file_path = Path::new(path);
    if !file_path.exists() {
        return Err(format!("file not found: {}", path));
    }

    if to_recycle_bin {
        trash::delete(file_path)
            .map_err(|e| format!("trash delete failed: {}", e))?;
    } else {
        std::fs::remove_file(file_path)
            .map_err(|e| format!("file delete failed: {}", e))?;
    }

    Ok(serde_json::json!({
        "ok": true,
        "path": path,
        "method": if to_recycle_bin { "recycle_bin" } else { "permanent" }
    }))
}
```

### Cargo.toml に `trash` クレート追加

```toml
[dependencies]
trash = "5"
```

### `lib.rs` に `mod file_ops;` 追加

### `storage.rs` の `execute_read_actions` を拡張

既存の read action ディスパッチに file read ツールを追加:

```rust
match action.tool.as_str() {
    // 既存 spreadsheet read tools...
    "workbook.inspect" => { /* 既存 */ }
    "sheet.preview" => { /* 既存 */ }
    // 新規 file read tools
    "file.list" => file_ops::execute_file_list(&action.args),
    "file.read_text" => file_ops::execute_file_read_text(&action.args),
    "file.stat" => file_ops::execute_file_stat(&action.args),
    _ => Err(format!("unknown read tool: {}", action.tool)),
}
```

write ツール（`file.copy`, `file.move`, `file.delete`）は既存の `run_execution` パスで
承認後に実行されるよう統合:

```rust
match action.tool.as_str() {
    // 既存 spreadsheet write tools...
    // 新規 file write tools
    "file.copy" => file_ops::execute_file_copy(&action.args),
    "file.move" => file_ops::execute_file_move(&action.args),
    "file.delete" => file_ops::execute_file_delete(&action.args),
    _ => Err(format!("unknown write tool: {}", action.tool)),
}
```

---

## Task 145: バックエンド — text.search / text.replace ツール実装

### `file_ops.rs` に追加

```rust
use regex::Regex;

/// text.search — 正規表現でテキスト検索（read ツール、自動実行）
pub fn execute_text_search(args: &Value) -> Result<Value, String> {
    let path = args.get("path").and_then(Value::as_str)
        .ok_or("path is required")?;
    let pattern = args.get("pattern").and_then(Value::as_str)
        .ok_or("pattern is required")?;
    let max_matches = args.get("maxMatches")
        .and_then(Value::as_u64).unwrap_or(50) as usize;
    let context_lines = args.get("contextLines")
        .and_then(Value::as_u64).unwrap_or(2) as usize;

    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read file: {}", e))?;
    let re = Regex::new(pattern)
        .map_err(|e| format!("invalid regex: {}", e))?;

    let lines: Vec<&str> = content.lines().collect();
    let mut matches = Vec::new();

    for (line_num, line) in lines.iter().enumerate() {
        if matches.len() >= max_matches { break; }
        if re.is_match(line) {
            let start = line_num.saturating_sub(context_lines);
            let end = (line_num + context_lines + 1).min(lines.len());
            let context: Vec<serde_json::Value> = (start..end)
                .map(|i| serde_json::json!({
                    "lineNumber": i + 1,
                    "text": lines[i],
                    "isMatch": i == line_num
                }))
                .collect();

            matches.push(serde_json::json!({
                "lineNumber": line_num + 1,
                "matchedText": line,
                "context": context
            }));
        }
    }

    Ok(serde_json::json!({
        "ok": true,
        "path": path,
        "pattern": pattern,
        "matchCount": matches.len(),
        "matches": matches,
        "truncated": matches.len() >= max_matches
    }))
}

/// text.replace — 正規表現で置換（write ツール、承認必須）
pub fn execute_text_replace(args: &Value) -> Result<Value, String> {
    let path = args.get("path").and_then(Value::as_str)
        .ok_or("path is required")?;
    let pattern = args.get("pattern").and_then(Value::as_str)
        .ok_or("pattern is required")?;
    let replacement = args.get("replacement").and_then(Value::as_str)
        .ok_or("replacement is required")?;
    let create_backup = args.get("createBackup")
        .and_then(Value::as_bool).unwrap_or(true);

    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read file: {}", e))?;
    let re = Regex::new(pattern)
        .map_err(|e| format!("invalid regex: {}", e))?;

    let new_content = re.replace_all(&content, replacement).to_string();
    let change_count = re.find_iter(&content).count();

    if change_count == 0 {
        return Ok(serde_json::json!({
            "ok": true,
            "path": path,
            "changeCount": 0,
            "message": "no matches found"
        }));
    }

    if create_backup {
        let backup_path = format!("{}.bak", path);
        std::fs::copy(path, &backup_path)
            .map_err(|e| format!("failed to create backup: {}", e))?;
    }

    std::fs::write(path, &new_content)
        .map_err(|e| format!("failed to write file: {}", e))?;

    Ok(serde_json::json!({
        "ok": true,
        "path": path,
        "pattern": pattern,
        "replacement": replacement,
        "changeCount": change_count,
        "backupCreated": create_backup
    }))
}
```

### Cargo.toml に `regex` 追加

```toml
[dependencies]
regex = "1"
```

### `execute_read_actions` のディスパッチに追加

```rust
"text.search" => file_ops::execute_text_search(&action.args),
```

### `run_execution` のディスパッチに追加

```rust
"text.replace" => file_ops::execute_text_replace(&action.args),
```

---

## Task 146: バックエンド — Word/PowerPoint/PDF 読み取りサポート

### `file_ops.rs` に追加

```rust
/// document.read_text — Word/PPTX/PDF からプレーンテキスト抽出（read ツール）
pub fn execute_document_read_text(args: &Value) -> Result<Value, String> {
    let path = args.get("path").and_then(Value::as_str)
        .ok_or("path is required")?;
    let max_chars = args.get("maxChars")
        .and_then(Value::as_u64).unwrap_or(50_000) as usize;

    let file_path = Path::new(path);
    if !file_path.exists() {
        return Err(format!("file not found: {}", path));
    }

    let extension = file_path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let text = match extension.as_str() {
        "docx" => extract_docx_text(file_path)?,
        "pptx" => extract_pptx_text(file_path)?,
        "pdf"  => extract_pdf_text(file_path)?,
        "txt" | "md" | "csv" | "json" | "xml" | "yaml" | "yml" | "toml" => {
            std::fs::read_to_string(file_path)
                .map_err(|e| format!("failed to read text file: {}", e))?
        }
        _ => return Err(format!("unsupported file type: .{}", extension))
    };

    let truncated = text.len() > max_chars;
    let result_text = if truncated {
        &text[..max_chars]
    } else {
        &text
    };

    Ok(serde_json::json!({
        "ok": true,
        "path": path,
        "format": extension,
        "charCount": result_text.len(),
        "truncated": truncated,
        "text": result_text
    }))
}
```

**ドキュメント抽出の実装方針:**
- `.docx` — ZIP 解凍 → `word/document.xml` パース → テキストノード抽出（`zip` + `quick-xml` クレート）
- `.pptx` — ZIP 解凍 → `ppt/slides/slide*.xml` パース → テキストノード抽出
- `.pdf` — `pdf-extract` または `lopdf` クレート

### Cargo.toml

```toml
[dependencies]
zip = "2"
quick-xml = "0.36"
lopdf = "0.34"
```

### `execute_read_actions` のディスパッチに追加

```rust
"document.read_text" => file_ops::execute_document_read_text(&action.args),
```

---

## Task 148: フロントエンド — ファイル操作のプレビュー UI

### 新規コンポーネント: `apps/desktop/src/lib/components/FileOpPreview.svelte`

```svelte
<script lang="ts">
  export let actions: Array<{
    tool: string;
    args: Record<string, unknown>;
  }> = [];

  type FileOpSummary = {
    tool: string;
    label: string;
    icon: string;
    details: string[];
  };

  function summarize(action: typeof actions[0]): FileOpSummary {
    const args = action.args;
    switch (action.tool) {
      case "file.copy":
        return {
          tool: action.tool,
          label: "ファイルコピー",
          icon: "📋",
          details: [
            `コピー元: ${args.sourcePath}`,
            `コピー先: ${args.destPath}`,
            args.overwrite ? "上書きあり" : "上書きなし"
          ]
        };
      case "file.move":
        return {
          tool: action.tool,
          label: "ファイル移動",
          icon: "📦",
          details: [
            `移動元: ${args.sourcePath}`,
            `移動先: ${args.destPath}`
          ]
        };
      case "file.delete":
        return {
          tool: action.tool,
          label: "ファイル削除",
          icon: "🗑️",
          details: [
            `対象: ${args.path}`,
            args.toRecycleBin !== false ? "ゴミ箱へ移動" : "完全削除"
          ]
        };
      case "text.replace":
        return {
          tool: action.tool,
          label: "テキスト置換",
          icon: "🔄",
          details: [
            `対象: ${args.path}`,
            `パターン: ${args.pattern}`,
            `置換: ${args.replacement}`,
            args.createBackup !== false ? "バックアップ作成" : "バックアップなし"
          ]
        };
      default:
        return {
          tool: action.tool,
          label: action.tool,
          icon: "📄",
          details: [JSON.stringify(args)]
        };
    }
  }
</script>

{#each actions as action}
  {@const summary = summarize(action)}
  <div class="file-op-card">
    <div class="file-op-header">
      <span class="file-op-icon">{summary.icon}</span>
      <span class="file-op-label">{summary.label}</span>
      <span class="file-op-tool">{summary.tool}</span>
    </div>
    <ul class="file-op-details">
      {#each summary.details as detail}
        <li>{detail}</li>
      {/each}
    </ul>
  </div>
{/each}

<style>
  .file-op-card {
    border: 1px solid var(--ra-border);
    border-radius: 8px;
    padding: 0.75rem;
    margin-bottom: 0.5rem;
    background: var(--ra-surface);
  }
  .file-op-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }
  .file-op-label { font-weight: 600; }
  .file-op-tool {
    font-size: 0.75rem;
    color: var(--ra-text-muted);
    font-family: monospace;
  }
  .file-op-details {
    margin: 0;
    padding-left: 1.5rem;
    font-size: 0.85rem;
    color: var(--ra-text-secondary);
  }
</style>
```

### `+page.svelte` の承認ゲート部分に統合

既存の `SheetDiffCard` が表示される承認 UI に、ファイル操作のプレビューも表示:

```svelte
<!-- 承認ゲート内、SheetDiffCard の後に追加 -->
{@const fileWriteActions = pendingActions.filter(a =>
  ["file.copy", "file.move", "file.delete", "text.replace"].includes(a.tool)
)}
{#if fileWriteActions.length > 0}
  <FileOpPreview actions={fileWriteActions} />
{/if}
```

---

## Task 149: E2E 検証

### `docs/FILE_OPS_E2E_VERIFICATION.md` を作成

以下のテストケースを記載:
1. `file.copy` — CSV ファイルのコピー → コピー先にファイルが存在することを確認
2. `file.move` — ファイルのリネーム → 元のファイルが消え、新しい名前で存在
3. `file.delete` — ゴミ箱への移動 → ファイルが削除されゴミ箱に存在
4. `text.search` — 正規表現パターンでマッチ行とコンテキスト行が返ること
5. `text.replace` — 置換実行後の内容確認 + .bak ファイルの存在確認
6. `document.read_text` — .docx ファイルからテキスト抽出されること

---

## 実装順序

1. **Task 147** — Contracts にスキーマ追加
2. **Task 144** — Rust file.copy / file.move / file.delete
3. **Task 145** — Rust text.search / text.replace
4. **Task 146** — Rust document.read_text
5. **Task 148** — FileOpPreview コンポーネント + 承認 UI 統合
6. **Task 149** — E2E 検証ドキュメント

## 検証チェックリスト

- [ ] `pnpm -C packages/contracts build` がパスすること
- [ ] `cargo build` がエラーなくパスすること（`trash`, `regex`, `zip`, `quick-xml`, `lopdf` を含む）
- [ ] `file.list` / `file.stat` / `file.read_text` が `executeReadActions` で自動実行されること
- [ ] `file.copy` / `file.move` / `file.delete` / `text.replace` が承認ゲート経由で実行されること
- [ ] `text.search` が read ツールとして自動実行されること
- [ ] `document.read_text` が .docx / .pptx / .pdf を処理できること
- [ ] FileOpPreview が承認 UI に表示されること
- [ ] 既存のスプレッドシート操作フローに影響がないこと
