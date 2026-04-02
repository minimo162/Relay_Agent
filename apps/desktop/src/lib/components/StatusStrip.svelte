<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let connected = false;
  export let connecting = false;
  export let projectName = "";

  const dispatch = createEventDispatcher<{
    connectionClick: void;
  }>();

  $: dotClass = connected
    ? "dot dot-success dot-ping"
    : connecting
    ? "dot dot-warning dot-ping-fast"
    : "dot dot-offline";

  $: statusText = connected ? "接続済み" : connecting ? "接続中…" : "未接続";
</script>

<footer class="status-strip">
  <button class="connection-status" type="button" on:click={() => dispatch("connectionClick")}>
    <span class={dotClass}></span>
    <span class="connection-text">{statusText}</span>
  </button>

  {#if projectName}
    <span class="project-name">{projectName}</span>
  {/if}
</footer>

<style>
  .status-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--statusbar-h, 28px);
    padding: 0 var(--sp-4);
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    border-top: 1px solid var(--c-divider);
    user-select: none;
  }

  .connection-status {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--c-text-3);
    padding: 2px var(--sp-2);
    border-radius: var(--r-full);
    transition: background var(--duration-fast);
  }
  .connection-status:hover { background: var(--c-border); }

  .connection-text { font-size: var(--sz-xs); }

  .project-name {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 180px;
  }
</style>
