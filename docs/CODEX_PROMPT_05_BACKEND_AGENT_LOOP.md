# Codex プロンプト 05 — バックエンド エージェントループ（Tasks 86・90・91・94）

## 対象タスク

- **Task 86**: Rust — 読み取りツール自動実行ループ（IPC コマンド新設）
- **Task 90**: Rust — write ツール承認ゲートとの接続
- **Task 91**: Rust — ループ安全ガード（最大ターン数・タイムアウト・重複検出）
- **Task 94**: Rust — `file.list` / `file.read_text` / `file.stat` ツール実装

## 前提条件

- Task 85 の Contracts 変更（`status` フィールド）が完了していること
- `pnpm --filter @relay-agent/contracts typecheck` が通っていること

---

## コンテキスト

### Rust バックエンド構成

```
apps/desktop/src-tauri/src/
  app.rs           ← Tauri コマンド登録（.invoke_handler）
  execution.rs     ← preview_execution / run_execution IPC コマンド
  relay.rs         ← submit_copilot_response / generate_relay_packet IPC
  models.rs        ← Request / Response 型定義
  state.rs         ← DesktopState（Arc<Mutex<Storage>>）
  storage.rs       ← ビジネスロジック本体（6000行超）
  workbook/        ← CSV/XLSX エンジン
```

### 既存の IPC フロー（変更しない）

```
generate_relay_packet → submit_copilot_response → preview_execution → run_execution
```

エージェントループは **フロントエンド側** がループを制御し、バックエンドには
「1ターン分の read actions を実行して結果を返す」コマンドを新設する。

---

## Task 86・91: `execute_read_actions` IPC コマンド新設

### 1. `models.rs` に型を追加

```rust
// ── Agent Loop ──────────────────────────────────────────────────────────────

use serde::{Deserialize, Serialize};

/// execute_read_actions のリクエスト
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteReadActionsRequest {
    pub session_id: String,
    pub turn_id: String,
    /// Copilot から返ってきた全アクション（read + write 混在可）
    /// バックエンドは read のみ実行し、write は無視して結果を返す
    pub actions: Vec<serde_json::Value>,
    /// 安全ガード: 現在のループターン番号（1始まり）
    pub loop_turn: u32,
    /// 安全ガード: 最大ループターン数
    pub max_turns: u32,
}

/// execute_read_actions のレスポンス
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteReadActionsResponse {
    /// 実行した read ツールごとの結果
    pub results: Vec<ToolExecutionResult>,
    /// write ツールが含まれていたか
    pub has_write_actions: bool,
    /// ループ継続可否
    pub should_continue: bool,
    /// 安全ガード違反メッセージ（あれば）
    pub guard_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecutionResult {
    pub tool: String,
    pub success: bool,
    /// JSON シリアライズされた結果（各ツール固有の構造）
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}
```

### 2. `execution.rs` に IPC コマンドを追加

```rust
use crate::models::{
    ExecuteReadActionsRequest, ExecuteReadActionsResponse,
    // ... 既存のインポート
};

/// 読み取りツールを自動実行し、結果を返す（エージェントループ用）
#[tauri::command]
pub fn execute_read_actions(
    state: State<'_, DesktopState>,
    request: ExecuteReadActionsRequest,
) -> Result<ExecuteReadActionsResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.execute_read_actions(request)
}
```

### 3. `app.rs` の `.invoke_handler` に登録

既存のコマンド列に追加:

```rust
tauri::generate_handler![
    // ... 既存のコマンド
    crate::execution::execute_read_actions,
]
```

### 4. `storage.rs` に `execute_read_actions` メソッドを実装

```rust
pub fn execute_read_actions(
    &mut self,
    request: ExecuteReadActionsRequest,
) -> Result<ExecuteReadActionsResponse, String> {
    // ── 安全ガード ────────────────────────────────────────────────────────

    if request.loop_turn > request.max_turns {
        return Ok(ExecuteReadActionsResponse {
            results: vec![],
            has_write_actions: false,
            should_continue: false,
            guard_message: Some(format!(
                "最大ターン数（{}）に達しました。処理を中断します。",
                request.max_turns
            )),
        });
    }

    // ── アクション分類 ────────────────────────────────────────────────────

    let read_tool_names = [
        "workbook.inspect",
        "sheet.preview",
        "sheet.profile_columns",
        "session.diff_from_base",
        "file.list",
        "file.read_text",
        "file.stat",
    ];

    let mut results = Vec::new();
    let mut has_write_actions = false;

    for action in &request.actions {
        let tool = action
            .get("tool")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if !read_tool_names.contains(&tool.as_str()) {
            // write ツールはスキップ（承認ゲートはフロントエンドが管理）
            has_write_actions = true;
            continue;
        }

        let result = self.execute_single_read_tool(&tool, action, &request.session_id, &request.turn_id);
        results.push(result);
    }

    let should_continue = !has_write_actions && !results.is_empty();

    Ok(ExecuteReadActionsResponse {
        results,
        has_write_actions,
        should_continue,
        guard_message: None,
    })
}

fn execute_single_read_tool(
    &mut self,
    tool: &str,
    action: &serde_json::Value,
    session_id: &str,
    turn_id: &str,
) -> ToolExecutionResult {
    let args = action.get("args").cloned().unwrap_or(serde_json::Value::Object(Default::default()));

    match tool {
        "workbook.inspect" => {
            // 既存の inspect_workbook ロジックを再利用
            // args.sourcePath または セッションの現在ファイルパスを使用
            self.execute_workbook_inspect(&args, session_id, turn_id)
        }
        "sheet.preview" => {
            self.execute_sheet_preview(&args, session_id, turn_id)
        }
        "sheet.profile_columns" => {
            self.execute_sheet_profile_columns(&args, session_id, turn_id)
        }
        "session.diff_from_base" => {
            self.execute_session_diff_from_base(&args, session_id, turn_id)
        }
        "file.list" => {
            self.execute_file_list(&args)
        }
        "file.read_text" => {
            self.execute_file_read_text(&args)
        }
        "file.stat" => {
            self.execute_file_stat(&args)
        }
        _ => ToolExecutionResult {
            tool: tool.to_string(),
            success: false,
            result: None,
            error: Some(format!("未知のreadツール: {tool}")),
        },
    }
}
```

**注意**: `execute_workbook_inspect` / `execute_sheet_preview` / `execute_sheet_profile_columns` / `execute_session_diff_from_base` は、
既存の `read_turn_artifacts` や `generate_relay_packet` で使われているロジックを切り出してプライベートメソッド化する。
既存コードを壊さないよう、元のメソッドは変更せずに新しいプライベートメソッドを追加すること。

---

## Task 94: ファイル操作ツール（read only）

### `storage.rs` に追加するメソッド

```rust
fn execute_file_list(&self, args: &serde_json::Value) -> ToolExecutionResult {
    let path_str = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return ToolExecutionResult {
            tool: "file.list".to_string(),
            success: false,
            result: None,
            error: Some("`args.path` が必要です".to_string()),
        },
    };

    // セキュリティ: パストラバーサル対策
    let path = std::path::Path::new(path_str);
    if !path.is_absolute() {
        return ToolExecutionResult {
            tool: "file.list".to_string(),
            success: false,
            result: None,
            error: Some("絶対パスを指定してください".to_string()),
        };
    }

    let pattern = args.get("pattern").and_then(|v| v.as_str()).unwrap_or("*");
    let recursive = args.get("recursive").and_then(|v| v.as_bool()).unwrap_or(false);

    match std::fs::read_dir(path) {
        Ok(entries) => {
            let mut files = Vec::new();
            for entry in entries.flatten() {
                let meta = entry.metadata().ok();
                let name = entry.file_name().to_string_lossy().to_string();

                // 簡易 glob: パターンが "*" でなければ前方一致チェック
                if pattern != "*" {
                    let pat = pattern.trim_start_matches('*').trim_end_matches('*');
                    if !name.contains(pat) {
                        continue;
                    }
                }

                files.push(serde_json::json!({
                    "name": name,
                    "path": entry.path().to_string_lossy(),
                    "isDir": meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
                    "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
                    "modifiedAt": meta.and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                }));
            }

            ToolExecutionResult {
                tool: "file.list".to_string(),
                success: true,
                result: Some(serde_json::json!({ "path": path_str, "entries": files })),
                error: None,
            }
        }
        Err(e) => ToolExecutionResult {
            tool: "file.list".to_string(),
            success: false,
            result: None,
            error: Some(e.to_string()),
        },
    }
}

fn execute_file_read_text(&self, args: &serde_json::Value) -> ToolExecutionResult {
    let path_str = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return ToolExecutionResult {
            tool: "file.read_text".to_string(),
            success: false,
            result: None,
            error: Some("`args.path` が必要です".to_string()),
        },
    };

    let max_bytes = args.get("maxBytes")
        .and_then(|v| v.as_u64())
        .unwrap_or(65_536) as usize;

    let max_bytes = max_bytes.min(1_048_576); // 絶対上限 1MB

    let path = std::path::Path::new(path_str);
    if !path.is_absolute() {
        return ToolExecutionResult {
            tool: "file.read_text".to_string(),
            success: false,
            result: None,
            error: Some("絶対パスを指定してください".to_string()),
        };
    }

    match std::fs::read(path) {
        Ok(bytes) => {
            let truncated = bytes.len() > max_bytes;
            let content_bytes = &bytes[..bytes.len().min(max_bytes)];
            let content = String::from_utf8_lossy(content_bytes).to_string();

            ToolExecutionResult {
                tool: "file.read_text".to_string(),
                success: true,
                result: Some(serde_json::json!({
                    "path": path_str,
                    "content": content,
                    "byteSize": bytes.len(),
                    "truncated": truncated
                })),
                error: None,
            }
        }
        Err(e) => ToolExecutionResult {
            tool: "file.read_text".to_string(),
            success: false,
            result: None,
            error: Some(e.to_string()),
        },
    }
}

fn execute_file_stat(&self, args: &serde_json::Value) -> ToolExecutionResult {
    let path_str = match args.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return ToolExecutionResult {
            tool: "file.stat".to_string(),
            success: false,
            result: None,
            error: Some("`args.path` が必要です".to_string()),
        },
    };

    let path = std::path::Path::new(path_str);

    match std::fs::metadata(path) {
        Ok(meta) => {
            ToolExecutionResult {
                tool: "file.stat".to_string(),
                success: true,
                result: Some(serde_json::json!({
                    "path": path_str,
                    "exists": true,
                    "isFile": meta.is_file(),
                    "isDir": meta.is_dir(),
                    "size": meta.len(),
                    "modifiedAt": meta.modified().ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                })),
                error: None,
            }
        }
        Err(_) => {
            // ファイルが存在しない場合もエラーではなく exists: false で返す
            ToolExecutionResult {
                tool: "file.stat".to_string(),
                success: true,
                result: Some(serde_json::json!({
                    "path": path_str,
                    "exists": false
                })),
                error: None,
            }
        }
    }
}
```

---

## Task 90: フロントエンドへの write actions 引き渡し

バックエンドの `ExecuteReadActionsResponse` に `has_write_actions: true` が返ってきた場合、
フロントエンドが write actions を既存の `submit_copilot_response` → `preview_execution` フローに
渡す。バックエンド側の追加変更は不要。

---

## 検証コマンド

```bash
# ビルド
cd apps/desktop/src-tauri && cargo build 2>&1 | tail -20

# テスト（既存テストが壊れていないこと）
cd apps/desktop/src-tauri && cargo test 2>&1 | tail -30

# 全体
pnpm --filter @relay-agent/desktop tauri:build 2>&1 | tail -20
```

### 確認事項

1. `execute_read_actions` IPC が `app.rs` に登録されている
2. read tools（workbook.inspect等）が自動実行され結果が返る
3. write tools（table.filter_rows等）が結果に含まれず `has_write_actions: true` が返る
4. `loop_turn > max_turns` で `should_continue: false` と guard_message が返る
5. `file.list` で存在するディレクトリの一覧が返る
6. `file.read_text` で 1MB 超がエラーになる
7. `../` を含むパスがエラーになる（パストラバーサル対策）
8. 既存の `cargo test` が全て通る
