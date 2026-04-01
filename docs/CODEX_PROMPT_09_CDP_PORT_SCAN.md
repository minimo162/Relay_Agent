# Codex プロンプト 09 — CDP ポート自動探索 & Edge 自動起動（Tasks 104〜108）

## 対象タスク

- **Task 104**: ポート探索ユーティリティ（isPortFree / findAvailableCdpPort / findExistingCdpEdge）
- **Task 105**: Edge 自動起動（launchEdgeWithCdp / waitForCdpReady / ensureCdpEdge）
- **Task 106**: connectToBrowser 拡張（自動/手動モード分岐 + フロントエンド引数追加）
- **Task 107**: 設定スキーマ更新（autoLaunchEdge フラグ & デフォルトポート変更 & UI トグル）
- **Task 108**: 送信中ステータス表示 & エラーメッセージ拡充

## 概要

現状の CDP 接続は「ユーザーが手動で Edge を起動 → アプリが単一ポートに接続」という方式。
これを「アプリが空きポートを自動探索 → Edge を自動起動 → 接続」に進化させる。

**ポート探索範囲**: 9333–9342（10 ポート固定）

**基本方針:**
- 既に CDP モードの Edge が探索範囲内で動いていれば、それに接続（二重起動しない）
- 空きポートが見つかれば Edge を自動起動して接続
- `autoLaunchEdge` フラグで従来の手動モードに切り替え可能
- 既存のロジック（send / connect アクション、レスポンスキャプチャ）は変更しない

## 前提

- `apps/desktop/scripts/copilot-browser.ts` — Node.js スクリプト（Playwright 接続・送信）
- `apps/desktop/src/lib/copilot-browser.ts` — フロントエンドラッパー（Tauri shell 経由で Node スクリプト起動）
- `apps/desktop/src/lib/continuity.ts` — 設定の永続化（BrowserAutomationSettings）
- `apps/desktop/src/lib/error-messages.ts` — ユーザーフレンドリーエラーマッピング（Task 102 で追加済み）
- `apps/desktop/src/routes/+page.svelte` — 単一ページアプリの全体
- Windows 環境。`msedge.exe` はシステム PATH に存在する前提

---

## Task 104: ポート探索ユーティリティ

### 実装場所

`apps/desktop/scripts/copilot-browser.ts` — ファイル先頭付近の定数定義と、新規関数

### 実装内容

**定数追加:**

```typescript
import net from "net";

const CDP_PORT_RANGE_START = 9333;
const CDP_PORT_RANGE_END = 9342; // inclusive — 10 ports
```

**`isPortFree(port)` — TCP プローブでポートの空き/占有を判定:**

```typescript
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: "127.0.0.1" });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(true); // タイムアウト = 何も listen していない
    }, 1000);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(false); // 接続成功 = 占有済み
    });
    sock.once("error", () => {
      clearTimeout(timer);
      resolve(true); // ECONNREFUSED 等 = 空き
    });
  });
}
```

**`findExistingCdpEdge()` — 探索範囲内の既存 CDP Edge を検出:**

```typescript
async function findExistingCdpEdge(): Promise<number | null> {
  for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return port;
    } catch {
      // not listening
    }
  }
  return null;
}
```

**`findAvailableCdpPort()` — 最初の空きポートを返す:**

```typescript
async function findAvailableCdpPort(): Promise<number> {
  for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port++) {
    if (await isPortFree(port)) return port;
  }
  throw createError(
    "CDP_UNAVAILABLE",
    `ポート ${CDP_PORT_RANGE_START}–${CDP_PORT_RANGE_END} がすべて使用中です。他のアプリケーションを終了してから再試行してください。`
  );
}
```

### 注意事項

- `isPortFree` はソケットの `connect` イベントで占有判定し、`error`（ECONNREFUSED 含む）で空き判定する
- タイムアウト 1000ms はセーフティネット（通常は ECONNREFUSED が即座に返る）
- `createError` は既存のヘルパー関数を使用（ファイル内の同名関数を確認）
- `findExistingCdpEdge` は `/json/version` エンドポイントで CDP の存在を HTTP レベルで確認する（TCP ポートが開いているだけでは CDP とは限らない）

---

## Task 105: Edge 自動起動

### 実装場所

`apps/desktop/scripts/copilot-browser.ts` — Task 104 の関数の後に追加

### 実装内容

**`launchEdgeWithCdp(port)` — Edge を CDP モードで起動:**

```typescript
import { execFile } from "child_process";

function launchEdgeWithCdp(port: number): void {
  const child = execFile(
    "msedge.exe",
    [`--remote-debugging-port=${port}`, "--no-first-run"],
    { detached: true, stdio: "ignore" } as any
  );
  child.unref(); // Node プロセスから切り離し、Edge はバックグラウンドで動作
}
```

**`waitForCdpReady(port, opts)` — CDP リスナー起動完了をポーリング待機:**

```typescript
async function waitForCdpReady(
  port: number,
  opts: { maxWaitMs: number; intervalMs: number }
): Promise<void> {
  const deadline = Date.now() + opts.maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  throw createError(
    "CDP_UNAVAILABLE",
    `Edge は起動しましたが CDP がポート ${port} で応答しません（${opts.maxWaitMs}ms 超過）。`
  );
}
```

**`ensureCdpEdge()` — 検出 → 起動 → 待機の統合フロー:**

```typescript
async function ensureCdpEdge(): Promise<number> {
  // 1. 既存の CDP Edge を探す
  const existing = await findExistingCdpEdge();
  if (existing !== null) {
    logProgress("existing_edge", `既存の Edge を検出（ポート ${existing}）`);
    return existing;
  }

  // 2. 空きポートを見つけて Edge を起動
  logProgress("port_scan", "空きポートを探索中…");
  const port = await findAvailableCdpPort();
  logProgress("launching_edge", `Edge を起動中（ポート ${port}）…`);
  launchEdgeWithCdp(port);
  await waitForCdpReady(port, { maxWaitMs: 5000, intervalMs: 500 });
  logProgress("edge_ready", `Edge 起動完了（ポート ${port}）`);
  return port;
}
```

**進行ログ出力 `logProgress()`:**

```typescript
function logProgress(step: string, message: string): void {
  // stderr に JSON lines で出力（stdout は最終結果専用）
  process.stderr.write(JSON.stringify({ type: "progress", step, message }) + "\n");
}
```

### 注意事項

- `execFile` の第3引数に `detached: true` と `stdio: "ignore"` を渡し、Edge プロセスをデタッチする
- `child.unref()` で Node.js が Edge の終了を待たないようにする
- `fetch` は Node.js 18+ のグローバル fetch を使用（Playwright 同梱の Node.js で利用可能）
- progress ログは stdout ではなく **stderr** に出力する（stdout は最終結果 JSON 専用）

---

## Task 106: connectToBrowser 拡張（自動/手動モード分岐）

### 実装場所

- `apps/desktop/scripts/copilot-browser.ts` — `connectToBrowser()` と CLI パーサー
- `apps/desktop/src/lib/copilot-browser.ts` — `runBrowserCommand()`

### CLI オプション追加

既存の `CliOptions` 型に `autoLaunch` を追加:
```typescript
interface CliOptions {
  action: "connect" | "send";
  cdpPort: number;
  timeout: number;
  prompt?: string;
  autoLaunch: boolean; // 追加
}
```

CLI パーサー（`parseArgs` 等）に `--auto-launch` フラグを追加。デフォルト `false`。

### connectToBrowser の変更

```typescript
async function connectToBrowser(
  options: Pick<CliOptions, "cdpPort" | "autoLaunch">
): Promise<Browser> {
  let port = options.cdpPort;

  if (options.autoLaunch) {
    port = await ensureCdpEdge();
  }

  try {
    return await chromium.connectOverCDP(`http://localhost:${port}`);
  } catch (error) {
    throw createError(
      "CDP_UNAVAILABLE",
      `Failed to connect to Edge on CDP port ${port}: ${describeError(error)}`
    );
  }
}
```

### 呼び出し元の変更

`handleConnect()` と `handleSend()` は変更不要（`connectToBrowser` の引数型が拡張されるだけ）。
ただし結果 JSON に実際に使用したポート番号を含めたい場合は、`connectToBrowser` の戻り値を
`{ browser: Browser; port: number }` に変更し、呼び出し元で分割代入する。

### フロントエンド側 `runBrowserCommand()` の変更

`apps/desktop/src/lib/copilot-browser.ts` の `runBrowserCommand()`:

```typescript
const args = [
  scriptPath,
  "--action", action,
  "--cdp-port", String(settings.cdpPort),
  "--timeout", String(settings.timeoutMs),
  ...(settings.autoLaunchEdge ? ["--auto-launch"] : []),
  ...(payload ? ["--prompt", payload.prompt] : [])
];
```

**stderr の progress イベント処理:**

`command.stderr.on("data", ...)` 内で JSON lines 形式の progress イベントを
パースしてフロントエンドに伝播（Task 108 のステータス表示で使用）:

```typescript
command.stderr.on("data", (chunk) => {
  for (const line of String(chunk).split("\n").filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "progress" && onProgress) {
        onProgress(parsed);
        continue;
      }
    } catch {
      // not JSON — normal stderr log
    }
    stderr += line;
    console.warn("[copilot-browser] stderr:", line);
  }
});
```

---

## Task 107: 設定スキーマ & UI 更新

### 実装場所

- `apps/desktop/src/lib/continuity.ts` — 設定型とデフォルト値
- `apps/desktop/src/routes/+page.svelte` — 設定モーダル

### continuity.ts の変更

```typescript
const DEFAULT_BROWSER_AUTOMATION_SETTINGS = {
  cdpPort: 9333,           // 9222 → 9333 に変更
  autoLaunchEdge: true,    // 新規追加
  timeoutMs: 60000,
  agentLoopEnabled: false,
  maxTurns: 10,
  loopTimeoutMs: 120000,
} as const;
```

`loadBrowserAutomationSettings()` でのマイグレーション:

```typescript
// 既存の load ロジック内
const settings = { ...DEFAULT_BROWSER_AUTOMATION_SETTINGS, ...stored };
// autoLaunchEdge が undefined（既存ユーザー）なら true にフォールバック
if (typeof settings.autoLaunchEdge !== "boolean") {
  settings.autoLaunchEdge = true;
}
```

注意: 既存ユーザーの `cdpPort: 9222` を強制上書きしない。`autoLaunchEdge: true` なら cdpPort は使われないため問題ない。

### 設定モーダル（`+page.svelte`）

CDP ポート入力欄の上に `autoLaunchEdge` トグルを追加:

```svelte
<div class="auto-launch-toggle" class:auto-launch-on={browserSettings.autoLaunchEdge}>
  <div class="auto-launch-info">
    <span class="auto-launch-icon">🚀</span>
    <div>
      <div class="auto-launch-title">Edge を自動で起動する</div>
      <div class="auto-launch-desc">
        {#if browserSettings.autoLaunchEdge}
          空きポート（9333–9342）を自動探索して Edge を起動します（推奨）
        {:else}
          手動で Edge を CDP モード起動してください
        {/if}
      </div>
    </div>
  </div>
  <button
    class="auto-launch-switch"
    class:auto-launch-switch-on={browserSettings.autoLaunchEdge}
    role="switch"
    aria-checked={browserSettings.autoLaunchEdge}
    on:click={() => { browserSettings.autoLaunchEdge = !browserSettings.autoLaunchEdge; }}
  >
    <span class="auto-launch-thumb"></span>
  </button>
</div>
```

`autoLaunchEdge=true` の場合:
- CDP ポート入力欄を `disabled` にし、プレースホルダー「自動選択（9333–9342）」表示
- CDP セットアップガイド（Task 98）をデフォルト閉じにする（自動モードではガイド不要）

`autoLaunchEdge=false` の場合:
- 従来どおりポート番号を手動入力可能
- CDP セットアップガイドはデフォルト開き

CSS は既存の `.loop-toggle-*` スタイルと同じパターン（`auto-launch-*` プレフィックス）で作成。

---

## Task 108: 送信中ステータス表示 & エラーメッセージ拡充

### 実装場所

- `apps/desktop/src/lib/copilot-browser.ts` — progress コールバック型定義 & stderr 解析
- `apps/desktop/src/lib/error-messages.ts` — エラーマッピング追加
- `apps/desktop/src/routes/+page.svelte` — ステータス表示

### progress コールバック型

```typescript
// copilot-browser.ts (lib)
export type CdpProgressEvent = {
  type: "progress";
  step: "port_scan" | "existing_edge" | "launching_edge" | "edge_ready";
  message: string;
};

export type CdpProgressCallback = (event: CdpProgressEvent) => void;
```

`sendToCopilot()` と `checkCopilotConnection()` にオプショナルな `onProgress` パラメータを追加:

```typescript
export async function sendToCopilot(
  prompt: string,
  options?: { onProgress?: CdpProgressCallback }
): Promise<string> { ... }
```

### ステータス表示（`+page.svelte`）

自動送信中のスピナー表示部分に、progress ステップに応じたメッセージを表示:

```svelte
{#if isSending}
  <div class="send-status">
    <span class="spinner">⟳</span>
    <span class="send-status-text">{cdpProgress ?? 'Copilot に送信中…'}</span>
  </div>
{/if}
```

```typescript
let cdpProgress: string | null = null;

// sendToCopilot 呼び出し時
await sendToCopilot(prompt, {
  onProgress: (ev) => { cdpProgress = ev.message; }
});
cdpProgress = null;
```

### エラーメッセージ追加（`error-messages.ts`）

既存の ERROR_MAP に以下を追加:

```typescript
{
  pattern: /ポート 9333.*すべて使用中|All CDP ports.*in use/i,
  result: {
    icon: '🔌',
    message: 'ポート 9333–9342 がすべて使用中です。',
    hint: '他のアプリケーション（DevTools 等）を終了してから再試行してください'
  }
},
{
  pattern: /Edge.*起動.*CDP.*応答しません|Edge launched but CDP did not respond/i,
  result: {
    icon: '⏱',
    message: 'Edge は起動しましたが CDP 接続が確立できませんでした。',
    hint: 'しばらく待ってから再試行してください。解消しない場合は Edge を再起動してください'
  }
},
{
  pattern: /ENOENT.*msedge|msedge.*not found/i,
  result: {
    icon: '🌐',
    message: 'Edge が見つかりません。',
    hint: 'Microsoft Edge がインストールされているか確認してください'
  }
}
```

---

## 実装順序

Tasks を以下の順で実装する（依存関係順）:

1. **Task 107** — 設定スキーマ変更（他のタスクが参照する `autoLaunchEdge` の土台）
2. **Task 104** — ポート探索ユーティリティ（純粋関数、独立して実装可能）
3. **Task 105** — Edge 自動起動（Task 104 の関数を使用）
4. **Task 106** — connectToBrowser 統合（Task 104 + 105 を統合、フロントエンド連携）
5. **Task 108** — UI ステータス表示 & エラーメッセージ（仕上げ）

## 注意事項

- `copilot-browser.ts`（scripts）は Node.js 環境で動作する。`net` モジュール、`child_process` モジュールが使用可能
- `copilot-browser.ts`（src/lib）はブラウザ（WebView）環境で動作する。Node.js API は使用不可
- stdout は最終結果 JSON 専用。途中の進行ログは **stderr** に JSON lines 形式で出力する
- esbuild バンドル時に `net` と `child_process` が external として扱われることを確認（`--platform=node` で自動的に Node.js ビルトインは除外される）
- 既存の `--action connect` / `--action send` のインタフェースは変更しない（`--auto-launch` はオプショナルフラグとして追加）
- Edge のパスは `msedge.exe`（Windows PATH に存在する前提）。フルパス指定は非ゴール
- `autoLaunchEdge=false` 時は Task 106 以前と完全に同じ動作であること
- `connectToBrowser` の戻り値変更はブレイキングチェンジ — 呼び出し元すべてを更新すること

## 検証チェックリスト

- [ ] `pnpm --filter @relay-agent/desktop typecheck` が成功する
- [ ] `pnpm --filter @relay-agent/desktop copilot-browser:build` が成功する
- [ ] `autoLaunchEdge=true` で Edge 未起動 → 自動起動 → Copilot 接続成功
- [ ] `autoLaunchEdge=true` で Edge が既に CDP 起動済み → 二重起動せず既存に接続
- [ ] ポート 9333 が他アプリに占有 → 9334 以降で自動起動
- [ ] 全ポート（9333–9342）占有 → ユーザーフレンドリーなエラーメッセージ
- [ ] `autoLaunchEdge=false` → 従来の手動接続が正常に動作
- [ ] 設定モーダルで `autoLaunchEdge` ON/OFF → ポート入力欄の有効/無効切替
- [ ] 送信中に「空きポートを探索中…」→「Edge を起動中…」→「接続しました」が段階表示
- [ ] 既存ユーザーの設定ファイルに `autoLaunchEdge` がなくても `true` にフォールバック
- [ ] Edge がインストールされていない環境でわかりやすいエラーが出る
