# Browser Automation

## 1. 概要

Relay Agent のブラウザ自動化機能は、ステップ2の「Copilot に聞く」で行っていた手動中継を短縮するためのものです。ユーザーが Edge 上で M365 Copilot Chat にログイン済みであることを前提に、Relay Agent が生成した依頼文をそのまま Copilot へ送信し、返ってきた応答をステップ2のテキストエリアへ自動セットします。

採用技術は Playwright TypeScript と Edge CDP 接続です。選定理由は次の3点です。

- デスクトップ側がすでに TypeScript と Node ベースの構成なので、同一スタックで実装できる
- 専用の常駐ブラウザプロセスや別ランタイムをアプリ本体に追加せず、既存の Node 実行で完結できる
- `page.waitForResponse()` を使ったネットワーク応答キャプチャと DOM フォールバックを組み合わせられ、応答取得の失敗点を分離しやすい

## 2. 全体フロー図

```text
[ステップ2 UI] 「Copilotに自動送信」ボタン押下
    ↓
[lib/copilot-browser.ts] sendToCopilot(prompt)
    ↓  Command.create('node', ['scripts/dist/copilot-browser.js', '--action', 'send', '--auto-launch', ...])
[scripts/copilot-browser.ts] --action send
    ↓  既存 CDP Edge を 9333-9342 で探索し、なければ空きポートで Edge を自動起動
    ↓  chromium.connectOverCDP('http://localhost:{resolvedCdpPort}')
[Edge（ユーザーのログイン済みブラウザ）]
    ↓  page.goto() → newChatButton.click() → fill(prompt) → send
[M365 Copilot Chat API]
    ↓  waitForResponse(API_URL_PATTERN) または DOM ポーリング
[scripts/copilot-browser.ts] { status: 'ok', response: '...' } を stdout に JSON 出力
    ↓
[lib/copilot-browser.ts] stdout をパース → レスポンス文字列を返す
    ↓
[ステップ2 UI] テキストエリアに自動セット
```

補足:

- UI では [`apps/desktop/src/routes/+page.svelte`](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) の `handleCopilotAutoSend()` が `sendToCopilot(copilotInstructionText)` を呼びます。
- Tauri 側では Rust command を増やさず、[`@tauri-apps/plugin-shell`](https://www.npmjs.com/package/@tauri-apps/plugin-shell) の `Command.create("node", ...)` で Node スクリプトを直接起動します。

## 3. ファイル構成

| ファイル | 役割 |
|---|---|
| [apps/desktop/scripts/copilot-browser.ts](/workspace/relay-agent-main/apps/desktop/scripts/copilot-browser.ts) | Playwright ベースの本体。`--action connect` と `--action send` を実装し、CDP 接続、Copilot 画面遷移、送信、応答キャプチャ、JSON stdout 出力を担当する |
| [apps/desktop/scripts/dist/copilot-browser.js](/workspace/relay-agent-main/apps/desktop/scripts/dist/copilot-browser.js) | `copilot-browser.ts` を esbuild でビルドした実行対象。Tauri からはこのファイルを `node` で呼び出す |
| [apps/desktop/src/lib/copilot-browser.ts](/workspace/relay-agent-main/apps/desktop/src/lib/copilot-browser.ts) | Tauri shell ラッパー。`sendToCopilot()` と `checkCopilotConnection()` を公開し、stdout JSON の parse と UI 向けエラーマッピングを担当する |
| [packages/contracts/src/ipc.ts](/workspace/relay-agent-main/packages/contracts/src/ipc.ts) | `copilotBrowserErrorCodeSchema` と `copilotBrowserResultSchema` を持ち、ブラウザ自動化の戻り値 shape を型で固定する |
| [apps/desktop/src/lib/continuity.ts](/workspace/relay-agent-main/apps/desktop/src/lib/continuity.ts) | `BrowserAutomationSettings` を `localStorage` に永続化する。保存キーは `relay-agent.continuity.v1` |
| [apps/desktop/src/routes/+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) | ステップ2の `Copilotに自動送信 ▶` ボタン、インラインエラー、`手動入力に切り替え` リンク、設定モーダルを提供する |
| [apps/desktop/src-tauri/capabilities/default.json](/workspace/relay-agent-main/apps/desktop/src-tauri/capabilities/default.json) | `shell:allow-spawn` と `shell:allow-stdin-write` を許可し、`node` 実行と stdin 書き込みを許可する |

## 4. Edge の CDP 起動手順（初回セットアップ）

設定モーダルでは `autoLaunchEdge` が既定で有効になっており、送信時に `9333-9342` の範囲から既存 CDP Edge を探索します。見つからなければ空きポートを選んで Edge を自動起動します。

手動で起動したい場合は、「起動コマンドをコピー」ボタンから次の形式のコマンドをコピーできます。

```bash
msedge.exe --remote-debugging-port=9333 --no-first-run
```

`autoLaunchEdge` を無効にした場合のみ、設定した `cdpPort` に直接接続します。

CDP モードが必要な理由は、Relay Agent が新しいブラウザプロファイルを立ち上げるのではなく、ユーザーがすでにログイン済みの Edge セッションへ接続するためです。これにより M365 認証を別実装せずに、Copilot Chat ページへ到達できます。

## 5. 設定項目

| 設定項目 | デフォルト値 | 変更場所 | 説明 |
|---|---|---|---|
| `autoLaunchEdge` | `true` | 設定モーダル | `9333-9342` の範囲で既存の CDP Edge を探し、必要なら Edge を自動起動する |
| `cdpPort` | `9333` | 設定モーダル | `autoLaunchEdge` が無効なときにだけ使う手動 CDP ポート |
| `timeoutMs` | `60000` | 設定モーダル | Copilot 応答待機タイムアウト。接続確認、送信後の応答待機、DOM ポーリング上限に使われる |

永続化の実装:

- 保存先はブラウザの `localStorage`
- ストレージキーは `relay-agent.continuity.v1`
- `saveBrowserAutomationSettings()` が保存時に値を正規化し、`cdpPort` は `1..65535`、`timeoutMs` は `1000ms` 以上に補正されます
- 既存データに `autoLaunchEdge` がない場合は `true` が補われます

## 6. レスポンスキャプチャ方式

`apps/desktop/scripts/copilot-browser.ts` は 2 段階で Copilot 応答を取得します。

### 6.1 `waitForResponse()` によるネットワーク取得

`runSendAttempt()` では送信前に次を仕込みます。

```ts
page.waitForResponse((response) => response.url().includes(API_URL_PATTERN), { timeout })
```

取得後の処理は `extractResponseText()` に集約されています。

- `content-type` が `application/json` の場合
  - `JSON.parse()` を試し、`coerceResponseTextFromPayload()` でテキスト抽出
- `content-type` が `event-stream` / `ndjson` / `jsonl` か、本文に `data:` を含む場合
  - 改行単位で分割し、`data:` プレフィックスを除去
  - `[DONE]` を除外
  - 各チャンクを JSON として解釈し、最後の有効テキストを採用
- それ以外
  - JSON parse を試し、それでも取れなければ生本文を trim して返す

`coerceResponseTextFromPayload()` はネストした object / array を再帰的に走査し、優先キーとして次を探索します。

- `response`
- `text`
- `content`
- `message`
- `markdown`
- `answer`
- `displayText`

### 6.2 DOM ポーリングフォールバック

ネットワークから十分な本文を取れなかった場合、`readResponseFromDom()` にフォールバックします。

- 対象セレクタ: `RESPONSE_SEL`
- ポーリング間隔: `200ms`
- 安定判定: 同じテキストが `2` 回連続したら確定
- タイムアウト: `timeoutMs`

この方式により、API パターンがずれていても UI 上の最終表示テキストを拾える可能性を残しています。

## 7. エラーコード一覧

| エラーコード | 発生条件 | UI で表示される日本語メッセージ |
|---|---|---|
| `CDP_UNAVAILABLE` | `chromium.connectOverCDP()` に失敗したとき。Edge 未起動、ポート不一致、CDP 無効、全ポート使用中、自動起動失敗など | Edge に接続できませんでした。設定で自動起動を有効にするか、手動で起動してから再試行してください。 |
| `NOT_LOGGED_IN` | 接続後または遷移後の URL に `login` または `signin` が含まれ、Copilot 画面ではなくログイン画面にいると判定されたとき | M365 Copilot にログインしていません。Edge で M365 にログインしてから再試行してください。 |
| `RESPONSE_TIMEOUT` | `waitForResponse()` と DOM ポーリングの両方で有効な応答文字列を得られなかったとき | Copilot の応答待機がタイムアウトしました。手動でコピー＆ペーストしてください。 |
| `COPILOT_ERROR` | 応答本文が既知の Copilot エラーパターンに一致し、最大リトライ回数を超えても正常応答にならなかったとき | Copilot がエラーを返しました。手動でコピー＆ペーストしてください。 |
| `SEND_FAILED` | 入力 JSON 不正、送信 UI 要素未検出、stdout JSON parse 失敗、Tauri shell 起動失敗など、上記以外の送信失敗時 | プロンプトの送信に失敗しました。手動でコピー＆ペーストしてください。 |

UI 側では [`apps/desktop/src/lib/copilot-browser.ts`](/workspace/relay-agent-main/apps/desktop/src/lib/copilot-browser.ts) の `COPILOT_ERROR_MESSAGES` と `getCopilotBrowserErrorMessage()` が最終表示文言を決定します。

## 8. セレクタと API エンドポイント（要実環境確認）

現在の値はすべてプレースホルダで、まだ実環境確認は終わっていません。

| 定数名 | 現在の値 | 確認済み |
|---|---|---|
| `NEW_CHAT_SELECTOR` | `[data-testid="newChatButton"]` | 未確認 |
| `EDITOR_SELECTOR` | `#m365-chat-editor-target-element` | 未確認 |
| `SEND_READY_SEL` | `.fai-SendButton:not([disabled])` | 未確認 |
| `RESPONSE_SEL` | `[data-testid="markdown-reply"]` | 未確認 |
| `API_URL_PATTERN` | `/sydney/conversation` | 未確認 |

確認方法:

1. Edge を CDP モードで起動する
2. M365 Copilot Chat にログインする
3. `npx playwright codegen --browser=chromium http://localhost:9333` でセレクタを録画する
4. DevTools の Network タブでレスポンス API エンドポイントを確認する
5. `apps/desktop/scripts/copilot-browser.ts` の定数を更新し、再ビルドする

## 9. ビルドコマンド

```bash
pnpm --filter @relay-agent/desktop copilot-browser:build
```

このコマンドは esbuild で `apps/desktop/scripts/copilot-browser.ts` を `apps/desktop/scripts/dist/copilot-browser.js` へ変換します。現在の build 設定は `--format=esm --packages=external` で、アプリの `"type": "module"` と Playwright の Node 依存解決に合わせています。
