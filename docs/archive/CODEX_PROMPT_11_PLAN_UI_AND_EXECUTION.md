# Codex プロンプト 11 — プラン承認 UI & 自律実行（Tasks 114–123）

## 対象タスク

- **Task 114**: バックエンド — プラン承認 IPC コマンド
- **Task 115**: フロントエンド — プラン承認 UI
- **Task 116**: フロントエンド — 自律実行の進行状態表示
- **Task 117**: フロントエンド — 書き込みステップ承認ゲート
- **Task 118**: バックエンド — プラン実行状態永続化
- **Task 119**: フロントエンド — プラン実行のキャンセル・一時停止
- **Task 120**: フロントエンド — プラン修正と再プランニング
- **Task 121**: Contracts 拡張 — プランニングモード Copilot ハンドオフ
- **Task 122**: 設定 — 自律実行モード設定
- **Task 123**: E2E 検証 — 自律プラン実行（手動）

## 前提

- Task 110–113 が完了していること（Contracts に ExecutionPlan/PlanStep スキーマ、agent-loop.ts に `resumeAgentLoopWithPlan` が存在）
- `pnpm --filter @relay-agent/contracts typecheck` と `pnpm --filter @relay-agent/desktop typecheck` が通ること

---

## Task 114: バックエンド — プラン承認 IPC コマンド

### 実装場所

- `apps/desktop/src-tauri/src/models.rs` — リクエスト/レスポンス型
- `apps/desktop/src-tauri/src/execution.rs` — Tauri コマンド
- `apps/desktop/src-tauri/src/app.rs` — コマンド登録
- `apps/desktop/src/lib/ipc.ts` — フロントエンド IPC ラッパー

### models.rs に追加

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovePlanRequest {
    pub session_id: String,
    pub turn_id: String,
    pub approved_step_ids: Vec<String>,
    pub modified_steps: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovePlanResponse {
    pub approved: bool,
    pub plan: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanProgressRequest {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanProgressResponse {
    pub current_step_id: Option<String>,
    pub completed_count: u32,
    pub total_count: u32,
    pub step_statuses: Vec<PlanStepStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStepStatus {
    pub step_id: String,
    pub state: String, // "pending" | "running" | "completed" | "skipped" | "failed"
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}
```

### execution.rs に追加

```rust
#[tauri::command]
pub fn approve_plan(
    state: State<'_, DesktopState>,
    request: ApprovePlanRequest,
) -> Result<ApprovePlanResponse, String> {
    let mut storage = state.storage.lock().expect("desktop storage poisoned");
    storage.approve_plan(request)
}

#[tauri::command]
pub fn get_plan_progress(
    state: State<'_, DesktopState>,
    request: PlanProgressRequest,
) -> Result<PlanProgressResponse, String> {
    let storage = state.storage.lock().expect("desktop storage poisoned");
    storage.get_plan_progress(request)
}
```

### app.rs に登録

```rust
tauri::generate_handler![
    // ... 既存
    crate::execution::approve_plan,
    crate::execution::get_plan_progress,
]
```

### storage.rs にメソッド追加

```rust
pub fn approve_plan(&mut self, request: ApprovePlanRequest) -> Result<ApprovePlanResponse, String> {
    // 承認されたステップ ID でフィルタし、修正ステップを反映した計画を返す
    // セッション/ターンに承認済み計画を保存
    let plan = serde_json::json!({
        "steps": request.approved_step_ids,
        "modifiedSteps": request.modified_steps
    });
    // TODO: ターンの items に "execution-plan" として保存
    Ok(ApprovePlanResponse {
        approved: true,
        plan,
    })
}

pub fn get_plan_progress(&self, request: PlanProgressRequest) -> Result<PlanProgressResponse, String> {
    // ターンの items から計画進行状態を読み取り
    // 初期状態では全ステップ pending
    Ok(PlanProgressResponse {
        current_step_id: None,
        completed_count: 0,
        total_count: 0,
        step_statuses: vec![],
    })
}
```

### ipc.ts に追加

```typescript
export async function approvePlan(request: ApprovePlanRequest): Promise<ApprovePlanResponse> {
  return invokeWithPayload("approve_plan", approvePlanRequestSchema, approvePlanResponseSchema, request);
}

export async function getPlanProgress(request: PlanProgressRequest): Promise<PlanProgressResponse> {
  return invokeWithPayload("get_plan_progress", planProgressRequestSchema, planProgressResponseSchema, request);
}
```

---

## Task 115: プラン承認 UI

### 実装場所

`apps/desktop/src/routes/+page.svelte` — 既存のエージェントループパネル付近に追加

### 実装内容

エージェントループ結果が `awaiting_plan_approval` の場合に表示するプランレビュー UI:

```svelte
{#if agentLoopResult?.status === 'awaiting_plan_approval' && agentLoopResult.proposedPlan}
  <div class="plan-review">
    <h3>実行計画の確認</h3>
    <p class="plan-summary">{agentLoopResult.proposedPlan.summary}</p>

    <div class="plan-steps">
      {#each planSteps as step, i (step.id)}
        <div class="plan-step-card" class:plan-step-write={step.phase === 'write'}>
          <span class="plan-step-number">{i + 1}</span>
          <span class="plan-step-phase-badge" class:badge-read={step.phase === 'read'} class:badge-write={step.phase === 'write'}>
            {step.phase === 'read' ? '📖 読み取り' : '✏️ 書き込み'}
          </span>
          <div class="plan-step-content">
            <div class="plan-step-description">{step.description}</div>
            <div class="plan-step-tool">{step.tool}</div>
            {#if step.estimatedEffect}
              <div class="plan-step-effect">{step.estimatedEffect}</div>
            {/if}
          </div>
          <button
            class="plan-step-remove"
            on:click={() => removeStep(i)}
            aria-label="ステップを削除"
          >✕</button>
        </div>
      {/each}
    </div>

    <div class="plan-actions">
      <button class="btn-primary" on:click={handleApprovePlan}>
        計画を承認して実行する ▶
      </button>
      <button class="btn-secondary" on:click={() => showReplanFeedback = true}>
        やり直しを依頼する
      </button>
      <button class="btn-ghost" on:click={handleCancelPlan}>
        キャンセル
      </button>
    </div>

    {#if showReplanFeedback}
      <div class="replan-feedback">
        <textarea
          bind:value={replanFeedback}
          placeholder="例: もっとシンプルにしてください / フィルタの前にカラム名を確認してください"
        ></textarea>
        <button class="btn-secondary" on:click={handleReplan}>
          フィードバックを送って再計画する
        </button>
      </div>
    {/if}
  </div>
{/if}
```

### ロジック（script セクション）

```typescript
let planSteps: PlanStep[] = [];
let showReplanFeedback = false;
let replanFeedback = '';

// agentLoopResult 変更時にステップを初期化
$: if (agentLoopResult?.proposedPlan) {
  planSteps = [...agentLoopResult.proposedPlan.steps];
}

function removeStep(index: number) {
  planSteps = planSteps.filter((_, i) => i !== index);
}

async function handleApprovePlan() {
  if (!agentLoopResult?.proposedPlan) return;
  const approvedPlan: ExecutionPlan = {
    ...agentLoopResult.proposedPlan,
    steps: planSteps,
    totalEstimatedSteps: planSteps.length
  };

  // プラン実行開始
  agentLoopResult = await resumeAgentLoopWithPlan(
    { ...agentLoopConfig, planningEnabled: false },
    approvedPlan,
    { ...agentLoopCallbacks, onStepStart, onStepComplete, onWriteStepReached }
  );
}

async function handleReplan() {
  // フィードバック付きで再度プランニング
  const replanPrompt = buildPlanningPrompt(
    `${objective}\n\n修正フィードバック: ${replanFeedback}`,
    workbookContext,
    availableTools
  );
  showReplanFeedback = false;
  replanFeedback = '';
  agentLoopResult = await runAgentLoop(
    { ...agentLoopConfig, initialPrompt: replanPrompt, planningEnabled: true },
    agentLoopCallbacks
  );
}

function handleCancelPlan() {
  agentLoopResult = null;
  planSteps = [];
}
```

---

## Task 116: 自律実行の進行状態表示

### 実装内容

プラン実行中にステップ別の進行状態をタイムライン表示:

```svelte
{#if isPlanExecuting}
  <div class="plan-execution-progress">
    <div class="plan-progress-header">
      実行中 (ステップ {currentStepIndex + 1} / {totalSteps})
    </div>
    {#each executionStepStatuses as stepStatus, i (stepStatus.stepId)}
      <div class="plan-progress-step" class:step-running={stepStatus.state === 'running'} class:step-completed={stepStatus.state === 'completed'} class:step-failed={stepStatus.state === 'failed'}>
        <span class="step-icon">
          {#if stepStatus.state === 'completed'}✓
          {:else if stepStatus.state === 'running'}⟳
          {:else if stepStatus.state === 'failed'}✗
          {:else}○{/if}
        </span>
        <span class="step-description">{stepStatus.description}</span>
        <span class="step-state-label">
          {#if stepStatus.state === 'running'}実行中...
          {:else if stepStatus.state === 'completed'}完了
          {:else if stepStatus.state === 'failed'}失敗
          {:else if stepStatus.state === 'pending' && stepStatus.phase === 'write'}[承認待ち]
          {/if}
        </span>
      </div>
    {/each}

    <div class="plan-execution-controls">
      {#if !isPaused}
        <button class="btn-ghost" on:click={handlePause}>一時停止</button>
      {:else}
        <button class="btn-secondary" on:click={handleResume}>再開</button>
      {/if}
      <button class="btn-ghost btn-danger" on:click={handleCancel}>キャンセル</button>
    </div>
  </div>
{/if}
```

---

## Task 117: 書き込みステップ承認ゲート

write ステップに到達すると、`resumeAgentLoopWithPlan` が `ready_to_write` で停止。
既存の SheetDiff / プレビュー表示パイプラインを再利用:

```typescript
async function onWriteStepReached(step: PlanStep, index: number) {
  // 既存の preview_execution → SheetDiff 表示 → 承認フローを起動
  // 承認後に resumeAgentLoopWithPlan を残りステップで再呼び出し
  writeApprovalStep = step;
  writeApprovalStepIndex = index;
  isPlanExecuting = false;
  // UI は既存のステップ3（確認して保存）表示に遷移
}
```

---

## Task 122: 設定 — 自律実行モード

### continuity.ts の変更

```typescript
const DEFAULT_BROWSER_AUTOMATION_SETTINGS = {
  cdpPort: 9333,
  autoLaunchEdge: true,
  timeoutMs: 60000,
  agentLoopEnabled: false,
  maxTurns: 10,
  loopTimeoutMs: 120000,
  planningEnabled: true,        // 追加
  autoApproveReadSteps: true,   // 追加
  pauseBetweenSteps: false      // 追加
} as const;
```

### +page.svelte 設定モーダルに追加

エージェントモードトグルの下に「自律実行」セクション:

```svelte
{#if browserSettings.agentLoopEnabled}
  <div class="settings-section">
    <h4>自律実行</h4>
    <label>
      <input type="checkbox" bind:checked={browserSettings.planningEnabled} />
      計画フェーズを有効にする（推奨）
    </label>
    <label>
      <input type="checkbox" bind:checked={browserSettings.autoApproveReadSteps} />
      読み取りステップを自動実行する
    </label>
    <label>
      <input type="checkbox" bind:checked={browserSettings.pauseBetweenSteps} />
      ステップ間で一時停止する（デバッグ用）
    </label>
  </div>
{/if}
```

---

## 実装順序

1. **Task 114** — バックエンド IPC（`approve_plan`, `get_plan_progress`）
2. **Task 121** — Contracts 拡張（ハンドオフコンテキスト）
3. **Task 115** — プラン承認 UI
4. **Task 116** — 進行状態表示
5. **Task 117** — write 承認ゲート
6. **Task 119** — キャンセル/一時停止
7. **Task 120** — 再プランニング
8. **Task 118** — 永続化
9. **Task 122** — 設定
10. **Task 123** — E2E 検証

## 検証チェックリスト

- [ ] `cargo check` と `cargo test` が成功する
- [ ] `pnpm typecheck` が成功する
- [ ] `pnpm check` が成功する
- [ ] プラン提案時にプランレビュー UI が表示される
- [ ] ステップの削除ができる
- [ ] 承認でプラン実行が開始される
- [ ] 実行中にステップごとの進行状態が表示される
- [ ] write ステップで実行が一時停止し、承認ゲートが表示される
- [ ] キャンセルで実行が停止する
- [ ] 一時停止→再開で実行が継続する
- [ ] フィードバック付き拒否で新しいプランが提案される
- [ ] 設定の planningEnabled が永続化する
- [ ] `planningEnabled=false` で従来のエージェントループ動作が維持される
