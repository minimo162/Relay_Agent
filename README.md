# Relay Agent

Relay Agent は M365 Copilot を使ったデスクトップ自律エージェントアプリです。
ファイル変換・テキスト処理・ドキュメント読み取りなどのタスクを自然言語で指示すると、
Copilot が実行計画を立案し、読み取り操作を自動実行、書き込み操作はユーザー承認後に実行します。

## 機能概要

### エージェントループ（自律実行）

- M365 Copilot（Edge CDP 経由）に自然言語でタスクを指示
- Copilot が read ツールを自律実行しながらデータを調査
- 書き込み操作は必ずプレビュー確認 → ユーザー承認を経てから実行
- 最大ターン数・タイムアウトを設定可能、途中キャンセルに対応

### プランニングモード

- 実行前に Copilot がステップごとの実行計画（ExecutionPlan）を提案
- 計画をユーザーが確認・編集・承認してから自律実行
- 書き込みステップに到達したら自動停止し、再度承認を要求
- 計画の進捗をリアルタイムに UnifiedFeed に表示

### 対応ツール

ツールはすべて ToolCatalog で一元管理され、設定画面から有効/無効を切り替えられます。

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

**ブラウザ自動化**
- `browser.send_to_copilot` — Edge CDP 経由で M365 Copilot にプロンプト送信

### MCP（Model Context Protocol）外部ツール

設定画面の「ツール」タブから MCP サーバーを登録できます。

- JSON-RPC 2.0 準拠（HTTP/SSE・stdio トランスポート対応）
- 接続時にサーバーのツール一覧を自動発見・登録
- MCP ツールはすべて承認ゲート経由で実行（`requiresApproval: true`）
- MCP ツール呼び出しには 30 秒タイムアウトを適用
- ContextPanel の「Servers」タブで接続状態をリアルタイム確認

### プロジェクト管理

- プロジェクト単位でフォルダ・カスタム指示・学習済み設定を管理
- カスタム指示はすべての Copilot プロンプトに自動挿入
- 学習済み設定（メモリ）で繰り返しタスクの文脈を維持
- プロジェクトのルートフォルダ外へのファイルアクセスを警告

### UI（SolidJS ベース 3 ペインワークスペース）

SvelteKit から SolidJS へ移行し、コア機能に集中したミニマルな構成。

**3 ペインワークスペース（1421px ポート）**
- **左: Sidebar** — セッション一覧（検索機能付き）
- **中央: MessageFeed + Composer** — ツール呼び出し・メッセージ表示＋送信エリア＋承認オーバーレイ
- **右: ContextPanel** — Files / Servers / Policy タブ

**主要 UI コンポーネント（SolidJS）**
- `Shell` — ルートレイアウト（3-ペイングリッド）
- `MessageFeed` — ✓/⟳/✗ ステータス付きツール呼び出し、メッセージバブル、自動スクロール
- `Composer` — auto-grow テキストエリア、Send/Cancel ボタン、Enter で送信
- `ApprovalOverlay` — ツール承認要求オーバーレイ（Reject / Approve）
- `Sidebar` — セッションリスト、ハイライト付き選択
- `ContextPanel` — タブ付き情報パネル
- `StatusBar` — 接続状態＋セッション数
- `ui.tsx` — 基本パーツ（Button, Input, StatusDot）

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
pnpm typecheck              # TypeScript 型チェック
pnpm --filter @relay-agent/desktop build  # Vite ビルド
cd apps/desktop && pnpm test:e2e  # Playwright E2E
. "$HOME/.cargo/env" && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml  # Rust テスト
```

## デモ

サンプル CSV: [`examples/revenue-workflow-demo.csv`](examples/revenue-workflow-demo.csv)

### エージェントモードでの実行例

1. `pnpm --filter @relay-agent/desktop tauri:dev` で起動
2. Composer にタスクを入力して送信
3. MessageFeed で Copilot の実行過程をリアルタイム表示
4. ApprovalOverlay が来たら内容を確認して Approve / Reject を選択
5. 出力ファイルを確認

## Copilot レスポンス例

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
    src/
      root.tsx             # SolidJS ルートコンポーネント（Shell）
      index.tsx            # エントリーポイント（mount）
      components/
        ui.tsx             # 基本 UI パーツ（Button, Input, StatusDot）
      lib/
        ipc.ts             # Tauri IPC ラッパー（Zod 型付き）
        tauri-mock-core.ts # Tauri モック（E2E 用）
        tauri-mock-event.ts# Tauri イベントモック
      index.html           # HTML エントリー
      index.css            # Tailwind + カスタムプロパティ
      vite-env.d.ts
    tests/                 # Playwright E2E テスト
      app.e2e.spec.ts
      mock-tauri.ts
      tauri-mock-core.ts
      tauri-mock-event.ts
      tauri-mock-preload.ts
    playwright.config.ts
    vite.config.ts         # Vite + SolidJS + Tailwind
    tsconfig.json
    package.json
    src-tauri/
      src/
        tauri_bridge.rs    # Tauri コマンド集約（start_agent, respond_approval, cancel_agent, get_session_history）
        copilot_client.rs  # Copilot HTTP クライアント
        models.rs          # Rust 型定義
        main.rs
        lib.rs
      Cargo.toml
      tauri.conf.json
packages/
  contracts/
    src/
      relay.ts         # RelayPacket・ExecutionPlan・ToolRegistration スキーマ
      ipc.ts           # IPC リクエスト/レスポンススキーマ
      file.ts          # ファイル操作スキーマ
      project.ts       # プロジェクトスキーマ
      workbook.ts      # スプレッドシートスキーマ
      approval.ts      # 承認ポリシースキーマ
      pipeline.ts      # パイプラインスキーマ
      batch.ts         # バッチ処理スキーマ
      template.ts      # ワークフローテンプレートスキーマ
      core.ts          # セッション・ターン・アーティファクト共通型
      meta.ts          # アプリメタデータスキーマ
      shared.ts        # 共通バリデーター（entityId・日付等）
examples/
  revenue-workflow-demo.csv
docs/
  # 設計ドキュメント・実装ログ・Codex 委任プロンプト（60+ ファイル）
```

## 現在の制限事項

- CSV が書き込み実行の主対象。XLSX は検査・プレビューのみ対応（書き込み未対応）
- エンコーディングは UTF-8 と Shift_JIS のみ対応
- `text.search` は行単位マッチのみ（複数行にまたがるパターン非対応）
- プロジェクトとセッションの自動紐付けは未実装
- MCP stdio トランスポートは接続時にサーバープロセスを都度起動（永続デーモン未対応）
- シェル実行・任意コード実行・VBA 実行・外部ネットワーク呼び出しは意図的に対象外

## 環境変数

デスクトップアプリの起動に `.env` ファイルは不要です。
TaskMaster AI 連携を使う場合は `.env.example` を `.env` にコピーして設定してください。
