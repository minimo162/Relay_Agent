# Codex プロンプト 16 — プロジェクト & 永続メモリ（Tasks 150–154）

## 対象タスク

- **Task 150**: 設計 — プロジェクトモデル定義
- **Task 151**: Contracts & バックエンド — プロジェクトスキーマ & CRUD
- **Task 152**: フロントエンド — プロジェクト選択 & コンテキスト UI
- **Task 153**: バックエンド — プロジェクトメモリ（学習した設定の蓄積）
- **Task 154**: フロントエンド — プロジェクトスコープのファイルアクセス制限

## 概要

「プロジェクト」= フォルダ + カスタム指示 + 蓄積メモリ。
セッションを横断して文脈を保持し、Copilot プロンプトに自動注入する。

**基本方針:**
- プロジェクトはオプション機能（プロジェクト未選択でも従来通り動作）
- Contracts-first: Zod スキーマ → Rust 型 → UI
- 永続化は既存の JSON ストレージパターンに従う
- カスタム指示はすべての Copilot プロンプトに自動追加

## 前提

### 既存パターン

- **セッション CRUD**: `storage.rs` — `create_session`, `list_sessions`, `read_session` の CRUD パターンが参考
- **永続化**: `storage.rs` の `persistence` モジュールが JSON ファイルへの読み書きを管理
- **IPC**: `packages/contracts/src/ipc.ts` で Zod スキーマ定義 → `apps/desktop/src/lib/ipc.ts` でラッパー関数
- **プロンプト注入**: `apps/desktop/src/lib/prompt-templates.ts` がプロンプト生成を管理

### 既存スキーマ

```typescript
// packages/contracts/src/shared.ts
entityIdSchema  // z.string().trim().min(1)
iso8601Schema   // z.string().datetime()

// packages/contracts/src/ipc.ts
createSessionRequestSchema  // 参考パターン
```

---

## Task 150: 設計 — プロジェクトモデル定義

### `docs/PROJECT_MODEL_DESIGN.md` を作成

内容:
- プロジェクトモデルの定義（下記スキーマ）
- ファイルアクセススコープの制約ルール
- カスタム指示の注入フロー
- メモリの蓄積・参照フロー

---

## Task 151: Contracts & バックエンド — プロジェクトスキーマ & CRUD

### 新規ファイル: `packages/contracts/src/project.ts`

```typescript
import { z } from "zod";
import { entityIdSchema, iso8601Schema, nonEmptyStringSchema } from "./shared";

export const projectMemoryEntrySchema = z.object({
  key: nonEmptyStringSchema,
  value: z.string(),
  learnedAt: iso8601Schema,
  source: z.enum(["user", "auto"]).default("user")
});

export const projectSchema = z.object({
  id: entityIdSchema,
  name: nonEmptyStringSchema,
  rootFolder: nonEmptyStringSchema,
  customInstructions: z.string().default(""),
  memory: z.array(projectMemoryEntrySchema).default([]),
  sessionIds: z.array(z.string()).default([]),
  createdAt: iso8601Schema,
  updatedAt: iso8601Schema
});

export type ProjectMemoryEntry = z.infer<typeof projectMemoryEntrySchema>;
export type Project = z.infer<typeof projectSchema>;
```

### `packages/contracts/src/index.ts` に追加

```typescript
export * from "./project";
```

### `packages/contracts/src/ipc.ts` に追加

```typescript
import { projectSchema } from "./project";

// --- Project CRUD ---

export const createProjectRequestSchema = z.object({
  name: nonEmptyStringSchema,
  rootFolder: nonEmptyStringSchema,
  customInstructions: z.string().default("")
});

export const updateProjectRequestSchema = z.object({
  projectId: entityIdSchema,
  name: nonEmptyStringSchema.optional(),
  customInstructions: z.string().optional()
});

export const addProjectMemoryRequestSchema = z.object({
  projectId: entityIdSchema,
  key: nonEmptyStringSchema,
  value: z.string(),
  source: z.enum(["user", "auto"]).default("user")
});

export const removeProjectMemoryRequestSchema = z.object({
  projectId: entityIdSchema,
  key: nonEmptyStringSchema
});

export const listProjectsResponseSchema = z.object({
  projects: z.array(projectSchema)
});

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type AddProjectMemoryRequest = z.infer<typeof addProjectMemoryRequestSchema>;
export type RemoveProjectMemoryRequest = z.infer<typeof removeProjectMemoryRequestSchema>;
```

### Rust バックエンド — `apps/desktop/src-tauri/src/models.rs` に追加

```rust
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemoryEntry {
    pub key: String,
    pub value: String,
    pub learned_at: String,
    pub source: ProjectMemorySource,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectMemorySource {
    User,
    Auto,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_folder: String,
    pub custom_instructions: String,
    pub memory: Vec<ProjectMemoryEntry>,
    pub session_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    pub root_folder: String,
    pub custom_instructions: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectRequest {
    pub project_id: String,
    pub name: Option<String>,
    pub custom_instructions: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectMemoryRequest {
    pub project_id: String,
    pub key: String,
    pub value: String,
    pub source: Option<ProjectMemorySource>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProjectMemoryRequest {
    pub project_id: String,
    pub key: String,
}
```

### Rust バックエンド — `apps/desktop/src-tauri/src/storage.rs` に追加

`AppStorage` に `projects: HashMap<String, Project>` フィールドを追加。
セッション CRUD と同じパターンで実装:

```rust
impl AppStorage {
    pub fn create_project(&mut self, request: CreateProjectRequest) -> Result<Project, String> {
        let now = chrono::Utc::now().to_rfc3339();
        let project = Project {
            id: generate_id(),
            name: request.name,
            root_folder: request.root_folder,
            custom_instructions: request.custom_instructions.unwrap_or_default(),
            memory: Vec::new(),
            session_ids: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.projects.insert(project.id.clone(), project.clone());
        self.persist_project(&project)?;
        Ok(project)
    }

    pub fn list_projects(&self) -> Vec<Project> {
        let mut projects: Vec<_> = self.projects.values().cloned().collect();
        projects.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        projects
    }

    pub fn read_project(&self, project_id: &str) -> Result<Project, String> {
        self.projects.get(project_id)
            .cloned()
            .ok_or_else(|| format!("project not found: {}", project_id))
    }

    pub fn update_project(&mut self, request: UpdateProjectRequest) -> Result<Project, String> {
        let project = self.projects.get_mut(&request.project_id)
            .ok_or_else(|| format!("project not found: {}", request.project_id))?;

        if let Some(name) = request.name {
            project.name = name;
        }
        if let Some(instructions) = request.custom_instructions {
            project.custom_instructions = instructions;
        }
        project.updated_at = chrono::Utc::now().to_rfc3339();

        let updated = project.clone();
        self.persist_project(&updated)?;
        Ok(updated)
    }

    pub fn add_project_memory(&mut self, request: AddProjectMemoryRequest) -> Result<Project, String> {
        let project = self.projects.get_mut(&request.project_id)
            .ok_or_else(|| format!("project not found: {}", request.project_id))?;

        // 既存キーがあれば上書き
        project.memory.retain(|m| m.key != request.key);
        project.memory.push(ProjectMemoryEntry {
            key: request.key,
            value: request.value,
            learned_at: chrono::Utc::now().to_rfc3339(),
            source: request.source.unwrap_or(ProjectMemorySource::User),
        });
        project.updated_at = chrono::Utc::now().to_rfc3339();

        let updated = project.clone();
        self.persist_project(&updated)?;
        Ok(updated)
    }

    pub fn remove_project_memory(&mut self, request: RemoveProjectMemoryRequest) -> Result<Project, String> {
        let project = self.projects.get_mut(&request.project_id)
            .ok_or_else(|| format!("project not found: {}", request.project_id))?;

        project.memory.retain(|m| m.key != request.key);
        project.updated_at = chrono::Utc::now().to_rfc3339();

        let updated = project.clone();
        self.persist_project(&updated)?;
        Ok(updated)
    }
}
```

### Tauri コマンド — `apps/desktop/src-tauri/src/project.rs` (新規)

```rust
use tauri::State;
use std::sync::Mutex;
use crate::models::*;
use crate::storage::AppStorage;

#[tauri::command]
pub fn create_project(
    storage: State<'_, Mutex<AppStorage>>,
    request: CreateProjectRequest,
) -> Result<Project, String> {
    storage.lock().unwrap().create_project(request)
}

#[tauri::command]
pub fn list_projects(
    storage: State<'_, Mutex<AppStorage>>,
) -> Result<Vec<Project>, String> {
    Ok(storage.lock().unwrap().list_projects())
}

#[tauri::command]
pub fn read_project(
    storage: State<'_, Mutex<AppStorage>>,
    project_id: String,
) -> Result<Project, String> {
    storage.lock().unwrap().read_project(&project_id)
}

#[tauri::command]
pub fn update_project(
    storage: State<'_, Mutex<AppStorage>>,
    request: UpdateProjectRequest,
) -> Result<Project, String> {
    storage.lock().unwrap().update_project(request)
}

#[tauri::command]
pub fn add_project_memory(
    storage: State<'_, Mutex<AppStorage>>,
    request: AddProjectMemoryRequest,
) -> Result<Project, String> {
    storage.lock().unwrap().add_project_memory(request)
}

#[tauri::command]
pub fn remove_project_memory(
    storage: State<'_, Mutex<AppStorage>>,
    request: RemoveProjectMemoryRequest,
) -> Result<Project, String> {
    storage.lock().unwrap().remove_project_memory(request)
}
```

### `lib.rs` に登録

```rust
mod project;

// invoke_handler に追加:
project::create_project,
project::list_projects,
project::read_project,
project::update_project,
project::add_project_memory,
project::remove_project_memory,
```

### フロントエンド IPC — `apps/desktop/src/lib/ipc.ts` に追加

```typescript
export function createProject(request: CreateProjectRequest) {
  return invokeWithPayload("create_project", createProjectRequestSchema, projectSchema, request);
}
export function listProjects() {
  return invokeWithoutPayload("list_projects", listProjectsResponseSchema);
}
export function readProject(projectId: string) {
  return invokeWithPayload("read_project", z.object({ projectId: z.string() }), projectSchema, { projectId });
}
export function updateProject(request: UpdateProjectRequest) {
  return invokeWithPayload("update_project", updateProjectRequestSchema, projectSchema, request);
}
export function addProjectMemory(request: AddProjectMemoryRequest) {
  return invokeWithPayload("add_project_memory", addProjectMemoryRequestSchema, projectSchema, request);
}
export function removeProjectMemory(request: RemoveProjectMemoryRequest) {
  return invokeWithPayload("remove_project_memory", removeProjectMemoryRequestSchema, projectSchema, request);
}
```

---

## Task 152: フロントエンド — プロジェクト選択 & コンテキスト UI

### 新規コンポーネント: `apps/desktop/src/lib/components/ProjectSelector.svelte`

```svelte
<script lang="ts">
  import type { Project } from "@relay-agent/contracts";

  export let projects: Project[] = [];
  export let selectedProjectId: string | null = null;
  export let onSelect: (projectId: string | null) => void = () => {};
  export let onCreateNew: () => void = () => {};

  $: selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;
</script>

<div class="project-selector">
  <label class="project-label">プロジェクト</label>
  <select
    class="project-select"
    value={selectedProjectId ?? ""}
    on:change={(e) => {
      const value = e.currentTarget.value;
      onSelect(value || null);
    }}
  >
    <option value="">なし（フリーモード）</option>
    {#each projects as project}
      <option value={project.id}>{project.name}</option>
    {/each}
  </select>
  <button class="new-project-btn" type="button" on:click={onCreateNew}>+</button>

  {#if selectedProject?.customInstructions}
    <details class="project-context">
      <summary>カスタム指示</summary>
      <pre class="instructions-text">{selectedProject.customInstructions}</pre>
    </details>
  {/if}

  {#if selectedProject && selectedProject.memory.length > 0}
    <details class="project-context">
      <summary>学習済み設定（{selectedProject.memory.length}件）</summary>
      <ul class="memory-list">
        {#each selectedProject.memory as entry}
          <li><strong>{entry.key}</strong>: {entry.value}</li>
        {/each}
      </ul>
    </details>
  {/if}
</div>
```

### `+page.svelte` への統合

- ヘッダー領域に `ProjectSelector` を配置
- プロジェクト選択時に `selectedProjectId` を `continuity` に永続化
- プロジェクトのカスタム指示をプロンプト生成に注入

---

## Task 153: バックエンド — プロジェクトメモリ

### プロンプトへのメモリ注入

`apps/desktop/src/lib/prompt-templates.ts` に追加:

```typescript
export function buildProjectContext(
  customInstructions: string,
  memory: Array<{ key: string; value: string }>
): string {
  const sections: string[] = [];

  if (customInstructions.trim()) {
    sections.push(`## プロジェクト指示\n${customInstructions}`);
  }

  if (memory.length > 0) {
    const entries = memory.map(m => `- ${m.key}: ${m.value}`).join("\n");
    sections.push(`## 学習済み設定\n${entries}`);
  }

  return sections.join("\n\n");
}
```

`buildPlanningPromptV2` / `buildFollowUpPromptV2` / `buildStepExecutionPrompt` に
`projectContext?: string` パラメータを追加し、プロンプト先頭に挿入。

### メモリの自動学習

`agent-loop.ts` の `runAgentLoop` 完了時、Copilot の応答に
「このプロジェクトでは〜を推奨」「次回は〜を使用」などのパターンがあれば
自動的にメモリ候補として提案:

```typescript
// onComplete コールバック内
if (config.projectId && result.finalResponse?.message) {
  const suggestions = detectMemoryCandidates(result.finalResponse.message);
  if (suggestions.length > 0) {
    callbacks.onMemorySuggestions?.(suggestions);
  }
}
```

---

## Task 154: フロントエンド — ファイルアクセス制限

### `apps/desktop/src/lib/ipc.ts` または `agent-loop.ts` に追加

```typescript
export function isWithinProjectScope(
  filePath: string,
  rootFolder: string
): boolean {
  const normalizedFile = filePath.replace(/\\/g, "/").toLowerCase();
  const normalizedRoot = rootFolder.replace(/\\/g, "/").toLowerCase();
  return normalizedFile.startsWith(normalizedRoot);
}
```

### エージェントループ内でのチェック

`runAgentLoop` / `resumeAgentLoopWithPlan` の read action 実行前に
ファイルパスがプロジェクトスコープ内かチェック:

```typescript
if (config.projectRootFolder) {
  for (const action of parsedResponse.actions) {
    const paths = extractFilePathsFromAction(action);
    for (const p of paths) {
      if (!isWithinProjectScope(p, config.projectRootFolder)) {
        callbacks.onScopeWarning?.(p, config.projectRootFolder);
      }
    }
  }
}
```

### UI 警告表示

`ActivityFeed` にスコープ外アクセス警告を表示:

```typescript
activityFeedStore.push({
  type: "error",
  message: `スコープ外のファイルアクセス: ${filePath}`,
  icon: "⚠️",
  actionRequired: true,
  detail: `プロジェクトフォルダ (${rootFolder}) 外のファイルです。続行しますか？`
});
```

---

## 実装順序

1. **Task 150** — 設計ドキュメント
2. **Task 151** — Contracts スキーマ + Rust CRUD + IPC ラッパー
3. **Task 153** — プロジェクトメモリ（プロンプト注入）
4. **Task 152** — ProjectSelector UI + 統合
5. **Task 154** — ファイルアクセス制限

## 検証チェックリスト

- [ ] `pnpm -C packages/contracts build` がパスすること
- [ ] `cargo build` がエラーなくパスすること
- [ ] プロジェクト CRUD（作成・一覧・読取・更新）が IPC 経由で動作すること
- [ ] メモリの追加・削除が動作すること
- [ ] カスタム指示が Copilot プロンプトに自動挿入されること
- [ ] メモリ内容が Copilot プロンプトに自動挿入されること
- [ ] プロジェクト未選択時に従来通り動作すること（リグレッションなし）
- [ ] スコープ外ファイルアクセスで警告が表示されること
