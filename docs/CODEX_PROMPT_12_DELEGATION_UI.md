# Codex プロンプト 12 — デリゲーション UI パラダイム（Tasks 124–137）

## 対象タスク

- **Task 124**: 設計 — デリゲーション UI アーキテクチャ
- **Task 125**: フロントエンド — コンポーネント分割（+page.svelte リファクタ）
- **Task 126**: フロントエンド — デリゲーションモード状態管理
- **Task 127**: フロントエンド — チャットスタイル目標入力
- **Task 128**: フロントエンド — アクティビティフィード
- **Task 129**: フロントエンド — インターベンションパネル
- **Task 130**: フロントエンド — 完了・結果タイムライン
- **Task 131**: フロントエンド — デリゲーションページ統合
- **Task 132**: フロントエンド — ファイル選択の最小化
- **Task 133**: フロントエンド — コピー＆ペースト不要化
- **Task 134**: Continuity 拡張 — デリゲーションモード永続化
- **Task 135**: フロントエンド — レスポンシブレイアウト
- **Task 136**: フロントエンド — キーボードショートカット
- **Task 137**: E2E 検証 — デリゲーション UI（手動）

## 概要

現状の 3 ステップウィザード UI（4000 行超の `+page.svelte`）を、
**チャット/デリゲーション型 UI** に転換する。

ユーザーがゴールを自然言語で入力 → エージェントが自律的に作業 →
アクティビティフィードでリアルタイム進捗表示 → 承認が必要な場面のみ介入。

**基本方針:**
- 既存 3 ステップフローは「手動モード」として残す（破壊変更なし）
- デリゲーションモードがデフォルト
- `+page.svelte` のモノリスをコンポーネント分割してからデリゲーション UI を構築
- Phase 4（自律実行）のプラン承認・進行表示コンポーネントを再利用

## 前提

- Phase 4（Tasks 109–123）のプラン承認 UI、進行表示が完了していること
- `apps/desktop/src/routes/+page.svelte` — 現在 4000 行超
- `apps/desktop/src/lib/continuity.ts` — 状態永続化
- `apps/desktop/src/lib/agent-loop.ts` — エージェントループ
- `apps/desktop/src/lib/copilot-browser.ts` — ブラウザ自動化

---

## Task 124: 設計ドキュメント

### 実装場所

`docs/DELEGATION_UI_DESIGN.md` — 新規作成

### 必須セクション

1. **コンポーネントツリー**
2. **状態管理設計（Svelte ストア）**
3. **手動/デリゲーションモード共存戦略**
4. **アクティビティフィードイベント型定義**
5. **レイアウト仕様（3 ゾーン構成）**

### レイアウト仕様

```
┌──────────────────────────────────────────────┐
│ ヘッダー（アプリ名 + ⚙ + モードトグル）       │
├──────────────────────────────────────────────┤
│ 最近の作業リスト                              │
├────────────────────────┬─────────────────────┤
│ アクティビティフィード   │ 介入パネル           │
│ （中央、スクロール可）   │ （右側、コンテキスト依存）│
├────────────────────────┴─────────────────────┤
│ チャットコンポーザー（下部固定）               │
└──────────────────────────────────────────────┘
```

---

## Task 125: コンポーネント分割（最重要リファクタリング）

### 実装場所

- `apps/desktop/src/lib/components/` — 新規ディレクトリ
- `apps/desktop/src/routes/+page.svelte` — オーケストレーターに縮小

### 抽出するコンポーネント

| コンポーネント | 抽出元 | 責務 |
|---|---|---|
| `RecentSessions.svelte` | 最近の作業セクション | セッション一覧表示・クリックで再開 |
| `GoalInput.svelte` | ステップ1のフォーム | ファイル選択 + 目標入力 + テンプレートチップ |
| `CopilotInstructions.svelte` | ステップ2の依頼テキスト部分 | 依頼テキスト表示・コピー |
| `ResponseInput.svelte` | ステップ2のレスポンス入力部分 | テキストエリア + auto-fix 通知 |
| `SheetDiffCard.svelte` | ステップ3の差分カード | シート差分表示（addedColumns, changedColumns 等） |
| `ChangeSummaryStrip.svelte` | ステップ3の3点サマリー | 変更内容・行数・出力先 |
| `ApprovalGate.svelte` | ステップ3の承認ボタン周り | 保存ボタン + 安全メッセージ |
| `AgentLoopPanel.svelte` | エージェントループ進行表示 | ツール実行タイムライン |
| `SettingsModal.svelte` | 設定モーダル全体 | CDP・エージェント設定 |
| `StepBanner.svelte` | ステップインジケーター | 3段階プログレス表示 |

### 抽出のルール

1. 各コンポーネントは props と events で親と通信する（`export let` / `createEventDispatcher`）
2. 状態は原則として親（`+page.svelte`）が管理し、コンポーネントは props で受け取る
3. 副作用（IPC 呼び出し等）はコールバック props 経由で親に委譲する
4. CSS は各コンポーネントの `<style>` に移動する（グローバルスタイルは `+layout.svelte` に残す）

### 抽出手順（各コンポーネント共通）

```
1. コンポーネントファイル作成（src/lib/components/Foo.svelte）
2. +page.svelte から HTML テンプレート + CSS をコピー
3. 依存する変数を export let props に変換
4. イベントハンドラを dispatch / コールバック props に変換
5. +page.svelte でコンポーネントをインポートして差し替え
6. svelte-check で 0 errors を確認
```

### 注意事項

- **動作変更なし**のリファクタリング。見た目と動作は完全に同一であること
- `+page.svelte` 内のリアクティブ変数（`$:` 宣言）はそのまま親に残す
- コンポーネント間の依存が発生する場合は props チェーンで伝播（ストアは Task 126 で導入）

---

## Task 126: デリゲーションモード状態管理

### 実装場所

`apps/desktop/src/lib/stores/delegation.ts` — 新規

### 型定義

```typescript
import { writable, derived } from "svelte/store";
import type { ExecutionPlan, PlanStep, ToolExecutionResult } from "@relay-agent/contracts";

export type DelegationState =
  | "idle"
  | "goal_entered"
  | "planning"
  | "plan_review"
  | "executing"
  | "awaiting_approval"
  | "completed"
  | "error";

export type ActivityEventType =
  | "goal_set"
  | "file_attached"
  | "copilot_turn"
  | "tool_executed"
  | "plan_proposed"
  | "plan_approved"
  | "write_approval_requested"
  | "write_approved"
  | "step_completed"
  | "error"
  | "completed";

export type ActivityFeedEvent = {
  id: string;
  type: ActivityEventType;
  timestamp: string;
  message: string;
  icon: string;
  detail?: string;
  expandable?: boolean;
  actionRequired?: boolean;
};

export type DelegationStoreState = {
  state: DelegationState;
  goal: string;
  attachedFiles: string[];
  plan: ExecutionPlan | null;
  currentStepIndex: number;
  error: string | null;
};
```

### ストア実装

```typescript
function createDelegationStore() {
  const { subscribe, set, update } = writable<DelegationStoreState>({
    state: "idle",
    goal: "",
    attachedFiles: [],
    plan: null,
    currentStepIndex: -1,
    error: null
  });

  return {
    subscribe,
    setGoal: (goal: string, files: string[]) =>
      update((s) => ({ ...s, state: "goal_entered", goal, attachedFiles: files })),
    startPlanning: () =>
      update((s) => ({ ...s, state: "planning" })),
    proposePlan: (plan: ExecutionPlan) =>
      update((s) => ({ ...s, state: "plan_review", plan })),
    approvePlan: () =>
      update((s) => ({ ...s, state: "executing", currentStepIndex: 0 })),
    advanceStep: () =>
      update((s) => ({ ...s, currentStepIndex: s.currentStepIndex + 1 })),
    requestApproval: () =>
      update((s) => ({ ...s, state: "awaiting_approval" })),
    resumeExecution: () =>
      update((s) => ({ ...s, state: "executing" })),
    complete: () =>
      update((s) => ({ ...s, state: "completed" })),
    setError: (error: string) =>
      update((s) => ({ ...s, state: "error", error })),
    reset: () =>
      set({ state: "idle", goal: "", attachedFiles: [], plan: null, currentStepIndex: -1, error: null })
  };
}

export const delegationStore = createDelegationStore();

function createActivityFeedStore() {
  const { subscribe, update } = writable<ActivityFeedEvent[]>([]);

  return {
    subscribe,
    push: (event: Omit<ActivityFeedEvent, "id" | "timestamp">) =>
      update((events) => [
        ...events,
        {
          ...event,
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toISOString()
        }
      ]),
    clear: () => update(() => [])
  };
}

export const activityFeedStore = createActivityFeedStore();
```

---

## Task 127: チャットスタイル目標入力

### 実装場所

`apps/desktop/src/lib/components/ChatComposer.svelte` — 新規

### テンプレート

```svelte
<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let recentFiles: { path: string; lastUsedAt: string }[] = [];
  export let suggestions: { label: string; value: string }[] = [];
  export let disabled = false;

  const dispatch = createEventDispatcher<{
    submit: { goal: string; files: string[] };
  }>();

  let goal = "";
  let attachedFiles: string[] = [];

  async function handleFileAttach() {
    // Tauri ファイルダイアログ経由
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      multiple: false,
      filters: [{ name: "ファイル", extensions: ["csv", "xlsx", "txt", "docx"] }]
    });
    if (result) {
      attachedFiles = [...attachedFiles, result as string];
    }
  }

  function handleSubmit() {
    if (!goal.trim()) return;
    dispatch("submit", { goal: goal.trim(), files: attachedFiles });
  }

  function handleSuggestion(value: string) {
    goal = value;
  }

  function handleQuickAttach(path: string) {
    if (!attachedFiles.includes(path)) {
      attachedFiles = [...attachedFiles, path];
    }
  }

  function removeFile(index: number) {
    attachedFiles = attachedFiles.filter((_, i) => i !== index);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }
</script>

<div class="chat-composer">
  {#if suggestions.length > 0}
    <div class="suggestion-chips">
      {#each suggestions as suggestion}
        <button class="suggestion-chip" on:click={() => handleSuggestion(suggestion.value)}>
          {suggestion.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if attachedFiles.length > 0}
    <div class="attached-files">
      {#each attachedFiles as file, i}
        <span class="attached-file-chip">
          📎 {file.split('/').pop()}
          <button class="remove-file" on:click={() => removeFile(i)}>✕</button>
        </span>
      {/each}
    </div>
  {/if}

  {#if recentFiles.length > 0 && attachedFiles.length === 0}
    <div class="quick-attach">
      {#each recentFiles.slice(0, 3) as file}
        <button class="quick-attach-chip" on:click={() => handleQuickAttach(file.path)}>
          📎 {file.path.split('/').pop()}
        </button>
      {/each}
    </div>
  {/if}

  <div class="composer-input-row">
    <textarea
      class="composer-textarea"
      bind:value={goal}
      on:keydown={handleKeydown}
      placeholder="やりたいことを入力してください… 例: 「revenue.csv の approved が true の行だけ残して保存」"
      rows="2"
      {disabled}
    ></textarea>
    <button class="attach-btn" on:click={handleFileAttach} {disabled} aria-label="ファイルを添付">
      📎
    </button>
    <button
      class="send-btn"
      on:click={handleSubmit}
      disabled={disabled || !goal.trim()}
      aria-label="送信"
    >
      送信
    </button>
  </div>
</div>

<style>
  .chat-composer {
    border-top: 1px solid var(--border-color, #ddd);
    padding: 12px 16px;
    background: var(--bg-surface, #fff);
  }
  .composer-input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .composer-textarea {
    flex: 1;
    resize: none;
    padding: 10px 14px;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 12px;
    font-size: 14px;
    font-family: inherit;
    line-height: 1.5;
  }
  .suggestion-chips, .quick-attach {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .suggestion-chip, .quick-attach-chip {
    padding: 4px 12px;
    border-radius: 16px;
    border: 1px solid var(--border-color, #ddd);
    background: var(--bg-surface, #fff);
    font-size: 12px;
    cursor: pointer;
  }
  .attached-files {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .attached-file-chip {
    padding: 4px 10px;
    border-radius: 12px;
    background: var(--accent-light, #e8f5e9);
    font-size: 12px;
  }
  .send-btn {
    padding: 10px 20px;
    border-radius: 12px;
    background: var(--accent-color, #4caf50);
    color: white;
    font-weight: 600;
    border: none;
    cursor: pointer;
  }
  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .attach-btn {
    padding: 10px;
    border: none;
    background: none;
    font-size: 20px;
    cursor: pointer;
  }
</style>
```

---

## Task 128: アクティビティフィード

### 実装場所

`apps/desktop/src/lib/components/ActivityFeed.svelte` — 新規

### テンプレート

```svelte
<script lang="ts">
  import { afterUpdate, tick } from "svelte";
  import type { ActivityFeedEvent } from "$lib/stores/delegation";

  export let events: ActivityFeedEvent[] = [];

  let feedContainer: HTMLDivElement;

  afterUpdate(async () => {
    await tick();
    if (feedContainer) {
      feedContainer.scrollTop = feedContainer.scrollHeight;
    }
  });

  const ICON_MAP: Record<string, string> = {
    goal_set: "💬",
    file_attached: "📎",
    copilot_turn: "🤖",
    tool_executed: "🔧",
    plan_proposed: "📋",
    plan_approved: "✅",
    write_approval_requested: "⚠️",
    write_approved: "✓",
    step_completed: "✓",
    error: "❌",
    completed: "🎉"
  };
</script>

<div class="activity-feed" bind:this={feedContainer}>
  {#if events.length === 0}
    <div class="feed-empty">
      やりたいことを入力して、エージェントを開始してください。
    </div>
  {:else}
    {#each events as event (event.id)}
      <div
        class="feed-event"
        class:event-action-required={event.actionRequired}
        class:event-error={event.type === 'error'}
      >
        <span class="event-icon">{ICON_MAP[event.type] ?? '•'}</span>
        <div class="event-content">
          <div class="event-message">{event.message}</div>
          {#if event.detail && event.expandable}
            <details class="event-detail">
              <summary>詳細を見る</summary>
              <pre>{event.detail}</pre>
            </details>
          {:else if event.detail}
            <div class="event-detail-inline">{event.detail}</div>
          {/if}
          <time class="event-time">
            {new Date(event.timestamp).toLocaleTimeString('ja-JP')}
          </time>
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .activity-feed {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }
  .feed-event {
    display: flex;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border-color-light, #f0f0f0);
  }
  .event-action-required {
    background: var(--warning-bg, #fff8e1);
    padding: 10px;
    border-radius: 8px;
    border: 1px solid var(--warning-border, #ffcc80);
  }
  .event-icon {
    flex-shrink: 0;
    width: 24px;
    text-align: center;
    font-size: 16px;
  }
  .event-content {
    flex: 1;
    min-width: 0;
  }
  .event-message {
    font-size: 14px;
    line-height: 1.4;
  }
  .event-time {
    font-size: 11px;
    color: var(--text-secondary, #999);
  }
  .event-detail pre {
    font-size: 12px;
    max-height: 200px;
    overflow: auto;
    background: var(--bg-code, #f5f5f5);
    padding: 8px;
    border-radius: 4px;
  }
  .feed-empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-secondary, #999);
  }
</style>
```

---

## Task 131: デリゲーションページ統合

### 実装場所

`apps/desktop/src/routes/+page.svelte`

### 変更内容

`+page.svelte` にモードトグルと条件付きレンダリングを追加:

```svelte
<script>
  import { delegationStore, activityFeedStore } from "$lib/stores/delegation";
  import ChatComposer from "$lib/components/ChatComposer.svelte";
  import ActivityFeed from "$lib/components/ActivityFeed.svelte";
  // ... 他のインポート

  let uiMode: 'delegation' | 'manual' = 'delegation'; // continuity から読み込み
</script>

<!-- ヘッダー -->
<header>
  <span class="app-title">Relay Agent</span>
  <div class="header-controls">
    <button class="mode-toggle" on:click={() => uiMode = uiMode === 'delegation' ? 'manual' : 'delegation'}>
      {uiMode === 'delegation' ? '手動モードに切替' : '自動モードに切替'}
    </button>
    <button class="settings-btn" on:click={() => showSettings = true}>⚙</button>
  </div>
</header>

{#if uiMode === 'delegation'}
  <!-- デリゲーションモード -->
  <div class="delegation-layout">
    <div class="delegation-main">
      <ActivityFeed events={$activityFeedStore} />
    </div>
    <div class="delegation-sidebar">
      <!-- 介入パネル: plan_review / awaiting_approval 時にコンテンツ表示 -->
      {#if $delegationStore.state === 'plan_review'}
        <!-- PlanReview コンポーネント -->
      {:else if $delegationStore.state === 'awaiting_approval'}
        <!-- ApprovalGate コンポーネント -->
      {:else if $delegationStore.state === 'executing'}
        <div class="execution-status">自律実行中... ステップ {$delegationStore.currentStepIndex + 1}</div>
      {:else if $delegationStore.state === 'completed'}
        <!-- 完了サマリー -->
      {/if}
    </div>
  </div>
  <ChatComposer
    {recentFiles}
    suggestions={objectiveTemplates}
    disabled={$delegationStore.state !== 'idle'}
    on:submit={handleDelegationSubmit}
  />
{:else}
  <!-- 手動モード（既存の3ステップフロー — 変更なし） -->
  <!-- ... 既存コード ... -->
{/if}
```

### 新規ハンドラ

```typescript
async function handleDelegationSubmit(event: CustomEvent<{ goal: string; files: string[] }>) {
  const { goal, files } = event.detail;

  delegationStore.setGoal(goal, files);
  activityFeedStore.push({ type: 'goal_set', message: goal, icon: '💬' });

  if (files.length > 0) {
    for (const f of files) {
      activityFeedStore.push({ type: 'file_attached', message: `📎 ${f.split('/').pop()}`, icon: '📎' });
    }
  }

  // プランニングフェーズ開始
  delegationStore.startPlanning();
  activityFeedStore.push({ type: 'copilot_turn', message: 'Copilot に実行計画を問い合わせています...', icon: '🤖' });

  try {
    const prompt = buildPlanningPrompt(goal, workbookContext, availableTools);
    const result = await runAgentLoop(
      { sessionId, turnId, initialPrompt: prompt, maxTurns, loopTimeoutMs, planningEnabled: true },
      {
        onPlanProposed: (plan) => {
          delegationStore.proposePlan(plan);
          activityFeedStore.push({
            type: 'plan_proposed',
            message: `計画を提案しました: ${plan.summary}`,
            icon: '📋',
            actionRequired: true
          });
        },
        onToolResults: (turn, results) => {
          for (const r of results) {
            activityFeedStore.push({
              type: 'tool_executed',
              message: `${r.tool} ${r.ok ? '完了' : '失敗'}`,
              icon: '🔧',
              detail: r.ok ? JSON.stringify(r.result, null, 2) : r.error ?? '',
              expandable: true
            });
          }
        }
      }
    );
  } catch (err) {
    delegationStore.setError(String(err));
    activityFeedStore.push({ type: 'error', message: String(err), icon: '❌' });
  }
}
```

---

## Task 133: コピペ不要化

### 変更箇所

デリゲーションモードでは `sendToCopilot`（ブラウザ自動化）を直接使用。
フォールバック時のみコピペ UI を表示:

```typescript
// agent-loop.ts の sendToCopilot 呼び出しが失敗した場合
callbacks.onBrowserAutomationFailed?.((prompt) => {
  // アクティビティフィードにフォールバックカードを表示
  activityFeedStore.push({
    type: 'error',
    message: 'ブラウザ自動化に失敗しました。手動でコピペしてください。',
    icon: '⚠️',
    detail: prompt,
    expandable: true,
    actionRequired: true
  });
});
```

---

## Task 134: Continuity 拡張

### continuity.ts に追加

```typescript
export type PersistedDelegationDraft = {
  goal: string;
  attachedFiles: string[];
  delegationState: string;
  activityFeedSnapshot: ActivityFeedEvent[];
  planSnapshot: ExecutionPlan | null;
  lastUpdatedAt: string;
};

// ContinuityState に追加
delegationDraft: PersistedDelegationDraft | null;
uiMode: 'delegation' | 'manual';
```

---

## 実装順序

1. **Task 124** — 設計ドキュメント
2. **Task 125** — コンポーネント分割（**最重要** — 他の全タスクの前提）
3. **Task 126** — 状態管理ストア
4. **Task 127** — ChatComposer
5. **Task 128** — ActivityFeed
6. **Task 129** — InterventionPanel
7. **Task 130** — 完了タイムライン
8. **Task 131** — ページ統合
9. **Task 132** — ファイル選択最小化
10. **Task 133** — コピペ不要化
11. **Task 134** — 永続化
12. **Task 135** — レスポンシブ
13. **Task 136** — キーボードショートカット
14. **Task 137** — E2E 検証

## 検証チェックリスト

- [ ] `pnpm check` と `pnpm typecheck` が成功する
- [ ] 手動モードで既存の 3 ステップフローが同一動作する
- [ ] `pnpm workflow:test` が手動モードで通過する
- [ ] デリゲーションモードで目標入力 → エージェント開始 → アクティビティフィード更新
- [ ] プラン提案時に介入パネルにプランレビューが表示される
- [ ] write ステップで承認ゲートが表示される
- [ ] ブラウザ自動化失敗時にフォールバックカードが表示される
- [ ] モードトグルが切り替わり、設定が永続化する
- [ ] デリゲーションドラフトがページリロード後に復元される
- [ ] 狭いウィンドウで介入パネルがオーバーレイになる
- [ ] Enter で目標送信、Escape でキャンセル
