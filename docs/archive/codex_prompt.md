# Relay Agent — Codex 実装依頼プロンプト

最終更新: 2026-04-02

---

## このファイルの使い方

このファイルは **Codex（または他の実装エージェント）** に渡すための実装依頼書です。
`.taskmaster/tasks/tasks.json` の Tasks 164–183 を実装するための十分なコンテキストを含みます。

---

## プロジェクト概要

**Relay Agent** は M365 Copilot を活用するデスクトップエージェントアプリ（SvelteKit SPA + Tauri v2 + Rust バックエンド）。

- ユーザーが自然言語でゴールを伝えると、Copilot と複数ターンやりとりしながら CSV/XLSX ファイルを変換する
- 書き込み操作は必ずユーザーの承認ゲートを経由する（save-copy only）
- M365 Copilot は Playwright + Edge CDP 経由でブラウザ自動化（Claude API は使用しない）

### スタック

| 層 | 技術 |
|---|---|
| フロントエンド | SvelteKit 2 / Svelte 5 / TypeScript |
| デスクトップシェル | Tauri v2 |
| バックエンド | Rust（Tauri commands） |
| 型定義 | Zod スキーマ（packages/contracts） |
| ブラウザ自動化 | Playwright TypeScript（Edge CDP） |
| パッケージ管理 | pnpm workspaces |

### 重要ディレクトリ

```
apps/desktop/src/              SvelteKit フロントエンド
apps/desktop/src/lib/          agent-loop, ipc, tool-runtime 等
apps/desktop/src/lib/components/  UI コンポーネント
apps/desktop/src-tauri/src/    Rust バックエンド
packages/contracts/src/        共有 Zod スキーマ
.taskmaster/docs/prd.txt       統合 PRD（全仕様）
.taskmaster/tasks/tasks.json   全タスク一覧（Tasks 1–183）
```

---

## 今回の依頼スコープ

**Tasks 164–183**（Cowork フェーズ）を実装してください。
4つのフェーズに分かれています。**優先順位の高い順に取り組んでください。**

---

## フェーズ A: ワークフローパイプライン（Tasks 164–169）★最優先

複数のエージェントターンを順次チェーンして、前ステップの出力を次ステップの入力に自動接続する機能。

### Task 164: 設計ドキュメント作成

`docs/PIPELINE_DESIGN.md` を作成し以下を記述:
- Pipeline / PipelineStep モデルの全フィールド定義
- ステップ間ファイルパス受け渡しプロトコル
- 承認ゲートのステップ単位保持方法
- エラー時のステップスキップ/停止ポリシー

### Task 165: Contracts 拡張

`packages/contracts/src/pipeline.ts` を新規作成:

```typescript
import { z } from 'zod'

export const PipelineStepStatusEnum = z.enum([
  'pending', 'running', 'waiting_approval', 'done', 'failed'
])

export const PipelineStepSchema = z.object({
  id: z.string(),
  order: z.number().int().min(0),
  goal: z.string().min(1),
  inputSource: z.enum(['user', 'prev_step_output']),
  outputArtifactKey: z.string().optional(),
  status: PipelineStepStatusEnum,
  errorMessage: z.string().optional(),
})

export const PipelineSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().optional(),
  steps: z.array(PipelineStepSchema),
  status: z.enum(['idle', 'running', 'done', 'failed']),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PipelineStep = z.infer<typeof PipelineStepSchema>
export type Pipeline = z.infer<typeof PipelineSchema>
```

`packages/contracts/src/index.ts` に `export * from './pipeline'` を追加。

### Task 166: バックエンド — パイプライン実行エンジン

`src-tauri/src/pipeline.rs` を新規作成し、以下の Tauri コマンドを実装:
- `pipeline_create(title, steps) -> Pipeline`
- `pipeline_run(pipeline_id) -> ()` — 非同期でステップを順次実行
- `pipeline_get_status(pipeline_id) -> Pipeline`
- `pipeline_cancel(pipeline_id) -> ()`

**実装指針:**
- 各ステップは既存の `start_turn` / `agent_loop_tick` の仕組みを再利用
- `inputSource: 'prev_step_output'` の場合、前ステップの `outputArtifactKey` が指すファイルパスをこのステップのファイル入力にセット
- ステップの状態変化は Tauri イベント（`pipeline:step_update`）としてフロントエンドに emit
- `lib.rs` の `tauri::Builder` の `.invoke_handler()` にコマンドを登録

### Task 167: フロントエンド — パイプラインビルダー UI

`apps/desktop/src/lib/components/PipelineBuilder.svelte` を新規作成:
- ステップカードのリスト（追加・削除・上下移動ボタン）
- 各ステップ: ゴールテキスト入力、inputSource セレクタ
- 「実行開始」ボタン
- デリゲーションページの「パイプライン」タブから開く

### Task 168: フロントエンド — パイプライン実行進行表示

`apps/desktop/src/lib/components/PipelineProgress.svelte` を新規作成:
- ステップ一覧（縦並び、status バッジ付き）
- `pipeline:step_update` イベントを listen してリアルタイム更新
- 実行中ステップのアクティビティフィードをインライン展開
- 承認ゲートは既存 `InterventionPanel.svelte` をステップ文脈で再利用

### Task 169: E2E 検証

`docs/PIPELINE_VERIFICATION.md` に以下の手動検証チェックリストを記録:
- 2ステップパイプライン実行の成功
- ステップ間ファイル受け渡し確認
- ステップ1失敗時の挙動
- 元ファイル未変更確認

---

## フェーズ B: バッチ処理（Tasks 170–174）★高優先

同一ゴールを複数ファイルに順次適用する機能。

### Task 170: 設計ドキュメント作成

`docs/BATCH_DESIGN.md` を作成し以下を記述:
- BatchJob / BatchTarget モデルの全フィールド定義
- 順次実行制約の理由（CDP セッション競合回避）
- 失敗ターゲットのスキップ/停止ポリシー
- 承認ゲートの連続表示戦略

### Task 171: バックエンド — バッチジョブ実行エンジン

`src-tauri/src/batch.rs` を新規作成し以下を実装:
- `batch_create(goal, target_paths[]) -> BatchJob`
- `batch_run(batch_id) -> ()` — ターゲットを順次エージェントループに投入
- `batch_get_status(batch_id) -> BatchJob`
- `batch_skip_target(batch_id, target_path) -> ()`

**実装指針:**
- ターゲットごとに個別セッションを生成して既存エージェントループを実行
- ターゲット状態変化は `batch:target_update` イベントで emit
- 1ターゲット失敗しても次ターゲットへ継続（stop_on_first_error は設定依存）

### Task 172: フロントエンド — バッチ対象ファイル選択 UI

`apps/desktop/src/lib/components/BatchTargetSelector.svelte` を新規作成:
- フォルダ選択（`dialog.open({ directory: true })` → 内部 CSV/XLSX 列挙）
- ファイル個別選択（`dialog.open({ multiple: true })`）
- 選択ファイルのプレビューリスト（名前・サイズ）
- ゴールテキスト入力エリア
- 「バッチ実行開始」ボタン

### Task 173: フロントエンド — バッチ実行進行ダッシュボード

`apps/desktop/src/lib/components/BatchDashboard.svelte` を新規作成:
- 全体進捗バー
- ターゲット一覧テーブル（ファイル名・ステータス・出力パス・エラーメッセージ）
- `batch:target_update` イベントでリアルタイム更新
- 承認ゲート必要時はインライン InterventionPanel
- 完了後「結果フォルダを開く」ボタン（`shell.open(outputDir)`）

### Task 174: E2E 検証

`docs/BATCH_VERIFICATION.md` に手動検証チェックリストを記録。

---

## フェーズ C: テンプレートライブラリ（Tasks 175–179）

業務別ワークフローテンプレートの保存・検索・再利用機能。

### Task 175: 設計ドキュメント作成

`docs/TEMPLATE_LIBRARY_DESIGN.md` を作成。

### Task 176: バックエンド — テンプレートストレージ & CRUD

`src-tauri/src/template.rs` を新規作成:
- `template_list(category?) -> WorkflowTemplate[]`
- `template_get(id) -> WorkflowTemplate`
- `template_create(title, category, goal, tags[]) -> WorkflowTemplate`
- `template_delete(id) -> ()`
- `template_from_session(session_id) -> WorkflowTemplate`

**組み込みテンプレート:** `src-tauri/assets/templates/` に JSON ファイルを配置し `include_str!` でバンドル。

**組み込みテンプレートの初期セット（5件以上）:**
- 売上データフィルタ（営業カテゴリ）
- 月次集計（営業カテゴリ）
- 列名統一・型変換（汎用カテゴリ）
- 重複行除去（汎用カテゴリ）
- 請求書データ整形（経理カテゴリ）

### Task 177: フロントエンド — テンプレートブラウザ UI

`apps/desktop/src/lib/components/TemplateBrowser.svelte` を新規作成:
- カテゴリタブ（営業/経理/HR/汎用/カスタム）
- キーワード検索ボックス
- テンプレートカード（タイトル・説明・ツールバッジ）
- 「このテンプレートを使う」ボタン

### Task 178: フロントエンド — テンプレート適用

- テンプレート選択時に ChatComposer のゴール入力にテキストをセット
- CompletionTimeline に「テンプレートとして保存」ボタンを追加

### Task 179: E2E 検証

`docs/TEMPLATE_LIBRARY_VERIFICATION.md` に手動検証チェックリストを記録。

---

## フェーズ D: スマート承認ゲート（Tasks 180–183）

操作リスクレベルに基づく自動承認機能。

### Task 180: 設計ドキュメント作成

`docs/SMART_APPROVAL_DESIGN.md` を作成。

**リスクテーブル（必須記載）:**
| ツール | リスクレベル |
|---|---|
| file.list / file.stat / workbook.inspect / sheet.preview / sheet.profile_columns / session.diff_from_base | readonly |
| table.rename_columns / table.filter_rows（行数減少なし） | low |
| table.cast_columns / table.derive_column / table.group_aggregate | medium |
| workbook.save_copy / file.copy | medium |
| file.move | high |
| file.delete | critical |

**ポリシーテーブル（必須記載）:**
| ポリシー | 自動承認閾値 |
|---|---|
| safe（安全） | 自動承認なし（全手動） |
| standard（標準） | readonly + low を自動承認 |
| fast（高速） | readonly + low + medium を自動承認 |
※ critical は全ポリシーで常に手動承認

### Task 181: バックエンド — リスク評価エンジン

`src-tauri/src/risk_evaluator.rs` を新規作成:

```rust
pub enum OperationRisk {
    Readonly,
    Low,
    Medium,
    High,
    Critical,
}

pub fn evaluate_risk(tool_name: &str, _args: &serde_json::Value) -> OperationRisk {
    match tool_name {
        "file.list" | "file.stat" | "workbook.inspect"
        | "sheet.preview" | "sheet.profile_columns"
        | "session.diff_from_base" => OperationRisk::Readonly,
        "table.rename_columns" | "table.filter_rows" => OperationRisk::Low,
        "table.cast_columns" | "table.derive_column"
        | "table.group_aggregate" | "workbook.save_copy"
        | "file.copy" => OperationRisk::Medium,
        "file.move" => OperationRisk::High,
        "file.delete" => OperationRisk::Critical,
        _ => OperationRisk::Medium, // 未知ツールは中リスクとして扱う
    }
}
```

`execution.rs` の承認ゲート前に `evaluate_risk` を呼び出し、ポリシー設定と比較して `auto_approve` を判定。

### Task 182: フロントエンド — 承認ポリシー設定 UI

- SettingsModal.svelte に ApprovalPolicy セレクタを追加
- ActivityFeed.svelte で自動承認済み操作に「自動承認」バッジを表示
- InterventionPanel.svelte で `auto_approve: true` の場合はスキップ

### Task 183: E2E 検証

`docs/SMART_APPROVAL_VERIFICATION.md` に手動検証チェックリストを記録。

---

## 実装時の注意事項

### 守るべきルール（AGENTS.md より）

1. **save-copy only** — 元ファイルは絶対に変更しない
2. **承認ゲートの維持** — critical 操作は ApprovalPolicy に関わらず常に手動承認
3. **任意コード実行禁止** — shell/VBA/外部ネットワーク実行は実装しない
4. **既存構造の保持** — ディレクトリ構成・モジュール境界を壊さない
5. **タスク完了時に検証** — 検証コマンドを実行して成功を確認してからタスクをクローズ

### ビルド & 検証コマンド

```bash
# TypeScript 型チェック
pnpm typecheck

# フロントエンドビルド
pnpm --filter @relay-agent/desktop build

# Rust チェック
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### 既存コードの再利用ポイント

| 機能 | 参照ファイル |
|---|---|
| エージェントループ実行 | `apps/desktop/src/lib/agent-loop.ts` |
| ツール実行 | `apps/desktop/src/lib/tool-runtime.ts` |
| 承認ゲート UI | `apps/desktop/src/lib/components/InterventionPanel.svelte` |
| アクティビティフィード | `apps/desktop/src/lib/components/ActivityFeed.svelte` |
| ファイル選択ダイアログ | `apps/desktop/src/lib/components/ChatComposer.svelte` |
| IPC ラッパー | `apps/desktop/src/lib/ipc.ts` |
| ストレージ永続化 | `apps/desktop/src-tauri/src/storage.rs` |
| Tauri コマンド登録 | `apps/desktop/src-tauri/src/lib.rs` |

---

## 実装順序の推奨

```
Phase A (Pipeline)  → Phase B (Batch)  → Phase C (Template)  → Phase D (Smart Approval)
Task 164 → 165 → 166 → 167 → 168 → 169
          ↕（並列可）
Task 170 → 171 → 172 → 173 → 174
          ↕（並列可）
Task 175 → 176 → 177 → 178 → 179
          ↕（並列可）
Task 180 → 181 → 182 → 183
```

Phase A と Phase B は依存関係がないため並列実装可能。
Phase C と Phase D も互いに独立。

---

## 完了条件

- [ ] `pnpm typecheck` がエラーなし
- [ ] `cargo check` がエラーなし
- [ ] 各フェーズの E2E 検証ドキュメント（VERIFICATION.md）が存在する
- [ ] `.taskmaster/tasks/tasks.json` の対応タスクが `"status": "done"` になっている
- [ ] 元ファイルを変更する実装が存在しないこと（save-copy only の維持）
