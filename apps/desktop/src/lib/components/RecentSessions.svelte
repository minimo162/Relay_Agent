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
  /* --- Toggle button --- */
  .recent-toggle {
    width: 100%;
    margin-bottom: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text-2);
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-md);
    transition: all var(--duration-fast) var(--ease);
  }

  .recent-toggle:hover {
    color: var(--c-accent);
    border-color: rgba(13,148,136,0.20);
    background: rgba(13,148,136,0.04);
  }

  /* --- Session list --- */
  .recent-list {
    display: grid;
    gap: var(--sp-2);
    margin-bottom: var(--sp-4);
  }

  /* --- Card-style session items --- */
  .recent-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    width: 100%;
    padding: var(--sp-4);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-lg);
    background: var(--c-surface);
    cursor: pointer;
    text-align: left;
    box-shadow: var(--shadow-sm);
    transition: all var(--duration-fast) var(--ease);
  }

  .recent-item:hover {
    border-color: rgba(13,148,136,0.20);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
    background: rgba(13,148,136,0.04);
  }

  .recent-item:active {
    transform: translateY(0);
    box-shadow: var(--shadow-sm);
  }

  /* --- Content --- */
  .recent-copy {
    min-width: 0;
    display: grid;
    gap: var(--sp-1);
  }

  .recent-title {
    font-weight: 500;
    font-size: var(--sz-sm);
    color: var(--c-text);
    line-height: 1.4;
  }

  .recent-item:hover .recent-title {
    color: var(--c-accent);
  }

  .recent-path {
    color: var(--c-text-3);
    font-size: var(--sz-xs);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.4;
  }

  /* --- Draft badge --- */
  .recent-badge {
    font-size: var(--sz-xs);
    font-weight: 700;
    color: var(--c-accent);
    background: var(--c-accent-subtle);
    border: 1px solid rgba(13,148,136,0.20);
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--r-full);
    flex-shrink: 0;
    white-space: nowrap;
    animation: badge-pulse 2s ease-in-out infinite;
  }

  @keyframes badge-pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  /* --- Reduced motion --- */
  @media (prefers-reduced-motion: reduce) {
    .recent-badge {
      animation: none;
    }
  }
</style>
