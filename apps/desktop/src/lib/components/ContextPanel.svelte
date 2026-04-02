<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import SegmentedControl from "./SegmentedControl.svelte";

  // ---- Props ----
  export let mcpServers: { name: string; status: "connected" | "connecting" | "disconnected" }[] = [];
  export let inboxFiles: { path: string; size: number; addedAt: string }[] = [];
  export let approvalPolicy: { scope: "session" | "always" | "ask"; patterns: string[] } = { scope: "ask", patterns: [] };
  export let projectName = "";
  export let projectPath = "";

  const dispatch = createEventDispatcher<{
    addFile: { path: string };
    removeFile: { path: string };
    policyChange: { scope: "session" | "always" | "ask" };
  }>();

  // ---- Tabs ----
  const tabs = [
    { value: "files",   label: "FILES" },
    { value: "servers", label: "MCP" },
    { value: "policy",  label: "POLICY" },
  ];
  let activeTab = "files";

  // ---- File drop ----
  let isDragOver = false;
  let hiddenInput: HTMLInputElement | null = null;

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragOver = false;
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const f = files[i] as File & { path?: string };
      const p = f.path?.trim();
      if (p) dispatch("addFile", { path: p });
    }
  }

  function handleDragOver(e: DragEvent) { e.preventDefault(); isDragOver = true; }
  function handleDragLeave() { isDragOver = false; }

  function pickFile() { hiddenInput?.click(); }

  function handleInputChange(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const f = target.files?.[0] as (File & { path?: string }) | undefined;
    const p = f?.path?.trim();
    if (p) dispatch("addFile", { path: p });
    target.value = "";
  }

  function removeFile(path: string) { dispatch("removeFile", { path }); }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function basename(p: string): string {
    const sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return sep < 0 ? p : p.slice(sep + 1);
  }

  function dotClass(status: string): string {
    if (status === "connected")   return "dot dot-success dot-ping";
    if (status === "connecting")  return "dot dot-warning dot-ping-fast";
    return "dot dot-offline";
  }

  function policyLabel(scope: string): string {
    if (scope === "always")  return "常に許可";
    if (scope === "session") return "このセッションのみ";
    return "毎回確認";
  }

  const policyOptions = [
    { value: "ask",     label: "毎回確認" },
    { value: "session", label: "セッション" },
    { value: "always",  label: "常に許可" },
  ];
</script>

<input
  bind:this={hiddenInput}
  type="file"
  accept=".csv,.xlsx,.xlsm,.xls,.txt,.docx"
  class="hidden-input"
  on:change={handleInputChange}
/>

<aside class="context-panel">
  <!-- Panel header -->
  <div class="panel-header">
    <SegmentedControl items={tabs} bind:value={activeTab} size="sm" />
  </div>

  <!-- FILES tab -->
  {#if activeTab === "files"}
    <div class="tab-body">
      <div
        class="drop-zone"
        class:drag-over={isDragOver}
        on:drop={handleDrop}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
        role="region"
        aria-label="ファイルドロップゾーン"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <span>ファイルをドロップ</span>
        <button type="button" class="pick-btn" on:click={pickFile}>または選択</button>
      </div>

      {#if inboxFiles.length > 0}
        <div class="file-list">
          <span class="label-section">インボックス ({inboxFiles.length})</span>
          {#each inboxFiles as file}
            <div class="file-row">
              <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <div class="file-info">
                <span class="file-name">{basename(file.path)}</span>
                <span class="file-meta">{formatSize(file.size)}</span>
              </div>
              <button type="button" class="remove-btn" on:click={() => removeFile(file.path)} aria-label="削除">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty-hint">ファイルを追加するとエージェントが参照できます</p>
      {/if}
    </div>
  {/if}

  <!-- MCP SERVERS tab -->
  {#if activeTab === "servers"}
    <div class="tab-body">
      <span class="label-section">MCP サーバー</span>
      {#if mcpServers.length === 0}
        <p class="empty-hint">MCPサーバーが設定されていません</p>
      {:else}
        <div class="server-list">
          {#each mcpServers as srv}
            <div class="server-row">
              <span class={dotClass(srv.status)}></span>
              <span class="server-name">{srv.name}</span>
              <span class="server-status">{srv.status === "connected" ? "接続済み" : srv.status === "connecting" ? "接続中…" : "未接続"}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- POLICY tab -->
  {#if activeTab === "policy"}
    <div class="tab-body">
      <span class="label-section">承認ポリシー</span>
      <div class="policy-options">
        {#each policyOptions as opt}
          <button
            type="button"
            class="policy-row"
            class:active={approvalPolicy.scope === opt.value}
            on:click={() => { approvalPolicy = { ...approvalPolicy, scope: opt.value as any }; dispatch("policyChange", { scope: opt.value as any }); }}
          >
            <span class="policy-dot" class:active={approvalPolicy.scope === opt.value}></span>
            <span class="policy-label">{opt.label}</span>
          </button>
        {/each}
      </div>

      {#if approvalPolicy.patterns.length > 0}
        <div class="pattern-section">
          <span class="label-section">許可パターン</span>
          {#each approvalPolicy.patterns as pat}
            <code class="pattern-chip">{pat}</code>
          {/each}
        </div>
      {/if}

      <!-- Project info -->
      {#if projectName || projectPath}
        <div class="project-section">
          <span class="label-section">プロジェクト</span>
          {#if projectName}
            <span class="project-name">{projectName}</span>
          {/if}
          {#if projectPath}
            <code class="project-path">{projectPath}</code>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .hidden-input { display: none; }

  .context-panel {
    display: flex;
    flex-direction: column;
    width: var(--context-w, 260px);
    height: 100%;
    background: var(--c-sidebar, #f9fafb);
    border-left: 1px solid var(--c-border);
    overflow: hidden;
  }

  /* Panel header */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-3, 12px) var(--sp-3, 12px) var(--sp-2, 8px);
    border-bottom: 1px solid var(--c-border);
    flex-shrink: 0;
  }

  /* Tabs */
  .tab-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-2, 8px) 0 var(--sp-4, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--sp-1, 4px);
  }

  /* Drop zone */
  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2, 8px);
    margin: var(--sp-2, 8px) var(--sp-3, 12px);
    padding: var(--sp-4, 16px) var(--sp-3, 12px);
    border: 1.5px dashed var(--c-border-strong);
    border-radius: var(--r-md, 16px);
    text-align: center;
    transition: border-color var(--duration-fast), background var(--duration-fast);
    cursor: default;
  }
  .drop-zone.drag-over {
    border-color: var(--c-accent);
    background: var(--c-accent-subtle);
  }
  .drop-zone svg {
    width: 24px;
    height: 24px;
    color: var(--c-text-3);
  }
  .drop-zone span {
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-text-3);
  }

  .pick-btn {
    font-size: var(--sz-xs, 0.75rem);
    font-weight: 500;
    color: var(--c-accent);
    cursor: pointer;
    transition: color var(--duration-fast);
  }
  .pick-btn:hover { color: var(--c-accent-hover); }

  /* File list */
  .file-list { display: flex; flex-direction: column; }

  .file-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    padding: var(--sp-2, 8px) var(--sp-3, 12px);
    border-radius: var(--r-sm, 8px);
    margin: 0 var(--sp-1, 4px);
    transition: background var(--duration-fast);
  }
  .file-row:hover { background: var(--c-border); }

  .file-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--c-text-3);
  }

  .file-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .file-name {
    font-size: var(--sz-sm, 0.875rem);
    color: var(--c-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-meta {
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-text-3);
  }

  .remove-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--c-text-3);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--duration-fast), background var(--duration-fast), color var(--duration-fast);
  }
  .file-row:hover .remove-btn { opacity: 1; }
  .remove-btn:hover { background: var(--c-error-subtle); color: var(--c-error); }
  .remove-btn svg { width: 12px; height: 12px; }

  /* Server list */
  .server-list { display: flex; flex-direction: column; gap: 2px; padding: 0 var(--sp-1, 4px); }

  .server-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    padding: var(--sp-2, 8px) var(--sp-3, 12px);
    border-radius: var(--r-sm, 8px);
  }
  .server-name {
    flex: 1;
    font-size: var(--sz-sm, 0.875rem);
    color: var(--c-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .server-status {
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-text-3);
    flex-shrink: 0;
  }

  /* Policy */
  .policy-options {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 var(--sp-1, 4px);
  }

  .policy-row {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    padding: var(--sp-2, 8px) var(--sp-3, 12px);
    border-radius: var(--r-sm, 8px);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast);
  }
  .policy-row:hover { background: var(--c-border); }
  .policy-row.active { background: var(--c-accent-subtle); }

  .policy-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1.5px solid var(--c-border-strong);
    transition: background var(--duration-fast), border-color var(--duration-fast);
  }
  .policy-dot.active {
    background: var(--c-accent);
    border-color: var(--c-accent);
  }

  .policy-label {
    font-size: var(--sz-sm, 0.875rem);
    color: var(--c-text);
  }

  /* Pattern chips */
  .pattern-section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1, 4px);
    padding: 0 var(--sp-3, 12px);
  }
  .pattern-chip {
    display: block;
    font-size: var(--sz-xs, 0.75rem);
    font-family: var(--font-mono);
    color: var(--c-text-2);
    background: var(--c-surface, #fff);
    border: 1px solid var(--c-border);
    border-radius: var(--r-sm, 8px);
    padding: 2px var(--sp-2, 8px);
  }

  /* Project */
  .project-section {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1, 4px);
    padding: 0 var(--sp-3, 12px);
  }
  .project-name {
    font-size: var(--sz-sm, 0.875rem);
    font-weight: 500;
    color: var(--c-text);
  }
  .project-path {
    font-size: var(--sz-xs, 0.75rem);
    font-family: var(--font-mono);
    color: var(--c-text-3);
    word-break: break-all;
  }

  /* Empty hints */
  .empty-hint {
    padding: var(--sp-3, 12px) var(--sp-4, 16px);
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-text-3);
    margin: 0;
    text-align: center;
  }
</style>
