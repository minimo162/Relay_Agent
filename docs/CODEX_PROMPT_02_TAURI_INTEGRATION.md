# Codex Prompt 02 — Tauri 統合・UI・設定・エラーハンドリング（Tasks 79〜82）

> **実行条件:** CODEX_PROMPT_01 完了 + 実環境でのセレクタ確認（手動）完了後に実行する。
> **前提:** `apps/desktop/scripts/dist/copilot-browser.js` が存在していること。

---

```xml
<task>
Relay Agent リポジトリ（カレントディレクトリ）に対して、
scripts/dist/copilot-browser.js（実装済み）を Tauri アプリから呼び出す
統合レイヤーと UI を実装する。

## 実装対象
- Task 79: Tauri shell plugin 設定 + lib/copilot-browser.ts
- Task 80: +page.svelte にステップ2の「Copilotに自動送信」ボタン追加
- Task 81: 設定モーダルに「Copilot ブラウザ自動化」セクション追加
- Task 82: エラーコード別の日本語メッセージ

## 関連ファイル（実装前に必ず読むこと）

- apps/desktop/src/routes/+page.svelte        （メイン UI・ステップ2のパターンを把握）
- apps/desktop/src/lib/ipc.ts                 （IPC ラッパーの規約を把握）
- apps/desktop/src-tauri/tauri.conf.json      （capabilities 設定の実際の形式を確認）
- apps/desktop/src-tauri/capabilities/        （ディレクトリ存在確認・形式確認）
- packages/contracts/src/ipc.ts              （既存スキーマの形式を把握）

設定永続化の実際の実装は persistence.rs または既存の設定ストア実装を確認してから
同じ方式に合わせること。

## Task 79: Tauri shell plugin 設定と IPC ラッパー

### Step 1: Tauri capabilities への shell 許可追加

tauri.conf.json または capabilities/ ディレクトリの実際の構造を確認し、
node コマンドの実行許可を適切な形式で追加する。

許可内容:
- コマンド: node
- args: true（可変引数を許可）

### Step 2: packages/contracts/src/ipc.ts への型追加

既存ファイルの末尾に追記する（既存スキーマの形式・import に合わせること）:

  export const CopilotBrowserErrorCodeSchema = z.enum([
    'CDP_UNAVAILABLE',
    'NOT_LOGGED_IN',
    'RESPONSE_TIMEOUT',
    'COPILOT_ERROR',
    'SEND_FAILED',
  ]);
  export type CopilotBrowserErrorCode =
    z.infer<typeof CopilotBrowserErrorCodeSchema>;

  export const CopilotBrowserResultSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), response: z.string() }),
    z.object({
      status: z.literal('error'),
      errorCode: CopilotBrowserErrorCodeSchema,
      message: z.string(),
    }),
  ]);
  export type CopilotBrowserResult =
    z.infer<typeof CopilotBrowserResultSchema>;

### Step 3: apps/desktop/src/lib/copilot-browser.ts を新規作成

@tauri-apps/plugin-shell の Command を使って
scripts/dist/copilot-browser.js を呼び出す。

エクスポートするインタフェース:

  // scripts/dist/copilot-browser.js の --action send を呼び出す。
  // 成功時: レスポンス文字列を返す。
  // 失敗時: { errorCode: CopilotBrowserErrorCode, message: string } を含む
  //         CopilotBrowserError をスローする。
  export async function sendToCopilot(prompt: string): Promise<string>

  // scripts/dist/copilot-browser.js の --action connect を呼び出す。
  // 成功時: void。
  // 失敗時: CopilotBrowserError をスロー。
  export async function checkCopilotConnection(): Promise<void>

実装上の注意:
- scripts/dist/copilot-browser.js のパスは開発時は相対パス、
  本番時は Tauri のリソースパスで解決する。
  既存コードに類似のパス解決があれば同じ方式を使うこと。
- cdpPort と timeoutMs は設定ストアから取得する。
  設定ストアの実際の API は既存実装を読んで合わせること。
  設定がなければデフォルト値（cdpPort: 9222、timeoutMs: 60000）を使う。
- stdout の JSON を CopilotBrowserResultSchema で parse する。
  parse 失敗時は SEND_FAILED エラーとして扱う。

## Task 80: +page.svelte にボタン追加

ステップ2（「Copilot に聞く」セクション）の「依頼をコピー」ボタンの隣に
「Copilotに自動送信 ▶」ボタンを追加する。

**追加する状態変数:**

  let isSendingToCopilot = false;
  let copilotAutoError: string | null = null;

**ボタン押下時のフロー:**
1. isSendingToCopilot = true、copilotAutoError = null
2. sendToCopilot(relayPrompt) を呼び出す
   ※ relayPrompt は既存のステップ2で使われている変数名に合わせること
3. 成功: copilotResponse（テキストエリアの変数）に結果をセット
         isSendingToCopilot = false
4. 失敗: copilotAutoError に Task 82 の日本語メッセージをセット
         isSendingToCopilot = false

**UI 要件:**
- 送信中はスピナーを表示（+page.svelte の既存スピナーパターンに合わせる）
- エラー時はステップ2内にインライン表示（既存エラー表示スタイルに準拠）
- エラーメッセージの下に「手動入力に切り替え」リンクを表示し、
  クリックするとテキストエリアにフォーカスが当たるようにする
- 「依頼をコピー」ボタンは削除しない（フォールバック用）
- 独自 CSS クラスを増やさず、既存の CSS 変数・スタイルを流用する

## Task 81: 設定モーダルに「Copilot ブラウザ自動化」セクション追加

+page.svelte の設定モーダルに「Copilot ブラウザ自動化」セクションを追加する。
設定モーダルの実際の構造は +page.svelte を読んで把握してから実装すること。

**追加する設定項目:**
- CDP ポート（number input、default: 9222）
- タイムアウト（ms、number input、default: 60000）

**Edge 起動コマンドコピーボタン:**
以下の文字列をクリップボードにコピーするボタンを追加する:
  msedge.exe --remote-debugging-port={cdpPort} --no-first-run

**永続化:**
cdpPort と timeoutMs を既存の設定永続化の仕組みと同じ方式で保存・読み込みする。
persistence.rs または既存の設定ストアの実装を読んでから実装すること。

## Task 82: エラーコード別の日本語メッセージ

lib/copilot-browser.ts または +page.svelte に以下のマップを定義する:

  const COPILOT_ERROR_MESSAGES: Record<CopilotBrowserErrorCode, string> = {
    CDP_UNAVAILABLE:
      'Edge が CDP モードで起動していません。' +
      '設定の「起動コマンドをコピー」で Edge を起動してから再試行してください。',
    NOT_LOGGED_IN:
      'M365 Copilot にログインしていません。' +
      'Edge で M365 にログインしてから再試行してください。',
    RESPONSE_TIMEOUT:
      'Copilot の応答待機がタイムアウトしました。' +
      '手動でコピー＆ペーストしてください。',
    COPILOT_ERROR:
      'Copilot がエラーを返しました。手動でコピー＆ペーストしてください。',
    SEND_FAILED:
      'プロンプトの送信に失敗しました。手動でコピー＆ペーストしてください。',
  };

Task 80 のエラー表示でこのマップを参照すること。
</task>

<default_follow_through_policy>
既存コードのパターンを必ず読んでから同じ規約に合わせること。
推測で新しいパターンを作らない。
tauri.conf.json と capabilities の実際の構造を確認してから変更すること。
設定永続化の既存実装を確認してから同じ方式を使うこと。
</default_follow_through_policy>

<completeness_contract>
以下がすべて通るまで完了としない:
1. pnpm --filter @relay-agent/desktop typecheck
2. pnpm --filter @relay-agent/contracts typecheck
3. cargo check（src-tauri 側の変更がある場合）
型エラーがあれば修正してから報告すること。
</completeness_contract>

<verification_loop>
最終化する前に確認:
1. 上記ビルドコマンドがすべてエラーなしで通ること
2. +page.svelte のステップ2に「Copilotに自動送信」ボタンが存在すること
3. 設定モーダルに「Copilot ブラウザ自動化」セクションが存在すること
4. エラーコードごとに日本語メッセージが返るパスがコード上で確認できること
5. 「手動入力に切り替え」リンクのフォーカス処理が実装されていること
</verification_loop>

<missing_context_gating>
以下は推測せずファイルを読んで確認すること:
- 設定永続化の既存 API
- Tauri capabilities の実際のファイル形式・場所
- +page.svelte の既存エラー表示パターン・スピナーパターン
- テキストエリアと relayPrompt に対応する実際の変数名
</missing_context_gating>

<action_safety>
変更範囲:
- apps/desktop/src/lib/copilot-browser.ts（新規）
- apps/desktop/src/routes/+page.svelte（ステップ2セクションと設定モーダルのみ）
- apps/desktop/src-tauri/capabilities/ または tauri.conf.json（shell 許可のみ）
- packages/contracts/src/ipc.ts（末尾追記のみ）
- 設定永続化に必要な最小限の変更（既存方式に合わせる）

触らないもの:
- auto-fix.ts / continuity.ts（既存ロジック）
- relay.rs / execution.rs / session.rs 等 Rust コアロジック
- contracts の既存スキーマ定義（追記のみ許可）
</action_safety>

<structured_output_contract>
完了後に以下を返すこと:
1. 作成・変更したファイルと変更概要
2. ビルド確認コマンドと結果
3. 実環境でのみ確認できる動作（Task 83 E2E 部分）のリスト
</structured_output_contract>
```

---

## 完了後の手動作業（Task 83: E2E 検証）

1. Edge を CDP モードで起動し M365 Copilot Chat にログイン
2. Relay Agent を起動（`pnpm --filter @relay-agent/desktop tauri:dev`）
3. ステップ1でサンプル CSV（`examples/revenue-workflow-demo.csv`）を選択して「準備する」
4. ステップ2の「Copilotに自動送信 ▶」ボタンを押して動作を確認
5. レスポンスがテキストエリアに自動入力されたら「確認する」→「保存する」まで完走
6. 結果を `docs/BROWSER_AUTOMATION_VERIFICATION.md` に記録する
