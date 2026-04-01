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
    accept=".csv,.xlsx,.xlsm,.xls,.txt,.docx"
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
          📎 {basename(file)}
          <button class="remove-file" type="button" on:click={() => removeFile(index)}>✕</button>
        </span>
      {/each}
    </div>
  {/if}

  {#if recentFiles.length > 0 && attachedFiles.length === 0}
    <div class="quick-attach">
      {#each recentFiles.slice(0, 3) as file}
        <button class="quick-attach-chip" type="button" on:click={() => handleQuickAttach(file.path)}>
          📎 {basename(file.path)}
        </button>
      {/each}
    </div>
  {/if}

  <div class="composer-input-row">
    <textarea
      class="composer-textarea"
      bind:value={goal}
      on:keydown={handleKeydown}
      placeholder="やりたいことを入力してください… 例: revenue.csv の approved が true の行だけ残して保存"
      rows="2"
      {disabled}
    ></textarea>
    <button class="attach-btn" type="button" on:click={handleFileAttach} {disabled} aria-label="ファイルを添付">
      📎
    </button>
    <button class="send-btn" type="button" on:click={handleSubmit} disabled={disabled || !goal.trim()} aria-label="送信">
      送信
    </button>
  </div>
</div>

<style>
  .chat-composer {
    border-top: 1px solid var(--ra-border);
    padding: 0.9rem 1rem;
    background: var(--ra-surface);
  }

  .composer-input-row {
    display: flex;
    gap: 0.55rem;
    align-items: flex-end;
  }

  .composer-textarea {
    flex: 1;
    resize: none;
    min-height: 3rem;
  }

  .suggestion-chips,
  .quick-attach,
  .attached-files {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
    margin-bottom: 0.65rem;
  }

  .suggestion-chip,
  .quick-attach-chip,
  .attached-file-chip {
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--ra-border);
    background: color-mix(in srgb, var(--ra-surface) 92%, white);
    font-size: 0.82rem;
  }

  .attached-file-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .remove-file,
  .attach-btn {
    border: none;
    background: transparent;
    cursor: pointer;
  }

  .send-btn {
    min-width: 5rem;
  }

  .hidden-file-input {
    display: none;
  }
</style>
