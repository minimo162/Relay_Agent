# Codex プロンプト 13 — M365 Copilot 統合強化（Tasks 138–143）

## 対象タスク

- **Task 138**: プロンプトエンジニアリング — 多ターン会話最適化
- **Task 139**: コンテキストウィンドウ管理 — 過去ターンの要約
- **Task 140**: エラーリカバリ — リトライ戦略強化
- **Task 141**: 構造化会話履歴 — Copilot セッション管理
- **Task 142**: 複数 Copilot セッション探索
- **Task 143**: E2E 検証 — 強化 Copilot 連携（手動）

## 概要

M365 Copilot は API アクセスが利用できず、Edge CDP 経由で対話する制約がある。
この制約内で、プロンプト品質・コンテキスト管理・エラー耐性を最大化する。

## 前提

- `apps/desktop/src/lib/agent-loop.ts` — `runAgentLoop`, `buildFollowUpPrompt`, `buildPlanningPrompt`
- `apps/desktop/src/lib/copilot-browser.ts` — `sendToCopilot`

---

## Task 138: プロンプトテンプレート最適化

### 実装場所

`apps/desktop/src/lib/prompt-templates.ts` — 新規

### 実装内容

```typescript
/**
 * プランニングフェーズ用プロンプト（chain-of-thought + few-shot）
 */
export function buildPlanningPromptV2(params: {
  objective: string;
  workbookContext: string;
  readTools: string[];
  writeTools: string[];
  priorAttemptFeedback?: string;
}): string {
  const sections = [
    "# Relay Agent — 実行計画の作成",
    "",
    "あなたは Relay Agent のアシスタントです。",
    "ユーザーの目標を達成するための実行計画を JSON で返してください。",
    "",
    "## 思考プロセス（これに従って計画を立ててください）",
    "",
    "1. 目標を理解する — ユーザーは何を達成したいか？",
    "2. データを確認する — どのツールで情報を集めるべきか？",
    "3. 計画を立てる — どの順序で操作すればよいか？",
    "4. 安全を確認する — 書き込み操作は最小限か？",
    "",
    "## ユーザーの目標",
    params.objective.trim(),
    "",
    "## 対象ファイル情報",
    params.workbookContext.trim(),
    "",
    "## 使えるツール",
    "",
    "### 読み取り（自動実行 — 承認不要）",
    ...params.readTools.map((t) => `- ${t}`),
    "",
    "### 書き込み（ユーザー承認が必要）",
    ...params.writeTools.map((t) => `- ${t}`),
  ];

  if (params.priorAttemptFeedback) {
    sections.push(
      "",
      "## 前回の計画に対するフィードバック",
      params.priorAttemptFeedback
    );
  }

  sections.push(
    "",
    "## 回答ルール",
    "- JSON のみ。``` で囲まない。",
    '- status は "plan_proposed" にする。',
    "- 読み取りツールを先に、書き込みツールを最後に配置する。",
    "- 各ステップに phase (read/write) を明記する。",
    "",
    "## 回答例",
    "```json",
    JSON.stringify({
      version: "1.0",
      status: "plan_proposed",
      summary: "approved が true の行を抽出して保存します",
      actions: [],
      executionPlan: {
        summary: "3 ステップで完了: 構造確認 → データ確認 → 抽出保存",
        totalEstimatedSteps: 3,
        steps: [
          { id: "s1", description: "ファイル構造を確認", tool: "workbook.inspect", phase: "read", estimatedEffect: "シート・列情報を取得" },
          { id: "s2", description: "サンプルデータを確認", tool: "sheet.preview", phase: "read", estimatedEffect: "先頭行を表示" },
          { id: "s3", description: "approved=true の行を抽出して保存", tool: "table.filter_rows", phase: "write", estimatedEffect: "条件に合う行のコピーを作成" }
        ]
      }
    }, null, 2),
    "```"
  );

  return sections.join("\n");
}

/**
 * ステップ実行後のフォローアッププロンプト（コンテキスト圧縮対応）
 */
export function buildFollowUpPromptV2(params: {
  originalTask: string;
  currentStep: { description: string; tool: string };
  priorResults: { tool: string; ok: boolean; summary: string }[];
  turn: number;
  compressedHistory?: string;
}): string {
  const sections = [
    "Relay Agent task continuation. Return strict JSON only.",
    ""
  ];

  if (params.compressedHistory) {
    sections.push(
      "## これまでの経緯（要約）",
      params.compressedHistory,
      ""
    );
  }

  sections.push(
    `## 元の目標`,
    params.originalTask.trim(),
    "",
    `## 現在のステップ (ターン ${params.turn})`,
    `- 説明: ${params.currentStep.description}`,
    `- ツール: ${params.currentStep.tool}`,
    ""
  );

  if (params.priorResults.length > 0) {
    sections.push("## 前のステップの結果");
    for (const r of params.priorResults.slice(-3)) { // 直近3件のみ
      sections.push(`- ${r.tool}: ${r.ok ? r.summary.slice(0, 200) : `エラー: ${r.summary}`}`);
    }
    sections.push("");
  }

  sections.push(
    "## 指示",
    `${params.currentStep.tool} を使って「${params.currentStep.description}」を実行してください。`,
    'status は "thinking" にし、actions に具体的なアクションを含めてください。'
  );

  return sections.join("\n");
}

/**
 * エラーリカバリ用プロンプト
 */
export function buildErrorRecoveryPrompt(params: {
  originalTask: string;
  errorDescription: string;
  retryLevel: 1 | 2 | 3;
  lastValidResponse?: string;
}): string {
  if (params.retryLevel === 1) {
    return [
      "前回の返答は JSON として解析できませんでした。",
      "",
      `エラー: ${params.errorDescription}`,
      "",
      "以下のルールを守って、もう一度 JSON で返してください:",
      "- ``` で囲まない",
      "- パス区切りは /",
      "- JSON のみを返す（説明文を含めない）",
      "",
      `元の依頼: ${params.originalTask.trim()}`
    ].join("\n");
  }

  if (params.retryLevel === 2) {
    return [
      "前回も JSON の解析に失敗しました。シンプルに回答してください。",
      "",
      `やりたいこと: ${params.originalTask.trim()}`,
      "",
      '以下の形式で JSON のみを返してください:',
      '{ "version": "1.0", "status": "ready_to_write", "summary": "...", "actions": [...] }'
    ].join("\n");
  }

  // retryLevel 3: 手動モードフォールバック — プロンプトは生成しない
  return "";
}
```

---

## Task 139: コンテキストウィンドウ管理

### 実装場所

`apps/desktop/src/lib/prompt-templates.ts` — 上記ファイルに追加

### 実装内容

```typescript
export type TurnSummary = {
  turn: number;
  toolsUsed: string[];
  keyFindings: string[];
  status: string;
};

/**
 * 過去ターンを要約圧縮する。
 * maxFullTurns 以降のターンは要約ブロックに圧縮。
 */
export function buildCompressedContext(
  turnSummaries: TurnSummary[],
  maxFullTurns: number = 2
): string {
  if (turnSummaries.length <= maxFullTurns) {
    return ""; // 圧縮不要
  }

  const toCompress = turnSummaries.slice(0, -maxFullTurns);
  const lines = ["これまでの経緯:"];

  for (const ts of toCompress) {
    lines.push(
      `- ターン ${ts.turn}: ${ts.toolsUsed.join(", ")} → ${ts.keyFindings.slice(0, 2).join("; ")}`
    );
  }

  return lines.join("\n");
}

/**
 * ToolExecutionResult[] から TurnSummary を生成
 */
export function summarizeTurn(
  turn: number,
  status: string,
  toolResults: { tool: string; ok: boolean; result?: unknown; error?: string | null }[]
): TurnSummary {
  return {
    turn,
    status,
    toolsUsed: toolResults.map((r) => r.tool),
    keyFindings: toolResults
      .filter((r) => r.ok && r.result)
      .map((r) => {
        const resultStr = JSON.stringify(r.result);
        return `${r.tool}: ${resultStr.slice(0, 100)}${resultStr.length > 100 ? "..." : ""}`;
      })
  };
}
```

---

## Task 140: エラーリカバリ

### 実装場所

`apps/desktop/src/lib/agent-loop.ts` — `runAgentLoop` 内のエラーハンドリングを拡張

### 変更内容

```typescript
// runAgentLoop 内の sendToCopilot 呼び出し部分を try-catch でラップ
let rawResponse: string;
let retryLevel = 0;
const maxRetries = 2;

while (retryLevel <= maxRetries) {
  try {
    const promptToSend = retryLevel === 0
      ? prompt
      : buildErrorRecoveryPrompt({
          originalTask: config.initialPrompt,
          errorDescription: lastError,
          retryLevel: retryLevel as 1 | 2 | 3
        });

    if (retryLevel === 3) {
      // 手動モードフォールバック
      callbacks.onManualFallback?.(prompt);
      return { status: "error", finalResponse: null, turns, summary: "手動モードにフォールバックしました。" };
    }

    rawResponse = await raceWithAbort(
      withTimeout(sendToCopilot(promptToSend, { onProgress: callbacks.onBrowserProgress }), config.loopTimeoutMs, "タイムアウト"),
      config.abortSignal
    );

    // JSON パース試行
    JSON.parse(rawResponse);
    break; // 成功
  } catch (err) {
    lastError = String(err);
    retryLevel++;
    callbacks.onRetry?.(retryLevel, lastError);
    if (retryLevel > maxRetries) {
      throw err;
    }
  }
}
```

---

## Task 141: 構造化会話履歴

### 実装場所

`apps/desktop/src/lib/agent-loop.ts` — 型追加 + ループ内で蓄積

### 型定義

```typescript
export type CopilotConversationTurn = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

// AgentLoopResult に追加
export type AgentLoopResult = {
  // ... 既存フィールド
  conversationHistory: CopilotConversationTurn[];  // 追加
};
```

### ループ内で蓄積

```typescript
const conversationHistory: CopilotConversationTurn[] = [];

// 各ターン内で:
conversationHistory.push({
  role: "user",
  content: prompt,
  timestamp: new Date().toISOString()
});
conversationHistory.push({
  role: "assistant",
  content: rawResponse,
  timestamp: new Date().toISOString()
});
```

---

## 実装順序

1. **Task 138** — プロンプトテンプレート（独立して実装可能）
2. **Task 139** — コンテキスト圧縮（Task 138 の関数を使用）
3. **Task 140** — エラーリカバリ（Task 138 の関数を使用）
4. **Task 141** — 会話履歴（Task 139 と組み合わせ）
5. **Task 142** — 複数セッション探索（調査のみ）
6. **Task 143** — E2E 検証

## 検証チェックリスト

- [ ] `pnpm typecheck` が成功する
- [ ] `buildPlanningPromptV2` の出力に思考プロセス指示と回答例が含まれる
- [ ] `buildCompressedContext` で 5 ターンが 2 ターン + 要約に圧縮される
- [ ] `buildErrorRecoveryPrompt` がレベル別に異なるプロンプトを生成する
- [ ] JSON パース失敗時にリトライが最大 2 回行われる
- [ ] 3 回失敗で手動モードフォールバックが発動する
- [ ] 会話履歴が AgentLoopResult に蓄積される
- [ ] `planningEnabled=false` で従来動作が維持される
