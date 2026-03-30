<script lang="ts">
</script>

<svelte:head>
  <meta name="description" content="Relay Agent — ファイル変更の安全なリレー" />
</svelte:head>

<div class="app-shell">
  <slot />
</div>

<style>
  :global(:root) {
    --ra-bg: #f7f5f0;
    --ra-surface: #ffffff;
    --ra-surface-muted: #f9f8f5;
    --ra-border: #e8e5de;
    --ra-border-strong: #d1cdc4;
    --ra-text: #1a1a1a;
    --ra-text-secondary: #666660;
    --ra-text-muted: #999990;
    --ra-accent: #2563eb;
    --ra-accent-hover: #1d4ed8;
    --ra-accent-light: #eff6ff;
    --ra-accent-border: #bfdbfe;
    --ra-success: #16a34a;
    --ra-success-light: #f0fdf4;
    --ra-success-border: #bbf7d0;
    --ra-error: #dc2626;
    --ra-error-light: #fef2f2;
    --ra-warn-light: #fffbeb;
    --ra-radius: 0.75rem;
    --ra-radius-sm: 0.5rem;
    --ra-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    --ra-shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  :global(body) {
    margin: 0;
    min-height: 100vh;
    color: var(--ra-text);
    font-family: "Segoe UI", "Hiragino Sans", "Meiryo", sans-serif;
    font-size: 15px;
    line-height: 1.6;
    background: var(--ra-bg);
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(a) {
    color: var(--ra-accent);
    text-decoration: none;
  }

  :global(button) {
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }

  :global(input, textarea, select) {
    font-family: inherit;
    font-size: inherit;
  }

  .app-shell {
    min-height: 100vh;
    max-width: 720px;
    margin: 0 auto;
    padding: 0 1.5rem;
  }
</style>
