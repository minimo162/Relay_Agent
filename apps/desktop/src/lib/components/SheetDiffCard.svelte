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

<style>
  /* ── Ink & Steel: SheetDiffCard ── */

  .sheet-diff-card {
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-md);
    overflow: hidden;
    transition: box-shadow var(--duration-normal) var(--ease),
                border-color var(--duration-normal) var(--ease);
  }

  .sheet-diff-card:hover {
    box-shadow: 0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
    border-color: var(--c-border-strong);
  }

  .sheet-diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--c-border-strong);
    background: #f0eeea;
  }

  .sheet-diff-title {
    font-size: var(--sz-sm);
    font-weight: 700;
    color: var(--c-text);
    margin: 0;
  }

  .sheet-diff-meta {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    margin: var(--sp-1) 0 0;
  }

  /* Column groups */
  .sheet-diff-groups {
    display: grid;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
  }

  .sheet-diff-group {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  .sheet-diff-label {
    font-size: var(--sz-xs);
    font-weight: 500;
    color: var(--c-text-2);
    min-width: 5rem;
    flex-shrink: 0;
  }

  .sheet-diff-badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
  }

  .sheet-diff-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem var(--sp-2);
    border-radius: var(--r-full);
    font-size: var(--sz-xs);
    font-weight: 500;
    font-family: var(--font-mono);
  }

  .sheet-diff-badge[data-kind="added"] {
    background: var(--c-success-subtle);
    color: var(--c-success);
    border: 1px solid var(--c-success-subtle);
  }

  .sheet-diff-badge[data-kind="changed"] {
    background: var(--c-warning-subtle);
    color: var(--c-warning);
    border: 1px solid var(--c-warning-subtle);
  }

  .sheet-diff-badge[data-kind="removed"] {
    background: var(--c-error-subtle);
    color: var(--c-error);
    border: 1px solid var(--c-error-subtle);
  }

  .sheet-diff-empty {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    font-style: italic;
  }

  /* Row samples */
  .sheet-row-samples {
    border-top: 1px solid var(--c-border-strong);
    padding: var(--sp-3) var(--sp-4);
    display: grid;
    gap: var(--sp-3);
  }

  .sheet-row-samples-title {
    font-size: var(--sz-xs);
    font-weight: 700;
    color: var(--c-text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .row-sample-card {
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-md);
    overflow: hidden;
    background: var(--c-surface);
  }

  .row-sample-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    background: #f0eeea;
    border-bottom: 1px solid var(--c-border-strong);
  }

  .row-sample-kind {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem var(--sp-2);
    border-radius: var(--r-full);
    font-size: var(--sz-xs);
    font-weight: 700;
  }

  .row-sample-kind[data-kind="added"] {
    background: var(--c-success-subtle);
    color: var(--c-success);
  }

  .row-sample-kind[data-kind="changed"] {
    background: var(--c-warning-subtle);
    color: var(--c-warning);
  }

  .row-sample-kind[data-kind="removed"] {
    background: var(--c-error-subtle);
    color: var(--c-error);
  }

  .row-sample-number {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    font-family: var(--font-mono);
  }

  /* Before / After grid */
  .row-sample-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0;
  }

  .row-sample-side {
    padding: var(--sp-2) var(--sp-3);
  }

  .row-sample-side + .row-sample-side {
    border-left: 1px solid var(--c-border-strong);
  }

  .row-sample-side-title {
    font-size: var(--sz-xs);
    font-weight: 500;
    color: var(--c-text-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 var(--sp-2);
  }

  .row-sample-values {
    display: grid;
    gap: var(--sp-1);
    margin: 0;
  }

  .row-sample-entry {
    display: flex;
    gap: var(--sp-2);
    font-size: var(--sz-xs);
  }

  .row-sample-entry dt {
    font-weight: 500;
    color: var(--c-text-2);
    min-width: 4rem;
    flex-shrink: 0;
  }

  .row-sample-entry dd {
    margin: 0;
    color: var(--c-text);
    font-family: var(--font-mono);
    word-break: break-word;
  }
</style>
