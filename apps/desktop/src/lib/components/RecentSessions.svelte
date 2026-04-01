<script lang="ts">
  export let recentSessions: {
    sessionId: string;
    title: string;
    workbookPath: string;
  }[] = [];
  export let showRecent = false;
  export let visible = true;
  export let hasRecoverableDraft: (sessionId: string) => boolean = () => false;
  export let onToggle: () => void = () => {};
  export let onSelect: (sessionId: string) => void = () => {};
</script>

{#if visible && recentSessions.length > 0}
  <button class="recent-toggle" type="button" on:click={onToggle}>
    {showRecent ? "最近の作業を閉じる" : `最近の作業（${recentSessions.length}件）`}
  </button>

  {#if showRecent}
    <div class="recent-list">
      {#each recentSessions.slice(0, 5) as session}
        <button class="recent-item" type="button" on:click={() => onSelect(session.sessionId)}>
          <div class="recent-copy">
            <span class="recent-title">{session.title}</span>
            {#if session.workbookPath}
              <span class="recent-path">{session.workbookPath}</span>
            {/if}
          </div>
          {#if hasRecoverableDraft(session.sessionId)}
            <span class="recent-badge">下書きを再開</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .recent-toggle {
    width: 100%;
    margin-bottom: 0.75rem;
  }

  .recent-list {
    display: grid;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }

  .recent-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    padding: 0.85rem 1rem;
    border: 1px solid var(--ra-border);
    border-radius: 12px;
    background: var(--ra-surface);
    cursor: pointer;
    text-align: left;
  }

  .recent-copy {
    min-width: 0;
    display: grid;
    gap: 0.2rem;
  }

  .recent-title {
    font-weight: 600;
  }

  .recent-path {
    color: var(--ra-text-muted);
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-badge {
    font-size: 0.75rem;
    color: var(--ra-accent);
    flex-shrink: 0;
  }
</style>
