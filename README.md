# Relay Agent

Relay Agent は M365 Copilot を使ったデスクトップ自律エージェントアプリです。
ファイル変換・テキスト処理・ドキュメント読み取りなどのタスクを自然言語で指示すると、
Copilot が実行計画を立案し、読み取り操作を自動実行、書き込み操作はユーザー承認後に実行します。

## 機能概要

### エージェントループ（自律実行）

- M365 Copilot（Edge CDP / Playwright 経由）に自然言語でタスクを指示
- Copilot が read ツールを自律実行しながらデータを調査
- 書き込み操作は必ずプレビュー確認 → ユーザー承認を経てから実行
- 最大ターン数・タイムアウトを設定可能、途中キャンセルに対応

### プランニングモード

- 実行前に Copilot がステップごとの実行計画（ExecutionPlan）を提案
- 計画をユーザーが確認・編集・承認してから自律実行
- 書き込みステップに到達したら自動停止し、再度承認を要求
- 計画の進捗をリアルタイムに ActivityFeed に表示

### 対応ツール

**スプレッドシート操作（CSV / XLSX）**
- `workbook.inspect` — シート構成・列情報の読み取り
- `sheet.preview` — 行サンプルの読み取り
- `sheet.profile_columns` — 列の型推論とサンプル値の読み取り
- `session.diff_from_base` — 変更差分の確認
- `table.rename_columns` — 列名変更
- `table.cast_columns` — 列の型変換
- `table.filter_rows` — 行フィルタリング
- `table.derive_column` — 派生列の追加
- `table.group_aggregate` — グループ集計
- `workbook.save_copy` — 別名保存（元ファイルは変更しない）

**汎用ファイル操作**
- `file.list` — ディレクトリ一覧の読み取り
- `file.read_text` — テキストファイルの読み取り（最大 1MB）
- `file.stat` — ファイルメタデータの読み取り
- `file.copy` — ファイルコピー（承認必須）
- `file.move` — ファイル移動・リネーム（承認必須）
- `file.delete` — ゴミ箱への移動（承認必須）

**テキスト処理**
- `text.search` — 正規表現での検索（コンテキスト行付き）
- `text.replace` — 正規表現での置換（バックアップ自動作成、承認必須）

**ドキュメント読み取り**
- `document.read_text` — Word（.docx）・PowerPoint（.pptx）・PDF からのテキスト抽出

### プロジェクト管理

- プロジェクト単位でフォルダ・カスタム指示・学習済み設定を管理
- カスタム指示はすべての Copilot プロンプトに自動挿入
- 学習済み設定（メモリ）で繰り返しタスクの文脈を維持
- プロジェクトのルートフォルダ外へのファイルアクセスを警告

### UI

- **委任モード** — ChatComposer でゴール入力 → ActivityFeed でリアルタイム進捗表示 → InterventionPanel で計画承認・書き込み承認
- **マニュアルモード** — 従来の 3 ステップガイドフロー（はじめる → Copilot に聞く → 確認して保存）
- ドラフト自動保存・ページリロード後の再開に対応

### 安全設計

- 書き込み操作はすべて承認ゲート経由
- 元ファイルは変更しない（別名保存のみ）
- `file.delete` はゴミ箱移動（完全削除はオプション）
- `text.replace` は `.bak` バックアップを自動作成
- CSV インジェクション対策（`=`, `+`, `-`, `@` の先頭文字をエスケープ）

## 必要環境

- Node.js `>= 22`
- pnpm `10.x`
- Rust stable toolchain（`cargo`）
- Tauri v2 向けのネイティブ依存（OS ごとのビルドツール）

## インストール

```bash
pnpm install
```

## 起動

Tauri デスクトップアプリ（推奨）:

```bash
pnpm --filter @relay-agent/desktop tauri:dev
```

フロントエンドのみ（UI 確認用）:

```bash
pnpm --filter @relay-agent/desktop dev
```

## ビルド（Windows インストーラー）

Windows 10/11 x64 向け NSIS インストーラーのビルド:

```bash
pnpm install
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --dir apps/desktop exec tauri build --config src-tauri/tauri.windows.conf.json
```

出力先: `target/release/bundle/nsis/`

タグ（例: `v0.1.0`）を push すると GitHub Actions が自動ビルドして Release に添付します。

## 動作確認コマンド

```bash
pnpm check          # Svelte チェック
pnpm typecheck      # TypeScript 型チェック
pnpm startup:test   # 起動スモークテスト（ウィンドウ非表示）
pnpm launch:test    # アプリ起動テスト（Xvfb）
pnpm workflow:test  # ワークフロースモークテスト（E2E）
. "$HOME/.cargo/env" && cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

個別テスト:

```bash
# TypeScript ユニットテスト
pnpm -C apps/desktop exec tsx --test \
  src/lib/agent-loop-core.test.ts \
  src/lib/agent-loop-prompts.test.ts \
  src/lib/prompt-templates.test.ts \
  src/lib/stores/delegation.test.ts
```

## デモ

サンプル CSV: [`examples/revenue-workflow-demo.csv`](examples/revenue-workflow-demo.csv)

### エージェントモードでの実行例

1. `pnpm --filter @relay-agent/desktop tauri:dev` で起動
2. 設定でエージェントループを有効化（CDP ポート設定）
3. ChatComposer にゴールを入力:
   ```
   revenue-workflow-demo.csv の approved が true の行だけ残して、
   review_label 列を追加し、別コピーとして保存して
   ```
4. ファイルを添付して「送信」
5. ActivityFeed で Copilot の実行過程を確認
6. 書き込み確認が来たら内容を確認して「承認」
7. 出力ファイルを確認

### マニュアルモードでの実行例

1. `1. はじめる` でファイルパスとタスク名を入力し「準備する」
2. `2. Copilot に聞く` で「依頼をコピー」し M365 Copilot に貼り付け
3. Copilot の JSON レスポンスを貼り付けて「確認する」
4. `3. 確認して保存` で変更内容を確認し「保存する」

## Copilot レスポンス例（マニュアルモード）

```json
{
  "version": "1.0",
  "status": "ready_to_write",
  "summary": "approved が true の行だけ残し、review_label 列を追加して保存",
  "actions": [
    {
      "tool": "table.filter_rows",
      "sheet": "Sheet1",
      "args": { "predicate": "[approved] == true" }
    },
    {
      "tool": "table.derive_column",
      "sheet": "Sheet1",
      "args": {
        "column": "review_label",
        "expression": "[segment] + \"-approved\"",
        "position": "end"
      }
    },
    {
      "tool": "workbook.save_copy",
      "args": { "outputPath": "/path/to/output.csv" }
    }
  ],
  "followupQuestions": [],
  "warnings": []
}
```

## リポジトリ構成

```
apps/
  desktop/
    src/               # SvelteKit フロントエンド
      lib/
        components/    # UI コンポーネント（12 個）
        stores/        # Svelte ストア（delegation.ts）
        agent-loop.ts  # エージェントループ
        agent-loop-core.ts
        agent-loop-prompts.ts
        prompt-templates.ts
        continuity.ts  # ドラフト永続化
        copilot-browser.ts  # Edge CDP / Playwright
        ipc.ts         # Tauri IPC ラッパー
    src-tauri/
      src/
        file_ops.rs    # ファイル操作実装
        storage.rs     # セッション・プロジェクト・プラン管理
        models.rs      # Rust 型定義
        project.rs     # プロジェクト Tauri コマンド
        execution.rs   # 実行系 Tauri コマンド
packages/
  contracts/
    src/
      relay.ts         # RelayPacket・ExecutionPlan スキーマ
      ipc.ts           # IPC リクエスト/レスポンススキーマ
      file.ts          # ファイル操作スキーマ
      project.ts       # プロジェクトスキーマ
      workbook.ts      # スプレッドシートスキーマ
examples/
  revenue-workflow-demo.csv
docs/
  IMPLEMENTATION.md    # 実装ログ
  AGENT_LOOP_DESIGN.md
  AUTONOMOUS_EXECUTION_DESIGN.md
  DELEGATION_UI_DESIGN.md
  PROJECT_MODEL_DESIGN.md
  FILE_OPS_E2E_VERIFICATION.md
  CODEX_PROMPT_*.md    # Codex 委任プロンプト（01–18）
```

## 現在の制限事項

- CSV が書き込み実行の主対象。XLSX は検査・プレビューのみ対応（書き込み未対応）
- エンコーディングは UTF-8 と Shift_JIS のみ対応
- `text.search` は行単位マッチのみ（複数行にまたがるパターン非対応）
- プロジェクトとセッションの自動紐付けは未実装
- MCP（Model Context Protocol）外部ツール統合は未実装（CODEX_PROMPT_17 で計画中）
- アーティファクトファースト出力パイプラインは未実装（CODEX_PROMPT_18 で計画中）
- シェル実行・任意コード実行・VBA 実行・外部ネットワーク呼び出しは意図的に対象外

## 環境変数

デスクトップアプリの起動に `.env` ファイルは不要です。
TaskMaster AI 連携を使う場合は `.env.example` を `.env` にコピーして設定してください。
