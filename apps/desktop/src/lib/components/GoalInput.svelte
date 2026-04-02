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

  // Derive current step for the stepper
  $: currentStep = !filePath.trim() ? 0 : !objectiveText.trim() ? 1 : 2;
</script>

<!-- Stepper indicator -->
{#if !setupStepComplete || stepExpanded}
  <nav class="stepper" aria-label="Setup progress">
    <div class="stepper-step" class:stepper-done={currentStep > 0} class:stepper-active={currentStep === 0}>
      <span class="stepper-node">{currentStep > 0 ? '✓' : '1'}</span>
      <span class="stepper-label">ファイル選択</span>
    </div>
    <div class="stepper-connector" class:stepper-connector-done={currentStep > 0}></div>
    <div class="stepper-step" class:stepper-done={currentStep > 1} class:stepper-active={currentStep === 1}>
      <span class="stepper-node">{currentStep > 1 ? '✓' : '2'}</span>
      <span class="stepper-label">目的設定</span>
    </div>
    <div class="stepper-connector" class:stepper-connector-done={currentStep > 1}></div>
    <div class="stepper-step" class:stepper-active={currentStep === 2}>
      <span class="stepper-node">3</span>
      <span class="stepper-label">開始</span>
    </div>
  </nav>
{/if}

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

  <!-- File info card (shown after file is selected) -->
  {#if filePath.trim()}
    <div class="file-info-card">
      <div class="file-info-icon">📄</div>
      <div class="file-info-details">
        <span class="file-info-name">{filePath.split(/[\\/]/).pop() || filePath}</span>
        <span class="file-info-path">{filePath}</span>
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
  /* ================================================================
     Stepper — ○—●—○ style indicator
     ================================================================ */
  .stepper {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    margin-bottom: var(--sp-6);
    padding: var(--sp-3) 0;
  }

  .stepper-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-1);
    position: relative;
  }

  .stepper-node {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    font-size: var(--sz-xs);
    font-weight: 700;
    border: 2px solid var(--c-border-strong);
    background: var(--c-surface);
    color: var(--c-text-3);
    transition: all var(--duration-normal) var(--ease);
    flex-shrink: 0;
  }

  .stepper-active .stepper-node {
    border-color: var(--c-accent);
    background: var(--c-accent);
    color: white;
    box-shadow: 0 0 0 4px var(--c-accent-subtle);
  }

  .stepper-done .stepper-node {
    border-color: var(--c-success);
    background: var(--c-success);
    color: white;
  }

  .stepper-label {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    font-weight: 500;
    white-space: nowrap;
    transition: color var(--duration-fast);
  }

  .stepper-active .stepper-label {
    color: var(--c-accent);
  }

  .stepper-done .stepper-label {
    color: var(--c-success);
  }

  .stepper-connector {
    width: 48px;
    height: 2px;
    background: var(--c-border-strong);
    margin: 0 var(--sp-2);
    margin-bottom: var(--sp-5);
    border-radius: var(--r-full);
    transition: background var(--duration-normal) var(--ease);
  }

  .stepper-connector-done {
    background: var(--c-success);
  }

  /* ================================================================
     Dropzone — dashed border with drag animation
     ================================================================ */
  .dropzone-large {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    padding: var(--sp-10) var(--sp-6);
    border: 2px dashed var(--c-border-strong);
    border-radius: 16px;
    background: #f0eeea;
    cursor: pointer;
    transition: all var(--duration-normal) var(--ease);
    margin-bottom: var(--sp-4);
    text-align: center;
  }

  .dropzone-large:hover {
    border-color: rgba(13,148,136,0.20);
    background: var(--c-accent-subtle);
  }

  .dropzone-large:focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
  }

  .dropzone-hover {
    border-color: var(--c-accent) !important;
    background: var(--c-accent-subtle) !important;
    transform: scale(1.02);
    box-shadow: 0 0 0 4px var(--c-accent-subtle), 0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
  }

  .dropzone-icon {
    font-size: 2.5rem;
    line-height: 1;
    margin-bottom: var(--sp-1);
  }

  .dropzone-primary {
    font-size: var(--sz-lg);
    font-weight: 700;
    color: var(--c-text);
  }

  .dropzone-secondary {
    font-size: var(--sz-sm);
    color: var(--c-text-3);
  }

  .dropzone-badges {
    display: flex;
    gap: var(--sp-2);
    margin-top: var(--sp-2);
  }

  .ext-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--sp-1) var(--sp-3);
    font-size: var(--sz-xs);
    font-weight: 500;
    font-family: var(--font-mono);
    color: var(--c-accent);
    background: var(--c-accent-subtle);
    border: 1px solid rgba(13,148,136,0.20);
    border-radius: var(--r-full);
  }

  /* ================================================================
     File info card — shown after file drop
     ================================================================ */
  .file-info-card {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    background: var(--c-success-subtle);
    border: 1px solid var(--c-success-subtle);
    border-radius: 12px;
    margin-bottom: var(--sp-4);
    box-shadow: var(--shadow-sm);
    backdrop-filter: blur(20px) saturate(180%);
    animation: card-appear var(--duration-normal) var(--ease);
  }

  @keyframes card-appear {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .file-info-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
  }

  .file-info-details {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .file-info-name {
    font-size: var(--sz-base);
    font-weight: 700;
    color: var(--c-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-info-path {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ================================================================
     File row
     ================================================================ */
  .file-row {
    display: flex;
    gap: var(--sp-2);
    align-items: center;
  }

  .file-row .input {
    flex: 1;
  }

  /* ================================================================
     Template row (chip row)
     ================================================================ */
  .template-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    margin-bottom: var(--sp-2);
  }

  /* ================================================================
     Textarea — auto-resize style
     ================================================================ */
  .textarea {
    width: 100%;
    padding: var(--sp-3);
    font-size: var(--sz-base);
    line-height: 1.6;
    color: var(--c-text);
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: 8px;
    resize: vertical;
    min-height: 5rem;
    field-sizing: content;
    transition: border-color var(--duration-fast),
                box-shadow var(--duration-fast);
  }

  .textarea:focus {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-subtle);
  }

  /* ================================================================
     Objective presets — card grid (2 columns)
     ================================================================ */
  .objective-presets {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--sp-2);
    align-items: start;
    margin-top: var(--sp-3);
    margin-bottom: var(--sp-2);
  }

  .preset-label {
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text-3);
    padding-top: var(--sp-2);
    grid-row: 1;
  }

  .objective-presets > :not(.preset-label) {
    grid-column: 2;
  }

  /* Re-layout presets as a 2-column card grid */
  .objective-presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    align-items: stretch;
  }

  .preset-label {
    width: 100%;
    padding-top: 0;
  }

  .preset-btn {
    flex: 1 1 calc(50% - var(--sp-2));
    min-width: 0;
    padding: var(--sp-3) var(--sp-4);
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text-2);
    text-align: left;
    line-height: 1.5;
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: 12px;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition: all var(--duration-fast) var(--ease);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .preset-btn:hover:not(:disabled) {
    border-color: rgba(13,148,136,0.20);
    background: var(--c-accent-subtle);
    color: var(--c-accent);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .preset-btn:active:not(:disabled) {
    transform: scale(0.97);
    box-shadow: var(--shadow-sm);
  }

  .preset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ================================================================
     Field helpers
     ================================================================ */
  .field-hint {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    margin: var(--sp-1) 0 0;
    line-height: 1.5;
  }

  .field-warn {
    color: var(--c-warning);
    font-size: var(--sz-sm);
    font-weight: 500;
    margin: var(--sp-2) 0 0;
    padding: var(--sp-2) var(--sp-3);
    background: var(--c-warning-subtle);
    border: 1px solid var(--c-warning-subtle);
    border-radius: var(--r-sm);
  }

  /* ================================================================
     Step summary (collapsed state)
     ================================================================ */
  .step-summary-compact {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    background: #f0eeea;
    border: 1px solid var(--c-border-strong);
    border-radius: 12px;
    margin-bottom: var(--sp-4);
  }

  .step-summary-row {
    display: flex;
    gap: var(--sp-3);
    align-items: baseline;
    font-size: var(--sz-sm);
    color: var(--c-text-2);
    line-height: 1.5;
  }

  .step-summary-row .step-summary-label {
    font-weight: 700;
    color: var(--c-text);
    flex-shrink: 0;
    min-width: 6em;
  }

  /* ================================================================
     Step panel header
     ================================================================ */
  .step-edit-button {
    flex-shrink: 0;
  }

  /* ================================================================
     Progress panel
     ================================================================ */
  .progress-panel {
    display: grid;
    gap: var(--sp-3);
    margin-top: var(--sp-4);
    padding: var(--sp-4);
    border: 1px solid var(--c-border-strong);
    border-radius: 12px;
    background: #f0eeea;
  }

  .progress-item {
    display: grid;
    grid-template-columns: 1.25rem 1fr;
    gap: var(--sp-3);
    align-items: start;
  }

  .progress-mark {
    font-weight: 700;
    line-height: 1.4;
    color: var(--c-text-3);
  }

  .progress-item[data-status="done"] .progress-mark {
    color: var(--c-success);
  }

  .progress-item[data-status="running"] .progress-mark {
    color: var(--c-accent);
    animation: status-pulse 1.5s ease-in-out infinite;
  }

  .progress-item[data-status="error"] .progress-mark {
    color: var(--c-error);
  }

  @keyframes status-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .progress-label {
    margin: 0;
    font-size: var(--sz-sm);
    color: var(--c-text);
    font-weight: 500;
  }

  .progress-message {
    margin: var(--sp-1) 0 0;
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    line-height: 1.5;
  }

  /* ================================================================
     Error display
     ================================================================ */
  .friendly-error {
    display: flex;
    gap: var(--sp-3);
    align-items: flex-start;
    margin-top: var(--sp-3);
    background: var(--c-error-subtle);
    border: 1px solid var(--c-error-subtle);
    border-radius: 12px;
    padding: var(--sp-3) var(--sp-4);
  }

  .fe-body {
    flex: 1;
  }

  .fe-message {
    font-size: var(--sz-sm);
    font-weight: 700;
    color: var(--c-error);
  }

  .fe-hint {
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    margin-top: var(--sp-1);
    line-height: 1.5;
  }

  /* ================================================================
     Action note
     ================================================================ */
  .action-note {
    color: var(--c-text-3);
    font-size: var(--sz-xs);
    line-height: 1.5;
    margin: var(--sp-2) 0 0;
  }
</style>
