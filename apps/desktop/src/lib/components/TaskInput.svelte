<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let mode: "idle" | "active" | "busy" = "idle";
  export let recentFiles: { path: string; lastUsedAt: string }[] = [];
  export let suggestions: { label: string; value: string }[] = [];
  export let disabled = false;
  export let initialGoal = "";
  export let initialFiles: string[] = [];

  const dispatch = createEventDispatcher<{
    submit: { goal: string; files: string[] };
    cancel: void;
    reset: void;
  }>();

  let goal = initialGoal;
  let attachedFiles = [...initialFiles];
  let hiddenFileInput: HTMLInputElement | null = null;
  let textarea: HTMLTextAreaElement | null = null;
  let isDragOver = false;

  $: if (initialGoal !== goal && !goal.trim()) {
    goal = initialGoal;
  }
  $: if (initialFiles.length === 0 && attachedFiles.length === 0) {
    attachedFiles = [...initialFiles];
  }

  function handleFileAttach() {
    hiddenFileInput?.click();
  }

  function handleSubmit() {
    if (!goal.trim() || mode === "busy") return;
    dispatch("submit", { goal: goal.trim(), files: attachedFiles });
    goal = "";
    attachedFiles = [];
    resizeTextarea();
  }

  function handleCancel() {
    dispatch("cancel");
  }

  function handleSuggestion(value: string) {
    goal = value;
    textarea?.focus();
  }

  function handleQuickAttach(path: string) {
    if (!attachedFiles.includes(path)) {
      attachedFiles = [...attachedFiles, path];
    }
  }

  function removeFile(index: number) {
    attachedFiles = attachedFiles.filter((_, i) => i !== index);
  }

  function handleFileChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const nextFile = target.files?.[0] as (File & { path?: string }) | undefined;
    const path = nextFile?.path?.trim();
    if (path && !attachedFiles.includes(path)) {
      attachedFiles = [...attachedFiles, path];
    }
    target.value = "";
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragOver = false;
    const files = event.dataTransfer?.files;
    if (files) {
      for (let i = 0; i < files.length; i++) {
        const f = files[i] as File & { path?: string };
        const path = f.path?.trim();
        if (path && !attachedFiles.includes(path)) {
          attachedFiles = [...attachedFiles, path];
        }
      }
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    isDragOver = true;
  }

  function handleDragLeave() {
    isDragOver = false;
  }

  function handleReset() {
    goal = "";
    attachedFiles = [];
    resizeTextarea();
    dispatch("reset");
  }

  function resizeTextarea() {
    if (!textarea) return;
    textarea.style.height = "auto";
    const clamped = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${clamped}px`;
  }

  function handleInput() {
    resizeTextarea();
  }

  function basename(filePath: string): string {
    const sep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    return sep < 0 ? filePath : filePath.slice(sep + 1);
  }
</script>

<input
  bind:this={hiddenFileInput}
  type="file"
  accept=".csv,.xlsx,.xlsm,.xls,.txt,.docx"
  class="hidden-file-input"
  on:change={handleFileChange}
/>

<div
  class="task-input"
  on:drop={handleDrop}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  role="region"
  aria-label="タスク入力"
>
  <!-- Idle hints: suggestions + recent files above composer -->
  {#if mode === "idle" && !goal.trim()}
    <div class="idle-hints">
      {#if suggestions.length > 0}
        <div class="hint-row">
          {#each suggestions.slice(0, 3) as s}
            <button class="hint-chip" type="button" on:click={() => handleSuggestion(s.value)}>
              {s.label}
            </button>
          {/each}
        </div>
      {/if}
      {#if recentFiles.length > 0}
        <div class="hint-row">
          {#each recentFiles.slice(0, 3) as f}
            <button class="hint-chip hint-chip-file" type="button" on:click={() => handleQuickAttach(f.path)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="hint-icon">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              {basename(f.path)}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Composer shell — always visible -->
  <div class="composer" class:drag-over={isDragOver} class:is-busy={mode === "busy"}>

    <!-- Attached file chips (inside shell, above textarea) -->
    {#if attachedFiles.length > 0}
      <div class="chip-row">
        {#each attachedFiles as file, index}
          <span class="file-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chip-icon">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
            {basename(file)}
            <button class="chip-remove" type="button" on:click={() => removeFile(index)} aria-label="削除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </span>
        {/each}
      </div>
    {/if}

    <!-- Textarea + action buttons -->
    <div class="input-row">
      <textarea
        bind:this={textarea}
        bind:value={goal}
        on:keydown={handleKeydown}
        on:input={handleInput}
        placeholder={mode === "busy" ? "実行中…" : "やりたいことを入力… (Shift+Enter で改行)"}
        rows="1"
        disabled={disabled || mode === "busy"}
        class="goal-textarea"
      ></textarea>

      <div class="action-row">
        <!-- @file attach button -->
        <button
          class="toolbar-btn"
          type="button"
          on:click={handleFileAttach}
          disabled={disabled || mode === "busy"}
          aria-label="ファイルを添付"
          title="@ファイル"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>

        <!-- Reset (active mode) -->
        {#if mode === "active"}
          <button
            class="toolbar-btn reset-btn"
            type="button"
            on:click={handleReset}
            aria-label="リセット"
            title="新しいタスク"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        {/if}

        <!-- Send / Stop -->
        {#if mode === "busy"}
          <button
            class="action-btn stop-btn"
            type="button"
            on:click={handleCancel}
            aria-label="停止"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:10px;height:10px">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
            </svg>
            Stop
          </button>
        {:else}
          <button
            class="action-btn send-btn"
            type="button"
            on:click={handleSubmit}
            disabled={disabled || !goal.trim()}
            aria-label="送信"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .hidden-file-input { display: none; }

  .task-input {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  /* ── Idle hints ──────────────────────────── */
  .idle-hints {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: 0 var(--sp-1);
  }

  .hint-row {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  .hint-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-3);
    font-size: var(--sz-xs);
    color: var(--c-text-2);
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-full);
    transition: border-color var(--duration-fast), color var(--duration-fast),
                box-shadow var(--duration-fast);
  }
  .hint-chip:hover {
    border-color: var(--c-accent);
    color: var(--c-accent);
    box-shadow: var(--shadow-xs);
  }
  .hint-chip-file { color: var(--c-text-3); }
  .hint-icon { width: 11px; height: 11px; flex-shrink: 0; }

  /* ── Composer shell ──────────────────────── */
  .composer {
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-xl);   /* 32px pill shell */
    box-shadow: var(--shadow-sm);
    padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-3);
    transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
  }
  .composer:focus-within {
    border-color: var(--c-accent);
    box-shadow: var(--shadow-sm), 0 0 0 3px var(--c-accent-subtle);
  }
  .composer.drag-over {
    border-color: var(--c-accent);
    box-shadow: var(--shadow-sm), 0 0 0 3px var(--c-accent-subtle);
  }
  .composer.is-busy {
    background: var(--c-canvas);
    border-color: var(--c-border);
  }

  /* File chips row */
  .chip-row {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
    padding: var(--sp-1) 0;
  }
  .file-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    padding: 2px var(--sp-1) 2px var(--sp-2);
    font-size: var(--sz-xs);
    font-weight: 500;
    color: var(--c-accent);
    background: var(--c-accent-subtle);
    border-radius: var(--r-full);
  }
  .chip-icon { width: 11px; height: 11px; flex-shrink: 0; opacity: 0.7; }
  .chip-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    color: var(--c-accent);
    transition: background var(--duration-fast);
    flex-shrink: 0;
  }
  .chip-remove:hover { background: rgba(13, 148, 136, 0.18); }
  .chip-remove svg { width: 9px; height: 9px; }

  /* Input row */
  .input-row {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-1);
    min-height: 40px;
  }

  .goal-textarea {
    flex: 1;
    resize: none;
    height: 40px;
    min-height: 40px;
    max-height: 200px;
    border: none;
    outline: none;
    background: transparent;
    color: var(--c-text);
    font-family: var(--font-sans);
    font-size: var(--sz-sm);
    line-height: 1.6;
    padding: var(--sp-2) 0;
    overflow-y: auto;
  }
  .goal-textarea::placeholder { color: var(--c-text-3); }
  .goal-textarea:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Action area (right side of input row) */
  .action-row {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    flex-shrink: 0;
    padding-bottom: var(--sp-1);
  }

  /* Icon toolbar buttons */
  .toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--r-full);
    color: var(--c-text-3);
    transition: color var(--duration-fast), background var(--duration-fast);
    flex-shrink: 0;
  }
  .toolbar-btn:hover:not(:disabled) { color: var(--c-text-2); background: var(--c-border); }
  .toolbar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .toolbar-btn svg { width: 16px; height: 16px; }

  .reset-btn:hover:not(:disabled) { color: var(--c-error); background: var(--c-error-subtle); }

  /* Send / Stop buttons */
  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-1);
    height: 30px;
    border-radius: var(--r-full);
    font-size: var(--sz-xs);
    font-weight: 500;
    flex-shrink: 0;
    transition: background var(--duration-fast), transform var(--duration-fast);
  }

  .send-btn {
    width: 30px;
    background: var(--c-accent);
    color: white;
  }
  .send-btn:hover:not(:disabled) { background: var(--c-accent-hover); }
  .send-btn:active:not(:disabled) { transform: scale(0.94); }
  .send-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .stop-btn {
    padding: 0 var(--sp-3);
    background: var(--c-error-subtle);
    color: var(--c-error);
    border: 1px solid var(--c-error);
  }
  .stop-btn:hover { background: var(--c-error); color: white; }
</style>
