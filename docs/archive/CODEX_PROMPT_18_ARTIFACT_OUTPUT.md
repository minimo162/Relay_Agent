# Codex プロンプト 18 — アーティファクトファースト出力（Tasks 160–163）

## 対象タスク

- **Task 160**: 設計 — アーティファクト出力パイプライン
- **Task 161**: フロントエンド — 汎用アーティファクトプレビュー
- **Task 162**: バックエンド — 複数出力フォーマットサポート
- **Task 163**: バックエンド — 出力品質バリデーション

## 概要

現在のプレビューはスプレッドシートの SheetDiff に特化している。
Phase 10 ではあらゆる出力タイプ（CSV テーブル、テキスト差分、ファイル操作概要、
ドキュメント抽出結果）を統一的にプレビュー・承認・保存できるようにする。

**基本方針:**
- 出力タイプに応じたレンダラーを自動選択する ArtifactPreview コンポーネント
- 1 回の変換から複数出力フォーマットを生成可能に（CSV + XLSX 等）
- 出力後の品質チェック（行数検証、データ欠損検出、エンコーディング確認）
- 既存の SheetDiff プレビューは ArtifactPreview の一レンダラーとして組み込む

## 前提

### 既存のプレビューフロー

```
previewExecution(sessionId, turnId) → PreviewExecutionResponse {
  ready: boolean
  requiresApproval: boolean
  diffSummary: DiffSummary     ← スプレッドシート専用
  warnings: string[]
}
→ SheetDiffCard.svelte でレンダリング
→ ApprovalGate.svelte で承認
→ runExecution(sessionId, turnId)
```

### 既存スキーマ

```typescript
// packages/contracts/src/workbook.ts
diffSummarySchema = {
  sourcePath, outputPath, mode, targetCount,
  estimatedAffectedRows, sheets: SheetDiff[], warnings
}

// apps/desktop/src/lib/components/SheetDiffCard.svelte — 既存
// apps/desktop/src/lib/components/FileOpPreview.svelte — Phase 7 で追加予定
```

---

## Task 160: 設計 — アーティファクト出力パイプライン

### `docs/ARTIFACT_OUTPUT_DESIGN.md` を作成

**出力パイプライン:**
```
Transform Execution
  → OutputArtifact[] 生成
    → ArtifactPreview でプレビュー表示
      → 承認
        → 保存
          → QualityValidation（品質チェック）
            → 結果レポート
```

**OutputArtifact 型:**
```typescript
type OutputArtifact = {
  id: string;
  type: ArtifactType;
  label: string;
  sourcePath: string;
  outputPath: string;
  content: ArtifactContent;
  warnings: string[];
};

type ArtifactType =
  | "spreadsheet_diff"   // 既存 SheetDiff
  | "file_operation"     // file.copy/move/delete の結果
  | "text_diff"          // text.replace の before/after
  | "text_extraction"    // document.read_text の結果
  | "csv_table"          // CSV テーブルプレビュー
  | "raw_text";          // プレーンテキスト出力

type ArtifactContent =
  | { type: "spreadsheet_diff"; diffSummary: DiffSummary }
  | { type: "file_operation"; operations: FileOpSummary[] }
  | { type: "text_diff"; before: string; after: string; changeCount: number }
  | { type: "text_extraction"; text: string; format: string; charCount: number }
  | { type: "csv_table"; columns: string[]; rows: string[][]; totalRows: number }
  | { type: "raw_text"; text: string };
```

---

## Task 161: フロントエンド — 汎用アーティファクトプレビュー

### Contracts 拡張 — `packages/contracts/src/relay.ts` に追加

```typescript
export const artifactTypeSchema = z.enum([
  "spreadsheet_diff",
  "file_operation",
  "text_diff",
  "text_extraction",
  "csv_table",
  "raw_text"
]);

export const outputArtifactSchema = z.object({
  id: entityIdSchema,
  type: artifactTypeSchema,
  label: nonEmptyStringSchema,
  sourcePath: z.string().default(""),
  outputPath: z.string().default(""),
  warnings: z.array(z.string()).default([]),
  // content は type ごとに異なるため Value で受ける
  content: z.record(z.string(), z.unknown())
});

export type ArtifactType = z.infer<typeof artifactTypeSchema>;
export type OutputArtifact = z.infer<typeof outputArtifactSchema>;
```

### 新規コンポーネント: `apps/desktop/src/lib/components/ArtifactPreview.svelte`

```svelte
<script lang="ts">
  import type { OutputArtifact } from "@relay-agent/contracts";
  import SheetDiffCard from "./SheetDiffCard.svelte";
  import FileOpPreview from "./FileOpPreview.svelte";

  export let artifacts: OutputArtifact[] = [];

  // タブ切り替え（複数 artifact 時）
  let activeIndex = 0;
  $: activeArtifact = artifacts[activeIndex] ?? null;
</script>

{#if artifacts.length > 1}
  <div class="artifact-tabs">
    {#each artifacts as artifact, index}
      <button
        class="artifact-tab"
        class:active={index === activeIndex}
        type="button"
        on:click={() => { activeIndex = index; }}
      >
        {artifact.label}
      </button>
    {/each}
  </div>
{/if}

{#if activeArtifact}
  <div class="artifact-preview-body">
    {#if activeArtifact.type === "spreadsheet_diff"}
      <!-- 既存 SheetDiffCard を再利用 -->
      <SheetDiffCard diffSummary={activeArtifact.content.diffSummary} />

    {:else if activeArtifact.type === "file_operation"}
      <FileOpPreview actions={activeArtifact.content.operations ?? []} />

    {:else if activeArtifact.type === "text_diff"}
      <div class="text-diff-preview">
        <h4>テキスト差分（{activeArtifact.content.changeCount ?? 0}箇所）</h4>
        <div class="diff-columns">
          <div class="diff-before">
            <h5>変更前</h5>
            <pre>{activeArtifact.content.before ?? ""}</pre>
          </div>
          <div class="diff-after">
            <h5>変更後</h5>
            <pre>{activeArtifact.content.after ?? ""}</pre>
          </div>
        </div>
      </div>

    {:else if activeArtifact.type === "text_extraction"}
      <div class="text-extraction-preview">
        <h4>テキスト抽出結果（{activeArtifact.content.format}、{activeArtifact.content.charCount}文字）</h4>
        <pre class="extracted-text">{activeArtifact.content.text ?? ""}</pre>
      </div>

    {:else if activeArtifact.type === "csv_table"}
      <div class="csv-table-preview">
        <h4>テーブルプレビュー（{activeArtifact.content.totalRows ?? 0}行）</h4>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                {#each activeArtifact.content.columns ?? [] as col}
                  <th>{col}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each (activeArtifact.content.rows ?? []).slice(0, 100) as row}
                <tr>
                  {#each row as cell}
                    <td>{cell}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if (activeArtifact.content.rows?.length ?? 0) > 100}
          <p class="truncation-note">先頭 100 行を表示中</p>
        {/if}
      </div>

    {:else if activeArtifact.type === "raw_text"}
      <div class="raw-text-preview">
        <pre>{activeArtifact.content.text ?? ""}</pre>
      </div>

    {:else}
      <div class="unknown-artifact">
        <p>未対応のアーティファクトタイプ: {activeArtifact.type}</p>
        <pre>{JSON.stringify(activeArtifact.content, null, 2)}</pre>
      </div>
    {/if}

    {#if activeArtifact.warnings.length > 0}
      <div class="artifact-warnings">
        {#each activeArtifact.warnings as warning}
          <p class="warning-text">⚠️ {warning}</p>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .artifact-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--ra-border);
    margin-bottom: 0.75rem;
  }
  .artifact-tab {
    padding: 0.5rem 1rem;
    border: none;
    background: transparent;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .artifact-tab.active {
    border-bottom-color: var(--ra-accent, #3b82f6);
    font-weight: 600;
  }
  .diff-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  .diff-before, .diff-after {
    border: 1px solid var(--ra-border);
    border-radius: 6px;
    padding: 0.5rem;
    overflow: auto;
    max-height: 300px;
  }
  .diff-before { background: #fef2f2; }
  .diff-after { background: #f0fdf4; }
  .table-scroll {
    overflow-x: auto;
    max-height: 400px;
  }
  table { border-collapse: collapse; width: 100%; font-size: 0.82rem; }
  th, td { border: 1px solid var(--ra-border); padding: 0.3rem 0.5rem; text-align: left; }
  th { background: var(--ra-surface); font-weight: 600; }
  .extracted-text, .raw-text-preview pre {
    max-height: 400px;
    overflow: auto;
    font-size: 0.82rem;
    white-space: pre-wrap;
    border: 1px solid var(--ra-border);
    border-radius: 6px;
    padding: 0.75rem;
  }
  .truncation-note { font-size: 0.8rem; color: var(--ra-text-muted); text-align: center; }
  .warning-text { color: #b45309; font-size: 0.85rem; }
</style>
```

### `+page.svelte` の承認 UI に統合

既存の `SheetDiffCard` の使用箇所を `ArtifactPreview` で置き換え。
`diffSummary` のみの場合は自動的に `spreadsheet_diff` タイプとしてラップ:

```typescript
function wrapDiffAsArtifact(diffSummary: DiffSummary): OutputArtifact {
  return {
    id: `diff-${Date.now()}`,
    type: "spreadsheet_diff",
    label: `${diffSummary.sourcePath} → ${diffSummary.outputPath}`,
    sourcePath: diffSummary.sourcePath,
    outputPath: diffSummary.outputPath,
    content: { diffSummary, type: "spreadsheet_diff" },
    warnings: diffSummary.warnings
  };
}
```

---

## Task 162: バックエンド — 複数出力フォーマットサポート

### Rust — `models.rs` に追加

```rust
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSpec {
    pub format: OutputFormat,
    pub output_path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Csv,
    Xlsx,
    Text,
    Json,
}
```

### `storage.rs` の `run_execution` を拡張

```rust
pub fn run_execution_multi(
    &mut self,
    session_id: &str,
    turn_id: &str,
    output_specs: Vec<OutputSpec>,
) -> Result<Vec<RunExecutionResponse>, String> {
    // 同じ変換結果を複数フォーマットで出力
    let mut results = Vec::new();
    for spec in output_specs {
        let response = self.run_execution_with_format(session_id, turn_id, &spec)?;
        results.push(response);
    }
    Ok(results)
}
```

### IPC — `packages/contracts/src/ipc.ts` に追加

```typescript
export const runExecutionMultiRequestSchema = z.object({
  sessionId: entityIdSchema,
  turnId: entityIdSchema,
  outputSpecs: z.array(z.object({
    format: z.enum(["csv", "xlsx", "text", "json"]),
    outputPath: z.string().min(1)
  })).min(1)
});
```

### Tauri コマンド

```rust
#[tauri::command]
pub fn run_execution_multi(
    storage: State<'_, Mutex<AppStorage>>,
    request: RunExecutionMultiRequest,
) -> Result<Vec<RunExecutionResponse>, String> {
    storage.lock().unwrap().run_execution_multi(
        &request.session_id,
        &request.turn_id,
        request.output_specs,
    )
}
```

---

## Task 163: バックエンド — 出力品質バリデーション

### 新規ファイル: `apps/desktop/src-tauri/src/quality_validator.rs`

```rust
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCheckResult {
    pub passed: bool,
    pub checks: Vec<QualityCheck>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCheck {
    pub name: String,
    pub passed: bool,
    pub detail: String,
}

pub fn validate_output_quality(
    source_path: &str,
    output_path: &str,
) -> Result<QualityCheckResult, String> {
    let mut checks = Vec::new();
    let mut warnings = Vec::new();

    // 1. 行数チェック
    let source_rows = count_rows(source_path)?;
    let output_rows = count_rows(output_path)?;
    let row_check = if output_rows == 0 && source_rows > 0 {
        warnings.push("出力ファイルが空です。データ欠損の可能性があります。".into());
        QualityCheck {
            name: "行数チェック".into(),
            passed: false,
            detail: format!("入力: {}行 → 出力: {}行（全行消失）", source_rows, output_rows),
        }
    } else {
        QualityCheck {
            name: "行数チェック".into(),
            passed: true,
            detail: format!("入力: {}行 → 出力: {}行", source_rows, output_rows),
        }
    };
    checks.push(row_check);

    // 2. NULL/空値の異常増加チェック
    let source_empty_ratio = count_empty_ratio(source_path)?;
    let output_empty_ratio = count_empty_ratio(output_path)?;
    if output_empty_ratio > source_empty_ratio + 0.2 {
        warnings.push(format!(
            "空値の割合が大幅に増加しています（{:.1}% → {:.1}%）",
            source_empty_ratio * 100.0,
            output_empty_ratio * 100.0
        ));
        checks.push(QualityCheck {
            name: "空値チェック".into(),
            passed: false,
            detail: format!("空値率: {:.1}% → {:.1}%", source_empty_ratio * 100.0, output_empty_ratio * 100.0),
        });
    } else {
        checks.push(QualityCheck {
            name: "空値チェック".into(),
            passed: true,
            detail: format!("空値率: {:.1}% → {:.1}%", source_empty_ratio * 100.0, output_empty_ratio * 100.0),
        });
    }

    // 3. エンコーディング確認
    let encoding_ok = verify_encoding(output_path)?;
    checks.push(QualityCheck {
        name: "エンコーディング".into(),
        passed: encoding_ok,
        detail: if encoding_ok { "UTF-8 確認済み".into() } else { "非 UTF-8 文字を検出".into() },
    });

    // 4. CSV インジェクション保護
    let injection_safe = check_csv_injection(output_path)?;
    if !injection_safe {
        warnings.push("CSV インジェクションの可能性がある値を検出しました。".into());
    }
    checks.push(QualityCheck {
        name: "CSV インジェクション".into(),
        passed: injection_safe,
        detail: if injection_safe { "安全".into() } else { "危険な先頭文字 (=, +, -, @) を検出".into() },
    });

    let all_passed = checks.iter().all(|c| c.passed);

    Ok(QualityCheckResult {
        passed: all_passed,
        checks,
        warnings,
    })
}

fn count_rows(path: &str) -> Result<usize, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read: {}", e))?;
    Ok(content.lines().count())
}

fn count_empty_ratio(path: &str) -> Result<f64, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read: {}", e))?;
    let mut total_cells = 0usize;
    let mut empty_cells = 0usize;
    for line in content.lines() {
        for cell in line.split(',') {
            total_cells += 1;
            if cell.trim().is_empty() {
                empty_cells += 1;
            }
        }
    }
    if total_cells == 0 { return Ok(0.0); }
    Ok(empty_cells as f64 / total_cells as f64)
}

fn verify_encoding(path: &str) -> Result<bool, String> {
    match std::fs::read_to_string(path) {
        Ok(_) => Ok(true),   // read_to_string は UTF-8 のみ成功
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => Ok(false),
        Err(e) => Err(format!("failed to read: {}", e)),
    }
}

fn check_csv_injection(path: &str) -> Result<bool, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read: {}", e))?;
    let dangerous_prefixes = ['=', '+', '-', '@'];
    for line in content.lines().skip(1) {  // ヘッダー行はスキップ
        for cell in line.split(',') {
            let trimmed = cell.trim().trim_matches('"');
            if let Some(first_char) = trimmed.chars().next() {
                if dangerous_prefixes.contains(&first_char) {
                    return Ok(false);
                }
            }
        }
    }
    Ok(true)
}
```

### Contracts — 品質チェック結果スキーマ

`packages/contracts/src/relay.ts` に追加:

```typescript
export const qualityCheckSchema = z.object({
  name: nonEmptyStringSchema,
  passed: z.boolean(),
  detail: z.string()
});

export const qualityCheckResultSchema = z.object({
  passed: z.boolean(),
  checks: z.array(qualityCheckSchema),
  warnings: z.array(z.string()).default([])
});

export type QualityCheck = z.infer<typeof qualityCheckSchema>;
export type QualityCheckResult = z.infer<typeof qualityCheckResultSchema>;
```

### Tauri コマンド

```rust
#[tauri::command]
pub fn validate_output_quality(
    source_path: String,
    output_path: String,
) -> Result<QualityCheckResult, String> {
    quality_validator::validate_output_quality(&source_path, &output_path)
}
```

### フロントエンド — 品質チェック結果の表示

`run_execution` 完了後に自動で `validate_output_quality` を呼び出し、
結果を `ActivityFeed` に表示:

```typescript
// +page.svelte 内の実行完了ハンドラに追加
const qualityResult = await validateOutputQuality(sourcePath, outputPath);
if (!qualityResult.passed) {
  activityFeedStore.push({
    type: "error",
    message: `品質チェック警告: ${qualityResult.warnings.join(", ")}`,
    icon: "⚠️",
    expandable: true,
    detail: qualityResult.checks
      .filter(c => !c.passed)
      .map(c => `${c.name}: ${c.detail}`)
      .join("\n")
  });
} else {
  activityFeedStore.push({
    type: "completed",
    message: `品質チェック通過（${qualityResult.checks.length}項目）`,
    icon: "✅"
  });
}
```

---

## 実装順序

1. **Task 160** — 設計ドキュメント（OutputArtifact 型定義、パイプライン図）
2. **Task 161** — ArtifactPreview コンポーネント + Contracts スキーマ
3. **Task 163** — 品質バリデーション（独立して実装可能）
4. **Task 162** — 複数出力フォーマット

## 検証チェックリスト

- [ ] `pnpm -C packages/contracts build` がパスすること
- [ ] `cargo build` がエラーなくパスすること
- [ ] 既存の SheetDiff プレビューが ArtifactPreview 経由で表示されること（リグレッションなし）
- [ ] テキスト差分プレビューが before/after 形式で表示されること
- [ ] CSV テーブルプレビューが正しくレンダリングされること
- [ ] 複数 artifact 時にタブ切り替えが動作すること
- [ ] 品質チェック結果が ActivityFeed に表示されること
- [ ] 空ファイル出力時に警告が表示されること
- [ ] CSV インジェクション検出が動作すること
- [ ] 複数フォーマット出力（CSV + XLSX）が動作すること
