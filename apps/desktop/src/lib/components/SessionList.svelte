<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let sessions: { id: string; title: string; updatedAt: string; isDraft?: boolean }[] = [];
  export let currentSessionId = "";

  const dispatch = createEventDispatcher<{
    select: { id: string };
  }>();

  function relativeTime(isoDate: string): string {
    const d = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "たった今";
    if (diffMin < 60) return `${diffMin}分前`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}時間前`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}日前`;
    return d.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
  }
</script>

{#if sessions.length === 0}
  <p class="empty">セッションはまだありません</p>
{:else}
  <div class="session-list">
    {#each sessions as session (session.id)}
      <button
        class="session-row"
        class:active={session.id === currentSessionId}
        type="button"
        on:click={() => dispatch("select", { id: session.id })}
      >
        <span class="session-title">{session.title || "無題"}</span>
        <span class="session-meta">
          {#if session.isDraft}
            <span class="draft-badge">下書き</span>
          {/if}
          <span class="session-time">{relativeTime(session.updatedAt)}</span>
        </span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .empty {
    text-align: center;
    font-size: var(--sz-sm, 0.8125rem);
    color: var(--c-text-3, #a8a29e);
    padding: var(--sp-8, 32px) var(--sp-4, 16px);
    margin: 0;
  }

  .session-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .session-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--sp-3, 12px) var(--sp-4, 16px);
    text-align: left;
    color: var(--c-text, #1c1917);
    border-radius: var(--r-sm, 6px);
    transition: background var(--duration-fast, 150ms);
  }
  .session-row:hover { background: var(--c-accent-subtle); }
  .session-row.active {
    background: var(--c-accent-subtle);
    color: var(--c-accent);
  }

  .session-title {
    font-size: var(--sz-sm, 0.8125rem);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .session-meta {
    display: flex;
    align-items: center;
    gap: var(--sp-2, 8px);
    flex-shrink: 0;
  }

  .draft-badge {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--c-accent);
    background: var(--c-accent-subtle);
    padding: 1px 6px;
    border-radius: var(--r-full);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .session-time {
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-text-3, #a8a29e);
  }
</style>
