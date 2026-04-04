# Codex Prompt 03 — ドキュメント整備（Task 76 残務・Task 83 テンプレート）

> **実行条件:** CODEX_PROMPT_01 と CODEX_PROMPT_02 が完了していること。
> **M365 アクセス不要。コード変更なし。ドキュメント作成のみ。**

---

```xml
<task>
Relay Agent リポジトリ（カレントディレクトリ）の
ブラウザ自動化機能に関するドキュメントを2件整備する。

## 対象ファイル

1. docs/BROWSER_AUTOMATION.md — 現状は最小限の内容しかない。
   実装コードを読み、完全なアーキテクチャドキュメントに書き直す。

2. docs/BROWSER_AUTOMATION_VERIFICATION.md — 新規作成。
   Task 83（手動 E2E 検証）の記録テンプレートとして使う。

---

## ドキュメント 1: docs/BROWSER_AUTOMATION.md の書き直し

以下のファイルを必ず読んでから記述すること:
- apps/desktop/scripts/copilot-browser.ts    （スクリプト実装）
- apps/desktop/src/lib/copilot-browser.ts    （Tauri IPC ラッパー）
- apps/desktop/src/routes/+page.svelte       （UI 実装・設定モーダル）
- apps/desktop/src-tauri/capabilities/default.json
- packages/contracts/src/ipc.ts             （CopilotBrowser スキーマ）
- apps/desktop/src/lib/continuity.ts         （設定永続化）

### 記載すべき内容

#### 1. 概要
- 機能の目的（ステップ2の手動中継を自動化する）
- 採用技術（Playwright TypeScript + Edge CDP）と選定理由
  （同一スタック・ゼロ追加ランタイム・waitForResponse による堅牢なレスポンスキャプチャ）

#### 2. 全体フロー図（テキストアート）

以下の形式で書くこと:

  [ステップ2 UI] 「Copilotに自動送信」ボタン押下
      ↓
  [lib/copilot-browser.ts] sendToCopilot(prompt)
      ↓  Command.create('node', ['scripts/dist/copilot-browser.js', '--action', 'send', ...])
  [scripts/copilot-browser.ts] --action send
      ↓  chromium.connectOverCDP('http://localhost:{cdpPort}')
  [Edge（ユーザーのログイン済みブラウザ）]
      ↓  page.goto() → newChatButton.click() → fill(prompt) → send
  [M365 Copilot Chat API]
      ↓  waitForResponse(API_URL_PATTERN) または DOM ポーリング
  [scripts/copilot-browser.ts] { status: 'ok', response: '...' } を stdout に JSON 出力
      ↓
  [lib/copilot-browser.ts] stdout をパース → レスポンス文字列を返す
      ↓
  [ステップ2 UI] テキストエリアに自動セット

#### 3. ファイル構成

実際のファイルを読んで正確に記載すること:

| ファイル | 役割 |
|---|---|
| apps/desktop/scripts/copilot-browser.ts | ... |
| apps/desktop/scripts/dist/copilot-browser.js | ... |
| apps/desktop/src/lib/copilot-browser.ts | ... |
| packages/contracts/src/ipc.ts | CopilotBrowser* スキーマ（追記部分） |
| apps/desktop/src/lib/continuity.ts | BrowserAutomationSettings 永続化 |
| apps/desktop/src-tauri/capabilities/default.json | shell:allow-spawn 権限 |

#### 4. Edge の CDP 起動手順（初回セットアップ）

設定モーダルの「起動コマンドをコピー」ボタンで取得できるコマンドの説明と、
手動で実行する場合のコマンドを記載する:

  msedge.exe --remote-debugging-port=9222 --no-first-run

CDPモードが必要な理由（認証済みセッションを流用するため）も説明する。

#### 5. 設定項目

| 設定項目 | デフォルト値 | 変更場所 | 説明 |
|---|---|---|---|
| cdpPort | 9222 | 設定モーダル | Edge の CDP デバッグポート |
| timeoutMs | 60000 | 設定モーダル | Copilot 応答待機タイムアウト（ms） |

#### 6. レスポンスキャプチャ方式

2段階の取得戦略を説明する:
1. waitForResponse（API_URL_PATTERN にマッチするネットワーク応答をキャプチャ）
   - SSE / NDJSON / JSON のパース方法
   - 複数のキーを探索する coerceResponseTextFromPayload の仕組み
2. DOM ポーリングフォールバック（RESPONSE_SEL、200ms 間隔、2回安定判定）

#### 7. エラーコード一覧

実際の実装から読み取って正確に記載すること:

| エラーコード | 発生条件 | UI で表示される日本語メッセージ |
|---|---|---|
| CDP_UNAVAILABLE | ... | ... |
| NOT_LOGGED_IN | ... | ... |
| RESPONSE_TIMEOUT | ... | ... |
| COPILOT_ERROR | ... | ... |
| SEND_FAILED | ... | ... |

#### 8. セレクタと API エンドポイント（要実環境確認）

現状のプレースホルダ値を記載し、確認済みかどうかのステータスを明示する:

| 定数名 | 現在の値 | 確認済み |
|---|---|---|
| NEW_CHAT_SELECTOR | [data-testid="newChatButton"] | 未確認 |
| EDITOR_SELECTOR | #m365-chat-editor-target-element | 未確認 |
| SEND_READY_SEL | .fai-SendButton:not([disabled]) | 未確認 |
| RESPONSE_SEL | [data-testid="markdown-reply"] | 未確認 |
| API_URL_PATTERN | /sydney/conversation | 未確認 |

確認方法:
1. Edge を CDP モードで起動
2. M365 Copilot Chat にログイン
3. `npx playwright codegen --browser=chromium http://localhost:9222` でセレクタを録画
4. DevTools > Network でレスポンス API エンドポイントを確認
5. scripts/copilot-browser.ts の定数を更新して再ビルド

#### 9. ビルドコマンド

  pnpm --filter @relay-agent/desktop copilot-browser:build

---

## ドキュメント 2: docs/BROWSER_AUTOMATION_VERIFICATION.md の新規作成

Task 83 の手動 E2E 検証を記録するためのテンプレートを作成する。
検証者が空欄を埋めていく形式にすること。

### 記載すべき内容

#### ヘッダー

  検証日: ___________
  検証者: ___________
  環境: Windows ___  Edge バージョン: ___  M365 テナント: ___

#### セクション 1: セットアップ確認

| 項目 | 期待値 | 実測値 | 合否 |
|---|---|---|---|
| Node.js バージョン | ≥ 22 | | |
| Playwright インストール済み | pnpm --filter @relay-agent/desktop typecheck が通る | | |
| scripts/dist/copilot-browser.js が存在する | ファイル存在 | | |
| Edge が CDP モードで起動できる | { "status": "ready" } が返る | | |

確認コマンド:
  node scripts/dist/copilot-browser.js --action connect --cdp-port 9222

#### セクション 2: 正常フロー検証

**シナリオ A: 自動送信ボタン → レスポンス自動入力**

手順:
1. examples/revenue-workflow-demo.csv をステップ1で選択
2. テンプレート「列名を変更する」を選択して「準備する」
3. ステップ2の「Copilotに自動送信 ▶」ボタンを押す

| 確認項目 | 期待値 | 実測値 | 合否 |
|---|---|---|---|
| ボタン押下後にスピナーが表示される | スピナー表示 | | |
| Copilot レスポンスがテキストエリアに自動入力される | テキストが入る | | |
| 所要時間 | 60秒以内 | ___秒 | |
| 「確認する」ボタンが有効化される | 有効 | | |

**シナリオ B: 保存まで完走**

| 確認項目 | 期待値 | 実測値 | 合否 |
|---|---|---|---|
| auto-fix 後に JSON として parse できる | parse 成功 | | |
| バリデーション（Level 1/2/3）が通る | PASS | | |
| SheetDiff カードが表示される | 表示 | | |
| 「保存する」を押して save-copy が生成される | ファイル存在 | | |
| 元の CSV が変更されていない | 未変更 | | |

#### セクション 3: エラーケース検証

| シナリオ | 手順 | 期待メッセージ | 実測メッセージ | 合否 |
|---|---|---|---|---|
| CDP 未起動 | Edge を起動せずに送信ボタンを押す | 「Edge が CDP モードで起動していません…」 | | |
| 未ログイン | Edge でログアウト後に送信ボタンを押す | 「M365 Copilot にログインしていません…」 | | |
| 手動フォールバック | エラー後に「手動入力に切り替え」リンクを押す | テキストエリアにフォーカスが当たる | | |

#### セクション 4: セレクタ確認結果

playwright codegen または DevTools で確認した実際の値を記録する:

| 定数名 | 確認した実際の値 | 更新要否 |
|---|---|---|
| NEW_CHAT_SELECTOR | | |
| EDITOR_SELECTOR | | |
| SEND_READY_SEL | | |
| RESPONSE_SEL | | |
| API_URL_PATTERN | | |

#### セクション 5: 総合判定

| 項目 | 判定 |
|---|---|
| 正常フロー | PASS / FAIL |
| エラーハンドリング | PASS / FAIL |
| セレクタ更新要否 | 要/不要 |

**備考・追加アクション:**

（自由記述）
</task>

<default_follow_through_policy>
ドキュメント記述のために実装ファイルを必ず読むこと。
実装から読み取れる情報は推測せず正確に記載する。
コードは変更しない。
</default_follow_through_policy>

<completeness_contract>
2ファイルを両方完成させてから完了とする。
BROWSER_AUTOMATION.md の各セクション（概要・フロー図・ファイル構成・
設定項目・エラーコード表・セレクタ表）が全て埋まっていること。
BROWSER_AUTOMATION_VERIFICATION.md のテンプレートが
検証者が空欄を埋められる形式になっていること。
</completeness_contract>

<verification_loop>
最終化する前に確認:
1. BROWSER_AUTOMATION.md のエラーコード表の値が
   apps/desktop/src/lib/copilot-browser.ts の COPILOT_ERROR_MESSAGES と一致すること
2. BROWSER_AUTOMATION.md のフロー図が実際の実装と対応していること
3. BROWSER_AUTOMATION_VERIFICATION.md に全5シナリオ（A/B/エラー3件）が含まれること
</verification_loop>

<action_safety>
変更範囲:
- docs/BROWSER_AUTOMATION.md（書き直し）
- docs/BROWSER_AUTOMATION_VERIFICATION.md（新規作成）

コードファイルは一切変更しない。
</action_safety>

<structured_output_contract>
完了後に以下を返すこと:
1. 作成・更新したファイル名
2. BROWSER_AUTOMATION.md の主要セクション一覧
3. BROWSER_AUTOMATION_VERIFICATION.md のシナリオ一覧
</structured_output_contract>
```
