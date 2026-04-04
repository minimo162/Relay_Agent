# Codex プロンプト 14 — 実装品質改善（コードレビュー指摘事項）

## 概要

Phase 4–6 の Codex 実装をレビューした結果、以下の改善が必要。
安全性・堅牢性・テストカバレッジに関する修正を行う。

**原則:**
- 既存の動作を壊さない（既存テストはすべてパスすること）
- 最小限の変更で最大の効果を狙う
- 型安全性を高め、ランタイムエラーの可能性を減らす

## 前提 — 現在のファイル構成

### TypeScript (フロントエンド)
- `packages/contracts/src/relay.ts` — `planStepSchema`, `executionPlanSchema` 等
- `apps/desktop/src/lib/agent-loop.ts` — `runAgentLoop`, `resumeAgentLoopWithPlan`
- `apps/desktop/src/lib/agent-loop-core.ts` — `requestCopilotTurn`, `raceWithAbort`, `throwIfAborted`
- `apps/desktop/src/lib/prompt-templates.ts` — プロンプトビルダー群
- `apps/desktop/src/lib/agent-loop-prompts.ts` — `buildPlanningPrompt`, `buildStepExecutionPrompt`
- `apps/desktop/src/lib/stores/delegation.ts` — `delegationStore`, `activityFeedStore`
- `apps/desktop/src/lib/components/ChatComposer.svelte`

### Rust (バックエンド)
- `apps/desktop/src-tauri/src/models.rs` — 型定義
- `apps/desktop/src-tauri/src/storage.rs` — `approve_plan`, `get_plan_progress`, `record_plan_progress`

### テスト
- `apps/desktop/src/lib/agent-loop-core.test.ts`
- `apps/desktop/src/lib/agent-loop-prompts.test.ts`
- `apps/desktop/src/lib/prompt-templates.test.ts`
- `apps/desktop/src/lib/stores/delegation.test.ts`

---

## 修正 1: Rust — ExecutionPlan / PlanStep の型安全化【HIGH】

### 問題

`models.rs` の `CopilotTurnResponse.execution_plan` が `Option<Value>`（生 JSON）。
`storage.rs` の `approve_plan()` でも `modified_steps: Vec<Value>` で受け取り、
`step.get("id")` のような動的アクセスに依存している。
TypeScript 側は Zod で型安全だが、Rust 側はバリデーションなし。

### 修正内容

#### `apps/desktop/src-tauri/src/models.rs`

以下の struct/enum を追加:

```rust
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStepPhase {
    Read,
    Write,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub id: String,
    pub tool: String,
    pub description: String,
    pub phase: PlanStepPhase,
    pub args: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlan {
    pub summary: String,
    pub total_estimated_steps: u32,
    pub steps: Vec<PlanStep>,
}
```

#### `CopilotTurnResponse` を更新:

```rust
// before:
pub execution_plan: Option<Value>,

// after:
pub execution_plan: Option<ExecutionPlan>,
```

#### `ApprovePlanRequest` を更新:

```rust
// before:
pub modified_steps: Vec<Value>,

// after:
pub modified_steps: Vec<PlanStep>,
```

#### `ApprovePlanResponse` を更新:

```rust
// before:
pub plan: Value,

// after:
pub plan: ExecutionPlan,
```

#### `ExecutionPlanArtifactPayload` (storage.rs 内) を更新:

```rust
// before:
struct ExecutionPlanArtifactPayload {
    plan: Value,
}

// after:
struct ExecutionPlanArtifactPayload {
    plan: ExecutionPlan,
}
```

#### `PlanStepStatus.state` を enum 化:

```rust
#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStepState {
    Pending,
    Running,
    Completed,
    Skipped,
    Failed,
}

// PlanStepStatus を更新:
pub struct PlanStepStatus {
    pub step_id: String,
    pub state: PlanStepState,  // String → PlanStepState
    // ...
}
```

#### `storage.rs` の `approve_plan()` を型安全に書き換え:

```rust
pub fn approve_plan(
    &mut self,
    request: ApprovePlanRequest,
) -> Result<ApprovePlanResponse, String> {
    let (session, turn) = self.get_session_and_turn(&request.session_id, &request.turn_id)?;
    let approved_steps: Vec<PlanStep> = request
        .modified_steps
        .into_iter()
        .filter(|step| {
            request.approved_step_ids.iter().any(|id| id == &step.id)
        })
        .collect();

    if approved_steps.is_empty() {
        return Err("at least one approved plan step is required".to_string());
    }

    let plan = ExecutionPlan {
        summary: format!("Approved plan for `{}`", turn.title),
        total_estimated_steps: approved_steps.len() as u32,
        steps: approved_steps,
    };

    let step_statuses: Vec<PlanStepStatus> = plan
        .steps
        .iter()
        .map(|step| PlanStepStatus {
            step_id: step.id.clone(),
            state: PlanStepState::Pending,
            result: None,
            error: None,
        })
        .collect();

    // ... rest of logic unchanged, but use typed plan instead of json!({...})
```

同様に `get_plan_progress()` 内の `plan.get("steps").and_then(Value::as_array)` パターンも
`plan.steps.iter()` に置き換える。

### 確認事項

- `cargo build` がエラーなくパスすること
- 既存の IPC フロントエンド呼び出しとの JSON 互換性を維持すること（`serde(rename_all = "camelCase")` で保証）

---

## 修正 2: conversationHistory の上限管理【MEDIUM】

### 問題

`agent-loop-core.ts` の `requestCopilotTurn` で `conversationHistory` に push し続けるが、
上限チェックがない。長時間のエージェントループではメモリが際限なく増加する。

### 修正内容

#### `apps/desktop/src/lib/agent-loop-core.ts`

`requestCopilotTurn` 内、history に push した直後にトリミングを追加:

```typescript
const MAX_CONVERSATION_HISTORY = 30;

// push 後に追加（2 箇所: user push と assistant push の各後）
if (params.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
  // 最初の 2 エントリ（初期コンテキスト）を保持し、古い中間エントリを削除
  const preserved = params.conversationHistory.slice(0, 2);
  const recent = params.conversationHistory.slice(-MAX_CONVERSATION_HISTORY + 2);
  params.conversationHistory.length = 0;
  params.conversationHistory.push(...preserved, ...recent);
}
```

ヘルパー関数として抽出してもよい:

```typescript
function trimConversationHistory(
  history: CopilotConversationTurn[],
  maxSize = 30,
  preserveHead = 2
): void {
  if (history.length <= maxSize) return;
  const preserved = history.slice(0, preserveHead);
  const recent = history.slice(-(maxSize - preserveHead));
  history.length = 0;
  history.push(...preserved, ...recent);
}
```

### テスト追加 — `agent-loop-core.test.ts`

```typescript
test("conversationHistory is trimmed when exceeding max size", async () => {
  // 40 エントリの conversationHistory を渡して requestCopilotTurn を呼び、
  // 結果の history が MAX_CONVERSATION_HISTORY 以下であることを確認
});
```

---

## 修正 3: raceWithAbort のメモリリーク修正【MEDIUM】

### 問題

`agent-loop-core.ts` の `raceWithAbort` で、promise が先に resolve した場合、
`signal.addEventListener("abort", ...)` で登録したリスナーが解除されず残る。
AbortSignal はループ全体で共有されるため、ターンごとにリスナーが蓄積する。

### 修正内容

```typescript
export function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    throwIfAborted(signal);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const error = new Error("Agent loop cancelled.");
      error.name = "AbortError";
      reject(error);
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
```

### テスト追加 — `agent-loop-core.test.ts`

```typescript
test("raceWithAbort cleans up abort listener when promise resolves", async () => {
  const controller = new AbortController();
  const promise = Promise.resolve("done");
  const result = await raceWithAbort(promise, controller.signal);
  assert.equal(result, "done");
  // Signal should have no lingering listeners (verify no leak)
});

test("raceWithAbort rejects when signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => raceWithAbort(Promise.resolve("done"), controller.signal),
    { name: "AbortError" }
  );
});
```

---

## 修正 4: ChatComposer のファイルパス表示 — Windows 対応【LOW】

### 問題

`ChatComposer.svelte` の 91 行目:
```svelte
📎 {file.split("/").pop()}
```

Tauri のファイルダイアログは OS ネイティブのパスを返すため、
Windows では `C:\Users\foo\bar.csv` のようなバックスラッシュパスになる。
`split("/")` だとファイル名を正しく抽出できない。

### 修正内容

`ChatComposer.svelte` 内で以下のヘルパーを追加:

```typescript
function basename(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSep < 0 ? filePath : filePath.slice(lastSep + 1);
}
```

テンプレート内の 2 箇所を更新:

```svelte
<!-- line 91 -->
📎 {basename(file)}

<!-- line 102 -->
📎 {basename(file.path)}
```

---

## 修正 5: テストカバレッジ拡充【MEDIUM】

### 5a. `agent-loop-core.test.ts` — 不足テスト追加

```typescript
test("throwIfAborted throws AbortError when signal is aborted", () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => throwIfAborted(controller.signal), { name: "AbortError" });
});

test("throwIfAborted does nothing when signal is not aborted", () => {
  const controller = new AbortController();
  assert.doesNotThrow(() => throwIfAborted(controller.signal));
});

test("throwIfAborted does nothing when signal is undefined", () => {
  assert.doesNotThrow(() => throwIfAborted(undefined));
});

test("withTimeout rejects after timeout", async () => {
  const slowPromise = new Promise<string>((resolve) =>
    setTimeout(() => resolve("late"), 5000)
  );
  await assert.rejects(
    () => withTimeout(slowPromise, 50, "timed out"),
    { message: "timed out" }
  );
});

test("withTimeout resolves if promise completes before timeout", async () => {
  const fastPromise = Promise.resolve("fast");
  const result = await withTimeout(fastPromise, 1000, "timed out");
  assert.equal(result, "fast");
});

test("requestCopilotTurn retries on parse error and returns fallback after max retries", async () => {
  let callCount = 0;
  const history: CopilotConversationTurn[] = [];

  const result = await requestCopilotTurn({
    turn: 1,
    prompt: "test",
    originalTask: "test",
    loopTimeoutMs: 5000,
    maxRetries: 1,
    callbacks: {},
    sendToCopilot: async () => {
      callCount++;
      return "not json";
    },
    conversationHistory: history,
    timeoutMessage: "timeout"
  });

  assert.equal(callCount, 2); // 1 initial + 1 retry
  assert.ok("manualFallback" in result);
});
```

### 5b. `prompt-templates.test.ts` — 不足テスト追加

```typescript
test("buildStepExecutionPrompt includes step tool and description", () => {
  const prompt = buildStepExecutionPrompt(
    "CSV を変換する",
    { id: "s1", tool: "sheet.filter_rows", description: "行をフィルタ", phase: "read", args: {} },
    [],
    {}
  );
  assert.ok(prompt.includes("sheet.filter_rows"));
  assert.ok(prompt.includes("行をフィルタ"));
});

test("buildErrorRecoveryPrompt generates level 3 fallback message", () => {
  const prompt = buildErrorRecoveryPrompt({
    originalTask: "test task",
    errorDescription: "JSON parse error",
    retryLevel: 3,
    lastValidResponse: undefined
  });
  assert.ok(prompt.includes("test task"));
  assert.ok(typeof prompt === "string" && prompt.length > 0);
});

test("buildCompressedContext limits to maxFullTurns", () => {
  const summaries: TurnSummary[] = Array.from({ length: 5 }, (_, i) => ({
    turn: i + 1,
    toolsUsed: ["tool_a"],
    keyFindings: ["finding"],
    status: "thinking"
  }));
  const result = buildCompressedContext(summaries, 2);
  assert.ok(typeof result === "string");
});
```

### 5c. `delegation.test.ts` — ライフサイクルテスト追加

```typescript
test("delegation store complete lifecycle: goal → planning → plan_review → executing → completed", () => {
  delegationStore.reset();
  delegationStore.setGoal("テスト目標", ["/tmp/a.csv"]);
  delegationStore.startPlanning();
  delegationStore.proposePlan({
    summary: "テスト計画",
    totalEstimatedSteps: 2,
    steps: [
      { id: "s1", tool: "sheet.filter_rows", description: "フィルタ", phase: "read", args: {} },
      { id: "s2", tool: "sheet.write_csv", description: "書き出し", phase: "write", args: {} }
    ]
  });

  let state = get(delegationStore);
  assert.equal(state.state, "plan_review");
  assert.ok(state.plan !== null);

  delegationStore.approvePlan();
  state = get(delegationStore);
  assert.equal(state.state, "executing");
  assert.equal(state.currentStepIndex, 0);

  delegationStore.advanceStep();
  state = get(delegationStore);
  assert.equal(state.currentStepIndex, 1);

  delegationStore.complete();
  state = get(delegationStore);
  assert.equal(state.state, "completed");
});

test("delegation store hydrate restores state", () => {
  delegationStore.reset();
  delegationStore.hydrate({
    state: "executing",
    goal: "復元テスト",
    attachedFiles: ["/tmp/b.csv"],
    currentStepIndex: 3
  });

  const state = get(delegationStore);
  assert.equal(state.state, "executing");
  assert.equal(state.goal, "復元テスト");
  assert.equal(state.currentStepIndex, 3);
});

test("delegation store error state", () => {
  delegationStore.reset();
  delegationStore.setGoal("失敗テスト", []);
  delegationStore.startPlanning();
  delegationStore.setError("Copilot connection failed");

  const state = get(delegationStore);
  assert.equal(state.state, "error");
  assert.equal(state.error, "Copilot connection failed");
});
```

---

## 修正 6: ActivityFeedStore の上限管理【LOW】

### 問題

`delegation.ts` の `activityFeedStore` も上限なく `push` し続ける。
長時間セッションでメモリとレンダリングに影響する。

### 修正内容

```typescript
const MAX_ACTIVITY_EVENTS = 200;

function createActivityFeedStore() {
  const { subscribe, set, update } = writable<ActivityFeedEvent[]>([]);

  return {
    subscribe,
    push(event: Omit<ActivityFeedEvent, "id" | "timestamp">) {
      update((events) => {
        const next = [
          ...events,
          {
            ...event,
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString()
          }
        ];
        // 上限を超えた場合、古いイベントを削除（actionRequired なものは保持）
        if (next.length > MAX_ACTIVITY_EVENTS) {
          return next.slice(-MAX_ACTIVITY_EVENTS);
        }
        return next;
      });
    },
    hydrate(snapshot: ActivityFeedEvent[]) {
      set(snapshot.slice(-MAX_ACTIVITY_EVENTS));
    },
    clear() {
      set([]);
    }
  };
}
```

---

## 実装順序

1. **修正 3** — `raceWithAbort` のメモリリーク修正（最小変更、即効果）
2. **修正 2** — `conversationHistory` 上限管理
3. **修正 1** — Rust 型安全化（最大の変更だが最も重要）
4. **修正 5** — テスト追加（修正 1–3 の検証を含む）
5. **修正 4** — ChatComposer の Windows パス対応
6. **修正 6** — ActivityFeed 上限管理

## 検証チェックリスト

- [ ] `cargo build` がエラーなくパスすること
- [ ] `pnpm -C packages/contracts build` がパスすること
- [ ] `pnpm -C apps/desktop exec tsx --test src/lib/agent-loop-core.test.ts` — 全テストパス
- [ ] `pnpm -C apps/desktop exec tsx --test src/lib/prompt-templates.test.ts` — 全テストパス
- [ ] `pnpm -C apps/desktop exec tsx --test src/lib/agent-loop-prompts.test.ts` — 全テストパス
- [ ] `pnpm -C apps/desktop exec tsx --test src/lib/stores/delegation.test.ts` — 全テストパス
- [ ] 既存テストが全てパスすること（リグレッションなし）
- [ ] `CopilotTurnResponse` の JSON シリアライズが TS スキーマと互換であること
