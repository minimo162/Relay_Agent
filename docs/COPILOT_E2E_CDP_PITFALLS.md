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
| `apps/desktop/playwright-cdp.config.ts` | CDP接続用 Playwright 設定（`connectOverCDP` / プロジェクト分離） |
| `apps/desktop/tests/m365-copilot-capabilities-v2.spec.ts` | 能力検証 E2E（T1–T10、`cdp-connect` プロジェクト） |
| `apps/desktop/tests/m365-copilot-cdp.spec.ts` | M365 チャット **スモーク**（新規チャット・送信・マルチターン、`m365-cdp-chat` プロジェクト） |
| `playwright-capabilities.config.ts` | Web アプリ統合テスト用（別コンフィグ） |

## 実行手順

### 1. EdgeをCDP有効化で起動

```bash
microsoft-edge --remote-debugging-port=9222
```

### 2. M365 Copilotにサインイン

- `https://m365.cloud.microsoft/chat` にアクセス
- 必要に応じてMFA（Microsoft Authenticator）で認証

### 3. テスト実行

**能力検証スイート（`cdp-connect`）:**

```bash
cd apps/desktop
npx playwright test --config=playwright-cdp.config.ts --project=cdp-connect
```

**M365 チャットスモーク（`m365-cdp-chat`、実 CDP での接続・送信・マルチターン確認向け）:**

```bash
cd apps/desktop
CDP_ENDPOINT=http://127.0.0.1:9333 npx playwright test --config=playwright-cdp.config.ts --project=m365-cdp-chat
```

Relay 既定の Edge CDP ポートは **9333** のことが多い（スクリプト例: `scripts/start-relay-edge-cdp.sh`）。環境に合わせて `CDP_ENDPOINT` を変える。

### 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `CDP_ENDPOINT` | `playwright-cdp.config.ts` 内は `http://localhost:9222`（`m365-cdp-chat` はテスト内で `9333` をデフォルト指定） | CDP の HTTP ベース URL（`/json/version` が取れること） |

---

## 実 CDP 検証手順（`m365-cdp-chat`）

### 目的

- ローカルで **既に M365 Copilot にサインイン済みの Edge** に CDP で繋ぎ、UI 上で **コンポーザ入力・Enter 送信・2 通目以降（マルチターン）** が再現できることを確認する。
- `copilot_server.js` と同系の送信経路（`Input.dispatchKeyEvent` など）がテスト側でも再現できるかを確認する。

### 前提条件

1. Edge をリモートデバッグ付きで起動（例: `--remote-debugging-port=9333`）。
2. 同一プロファイルで `https://m365.cloud.microsoft/chat` を開き、**Copilot にログイン済み**であること（未ログインだとログイン画面だけが対象になり、意味のある検証にならない）。
3. `apps/desktop` で Playwright 依存が入っていること（通常はリポジトリの `pnpm install` 済み）。

### CDP 到達性の確認（任意）

エンドポイントが生きていれば HTTP 200 で JSON が返る:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9333/json/version
# 期待: 200
```

### 実行コマンド

```bash
cd apps/desktop
CDP_ENDPOINT=http://127.0.0.1:9333 npx playwright test --config=playwright-cdp.config.ts --project=m365-cdp-chat
```

- `workers: 1`・`test.describe.configure({ mode: "serial" })` のため、**同一ブラウザタブ上で順に** 00→05 が走る。
- 成果物（失敗時の trace 等）の出力先: `apps/desktop/test-results-cdp/`（`.gitignore` 済み）。

### 実検証結果の例（2026-04 時点・代表環境）

以下は **実機 Edge + サインイン済み M365** に CDP で接続して実行したときの **ログから抽出した要約**である。応答時間は Copilot 側の負荷により変動する。

| 項目 | 結果 |
|------|------|
| 接続 | `connectOverCDP(CDP_ENDPOINT)` で既存の `m365.cloud.microsoft` タブを検出して利用 |
| 00 新規チャット | サイドバー「新しいチャット」でスレッド初期化、コンポーザ空を確認 |
| 03 初回送信 | 日本語プロンプト入力後、**`Input.dispatchKeyEvent(Enter)` のみ**で送信・コンポーザクリアまで成功 |
| 04 マルチターン（2 通目） | **フォーカス調整だけの素の CDP Enter** は送信に至らないことがある。`#m365-chat-editor-target-element` 等の **外殻をクリックしてから** 再度 CDP Enter を送ると送信に成功（ログ上 `CDP Enter after shell click`）。 |
| フォールバック | Enter 段階で複数戦略（CDP → 外殻クリック+CDP → keyboard → inner `press`）を試し、Ctrl+Enter も同様の段階を持つ。 |
| 添付・送信ゲート | サーバの `copilotAttachmentStillPending` に倣い、**コンポーザ周辺ドック内**の progress 系のみを待機（ドキュメント全体の `aria-busy` は誤検知になりやすいためテストでは除外）。送信ボタンが押下可能に見えるまでの待機も併用。 |
| 全体 | **6 tests passed**（1 ワーカー・シリアル、合計実行時間は Copilot 応答に依存し約 1〜2 分程度のことが多い） |

### 検証記録（2026-04-08・リポジトリ実行）

| 項目 | 結果 |
|------|------|
| ホスト | Linux（開発環境）。CDP HTTP `http://127.0.0.1:9333/json/version` → **200**。 |
| UI 言語 | M365 チャット UI が **日本語**（ページタイトル `チャット \| M365 Copilot`、`button[aria-label="新しいチャット"]`、`生成を停止` など）。 |
| コマンド | `cd apps/desktop && CDP_ENDPOINT=http://127.0.0.1:9333 npx playwright test --config=playwright-cdp.config.ts --project=m365-cdp-chat` |
| 結果 | **6 passed**（合計 ~1.6 min）。04 は 1 通目は素の CDP Enter、2 通目は `CDP Enter after shell click` で送信。 |
| 同時実施 | リポジトリ整合: `pnpm typecheck`（root）、`cargo test -p relay-agent-desktop --lib`、`cargo check -p relay-agent-desktop`（`apps/desktop/src-tauri`）— いずれも成功。 |

### 実装参照（送信まわり）

- テスト: `apps/desktop/tests/m365-copilot-cdp.spec.ts`（`dispatchEnterViaCdp`、`tryEnterStrategies` / `tryCtrlEnterStrategies`、`focusM365ComposerDeep`、添付・送信待機ヘルパ）。
- 本番 CDP サーバ: `apps/desktop/src-tauri/binaries/copilot_server.js`（`dispatchEnterKey`、`focusComposer`、`copilotAttachmentStillPending`、`submitPromptRaw`）。

---

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

### 課題5: マルチターン後に「素の」CDP Enter だけでは送信されないことがある

**現象**: 1 通目は `Input.dispatchKeyEvent(Enter)` が通るが、Copilot 応答後の 2 通目で同じ手順だけではコンポーザがクリアされず、送信できないように見える。

**原因**: Lexical コンポーザでは、応答後にフォーカスやイベントターゲットが **外殻（`#m365-chat-editor-target-element` 等）と内側 `contenteditable` でずれる**ことがあり、CDP のキーイベントが編集ツリーに届かない場合がある（「改行だけ」ではなく、**キーが編集対象に入っていない**状態に近い）。

**解決策（テスト・本番の考え方）**:

- `focusComposer` 相当（内側への `scrollIntoView` / `click` / `focus`）を行ったうえで送信する。
- それでも足りない場合は **コンポーザ外殻をユーザー操作相当でクリックしてから** 再度 `Input.dispatchKeyEvent(Enter)` を送る（`m365-copilot-cdp.spec.ts` の `CDP Enter after shell click` 戦略）。
- 送信ボタンが無効の間は Enter も効かないことがあるため、**添付・progress 系の UI がコンポーザ付近に残っていないこと**と、**送信コントロールが有効に見えること**の待機を `submitPromptRaw` に倣って入れる（テストではコンポーザ周辺にスコープしたセレクタで誤検知を抑える）。

## トラブルシューティング

| 現象 | 対処 |
|------|------|
| `CDP connection refused` | `microsoft-edge --remote-debugging-port=9222` が起動しているか確認 |
| サインイン画面にリダイレクト | Edgeを再起動（`pkill -f microsoft-edge`）して再認証 |
| 送信ボタンが有効にならない | `page.keyboard.type()`を使用（`page.fill()`ではない） |
| テストがタイムアウト | `timeout: 180_000`に設定済み。AI応答に60秒以上かかる場合はさらに拡張 |
