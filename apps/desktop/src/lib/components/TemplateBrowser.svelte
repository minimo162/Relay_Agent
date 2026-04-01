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
  .template-browser,
  .template-grid {
    display: grid;
    gap: 1rem;
  }

  .browser-head {
    display: grid;
    grid-template-columns: 1fr minmax(180px, 280px);
    gap: 1rem;
    align-items: start;
  }

  .category-tabs,
  .tag-row,
  .card-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .category-tab,
  .tag {
    padding: 0.35rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--ra-border);
    background: var(--ra-surface);
    font-size: 0.82rem;
  }

  .category-tab.is-active {
    border-color: var(--ra-accent);
    color: var(--ra-accent);
  }

  .template-card {
    display: grid;
    gap: 0.75rem;
    padding: 0.95rem;
    border-radius: 14px;
    border: 1px solid var(--ra-border);
    background: var(--ra-surface);
  }

  .template-topline {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .empty-copy {
    color: var(--ra-text-muted);
  }

  @media (max-width: 760px) {
    .browser-head {
      grid-template-columns: 1fr;
    }
  }
</style>
