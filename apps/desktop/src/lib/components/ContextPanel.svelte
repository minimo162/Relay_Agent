<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import InboxPanel from "./InboxPanel.svelte";
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

<aside class="context-panel">
  <!-- Panel header -->
  <div class="panel-header">
    <SegmentedControl items={tabs} bind:value={activeTab} size="sm" />
  </div>

  <!-- FILES tab -->
  {#if activeTab === "files"}
    <InboxPanel
      {inboxFiles}
      on:addFile={(event) => dispatch("addFile", event.detail)}
      on:removeFile={(event) => dispatch("removeFile", event.detail)}
    />
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
