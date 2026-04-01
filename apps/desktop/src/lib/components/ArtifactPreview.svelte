<script lang="ts">
  import type { DiffSummary, OutputArtifact } from "@relay-agent/contracts";

  import FileOpPreview from "./FileOpPreview.svelte";
  import SheetDiffCard from "./SheetDiffCard.svelte";

  export let artifacts: OutputArtifact[] = [];

  let activeIndex = 0;

  $: if (activeIndex > artifacts.length - 1) {
    activeIndex = 0;
  }

  $: activeArtifact = artifacts[activeIndex] ?? null;

  function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  function asNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  }

  function asRows(value: unknown): string[][] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((row) =>
        Array.isArray(row) ? row.filter((cell): cell is string => typeof cell === "string") : []
      )
      .filter((row) => row.length > 0);
  }

  function asDiffSummary(value: unknown): DiffSummary | null {
    return value && typeof value === "object" ? (value as DiffSummary) : null;
  }

  function asOperations(
    value: unknown
  ): Array<{ tool: string; args: Record<string, unknown> }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (
        entry
      ): entry is {
        tool: string;
        args: Record<string, unknown>;
      } =>
        Boolean(
          entry &&
            typeof entry === "object" &&
            typeof (entry as { tool?: unknown }).tool === "string" &&
            (entry as { args?: unknown }).args &&
            typeof (entry as { args?: unknown }).args === "object"
        )
    );
  }
</script>

{#if artifacts.length > 1}
  <div class="artifact-tabs">
    {#each artifacts as artifact, index (artifact.id)}
      <button
        class="artifact-tab"
        class:active={index === activeIndex}
        type="button"
        on:click={() => {
          activeIndex = index;
        }}
      >
        {artifact.label}
      </button>
    {/each}
  </div>
{/if}

{#if activeArtifact}
  {@const diffSummary = asDiffSummary(activeArtifact.content.diffSummary)}
  <div class="artifact-preview">
    {#if activeArtifact.type === "spreadsheet_diff"}
      <div class="sheet-diff-grid">
        {#each diffSummary?.sheets ?? [] as sheetDiff}
          <SheetDiffCard {sheetDiff} />
        {/each}
      </div>
    {:else if activeArtifact.type === "file_operation"}
      <FileOpPreview actions={asOperations(activeArtifact.content.operations)} />
    {:else if activeArtifact.type === "text_diff"}
      <div class="text-diff-preview">
        <h4>テキスト差分（{asNumber(activeArtifact.content.changeCount)} 箇所）</h4>
        <div class="diff-columns">
          <div class="diff-panel diff-before">
            <h5>変更前</h5>
            <pre>{asString(activeArtifact.content.before)}</pre>
          </div>
          <div class="diff-panel diff-after">
            <h5>変更後</h5>
            <pre>{asString(activeArtifact.content.after)}</pre>
          </div>
        </div>
      </div>
    {:else if activeArtifact.type === "text_extraction"}
      <div class="text-block-preview">
        <h4>
          テキスト抽出結果（{asString(activeArtifact.content.format)} / {asNumber(activeArtifact.content.charCount)} 文字）
        </h4>
        <pre>{asString(activeArtifact.content.text)}</pre>
      </div>
    {:else if activeArtifact.type === "csv_table"}
      <div class="csv-table-preview">
        <h4>テーブルプレビュー（{asNumber(activeArtifact.content.totalRows)} 行）</h4>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                {#each asStringArray(activeArtifact.content.columns) as column}
                  <th>{column}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each asRows(activeArtifact.content.rows).slice(0, 100) as row}
                <tr>
                  {#each row as cell}
                    <td>{cell}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if asRows(activeArtifact.content.rows).length > 100}
          <p class="artifact-note">先頭 100 行を表示中です。</p>
        {/if}
      </div>
    {:else if activeArtifact.type === "raw_text"}
      <div class="text-block-preview">
        <pre>{asString(activeArtifact.content.text)}</pre>
      </div>
    {:else}
      <div class="unknown-preview">
        <p>未対応のアーティファクトタイプ: {activeArtifact.type}</p>
        <pre>{JSON.stringify(activeArtifact.content, null, 2)}</pre>
      </div>
    {/if}

    {#if activeArtifact.warnings.length > 0}
      <div class="artifact-warnings">
        {#each activeArtifact.warnings as warning}
          <p class="warning-text">⚠ {warning}</p>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .artifact-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.85rem;
  }

  .artifact-tab {
    border: 1px solid var(--ra-border);
    background: var(--ra-surface);
    color: inherit;
    border-radius: 999px;
    padding: 0.45rem 0.85rem;
    cursor: pointer;
    font-size: 0.82rem;
  }

  .artifact-tab.active {
    border-color: var(--ra-accent);
    background: color-mix(in srgb, var(--ra-accent) 12%, var(--ra-surface));
    font-weight: 600;
  }

  .artifact-preview,
  .sheet-diff-grid,
  .text-diff-preview,
  .text-block-preview,
  .csv-table-preview,
  .unknown-preview,
  .artifact-warnings {
    display: grid;
    gap: 0.75rem;
  }

  .diff-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.75rem;
  }

  .diff-panel,
  .text-block-preview pre,
  .unknown-preview pre {
    border: 1px solid var(--ra-border);
    border-radius: 12px;
    padding: 0.75rem;
    margin: 0;
    max-height: 22rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .diff-before {
    background: #fff4f1;
  }

  .diff-after {
    background: #f3fff4;
  }

  .table-scroll {
    overflow: auto;
    max-height: 24rem;
    border: 1px solid var(--ra-border);
    border-radius: 12px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.84rem;
  }

  th,
  td {
    padding: 0.45rem 0.6rem;
    border-bottom: 1px solid var(--ra-border);
    text-align: left;
    white-space: nowrap;
  }

  th {
    position: sticky;
    top: 0;
    background: var(--ra-surface);
    z-index: 1;
  }

  .artifact-note,
  .warning-text {
    font-size: 0.84rem;
    color: var(--ra-text-muted);
  }
</style>
