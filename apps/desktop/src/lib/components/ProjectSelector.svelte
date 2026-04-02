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
    gap: var(--sp-3);
  }

  /* --- Dropdown row --- */
  .project-row {
    display: grid;
    gap: var(--sp-2);
  }

  .project-row > label {
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text-2);
    letter-spacing: 0.01em;
  }

  .project-select-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--sp-2);
  }

  .project-select {
    min-height: 2.75rem;
    border-radius: var(--r-md);
    border: 1px solid var(--c-border-strong);
    background: var(--c-surface);
    color: var(--c-text);
    padding: 0 var(--sp-8) 0 var(--sp-3);
    font-size: var(--sz-base);
    font-family: inherit;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--sp-3) center;
    cursor: pointer;
    transition: border-color var(--duration-fast),
                box-shadow var(--duration-fast);
  }

  .project-select:focus {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-subtle);
  }

  /* --- Project creation / detail card --- */
  .project-card {
    display: grid;
    gap: var(--sp-3);
    padding: var(--sp-5);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: var(--shadow-sm);
  }

  .project-meta {
    color: var(--c-text-3);
    font-size: var(--sz-sm);
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .project-meta::before {
    content: "";
    width: 4px;
    height: 4px;
    border-radius: var(--r-full);
    background: var(--c-border-strong);
    flex-shrink: 0;
  }

  .project-empty {
    color: var(--c-text-3);
    font-size: var(--sz-sm);
    font-style: italic;
    margin: 0;
  }

  .field-success {
    color: var(--c-success);
    font-size: var(--sz-sm);
    font-weight: 500;
    margin: 0;
  }

  .field-warn {
    color: var(--c-warning);
    font-size: var(--sz-sm);
    font-weight: 500;
    margin: 0;
  }

  /* --- Details / accordion --- */
  .project-details {
    display: grid;
    gap: var(--sp-3);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-md);
    overflow: hidden;
  }

  .project-details > summary {
    padding: var(--sp-3) var(--sp-4);
    font-weight: 500;
    font-size: var(--sz-sm);
    color: var(--c-text);
    background: #f0eeea;
    cursor: pointer;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    transition: background var(--duration-fast);
  }

  .project-details > summary:hover {
    background: #f0eeea;
  }

  .project-details > summary::before {
    content: "";
    width: 0;
    height: 0;
    border-left: 5px solid var(--c-text-3);
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    flex-shrink: 0;
    transition: transform var(--duration-fast) var(--ease);
  }

  .project-details[open] > summary::before {
    transform: rotate(90deg);
  }

  .project-details > summary::-webkit-details-marker {
    display: none;
  }

  .project-details > :not(summary) {
    padding: 0 var(--sp-4) var(--sp-3);
  }

  .project-details pre {
    white-space: pre-wrap;
    margin: 0;
    padding: var(--sp-3);
    background: #f0eeea;
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: var(--sz-xs);
    color: var(--c-text-2);
    line-height: 1.6;
    border: 1px solid var(--c-border-strong);
  }

  /* --- Memory list --- */
  .memory-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-2);
  }

  .memory-list li {
    display: flex;
    justify-content: space-between;
    gap: var(--sp-3);
    align-items: center;
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-md);
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    transition: all var(--duration-fast) var(--ease);
  }

  .memory-list li:hover {
    border-color: var(--c-border-strong);
    box-shadow: var(--shadow-sm);
  }

  .memory-list li div {
    display: grid;
    gap: var(--sp-1);
    min-width: 0;
  }

  .memory-list li strong {
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text);
  }

  .memory-list li span {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* --- Memory form --- */
  .memory-form {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: var(--sp-2);
    padding: var(--sp-3);
    background: #f0eeea;
    border-radius: var(--r-md);
    border: 1px solid var(--c-border-strong);
  }

  /* --- Session actions --- */
  .session-actions {
    display: flex;
    gap: var(--sp-2);
    flex-shrink: 0;
  }

  .session-bulk-actions {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  .session-assign-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--sp-2);
  }

  /* --- Responsive --- */
  @media (max-width: 720px) {
    .memory-form,
    .project-select-row,
    .session-assign-row {
      grid-template-columns: 1fr;
    }

    .memory-list li {
      flex-direction: column;
      align-items: stretch;
    }

    .session-actions {
      justify-content: flex-end;
    }
  }
</style>
