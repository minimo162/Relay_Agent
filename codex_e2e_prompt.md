# Relay Agent — Cowork フェーズ E2E テスト依頼

作成日: 2026-04-02
対象フェーズ: Cowork（Tasks 164–183）

---

## 概要

Cowork フェーズで追加した以下 4 機能について、Windows 上で動作検証できる
テストと手動チェックリストを作成する。

| 機能 | Tasks |
|---|---|
| ワークフローパイプライン | 164–169 |
| バッチ処理 | 170–174 |
| テンプレートライブラリ | 175–179 |
| スマート承認ゲート | 180–183 |

---

## 作成物

| ファイル | 種別 |
|---|---|
| `apps/desktop/src-tauri/src/batch.rs` に `#[cfg(test)]` を追記 | Rust 単体テスト |
| `apps/desktop/src-tauri/src/pipeline.rs` に `#[cfg(test)]` を追記 | Rust 単体テスト |
| `apps/desktop/src-tauri/src/template.rs` に `#[cfg(test)]` を追記 | Rust 単体テスト |
| `docs/E2E_COWORK_MANUAL_CHECKLIST.md` を新規作成 | 手動チェックリスト |

**修正しないこと**: 既存の本体コード・他のファイル・`Cargo.toml`。
テストコードを各 `.rs` ファイルの末尾に `#[cfg(test)] mod tests { … }` として追記する。

---

## Task 1: `batch.rs` — 単体テスト追記

### 追記場所

`apps/desktop/src-tauri/src/batch.rs` の末尾に以下を追加する。

### テスト内容

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // --- BatchRegistry 基本操作 ---

    #[test]
    fn batch_registry_insert_and_retrieve() {
        // BatchRegistry::default() でレジストリを作成
        // BatchJob を手動構築して jobs に挿入
        // get() で同じ id のジョブが取得できること
    }

    #[test]
    fn batch_target_status_transitions_are_correct() {
        // BatchTargetStatus の全バリアント (Pending/Running/Done/Failed/Skipped) が
        // serde_json でシリアライズ後に元の値に戻ること（snake_case）
        // 期待値: "pending", "running", "done", "failed", "skipped"
    }

    #[test]
    fn batch_job_status_serializes_as_lowercase() {
        // BatchJobStatus::Running を serde_json::to_string すると "running" になること
        // BatchJobStatus::PartialFailure は存在しないので Done / Failed / Idle のみ確認
    }

    #[test]
    fn batch_registry_skip_target_changes_status_to_skipped() {
        // jobs に Pending のターゲットを 2 件持つ BatchJob を挿入
        // skip_target(job_id, target_path) を呼ぶ
        // 対象ターゲットが Skipped になり、他は Pending のままであること
        //
        // 実装方法:
        //   registry.jobs.get_mut(job_id).unwrap().targets[0].status = BatchTargetStatus::Skipped;
        //   のように BatchRegistry を直接操作して skip ロジックを単独検証する
    }

    #[test]
    fn derive_batch_output_path_produces_expected_filename() {
        // derive_batch_output_path の出力パス命名規則を検証する
        // input: "/some/dir/data.csv", batch_id: "batch-001"
        // output のファイル名が "{stem}-batch-001.csv" 形式であること
        //
        // この関数が AppHandle を取る場合は pub(crate) のヘルパーを切り出して
        // AppHandle 不要な部分だけを別 fn にして呼ぶこと
        // テストできない場合は #[ignore] を付けてスキップし、手動検証に委ねること
    }
}
```

### 実装ヒント

- `BatchRegistry` は `HashMap<String, BatchJob>` を持つ単純な構造体なので
  `AppHandle` なしで直接操作できる
- `serde_json::to_string` / `serde_json::from_str` でシリアライズを検証する
- `derive_batch_output_path` が `AppHandle` 依存で分離できない場合は
  ファイル名生成ロジックを `pub(crate) fn build_output_filename(stem: &str, batch_id: &str, ext: &str) -> String`
  として切り出し、その関数をテストする

---

## Task 2: `pipeline.rs` — 単体テスト追記

### 追記場所

`apps/desktop/src-tauri/src/pipeline.rs` の末尾に以下を追加する。

### テスト内容

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // --- PipelineRegistry 基本操作 ---

    #[test]
    fn pipeline_registry_insert_and_retrieve() {
        // PipelineRegistry::default() でレジストリを作成
        // Pipeline を手動構築して pipelines に挿入
        // pipelines.get(id) で同じパイプラインが取得できること
    }

    #[test]
    fn pipeline_step_status_serializes_as_snake_case() {
        // PipelineStepStatus::WaitingApproval を serde_json::to_string すると
        // "waiting_approval" になること
        // 全バリアント確認: pending/running/waiting_approval/done/failed
    }

    #[test]
    fn pipeline_input_source_serializes_correctly() {
        // PipelineInputSource::User → "user"
        // PipelineInputSource::PrevStepOutput → "prev_step_output"
    }

    #[test]
    fn pipeline_cancelled_flag_prevents_execution() {
        // PipelineRegistry の cancelled HashMap に pipeline_id: true を挿入
        // registry.cancelled.get(id).copied().unwrap_or(false) == true であること
        // cancel → is_cancelled の確認（内部ロジックの単独検証）
    }

    #[test]
    fn pipeline_steps_ordered_by_order_field() {
        // order: 2, 0, 1 の順で steps を構築
        // steps.sort_by_key(|s| s.order) 後に order が 0,1,2 になること
        // （実行エンジンが steps を order でソートすることを前提とした検証）
    }

    #[test]
    fn prev_step_output_resolves_from_prior_step() {
        // ステップ1の output_artifact_key = Some("output/step1.csv")
        // ステップ2の input_source = PrevStepOutput の場合
        // 「前ステップの output_artifact_key を次ステップの input_file_path として使う」
        // ロジックを純粋関数として切り出してテストする
        //
        // 切り出せない場合は #[ignore] でスキップ
    }
}
```

---

## Task 3: `template.rs` — 単体テスト追記

### 追記場所

`apps/desktop/src-tauri/src/template.rs` の末尾に以下を追加する。

### テスト内容

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // --- WorkflowTemplate データ構造 ---

    #[test]
    fn workflow_template_serializes_is_built_in_as_camel_case() {
        // WorkflowTemplate { is_built_in: true, ... } を serde_json::to_value すると
        // キーが "isBuiltIn" になること（#[serde(rename_all = "camelCase")] の確認）
    }

    #[test]
    fn workflow_template_category_roundtrip() {
        // WorkflowTemplateCategory::Sales を JSON にして戻すと Sales になること
        // 全カテゴリ確認: sales / accounting / hr / general / custom
        // シリアライズ後の文字列も確認 ("sales", "accounting" 等)
    }

    #[test]
    fn filter_by_category_returns_only_matching_templates() {
        // カテゴリが異なる 3 件の WorkflowTemplate を作成
        // filter_by_category(templates, Some(WorkflowTemplateCategory::Sales)) で
        // Sales のみが返ること
        //
        // filter_by_category が pub(crate) でない場合は mod tests 内で
        // fn filter_by_category_test_helper(...) として同じロジックを書いてテストする
    }

    #[test]
    fn builtin_templates_parse_from_json_str() {
        // include_str! で読み込まれた組み込みテンプレート JSON が
        // serde_json::from_str::<WorkflowTemplate> でパースできること
        //
        // 以下の 5 ファイルを直接 include_str! してパースする:
        //   "../../assets/templates/sales_filter.json"
        //   "../../assets/templates/monthly_rollup.json"
        //   "../../assets/templates/normalize_columns.json"
        //   "../../assets/templates/remove_duplicates.json"
        //   "../../assets/templates/invoice_cleanup.json"
    }

    #[test]
    fn custom_template_persist_and_delete_roundtrip() {
        // 一時ディレクトリを std::env::temp_dir() に作成
        // persist_custom_template(path, &template) でファイルが作成されること
        // delete_custom_template(path, id) でファイルが削除されること
        //
        // persist / delete が AppHandle を取る場合は内部の
        // ファイル I/O 部分を pub(crate) fn として切り出してテストする
        // 切り出せない場合は #[ignore] でスキップし手動検証に委ねる
    }
}
```

### 実装ヒント

- `builtin_templates_parse_from_json_str` は `include_str!` のパスが
  `src/` からの相対パスになることに注意（`../../assets/...`）
- `filter_by_category` が `pub` でない場合は `pub(crate)` に昇格させてよい

---

## Task 4: 手動チェックリスト作成

### `docs/E2E_COWORK_MANUAL_CHECKLIST.md` を新規作成

以下の内容をそのまま Markdown ファイルとして作成すること。

---

```markdown
# Cowork フェーズ — Windows E2E 手動チェックリスト

作成日: 2026-04-02

## 実行環境

- Windows 10/11 x64
- Microsoft Edge（M365 Copilot にログイン済み・CDP 有効化済み）
- Relay Agent デスクトップアプリ起動済み
- テスト用ファイル:
  - `examples/revenue-workflow-demo.csv` を `C:\relay-test\` にコピー
  - 同 CSV を `data_a.csv`, `data_b.csv`, `data_c.csv` として 3 部コピー（バッチ用）

---

## 1. ワークフローパイプライン

### 1-1 パイプライン作成と実行（正常系）

- [ ] デリゲーションモードの「パイプラインモード」トグルをオンにする
- [ ] タイトルを入力し、ステップを 2 件追加する
  - ステップ 1: ゴール「approved が true の行だけ残して」/ 入力元: ユーザー指定 / ファイル: `data_a.csv`
  - ステップ 2: ゴール「amount でグループ集計して別名保存して」/ 入力元: 前ステップ出力
- [ ] 「実行開始」を押す
- [ ] PipelineProgress にステップ 1 が「実行中」で強調表示されること
- [ ] ステップ 1 完了後、ステップ 2 が自動起動されること
- [ ] ステップ 2 の入力ファイルがステップ 1 の出力であること（ActivityFeed で確認）
- [ ] 両ステップ完了後、元ファイル `data_a.csv` が未変更であること

### 1-2 ステップ失敗時の停止

- [ ] ステップ 1 のゴールに意図的に無効な指示を入力して実行
- [ ] ステップ 1 が「失敗」になり PipelineProgress にエラーメッセージが表示されること
- [ ] ステップ 2 が「待機中」のまま停止すること（自動継続しないこと）

### 1-3 パイプラインキャンセル

- [ ] パイプライン実行中に「キャンセル」ボタンを押す
- [ ] 実行中のステップが「失敗」になり残りステップが「待機中」のまま停止すること

---

## 2. バッチ処理

### 2-1 複数ファイル選択と一括実行（正常系）

- [ ] デリゲーションモードの「バッチモード」タブを選択する
- [ ] ファイル選択で `data_a.csv`, `data_b.csv`, `data_c.csv` を選択する
- [ ] ゴール「approved が true の行だけ残して別名保存して」を入力して実行
- [ ] BatchDashboard にターゲット 3 件が表示されること
- [ ] 1 件ずつ順次処理されること（同時実行されないこと）
- [ ] 全件完了後に進捗バーが 100% になること
- [ ] 各ターゲットのステータスが「完了」になること（日本語表示）
- [ ] 元ファイル 3 件が未変更であること

### 2-2 フォルダ選択モード

- [ ] 「フォルダ選択」モードで `C:\relay-test\` を選択
- [ ] フォルダ内の CSV ファイルが自動列挙されること
- [ ] 列挙されたファイル一覧が BatchTargetSelector に表示されること

### 2-3 一部失敗の継続動作

- [ ] バッチに存在しないファイルパスを追加する（またはファイルを削除してから実行）
- [ ] 該当ターゲットが「失敗」になること
- [ ] 他のターゲットは処理が継続されること（`stopOnFirstError` = false 確認）
- [ ] 完了後のサマリーに成功件数・失敗件数が表示されること

### 2-4 スキップ機能

- [ ] バッチ実行中に処理待ちのターゲットの「スキップ」ボタンを押す
- [ ] 該当ターゲットが「スキップ」になり次へ進むこと

---

## 3. テンプレートライブラリ

### 3-1 組み込みテンプレートの表示と選択

- [ ] ChatComposer の「テンプレートから選ぶ」ボタンを押す
- [ ] TemplateBrowser が開き、組み込みテンプレートが 5 件以上表示されること
- [ ] カテゴリタブ（営業 / 経理 / HR / 汎用）を切り替えるとフィルタされること
- [ ] キーワード検索で「フィルタ」と入力するとマッチするテンプレートだけ表示されること
- [ ] テンプレートカードをクリックすると詳細（ゴール・使用ツール）がプレビューされること
- [ ] 「このテンプレートを使う」でゴール入力にテキストが反映されること

### 3-2 カスタムテンプレートの保存

- [ ] 任意のタスクを 1 回実行して完了画面を表示する
- [ ] CompletionTimeline の「テンプレートとして保存」ボタンを押す
- [ ] タイトル入力・カテゴリ選択のダイアログが表示されること
- [ ] 保存後、TemplateBrowser の「カスタム」タブに表示されること
- [ ] アプリを再起動してもカスタムテンプレートが残っていること

### 3-3 カスタムテンプレートの削除

- [ ] 保存したカスタムテンプレートの削除ボタンを押す
- [ ] TemplateBrowser から消えること
- [ ] アプリ再起動後も表示されないこと

---

## 4. スマート承認ゲート

### 4-1 安全モード（safe）— 全操作手動承認

- [ ] 設定モーダル → 承認ポリシー → 「安全モード」を選択
- [ ] `workbook.inspect`（読み取り専用）を含むタスクを実行
- [ ] InterventionPanel が表示されること（自動承認されないこと）
- [ ] `table.filter_rows` + `workbook.save_copy` でも InterventionPanel が表示されること

### 4-2 標準モード（standard）— 低リスクは自動承認

- [ ] 設定モーダル → 承認ポリシー → 「標準モード」を選択
- [ ] `workbook.inspect` / `sheet.preview` を含むタスクを実行
- [ ] InterventionPanel が表示されず、ActivityFeed に「自動承認」バッジが表示されること
- [ ] `table.rename_columns`（低リスク）が自動承認されること
- [ ] `workbook.save_copy`（中リスク）では InterventionPanel が表示されること

### 4-3 高速モード（fast）— 中リスクまで自動承認

- [ ] 設定モーダル → 承認ポリシー → 「高速モード」を選択
- [ ] `workbook.save_copy`（中リスク）が自動承認されること
- [ ] ActivityFeed に「自動承認」バッジが表示されること

### 4-4 critical 操作は全ポリシーで手動承認

- [ ] 高速モードのまま `file.delete` を含むタスクを実行
- [ ] InterventionPanel が必ず表示されること（高速モードでも自動承認されないこと）

---

## 回帰テスト（既存機能）

### R-1 デリゲーションモード基本フロー

- [ ] ゴール入力 → Copilot 自動送信 → プラン承認 → 変換実行 → 保存の一連フローが動作すること

### R-2 ドラフト再開

- [ ] バッチ実行中にアプリを終了して再起動した場合、バッチ状態が復元されること
  （または未完了の通知が表示されること）

### R-3 プロジェクトとの組み合わせ

- [ ] プロジェクトを選択した状態でパイプラインを実行できること
- [ ] プロジェクトスコープ外ファイルを指定した場合に警告が表示されること

---

## 自動テスト実行コマンド（Windows PowerShell）

```powershell
# 単体テスト（AppHandle 不要なもの）
cargo test --manifest-path apps\desktop\src-tauri\Cargo.toml 2>&1

# TypeScript 型チェック
pnpm typecheck

# Windows スモーク（ビルド済みバイナリが必要）
$env:RELAY_USE_BUILD="1"; node apps\desktop\scripts\e2e_windows_smoke.mjs
```

---

## 確認メモ欄

| 項目 | 結果 | 備考 |
|---|---|---|
| パイプライン正常系 | | |
| パイプライン失敗停止 | | |
| バッチ正常系 | | |
| バッチ部分失敗継続 | | |
| テンプレート保存 | | |
| スマート承認 safe | | |
| スマート承認 standard | | |
| スマート承認 fast | | |
| critical 常時手動 | | |
```

---

## 実装順序

1. `batch.rs` 末尾に `#[cfg(test)] mod tests { ... }` を追記
2. `pipeline.rs` 末尾に `#[cfg(test)] mod tests { ... }` を追記
3. `template.rs` 末尾に `#[cfg(test)] mod tests { ... }` を追記
4. `docs/E2E_COWORK_MANUAL_CHECKLIST.md` を作成

## 検証チェックリスト（Codex 自身による確認）

- [ ] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` で追加したテストが全てパスすること
- [ ] `#[ignore]` を付けたテストがあれば、その理由をコメントで明記すること
- [ ] `pnpm typecheck` がエラーなしであること
- [ ] 既存テスト（`startup_smoke` 等）がリグレッションしないこと
- [ ] `docs/E2E_COWORK_MANUAL_CHECKLIST.md` が作成されていること

## 共通ルール

- 本体コード（テスト以外）は変更しないこと
- `Cargo.toml` や `package.json` は変更しないこと
- テストに新しい依存クレートを追加しないこと（`std`・`serde_json`・`uuid` 等の既存クレートのみ使用）
- AppHandle が必要で切り出せないテストには `#[ignore]` を付けてスキップし、コメントで理由を書くこと
