<script lang="ts">
  import { afterUpdate } from "svelte";

  import type { ActivityFeedEvent } from "$lib/stores/delegation";

  export let events: ActivityFeedEvent[] = [];
  export let emptyLabel = "やりたいことを入力して、エージェントを開始してください。";

  let feedContainer: HTMLDivElement | null = null;
  let lastScrolledEventKey = "";

  afterUpdate(() => {
    if (!feedContainer || events.length === 0) {
      return;
    }

    const tailEvent = events[events.length - 1];
    const nextScrollKey = `${events.length}:${tailEvent?.id ?? ""}`;
    if (nextScrollKey === lastScrolledEventKey) {
      return;
    }

    lastScrolledEventKey = nextScrollKey;
    queueMicrotask(() => {
      if (feedContainer?.isConnected) {
        feedContainer.scrollTop = feedContainer.scrollHeight;
      }
    });
  });
</script>

<div class="activity-feed" bind:this={feedContainer}>
  {#if events.length === 0}
    <div class="feed-empty">{emptyLabel}</div>
  {:else}
    {#each events as event (event.id)}
      <div class="feed-event" class:event-action-required={event.actionRequired} class:event-error={event.type === "error"}>
        <span class="event-icon">{event.icon}</span>
        <div class="event-content">
          <div class="event-headline">
            <div class="event-message">{event.message}</div>
            {#if event.badgeLabel}
              <span class="event-badge">{event.badgeLabel}</span>
            {/if}
          </div>
          {#if event.detail && event.expandable}
            <details class="event-detail">
              <summary>詳細を見る</summary>
              <pre>{event.detail}</pre>
            </details>
          {:else if event.detail}
            <div class="event-detail-inline">{event.detail}</div>
          {/if}
          <time class="event-time">
            {new Date(event.timestamp).toLocaleTimeString("ja-JP")}
          </time>
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  /* ── Shizuka: ActivityFeed ── */

  .activity-feed {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    padding: var(--sp-4) var(--sp-4) var(--sp-4) var(--sp-6);
    position: relative;
  }

  /* Vertical timeline line */
  .activity-feed::before {
    content: "";
    position: absolute;
    top: var(--sp-4);
    bottom: var(--sp-4);
    left: calc(var(--sp-6) + 0.5rem - 1px);
    width: 2px;
    background: var(--c-border-strong);
    border-radius: var(--r-full);
  }

  .feed-empty {
    color: var(--c-text-3);
    font-size: var(--sz-sm);
    padding: var(--sp-4);
    text-align: center;
  }

  .feed-event {
    display: flex;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-3) var(--sp-3) 0;
    position: relative;
    transition: background var(--duration-fast) var(--ease);
  }

  .feed-event:hover {
    background: #f0eeea;
    border-radius: 8px;
  }

  /* Timeline dot */
  .event-icon {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.1rem;
    height: 1.1rem;
    font-size: var(--sz-sm);
    line-height: 1;
    background: var(--c-surface);
    border: 2px solid var(--c-border-strong);
    border-radius: var(--r-full);
    margin-top: var(--sp-1);
  }

  .event-action-required .event-icon {
    border-color: var(--c-warning);
    background: var(--c-warning-subtle);
  }

  .event-error .event-icon {
    border-color: var(--c-error);
    background: var(--c-error-subtle);
  }

  /* Action-required & error states */
  .event-action-required {
    background: var(--c-warning-subtle);
    border-left: 3px solid var(--c-warning);
    border-radius: 8px;
    padding-left: var(--sp-3);
  }

  .event-error {
    background: var(--c-error-subtle);
    border-left: 3px solid var(--c-error);
    border-radius: 8px;
    padding-left: var(--sp-3);
  }

  .event-content {
    min-width: 0;
    display: grid;
    gap: var(--sp-1);
    flex: 1;
  }

  .event-headline {
    display: flex;
    gap: var(--sp-2);
    align-items: center;
    flex-wrap: wrap;
  }

  .event-message {
    font-weight: 500;
    font-size: var(--sz-sm);
    color: var(--c-text);
  }

  .event-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem var(--sp-2);
    border-radius: var(--r-full);
    background: #f0eeea;
    color: var(--c-text-2);
    font-size: var(--sz-xs);
    font-weight: 500;
  }

  .event-detail-inline,
  .event-time,
  .event-detail {
    color: var(--c-text-3);
    font-size: var(--sz-xs);
  }

  .event-detail {
    margin-top: var(--sp-1);
  }

  .event-detail summary {
    cursor: pointer;
    user-select: none;
    color: var(--c-accent);
    font-size: var(--sz-xs);
    font-weight: 500;
    transition: color var(--duration-fast);
  }

  .event-detail summary:hover {
    color: var(--c-accent-hover);
  }

  .event-detail[open] summary {
    margin-bottom: var(--sp-1);
  }

  .event-time {
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
  }

  pre {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono);
    font-size: var(--sz-xs);
    background: #f0eeea;
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-sm);
    border: 1px solid var(--c-border-strong);
    margin: 0;
  }
</style>
