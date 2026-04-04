# Codex Prompt 01 — ブラウザ自動化基盤セットアップ（Task 76・77 前半）

> **実行条件:** 最初に実行する。M365 へのアクセス不要。
> **次のプロンプト:** CODEX_PROMPT_02_TAURI_INTEGRATION.md（本プロンプト完了後）

---

```xml
<task>
Relay Agent リポジトリ（カレントディレクトリ）に対して、
Playwright TypeScript を使った M365 Copilot Chat ブラウザ自動化の
基盤を構築する。

## リポジトリ概要
- pnpm モノレポ（pnpm-workspace.yaml）
- apps/desktop: SvelteKit SPA + Tauri v2
- packages/contracts: Zod スキーマ + TypeScript 型
- Node.js 22 / pnpm 10 / Rust stable
- esbuild はグローバルにインストール済み

## やること

### 1. Playwright のインストール

apps/desktop の devDependencies に playwright を追加する。

  pnpm --filter @relay-agent/desktop add -D playwright

### 2. scripts/copilot-browser.ts の作成

apps/desktop/scripts/copilot-browser.ts を新規作成する。

**CLI インタフェース:**
- --action connect : CDP 接続・ページ到達を確認して
                     { status: 'ready' } または
                     { status: 'error', errorCode, message }
                     を stdout に JSON 出力して終了する
- --action send   : stdin から { "prompt": "..." } を読み取り、
                    Copilot に送信してレスポンスを取得し
                    { status: 'ok', response: string } または
                    { status: 'error', errorCode, message }
                    を stdout に JSON 出力して終了する
- --cdp-port      : number（default: 9222）
- --timeout       : ms（default: 60000）

**接続方式:**
playwright.chromium.connectOverCDP('http://localhost:{cdpPort}') を使う。
Edge の専用プロファイル起動は不要。
ユーザーが既存 Edge を CDP モードで起動してログイン済みであることを前提とする。

**セレクタ（実環境確認前のプレースホルダ）:**

  const COPILOT_URL       = 'https://m365.cloud.microsoft/chat/';
  const NEW_CHAT_SELECTOR = '[data-testid="newChatButton"]';
  const EDITOR_SELECTOR   = '#m365-chat-editor-target-element';
  const SEND_READY_SEL    = '.fai-SendButton:not([disabled])';
  const RESPONSE_SEL      = '[data-testid="markdown-reply"]';
  // API エンドポイントパターン（後で実環境で確認して更新する）
  const API_URL_PATTERN   = '/sydney/conversation';

**エラーコード定義:**

  type ErrorCode =
    | 'CDP_UNAVAILABLE'   // connectOverCDP 失敗
    | 'NOT_LOGGED_IN'     // URL がログインページ
    | 'RESPONSE_TIMEOUT'  // waitForResponse または DOM ポーリングがタイムアウト
    | 'COPILOT_ERROR'     // Copilot が既知エラー文字列を返した
    | 'SEND_FAILED';      // 送信ボタン操作失敗

**--action connect の実装:**
1. chromium.connectOverCDP で接続。失敗したら CDP_UNAVAILABLE を返す。
2. ページの URL が COPILOT_URL でなければ page.goto() でナビゲート。
3. URL がログインページパターン（/login / /signin を含む）なら NOT_LOGGED_IN を返す。
4. 到達できたら { status: 'ready' } を返す。

**--action send の実装（レスポンスキャプチャ優先順）:**
1. connectOverCDP で接続。
2. getByTestId('newChatButton').click() で新規チャット開始。
3. プロンプト入力（EDITOR_SELECTOR または getByRole('textbox') を試みる）。
4. 送信と同時に page.waitForResponse(r => r.url().includes(API_URL_PATTERN)) を設定。
5. API キャプチャ失敗時の DOM フォールバック:
   RESPONSE_SEL のテキストを 200ms ごとにポーリング、
   2 回連続で同一テキストになったら確定。
6. Copilot のエラー応答パターン（「これについてチャットできません」等）を検知して
   最大 2 回リトライ。リトライ後も失敗なら COPILOT_ERROR を返す。
7. 引用ラベル（[1] 等）を stripCitations() で除去してから返す。

### 3. esbuild バンドル設定

apps/desktop/package.json の scripts に追加:

  "copilot-browser:build": "esbuild scripts/copilot-browser.ts --bundle --platform=node --outfile=scripts/dist/copilot-browser.js"

apps/desktop/.gitignore（または ルート .gitignore）に scripts/dist/ を追加。

### 4. ビルド確認

  pnpm --filter @relay-agent/desktop copilot-browser:build

scripts/dist/copilot-browser.js が生成されることを確認する。
</task>

<default_follow_through_policy>
合理的な低リスクな解釈でそのまま進めること。
セレクタや API エンドポイントは「後で実環境確認」と明記したプレースホルダで OK。
型エラーがあれば修正してから進む。
</default_follow_through_policy>

<completeness_contract>
ビルドが通るまで完了としない。
pnpm typecheck と copilot-browser:build の両方が成功することを確認すること。
</completeness_contract>

<verification_loop>
最終化する前に以下を確認:
1. pnpm --filter @relay-agent/desktop typecheck でエラーがないこと
2. pnpm --filter @relay-agent/desktop copilot-browser:build が成功し
   scripts/dist/copilot-browser.js が存在すること
3. scripts/copilot-browser.ts に --action connect と --action send の
   両パスが実装されていること
</verification_loop>

<action_safety>
変更範囲は以下のみ:
- apps/desktop/scripts/copilot-browser.ts（新規）
- apps/desktop/package.json（devDependencies と scripts の追記のみ）
- .gitignore（scripts/dist/ の追記のみ）

触らないもの:
- src/ 以下の既存ファイル
- Rust コード
- packages/contracts
</action_safety>

<structured_output_contract>
完了後に以下を返すこと:
1. 作成・変更したファイル一覧
2. ビルド成功の確認（コマンドと出力）
3. 実環境で確認が必要な事項（セレクタ・API エンドポイント）のリスト
</structured_output_contract>
```

---

## 完了後の手動作業（Task 76/78 の実環境確認）

本プロンプト完了後、以下を手動で行ってセレクタと API エンドポイントを確定させること。

1. Edge を CDP モードで起動:
   ```
   msedge.exe --remote-debugging-port=9222 --no-first-run
   ```

2. M365 Copilot Chat にログイン: `https://m365.cloud.microsoft/chat/`

3. Playwright codegen でセレクタを録画:
   ```
   npx playwright codegen --browser=chromium http://localhost:9222
   ```
   新規チャット・プロンプト入力・送信の各操作を記録してセレクタを収集する。

4. Edge の DevTools > Network タブで Copilot 送信時の API エンドポイント URL を確認し、
   `API_URL_PATTERN` を更新する。

5. `scripts/copilot-browser.ts` のセレクタ定数を実測値に更新して再ビルドする。

確認完了後に **CODEX_PROMPT_02_TAURI_INTEGRATION.md** を実行する。
