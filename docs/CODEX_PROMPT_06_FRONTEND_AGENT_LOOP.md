# Codex プロンプト 06 — フロントエンド エージェントループ（Tasks 87・88・89・92）

## 対象タスク

- **Task 87**: `lib/agent-loop.ts` — ツール実行結果のプロンプト生成
- **Task 88**: `+page.svelte` — エージェントループ進行状態 UI
- **Task 89**: `lib/agent-loop.ts` — `runAgentLoop()` 多ターン制御
- **Task 92**: 設定モーダル — エージェントループ設定（maxTurns・timeout・モード）

## 前提条件

- Task 85 の Contracts 変更（`status` フィールド・`AgentLoopStatus`）完了
- Task 86 の `execute_read_actions` IPC コマンド完了
- `pnpm --filter @relay-agent/desktop check` が通っていること

---

## コンテキスト

### 既存の関連ファイル

```
apps/desktop/src/
  routes/+page.svelte      ← メイン UI（3ステップフロー）
  lib/
    ipc.ts                 ← Tauri IPC ラッパー（invoke 型付き呼び出し）
    copilot-browser.ts     ← sendToCopilot() / checkCopilotConnection()
    continuity.ts          ← loadBrowserAutomationSettings() / 設定永続化
    auto-fix.ts            ← Copilot JSON 自動補正
```

### 既存の設定型（`continuity.ts`）

```typescript
export type BrowserAutomationSettings = {
  cdpPort: number;
  timeoutMs: number;
};
export function loadBrowserAutomationSettings(): BrowserAutomationSettings
export function saveBrowserAutomationSettings(settings: BrowserAutomationSettings): void
```

---

## Task 87・89: `lib/agent-loop.ts` を新規作成

```typescript
// apps/desktop/src/lib/agent-loop.ts

import { sendToCopilot } from "./copilot-browser";
import { executeReadActions } from "./ipc";
import type { CopilotTurnResponse, ToolExecutionResult } from "@relay-agent/contracts";

// ── 設定 ──────────────────────────────────────────────────────────────────

export type AgentLoopConfig = {
  maxTurns: number;       // デフォルト 10
  timeoutMs: number;      // 1ターンのタイムアウト（デフォルト 120_000ms）
  cdpPort: number;
};

export type LoopTurnResult = {
  turn: number;
  toolResults: ToolExecutionResult[];
  copilotSummary: string;
  status: CopilotTurnResponse["status"];
};

export type AgentLoopResult =
  | { outcome: "ready_to_write"; writeActions: unknown[]; turns: LoopTurnResult[] }
  | { outcome: "done"; turns: LoopTurnResult[] }
  | { outcome: "error"; message: string; turns: LoopTurnResult[] }
  | { outcome: "cancelled" };

// ── イベントコールバック（UI 更新用）────────────────────────────────────────

export type AgentLoopCallbacks = {
  onTurnStart: (turn: number) => void;
  onToolStart: (tool: string) => void;
  onToolComplete: (result: ToolExecutionResult) => void;
  onCopilotMessage: (summary: string) => void;
  onTurnComplete: (result: LoopTurnResult) => void;
  onGuardTriggered: (message: string) => void;
};

// ── メイン関数 ───────────────────────────────────────────────────────────────

/**
 * エージェントループを実行する。
 * - read ツールを自動実行してループを継続する
 * - write ツールが出てきたら "ready_to_write" で停止する
 * - "done" / "error" / 最大ターン数到達でも停止する
 */
export async function runAgentLoop(
  sessionId: string,
  turnId: string,
  initialPrompt: string,
  config: AgentLoopConfig,
  callbacks: AgentLoopCallbacks,
  cancelSignal: { cancelled: boolean }
): Promise<AgentLoopResult> {
  const turns: LoopTurnResult[] = [];
  let currentPrompt = initialPrompt;

  for (let turn = 1; turn <= config.maxTurns; turn++) {
    if (cancelSignal.cancelled) {
      return { outcome: "cancelled" };
    }

    callbacks.onTurnStart(turn);

    // 1. Copilot へ送信
    let rawResponse: string;
    try {
      rawResponse = await withTimeout(
        sendToCopilot(currentPrompt),
        config.timeoutMs,
        `ターン ${turn}: Copilot の応答がタイムアウトしました（${config.timeoutMs / 1000}秒）`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { outcome: "error", message, turns };
    }

    // 2. レスポンスをパース
    let parsed: CopilotTurnResponse;
    try {
      const { copilotTurnResponseSchema } = await import("@relay-agent/contracts");
      parsed = copilotTurnResponseSchema.parse(JSON.parse(rawResponse));
    } catch {
      return {
        outcome: "error",
        message: `ターン ${turn}: Copilot のレスポンスをパースできませんでした。\n${rawResponse}`,
        turns,
      };
    }

    callbacks.onCopilotMessage(parsed.summary);

    if (cancelSignal.cancelled) return { outcome: "cancelled" };

    // 3. status チェック
    if (parsed.status === "error") {
      return {
        outcome: "error",
        message: parsed.message ?? parsed.summary,
        turns,
      };
    }

    if (parsed.status === "done") {
      const turnResult: LoopTurnResult = {
        turn,
        toolResults: [],
        copilotSummary: parsed.summary,
        status: "done",
      };
      turns.push(turnResult);
      callbacks.onTurnComplete(turnResult);
      return { outcome: "done", turns };
    }

    // 4. read ツールを実行
    let toolResults: ToolExecutionResult[] = [];
    let writeActions: unknown[] = [];
    let hasWrite = false;

    if (parsed.actions.length > 0) {
      callbacks.onToolStart("execute_read_actions");

      const res = await executeReadActions({
        sessionId,
        turnId,
        actions: parsed.actions as unknown[],
        loopTurn: turn,
        maxTurns: config.maxTurns,
      });

      if (res.guardMessage) {
        callbacks.onGuardTriggered(res.guardMessage);
        return { outcome: "error", message: res.guardMessage, turns };
      }

      toolResults = res.results;
      hasWrite = res.hasWriteActions;

      for (const result of toolResults) {
        callbacks.onToolComplete(result);
      }

      if (hasWrite) {
        // write ツールを抽出して承認ゲートへ
        const readToolNames = new Set([
          "workbook.inspect", "sheet.preview", "sheet.profile_columns",
          "session.diff_from_base", "file.list", "file.read_text", "file.stat"
        ]);
        writeActions = parsed.actions.filter(
          (a: unknown) =>
            typeof a === "object" && a !== null &&
            !readToolNames.has((a as Record<string, unknown>).tool as string)
        );
      }
    }

    const turnResult: LoopTurnResult = {
      turn,
      toolResults,
      copilotSummary: parsed.summary,
      status: parsed.status ?? "thinking",
    };
    turns.push(turnResult);
    callbacks.onTurnComplete(turnResult);

    // 5. 停止判定
    if (parsed.status === "ready_to_write" || hasWrite) {
      return { outcome: "ready_to_write", writeActions, turns };
    }

    // 6. 次ターン用プロンプト生成
    if (toolResults.length > 0) {
      currentPrompt = buildFollowUpPrompt(initialPrompt, turns);
    }
  }

  // 最大ターン到達
  return {
    outcome: "error",
    message: `最大ターン数（${config.maxTurns}）に達しました。Copilot が結論を出せませんでした。`,
    turns,
  };
}

// ── フォローアッププロンプト生成（Task 87）────────────────────────────────

/**
 * 前ターンまでのツール実行結果を Copilot が読める形に整形して
 * 次ターンのプロンプトを生成する。
 */
export function buildFollowUpPrompt(
  originalPrompt: string,
  completedTurns: LoopTurnResult[]
): string {
  const resultSections = completedTurns.flatMap((turn) =>
    turn.toolResults.map((r) => {
      const resultJson = r.result
        ? JSON.stringify(r.result, null, 2)
        : `エラー: ${r.error ?? "不明なエラー"}`;
      return `▶ ${r.tool}\n${resultJson}`;
    })
  );

  const lastSummary = completedTurns.at(-1)?.copilotSummary ?? "";

  return [
    originalPrompt,
    "",
    "---",
    "【前のターンの実行結果】",
    "",
    ...resultSections,
    "",
    "---",
    "あなたの前回の分析: " + lastSummary,
    "",
    "上記の結果を踏まえて、次のアクションを JSON で返してください。",
    "書き込み準備が整った場合は status を \"ready_to_write\" にしてください。",
    "追加情報が不要で作業が完了した場合は status を \"done\" にしてください。",
  ].join("\n");
}

// ── ユーティリティ ────────────────────────────────────────────────────────

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
```

---

## `lib/ipc.ts` への追加

既存の IPC ラッパーに以下を追加:

```typescript
import {
  // 既存のインポート...
  type ToolExecutionResult,
} from "@relay-agent/contracts";

// リクエスト/レスポンス型（Task 86 で models.rs に追加したものに対応）
type ExecuteReadActionsRequest = {
  sessionId: string;
  turnId: string;
  actions: unknown[];
  loopTurn: number;
  maxTurns: number;
};

type ExecuteReadActionsResponse = {
  results: ToolExecutionResult[];
  hasWriteActions: boolean;
  shouldContinue: boolean;
  guardMessage: string | null;
};

export async function executeReadActions(
  request: ExecuteReadActionsRequest
): Promise<ExecuteReadActionsResponse> {
  return invoke<ExecuteReadActionsResponse>("execute_read_actions", { request });
}
```

---

## Task 88: `+page.svelte` UI 変更

### 追加する状態変数

```typescript
// エージェントループ
let isAgentLoopMode = false;        // ループモード有効かどうか
let agentLoopRunning = false;       // 現在ループ実行中か
let agentLoopTurn = 0;             // 現在のターン番号
let agentLoopMaxTurns = 10;        // 最大ターン数
let agentLoopLog: AgentLoopLogEntry[] = [];  // ツール実行ログ
let agentLoopSummary = "";         // 最新の Copilot メッセージ
let agentLoopCancelSignal = { cancelled: false };

type AgentLoopLogEntry = {
  turn: number;
  tool: string;
  status: "running" | "done" | "error";
  message?: string;
};
```

### `handleCopilotAutoSend` を置き換え

```typescript
async function handleCopilotAutoSend(): Promise<void> {
  if (!copilotInstructionText.trim()) return;

  if (isAgentLoopMode) {
    await handleAgentLoop();
  } else {
    await handleSingleShotSend();
  }
}

// 既存の1ショット送信（ループモード OFF 時）
async function handleSingleShotSend(): Promise<void> {
  isSendingToCopilot = true;
  copilotAutoError = null;
  try {
    const response = await sendToCopilot(copilotInstructionText);
    copilotResponse = response;
    // ... 既存処理
  } catch (error) {
    // ... 既存エラー処理
  } finally {
    isSendingToCopilot = false;
  }
}

// 新しいエージェントループ送信
async function handleAgentLoop(): Promise<void> {
  agentLoopRunning = true;
  agentLoopTurn = 0;
  agentLoopLog = [];
  agentLoopSummary = "";
  agentLoopCancelSignal = { cancelled: false };
  copilotAutoError = null;

  const settings = loadBrowserAutomationSettings();
  const loopConfig: AgentLoopConfig = {
    maxTurns: agentLoopMaxTurns,
    timeoutMs: settings.timeoutMs,
    cdpPort: settings.cdpPort,
  };

  const callbacks: AgentLoopCallbacks = {
    onTurnStart: (turn) => {
      agentLoopTurn = turn;
    },
    onToolStart: (tool) => {
      agentLoopLog = [...agentLoopLog, { turn: agentLoopTurn, tool, status: "running" }];
    },
    onToolComplete: (result) => {
      agentLoopLog = agentLoopLog.map((entry) =>
        entry.turn === agentLoopTurn && entry.tool === result.tool
          ? { ...entry, status: result.success ? "done" : "error", message: result.error ?? undefined }
          : entry
      );
    },
    onCopilotMessage: (summary) => {
      agentLoopSummary = summary;
    },
    onTurnComplete: () => {},
    onGuardTriggered: (message) => {
      copilotAutoError = message;
    },
  };

  try {
    const result = await runAgentLoop(
      sessionId, turnId,
      copilotInstructionText,
      loopConfig, callbacks,
      agentLoopCancelSignal
    );

    if (result.outcome === "ready_to_write") {
      // write actions を copilotResponse にセット → ステップ3へ
      copilotResponse = JSON.stringify({
        version: "1.0",
        status: "ready_to_write",
        summary: agentLoopSummary,
        actions: result.writeActions,
      }, null, 2);
    } else if (result.outcome === "done") {
      agentLoopSummary = "作業が完了しました。追加の書き込みはありません。";
    } else if (result.outcome === "error") {
      copilotAutoError = result.message;
    }
  } finally {
    agentLoopRunning = false;
  }
}

function cancelAgentLoop(): void {
  agentLoopCancelSignal.cancelled = true;
}
```

### Svelte テンプレート — ステップ2のループ UI

既存の「Copilotに自動送信 ▶」ボタンの下に以下を追加:

```svelte
<!-- ループモード切り替え -->
<label class="toggle-row">
  <input type="checkbox" bind:checked={isAgentLoopMode} disabled={agentLoopRunning} />
  <span>エージェントループモード（自動で複数回 Copilot とやりとりする）</span>
</label>

<!-- ループ実行中の進行表示 -->
{#if agentLoopRunning}
  <div class="agent-loop-panel">
    <div class="loop-header">
      <span class="loop-turn">ターン {agentLoopTurn} / {agentLoopMaxTurns}</span>
      <button class="btn-link" type="button" on:click={cancelAgentLoop}>キャンセル</button>
    </div>

    <ul class="loop-log">
      {#each agentLoopLog as entry (entry.turn + entry.tool)}
        <li class="log-entry log-{entry.status}">
          {#if entry.status === "running"}
            <span class="spinner">⟳</span>
          {:else if entry.status === "done"}
            <span class="check">✓</span>
          {:else}
            <span class="cross">✗</span>
          {/if}
          {entry.tool}
          {#if entry.message}
            <span class="log-error"> — {entry.message}</span>
          {/if}
        </li>
      {/each}
    </ul>

    {#if agentLoopSummary}
      <div class="copilot-bubble">{agentLoopSummary}</div>
    {/if}
  </div>
{/if}
```

### CSS 追加

```css
.toggle-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.88rem;
  cursor: pointer;
  margin: 0.5rem 0;
}

.agent-loop-panel {
  border: 1px solid var(--ra-border);
  border-radius: 6px;
  padding: 0.75rem 1rem;
  background: var(--ra-surface);
  margin: 0.5rem 0;
}

.loop-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
}

.loop-log {
  list-style: none;
  padding: 0;
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
}

.log-entry {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.15rem 0;
}

.log-running { color: var(--ra-muted); }
.log-done    { color: var(--ra-success, #2e7d32); }
.log-error   { color: var(--ra-error); }

.spinner { display: inline-block; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.copilot-bubble {
  background: var(--ra-accent-soft, #f0f4ff);
  border-left: 3px solid var(--ra-accent);
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
  border-radius: 0 4px 4px 0;
  white-space: pre-wrap;
}

.log-error { font-size: 0.8rem; color: var(--ra-error); }
```

---

## Task 92: 設定モーダル — エージェントループ設定

### `continuity.ts` の `BrowserAutomationSettings` を拡張

```typescript
export type BrowserAutomationSettings = {
  cdpPort: number;
  timeoutMs: number;
  // 以下を追加
  agentLoopEnabled: boolean;  // デフォルト false
  maxTurns: number;           // デフォルト 10
  loopTimeoutMs: number;      // 1ターンのタイムアウト。デフォルト 120_000
};

// loadBrowserAutomationSettings のデフォルト値を更新
export function loadBrowserAutomationSettings(): BrowserAutomationSettings {
  const stored = localStorage.getItem("browserAutomationSettings");
  const defaults: BrowserAutomationSettings = {
    cdpPort: 9222,
    timeoutMs: 60_000,
    agentLoopEnabled: false,
    maxTurns: 10,
    loopTimeoutMs: 120_000,
  };
  if (!stored) return defaults;
  try {
    return { ...defaults, ...JSON.parse(stored) };
  } catch {
    return defaults;
  }
}
```

### `+page.svelte` 設定モーダルに追加

既存の CDP ポート・タイムアウト設定の下に追加:

```svelte
<hr />
<h4>エージェントループ</h4>

<label class="field-label">
  最大ターン数（1〜20）
  <input
    type="number" min="1" max="20"
    bind:value={agentLoopMaxTurns}
    on:change={() => saveSettings()}
  />
</label>

<label class="field-label">
  1ターンのタイムアウト（秒）
  <input
    type="number" min="30" max="300"
    bind:value={loopTimeoutSeconds}
    on:change={() => saveSettings()}
  />
</label>

<p class="field-note">
  ループモードでは、Copilot がデータを確認しながら複数回やりとりして計画を立てます。
  書き込み操作は必ず人間が確認します。
</p>
```

---

## `import` 追加（`+page.svelte` の `<script>` ブロック）

```typescript
import {
  runAgentLoop,
  buildFollowUpPrompt,
  type AgentLoopConfig,
  type AgentLoopCallbacks,
  type AgentLoopLogEntry,
} from "$lib/agent-loop";
import { executeReadActions } from "$lib/ipc";
```

---

## 検証コマンド

```bash
# 型チェック
pnpm --filter @relay-agent/desktop check

# ビルド確認
pnpm --filter @relay-agent/desktop build

# dev 起動（手動確認）
pnpm --filter @relay-agent/desktop tauri:dev
```

### 確認事項

1. 「エージェントループモード」チェックボックスが表示される
2. チェック ON で「Copilotに自動送信 ▶」を押すとループが始まる
3. ループログにツール名と ✓ / ✗ が表示される
4. 「キャンセル」でループが停止する
5. `ready_to_write` でステップ3に write actions が渡される
6. チェック OFF では従来の1ショット動作になる
7. 設定モーダルで maxTurns / timeout が保存・復元される
