<script lang="ts">
  import type { BatchJob } from "@relay-agent/contracts";

  export let batchJob: BatchJob | null = null;
  export let onOpenOutputDir: () => void = () => {};
  export let onSkipTarget: (path: string) => void = () => {};

  const statusLabels: Record<string, string> = {
    pending: "待機中",
    running: "実行中",
    waiting_approval: "承認待ち",
    done: "完了",
    failed: "失敗",
    skipped: "スキップ"
  };

  $: completedCount =
    batchJob?.targets.filter((target) => target.status === "done" || target.status === "failed" || target.status === "skipped").length ?? 0;
  $: progressPercent =
    batchJob && batchJob.targets.length > 0
      ? Math.round((completedCount / batchJob.targets.length) * 100)
      : 0;
</script>

<section class="batch-dashboard card">
  <div class="dashboard-head">
    <div>
      <h3>バッチ進行ダッシュボード</h3>
      <p>{batchJob ? `${completedCount} / ${batchJob.targets.length} 完了` : "まだジョブがありません。"}</p>
    </div>
    {#if batchJob?.outputDir}
      <button class="btn btn-secondary" type="button" on:click={onOpenOutputDir}>
        結果フォルダを開く
      </button>
    {/if}
  </div>

  {#if batchJob}
    <div class="progress-bar">
      <div class="progress-fill" style={`width: ${progressPercent}%`}></div>
    </div>

    <div class="target-table">
      {#each batchJob.targets as target (target.filePath)}
        <article class="dashboard-row" data-status={target.status}>
          <div>
            <strong>{target.filePath.split(/[\\/]/).pop()}</strong>
            <p>{statusLabels[target.status] ?? target.status}</p>
          </div>
          <div>
            {#if target.outputPath}
              <p>{target.outputPath}</p>
            {/if}
            {#if target.errorMessage}
              <p class="error">{target.errorMessage}</p>
            {/if}
          </div>
          {#if target.status === "pending"}
            <button class="btn btn-secondary" type="button" on:click={() => onSkipTarget(target.filePath)}>
              スキップ
            </button>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .batch-dashboard,
  .target-table {
    display: grid;
    gap: var(--sp-4);
  }

  .dashboard-head,
  .dashboard-row {
    display: grid;
    gap: var(--sp-3);
  }

  .dashboard-head {
    grid-template-columns: 1fr auto;
    align-items: start;
  }

  .dashboard-head h3 {
    font-size: var(--sz-lg);
    font-weight: 700;
    color: var(--c-text);
    letter-spacing: -0.01em;
  }

  .dashboard-head p {
    font-size: var(--sz-sm);
    color: var(--c-text-2);
    margin-top: var(--sp-1);
  }

  .dashboard-row {
    grid-template-columns: minmax(180px, 220px) minmax(0, 1fr) auto;
    padding: var(--sp-3) var(--sp-4);
    border-radius: 12px;
    border: 1px solid var(--c-border-strong);
    background: var(--c-surface);
    box-shadow: var(--shadow-sm);
    transition: border-color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
  }

  .dashboard-row:hover {
    border-color: var(--c-border-strong);
  }

  .dashboard-row strong {
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text);
  }

  .dashboard-row p {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
  }

  .dashboard-row[data-status="done"] {
    border-left: 3px solid var(--c-success);
  }

  .dashboard-row[data-status="running"] {
    border-left: 3px solid var(--c-accent);
    background: var(--c-accent-subtle);
  }

  .dashboard-row[data-status="failed"] {
    border-left: 3px solid var(--c-error);
    border-color: var(--c-error-subtle);
    background: var(--c-error-subtle);
  }

  .dashboard-row[data-status="skipped"] {
    border-left: 3px solid var(--c-text-3);
    opacity: 0.7;
  }

  .progress-bar {
    height: 0.5rem;
    border-radius: var(--r-full);
    background: #f0eeea;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: var(--r-full);
    background: linear-gradient(90deg, var(--c-accent), var(--c-success));
    transition: width 400ms var(--ease);
  }

  .error {
    color: var(--c-error);
    font-size: var(--sz-xs);
    font-weight: 500;
  }

  @media (max-width: 760px) {
    .dashboard-head,
    .dashboard-row {
      grid-template-columns: 1fr;
    }
  }
</style>
