# Codex プロンプト 04 — Contracts スキーマ拡張（Tasks 85・93）

## 対象タスク

- **Task 85**: `CopilotTurnResponse` に `status` フィールドを追加
- **Task 93**: `file` アクションスキーマを新設（フェーズ3準備）

---

## コンテキスト

Relay Agent はモノレポ構成（pnpm workspaces）。

```
packages/contracts/src/
  relay.ts      ← Task 85 の変更対象（copilotTurnResponseSchema）
  workbook.ts   ← 参考（spreadsheetActionSchema の定義パターン）
  shared.ts     ← nonEmptyStringSchema / entityIdSchema
  index.ts      ← エクスポート管理
  file.ts       ← Task 93 で新規作成
```

---

## Task 85: `copilotTurnResponseSchema` に `status` を追加

### ファイル: `packages/contracts/src/relay.ts`

#### 現在のスキーマ

```typescript
export const copilotTurnResponseSchema = z.object({
  version: z.literal("1.0").default("1.0"),
  summary: nonEmptyStringSchema,
  actions: z.array(spreadsheetActionSchema).default([]),
  followupQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});
```

#### 変更後（このコードに書き換えること）

```typescript
export const agentLoopStatusSchema = z.enum([
  "thinking",      // まだ情報収集中 → read actions を実行してループ継続
  "ready_to_write", // 書き込み計画が確定 → 承認ゲートへ
  "done",          // 追加アクション不要 → ループ終了
  "error"          // Copilot がエラー → 手動フォールバック
]);

export const copilotTurnResponseSchema = z.object({
  version: z.literal("1.0").default("1.0"),
  status: agentLoopStatusSchema.default("ready_to_write"),
  // デフォルト "ready_to_write" = 既存の1ショット応答との後方互換
  summary: nonEmptyStringSchema,
  actions: z.array(spreadsheetActionSchema).default([]),
  message: z.string().optional(),
  // Copilot からの補足（エラー詳細・進捗説明など）
  followupQuestions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([])
});
```

#### エクスポートに追加

```typescript
export type AgentLoopStatus = z.infer<typeof agentLoopStatusSchema>;
// CopilotTurnResponse の型は自動更新されるためそのまま
```

---

## Task 93: `packages/contracts/src/file.ts` を新規作成

以下の内容でファイルを作成すること。

```typescript
import { z } from "zod";

import { nonEmptyStringSchema } from "./shared";

// ── File read actions ──────────────────────────────────────────────────────

export const fileListActionSchema = z.object({
  tool: z.literal("file.list"),
  args: z.object({
    path: nonEmptyStringSchema,
    // ディレクトリパス（絶対パス）
    pattern: z.string().optional(),
    // glob パターン（例: "*.csv"）。省略時は全ファイル
    recursive: z.boolean().default(false)
  })
});

export const fileReadTextActionSchema = z.object({
  tool: z.literal("file.read_text"),
  args: z.object({
    path: nonEmptyStringSchema,
    // テキストファイルの絶対パス
    maxBytes: z.number().int().positive().max(1_048_576).default(65_536)
    // 最大読み取りバイト数（デフォルト 64KB、最大 1MB）
  })
});

export const fileStatActionSchema = z.object({
  tool: z.literal("file.stat"),
  args: z.object({
    path: nonEmptyStringSchema
  })
});

// ── File write actions ─────────────────────────────────────────────────────

export const fileCopyActionSchema = z.object({
  tool: z.literal("file.copy"),
  args: z.object({
    sourcePath: nonEmptyStringSchema,
    destPath: nonEmptyStringSchema,
    overwrite: z.boolean().default(false)
  })
});

export const fileMoveActionSchema = z.object({
  tool: z.literal("file.move"),
  args: z.object({
    sourcePath: nonEmptyStringSchema,
    destPath: nonEmptyStringSchema,
    overwrite: z.boolean().default(false)
  })
});

export const fileDeleteActionSchema = z.object({
  tool: z.literal("file.delete"),
  args: z.object({
    path: nonEmptyStringSchema,
    toRecycleBin: z.boolean().default(true)
    // false = 完全削除（危険）。デフォルトはゴミ箱へ
  })
});

// ── Union ──────────────────────────────────────────────────────────────────

export const fileActionSchema = z.discriminatedUnion("tool", [
  fileListActionSchema,
  fileReadTextActionSchema,
  fileStatActionSchema,
  fileCopyActionSchema,
  fileMoveActionSchema,
  fileDeleteActionSchema
]);

export type FileListAction = z.infer<typeof fileListActionSchema>;
export type FileReadTextAction = z.infer<typeof fileReadTextActionSchema>;
export type FileStatAction = z.infer<typeof fileStatActionSchema>;
export type FileCopyAction = z.infer<typeof fileCopyActionSchema>;
export type FileMoveAction = z.infer<typeof fileMoveActionSchema>;
export type FileDeleteAction = z.infer<typeof fileDeleteActionSchema>;
export type FileAction = z.infer<typeof fileActionSchema>;
```

---

## `packages/contracts/src/index.ts` への追記

既存エクスポートの末尾に以下を追加:

```typescript
export {
  fileListActionSchema,
  fileReadTextActionSchema,
  fileStatActionSchema,
  fileCopyActionSchema,
  fileMoveActionSchema,
  fileDeleteActionSchema,
  fileActionSchema,
  type FileListAction,
  type FileReadTextAction,
  type FileStatAction,
  type FileCopyAction,
  type FileMoveAction,
  type FileDeleteAction,
  type FileAction
} from "./file";

export { agentLoopStatusSchema, type AgentLoopStatus } from "./relay";
```

---

## 検証コマンド

```bash
# 型チェック
pnpm --filter @relay-agent/contracts typecheck

# デスクトップ側の型チェック（contracts を使っているため）
pnpm --filter @relay-agent/desktop check
```

### 確認事項

1. `agentLoopStatusSchema` が正しくエクスポートされる
2. `status` を省略した既存の JSON が `"ready_to_write"` としてパースされる
3. `file.list` / `file.delete` の Zod パースが成功する
4. 既存の `spreadsheetActionSchema` に影響がない（既存テストが通る）

---

## 注意事項

- `file.ts` は新規ファイル。スタイルは `workbook.ts` のパターンに合わせること
- `relayActionSchema = z.union([spreadsheetActionSchema, fileActionSchema])` は
  バックエンド実装（Task 86・94）が揃ってから `index.ts` に追加する
- Rust 側の models.rs / storage.rs はこのタスクでは変更しない
