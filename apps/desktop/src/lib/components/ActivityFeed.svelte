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
  .activity-feed {
    display: grid;
    gap: 0.75rem;
    overflow-y: auto;
    padding: 1rem;
  }

  .feed-empty {
    color: var(--ra-text-muted);
  }

  .feed-event {
    display: flex;
    gap: 0.75rem;
    padding: 0.85rem;
    border-radius: 12px;
    border: 1px solid var(--ra-border);
    background: var(--ra-surface);
  }

  .event-action-required {
    border-color: #e2b15d;
    background: #fff9ef;
  }

  .event-error {
    border-color: #cf786c;
    background: #fff3f1;
  }

  .event-icon {
    font-size: 1.1rem;
    line-height: 1;
  }

  .event-content {
    min-width: 0;
    display: grid;
    gap: 0.35rem;
  }

  .event-headline {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .event-message {
    font-weight: 600;
  }

  .event-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ra-text-muted) 12%, white);
    color: var(--ra-text-muted);
    font-size: 0.72rem;
    font-weight: 600;
  }

  .event-detail-inline,
  .event-time,
  .event-detail {
    color: var(--ra-text-muted);
    font-size: 0.82rem;
  }

  pre {
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
