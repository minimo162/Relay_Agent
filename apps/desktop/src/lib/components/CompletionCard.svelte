<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let summary = "";
  export let outputPath = "";
  export let canSaveTemplate = false;

  const dispatch = createEventDispatcher<{
    openOutput: void;
    saveTemplate: void;
    reset: void;
  }>();
</script>

<div class="completion-card card">
  <!-- Checkmark -->
  <div class="check-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path class="check-path" d="M20 6 9 17l-5-5" />
    </svg>
  </div>

  <h3 class="completion-title">完了しました</h3>
  <p class="label-section completion-label">Task Complete</p>

  {#if summary}
    <p class="completion-summary">{summary}</p>
  {/if}

  {#if outputPath}
    <p class="completion-output">
      出力先: <code>{outputPath}</code>
    </p>
  {/if}

  <div class="completion-actions">
    {#if outputPath}
      <button class="btn btn-primary" type="button" on:click={() => dispatch("openOutput")}>
        出力を開く
      </button>
    {/if}
    {#if canSaveTemplate}
      <button class="btn btn-secondary" type="button" on:click={() => dispatch("saveTemplate")}>
        テンプレートとして保存
      </button>
    {/if}
    <button class="btn btn-secondary" type="button" on:click={() => dispatch("reset")}>
      新しいタスク
    </button>
  </div>
</div>

<style>
  .completion-card {
    text-align: center;
    padding: var(--sp-10, 40px) var(--sp-6, 24px);
    border-radius: var(--r-xl);
    border-color: var(--c-border-strong);
    box-shadow: var(--shadow-md);
    animation: fade-in var(--duration-normal, 250ms) var(--ease) both;
  }

  @keyframes fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .check-icon {
    width: 48px;
    height: 48px;
    margin: 0 auto var(--sp-4, 16px);
    color: var(--c-success, #16a34a);
  }
  .check-icon svg { width: 100%; height: 100%; }

  .check-path {
    stroke-dasharray: 30;
    stroke-dashoffset: 30;
    animation: check-draw 0.4s ease forwards 0.2s;
  }
  @keyframes check-draw {
    to { stroke-dashoffset: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .check-path { animation: none; stroke-dashoffset: 0; }
  }

  .completion-title {
    font-size: var(--sz-xl, 1.5rem);
    font-weight: 700;
    color: var(--c-success, #16a34a);
    margin: 0;
  }

  .completion-label {
    margin: 0 0 var(--sp-3, 12px);
  }

  .completion-summary {
    font-size: var(--sz-base, 0.875rem);
    color: var(--c-text-2, #78716c);
    margin: 0 0 var(--sp-3, 12px);
    max-width: 480px;
    margin-left: auto;
    margin-right: auto;
    line-height: 1.6;
  }

  .completion-output {
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-text-3, #a8a29e);
    margin: 0 0 var(--sp-6, 24px);
  }
  .completion-output code {
    font-family: var(--font-mono);
    background: var(--c-sidebar, #f9fafb);
    padding: 0.25rem var(--sp-2, 8px);
    border-radius: var(--r-full);
    border: 1px solid var(--c-border);
  }

  .completion-actions {
    display: flex;
    justify-content: center;
    gap: var(--sp-3, 12px);
    flex-wrap: wrap;
  }
</style>
