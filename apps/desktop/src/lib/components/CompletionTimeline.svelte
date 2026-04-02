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
    <div class="completion-icon">
      <svg class="checkmark-svg" viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">
        <circle class="checkmark-circle" cx="26" cy="26" r="24" fill="none" />
        <path class="checkmark-check" fill="none" d="M14 27l8 8 16-16" />
      </svg>
    </div>
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
    gap: var(--sp-6);
    padding: var(--sp-6);
    border: 1px solid var(--c-success-subtle);
    border-radius: 16px;
    background: var(--c-surface);
    box-shadow: var(--shadow-md);
  }

  /* --- Success hero --- */
  .completion-hero {
    display: flex;
    gap: var(--sp-5);
    align-items: flex-start;
    padding: var(--sp-5);
    background: var(--c-success-subtle);
    border: 1px solid var(--c-success-subtle);
    border-radius: 12px;
  }

  .completion-hero h2 {
    margin: 0 0 var(--sp-1);
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--c-success);
    letter-spacing: -0.01em;
  }

  .completion-hero p {
    margin: 0;
    font-size: var(--sz-base);
    color: var(--c-text-2);
    line-height: 1.6;
  }

  .completion-icon {
    flex-shrink: 0;
    width: 52px;
    height: 52px;
  }

  /* --- Animated checkmark SVG --- */
  .checkmark-svg {
    width: 52px;
    height: 52px;
  }

  .checkmark-circle {
    stroke: var(--c-success);
    stroke-width: 2.5;
    stroke-dasharray: 151;
    stroke-dashoffset: 151;
    animation: checkmark-circle-draw 0.6s var(--ease) forwards;
  }

  .checkmark-check {
    stroke: var(--c-success);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 40;
    stroke-dashoffset: 40;
    animation: checkmark-check-draw 0.4s var(--ease) 0.4s forwards;
  }

  @keyframes checkmark-circle-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes checkmark-check-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  .completion-path {
    margin-top: var(--sp-2);
    font-family: var(--font-mono);
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    word-break: break-all;
  }

  /* --- Action buttons (card-style) --- */
  .completion-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--sp-3);
  }

  .completion-actions .btn {
    padding: var(--sp-4) var(--sp-5);
    font-size: var(--sz-base);
    font-weight: 500;
    border-radius: 12px;
    text-align: center;
    min-height: 56px;
    box-shadow: var(--shadow-sm);
    transition: all var(--duration-fast) var(--ease);
  }

  .completion-actions .btn:hover:not(:disabled) {
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }

  .completion-actions :global(.btn-primary) {
    background: var(--c-success);
    border: 1px solid var(--c-success-subtle);
  }

  .completion-actions :global(.btn-primary:hover:not(:disabled)) {
    background: color-mix(in srgb, var(--c-success) 88%, black);
  }

  .completion-actions :global(.btn-secondary) {
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
  }

  /* --- Execution timeline feed --- */
  .completion-feed {
    display: grid;
    gap: 0;
  }

  .completion-event {
    display: flex;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border-left: 2px solid var(--c-border-strong);
    margin-left: var(--sp-3);
    position: relative;
    transition: background var(--duration-fast);
  }

  .completion-event:hover {
    background: #f0eeea;
    border-radius: 0 8px 8px 0;
  }

  .completion-event:last-child {
    border-left-color: var(--c-success);
  }

  .completion-event-icon {
    font-size: var(--sz-lg);
    line-height: 1;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .completion-event-message {
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text);
    line-height: 1.5;
  }

  .completion-event-detail {
    color: var(--c-text-3);
    font-size: var(--sz-xs);
    line-height: 1.5;
    margin-top: var(--sp-1);
  }

  /* --- Reduced motion --- */
  @media (prefers-reduced-motion: reduce) {
    .checkmark-circle,
    .checkmark-check {
      animation: none;
      stroke-dashoffset: 0;
    }
  }
</style>
