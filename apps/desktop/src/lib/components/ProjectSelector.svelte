<script lang="ts">
  import type { Project } from "@relay-agent/contracts";

  type ProjectSessionSummary = {
    id: string;
    title: string;
    updatedAt: string;
    workbookPath?: string | null;
    assignedProjectName?: string | null;
  };

  export let projects: Project[] = [];
  export let selectedProjectId: string | null = null;
  export let creating = false;
  export let createName = "";
  export let createRootFolder = "";
  export let createInstructions = "";
  export let memoryKey = "";
  export let memoryValue = "";
  export let errorMessage = "";
  export let infoMessage = "";
  export let linkedSessions: ProjectSessionSummary[] = [];
  export let filteredLinkedSessions: ProjectSessionSummary[] = [];
  export let filteredAvailableSessions: ProjectSessionSummary[] = [];
  export let sessionQuery = "";
  export let sessionToAssignId = "";
  export let onSelect: (projectId: string | null) => void = () => {};
  export let onToggleCreate: () => void = () => {};
  export let onCreateNameInput: (value: string) => void = () => {};
  export let onCreateRootFolderInput: (value: string) => void = () => {};
  export let onCreateInstructionsInput: (value: string) => void = () => {};
  export let onCreateProject: () => void = () => {};
  export let onMemoryKeyInput: (value: string) => void = () => {};
  export let onMemoryValueInput: (value: string) => void = () => {};
  export let onAddMemory: () => void = () => {};
  export let onRemoveMemory: (key: string) => void = () => {};
  export let onSessionToAssignInput: (sessionId: string) => void = () => {};
  export let onAssignSession: () => void = () => {};
  export let onDetachSession: (sessionId: string) => void = () => {};
  export let onSessionQueryInput: (value: string) => void = () => {};
  export let onAssignFilteredSessions: () => void = () => {};
  export let onDetachFilteredSessions: () => void = () => {};
  export let onOpenSession: (sessionId: string) => void = () => {};

  $: selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  function formatAssignableSessionLabel(session: ProjectSessionSummary): string {
    return session.assignedProjectName
      ? `${session.title} (現在: ${session.assignedProjectName})`
      : session.title;
  }
</script>

<section class="project-selector">
  <div class="project-row">
    <label for="project-select">プロジェクト</label>
    <div class="project-select-row">
      <select
        id="project-select"
        class="project-select"
        value={selectedProjectId ?? ""}
        on:change={(event) => {
          const value = (event.currentTarget as HTMLSelectElement).value.trim();
          onSelect(value || null);
        }}
      >
        <option value="">なし（フリーモード）</option>
        {#each projects as project}
          <option value={project.id}>{project.name}</option>
        {/each}
      </select>
      <button class="btn btn-secondary" type="button" on:click={onToggleCreate}>
        {creating ? "閉じる" : "新規"}
      </button>
    </div>
  </div>

  {#if errorMessage}
    <p class="field-warn">{errorMessage}</p>
  {/if}

  {#if infoMessage}
    <p class="field-success">{infoMessage}</p>
  {/if}

  {#if creating}
    <div class="project-card">
      <input
        class="input"
        placeholder="プロジェクト名"
        value={createName}
        on:input={(event) => onCreateNameInput((event.currentTarget as HTMLInputElement).value)}
      />
      <input
        class="input"
        placeholder="ルートフォルダの絶対パス"
        value={createRootFolder}
        on:input={(event) =>
          onCreateRootFolderInput((event.currentTarget as HTMLInputElement).value)}
      />
      <textarea
        class="textarea"
        rows="3"
        placeholder="このプロジェクトで常に守る指示"
        value={createInstructions}
        on:input={(event) =>
          onCreateInstructionsInput((event.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <button class="btn btn-primary" type="button" on:click={onCreateProject}>
        作成する
      </button>
    </div>
  {/if}

  {#if selectedProject}
    <div class="project-card">
      <p class="project-meta">ルート: {selectedProject.rootFolder}</p>
      <p class="project-meta">紐付け済みセッション: {selectedProject.sessionIds.length} 件</p>

      {#if selectedProject.customInstructions.trim()}
        <details class="project-details" open>
          <summary>カスタム指示</summary>
          <pre>{selectedProject.customInstructions}</pre>
        </details>
      {/if}

      <details class="project-details" open>
        <summary>学習済み設定（{selectedProject.memory.length}件）</summary>
        {#if selectedProject.memory.length === 0}
          <p class="project-empty">まだ登録されていません。</p>
        {:else}
          <ul class="memory-list">
            {#each selectedProject.memory as entry}
              <li>
                <div>
                  <strong>{entry.key}</strong>
                  <span>{entry.value}</span>
                </div>
                <button class="btn btn-secondary" type="button" on:click={() => onRemoveMemory(entry.key)}>
                  削除
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="memory-form">
          <input
            class="input"
            placeholder="キー"
            value={memoryKey}
            on:input={(event) => onMemoryKeyInput((event.currentTarget as HTMLInputElement).value)}
          />
          <input
            class="input"
            placeholder="値"
            value={memoryValue}
            on:input={(event) =>
              onMemoryValueInput((event.currentTarget as HTMLInputElement).value)}
          />
          <button class="btn btn-secondary" type="button" on:click={onAddMemory}>
            追加
          </button>
        </div>
      </details>

      <details class="project-details" open>
        <summary>関連セッション（{linkedSessions.length}件）</summary>
        <input
          class="input"
          placeholder="セッションを検索"
          value={sessionQuery}
          on:input={(event) =>
            onSessionQueryInput((event.currentTarget as HTMLInputElement).value)}
        />
        <div class="session-bulk-actions">
          <button
            class="btn btn-secondary"
            type="button"
            disabled={filteredAvailableSessions.length === 0}
            on:click={onAssignFilteredSessions}
          >
            表示中を一括割り当て
          </button>
          <button
            class="btn btn-secondary"
            type="button"
            disabled={filteredLinkedSessions.length === 0}
            on:click={onDetachFilteredSessions}
          >
            表示中を一括解除
          </button>
        </div>
        {#if filteredLinkedSessions.length === 0}
          <p class="project-empty">まだ紐付けられていません。</p>
        {:else}
          <ul class="memory-list">
            {#each filteredLinkedSessions as session}
              <li>
                <div>
                  <strong>{session.title}</strong>
                  <span>{session.workbookPath || "ワークブック未設定"}</span>
                </div>
                <div class="session-actions">
                  <button class="btn btn-secondary" type="button" on:click={() => onOpenSession(session.id)}>
                    開く
                  </button>
                  <button class="btn btn-secondary" type="button" on:click={() => onDetachSession(session.id)}>
                    外す
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="session-assign-row">
          <select
            class="project-select"
            value={sessionToAssignId}
            on:change={(event) =>
              onSessionToAssignInput((event.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">既存セッションを割り当てる</option>
            {#each filteredAvailableSessions as session}
              <option value={session.id}>{formatAssignableSessionLabel(session)}</option>
            {/each}
          </select>
          <button class="btn btn-secondary" type="button" on:click={onAssignSession}>
            割り当て
          </button>
        </div>
      </details>
    </div>
  {/if}
</section>

<style>
  .project-selector {
    display: grid;
    gap: 0.75rem;
  }

  .project-row {
    display: grid;
    gap: 0.35rem;
  }

  .project-select-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
  }

  .project-select {
    min-height: 2.75rem;
    border-radius: 12px;
    border: 1px solid var(--ra-border);
    background: var(--ra-surface);
    padding: 0 0.8rem;
  }

  .project-card {
    display: grid;
    gap: 0.7rem;
    padding: 0.9rem;
    border: 1px solid var(--ra-border);
    border-radius: 14px;
    background: var(--ra-surface);
  }

  .project-meta,
  .project-empty {
    color: var(--ra-text-muted);
    font-size: 0.88rem;
  }

  .field-success {
    color: var(--ra-success, #0f7b48);
    font-size: 0.88rem;
    margin: 0;
  }

  .project-details {
    display: grid;
    gap: 0.5rem;
  }

  .project-details pre {
    white-space: pre-wrap;
    margin: 0;
  }

  .memory-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.55rem;
  }

  .memory-list li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: start;
    padding: 0.65rem 0.75rem;
    border-radius: 12px;
    background: color-mix(in srgb, var(--ra-accent) 5%, var(--ra-surface));
  }

  .memory-list li div {
    display: grid;
    gap: 0.15rem;
  }

  .memory-form {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 0.5rem;
  }

  .session-actions {
    display: flex;
    gap: 0.5rem;
  }

  .session-bulk-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .session-assign-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
  }

  @media (max-width: 720px) {
    .memory-form,
    .project-select-row,
    .session-assign-row {
      grid-template-columns: 1fr;
    }
  }
</style>
