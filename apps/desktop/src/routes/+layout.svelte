<script lang="ts">
</script>

<svelte:head>
  <meta name="description" content="Relay Agent — ファイル変更の安全なリレー" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Sans+JP:wght@400;500;600&display=swap" rel="stylesheet" />
</svelte:head>

<div class="app-shell">
  <slot />
</div>

<style>
  /* ================================================================
     Relay Agent Design System — openwork inspired
     "quiet, premium, operational, flat-first"
     ================================================================ */

  /* --- Light Mode --- */
  :global(:root) {
    color-scheme: light dark;

    /* Canvas & Surface — cool neutral */
    --c-canvas:         #f6f9fc;
    --c-sidebar:        #f9fafb;
    --c-surface:        #ffffff;
    --c-surface-raised: #ffffff;

    /* Border & Divider — nearly invisible */
    --c-border:         #f3f4f6;
    --c-border-strong:  #e5e7eb;
    --c-divider:        #f3f4f6;

    /* Text — 3 levels */
    --c-text:           #111827;
    --c-text-2:         #6b7280;
    --c-text-3:         #9ca3af;
    --c-text-inverse:   #ffffff;

    /* Accent — teal (Relay brand) */
    --c-accent:         #0d9488;
    --c-accent-hover:   #0f766e;
    --c-accent-subtle:  rgba(13, 148, 136, 0.06);

    /* Semantic */
    --c-success:        #16a34a;
    --c-success-subtle: rgba(22, 163, 74, 0.08);
    --c-warning:        #ca8a04;
    --c-warning-subtle: rgba(202, 138, 4, 0.08);
    --c-error:          #dc2626;
    --c-error-subtle:   rgba(220, 38, 38, 0.08);

    /* Typography */
    --font-sans:  "IBM Plex Sans", "Noto Sans JP", system-ui, sans-serif;
    --font-mono:  "SF Mono", "Cascadia Code", "Fira Code", "Consolas", monospace;

    /* Type scale — 14px base */
    --sz-2xs:  0.6875rem; /* 11px — uppercase section labels */
    --sz-xs:   0.75rem;   /* 12px — timestamps, captions */
    --sz-sm:   0.875rem;  /* 14px — body (base) */
    --sz-base: 1rem;      /* 16px — input text */
    --sz-lg:   1.125rem;  /* 18px — section headings */
    --sz-xl:   1.5rem;    /* 24px — page title */
    --sz-2xl:  2rem;      /* 32px — hero */

    /* Spacing — 4px base */
    --sp-1:  4px;   --sp-2:  8px;   --sp-3:  12px;  --sp-4:  16px;
    --sp-5:  20px;  --sp-6:  24px;  --sp-8:  32px;  --sp-10: 40px;
    --sp-12: 48px;  --sp-16: 64px;

    /* Elevation — 3 levels, very subtle */
    --shadow-xs: 0 1px 2px rgba(15, 23, 42, 0.04);
    --shadow-sm: 0 4px 12px rgba(15, 23, 42, 0.05);
    --shadow-md: 0 8px 24px rgba(15, 23, 42, 0.05);

    /* Radius — pill-first */
    --r-sm:   8px;
    --r-md:   16px;
    --r-lg:   24px;
    --r-xl:   32px;
    --r-full: 9999px;

    /* Animation */
    --ease:            cubic-bezier(0.25, 0.1, 0.25, 1);
    --duration-fast:   150ms;
    --duration-normal: 250ms;

    /* Layout */
    --titlebar-h:    38px;
    --sidebar-w:     180px;
    --context-w:     260px;
    --statusbar-h:   28px;
    --content-max:   720px;
  }

  /* --- Dark Mode --- */
  :global([data-theme="dark"]) {
    --c-canvas:         #0f172a;
    --c-sidebar:        #1e293b;
    --c-surface:        #1e293b;
    --c-surface-raised: #334155;
    --c-border:         rgba(255, 255, 255, 0.06);
    --c-border-strong:  rgba(255, 255, 255, 0.10);
    --c-divider:        rgba(255, 255, 255, 0.06);
    --c-text:           #f1f5f9;
    --c-text-2:         #94a3b8;
    --c-text-3:         #64748b;
    --c-text-inverse:   #0f172a;
    --c-accent:         #2dd4bf;
    --c-accent-hover:   #5eead4;
    --c-accent-subtle:  rgba(45, 212, 191, 0.10);
    --c-success:        #4ade80;
    --c-success-subtle: rgba(74, 222, 128, 0.10);
    --c-warning:        #fbbf24;
    --c-warning-subtle: rgba(251, 191, 36, 0.10);
    --c-error:          #fb7185;
    --c-error-subtle:   rgba(251, 113, 133, 0.10);
    --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.20);
    --shadow-sm: 0 4px 12px rgba(0, 0, 0, 0.25);
    --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.30);
  }

  /* Auto dark mode */
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) {
      --c-canvas: #0f172a; --c-sidebar: #1e293b;
      --c-surface: #1e293b; --c-surface-raised: #334155;
      --c-border: rgba(255,255,255,0.06); --c-border-strong: rgba(255,255,255,0.10);
      --c-divider: rgba(255,255,255,0.06);
      --c-text: #f1f5f9; --c-text-2: #94a3b8; --c-text-3: #64748b;
      --c-text-inverse: #0f172a;
      --c-accent: #2dd4bf; --c-accent-hover: #5eead4;
      --c-accent-subtle: rgba(45,212,191,0.10);
      --c-success: #4ade80; --c-success-subtle: rgba(74,222,128,0.10);
      --c-warning: #fbbf24; --c-warning-subtle: rgba(251,191,36,0.10);
      --c-error: #fb7185; --c-error-subtle: rgba(251,113,133,0.10);
      --shadow-xs: 0 1px 2px rgba(0,0,0,0.20);
      --shadow-sm: 0 4px 12px rgba(0,0,0,0.25);
      --shadow-md: 0 8px 24px rgba(0,0,0,0.30);
    }
  }

  /* ================================================================
     Global Resets & Base
     ================================================================ */

  :global(html) {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    font-feature-settings: "palt" 1;
  }

  :global(body) {
    margin: 0;
    min-height: 100vh;
    color: var(--c-text);
    font-family: var(--font-sans);
    font-size: var(--sz-sm);
    line-height: 1.6;
    font-weight: 400;
    background: var(--c-canvas);
    transition: background-color var(--duration-normal) var(--ease),
                color var(--duration-normal) var(--ease);
  }

  :global(*) { box-sizing: border-box; }

  :global(a) {
    color: var(--c-accent);
    text-decoration: none;
    transition: color var(--duration-fast);
  }
  :global(a:hover) { color: var(--c-accent-hover); }

  :global(button) {
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    border: none;
    background: none;
    padding: 0;
  }

  :global(input, textarea, select) {
    font-family: inherit;
    font-size: inherit;
  }

  :global(::selection) {
    background: var(--c-accent);
    color: white;
  }

  :global(h1, h2, h3, h4) {
    letter-spacing: -0.02em;
    line-height: 1.3;
  }

  :global(:focus-visible) {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    :global(*, *::before, *::after) {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }

  /* ================================================================
     Scrollbar
     ================================================================ */

  :global(::-webkit-scrollbar) { width: 5px; height: 5px; }
  :global(::-webkit-scrollbar-track) { background: transparent; }
  :global(::-webkit-scrollbar-thumb) {
    background: var(--c-border-strong);
    border-radius: var(--r-full);
  }
  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--c-text-3);
  }

  /* ================================================================
     Buttons — all pill-shaped
     ================================================================ */

  :global(.btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-4);
    font-size: var(--sz-sm);
    font-weight: 500;
    line-height: 1.4;
    border-radius: var(--r-full);   /* pill */
    transition: all var(--duration-fast) var(--ease);
    white-space: nowrap;
    user-select: none;
    height: 36px;
  }
  :global(.btn:active:not(:disabled)) { transform: scale(0.97); }
  :global(.btn:disabled) { opacity: 0.45; cursor: not-allowed; }

  :global(.btn-primary) {
    background: var(--c-accent);
    color: white;
  }
  :global(.btn-primary:hover:not(:disabled)) { background: var(--c-accent-hover); }

  :global(.btn-secondary) {
    background: var(--c-surface);
    color: var(--c-text);
    border: 1px solid var(--c-border-strong);
  }
  :global(.btn-secondary:hover:not(:disabled)) {
    border-color: var(--c-accent);
    color: var(--c-accent);
  }

  :global(.btn-ghost) {
    background: transparent;
    color: var(--c-text-2);
  }
  :global(.btn-ghost:hover:not(:disabled)) {
    background: var(--c-border);
    color: var(--c-text);
  }

  :global(.btn-danger) {
    background: var(--c-error);
    color: white;
  }
  :global(.btn-danger:hover:not(:disabled)) { filter: brightness(1.1); }

  :global(.btn-sm) {
    padding: var(--sp-1) var(--sp-3);
    font-size: var(--sz-xs);
    height: 28px;
  }

  :global(.btn-icon) {
    padding: var(--sp-2);
    border-radius: var(--r-full);
    width: 32px;
    height: 32px;
  }

  /* ================================================================
     Inputs
     ================================================================ */

  :global(.input) {
    display: block;
    width: 100%;
    padding: var(--sp-2) var(--sp-3);
    font-size: var(--sz-sm);
    line-height: 1.5;
    color: var(--c-text);
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-md);
    transition: border-color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
  }
  :global(.input:focus) {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-subtle);
  }
  :global(.input::placeholder) { color: var(--c-text-3); }
  :global(.input:disabled) { opacity: 0.6; cursor: not-allowed; background: var(--c-canvas); }

  :global(.textarea) {
    display: block;
    width: 100%;
    padding: var(--sp-3);
    font-size: var(--sz-sm);
    line-height: 1.6;
    color: var(--c-text);
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-md);
    resize: vertical;
    min-height: 5rem;
    transition: border-color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
  }
  :global(.textarea:focus) {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-subtle);
  }

  :global(.select) {
    display: block;
    width: 100%;
    padding: var(--sp-2) var(--sp-3);
    font-size: var(--sz-sm);
    color: var(--c-text);
    background: var(--c-surface);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-md);
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--sp-3) center;
    padding-right: var(--sp-8);
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
  }
  :global(.select:focus) {
    outline: none;
    border-color: var(--c-accent);
    box-shadow: 0 0 0 3px var(--c-accent-subtle);
  }

  /* ================================================================
     Cards
     ================================================================ */

  :global(.card) {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--r-md);
    padding: var(--sp-4);
    box-shadow: var(--shadow-sm);
  }

  /* ================================================================
     Badges
     ================================================================ */

  :global(.badge) {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    padding: 2px var(--sp-2);
    font-size: var(--sz-xs);
    font-weight: 500;
    line-height: 1.5;
    border-radius: var(--r-full);
    white-space: nowrap;
  }
  :global(.badge-neutral) { background: var(--c-border); color: var(--c-text-2); }
  :global(.badge-accent)  { background: var(--c-accent-subtle); color: var(--c-accent); }
  :global(.badge-success) { background: var(--c-success-subtle); color: var(--c-success); }
  :global(.badge-warning) { background: var(--c-warning-subtle); color: var(--c-warning); }
  :global(.badge-error)   { background: var(--c-error-subtle); color: var(--c-error); }
  :global(.badge-tool) {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    background: var(--c-border);
    color: var(--c-text-2);
  }

  /* ================================================================
     Alerts
     ================================================================ */

  :global(.alert) {
    padding: var(--sp-3) var(--sp-4);
    border-radius: var(--r-sm);
    border: 1px solid;
    border-left-width: 3px;
    font-size: var(--sz-sm);
    line-height: 1.5;
  }
  :global(.alert-info)    { background: var(--c-accent-subtle);  border-color: var(--c-accent);  color: var(--c-accent); }
  :global(.alert-success) { background: var(--c-success-subtle); border-color: var(--c-success); color: var(--c-success); }
  :global(.alert-warning) { background: var(--c-warning-subtle); border-color: var(--c-warning); color: var(--c-warning); }
  :global(.alert-error)   { background: var(--c-error-subtle);   border-color: var(--c-error);   color: var(--c-error); }

  /* ================================================================
     Spinner
     ================================================================ */

  :global(.spinner) {
    width: 14px;
    height: 14px;
    border: 2px solid var(--c-border-strong);
    border-top-color: var(--c-accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes -global-spin { to { transform: rotate(360deg); } }

  /* ================================================================
     Status Dot — with ping animation
     ================================================================ */

  :global(.dot) {
    display: inline-block;
    position: relative;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--c-text-3);
  }
  :global(.dot-accent)   { background: var(--c-accent); }
  :global(.dot-success)  { background: var(--c-success); }
  :global(.dot-error)    { background: var(--c-error); }
  :global(.dot-warning)  { background: var(--c-warning); }
  :global(.dot-offline)  {
    background: transparent;
    border: 1.5px dashed var(--c-border-strong);
  }

  /* Ping animation ring */
  :global(.dot-ping::before) {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    background: inherit;
    opacity: 0.35;
    animation: ping 2s ease-out infinite;
  }
  :global(.dot-ping-fast::before) {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    background: inherit;
    opacity: 0.35;
    animation: ping 1s ease-out infinite;
  }

  @keyframes -global-ping {
    0%   { transform: scale(1);   opacity: 0.35; }
    70%  { transform: scale(2.4); opacity: 0; }
    100% { transform: scale(2.4); opacity: 0; }
  }

  /* ================================================================
     Section Labels — uppercase 11px (openwork style)
     ================================================================ */

  :global(.label-section) {
    display: block;
    font-size: var(--sz-2xs);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--c-text-3);
    padding: var(--sp-3) var(--sp-3) var(--sp-1);
  }

  /* ================================================================
     Segmented Control — white pill track
     ================================================================ */

  :global(.seg-track) {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--c-border);
    border: 1px solid var(--c-border-strong);
    border-radius: var(--r-full);
  }

  :global(.seg-item) {
    padding: 4px 12px;
    font-size: var(--sz-sm);
    font-weight: 400;
    color: var(--c-text-2);
    border-radius: var(--r-full);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease),
                color var(--duration-fast) var(--ease),
                box-shadow var(--duration-fast) var(--ease);
    white-space: nowrap;
    user-select: none;
  }
  :global(.seg-item:hover:not(.seg-item-active)) {
    color: var(--c-text);
  }
  :global(.seg-item-active) {
    background: var(--c-surface);
    color: var(--c-text);
    font-weight: 500;
    box-shadow: var(--shadow-xs);
  }

  /* ================================================================
     Divider
     ================================================================ */

  :global(.divider) {
    height: 1px;
    background: var(--c-divider);
    border: none;
    margin: var(--sp-4) 0;
  }

  /* ================================================================
     Field Label
     ================================================================ */

  :global(.field-label) {
    display: block;
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text-2);
    margin-bottom: var(--sp-1);
  }

  /* ================================================================
     Modal
     ================================================================ */

  :global(.modal-overlay) {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.18);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 900;
    animation: fade-in var(--duration-normal) var(--ease);
  }
  :global(.modal) {
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-md);
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    animation: slide-up var(--duration-normal) var(--ease);
  }

  @keyframes -global-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes -global-slide-up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ================================================================
     App Shell — 3-pane layout
     ================================================================ */

  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  /* Titlebar region (Tauri drag area) */
  :global(.titlebar) {
    height: var(--titlebar-h, 38px);
    background: var(--c-sidebar);
    border-bottom: 1px solid var(--c-border);
    display: flex;
    align-items: center;
    padding: 0 var(--sp-3);
    flex-shrink: 0;
    -webkit-app-region: drag;
    user-select: none;
  }
  :global(.titlebar-no-drag) {
    -webkit-app-region: no-drag;
  }

  /* Workspace row — sidebar + main + context */
  :global(.workspace) {
    display: grid;
    grid-template-columns: var(--sidebar-w, 180px) 1fr;
    grid-template-rows: 1fr;
    flex: 1;
    overflow: hidden;
  }

  :global(.workspace.show-context) {
    grid-template-columns: var(--sidebar-w, 180px) 1fr var(--context-w, 260px);
  }

  :global(.workspace.hide-sidebar) {
    grid-template-columns: 0 1fr;
  }

  :global(.workspace.hide-sidebar.show-context) {
    grid-template-columns: 0 1fr var(--context-w, 260px);
  }

  /* Main content column */
  :global(.main-col) {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--c-canvas);
  }

  /* Feed scroll area */
  :global(.feed-scroll) {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-4) var(--sp-4) 0;
  }

  /* Composer area pinned at bottom of main-col */
  :global(.composer-area) {
    padding: var(--sp-2) var(--sp-4) var(--sp-4);
    background: var(--c-canvas);
    flex-shrink: 0;
  }

  /* Status bar */
  :global(.statusbar) {
    height: var(--statusbar-h, 28px);
    background: var(--c-sidebar);
    border-top: 1px solid var(--c-border);
    display: flex;
    align-items: center;
    padding: 0 var(--sp-3);
    flex-shrink: 0;
    font-size: var(--sz-xs);
    color: var(--c-text-3);
  }

  /* Responsive: hide context panel below 1200px */
  @media (max-width: 1199px) {
    :global(.workspace.show-context) {
      grid-template-columns: var(--sidebar-w, 180px) 1fr;
    }
    :global(.context-panel-wrap) {
      display: none;
    }
  }

  /* Responsive: hide sidebar below 768px */
  @media (max-width: 767px) {
    :global(.workspace),
    :global(.workspace.show-context) {
      grid-template-columns: 1fr;
    }
    :global(.sidebar-wrap) {
      display: none;
    }
  }
</style>
