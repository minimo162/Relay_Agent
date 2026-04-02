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
  let isDragOver = false;
  let textareaEl: HTMLTextAreaElement | null = null;

  $: if (initialGoal !== goal && !goal.trim()) {
    goal = initialGoal;
  }
  $: if (initialFiles.length === 0 && attachedFiles.length === 0) {
    attachedFiles = [...initialFiles];
  }

  function autoGrow() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    const clamped = Math.min(Math.max(textareaEl.scrollHeight, 56), 200);
    textareaEl.style.height = clamped + "px";
  }

  function handleFileAttach() {
    hiddenFileInput?.click();
  }

  function handleSubmit() {
    if (!goal.trim() || disabled) return;
    dispatch("submit", { goal: goal.trim(), files: attachedFiles });
  }

  function handleCancel() {
    dispatch("cancel");
  }

  function handleSuggestion(value: string) {
    goal = value;
    setTimeout(() => textareaEl?.focus(), 0);
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
    if (textareaEl) textareaEl.style.height = "56px";
    dispatch("reset");
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

<!-- ===== IDLE: centered hero + suggestions ===== -->
{#if mode === "idle"}
  <div class="idle-suggestions">
    {#if suggestions.length > 0 && !goal.trim()}
      <div class="suggestion-chips">
        {#each suggestions.slice(0, 4) as s}
          <button class="suggestion-chip" type="button" on:click={() => handleSuggestion(s.value)}>
            {s.label}
          </button>
        {/each}
      </div>
    {/if}

    {#if recentFiles.length > 0}
      <div class="recent-row">
        <span class="label-section">最近のファイル</span>
        <div class="recent-chips">
          {#each recentFiles.slice(0, 3) as file}
            <button class="recent-chip" type="button" on:click={() => handleQuickAttach(file.path)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              {basename(file.path)}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- ===== Bottom composer — always visible ===== -->
<div
  class="composer"
  class:drag-over={isDragOver}
  class:busy={mode === "busy"}
  on:drop={handleDrop}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  role="region"
  aria-label="メッセージ入力"
>
  <!-- File chips row -->
  {#if attachedFiles.length > 0}
    <div class="chip-row">
      {#each attachedFiles as file, index}
        <span class="file-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
          {basename(file)}
          <button type="button" class="chip-remove" on:click={() => removeFile(index)} aria-label="削除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </span>
      {/each}
    </div>
  {/if}

  <!-- Main input shell -->
  <div class="input-shell" class:focused={false}>
    <!-- Toolbar: left actions -->
    <div class="toolbar-left">
      <button class="tool-btn" type="button" on:click={handleFileAttach} {disabled} title="ファイルを添付 (@)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
        <span class="tool-label">@ファイル</span>
      </button>
      <button class="tool-btn" type="button" {disabled} title="コマンド (/)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
        </svg>
        <span class="tool-label">/コマンド</span>
      </button>
      <div class="tool-sep"></div>
      <button class="tool-btn copilot-btn" type="button" {disabled} title="Copilot モデル選択">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
        </svg>
        <span class="tool-label">Copilot</span>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>
    </div>

    <!-- Textarea -->
    <textarea
      bind:this={textareaEl}
      bind:value={goal}
      on:input={autoGrow}
      on:keydown={handleKeydown}
      placeholder={mode === "busy" ? "実行中… (Shift+Enter で割り込む)" : "指示を入力… (Enter で送信、Shift+Enter で改行)"}
      rows="1"
      disabled={disabled && mode !== "busy"}
      class="composer-textarea"
    ></textarea>

    <!-- Send / Stop button -->
    {#if mode === "busy"}
      <button class="action-btn stop-btn" type="button" on:click={handleCancel} aria-label="停止">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="2"/>
        </svg>
      </button>
    {:else}
      <button
        class="action-btn send-btn"
        type="button"
        on:click={handleSubmit}
        disabled={!goal.trim() || disabled}
        aria-label="送信"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7"/>
        </svg>
      </button>
    {/if}
  </div>

  <!-- Busy progress bar -->
  {#if mode === "busy"}
    <div class="busy-bar"></div>
  {/if}
</div>

<style>
  .hidden-file-input { display: none; }

  /* ===== Idle suggestions area ===== */
  .idle-suggestions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-3, 12px);
    padding-bottom: var(--sp-4, 16px);
  }

  .suggestion-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2, 8px);
    justify-content: center;
    max-width: 560px;
  }

  .suggestion-chip {
    padding: var(--sp-2, 8px) var(--sp-4, 16px);
    font-size: var(--sz-sm, 0.875rem);
    color: var(--c-text-2);
    background: var(--c-surface, #fff);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-full, 9999px);
    box-shadow: var(--shadow-xs);
    transition: border-color var(--duration-fast) var(--ease),
                color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
    cursor: pointer;
  }
  .suggestion-chip:hover {
    border-color: var(--c-accent);
    color: var(--c-accent);
    box-shadow: var(--shadow-sm);
  }

  .recent-row {
    width: 100%;
    max-width: 560px;
  }

  .recent-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2, 8px);
    padding: 0 var(--sp-3, 12px);
  }

  .recent-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1, 4px);
    padding: var(--sp-1, 4px) var(--sp-3, 12px);
    font-size: var(--sz-xs, 0.75rem);
    font-weight: 500;
    color: var(--c-text-2);
    border: 1px solid var(--c-border);
    border-radius: var(--r-full, 9999px);
    transition: border-color var(--duration-fast), color var(--duration-fast);
    cursor: pointer;
  }
  .recent-chip:hover { border-color: var(--c-accent); color: var(--c-accent); }
  .recent-chip svg { width: 12px; height: 12px; opacity: 0.5; flex-shrink: 0; }

  /* ===== Composer shell ===== */
  .composer {
    position: relative;
    padding: var(--sp-2, 8px) var(--sp-3, 12px);
    background: var(--c-surface, #fff);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-xl, 32px);
    box-shadow: var(--shadow-sm);
    transition: border-color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
  }
  .composer:focus-within {
    border-color: var(--c-accent);
    box-shadow: var(--shadow-sm), 0 0 0 3px var(--c-accent-subtle);
  }
  .composer.drag-over {
    border-color: var(--c-accent);
    box-shadow: var(--shadow-md), 0 0 0 3px var(--c-accent-subtle);
  }

  /* File chip row */
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1, 4px);
    padding: 0 var(--sp-1, 4px) var(--sp-2, 8px);
  }

  .file-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1, 4px);
    padding: 3px var(--sp-1, 4px) 3px var(--sp-3, 12px);
    font-size: var(--sz-xs, 0.75rem);
    font-weight: 500;
    color: var(--c-text);
    background: var(--c-canvas, #f6f9fc);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-full, 9999px);
    line-height: 1;
  }
  .file-chip svg { width: 12px; height: 12px; opacity: 0.5; flex-shrink: 0; }

  .chip-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: var(--c-text-3);
    flex-shrink: 0;
    transition: background var(--duration-fast), color var(--duration-fast);
  }
  .chip-remove:hover { background: var(--c-error-subtle); color: var(--c-error); }
  .chip-remove svg { width: 10px; height: 10px; }

  /* Input shell — toolbar + textarea + action */
  .input-shell {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-2, 8px);
  }

  /* Toolbar */
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    padding-bottom: 6px;
  }

  .tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    font-size: var(--sz-xs, 0.75rem);
    color: var(--c-text-3);
    border-radius: var(--r-full, 9999px);
    transition: background var(--duration-fast), color var(--duration-fast);
    cursor: pointer;
    white-space: nowrap;
  }
  .tool-btn:hover:not(:disabled) { background: var(--c-border); color: var(--c-text-2); }
  .tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .tool-btn svg { width: 14px; height: 14px; flex-shrink: 0; }

  .tool-label { display: none; }
  @media (min-width: 640px) { .tool-label { display: inline; } }

  .copilot-btn { color: var(--c-text-2); }
  .chevron { width: 12px !important; height: 12px !important; opacity: 0.6; }

  .tool-sep {
    width: 1px;
    height: 16px;
    background: var(--c-border-strong);
    margin: 0 2px;
    flex-shrink: 0;
  }

  /* Textarea */
  .composer-textarea {
    flex: 1;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--c-text);
    font-family: var(--font-sans);
    font-size: var(--sz-sm, 0.875rem);
    line-height: 1.6;
    padding: var(--sp-1, 4px) 0;
    min-height: 28px;
    max-height: 200px;
    overflow-y: auto;
    align-self: center;
  }
  .composer-textarea::placeholder { color: var(--c-text-3); }
  .composer-textarea:disabled { opacity: 0.55; cursor: not-allowed; }

  /* Send / Stop */
  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: var(--r-full, 9999px);
    transition: background var(--duration-fast), transform var(--duration-fast);
  }
  .action-btn svg { width: 16px; height: 16px; }

  .send-btn {
    background: var(--c-accent);
    color: white;
  }
  .send-btn:hover:not(:disabled) { background: var(--c-accent-hover); }
  .send-btn:active:not(:disabled) { transform: scale(0.94); }
  .send-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .stop-btn {
    background: var(--c-error-subtle);
    color: var(--c-error);
  }
  .stop-btn:hover { background: var(--c-error); color: white; }
  .stop-btn:active { transform: scale(0.94); }

  /* Busy progress bar */
  .busy-bar {
    position: absolute;
    bottom: 0;
    left: var(--r-xl, 32px);
    right: var(--r-xl, 32px);
    height: 2px;
    border-radius: var(--r-full);
    background: linear-gradient(90deg, transparent, var(--c-accent), transparent);
    background-size: 200% 100%;
    animation: sweep 1.6s ease-in-out infinite;
  }

  @keyframes sweep {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
