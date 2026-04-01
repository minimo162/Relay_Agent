<script lang="ts">
  import type { DiffSummary } from "@relay-agent/contracts";

  export let sheetDiff: DiffSummary["sheets"][number];
</script>

<article class="sheet-diff-card">
  <div class="sheet-diff-header">
    <div>
      <p class="sheet-diff-title">{sheetDiff.target.label}</p>
      <p class="sheet-diff-meta">{sheetDiff.estimatedAffectedRows} 行に影響</p>
    </div>
  </div>

  <div class="sheet-diff-groups">
    <div class="sheet-diff-group">
      <span class="sheet-diff-label">追加された列</span>
      <div class="sheet-diff-badges">
        {#if sheetDiff.addedColumns.length > 0}
          {#each sheetDiff.addedColumns as column}
            <span class="sheet-diff-badge" data-kind="added">{column}</span>
          {/each}
        {:else}
          <span class="sheet-diff-empty">なし</span>
        {/if}
      </div>
    </div>

    <div class="sheet-diff-group">
      <span class="sheet-diff-label">変わる列</span>
      <div class="sheet-diff-badges">
        {#if sheetDiff.changedColumns.length > 0}
          {#each sheetDiff.changedColumns as column}
            <span class="sheet-diff-badge" data-kind="changed">{column}</span>
          {/each}
        {:else}
          <span class="sheet-diff-empty">なし</span>
        {/if}
      </div>
    </div>

    <div class="sheet-diff-group">
      <span class="sheet-diff-label">消える列</span>
      <div class="sheet-diff-badges">
        {#if sheetDiff.removedColumns.length > 0}
          {#each sheetDiff.removedColumns as column}
            <span class="sheet-diff-badge" data-kind="removed">{column}</span>
          {/each}
        {:else}
          <span class="sheet-diff-empty">なし</span>
        {/if}
      </div>
    </div>
  </div>

  {#if sheetDiff.rowSamples.length > 0}
    <div class="sheet-row-samples">
      <p class="sheet-row-samples-title">行サンプル</p>
      {#each sheetDiff.rowSamples as rowSample}
        <article class="row-sample-card">
          <div class="row-sample-header">
            <span class="row-sample-kind" data-kind={rowSample.kind}>
              {#if rowSample.kind === "changed"}
                変更
              {:else if rowSample.kind === "added"}
                追加
              {:else}
                削除
              {/if}
            </span>
            <span class="row-sample-number">行 {rowSample.rowNumber}</span>
          </div>

          <div class="row-sample-grid">
            {#if rowSample.before}
              <div class="row-sample-side">
                <p class="row-sample-side-title">変更前</p>
                <dl class="row-sample-values">
                  {#each Object.entries(rowSample.before) as [column, value]}
                    <div class="row-sample-entry">
                      <dt>{column}</dt>
                      <dd>{value || "空"}</dd>
                    </div>
                  {/each}
                </dl>
              </div>
            {/if}

            {#if rowSample.after}
              <div class="row-sample-side">
                <p class="row-sample-side-title">変更後</p>
                <dl class="row-sample-values">
                  {#each Object.entries(rowSample.after) as [column, value]}
                    <div class="row-sample-entry">
                      <dt>{column}</dt>
                      <dd>{value || "空"}</dd>
                    </div>
                  {/each}
                </dl>
              </div>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</article>
