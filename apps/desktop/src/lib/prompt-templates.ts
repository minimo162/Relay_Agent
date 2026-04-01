import type { PlanStep, ToolExecutionResult } from "@relay-agent/contracts";

export type CopilotConversationTurn = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

export type TurnSummary = {
  turn: number;
  toolsUsed: string[];
  keyFindings: string[];
  status: string;
};

type ToolGroups = {
  read: string[];
  write: string[];
};

type FollowUpResultSummary = {
  tool: string;
  ok: boolean;
  summary: string;
};

export function buildProjectContext(
  customInstructions = "",
  memory: Array<{ key: string; value: string }> = []
): string {
  const sections: string[] = [];

  if (customInstructions.trim()) {
    sections.push("## プロジェクト指示", customInstructions.trim());
  }

  if (memory.length > 0) {
    sections.push(
      "## 学習済み設定",
      memory.map((entry) => `- ${entry.key}: ${entry.value}`).join("\n")
    );
  }

  return sections.join("\n");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function summarizeResultPayload(value: unknown): string {
  return truncate(JSON.stringify(value), 200);
}

function buildConversationHistoryContext(
  conversationHistory: CopilotConversationTurn[] = [],
  maxEntries = 4
): string {
  if (conversationHistory.length === 0) {
    return "";
  }

  const recentEntries = conversationHistory.slice(-maxEntries);
  const lines = ["## 直近の会話履歴"];

  for (const entry of recentEntries) {
    lines.push(`- ${entry.role === "user" ? "user" : "assistant"}: ${truncate(entry.content, 220)}`);
  }

  return lines.join("\n");
}

export function buildPlanningPromptV2(params: {
  objective: string;
  workbookContext: string;
  readTools: string[];
  writeTools: string[];
  priorAttemptFeedback?: string;
  projectContext?: string;
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
    ...(params.projectContext?.trim()
      ? [params.projectContext.trim(), ""]
      : []),
    "## ユーザーの目標",
    params.objective.trim(),
    "",
    "## 対象ファイル情報",
    params.workbookContext.trim(),
    "",
    "## 使えるツール",
    "",
    "### 読み取り（自動実行 — 承認不要）",
    ...params.readTools.map((tool) => `- ${tool}`),
    "",
    "### 書き込み（ユーザー承認が必要）",
    ...params.writeTools.map((tool) => `- ${tool}`)
  ];

  if (params.priorAttemptFeedback?.trim()) {
    sections.push(
      "",
      "## 前回の計画に対するフィードバック",
      params.priorAttemptFeedback.trim()
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
    JSON.stringify(
      {
        version: "1.0",
        status: "plan_proposed",
        summary: "approved が true の行を抽出して保存します",
        actions: [],
        executionPlan: {
          summary: "3 ステップで完了: 構造確認 → データ確認 → 抽出保存",
          totalEstimatedSteps: 3,
          steps: [
            {
              id: "s1",
              description: "ファイル構造を確認",
              tool: "workbook.inspect",
              phase: "read",
              estimatedEffect: "シート・列情報を取得"
            },
            {
              id: "s2",
              description: "サンプルデータを確認",
              tool: "sheet.preview",
              phase: "read",
              estimatedEffect: "先頭行を表示"
            },
            {
              id: "s3",
              description: "approved=true の行を抽出して保存",
              tool: "table.filter_rows",
              phase: "write",
              estimatedEffect: "条件に合う行のコピーを作成"
            }
          ]
        }
      },
      null,
      2
    ),
    "```"
  );

  return sections.join("\n");
}

export function buildPlanningPrompt(
  objective: string,
  workbookContext: string,
  availableTools: ToolGroups,
  priorAttemptFeedback?: string,
  projectContext?: string
): string {
  return buildPlanningPromptV2({
    objective,
    workbookContext,
    readTools: availableTools.read,
    writeTools: availableTools.write,
    priorAttemptFeedback,
    projectContext
  });
}

export function buildCompressedContext(
  turnSummaries: TurnSummary[],
  maxFullTurns = 2
): string {
  if (turnSummaries.length <= maxFullTurns) {
    return "";
  }

  const toCompress = turnSummaries.slice(0, -maxFullTurns);
  const lines = ["これまでの経緯:"];

  for (const summary of toCompress) {
    lines.push(
      `- ターン ${summary.turn}: ${summary.toolsUsed.join(", ")} → ${summary.keyFindings
        .slice(0, 2)
        .join("; ")}`
    );
  }

  return lines.join("\n");
}

export function summarizeTurn(
  turn: number,
  status: string,
  toolResults: {
    tool: string;
    ok: boolean;
    result?: unknown;
    error?: string | null;
  }[]
): TurnSummary {
  const keyFindings = toolResults
    .map((result) => {
      if (result.ok && result.result !== undefined) {
        return `${result.tool}: ${summarizeResultPayload(result.result)}`;
      }

      if (!result.ok && result.error) {
        return `${result.tool}: error ${truncate(result.error, 120)}`;
      }

      return `${result.tool}: 実行済み`;
    })
    .slice(0, 4);

  return {
    turn,
    status,
    toolsUsed: toolResults.map((result) => result.tool),
    keyFindings
  };
}

export function buildFollowUpPromptV2(params: {
  originalTask: string;
  currentStep: { description: string; tool: string };
  priorResults: FollowUpResultSummary[];
  turn: number;
  compressedHistory?: string;
  conversationHistory?: CopilotConversationTurn[];
  projectContext?: string;
}): string {
  const sections = ["Relay Agent task continuation. Return strict JSON only.", ""];

  if (params.projectContext?.trim()) {
    sections.push(params.projectContext.trim(), "");
  }

  if (params.compressedHistory) {
    sections.push("## これまでの経緯（要約）", params.compressedHistory, "");
  }

  const conversationContext = buildConversationHistoryContext(params.conversationHistory);
  if (conversationContext) {
    sections.push(conversationContext, "");
  }

  sections.push(
    "## 元の目標",
    params.originalTask.trim(),
    "",
    `## 現在のステップ (ターン ${params.turn})`,
    `- 説明: ${params.currentStep.description}`,
    `- ツール: ${params.currentStep.tool}`,
    ""
  );

  if (params.priorResults.length > 0) {
    sections.push("## 前のステップの結果");
    for (const result of params.priorResults.slice(-3)) {
      sections.push(`- ${result.tool}: ${result.ok ? truncate(result.summary, 200) : `エラー: ${truncate(result.summary, 200)}`}`);
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

export function buildLoopContinuationPrompt(params: {
  originalTask: string;
  toolResults: ToolExecutionResult[];
  turn: number;
  priorSummary?: string;
  priorMessage?: string;
  compressedHistory?: string;
  conversationHistory?: CopilotConversationTurn[];
  projectContext?: string;
}): string {
  const sections = [
    "You are continuing the same Relay Agent task.",
    "Return strict JSON only. Do not include markdown fences.",
    `Original task:\n${params.originalTask.trim()}`
  ];

  if (params.projectContext?.trim()) {
    sections.push(params.projectContext.trim());
  }

  if (params.compressedHistory) {
    sections.push(`Compressed history:\n${params.compressedHistory}`);
  }

  const conversationContext = buildConversationHistoryContext(params.conversationHistory);
  if (conversationContext) {
    sections.push(conversationContext);
  }

  sections.push(`Current turn: ${params.turn + 1}`);

  if (params.priorSummary) {
    sections.push(`Previous summary:\n${params.priorSummary}`);
  }

  if (params.priorMessage) {
    sections.push(`Previous message:\n${params.priorMessage}`);
  }

  sections.push(
    [
      "Tool results:",
      ...params.toolResults.map((result, index) =>
        [
          `### Result ${index + 1}: ${result.tool}`,
          `ok: ${result.ok}`,
          "```json",
          JSON.stringify(result.ok ? result.result ?? {} : { error: result.error }, null, 2),
          "```"
        ].join("\n")
      )
    ].join("\n\n")
  );

  sections.push(
    [
      "Decide the next step:",
      '- If more read tools are needed, return `status: "thinking"` with those read actions.',
      '- If you are ready to propose write actions, return `status: "ready_to_write"`.',
      '- If the task is complete without writes, return `status: "done"` and no actions.',
      '- If the task cannot continue, return `status: "error"` with a short `message`.'
    ].join("\n")
  );

  return sections.join("\n\n");
}

export function buildStepExecutionPrompt(
  originalTask: string,
  step: PlanStep,
  priorResults: ToolExecutionResult[],
  options: {
    turn?: number;
    compressedHistory?: string;
    conversationHistory?: CopilotConversationTurn[];
    projectContext?: string;
  } = {}
): string {
  return buildFollowUpPromptV2({
    originalTask,
    currentStep: { description: step.description, tool: step.tool },
    priorResults: priorResults.map((result) => ({
      tool: result.tool,
      ok: result.ok,
      summary: result.ok
        ? summarizeResultPayload(result.result ?? {})
        : result.error ?? "Unknown error"
    })),
    turn: options.turn ?? 1,
    compressedHistory: options.compressedHistory,
    conversationHistory: options.conversationHistory,
    projectContext: options.projectContext
  });
}

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
      "以下の形式で JSON のみを返してください:",
      '{ "version": "1.0", "status": "ready_to_write", "summary": "...", "actions": [...] }',
      ...(params.lastValidResponse
        ? ["", "前回の返答断片:", truncate(params.lastValidResponse, 400)]
        : [])
    ].join("\n");
  }

  return [
    "自動リトライを使い切りました。手動モードで続行してください。",
    "",
    `元の依頼: ${params.originalTask.trim()}`,
    "",
    "次の内容を Copilot に貼り付けるか、手動モードへ切り替えてください。",
    `問題: ${params.errorDescription}`
  ].join("\n");
}
