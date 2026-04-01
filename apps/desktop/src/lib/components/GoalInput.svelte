<script lang="ts">
  export let busy = false;
  export let filePath = "";
  export let sampleWorkbookPath: string | null = null;
  export let preflightWarning = "";
  export let objectiveText = "";
  export let templates: { key: string; label: string; objective: string }[] = [];
  export let objectivePresets: string[] = [];
  export let taskName = "";
  export let setupStepComplete = false;
  export let stepExpanded = true;
  export let progressItems: { id: string; label: string; status: string; message?: string }[] =
    [];
  export let errorMessage = "";
  export let errorHint = "";
  export let onEdit: () => void = () => {};
  export let onOpenFilePicker: () => void = () => {};
  export let onFileDrop: (event: DragEvent) => void = () => {};
  export let onFileDragOver: () => void = () => {};
  export let onFileDragLeave: () => void = () => {};
  export let onObjectiveChange: (value: string, templateKey?: string | null) => void =
    () => {};
  export let onTaskNameChange: (value: string) => void = () => {};
  export let onFilePathChange: (value: string) => void = () => {};
  export let onStart: () => void = () => {};
  export let isDragOver = false;
</script>

<div class="step-panel-header">
  <h2 class="panel-title">1. はじめる</h2>
  {#if setupStepComplete && !stepExpanded}
    <button class="btn btn-secondary step-edit-button" type="button" on:click={onEdit}>
      編集する
    </button>
  {/if}
</div>

{#if setupStepComplete && !stepExpanded}
  <div class="step-summary step-summary-compact">
    <div class="step-summary-row">
      <span class="step-summary-label">ファイル</span>
      <span>{filePath || "未設定"}</span>
    </div>
    <div class="step-summary-row">
      <span class="step-summary-label">やりたいこと</span>
      <span>{objectiveText || "未設定"}</span>
    </div>
  </div>
{:else}
  {#if !filePath.trim()}
    <div
      class="dropzone-large"
      class:dropzone-hover={isDragOver}
      on:dragover|preventDefault={onFileDragOver}
      on:dragleave={onFileDragLeave}
      on:drop|preventDefault={onFileDrop}
      on:click={onOpenFilePicker}
      on:keydown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenFilePicker();
        }
      }}
      role="button"
      tabindex="0"
    >
      <div class="dropzone-icon">📊</div>
      <div class="dropzone-primary">CSV または XLSX ファイルをドロップ</div>
      <div class="dropzone-secondary">またはクリックして選択</div>
      <div class="dropzone-badges">
        <span class="ext-badge">.csv</span>
        <span class="ext-badge">.xlsx</span>
      </div>
    </div>
  {/if}

  <label class="field-label" for="goal-input-file-path">ファイルパス</label>
  <div class="file-row">
    <input
      id="goal-input-file-path"
      type="text"
      class="input"
      value={filePath}
      placeholder="例: C:/Users/you/Documents/data.csv"
      disabled={busy}
      on:input={(event) =>
        onFilePathChange((event.currentTarget as HTMLInputElement).value)}
    />
    {#if sampleWorkbookPath}
      <button
        class="chip"
        type="button"
        on:click={() => onFilePathChange(sampleWorkbookPath ?? "")}
        disabled={busy}
      >
        練習用サンプル
      </button>
    {/if}
  </div>

  {#if preflightWarning}
    <p class="field-warn">⚠ {preflightWarning}</p>
  {/if}

  <label class="field-label" for="goal-input-objective">やりたいこと</label>
  <div class="template-row">
    {#each templates as template}
      <button
        class="chip"
        type="button"
        on:click={() => onObjectiveChange(template.objective, template.key)}
        disabled={busy}
      >
        {template.label}
      </button>
    {/each}
  </div>
  <textarea
    id="goal-input-objective"
    class="textarea"
    value={objectiveText}
    on:input={(event) =>
      onObjectiveChange((event.currentTarget as HTMLTextAreaElement).value)}
    placeholder="例: approved が true の行だけ残して、amount の確認列を追加してください"
    rows="3"
    disabled={busy}
  ></textarea>

  <div class="objective-presets">
    <span class="preset-label">例:</span>
    {#each objectivePresets as preset}
      <button class="preset-btn" type="button" on:click={() => onObjectiveChange(preset)} disabled={busy}>
        {preset}
      </button>
    {/each}
  </div>

  <label class="field-label" for="goal-input-task-name">タスク名</label>
  <input
    id="goal-input-task-name"
    type="text"
    class="input"
    value={taskName}
    on:input={(event) =>
      onTaskNameChange((event.currentTarget as HTMLInputElement).value)}
    placeholder="やりたいことから自動で入ります"
    disabled={busy}
  />
  <p class="field-hint">やりたいことを選ぶと自動で入ります。必要なら編集できます。</p>

  {#if progressItems.length > 0}
    <div class="progress-panel">
      {#each progressItems as item}
        <div class="progress-item" data-status={item.status}>
          <span class="progress-mark">
            {#if item.status === "done"}
              ✓
            {:else if item.status === "running"}
              …
            {:else if item.status === "error"}
              ✗
            {:else}
              ・
            {/if}
          </span>
          <div>
            <p class="progress-label">{item.label}</p>
            {#if item.message}
              <p class="progress-message">{item.message}</p>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if errorMessage}
    <div class="friendly-error">
      <div class="fe-body">
        <div class="fe-message">{errorMessage}</div>
        {#if errorHint}
          <div class="fe-hint">{errorHint}</div>
        {/if}
      </div>
    </div>
  {/if}

  <button class="btn btn-primary" type="button" on:click={onStart} disabled={busy || !filePath.trim() || !objectiveText.trim()}>
    開始する
  </button>
  <p class="action-note">ファイル確認、列情報の読み取り、作業作成、Copilot への依頼準備を続けて行います。</p>
{/if}

<style>
  .dropzone-large {
    margin-bottom: 1rem;
  }

  .progress-panel {
    margin-top: 1rem;
  }
</style>
