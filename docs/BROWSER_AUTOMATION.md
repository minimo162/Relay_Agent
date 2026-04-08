# Browser Automation

## 1. 概要

Relay Agent のブラウザ自動化機能は、ステップ2の「Copilot に聞く」で行っていた手動中継を短縮するためのものです。ユーザーが Edge 上で M365 Copilot Chat にログイン済みであることを前提に、Relay Agent が生成した依頼文をそのまま Copilot へ送信し、返ってきた応答をステップ2のテキストエリアへ自動セットします。

採用技術は Playwright TypeScript と Edge CDP 接続です。Node/Playwright の本体スクリプトは維持しつつ、起動と progress relay は Tauri backend command から行います。選定理由は次の3点です。

- デスクトップ側がすでに TypeScript と Node ベースの構成なので、同一スタックで実装できる
- 専用の常駐ブラウザプロセスや別ランタイムをアプリ本体に追加せず、既存の Node 実行で完結できる
- `page.waitForResponse()` を使ったネットワーク応答キャプチャと DOM フォールバックを組み合わせられ、応答取得の失敗点を分離しやすい

## 2. 全体フロー図

```text
[ステップ2 UI] 「Copilotに自動送信」ボタン押下
    ↓
[lib/copilot-browser.ts] sendToCopilot(prompt)
    ↓  invoke('send_copilot_prompt', { prompt, settings, progressEventId })
[src-tauri/browser_automation.rs] node scripts/dist/copilot-browser.js --action send ...
    ↓  progress を Tauri event で UI へ relay
[scripts/copilot-browser.ts] --action send
    ↓  `--auto-launch`: プロファイルの DevToolsActivePort / 既存 Edge を優先（`copilot_server` は基底 **9360** から 20 ポートをスキャン = **9360–9379**）
    ↓  chromium.connectOverCDP('http://localhost:{resolvedCdpPort}')
[Edge（ユーザーのログイン済みブラウザ）]
    ↓  page.goto() → newChatButton.click() → fill(prompt) → send
[M365 Copilot Chat API]
    ↓  waitForResponse(API_URL_PATTERN) または DOM ポーリング
[scripts/copilot-browser.ts] { status: 'ok', response: '...' } を stdout に JSON 出力
    ↓
[src-tauri/browser_automation.rs] stdout をパース → IPC 応答へ変換
    ↓
[lib/copilot-browser.ts] レスポンス文字列を返す
    ↓
[ステップ2 UI] テキストエリアに自動セット
```

補足:

- UI では [`apps/desktop/src/routes/+page.svelte`](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) の `handleCopilotAutoSend()` が `sendToCopilot(copilotInstructionText)` を呼びます。
- 実際の Node スクリプト起動は [`apps/desktop/src-tauri/src/browser_automation.rs`](/workspace/relay-agent-main/apps/desktop/src-tauri/src/browser_automation.rs) の Tauri command が担い、frontend は IPC と progress event の購読だけを行います。

## 3. ファイル構成

| ファイル | 役割 |
|---|---|
| [apps/desktop/scripts/copilot-browser.ts](/workspace/relay-agent-main/apps/desktop/scripts/copilot-browser.ts) | Playwright ベースの本体。`--action connect` / `send` / `inspect` を実装し、CDP 接続、Copilot 画面遷移、送信、応答キャプチャ、診断 JSON 出力を担当する |
| [apps/desktop/scripts/dist/copilot-browser.js](/workspace/relay-agent-main/apps/desktop/scripts/dist/copilot-browser.js) | `copilot-browser.ts` を esbuild でビルドした実行対象。Tauri backend からこのファイルを `node` で呼び出す |
| [apps/desktop/src-tauri/src/browser_automation.rs](/workspace/relay-agent-main/apps/desktop/src-tauri/src/browser_automation.rs) | Node スクリプト起動、script path 解決、progress event relay、stdout JSON parse、IPC command 公開を担当する |
| [apps/desktop/src/lib/copilot-browser.ts](/workspace/relay-agent-main/apps/desktop/src/lib/copilot-browser.ts) | Tauri IPC/event ラッパー。`sendToCopilot()` と `checkCopilotConnection()` を公開し、UI 向けエラーマッピングを担当する |
| [packages/contracts/src/ipc.ts](/workspace/relay-agent-main/packages/contracts/src/ipc.ts) | browser automation request/response schema と progress payload を持ち、ブラウザ自動化の IPC shape を型で固定する |
| [apps/desktop/src/lib/continuity.ts](/workspace/relay-agent-main/apps/desktop/src/lib/continuity.ts) | `BrowserAutomationSettings` を `localStorage` に永続化する。保存キーは `relay-agent.continuity.v1` |
| [apps/desktop/src/routes/+page.svelte](/workspace/relay-agent-main/apps/desktop/src/routes/+page.svelte) | ステップ2の `Copilotに自動送信 ▶` ボタン、インラインエラー、`手動入力に切り替え` リンク、設定モーダルを提供する |
| [apps/desktop/src-tauri/capabilities/default.json](/workspace/relay-agent-main/apps/desktop/src-tauri/capabilities/default.json) | ブラウザからの任意 shell spawn は不要になり、引き続き `shell:allow-open` だけを許可する |

## 4. Edge の CDP 起動手順（初回セットアップ）

設定モーダルでは `autoLaunchEdge` が既定で有効になっており、送信時に **既存の Relay プロファイル上の CDP**（`DevToolsActivePort` 等）を優先して接続します。`copilot_server.js` 経路では基底 **9360** から **9360–9379** の範囲をスキャンして既存リスナーを探し、必要なら Edge を起動します。

手動で起動したい場合は、「起動コマンドをコピー」ボタンから次の形式のコマンドをコピーできます。

```bash
msedge.exe --remote-debugging-port=9360 --no-first-run
```

`autoLaunchEdge` を無効にした場合のみ、設定した `cdpPort` に直接接続します。

CDP モードが必要な理由は、Relay Agent が新しいブラウザプロファイルを立ち上げるのではなく、ユーザーがすでにログイン済みの Edge セッションへ接続するためです。これにより M365 認証を別実装せずに、Copilot Chat ページへ到達できます。

## 5. 設定項目

| 設定項目 | デフォルト値 | 変更場所 | 説明 |
|---|---|---|---|
| `autoLaunchEdge` | `true` | 設定モーダル | 既存 CDP（プロファイル／`copilot_server` のスキャン）を優先し、必要なら Edge を自動起動する |
| `cdpPort` | `9360` | 設定モーダル | `autoLaunchEdge` が無効なときの手動 CDP ポート（Relay 既定; YakuLingo 等と併用時は **9333** 回避のため **9360**） |
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

## 8. 診断モード

Task `76.2` と `76.3` の実環境確認を補助するため、`copilot-browser.ts` には `--action inspect` を追加しています。これは現在のページで見えているセレクタ候補、レスポンス本文の DOM 候補、送信時に観測したレスポンス URL 候補を JSON でまとめて返します。

セレクタ確認だけを行う場合:

```bash
node apps/desktop/scripts/dist/copilot-browser.js --action inspect --auto-launch
```

セレクタ確認に加えて API パターン候補も採取する場合:

```bash
node apps/desktop/scripts/dist/copilot-browser.js --action inspect --auto-launch --prompt "Reply with exactly OK and nothing else."
```

戻り値には次が含まれます。

- `selectorProbes`: 新規チャット、入力欄、送信ボタン、`role=textbox` の件数と可視状態
- `responseSelectorProbes`: DOM フォールバック候補ごとの件数、可視状態、サンプル本文
- `sendProbe.observedResponses`: 送信中に観測した Copilot 関連レスポンス URL、status、content-type
- `sendProbe.usedSelectors`: 実際に送信で採用したセレクタ
- `suggestedApiPatterns`: 実観測から抽出した API パス候補

このモードは task close の代替ではありませんが、手作業で DevTools を追う前に現状を機械的に採取できます。

## 9. セレクタと API エンドポイント（要実環境確認）

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
3. `node apps/desktop/scripts/dist/copilot-browser.js --action inspect --auto-launch --prompt "Reply with exactly OK and nothing else."` を実行して候補を採取する
4. 必要に応じて `npx playwright codegen --browser=chromium http://localhost:9360`（実際の CDP ポートに合わせる）と DevTools の Network タブで候補を裏取りする
5. `apps/desktop/scripts/copilot-browser.ts` の定数を更新し、再ビルドする

## 10. ビルドコマンド

```bash
pnpm --filter @relay-agent/desktop copilot-browser:build
```

このコマンドは esbuild で `apps/desktop/scripts/copilot-browser.ts` を `apps/desktop/scripts/dist/copilot-browser.js` へ変換します。現在の build 設定は `--format=esm --packages=external` で、アプリの `"type": "module"` と Playwright の Node 依存解決に合わせています。
