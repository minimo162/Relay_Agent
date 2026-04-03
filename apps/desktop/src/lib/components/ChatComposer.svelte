<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let recentFiles: { path: string; lastUsedAt: string }[] = [];
  export let suggestions: { label: string; value: string }[] = [];
  export let disabled = false;
  export let initialGoal = "";
  export let initialFiles: string[] = [];

  const dispatch = createEventDispatcher<{
    submit: { goal: string; files: string[] };
  }>();

  let goal = initialGoal;
  let attachedFiles = [...initialFiles];
  let hiddenFileInput: HTMLInputElement | null = null;

  $: if (initialGoal !== goal && !goal.trim()) {
    goal = initialGoal;
  }
  $: if (initialFiles.length === 0 && attachedFiles.length === 0) {
    attachedFiles = [...initialFiles];
  }

  async function handleFileAttach() {
    hiddenFileInput?.click();
  }

  function handleSubmit() {
    if (!goal.trim()) {
      return;
    }

    dispatch("submit", { goal: goal.trim(), files: attachedFiles });
  }

  function handleSuggestion(value: string) {
    goal = value;
  }

  function handleQuickAttach(path: string) {
    if (!attachedFiles.includes(path)) {
      attachedFiles = [...attachedFiles, path];
    }
  }

  function removeFile(index: number) {
    attachedFiles = attachedFiles.filter((_, candidate) => candidate !== index);
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

  function basename(filePath: string): string {
    const lastSeparator = Math.max(
      filePath.lastIndexOf("/"),
      filePath.lastIndexOf("\\")
    );
    return lastSeparator < 0 ? filePath : filePath.slice(lastSeparator + 1);
  }
</script>

<div class="chat-composer">
  <input
    bind:this={hiddenFileInput}
    type="file"
    class="hidden-file-input"
    on:change={handleFileChange}
  />
  {#if suggestions.length > 0}
    <div class="suggestion-chips">
      {#each suggestions as suggestion}
        <button class="suggestion-chip" type="button" on:click={() => handleSuggestion(suggestion.value)}>
          {suggestion.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if attachedFiles.length > 0}
    <div class="attached-files">
      {#each attachedFiles as file, index}
        <span class="attached-file-chip">
          <svg class="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          {basename(file)}
          <button class="remove-file" type="button" on:click={() => removeFile(index)} aria-label="ファイルを削除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </span>
      {/each}
    </div>
  {/if}

  {#if recentFiles.length > 0 && attachedFiles.length === 0}
    <div class="quick-attach">
      {#each recentFiles.slice(0, 3) as file}
        <button class="quick-attach-chip" type="button" on:click={() => handleQuickAttach(file.path)}>
          <svg class="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          {basename(file.path)}
        </button>
      {/each}
    </div>
  {/if}

  <div class="composer-input-row">
    <button class="attach-btn" type="button" on:click={handleFileAttach} {disabled} aria-label="ファイルを添付">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
    </button>
    <textarea
      class="composer-textarea"
      bind:value={goal}
      on:keydown={handleKeydown}
      placeholder="やりたいことを入力してください… 例: revenue.csv の approved が true の行だけ残して保存"
      rows="2"
      {disabled}
    ></textarea>
    <button class="send-btn" type="button" on:click={handleSubmit} disabled={disabled || !goal.trim()} aria-label="送信">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>
  </div>
</div>

<style>
  /* ==============================================
     Chat Composer — Shizuka Design
     ============================================== */

  .chat-composer {
    position: sticky;
    bottom: 0;
    z-index: 50;
    padding: var(--sp-3) var(--sp-4) var(--sp-4);
    background: linear-gradient(
      to bottom,
      transparent 0%,
      var(--c-canvas) 12%
    );
    pointer-events: none;
  }

  /* Re-enable pointer events on actual interactive children */
  .chat-composer > :global(*) {
    pointer-events: auto;
  }

  /* --- Main input row --- */
  .composer-input-row {
    display: flex;
    align-items: flex-end;
    gap: 0;
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: 16px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
    padding: var(--sp-1);
    backdrop-filter: blur(20px) saturate(180%);
    transition:
      border-color var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast) var(--ease);
  }

  .composer-input-row:focus-within {
    border-color: var(--c-accent);
    box-shadow:
      0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04),
      0 0 0 3px var(--c-accent-subtle);
  }

  /* --- Textarea --- */
  .composer-textarea {
    flex: 1;
    resize: none;
    min-height: 2.5rem;
    max-height: 8rem;
    border: none;
    outline: none;
    background: transparent;
    color: var(--c-text);
    font-family: var(--font-sans);
    font-size: var(--sz-base);
    line-height: 1.6;
    padding: var(--sp-2) var(--sp-2);
    overflow-y: auto;
  }

  .composer-textarea::placeholder {
    color: var(--c-text-3);
  }

  .composer-textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* --- Attach button (paperclip, left side) --- */
  .attach-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    border: none;
    border-radius: var(--r-full);
    background: transparent;
    color: var(--c-text-3);
    cursor: pointer;
    transition:
      color var(--duration-fast),
      background var(--duration-fast);
  }

  .attach-btn:hover:not(:disabled) {
    color: var(--c-text-2);
    background: var(--c-accent-subtle);
  }

  .attach-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .attach-btn svg {
    width: 18px;
    height: 18px;
  }

  /* --- Send button (round accent) --- */
  .send-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    border: none;
    border-radius: var(--r-full);
    background: var(--c-accent);
    color: white;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition:
      background var(--duration-fast),
      transform var(--duration-fast) var(--ease),
      box-shadow var(--duration-fast);
  }

  .send-btn:hover:not(:disabled) {
    background: var(--c-accent-hover);
    transform: scale(1.06);
    box-shadow: var(--shadow-md);
  }

  .send-btn:active:not(:disabled) {
    transform: scale(0.97);
  }

  .send-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    transform: none;
  }

  .send-btn svg {
    width: 16px;
    height: 16px;
  }

  /* --- Suggestion chips with slide-in --- */
  .suggestion-chips {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
    margin-bottom: var(--sp-3);
    animation: chips-slide-in 400ms var(--ease) both;
  }

  @keyframes chips-slide-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .suggestion-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-3);
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-accent);
    background: var(--c-accent-subtle);
    border: 1px solid rgba(13,148,136,0.20);
    border-radius: var(--r-full);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--duration-fast),
      border-color var(--duration-fast),
      transform var(--duration-fast) var(--ease);
  }

  .suggestion-chip:hover {
    background: rgba(13,148,136,0.04);
    border-color: var(--c-accent);
    transform: translateY(-1px);
  }

  /* --- Quick-attach chips --- */
  .quick-attach {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
    margin-bottom: var(--sp-3);
    animation: chips-slide-in 400ms var(--ease) both;
  }

  .quick-attach-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-3);
    font-size: var(--sz-xs);
    font-weight: 500;
    color: var(--c-text-2);
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-full);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--duration-fast),
      border-color var(--duration-fast),
      color var(--duration-fast);
  }

  .quick-attach-chip:hover {
    background: var(--c-accent-subtle);
    border-color: rgba(13,148,136,0.20);
    color: var(--c-accent);
  }

  /* --- Attached file chips (pill with x delete) --- */
  .attached-files {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
    margin-bottom: var(--sp-3);
    animation: chips-slide-in 400ms var(--ease) both;
  }

  .attached-file-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-1) var(--sp-1) var(--sp-3);
    font-size: var(--sz-xs);
    font-weight: 500;
    color: var(--c-text);
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-full);
    white-space: nowrap;
    box-shadow: var(--shadow-sm);
  }

  /* --- Chip inline icon --- */
  .chip-icon {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    opacity: 0.55;
  }

  /* --- Remove file button (x) --- */
  .remove-file {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    border: none;
    border-radius: var(--r-full);
    background: #f0eeea;
    color: var(--c-text-3);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background var(--duration-fast),
      color var(--duration-fast);
  }

  .remove-file:hover {
    background: var(--c-error-subtle);
    color: var(--c-error);
  }

  .remove-file svg {
    width: 11px;
    height: 11px;
  }

  /* --- Hidden file input --- */
  .hidden-file-input {
    display: none;
  }
</style>
