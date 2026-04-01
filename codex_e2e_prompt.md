# Relay Agent — Cowork フェーズ E2E テストプロンプト

作成日: 2026-04-02
対象フェーズ: Cowork（Tasks 164–183）

---

## 概要

Cowork フェーズで追加した4機能について、Windows 上で動作検証できる
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
| `apps/desktop/src-tauri/src/batch.rs` 末尾に追記 | Rust 単体テスト |
| `apps/desktop/src-tauri/src/pipeline.rs` 末尾に追記 | Rust 単体テスト |
| `apps/desktop/src-tauri/src/template.rs` 末尾に追記 | Rust 単体テスト |
| `apps/desktop/src-tauri/src/risk_evaluator.rs` の既存 `tests` に追記 | Rust 単体テスト |
| `docs/E2E_COWORK_MANUAL_CHECKLIST.md` を新規作成 | 手動チェックリスト |

**制約:**
- 既存の本体コードは変更しない（`filter_by_category` の visibility 変更は例外として許可）
- `Cargo.toml` / `package.json` は変更しない
- テストで使う依存は `std`・`serde_json`・`uuid` 等の既存クレートのみ

---

## Task 1: `batch.rs` 末尾に `#[cfg(test)]` ブロックを追記

実際の struct 定義（確認済み）:

```rust
pub struct BatchJob {
    pub id: String,
    pub workflow_goal: String,
    pub project_id: Option<String>,
    pub targets: Vec<BatchTarget>,
    pub concurrency: u8,
    pub stop_on_first_error: bool,
    pub status: BatchJobStatus,
    pub output_dir: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub struct BatchTarget {
    pub file_path: String,
    pub status: BatchTargetStatus,
    pub output_path: Option<String>,
    pub error_message: Option<String>,
    pub session_id: Option<String>,
}
```

追記するテストコード:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn make_job(id: &str, paths: &[&str]) -> BatchJob {
        BatchJob {
            id: id.to_string(),
            workflow_goal: "filter rows".to_string(),
            project_id: None,
            targets: paths
                .iter()
                .map(|p| BatchTarget {
                    file_path: p.to_string(),
                    status: BatchTargetStatus::Pending,
                    output_path: None,
                    error_message: None,
                    session_id: None,
                })
                .collect(),
            concurrency: 1,
            stop_on_first_error: false,
            status: BatchJobStatus::Idle,
            output_dir: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn batch_registry_stores_and_retrieves_job() {
        let mut registry = BatchRegistry::default();
        let job = make_job("batch-1", &["a.csv", "b.csv"]);
        registry.jobs.insert(job.id.clone(), job);

        let stored = registry.jobs.get("batch-1").unwrap();
        assert_eq!(stored.targets.len(), 2);
        assert_eq!(stored.status, BatchJobStatus::Idle);
        assert_eq!(stored.targets[0].file_path, "a.csv");
    }

    #[test]
    fn batch_skip_target_updates_status_to_skipped() {
        let mut registry = BatchRegistry::default();
        let job = make_job("batch-2", &["x.csv", "y.csv"]);
        registry.jobs.insert(job.id.clone(), job);

        let job = registry.jobs.get_mut("batch-2").unwrap();
        if let Some(t) = job.targets.iter_mut().find(|t| t.file_path == "x.csv") {
            t.status = BatchTargetStatus::Skipped;
        }

        let stored = registry.jobs.get("batch-2").unwrap();
        assert_eq!(stored.targets[0].status, BatchTargetStatus::Skipped);
        assert_eq!(stored.targets[1].status, BatchTargetStatus::Pending);
    }

    #[test]
    fn batch_target_status_serializes_as_lowercase() {
        assert_eq!(serde_json::to_string(&BatchTargetStatus::Pending).unwrap(), "\"pending\"");
        assert_eq!(serde_json::to_string(&BatchTargetStatus::Running).unwrap(), "\"running\"");
        assert_eq!(serde_json::to_string(&BatchTargetStatus::Done).unwrap(), "\"done\"");
        assert_eq!(serde_json::to_string(&BatchTargetStatus::Failed).unwrap(), "\"failed\"");
        assert_eq!(serde_json::to_string(&BatchTargetStatus::Skipped).unwrap(), "\"skipped\"");
    }

    #[test]
    fn batch_job_status_serializes_as_lowercase() {
        assert_eq!(serde_json::to_string(&BatchJobStatus::Idle).unwrap(), "\"idle\"");
        assert_eq!(serde_json::to_string(&BatchJobStatus::Running).unwrap(), "\"running\"");
        assert_eq!(serde_json::to_string(&BatchJobStatus::Done).unwrap(), "\"done\"");
        assert_eq!(serde_json::to_string(&BatchJobStatus::Failed).unwrap(), "\"failed\"");
    }

    #[test]
    fn batch_job_roundtrips_through_json() {
        let job = make_job("batch-rt", &["file.csv"]);
        let json = serde_json::to_string(&job).unwrap();
        let restored: BatchJob = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "batch-rt");
        assert_eq!(restored.targets[0].file_path, "file.csv");
        assert_eq!(restored.stop_on_first_error, false);
    }
}
```

---

## Task 2: `pipeline.rs` 末尾に `#[cfg(test)]` ブロックを追記

実際の struct 定義（確認済み）:

```rust
pub struct PipelineStep {
    pub id: String,
    pub order: i64,
    pub goal: String,
    pub input_source: PipelineInputSource,
    pub output_artifact_key: Option<String>,
    pub status: PipelineStepStatus,
    pub error_message: Option<String>,
}

pub struct Pipeline {
    pub id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub initial_input_path: Option<String>,
    pub steps: Vec<PipelineStep>,
    pub status: PipelineStatus,
    pub created_at: String,
    pub updated_at: String,
}
```

追記するテストコード:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn make_step(id: &str, order: i64, source: PipelineInputSource) -> PipelineStep {
        PipelineStep {
            id: id.to_string(),
            order,
            goal: format!("goal for {id}"),
            input_source: source,
            output_artifact_key: None,
            status: PipelineStepStatus::Pending,
            error_message: None,
        }
    }

    fn make_pipeline(id: &str, steps: Vec<PipelineStep>) -> Pipeline {
        Pipeline {
            id: id.to_string(),
            title: "test pipeline".to_string(),
            project_id: None,
            initial_input_path: Some("source.csv".to_string()),
            steps,
            status: PipelineStatus::Idle,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn pipeline_registry_stores_and_retrieves_pipeline() {
        let mut registry = PipelineRegistry::default();
        let pipeline = make_pipeline("pipe-1", vec![
            make_step("s1", 0, PipelineInputSource::User),
            make_step("s2", 1, PipelineInputSource::PrevStepOutput),
        ]);
        registry.pipelines.insert(pipeline.id.clone(), pipeline);

        let stored = registry.pipelines.get("pipe-1").unwrap();
        assert_eq!(stored.steps.len(), 2);
        assert_eq!(stored.steps[1].input_source, PipelineInputSource::PrevStepOutput);
    }

    #[test]
    fn pipeline_cancel_flag_is_set_and_read() {
        let mut registry = PipelineRegistry::default();
        registry.cancelled.insert("pipe-cancel".to_string(), true);

        assert!(*registry.cancelled.get("pipe-cancel").unwrap_or(&false));
        assert!(!*registry.cancelled.get("other-pipe").unwrap_or(&false));
    }

    #[test]
    fn pipeline_steps_sort_by_order() {
        let mut steps = vec![
            make_step("s3", 2, PipelineInputSource::PrevStepOutput),
            make_step("s1", 0, PipelineInputSource::User),
            make_step("s2", 1, PipelineInputSource::PrevStepOutput),
        ];
        steps.sort_by_key(|s| s.order);
        assert_eq!(steps[0].id, "s1");
        assert_eq!(steps[1].id, "s2");
        assert_eq!(steps[2].id, "s3");
    }

    #[test]
    fn pipeline_step_status_serializes_as_snake_case() {
        assert_eq!(serde_json::to_string(&PipelineStepStatus::Pending).unwrap(), "\"pending\"");
        assert_eq!(serde_json::to_string(&PipelineStepStatus::Running).unwrap(), "\"running\"");
        assert_eq!(
            serde_json::to_string(&PipelineStepStatus::WaitingApproval).unwrap(),
            "\"waiting_approval\""
        );
        assert_eq!(serde_json::to_string(&PipelineStepStatus::Done).unwrap(), "\"done\"");
        assert_eq!(serde_json::to_string(&PipelineStepStatus::Failed).unwrap(), "\"failed\"");
    }

    #[test]
    fn pipeline_input_source_serializes_as_snake_case() {
        assert_eq!(serde_json::to_string(&PipelineInputSource::User).unwrap(), "\"user\"");
        assert_eq!(
            serde_json::to_string(&PipelineInputSource::PrevStepOutput).unwrap(),
            "\"prev_step_output\""
        );
    }

    #[test]
    fn prev_step_output_key_chains_correctly() {
        // ステップ1が完了し output_artifact_key にパスが入った状態を模倣
        let mut steps = vec![
            make_step("s1", 0, PipelineInputSource::User),
            make_step("s2", 1, PipelineInputSource::PrevStepOutput),
        ];
        steps[0].output_artifact_key = Some("/out/step1.csv".to_string());

        // ステップ2の入力は前ステップの output_artifact_key から解決される
        let resolved = match steps[1].input_source {
            PipelineInputSource::User => steps[1]
                .output_artifact_key
                .clone()
                .unwrap_or_default(),
            PipelineInputSource::PrevStepOutput => steps[0]
                .output_artifact_key
                .clone()
                .unwrap_or_default(),
        };
        assert_eq!(resolved, "/out/step1.csv");
    }
}
```

---

## Task 3: `template.rs` 末尾に `#[cfg(test)]` ブロックを追記

実際の struct / enum 定義（確認済み）:

```rust
pub enum WorkflowTemplateCategory { Sales, Accounting, Hr, General, Custom }

pub struct WorkflowTemplate {
    pub id: String,
    pub title: String,
    pub category: WorkflowTemplateCategory,
    pub description: String,
    pub goal: String,
    pub expected_tools: Vec<String>,
    pub example_input_file: Option<String>,
    pub tags: Vec<String>,
    pub is_built_in: bool,
    pub created_at: String,
}
```

`filter_by_category` は現在 `fn`（プライベート）。テストから呼ぶために `pub(crate) fn` に昇格させること。

追記するテストコード:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn make_template(id: &str, category: WorkflowTemplateCategory, is_built_in: bool) -> WorkflowTemplate {
        WorkflowTemplate {
            id: id.to_string(),
            title: format!("Template {id}"),
            category,
            description: "desc".to_string(),
            goal: "do something".to_string(),
            expected_tools: vec!["table.filter_rows".to_string()],
            example_input_file: None,
            tags: vec![],
            is_built_in,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn template_category_serializes_correctly() {
        assert_eq!(serde_json::to_string(&WorkflowTemplateCategory::Sales).unwrap(), "\"sales\"");
        assert_eq!(serde_json::to_string(&WorkflowTemplateCategory::Accounting).unwrap(), "\"accounting\"");
        assert_eq!(serde_json::to_string(&WorkflowTemplateCategory::Hr).unwrap(), "\"hr\"");
        assert_eq!(serde_json::to_string(&WorkflowTemplateCategory::General).unwrap(), "\"general\"");
        assert_eq!(serde_json::to_string(&WorkflowTemplateCategory::Custom).unwrap(), "\"custom\"");
    }

    #[test]
    fn template_is_built_in_serializes_as_camel_case_key() {
        let t = make_template("t1", WorkflowTemplateCategory::Sales, true);
        let v = serde_json::to_value(&t).unwrap();
        assert!(v.get("isBuiltIn").is_some(), "key must be camelCase 'isBuiltIn'");
        assert_eq!(v["isBuiltIn"], true);
    }

    #[test]
    fn filter_by_category_returns_matching_only() {
        let templates = vec![
            make_template("a", WorkflowTemplateCategory::Sales, true),
            make_template("b", WorkflowTemplateCategory::General, true),
            make_template("c", WorkflowTemplateCategory::Sales, false),
        ];

        let sales = filter_by_category(templates.clone(), Some(WorkflowTemplateCategory::Sales));
        assert_eq!(sales.len(), 2);
        assert!(sales.iter().all(|t| matches!(t.category, WorkflowTemplateCategory::Sales)));
    }

    #[test]
    fn filter_by_category_none_returns_all() {
        let templates = vec![
            make_template("a", WorkflowTemplateCategory::Sales, true),
            make_template("b", WorkflowTemplateCategory::Hr, false),
        ];
        let all = filter_by_category(templates, None);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn builtin_template_jsons_parse_correctly() {
        let raws: &[&str] = &[
            include_str!("../assets/templates/sales_filter.json"),
            include_str!("../assets/templates/monthly_rollup.json"),
            include_str!("../assets/templates/normalize_columns.json"),
            include_str!("../assets/templates/remove_duplicates.json"),
            include_str!("../assets/templates/invoice_cleanup.json"),
        ];
        for raw in raws {
            let t: WorkflowTemplate = serde_json::from_str(raw)
                .expect("builtin template JSON must be valid");
            assert!(t.is_built_in, "isBuiltIn must be true for bundled templates");
            assert!(!t.title.is_empty(), "title must not be empty");
            assert!(!t.goal.is_empty(), "goal must not be empty");
            assert!(!t.expected_tools.is_empty(), "expected_tools must not be empty");
        }
    }

    #[test]
    fn template_roundtrips_through_json() {
        let original = make_template("rt-1", WorkflowTemplateCategory::Custom, false);
        let json = serde_json::to_string(&original).unwrap();
        let restored: WorkflowTemplate = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.id, "rt-1");
        assert!(!restored.is_built_in);
        assert_eq!(restored.expected_tools, vec!["table.filter_rows"]);
    }
}
```

---

## Task 4: `risk_evaluator.rs` の既存 `tests` モジュールに追記

既存の `tests` モジュール（2件のテストあり）の **末尾** に以下を追記する。
モジュール全体を書き直さないこと。

```rust
    #[test]
    fn fast_policy_auto_approves_up_to_medium() {
        assert!(should_auto_approve(ApprovalPolicy::Fast, OperationRisk::Readonly));
        assert!(should_auto_approve(ApprovalPolicy::Fast, OperationRisk::Low));
        assert!(should_auto_approve(ApprovalPolicy::Fast, OperationRisk::Medium));
        assert!(!should_auto_approve(ApprovalPolicy::Fast, OperationRisk::High));
        assert!(!should_auto_approve(ApprovalPolicy::Fast, OperationRisk::Critical));
    }

    #[test]
    fn safe_policy_never_auto_approves() {
        assert!(!should_auto_approve(ApprovalPolicy::Safe, OperationRisk::Readonly));
        assert!(!should_auto_approve(ApprovalPolicy::Safe, OperationRisk::Low));
        assert!(!should_auto_approve(ApprovalPolicy::Safe, OperationRisk::Medium));
        assert!(!should_auto_approve(ApprovalPolicy::Safe, OperationRisk::Critical));
    }

    #[test]
    fn critical_risk_never_auto_approved_by_any_policy() {
        for policy in [ApprovalPolicy::Safe, ApprovalPolicy::Standard, ApprovalPolicy::Fast] {
            assert!(
                !should_auto_approve(policy, OperationRisk::Critical),
                "{policy:?} must never auto-approve Critical"
            );
        }
    }

    #[test]
    fn file_delete_evaluates_as_critical() {
        assert_eq!(evaluate_risk("file.delete", &serde_json::json!({})), OperationRisk::Critical);
    }

    #[test]
    fn readonly_tools_evaluate_as_readonly() {
        for tool in ["file.list", "file.stat", "workbook.inspect", "sheet.preview", "sheet.profile_columns"] {
            assert_eq!(
                evaluate_risk(tool, &serde_json::json!({})),
                OperationRisk::Readonly,
                "{tool} should map to Readonly"
            );
        }
    }

    #[test]
    fn file_copy_and_move_evaluate_as_high() {
        assert_eq!(evaluate_risk("file.copy", &serde_json::json!({})), OperationRisk::High);
        assert_eq!(evaluate_risk("file.move", &serde_json::json!({})), OperationRisk::High);
    }
```

---

## Task 5: `docs/E2E_COWORK_MANUAL_CHECKLIST.md` を新規作成

以下の内容をそのまま書き出すこと。省略・要約しないこと。

---

```markdown
# Cowork フェーズ — Windows E2E 手動チェックリスト

作成日: 2026-04-02

## 実行環境

- Windows 10/11 x64
- Microsoft Edge（M365 Copilot にログイン済み・CDP 有効化済み）
- Relay Agent デスクトップアプリ起動済み（`pnpm tauri:dev` または release ビルド）
- テスト用ワークスペース `C:\relay-test\` を作成し以下を配置:
  - `data_a.csv`（`examples/revenue-workflow-demo.csv` のコピー）
  - `data_b.csv`（同上、別名コピー）
  - `data_c.csv`（同上、別名コピー）

---

## 1. ワークフローパイプライン

### 1-1 2ステップパイプラインの正常実行

- [ ] デリゲーションモードの「パイプラインモード」トグルをオンにする
- [ ] PipelineBuilder が表示されること
- [ ] タイトルを「テストパイプライン」と入力する
- [ ] 「最初の入力ファイル」に `C:\relay-test\data_a.csv` を入力する
- [ ] ステップ1を追加: ゴール「approved が true の行だけ残して」/ 入力元「ユーザー指定ファイル」
- [ ] ステップ2を追加: ゴール「amount でグループ集計して別名保存して」/ 入力元「前ステップ出力」
- [ ] 「実行開始」ボタンを押す
- [ ] PipelineProgress にステップ1が「実行中」で強調表示されること
- [ ] ステップ1完了後、ステップ2が自動的に開始されること
- [ ] ステップ2の入力がステップ1の出力ファイルであること（ActivityFeed で確認）
- [ ] 両ステップ完了後、全ステップが「完了」バッジになること
- [ ] 元ファイル `data_a.csv` が未変更であること
- [ ] ステップ1・ステップ2それぞれの出力ファイルが生成されていること

### 1-2 ステップ並べ替え

- [ ] PipelineBuilder でステップ2の「↑」ボタンを押す
- [ ] ステップ2が1番目に移動すること
- [ ] 「↑」ボタンが先頭ステップで無効化されること
- [ ] 「↓」ボタンが末尾ステップで無効化されること

### 1-3 ステップ失敗時の停止

- [ ] ステップ1のゴールに無効な指示（例: 「存在しない列 xyz を削除して」）を入力して実行
- [ ] ステップ1が「失敗」バッジになりエラーメッセージが表示されること
- [ ] ステップ2が「待機中」のまま停止すること（自動継続しないこと）
- [ ] パイプライン全体のステータスが「失敗」になること

### 1-4 パイプラインキャンセル

- [ ] パイプライン実行中に「キャンセル」ボタンを押す
- [ ] 実行中ステップが停止し後続ステップが開始されないこと

---

## 2. バッチ処理

### 2-1 複数ファイル選択と一括実行（正常系）

- [ ] デリゲーションモードの「バッチモード」タブを選択する
- [ ] BatchTargetSelector が表示されること
- [ ] 「ファイルを選択」で `data_a.csv`, `data_b.csv`, `data_c.csv` を複数選択する
- [ ] ターゲットリストに3件が表示されること（ファイル名・サイズ）
- [ ] ゴール「approved が true の行だけ残して別名保存して」を入力して「バッチ実行開始」を押す
- [ ] BatchDashboard が表示され全ターゲットが「待機中」で始まること
- [ ] 1件ずつ順次処理されること（同時実行されないこと）
- [ ] 各ターゲットのステータスが日本語（「実行中」「完了」等）で表示されること
- [ ] 全体進捗バーが 33% → 66% → 100% に更新されること
- [ ] 全件完了後に「完了」ボタンまたは結果フォルダが表示されること
- [ ] 元ファイル3件が未変更であること

### 2-2 フォルダ選択モード

- [ ] 「フォルダを選択」ボタンで `C:\relay-test\` を選択する
- [ ] フォルダ内の CSV ファイルが自動列挙されること
- [ ] 列挙されたファイルがターゲットリストに表示されること

### 2-3 一部失敗の継続動作

- [ ] `data_b.csv` を空ファイルに差し替えて3件でバッチ実行
- [ ] `data_b.csv` のターゲットが「失敗」になること
- [ ] `stopOnFirstError` = false のとき `data_c.csv` の処理が継続されること
- [ ] 完了後のサマリーに成功2件・失敗1件が表示されること

### 2-4 スキップ機能

- [ ] バッチ実行中、処理待ちターゲットの「スキップ」ボタンを押す
- [ ] 該当ターゲットが「スキップ」になり次のターゲットへ進むこと
- [ ] スキップされたターゲットの出力ファイルが生成されていないこと

---

## 3. テンプレートライブラリ

### 3-1 組み込みテンプレートの表示

- [ ] ChatComposer の「テンプレートから選ぶ」ボタンを押す
- [ ] TemplateBrowser が開くこと
- [ ] 組み込みテンプレートが5件以上表示されること
- [ ] 各カードにタイトル・説明・使用ツールが表示されること

### 3-2 カテゴリフィルタ

- [ ] 「営業」タブで営業カテゴリのテンプレートのみ表示されること
- [ ] 「経理」「HR」「汎用」タブでも同様にフィルタされること
- [ ] 「すべて」タブで全件が表示されること

### 3-3 キーワード検索

- [ ] 検索ボックスに「集計」と入力する
- [ ] タイトル・説明・ゴールに「集計」を含むテンプレートのみ表示されること
- [ ] 検索ボックスをクリアすると全件に戻ること

### 3-4 テンプレートからゴール自動セット

- [ ] 組み込みテンプレートをクリックして「このテンプレートを使う」を押す
- [ ] ChatComposer のゴール入力にテキストが自動セットされること
- [ ] TemplateBrowser が閉じてファイル選択にフォーカスが移ること

### 3-5 カスタムテンプレートの保存と再利用

- [ ] 任意のタスクを1回実行して完了画面を表示する
- [ ] CompletionTimeline の「テンプレートとして保存」ボタンを押す
- [ ] タイトル入力・カテゴリ選択のダイアログが表示されること
- [ ] 保存後にトースト通知が表示されること
- [ ] TemplateBrowser の「カスタム」タブに保存したテンプレートが表示されること
- [ ] アプリを再起動してもカスタムテンプレートが残っていること
- [ ] カスタムテンプレートを選択してゴール自動セットができること

### 3-6 カスタムテンプレートの削除

- [ ] カスタムテンプレートの削除ボタンを押す
- [ ] TemplateBrowser から消えること
- [ ] アプリ再起動後も表示されないこと
- [ ] 組み込みテンプレートに削除ボタンが表示されないこと

---

## 4. スマート承認ゲート

### 4-1 安全モード — 全操作手動承認

- [ ] 設定モーダル → 承認ポリシー → 「安全モード」を選択して保存
- [ ] `workbook.inspect` を含むタスクを実行する
- [ ] InterventionPanel が表示されること（自動承認されないこと）
- [ ] ActivityFeed に「自動承認済み」バッジが表示されないこと
- [ ] `workbook.save_copy` でも InterventionPanel が表示されること

### 4-2 標準モード — 読み取り専用・低リスクは自動承認

- [ ] 設定モーダル → 承認ポリシー → 「標準モード」を選択して保存
- [ ] `workbook.inspect` / `sheet.preview` を含むタスクを実行する
- [ ] これらの操作で InterventionPanel が表示されないこと
- [ ] ActivityFeed に「自動承認済み」バッジ（グレー・小さいもの）が表示されること
- [ ] `table.rename_columns`（低リスク）が自動承認されること
- [ ] `workbook.save_copy`（中リスク）では InterventionPanel が表示されること

### 4-3 高速モード — 中リスクまで自動承認

- [ ] 設定モーダル → 承認ポリシー → 「高速モード」を選択して保存
- [ ] `workbook.save_copy` を含むタスクを実行する
- [ ] `workbook.save_copy` の InterventionPanel が表示されないこと
- [ ] ActivityFeed に「自動承認済み」バッジが表示されること

### 4-4 Critical 操作は全ポリシーで手動承認

- [ ] 高速モードのまま `file.delete` を含むタスクを実行する
- [ ] InterventionPanel が必ず表示されること
- [ ] 高速モードでも自動承認されないこと
- [ ] 安全・標準モードでも同様であることを確認する

### 4-5 ポリシーの永続化

- [ ] 「標準モード」を選択してアプリを再起動する
- [ ] 再起動後も「標準モード」が選択済みであること

---

## 5. 回帰テスト（既存機能）

### R-1 デリゲーションモード基本フロー

- [ ] パイプライン・バッチモードをすべてオフにした状態でデリゲーションフローを実行
- [ ] ゴール入力 → Copilot 自動送信 → プラン承認 → 変換実行 → 保存が完走すること

### R-2 ガイドモード（3ステップフロー）

- [ ] ガイドモードへの切り替えが正常に動作すること
- [ ] ステップ1 → ステップ2 → ステップ3 の基本フローが完走すること

### R-3 ドラフト再開

- [ ] バッチ実行中にアプリを終了して再起動する
- [ ] 再起動後にバッチの状態が復元または適切にリセットされること

---

## 自動テスト実行コマンド（Windows PowerShell）

```powershell
# Rust 単体テスト（全テスト）
cargo test --manifest-path apps\desktop\src-tauri\Cargo.toml 2>&1

# TypeScript 型チェック
pnpm typecheck

# Windows スモーク（ビルド済みバイナリ使用）
$env:RELAY_USE_BUILD="1"
node apps\desktop\scripts\e2e_windows_smoke.mjs
```

---

## 確認結果メモ

| シナリオ | 結果（○/×/スキップ） | メモ |
|---|---|---|
| 1-1 パイプライン正常実行 | | |
| 1-2 ステップ並べ替え | | |
| 1-3 ステップ失敗停止 | | |
| 1-4 パイプラインキャンセル | | |
| 2-1 バッチ正常実行 | | |
| 2-2 フォルダ選択 | | |
| 2-3 一部失敗継続 | | |
| 2-4 スキップ機能 | | |
| 3-1 組み込みテンプレート表示 | | |
| 3-4 ゴール自動セット | | |
| 3-5 カスタムテンプレート保存 | | |
| 4-1 安全モード | | |
| 4-2 標準モード | | |
| 4-3 高速モード | | |
| 4-4 Critical 常時手動 | | |
| 4-5 ポリシー永続化 | | |
| R-1 デリゲーション基本フロー | | |
```

---

## 実装順序

1. `risk_evaluator.rs` の既存 `tests` モジュール末尾に Task 4 を追記
2. `batch.rs` 末尾に Task 1 を追記
3. `pipeline.rs` 末尾に Task 2 を追記
4. `template.rs` の `filter_by_category` を `pub(crate)` に昇格させてから Task 3 を末尾に追記
5. `docs/E2E_COWORK_MANUAL_CHECKLIST.md` を新規作成（Task 5）

## Codex 完了確認チェックリスト

- [ ] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` で追加テストが全パスすること
- [ ] `#[ignore]` を付けたテストがあれば、理由をコメントで明記すること
- [ ] `pnpm typecheck` がエラーなしであること
- [ ] 既存テスト（`startup_smoke` 等）がリグレッションしないこと
- [ ] `docs/E2E_COWORK_MANUAL_CHECKLIST.md` が作成されていること
