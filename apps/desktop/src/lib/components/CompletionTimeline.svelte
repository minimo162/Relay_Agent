<script lang="ts">
  import type { ActivityFeedEvent } from "$lib/stores/delegation";

  export let events: ActivityFeedEvent[] = [];
  export let summary = "";
  export let outputPath = "";
  export let canSaveTemplate = false;
  export let onOpenOutput: () => void = () => {};
  export let onSaveTemplate: () => void = () => {};
  export let onReset: () => void = () => {};
</script>

<section class="completion-timeline">
  <div class="completion-hero">
    <div class="completion-icon">✅</div>
    <div>
      <h2>完了しました</h2>
      <p>{summary}</p>
      {#if outputPath}
        <p class="completion-path">{outputPath}</p>
      {/if}
    </div>
  </div>

  <div class="completion-actions">
    {#if outputPath}
      <button class="btn btn-secondary" type="button" on:click={onOpenOutput}>
        出力ファイルを開く
      </button>
    {/if}
    {#if canSaveTemplate}
      <button class="btn btn-secondary" type="button" on:click={onSaveTemplate}>
        テンプレートとして保存
      </button>
    {/if}
    <button class="btn btn-primary" type="button" on:click={onReset}>
      新しい作業を始める
    </button>
  </div>

  <div class="completion-feed">
    {#each events as event (event.id)}
      <article class="completion-event">
        <span class="completion-event-icon">{event.icon}</span>
        <div>
          <div class="completion-event-message">{event.message}</div>
          {#if event.detail}
            <div class="completion-event-detail">{event.detail}</div>
          {/if}
        </div>
      </article>
    {/each}
  </div>
</section>

<style>
  .completion-timeline {
    display: grid;
    gap: 1rem;
    padding: 1rem;
    border: 1px solid var(--ra-border);
    border-radius: 16px;
    background: var(--ra-surface);
  }

  .completion-hero {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }

  .completion-icon {
    font-size: 2rem;
  }

  .completion-path,
  .completion-event-detail {
    color: var(--ra-text-muted);
    font-size: 0.85rem;
  }

  .completion-actions,
  .completion-feed {
    display: grid;
    gap: 0.75rem;
  }

  .completion-event {
    display: flex;
    gap: 0.65rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--ra-border);
  }
</style>
