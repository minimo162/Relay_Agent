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
    gap: 1rem;
  }

  .section-head {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 1rem;
  }

  .selector-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .target-card {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.8rem 0.9rem;
    border-radius: 12px;
    border: 1px solid var(--ra-border);
    background: var(--ra-surface);
    font-size: 0.86rem;
  }

  .muted {
    color: var(--ra-text-muted);
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
