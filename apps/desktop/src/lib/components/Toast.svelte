<script lang="ts">
  import { fly, fade } from "svelte/transition";

  type ToastItem = {
    id: string;
    message: string;
    type: "success" | "error" | "info";
  };

  export let toasts: ToastItem[] = [];
  export let onDismiss: (id: string) => void = () => {};
</script>

<div class="toast-container" aria-live="polite">
  {#each toasts as toast (toast.id)}
    <div
      class="toast toast-{toast.type}"
      in:fly={{ x: 300, duration: 350, easing: t => {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
      }}}
      out:fade={{ duration: 200 }}
      role="alert"
    >
      <span class="toast-icon">
        {#if toast.type === "success"}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        {:else if toast.type === "error"}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" /><path d="m9 9 6 6" />
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" /><path d="M12 8h.01" />
          </svg>
        {/if}
      </span>
      <span class="toast-message">{toast.message}</span>
      <button class="toast-close" type="button" on:click={() => onDismiss(toast.id)} aria-label="閉じる">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6 6 18" /><path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 48px;
    right: var(--sp-4);
    z-index: 1100;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    width: 320px;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid var(--c-border-strong);
    box-shadow: var(--shadow-md);
    font-size: var(--sz-sm);
    color: var(--c-text);
  }

  .toast-success {
    border-left: 3px solid var(--c-success);
  }
  .toast-success .toast-icon { color: var(--c-success); }

  .toast-error {
    border-left: 3px solid var(--c-error);
  }
  .toast-error .toast-icon { color: var(--c-error); }

  .toast-info {
    border-left: 3px solid var(--c-accent);
  }
  .toast-info .toast-icon { color: var(--c-accent); }

  .toast-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .toast-message {
    flex: 1;
    line-height: 1.4;
  }

  .toast-close {
    display: flex;
    align-items: center;
    color: var(--c-text-3);
    flex-shrink: 0;
    padding: var(--sp-1);
    border-radius: var(--r-full);
    transition: color var(--duration-instant), background var(--duration-instant);
  }
  .toast-close:hover {
    color: var(--c-text);
    background: var(--c-accent-subtle);
  }
</style>
