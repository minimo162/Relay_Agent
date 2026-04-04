# Codex プロンプト — Windows E2E テスト

## 目的

Phase 7〜10 で実装した全機能（ファイル操作・プロジェクト管理・ツールレジストリ・
アーティファクト出力）について、Windows 環境で動作検証するためのテストを作成する。

テストは 2 層に分ける:

1. **自動テスト** — M365 Copilot 不要。`cargo test` と `pnpm test` で Windows 上で実行可能
2. **手動チェックリスト** — 実際の Edge + M365 Copilot セッションが必要なシナリオ

---

## 作成物一覧

| ファイル | 種別 | 内容 |
|----------|------|------|
| `apps/desktop/src-tauri/src/integration_tests.rs` | Rust | バックエンド統合テスト |
| `apps/desktop/scripts/e2e_windows_smoke.mjs` | Node.js | Windows 起動スモークテスト |
| `docs/E2E_WINDOWS_MANUAL_CHECKLIST.md` | Markdown | 手動チェックリスト |

---

## Task 1: Rust バックエンド統合テスト

### `apps/desktop/src-tauri/src/integration_tests.rs` を新規作成

以下のテストを含むこと。`#[cfg(test)]` モジュールとして実装し、
`apps/desktop/src-tauri/src/lib.rs` に `mod integration_tests;` を追加する。

#### 1-A: ファイル操作（Phase 7）

```rust
// テスト用の一時ディレクトリを作成し、以下を検証:

// file_copy_creates_destination
// - 元ファイルを作成 → execute_file_copy → コピー先が存在すること
// - 元ファイルが残っていること

// file_move_removes_source
// - 元ファイルを作成 → execute_file_move → 移動先が存在すること
// - 元ファイルが消えていること

// file_delete_moves_to_recycle_equivalent
// - ファイルを作成 → execute_file_delete(recycle=false) → ファイルが消えていること
// ※ recycle=true の実際のゴミ箱移動は手動チェックで検証

// text_search_returns_matches
// - 既知の内容を持つ .txt を作成 → execute_text_search(regex) →
//   マッチ行と行番号が返ること

// text_replace_creates_backup
// - .txt を作成 → execute_text_replace(backup=true) →
//   内容が変わっていること + .bak ファイルが存在すること

// document_read_text_extracts_docx
// - `examples/` のフィクスチャが存在しない可能性があるため、
//   テスト内で最小限の ZIP 構造の疑似 docx を生成して使用してもよい
//   （あるいは #[ignore] でスキップし手動チェックに委ねる）
```

#### 1-B: 品質バリデーター（Phase 10）

```rust
// quality_check_passes_for_clean_csv
// - ヘッダー + 10行の正常 CSV を 2 ファイル作成（同一内容）→
//   validate_output_quality → passed == true

// quality_check_fails_for_empty_output
// - source に 5 行の CSV, output に空ファイル →
//   passed == false, warnings に「空」が含まれること

// quality_check_detects_csv_injection
// - output に =SUM(A1) や +cmd を含む行 → passed == false

// quality_check_warns_on_large_file
// - MAX_QUALITY_CHECK_BYTES(10MB) を超えるファイルを生成 →
//   warnings に "先頭 10MB" が含まれること

// quality_check_handles_quoted_commas
// - "value,with,comma",normal の CSV → 空値率・インジェクションが誤検知しないこと

// split_csv_line_tests は既存のものを維持
```

#### 1-C: ToolRegistry（Phase 9）

```rust
// tool_registry_lists_all_builtin_tools
// - ToolRegistry::new() で 21 件以上のツールが登録されていること

// tool_registry_disabled_tool_returns_error
// - registry.set_enabled("workbook.inspect", false) →
//   registry.invoke("workbook.inspect", ...) が Err("disabled") を返すこと

// tool_registry_mcp_tool_returns_delegation_error
// - register_mcp_tools() でダミーの MCP ツールを登録 →
//   registry.invoke("mcp.test.foo", ...) が
//   "must be invoked via invoke_mcp_tool" を含む Err を返すこと

// parse_mcp_tool_name_rejects_invalid_format
// - "invalid" → Err
// - "mcp.server" (セグメント 2 つ) → Err
// - "mcp.server.tool" → Ok("tool")
```

#### 1-D: プロジェクト・スコープ（Phase 8）

```rust
// project_crud_roundtrip
// - AppStorage に create_project → read_project → update_project → 値が一致すること

// project_scope_rejects_out_of_scope_path
// - rootFolder = "C:\\projects\\myproj" のプロジェクトで
//   is_within_project_scope("C:\\other\\file.csv") == false

// project_scope_accepts_in_scope_path
// - 同 rootFolder で "C:\\projects\\myproj\\data.csv" == true

// project_memory_add_remove
// - add_project_memory → memory に含まれること
// - remove_project_memory → memory から除かれること
```

---

## Task 2: Windows 起動スモークテスト

### `apps/desktop/scripts/e2e_windows_smoke.mjs` を新規作成

既存の `launch_tauri_smoke.mjs` を参考に、Windows 向けの起動スモークテストを作成する。

**差分要件:**

- `Xvfb` を使用しない（Windows はディスプレイが直接利用可能）
- `DISPLAY` 環境変数を設定しない
- `tauri:dev` の代わりにビルド済みバイナリ
  `target/release/relay-agent.exe` を起動する選択肢を持つ
  （環境変数 `RELAY_USE_BUILD=1` で切り替え可能にする）
- 起動後に以下を確認:
  1. プロセスが 10 秒以内に起動すること
  2. フロントエンド WebView が応答すること（`/api/ping` または Tauri `ping` コマンド）
  3. 起動後 5 秒以内に異常終了しないこと
- 終了コード 0 = 成功、1 = 失敗
- 結果を JSON で stdout に出力（既存スモークと同形式）:

```json
{
  "scenario": "windows-smoke",
  "status": "passed" | "failed",
  "frontendReady": true,
  "reason": ""
}
```

**package.json への追加（`apps/desktop/package.json`）:**

```json
"e2e:windows": "node ./scripts/e2e_windows_smoke.mjs"
```

---

## Task 3: 手動チェックリスト

### `docs/E2E_WINDOWS_MANUAL_CHECKLIST.md` を新規作成

以下の構成で作成すること。

---

```markdown
# Windows E2E 手動チェックリスト

## 実行環境
- Windows 10/11 x64
- Microsoft Edge（M365 Copilot にログイン済み）
- Relay Agent デスクトップアプリ起動済み
- テスト用ワークスペース: `C:\relay-test\` を作成し以下を配置:
  - `revenue-workflow-demo.csv`（examples/ からコピー）
  - `notes.txt`（任意のテキスト）
  - `sample.docx` / `sample.pptx` / `sample.pdf`（任意）

---

## Phase 7: ファイル操作

### 7-1 file.copy
- [ ] 「revenue-workflow-demo.csv を output.csv としてコピーして」と指示
- [ ] FileOpPreview に コピー元/先パスが表示される
- [ ] 承認後、output.csv が作成されていること
- [ ] 元ファイルが残っていること

### 7-2 file.move
- [ ] 「output.csv を backup.csv にリネームして」と指示
- [ ] 承認後、backup.csv が存在し output.csv が消えていること

### 7-3 file.delete
- [ ] 「backup.csv を削除して」と指示
- [ ] 承認 UI に「ゴミ箱に移動」が表示されること
- [ ] 承認後、backup.csv がゴミ箱に移動していること（完全削除でないこと）

### 7-4 text.search
- [ ] 「notes.txt から "TODO" を検索して」と指示
- [ ] 承認なしで自動実行され、マッチ行が ActivityFeed に表示されること

### 7-5 text.replace
- [ ] 「notes.txt の "TODO" を "DONE" に置換して」と指示
- [ ] 承認 UI に 変換前/後とバックアップパスが表示されること
- [ ] 承認後、notes.txt が変更され notes.txt.bak が作成されていること

### 7-6 document.read_text
- [ ] 「sample.docx のテキストを読んで」と指示
- [ ] 承認なしで自動実行され、抽出テキストが ActivityFeed に表示されること
- [ ] .pptx、.pdf でも同様に動作すること

---

## Phase 8: プロジェクト管理

### 8-1 プロジェクト作成・選択
- [ ] プロジェクトセレクターから「新規プロジェクト」を作成
- [ ] ルートフォルダに `C:\relay-test\` を指定
- [ ] セッションをプロジェクトに紐付ける

### 8-2 カスタム指示
- [ ] プロジェクトにカスタム指示（例: 「出力は必ず UTF-8 で保存」）を追加
- [ ] Copilot への依頼時、プロンプトにカスタム指示が含まれること（開発者ツールで確認）

### 8-3 スコープ外アクセス警告
- [ ] `C:\relay-test\` 外のファイルへの操作を指示
- [ ] スコープ承認ダイアログが表示されること
- [ ] 「戻る」でキャンセルできること
- [ ] 「許可」で続行できること

### 8-4 自動学習
- [ ] 変換実行後、プロジェクトメモリに学習結果が追加されていること

---

## Phase 9: ツールレジストリ

### 9-1 ツール一覧
- [ ] 設定画面 → ツールタブを開く
- [ ] ビルトインツール 21 件以上が一覧表示されること

### 9-2 ツール無効化
- [ ] `workbook.inspect` を無効化
- [ ] ワークブック操作を指示する → 「disabled」エラーが返ること
- [ ] 再度有効化すると正常動作すること

### 9-3 MCP サーバー接続（任意）
- [ ] ローカルで MCP サーバーを起動（例: `npx @modelcontextprotocol/server-filesystem`）
- [ ] 設定画面でサーバー URL を入力して「接続」
- [ ] MCP ツールが一覧に追加されること
- [ ] MCP ツールの実行時に承認ゲートが表示されること

---

## Phase 10: アーティファクト出力

### 10-1 CSV 変換のアーティファクトプレビュー
- [ ] revenue-workflow-demo.csv に対して列フィルタ + 保存を指示
- [ ] 承認 UI に ArtifactPreview（csv_table タイプ）が表示されること
- [ ] 承認後に品質チェック結果が ActivityFeed に表示されること（✅ または ⚠️）

### 10-2 品質チェック - 空ファイル警告
- [ ] 出力が空になるような条件（全行 filter 等）でタスクを実行
- [ ] 品質チェックで「出力ファイルが空」警告が ActivityFeed に表示されること

### 10-3 品質チェック - CSV インジェクション検出
- [ ] `=SUM(A1)` などを含むセルを持つ CSV を変換
- [ ] 品質チェックで CSV インジェクション警告が表示されること

### 10-4 テキスト差分プレビュー
- [ ] text.replace 実行後の承認 UI で
      ArtifactPreview（text_diff タイプ）が表示されること
- [ ] 変更前/変更後が並んで表示されること

### 10-5 ターン詳細のアーティファクト表示
- [ ] 実行完了後、ActivityFeed の詳細インスペクターを開く
- [ ] 「出力アーティファクト」セクションに ArtifactPreview が表示されること

---

## 回帰テスト（既存機能）

### R-1 スプレッドシート変換（基本フロー）
- [ ] revenue-workflow-demo.csv を添付
- [ ] 「approved が true の行だけ残して別名保存して」と指示
- [ ] SheetDiff プレビューが表示されること（ArtifactPreview 経由で）
- [ ] 承認後に output CSV が正しく生成されること

### R-2 エンコーディング（Shift_JIS）
- [ ] Shift_JIS エンコードの CSV を使って変換
- [ ] 文字化けせずに処理されること

### R-3 ドラフト再開
- [ ] 変換指示を送信し、承認前にアプリを再起動
- [ ] 再起動後に承認ダイアログが復元されること

---

## 確認方法の補足

- ActivityFeed のターン詳細は「🔍」ボタンから開く
- 承認 UI は InterventionPanel（画面右側）に表示される
- ツール設定は設定アイコン → 「ツール」タブ
- プロジェクト管理は画面上部のプロジェクトセレクター
```

---

## 実装順序

1. `integration_tests.rs` — 既存の `#[cfg(test)]` と同じファイルに追記、または新規モジュール
2. `e2e_windows_smoke.mjs` — `tauri_smoke_shared.mjs` の関数を再利用
3. `E2E_WINDOWS_MANUAL_CHECKLIST.md` — 上記の内容をそのまま Markdown に整形

## 検証チェックリスト（Codex 自身による確認）

- [ ] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` が全テストパスすること
- [ ] `pnpm -C apps/desktop exec node scripts/e2e_windows_smoke.mjs` が Linux でもエラーなく実行開始すること
  （Windows 固有機能がない場合は適切なスキップメッセージを出力して終了コード 0）
- [ ] `pnpm -C packages/contracts build` がパスすること
- [ ] 既存の `startup:test` / `workflow:test` がリグレッションしないこと
