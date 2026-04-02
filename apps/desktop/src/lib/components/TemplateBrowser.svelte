<script lang="ts">
  import type {
    WorkflowTemplate,
    WorkflowTemplateCategory
  } from "@relay-agent/contracts";

  export let templates: WorkflowTemplate[] = [];
  export let activeCategory: WorkflowTemplateCategory | "all" = "all";
  export let searchQuery = "";
  export let onCategoryChange: (value: WorkflowTemplateCategory | "all") => void = () => {};
  export let onSearchChange: (value: string) => void = () => {};
  export let onSelect: (template: WorkflowTemplate) => void = () => {};
  export let onDelete: (template: WorkflowTemplate) => void = () => {};

  const categories: Array<{ key: WorkflowTemplateCategory | "all"; label: string }> = [
    { key: "all", label: "すべて" },
    { key: "sales", label: "営業" },
    { key: "accounting", label: "経理" },
    { key: "hr", label: "HR" },
    { key: "general", label: "汎用" },
    { key: "custom", label: "カスタム" }
  ];
</script>

<section class="template-browser card">
  <div class="browser-head">
    <div>
      <h3>テンプレートライブラリ</h3>
      <p>よく使うワークフローを再利用できます。</p>
    </div>
    <input
      class="input search-input"
      type="search"
      value={searchQuery}
      on:input={(event) => onSearchChange((event.currentTarget as HTMLInputElement).value)}
      placeholder="キーワード検索"
    />
  </div>

  <div class="category-tabs">
    {#each categories as category}
      <button
        class="category-tab"
        class:is-active={activeCategory === category.key}
        type="button"
        on:click={() => onCategoryChange(category.key)}
      >
        {category.label}
      </button>
    {/each}
  </div>

  <div class="template-grid">
    {#if templates.length === 0}
      <p class="empty-copy">該当するテンプレートはありません。</p>
    {:else}
      {#each templates as template (template.id)}
        <article class="template-card">
          <div class="template-topline">
            <strong>{template.title}</strong>
            <span>{template.isBuiltIn ? "組み込み" : "カスタム"}</span>
          </div>
          <p>{template.description || template.goal}</p>
          <div class="tag-row">
            {#each template.expectedTools as tool}
              <span class="tag">{tool}</span>
            {/each}
          </div>
          <div class="tag-row">
            {#each template.tags as tag}
              <span class="tag">{tag}</span>
            {/each}
          </div>
          <div class="card-actions">
            <button class="btn btn-primary" type="button" on:click={() => onSelect(template)}>
              このテンプレートを使う
            </button>
            {#if !template.isBuiltIn}
              <button class="btn btn-secondary" type="button" on:click={() => onDelete(template)}>
                削除
              </button>
            {/if}
          </div>
        </article>
      {/each}
    {/if}
  </div>
</section>

<style>
  .template-browser {
    display: grid;
    gap: var(--sp-4);
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--sp-4);
  }

  .browser-head {
    display: grid;
    grid-template-columns: 1fr minmax(180px, 280px);
    gap: var(--sp-4);
    align-items: start;
  }

  .browser-head h3 {
    font-size: var(--sz-lg);
    font-weight: 700;
    color: var(--c-text);
    letter-spacing: -0.01em;
  }

  .browser-head p {
    font-size: var(--sz-sm);
    color: var(--c-text-2);
    margin-top: var(--sp-1);
  }

  .search-input {
    border-radius: var(--r-lg);
    border: 1px solid var(--c-border-strong);
    padding: var(--sp-2) var(--sp-3);
    font-size: var(--sz-sm);
    background: var(--c-surface);
    color: var(--c-text);
    transition: border-color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-subtle);
  }

  .category-tabs {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  .tag-row,
  .card-actions {
    display: flex;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  .category-tab {
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--r-full);
    border: 1px solid var(--c-border-strong);
    background: var(--c-surface);
    font-size: var(--sz-xs);
    font-weight: 500;
    color: var(--c-text-2);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease);
  }

  .category-tab:hover {
    border-color: var(--c-border-strong);
    color: var(--c-text);
  }

  .category-tab.is-active {
    border-color: var(--c-accent);
    background: var(--c-accent-subtle);
    color: var(--c-accent);
  }

  .tag {
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-full);
    border: 1px solid var(--c-border-strong);
    background: var(--c-canvas);
    font-size: var(--sz-xs);
    color: var(--c-text-3);
    font-family: var(--font-mono);
  }

  .template-card {
    display: grid;
    gap: var(--sp-3);
    padding: var(--sp-4);
    border-radius: var(--r-xl);
    border: 1px solid var(--c-border-strong);
    background: var(--c-surface);
    box-shadow: var(--shadow-sm);
    transition: transform var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease),
                border-color var(--duration-fast) var(--ease);
  }

  .template-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
    border-color: var(--c-border-strong);
  }

  .template-topline {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--sp-3);
  }

  .template-topline strong {
    font-size: var(--sz-sm);
    font-weight: 700;
    color: var(--c-text);
  }

  .template-topline span {
    display: inline-flex;
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-full);
    font-size: var(--sz-xs);
    font-weight: 500;
    background: var(--c-accent-subtle);
    color: var(--c-accent);
    white-space: nowrap;
  }

  .template-card p {
    font-size: var(--sz-sm);
    color: var(--c-text-2);
    line-height: 1.4;
  }

  .empty-copy {
    color: var(--c-text-3);
    font-size: var(--sz-sm);
    grid-column: 1 / -1;
  }

  @media (max-width: 960px) {
    .template-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .browser-head {
      grid-template-columns: 1fr;
    }

    .template-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
