<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from "svelte";

  export let open = false;
  export let recentSessions: { id: string; title: string }[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    action: { id: string; category: string };
  }>();

  type PaletteItem = {
    id: string;
    label: string;
    category: string;
    shortcut?: string;
    icon: string;
  };

  let query = "";
  let selectedIndex = 0;
  let inputEl: HTMLInputElement | null = null;

  const staticItems: PaletteItem[] = [
    { id: "nav:home", label: "ホームに移動", category: "ナビゲーション", shortcut: "", icon: "home" },
    { id: "nav:pipeline", label: "パイプラインに移動", category: "ナビゲーション", shortcut: "", icon: "pipeline" },
    { id: "nav:batch", label: "バッチに移動", category: "ナビゲーション", shortcut: "", icon: "batch" },
    { id: "nav:template", label: "テンプレートに移動", category: "ナビゲーション", shortcut: "", icon: "template" },
    { id: "nav:sessions", label: "セッション履歴", category: "ナビゲーション", shortcut: "", icon: "sessions" },
    { id: "nav:settings", label: "設定を開く", category: "ナビゲーション", shortcut: "", icon: "settings" },
    { id: "action:new-session", label: "新しいセッションを開始", category: "アクション", shortcut: "", icon: "plus" },
    { id: "action:toggle-theme", label: "テーマを切替", category: "アクション", shortcut: "", icon: "theme" },
    { id: "action:toggle-sidebar", label: "サイドバーを切替", category: "アクション", shortcut: "", icon: "sidebar" },
  ];

  $: allItems = [
    ...staticItems,
    ...recentSessions.slice(0, 5).map((s) => ({
      id: `session:${s.id}`,
      label: s.title || `セッション ${s.id.slice(0, 8)}`,
      category: "最近のセッション",
      icon: "session",
    })),
  ];

  $: filteredItems = query.trim()
    ? allItems.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.category.toLowerCase().includes(query.toLowerCase())
      )
    : allItems;

  $: groupedItems = filteredItems.reduce<Record<string, PaletteItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  $: categories = Object.keys(groupedItems);

  $: if (selectedIndex >= filteredItems.length) {
    selectedIndex = Math.max(0, filteredItems.length - 1);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      dispatch("close");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % filteredItems.length;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + filteredItems.length) % filteredItems.length;
      return;
    }
    if (event.key === "Enter" && filteredItems[selectedIndex]) {
      event.preventDefault();
      const item = filteredItems[selectedIndex];
      dispatch("action", { id: item.id, category: item.category });
      dispatch("close");
    }
  }

  $: if (open && inputEl) {
    requestAnimationFrame(() => inputEl?.focus());
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="palette-overlay" on:click|self={() => dispatch("close")}>
    <div class="palette" role="dialog" aria-label="コマンドパレット">
      <div class="palette-input-row">
        <svg class="palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          bind:this={inputEl}
          class="palette-input"
          type="text"
          placeholder="コマンドを検索…"
          bind:value={query}
          on:keydown={handleKeydown}
          aria-label="コマンド検索"
        />
        <kbd class="palette-esc">Esc</kbd>
      </div>

      <div class="palette-results">
        {#if filteredItems.length === 0}
          <div class="palette-empty">一致するコマンドがありません</div>
        {:else}
          {#each categories as category}
            <div class="palette-category">
              <div class="palette-category-label">{category}</div>
              {#each groupedItems[category] as item}
                {@const globalIndex = filteredItems.indexOf(item)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  class="palette-item"
                  class:selected={globalIndex === selectedIndex}
                  role="option"
                  tabindex="-1"
                  aria-selected={globalIndex === selectedIndex}
                  on:click={() => {
                    dispatch("action", { id: item.id, category: item.category });
                    dispatch("close");
                  }}
                  on:mouseenter={() => { selectedIndex = globalIndex; }}
                >
                  <span class="palette-item-label">{item.label}</span>
                  {#if item.shortcut}
                    <kbd class="palette-shortcut">{item.shortcut}</kbd>
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .palette-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.20);
    backdrop-filter: blur(16px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    z-index: 1000;
    animation: overlay-fade-in var(--duration-normal) var(--ease);
  }

  .palette {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--r-xl);
    box-shadow: 0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
    width: 520px;
    max-width: 90vw;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: modal-slide-up var(--duration-slow) var(--ease);
  }

  .palette-input-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--c-divider);
  }

  .palette-search-icon {
    color: var(--c-text-3);
    flex-shrink: 0;
  }

  .palette-input {
    flex: 1;
    border: none;
    background: none;
    font-size: var(--sz-lg);
    color: var(--c-text);
    outline: none;
    line-height: 1.5;
  }

  .palette-input::placeholder {
    color: var(--c-text-3);
  }

  .palette-esc {
    font-size: var(--sz-2xs);
    padding: 2px 6px;
    border-radius: var(--r-xs);
    background: var(--c-surface-raised);
    color: var(--c-text-3);
    border: 1px solid var(--c-border);
    font-family: var(--font-mono);
  }

  .palette-results {
    overflow-y: auto;
    padding: var(--sp-2) 0;
  }

  .palette-category {
    padding: 0 var(--sp-2);
  }

  .palette-category-label {
    padding: var(--sp-2) var(--sp-3);
    font-size: var(--sz-2xs);
    font-weight: 500;
    color: var(--c-text-3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .palette-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-md);
    cursor: pointer;
    transition: background var(--duration-instant);
    margin: 0 var(--sp-1);
  }

  .palette-item.selected {
    background: var(--c-accent-subtle);
  }

  .palette-item-label {
    font-size: var(--sz-sm);
    color: var(--c-text);
  }

  .palette-item.selected .palette-item-label {
    color: var(--c-accent);
  }

  .palette-shortcut {
    font-size: 0.6875rem;
    padding: 1px 5px;
    border-radius: var(--r-xs);
    background: var(--c-surface-raised);
    color: var(--c-text-3);
    border: 1px solid var(--c-border);
    font-family: var(--font-mono);
  }

  .palette-empty {
    padding: var(--sp-8) var(--sp-4);
    text-align: center;
    color: var(--c-text-3);
    font-size: var(--sz-sm);
  }
</style>
