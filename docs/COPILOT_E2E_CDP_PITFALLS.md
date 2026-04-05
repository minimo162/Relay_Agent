# M365 Copilot CDP E2Eテスト ドキュメント

## 概要

Microsoft 365 CopilotのE2Eテストを、実際にログインしたMicrosoft EdgeブラウザにCDP (Chrome DevTools Protocol)経由で接続して実行する手法を記録する。

## アーキテクチャ

```
+-------------------+      CDP (localhost:9222)      +-------------------+
|  Playwright Test  |  -------------------------->   |  Microsoft Edge   |
|  (capabilities-v2 |                                |  (logged-in to    |
|   .spec.ts)       |  <--------------------------   |   M365 Copilot)   |
+-------------------+      ws://localhost:9222       +-------------------+
```

## 重要ファイル

| ファイル | 役割 |
|----------|------|
| `playwright-cdp.config.ts` | CDP接続用Playwright設定 (`connectOverCDP`使用) |
| `tests/m365-copilot-capabilities-v2.spec.ts` | E2Eテスト本体（10テスト、シリアル実行） |
| `playwright-capabilities.config.ts` | Webアプリ統合テスト用（別コンフィグ） |

## 実行手順

### 1. EdgeをCDP有効化で起動

```bash
microsoft-edge --remote-debugging-port=9222
```

### 2. M365 Copilotにサインイン

- `https://m365.cloud.microsoft/chat` にアクセス
- 必要に応じてMFA（Microsoft Authenticator）で認証

### 3. テスト実行

```bash
cd apps/desktop
npx playwright test --config=playwright-cdp.config.ts
```

### 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `CDP_ENDPOINT` | `http://localhost:9222` | CDPのエンドポイントURL |

## テストスイート（T1-T10）

| テスト | 内容 | 検証ポイント |
|--------|------|-------------|
| T1 | Word文書作成 | プロジェクト計画の構造（概要、目的、スケジュール、成果物） |
| T2 | Pythonコード生成 | CSV読み込み + データ集計 + エラーハンドリング |
| T3 | Excelファイル作成 | 月度売上表 + サンプルデータ10行 |
| T4 | OneDriveファイル参照 | 最近編集したファイル一覧 |
| T5 | PowerPoint作成 | マーケティングプレゼン（5スライド） |
| T6 | コード編集（修正） | 既存Pythonスクリプトにlogging追加 |
| T7 | 会話履歴の連続性 | 同一スレッドで前のコンテキストを参照できるか |
| T8 | ドキュメント編集 | 既存Word文書にセクション追加 |
| T9 | TypeScriptコード生成 | Fetch API + async/await + エラーハンドリング |
| T10 | 複数ステップワークフロー | Excelデータ分析サマリー |

## 発見された重要課題と解決策

### 課題1: BrowserbaseではCookieが共有されない

**現象**: `browser_navigate`（Browserbaseブラウザ）は毎回サインイン画面になる。

**原因**: Browserbaseは隔離されたクラウドコンテナで動作しており、Dockerホスト上のEdge（localhost:9222）のCookie/セッションは共有されない。

**解決策**: `chromium.connectOverCDP()`を使ってDocker内のEdgeに直接接続する。`playwright-cdp.config.ts`で`connectOverCDP`プロジェクトとして定義。

### 課題2: Copilotの入力フィールドに `page.fill()` が使えない

**現象**: `page.fill()`で`Element is not an <input>, <textarea> or [contenteditable] element.`エラー。

**原因**: CopilotはLexicalエディター（`div[role="textbox"]`）を使用しており、ネイティブのinput要素ではない。

**解決策**: `page.keyboard.type()`で文字を入力すると、Lexicalエディターがキーボードイベントを検知し、送信ボタンが有効化される。

### 課題3: セッション有効期限が短い

**現象**: Dockerヘッドレス環境では1-2時間でセッションが失効し、`login.microsoftonline.com`にリダイレクトされる。

**原因**: Microsoftのセッションポリシーと、ヘッドレス環境でのbot検知。

**解決策**: テスト前にEdgeを再起動し、新鮮なセッションで開始する。MFA番号は手動で入力。

### 課題4: テスト間で同じセッションを維持する必要がある

**現象**: 各テストが独立したページを開くと、会話のコンテキスト（`convId`）が失われる。

**解決策**: `test.describe.configure({ mode: "serial" })` + `test.beforeAll()`で1つのページ/セッションを共有し、`findOrCreateCopilotPage()`で既存のCopilotタブを再利用する。

## トラブルシューティング

| 現象 | 対処 |
|------|------|
| `CDP connection refused` | `microsoft-edge --remote-debugging-port=9222` が起動しているか確認 |
| サインイン画面にリダイレクト | Edgeを再起動（`pkill -f microsoft-edge`）して再認証 |
| 送信ボタンが有効にならない | `page.keyboard.type()`を使用（`page.fill()`ではない） |
| テストがタイムアウト | `timeout: 180_000`に設定済み。AI応答に60秒以上かかる場合はさらに拡張 |
