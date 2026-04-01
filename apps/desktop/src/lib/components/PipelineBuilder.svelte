<script lang="ts">
  import type {
    PipelineInputSource,
    PipelineStep
  } from "@relay-agent/contracts";

  export let pipelineTitle = "";
  export let initialInputPath = "";
  export let steps: PipelineStep[] = [];
  export let busy = false;
  export let onPipelineTitleChange: (value: string) => void = () => {};
  export let onInitialInputPathChange: (value: string) => void = () => {};
  export let onAddStep: () => void = () => {};
  export let onUpdateStepGoal: (index: number, value: string) => void = () => {};
  export let onUpdateStepInputSource: (
    index: number,
    value: PipelineInputSource
  ) => void = () => {};
  export let onMoveStep: (index: number, direction: -1 | 1) => void = () => {};
  export let onRemoveStep: (index: number) => void = () => {};
  export let onStart: () => void = () => {};
</script>

<section class="pipeline-builder card">
  <div class="builder-header">
    <div>
      <h3>パイプライン</h3>
      <p>複数ターンを順番に実行し、前ステップの出力を次へ渡します。</p>
    </div>
    <button class="btn btn-secondary" type="button" on:click={onAddStep} disabled={busy}>
      ステップ追加
    </button>
  </div>

  <div class="builder-grid">
    <label>
      <span>タイトル</span>
      <input
        class="input"
        type="text"
        value={pipelineTitle}
        on:input={(event) =>
          onPipelineTitleChange((event.currentTarget as HTMLInputElement).value)}
        placeholder="例: 月次売上の整形パイプライン"
      />
    </label>
    <label>
      <span>最初の入力ファイル</span>
      <input
        class="input"
        type="text"
        value={initialInputPath}
        on:input={(event) =>
          onInitialInputPathChange((event.currentTarget as HTMLInputElement).value)}
        placeholder="/path/to/source.csv"
      />
    </label>
  </div>

  <div class="step-list">
    {#each steps as step, index (step.id)}
      <article class="step-card">
        <div class="step-number">{index + 1}</div>
        <div class="step-form">
          <label>
            <span>ゴール</span>
            <textarea
              class="textarea"
              rows="2"
              value={step.goal}
              on:input={(event) =>
                onUpdateStepGoal(index, (event.currentTarget as HTMLTextAreaElement).value)}
              placeholder="このステップでやりたいこと"
            ></textarea>
          </label>
          <label>
            <span>入力元</span>
            <select
              class="input"
              value={step.inputSource}
              on:change={(event) =>
                onUpdateStepInputSource(
                  index,
                  (event.currentTarget as HTMLSelectElement).value as PipelineInputSource
                )}
            >
              <option value="user">ユーザー指定ファイル</option>
              <option value="prev_step_output">前ステップ出力</option>
            </select>
          </label>
        </div>
        <div class="step-actions">
          <button
            class="btn btn-secondary"
            type="button"
            on:click={() => onMoveStep(index, -1)}
            disabled={busy || index === 0}
          >
            ↑
          </button>
          <button
            class="btn btn-secondary"
            type="button"
            on:click={() => onMoveStep(index, 1)}
            disabled={busy || index === steps.length - 1}
          >
            ↓
          </button>
          <button class="btn btn-secondary" type="button" on:click={() => onRemoveStep(index)} disabled={busy}>
            削除
          </button>
        </div>
      </article>
    {/each}
  </div>

  <button
    class="btn btn-primary"
    type="button"
    on:click={onStart}
    disabled={busy || !pipelineTitle.trim() || !initialInputPath.trim() || steps.length === 0}
  >
    実行開始
  </button>
</section>

<style>
  .pipeline-builder,
  .step-list {
    display: grid;
    gap: 1rem;
  }

  .builder-header,
  .builder-grid,
  .step-card {
    display: grid;
    gap: 0.75rem;
  }

  .builder-header {
    grid-template-columns: 1fr auto;
    align-items: start;
  }

  .builder-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .step-card {
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding: 0.9rem;
    border-radius: 14px;
    border: 1px solid var(--ra-border);
    background: var(--ra-surface);
  }

  .step-number {
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--ra-accent) 12%, white);
    color: var(--ra-accent);
    font-weight: 700;
  }

  .step-form,
  .step-actions {
    display: grid;
    gap: 0.6rem;
  }

  label {
    display: grid;
    gap: 0.35rem;
  }

  @media (max-width: 760px) {
    .builder-header,
    .builder-grid,
    .step-card {
      grid-template-columns: 1fr;
    }
  }
</style>
