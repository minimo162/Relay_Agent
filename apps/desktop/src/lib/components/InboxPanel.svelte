<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let inboxFiles: { path: string; size: number; addedAt: string }[] = [];

  const dispatch = createEventDispatcher<{
    addFile: { path: string };
    removeFile: { path: string };
  }>();

  let isDragOver = false;
  let hiddenInput: HTMLInputElement | null = null;

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragOver = false;
    const files = event.dataTransfer?.files;
    if (!files) {
      return;
    }

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index] as File & { path?: string };
      const path = file.path?.trim();
      if (path) {
        dispatch("addFile", { path });
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

  function pickFile() {
    hiddenInput?.click();
  }

  function handleInputChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0] as (File & { path?: string }) | undefined;
    const path = file?.path?.trim();
    if (path) {
      dispatch("addFile", { path });
    }
    target.value = "";
  }

  function removeFile(path: string) {
    dispatch("removeFile", { path });
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function basename(path: string): string {
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return separatorIndex < 0 ? path : path.slice(separatorIndex + 1);
  }

  function formatAddedAt(addedAt: string): string {
    const parsed = Date.parse(addedAt);
    if (!Number.isFinite(parsed)) {
      return "追加時刻不明";
    }

    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(parsed));
  }
</script>

<input
  bind:this={hiddenInput}
  type="file"
  accept=".csv,.xlsx,.xlsm,.xls,.txt,.docx"
  class="hidden-input"
  on:change={handleInputChange}
/>

<div class="tab-body">
  <div
    class="drop-zone"
    class:drag-over={isDragOver}
    on:drop={handleDrop}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    role="region"
    aria-label="ファイルドロップゾーン"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
    <span>ファイルをドロップ</span>
    <button type="button" class="pick-btn" on:click={pickFile}>または選択</button>
  </div>

  {#if inboxFiles.length > 0}
    <div class="file-list">
      <span class="label-section">インボックス ({inboxFiles.length})</span>
      {#each inboxFiles as file}
        <div class="file-row">
          <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <div class="file-info">
            <span class="file-name">{basename(file.path)}</span>
            <span class="file-meta">{formatSize(file.size)} ・ {formatAddedAt(file.addedAt)}</span>
          </div>
          <button type="button" class="remove-btn" on:click={() => removeFile(file.path)} aria-label="削除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty-hint">ファイルを追加するとエージェントが参照できます</p>
  {/if}
</div>

<style>
  .hidden-input {
    display: none;
  }

  .tab-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-2, 8px) 0 var(--sp-4, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--sp-1, 4px);
  }

  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2, 8px);
    margin: var(--sp-2, 8px) var(--sp-3, 12px);
    padding: var(--sp-4, 16px) var(--sp-3, 12px);
    border: 1.5px dashed var(--c-border-strong);
    border-radius: var(--r-lg, 24px);
    text-align: center;
    transition: border-color var(--duration-fast), background var(--duration-fast);
    cursor: default;
  }

  .drop-zone.drag-over {
    border-color: var(--c-accent);
    background: var(--c-accent-subtle, rgba(30, 64, 175, 0.08));
  }

  .drop-zone svg {
    width: 22px;
    height: 22px;
    color: var(--c-muted);
  }

  .drop-zone span {
    font-size: 0.88rem;
    color: var(--c-text);
  }

  .pick-btn {
    appearance: none;
    border: 1px solid var(--c-border-strong);
    background: var(--c-surface);
    color: var(--c-text);
    border-radius: var(--r-full, 999px);
    padding: 0.45rem 0.85rem;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0 var(--sp-3, 12px);
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.7rem 0.8rem;
    border-radius: var(--r-md, 16px);
    background: var(--c-surface);
    border: 1px solid transparent;
    transition: background var(--duration-fast), border-color var(--duration-fast);
  }

  .file-row:hover {
    border-color: var(--c-border);
  }

  .file-icon {
    width: 18px;
    height: 18px;
    color: var(--c-muted);
    flex-shrink: 0;
  }

  .file-info {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
  }

  .file-name {
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--c-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-meta {
    font-size: 0.72rem;
    color: var(--c-muted);
  }

  .remove-btn {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--c-muted);
    padding: 0.25rem;
    border-radius: var(--r-full, 999px);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--duration-fast), background var(--duration-fast), color var(--duration-fast);
  }

  .file-row:hover .remove-btn,
  .remove-btn:focus-visible {
    opacity: 1;
  }

  .remove-btn:hover,
  .remove-btn:focus-visible {
    background: var(--c-surface-hover, rgba(15, 23, 42, 0.06));
    color: var(--c-text);
  }

  .remove-btn svg {
    width: 14px;
    height: 14px;
    display: block;
  }

  .empty-hint {
    margin: 0;
    padding: 0 var(--sp-3, 12px);
    font-size: 0.8rem;
    color: var(--c-muted);
  }
</style>
