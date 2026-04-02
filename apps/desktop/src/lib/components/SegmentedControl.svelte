<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let items: { value: string; label: string }[] = [];
  export let value = "";
  export let size: "sm" | "md" = "md";

  const dispatch = createEventDispatcher<{ change: string }>();

  function select(v: string) {
    if (v === value) return;
    value = v;
    dispatch("change", v);
  }
</script>

<div class="seg-track" class:seg-sm={size === "sm"} role="tablist" aria-label="セグメントコントロール">
  {#each items as item}
    <button
      role="tab"
      type="button"
      class="seg-item"
      class:seg-item-active={item.value === value}
      aria-selected={item.value === value}
      on:click={() => select(item.value)}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  /* All visual styles come from global .seg-track / .seg-item / .seg-item-active in layout.svelte */
  .seg-sm :global(.seg-item) {
    padding: 3px 10px;
    font-size: var(--sz-xs, 0.75rem);
  }
</style>
