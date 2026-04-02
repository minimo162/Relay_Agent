<script lang="ts">
  type BatchTargetDraft = {
    path: string;
    name: string;
    size: number;
  };

  export let goal = "";
  export let targets: BatchTargetDraft[] = [];
  export let busy = false;
  export let onGoalChange: (value: string) => void = () => {};
  export let onTargetsChange: (value: BatchTargetDraft[]) => void = () => {};
  export let onStart: () => void = () => {};

  let fileInput: HTMLInputElement | null = null;
  let directoryInput: HTMLInputElement | null = null;

  function basename(filePath: string): string {
    const index = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    return index >= 0 ? filePath.slice(index + 1) : filePath;
  }

  function toDrafts(files: FileList | null): BatchTargetDraft[] {
    if (!files) {
      return targets;
    }

    const next = Array.from(files)
      .map((file) => {
        const candidate = file as File & { path?: string; webkitRelativePath?: string };
        const path = candidate.path ?? candidate.webkitRelativePath ?? file.name;
        return {
          path,
          name: basename(path),
          size: file.size
        };
      })
      .filter((entry) => /\.(csv|xlsx|xlsm|xls)$/i.test(entry.path));

    return next;
  }

  function handleFiles(event: Event): void {
    onTargetsChange(toDrafts((event.currentTarget as HTMLInputElement).files));
    (event.currentTarget as HTMLInputElement).value = "";
  }
</script>

<section class="batch-selector card">
  <div class="section-head">
    <div>
      <h3>バッチ処理</h3>
      <p>同じゴールを複数ファイルへ順番に適用します。</p>
    </div>
    <div class="selector-actions">
      <input
        bind:this={fileInput}
        type="file"
        multiple
        accept=".csv,.xlsx,.xlsm,.xls"
        class="hidden"
        on:change={handleFiles}
      />
      <input
        bind:this={directoryInput}
        type="file"
        multiple
        webkitdirectory
        class="hidden"
        on:change={handleFiles}
      />
      <button class="btn btn-secondary" type="button" on:click={() => directoryInput?.click()} disabled={busy}>
        フォルダ選択
      </button>
      <button class="btn btn-secondary" type="button" on:click={() => fileInput?.click()} disabled={busy}>
        ファイル選択
      </button>
    </div>
  </div>

  <label>
    <span>ゴール</span>
    <textarea
      class="textarea"
      rows="3"
      value={goal}
      on:input={(event) => onGoalChange((event.currentTarget as HTMLTextAreaElement).value)}
      placeholder="すべての売上 CSV から不要列を除外して集計用コピーを作る"
    ></textarea>
  </label>

  <div class="target-list">
    {#if targets.length === 0}
      <p class="muted">対象ファイルを選択してください。</p>
    {:else}
      {#each targets as target, index}
        <article class="target-card">
          <strong>{index + 1}. {target.name}</strong>
          <span>{target.size.toLocaleString("ja-JP")} bytes</span>
        </article>
      {/each}
    {/if}
  </div>

  <button class="btn btn-primary" type="button" on:click={onStart} disabled={busy || !goal.trim() || targets.length === 0}>
    バッチ実行開始
  </button>
</section>

<style>
  .batch-selector,
  .target-list,
  label {
    display: grid;
    gap: var(--sp-4);
  }

  .section-head {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--sp-4);
    align-items: start;
  }

  .section-head h3 {
    font-size: var(--sz-lg);
    font-weight: 700;
    color: var(--c-text);
    letter-spacing: -0.01em;
  }

  .section-head p {
    font-size: var(--sz-sm);
    color: var(--c-text-2);
    margin-top: var(--sp-1);
  }

  label span {
    font-size: var(--sz-xs);
    font-weight: 500;
    color: var(--c-text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .selector-actions {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  .target-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border-radius: 12px;
    border: 1px solid var(--c-border-strong);
    background: var(--c-surface);
    box-shadow: var(--shadow-sm);
    font-size: var(--sz-sm);
    transition: border-color var(--duration-fast) var(--ease),
                transform var(--duration-fast) var(--ease);
  }

  .target-card:hover {
    border-color: var(--c-border-strong);
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }

  .target-card strong {
    font-weight: 500;
    color: var(--c-text);
  }

  .target-card span {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    font-family: var(--font-mono);
  }

  .muted {
    color: var(--c-text-3);
    font-size: var(--sz-sm);
  }

  .hidden {
    display: none;
  }

  @media (max-width: 760px) {
    .section-head {
      grid-template-columns: 1fr;
    }
  }
</style>
