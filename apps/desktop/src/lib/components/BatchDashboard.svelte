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
    gap: 1rem;
  }

  .dashboard-head,
  .dashboard-row {
    display: grid;
    gap: 0.75rem;
  }

  .dashboard-head {
    grid-template-columns: 1fr auto;
    align-items: start;
  }

  .dashboard-row {
    grid-template-columns: minmax(180px, 220px) minmax(0, 1fr) auto;
    padding: 0.85rem;
    border-radius: 12px;
    border: 1px solid var(--ra-border);
    background: var(--ra-surface);
  }

  .dashboard-row[data-status="failed"] {
    border-color: #cf786c;
    background: #fff3f1;
  }

  .progress-bar {
    height: 0.75rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ra-border) 70%, white);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--ra-accent), #89b07a);
  }

  .error {
    color: #b04b43;
  }

  @media (max-width: 760px) {
    .dashboard-head,
    .dashboard-row {
      grid-template-columns: 1fr;
    }
  }
</style>
