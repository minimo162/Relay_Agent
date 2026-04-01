# Windows E2E 手動チェックリスト

## 実行環境
- Windows 10/11 x64
- Microsoft Edge（M365 Copilot にログイン済み）
- Relay Agent デスクトップアプリ起動済み
- テスト用ワークスペース: `C:\relay-test\` を作成し以下を配置:
  - `revenue-workflow-demo.csv`（`examples/` からコピー）
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
- [ ] 承認 UI に ArtifactPreview（`csv_table` タイプ）が表示されること
- [ ] 承認後に品質チェック結果が ActivityFeed に表示されること（✅ または ⚠️）

### 10-2 品質チェック - 空ファイル警告
- [ ] 出力が空になるような条件（全行 filter 等）でタスクを実行
- [ ] 品質チェックで「出力ファイルが空」警告が ActivityFeed に表示されること

### 10-3 品質チェック - CSV インジェクション検出
- [ ] `=SUM(A1)` などを含むセルを持つ CSV を変換
- [ ] 品質チェックで CSV インジェクション警告が表示されること

### 10-4 テキスト差分プレビュー
- [ ] text.replace 実行後の承認 UI で ArtifactPreview（`text_diff` タイプ）が表示されること
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
