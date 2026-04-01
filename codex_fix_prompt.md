# Relay Agent — Codex 修正依頼プロンプト

作成日: 2026-04-02

---

## 背景

Codex が実装した Cowork フェーズ（Tasks 164–183）のコードレビューで2件のバグが見つかった。
以下の修正を実施し、完了後に `.taskmaster/tasks/tasks.json` のステータスを確認せよ。
**修正はこの2件のみ。他のコードには触れないこと。**

---

## 修正 1: `template_from_session` の `expected_tools` が常に空

### ファイル
`apps/desktop/src-tauri/src/template.rs`

### 問題
`template_from_session` 関数（line ~145）でセッションから WorkflowTemplate を生成する際、
`expected_tools` が `Vec::new()` のまま返されている。
そのため、セッションから保存したテンプレートに使用ツール情報が記録されない。

```rust
// 現状（バグ）
let tools = Vec::new();
```

### 修正方針

セッションの `turn_ids` を走査して各ターンのアーティファクトを読み取り、
実行された SpreadsheetAction の `tool` フィールドを収集して重複排除する。

### 実装手順

**Step 1:** `template.rs` の `template_from_session` 関数を以下の方針で修正する。

```rust
#[tauri::command]
pub fn template_from_session(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
    request: TemplateFromSessionRequest,
) -> Result<WorkflowTemplate, String> {
    let (session, tools) = {
        let storage = state.storage.lock().expect("desktop storage poisoned");
        let session = storage.read_session(&request.session_id)?;

        // セッションの各ターンからツール名を収集する
        let mut seen = std::collections::HashSet::new();
        let mut tools: Vec<String> = Vec::new();
        for turn_id in &session.session.turn_ids {
            if let Ok(resp) = storage.read_turn_artifacts(&request.session_id, turn_id) {
                for artifact in &resp.artifacts {
                    // ArtifactRecord の tool フィールドを取り出す
                    // artifact は serde_json::Value か専用の型で格納されている
                    // "tool" キーを持つ artifact から名前を抽出する
                    if let Some(tool_name) = extract_tool_name_from_artifact(artifact) {
                        if seen.insert(tool_name.clone()) {
                            tools.push(tool_name);
                        }
                    }
                }
            }
        }

        (session.session, tools)
    };
    // ... 以降は既存のまま
}
```

**Step 2:** `extract_tool_name_from_artifact` ヘルパー関数を同ファイルに追加する。

アーティファクトの型（`storage.read_turn_artifacts` が返す `ReadTurnArtifactsResponse`
の `artifacts` フィールドの要素型）を確認して、`tool` フィールドを取り出す。

- `artifacts` の要素型が `serde_json::Value` の場合: `artifact["tool"].as_str()` で取得
- `artifacts` の要素型が具体的な struct の場合: そのフィールドを直接参照

型を確認するには `src-tauri/src/storage.rs` の `ReadTurnArtifactsResponse` 定義と
`src-tauri/src/models.rs` の関連 struct を参照すること。

**Step 3:** ツール名が1件も取得できない場合は `Vec::new()` のまま返す（フォールバック）。
エラーで `template_from_session` 全体を失敗させてはいけない。

**検証:**
```bash
cargo check
```
エラーなしであること。

---

## 修正 2: `BatchDashboard.svelte` のステータスが英語のまま表示される

### ファイル
`apps/desktop/src/lib/components/BatchDashboard.svelte`

### 問題
ターゲット一覧の `<p>{target.status}</p>` が生の英語ステータス文字列（`"running"`, `"done"` 等）を
そのまま表示している。`PipelineProgress.svelte` は `statusLabels` マップで日本語化しているのに
`BatchDashboard.svelte` はそれがない。

### 修正

`<script>` ブロックに以下を追加する:

```typescript
const statusLabels: Record<string, string> = {
  pending: "待機中",
  running: "実行中",
  waiting_approval: "承認待ち",
  done: "完了",
  failed: "失敗",
  skipped: "スキップ"
};
```

テンプレートの該当箇所を変更する:

```svelte
<!-- 変更前 -->
<p>{target.status}</p>

<!-- 変更後 -->
<p>{statusLabels[target.status] ?? target.status}</p>
```

**検証:**
```bash
pnpm --filter @relay-agent/desktop typecheck
```
エラーなしであること。

---

## 完了後の作業

両修正を完了したら以下を実行して確認すること:

```bash
cargo check
pnpm --filter @relay-agent/desktop typecheck
```

両方ともエラーなしであれば修正完了。
追加の変更は一切行わないこと。
