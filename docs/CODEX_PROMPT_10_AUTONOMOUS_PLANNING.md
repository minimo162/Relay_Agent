# Codex プロンプト 10 — 自律プランニング: Contracts & エージェントループ拡張（Tasks 109–113）

## 対象タスク

- **Task 109**: 設計 — 自律実行プランニングプロトコル
- **Task 110**: Contracts 拡張 — ExecutionPlan & PlanStep スキーマ
- **Task 111**: Contracts 拡張 — プラン承認 IPC スキーマ
- **Task 112**: フロントエンド — プランニングプロンプト生成
- **Task 113**: フロントエンド — エージェントループ拡張（プランニングフェーズ）

## 概要

現状のエージェントループは「Copilot が返した read actions を自動実行 → write 発見で停止」というリアクティブ型。
これを「まず Copilot に実行計画を立てさせ → ユーザーが計画を承認 → 自律実行」に進化させる。

**基本方針:**
- 既存の `runAgentLoop` を拡張（破壊変更なし — `planningEnabled: false` で従来動作）
- Contracts-first: まずスキーマ定義 → フロントエンド → バックエンド
- 計画フェーズは既存ループの最初のターンで実装
- write ステップの承認ゲートは既存の preview/approval フローを再利用

## 前提

### 既存ファイル

- `packages/contracts/src/relay.ts` — `agentLoopStatusSchema`, `copilotTurnResponseSchema`, `relayActionSchema`
- `packages/contracts/src/ipc.ts` — IPC リクエスト/レスポンススキーマ
- `packages/contracts/src/index.ts` — エクスポートバレル
- `apps/desktop/src/lib/agent-loop.ts` — `runAgentLoop`, `AgentLoopConfig`, `AgentLoopCallbacks`, `buildFollowUpPrompt`
- `apps/desktop/src/lib/ipc.ts` — `executeReadActions` 等の IPC ラッパー
- `apps/desktop/src/lib/copilot-browser.ts` — `sendToCopilot`

### 既存の agentLoopStatusSchema

```typescript
export const agentLoopStatusSchema = z.enum([
  "thinking",
  "ready_to_write",
  "done",
  "error"
]);
```

### 既存の copilotTurnResponseSchema

```typescript
export const copilotTurnResponseSchema = z.object({
  version: z.literal("1.0").default("1.0"),
  status: agentLoopStatusSchema.default("ready_to_write"),
  summary: nonEmptyStringSchema,
  actions: z.array(relayActionSchema).default([]),
  message: z.string().optional(),
  followupQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});
```

### 既存の AgentLoopConfig

```typescript
export type AgentLoopConfig = {
  sessionId: string;
  turnId: string;
  initialPrompt: string;
  maxTurns: number;
  loopTimeoutMs: number;
  abortSignal?: AbortSignal;
};
```

---

## Task 109: 設計ドキュメント

### 実装場所

`docs/AUTONOMOUS_EXECUTION_DESIGN.md` — 新規作成

### 内容

以下のセクションを含むマークダウンドキュメント:

1. **状態遷移図** — 既存ループ + プランニングフェーズの統合
2. **プランニングプロンプト仕様** — Copilot に計画を返させるプロンプト構造
3. **ExecutionPlan / PlanStep スキーマ仕様** — フィールド定義と型
4. **承認プロトコル** — 承認/修正/拒否のフロー
5. **安全ガード** — 最大ステップ数、タイムアウト、write 承認必須

### 状態遷移

```
idle
  → planning (planningEnabled=true の場合、最初のターン)
  → thinking (planningEnabled=false の場合、従来動作)

planning
  → plan_proposed (Copilot が計画を返した)
  → thinking (Copilot が計画なしで read actions を返した — フォールバック)
  → error

plan_proposed
  → awaiting_plan_approval (UI に計画表示)

awaiting_plan_approval
  → executing (ユーザーが承認)
  → planning (ユーザーが修正フィードバック付きで拒否)
  → idle (ユーザーがキャンセル)

executing
  → awaiting_step_approval (write ステップに到達)
  → completed (全ステップ完了)
  → error

awaiting_step_approval
  → executing (承認)
  → executing (スキップ)
  → idle (キャンセル)
```

---

## Task 110: Contracts 拡張 — ExecutionPlan & PlanStep

### 実装場所

`packages/contracts/src/relay.ts`

### 追加するスキーマ

**`agentLoopStatusSchema` を拡張:**

```typescript
export const agentLoopStatusSchema = z.enum([
  "thinking",
  "ready_to_write",
  "done",
  "error",
  "plan_proposed"  // 追加
]);
```

**`planStepSchema` — 新規:**

```typescript
export const planStepSchema = z.object({
  id: z.string().min(1),
  description: nonEmptyStringSchema,
  tool: z.string().min(1),
  phase: toolPhaseSchema,
  args: z.record(z.unknown()).optional(),
  estimatedEffect: z.string().default("")
});
```

**`executionPlanSchema` — 新規:**

```typescript
export const executionPlanSchema = z.object({
  steps: z.array(planStepSchema).min(1),
  summary: nonEmptyStringSchema,
  totalEstimatedSteps: z.number().int().positive()
});
```

**`copilotTurnResponseSchema` を拡張:**

```typescript
export const copilotTurnResponseSchema = z.object({
  version: z.literal("1.0").default("1.0"),
  status: agentLoopStatusSchema.default("ready_to_write"),
  summary: nonEmptyStringSchema,
  actions: z.array(relayActionSchema).default([]),
  executionPlan: executionPlanSchema.optional(),  // 追加
  message: z.string().optional(),
  followupQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});
```

**型エクスポート追加:**

```typescript
export type PlanStep = z.infer<typeof planStepSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
```

### `packages/contracts/src/index.ts` のエクスポート追加

```typescript
export {
  // ... 既存のエクスポート
  planStepSchema,
  executionPlanSchema,
  type PlanStep,
  type ExecutionPlan
} from "./relay";
```

### 後方互換性

- `executionPlan` は optional — 既存レスポンス（計画なし）は正常にパース
- `plan_proposed` が `status` に追加されるが、既存コードは `thinking`/`ready_to_write`/`done`/`error` のみチェックしているので影響なし
- `agent-loop.ts` の line 108-122 で `ready_to_write`/`done`/`error` をチェックしているが、`plan_proposed` はこれに含まれないのでループが継続する問題がある → Task 113 で対応

---

## Task 111: Contracts 拡張 — プラン承認 IPC スキーマ

### 実装場所

`packages/contracts/src/ipc.ts`

### 追加するスキーマ

```typescript
import { executionPlanSchema, planStepSchema } from "./relay";

// ── プラン承認 ──

export const planStepStatusSchema = z.object({
  stepId: z.string().min(1),
  state: z.enum(["pending", "running", "completed", "skipped", "failed"]),
  result: z.unknown().optional(),
  error: z.string().optional()
});

export const approvePlanRequestSchema = z.object({
  sessionId: entityIdSchema,
  turnId: entityIdSchema,
  approvedStepIds: z.array(z.string()),
  modifiedSteps: z.array(planStepSchema).default([])
});

export const approvePlanResponseSchema = z.object({
  approved: z.boolean(),
  plan: executionPlanSchema
});

export const planProgressRequestSchema = z.object({
  sessionId: entityIdSchema,
  turnId: entityIdSchema
});

export const planProgressResponseSchema = z.object({
  currentStepId: z.string().nullable(),
  completedCount: z.number().int().min(0),
  totalCount: z.number().int().min(0),
  stepStatuses: z.array(planStepStatusSchema)
});
```

### 型エクスポート

```typescript
export type PlanStepStatus = z.infer<typeof planStepStatusSchema>;
export type ApprovePlanRequest = z.infer<typeof approvePlanRequestSchema>;
export type ApprovePlanResponse = z.infer<typeof approvePlanResponseSchema>;
export type PlanProgressRequest = z.infer<typeof planProgressRequestSchema>;
export type PlanProgressResponse = z.infer<typeof planProgressResponseSchema>;
```

`packages/contracts/src/index.ts` から上記をすべてエクスポート。

---

## Task 112: プランニングプロンプト生成

### 実装場所

`apps/desktop/src/lib/agent-loop.ts` — 既存ファイルに関数追加

### 追加する関数

```typescript
export function buildPlanningPrompt(
  objective: string,
  workbookContext: string,
  availableTools: { read: string[]; write: string[] }
): string {
  const sections = [
    "Relay Agent からの依頼です。",
    "",
    "## やりたいこと",
    objective.trim(),
    "",
    "## 対象ファイル情報",
    workbookContext.trim(),
    "",
    "## 使ってよい操作",
    "",
    "### 読み取りツール（自動実行されます）",
    ...availableTools.read.map((t) => `- ${t}`),
    "",
    "### 書き込みツール（ユーザーの承認後に実行されます）",
    ...availableTools.write.map((t) => `- ${t}`),
    "",
    "## 回答ルール",
    "",
    "**まず実行計画を JSON で返してください。**",
    "すぐにアクションを実行せず、まずステップの計画を返してください。",
    "",
    "- JSON のみを返してください。```で囲まないでください。",
    "- パス区切りは / を使ってください。",
    "- status は必ず `\"plan_proposed\"` にしてください。",
    "",
    "## 回答テンプレート",
    "",
    "```",
    JSON.stringify(
      {
        version: "1.0",
        status: "plan_proposed",
        summary: "何をするかの概要",
        actions: [],
        executionPlan: {
          summary: "全体の計画説明",
          totalEstimatedSteps: 3,
          steps: [
            {
              id: "step-1",
              description: "ファイル構造を確認する",
              tool: "workbook.inspect",
              phase: "read",
              estimatedEffect: "シート一覧と列情報を取得"
            },
            {
              id: "step-2",
              description: "データの内容を確認する",
              tool: "sheet.preview",
              phase: "read",
              estimatedEffect: "サンプル行を取得"
            },
            {
              id: "step-3",
              description: "条件に合う行を抽出して保存する",
              tool: "table.filter_rows",
              phase: "write",
              estimatedEffect: "条件に合う行のみのコピーを作成"
            }
          ]
        }
      },
      null,
      2
    ),
    "```"
  ];

  return sections.join("\n");
}
```

### 注意事項

- `actions` は空配列で返す（計画フェーズではアクションは実行しない）
- `workbookContext` は呼び出し元が `buildCopilotInstructionText` から生成（既存ロジック再利用）
- プロンプトテンプレート内の JSON 例の `"` は `JSON.stringify` で自動エスケープされるため手動エスケープ不要

---

## Task 113: エージェントループ拡張

### 実装場所

`apps/desktop/src/lib/agent-loop.ts`

### 1. 型定義の拡張

```typescript
import {
  copilotTurnResponseSchema,
  type CopilotTurnResponse,
  type ToolExecutionResult,
  type ExecutionPlan,      // 追加
  type PlanStep            // 追加
} from "@relay-agent/contracts";

export type AgentLoopConfig = {
  sessionId: string;
  turnId: string;
  initialPrompt: string;
  maxTurns: number;
  loopTimeoutMs: number;
  abortSignal?: AbortSignal;
  planningEnabled?: boolean;  // 追加（デフォルト false）
};

export type AgentLoopCallbacks = {
  onBrowserProgress?: (event: BrowserCommandProgress) => void;
  onTurnStart?: (turn: number, prompt: string) => void;
  onCopilotResponse?: (
    turn: number,
    response: CopilotTurnResponse,
    rawResponse: string
  ) => void;
  onToolResults?: (turn: number, toolResults: ToolExecutionResult[]) => void;
  onComplete?: (result: AgentLoopResult) => void;
  onPlanProposed?: (plan: ExecutionPlan) => void;  // 追加
};

export type AgentLoopResult = {
  status: CopilotTurnResponse["status"] | "cancelled" | "awaiting_plan_approval";  // 拡張
  finalResponse: CopilotTurnResponse | null;
  turns: LoopTurnResult[];
  summary: string;
  proposedPlan?: ExecutionPlan;  // 追加
};
```

### 2. `runAgentLoop` の変更

既存の `runAgentLoop` 内のループ先頭（line 55 の `for` の直後）に計画検出を追加:

```typescript
export async function runAgentLoop(
  config: AgentLoopConfig,
  callbacks: AgentLoopCallbacks = {}
): Promise<AgentLoopResult> {
  const startedAt = Date.now();
  const turns: LoopTurnResult[] = [];
  let prompt = config.initialPrompt;

  for (let turn = 1; turn <= config.maxTurns; turn += 1) {
    throwIfAborted(config.abortSignal);
    callbacks.onTurnStart?.(turn, prompt);

    const rawResponse = await raceWithAbort(
      withTimeout(
        sendToCopilot(prompt, {
          onProgress: callbacks.onBrowserProgress
        }),
        config.loopTimeoutMs,
        `ターン ${turn} の Copilot 応答がタイムアウトしました（${Math.round(config.loopTimeoutMs / 1000)}秒）。`
      ),
      config.abortSignal
    );
    const parsedResponse = copilotTurnResponseSchema.parse(JSON.parse(rawResponse));
    callbacks.onCopilotResponse?.(turn, parsedResponse, rawResponse);

    // ── 計画検出（新規） ──────────────────────────────────────────────
    if (
      parsedResponse.status === "plan_proposed" &&
      parsedResponse.executionPlan
    ) {
      callbacks.onPlanProposed?.(parsedResponse.executionPlan);
      const turnResult: LoopTurnResult = {
        turn,
        prompt,
        rawResponse,
        parsedResponse,
        toolResults: [],
        hasWriteActions: false
      };
      turns.push(turnResult);
      const result: AgentLoopResult = {
        status: "awaiting_plan_approval",
        finalResponse: parsedResponse,
        turns,
        summary: parsedResponse.executionPlan.summary,
        proposedPlan: parsedResponse.executionPlan
      };
      callbacks.onComplete?.(result);
      return result;
    }
    // ── 計画検出ここまで ──────────────────────────────────────────────

    // ... 既存の read action 実行ロジック（変更なし）
```

### 3. `resumeAgentLoopWithPlan` — 新規関数

```typescript
/**
 * 承認済みプランのステップを逐次実行するエージェントループ。
 * 各ステップで Copilot にアクション指示を送り、結果を蓄積する。
 * write ステップに到達したら停止して呼び出し元に返す。
 */
export async function resumeAgentLoopWithPlan(
  config: AgentLoopConfig,
  plan: ExecutionPlan,
  callbacks: AgentLoopCallbacks & {
    onStepStart?: (step: PlanStep, index: number) => void;
    onStepComplete?: (step: PlanStep, index: number, result: ToolExecutionResult) => void;
    onWriteStepReached?: (step: PlanStep, index: number) => void;
  } = {}
): Promise<AgentLoopResult> {
  const turns: LoopTurnResult[] = [];
  const completedResults: ToolExecutionResult[] = [];

  for (let i = 0; i < plan.steps.length; i++) {
    throwIfAborted(config.abortSignal);
    const step = plan.steps[i];
    callbacks.onStepStart?.(step, i);

    // write ステップは停止して承認待ち
    if (step.phase === "write") {
      callbacks.onWriteStepReached?.(step, i);

      // 残りのステップを含む部分プランを返す
      const result: AgentLoopResult = {
        status: "ready_to_write",
        finalResponse: null,
        turns,
        summary: `Write step reached: ${step.description}`,
        proposedPlan: {
          ...plan,
          steps: plan.steps.slice(i) // 残りステップ
        }
      };
      callbacks.onComplete?.(result);
      return result;
    }

    // read ステップ: Copilot に具体的なアクション生成を依頼
    const stepPrompt = buildStepExecutionPrompt(
      config.initialPrompt,
      step,
      completedResults
    );

    const turn = i + 1;
    callbacks.onTurnStart?.(turn, stepPrompt);

    const rawResponse = await raceWithAbort(
      withTimeout(
        sendToCopilot(stepPrompt, {
          onProgress: callbacks.onBrowserProgress
        }),
        config.loopTimeoutMs,
        `ステップ ${turn} がタイムアウトしました。`
      ),
      config.abortSignal
    );
    const parsedResponse = copilotTurnResponseSchema.parse(JSON.parse(rawResponse));
    callbacks.onCopilotResponse?.(turn, parsedResponse, rawResponse);

    // read actions を実行
    const readOutcome = await executeReadActions({
      sessionId: config.sessionId,
      turnId: config.turnId,
      loopTurn: turn,
      maxTurns: plan.steps.length,
      actions: parsedResponse.actions
    });
    callbacks.onToolResults?.(turn, readOutcome.toolResults);

    completedResults.push(...readOutcome.toolResults);
    callbacks.onStepComplete?.(step, i, readOutcome.toolResults[0] ?? {
      tool: step.tool,
      ok: true,
      result: null,
      error: null
    });

    turns.push({
      turn,
      prompt: stepPrompt,
      rawResponse,
      parsedResponse,
      toolResults: readOutcome.toolResults,
      hasWriteActions: readOutcome.hasWriteActions
    });
  }

  // 全ステップ完了
  const result: AgentLoopResult = {
    status: "done",
    finalResponse: turns[turns.length - 1]?.parsedResponse ?? null,
    turns,
    summary: `全 ${plan.steps.length} ステップが完了しました。`
  };
  callbacks.onComplete?.(result);
  return result;
}

/**
 * プランの個別ステップ実行用プロンプトを生成
 */
function buildStepExecutionPrompt(
  originalTask: string,
  step: PlanStep,
  priorResults: ToolExecutionResult[]
): string {
  const sections = [
    "Relay Agent task continuation.",
    "Return strict JSON only. Do not include markdown fences.",
    "",
    `Original task: ${originalTask.trim()}`,
    "",
    `Current step: ${step.description}`,
    `Tool to use: ${step.tool}`,
    ""
  ];

  if (priorResults.length > 0) {
    sections.push("Prior step results:");
    for (const result of priorResults) {
      sections.push(`- ${result.tool}: ${result.ok ? "success" : `error: ${result.error}`}`);
      if (result.ok && result.result) {
        const summary = JSON.stringify(result.result).slice(0, 500);
        sections.push(`  ${summary}`);
      }
    }
    sections.push("");
  }

  sections.push(
    `Return a JSON response with status "thinking" and actions array containing the ${step.tool} action.`,
    `Use the tool "${step.tool}" with appropriate args for this step.`
  );

  return sections.join("\n");
}
```

---

## 実装順序

1. **Task 109** — 設計ドキュメント作成（他のタスクのリファレンス）
2. **Task 110** — relay.ts のスキーマ拡張（Contracts 変更）
3. **Task 111** — ipc.ts のスキーマ追加（Contracts 変更）
4. **Task 112** — `buildPlanningPrompt` 関数追加
5. **Task 113** — `runAgentLoop` 拡張 + `resumeAgentLoopWithPlan` 追加

## 検証チェックリスト

- [ ] `pnpm --filter @relay-agent/contracts typecheck` が成功する
- [ ] `pnpm --filter @relay-agent/desktop typecheck` が成功する
- [ ] 既存の `copilotTurnResponseSchema` で `executionPlan` なしの JSON がパース成功する（後方互換）
- [ ] `plan_proposed` ステータスの JSON がパース成功する
- [ ] `planningEnabled: false`（または未指定）で `runAgentLoop` が従来と同一動作する
- [ ] `planningEnabled: true` で `plan_proposed` レスポンスが返った時に `awaiting_plan_approval` で停止する
- [ ] `resumeAgentLoopWithPlan` が read ステップを逐次実行する
- [ ] `resumeAgentLoopWithPlan` が write ステップで `ready_to_write` を返して停止する
- [ ] `AbortSignal` によるキャンセルが `resumeAgentLoopWithPlan` でも動作する
- [ ] `buildPlanningPrompt` の出力に目標・ツール一覧・計画応答テンプレートが含まれる
