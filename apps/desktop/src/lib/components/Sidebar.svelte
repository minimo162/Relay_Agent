<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let activeView: string = "home";
  export let collapsed: boolean = false;
  export let projectName: string = "";
  export let darkMode: boolean = false;

  const dispatch = createEventDispatcher<{
    navigate: { view: string };
    toggleCollapse: void;
    toggleTheme: void;
  }>();

  type NavSection = {
    label: string;
    items: { id: string; label: string; icon: string }[];
  };

  const navSections: NavSection[] = [
    {
      label: "メイン",
      items: [
        { id: "home", label: "ホーム", icon: "home" },
      ],
    },
    {
      label: "自動化",
      items: [
        { id: "pipeline", label: "パイプライン", icon: "pipeline" },
        { id: "batch", label: "バッチ", icon: "batch" },
        { id: "template", label: "テンプレート", icon: "template" },
      ],
    },
    {
      label: "履歴",
      items: [
        { id: "sessions", label: "セッション", icon: "sessions" },
      ],
    },
  ];

  function handleNavigate(view: string) {
    dispatch("navigate", { view });
  }
</script>

<aside class="sidebar" class:collapsed>
  <!-- Header -->
  <div class="sidebar-header">
    {#if !collapsed}
      <div class="sidebar-brand">
        <div class="brand-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2 L22 8.5 L22 15.5 L12 22 L2 15.5 L2 8.5 Z" />
            <path d="M12 22 L12 15.5" />
            <path d="M22 8.5 L12 15.5 L2 8.5" />
          </svg>
        </div>
        <span class="brand-name">Relay Agent</span>
      </div>
    {:else}
      <div class="brand-icon brand-icon-only">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2 L22 8.5 L22 15.5 L12 22 L2 15.5 L2 8.5 Z" />
          <path d="M12 22 L12 15.5" />
          <path d="M22 8.5 L12 15.5 L2 8.5" />
        </svg>
      </div>
    {/if}
  </div>

  <!-- Project -->
  {#if !collapsed && projectName}
    <div class="sidebar-project">
      <span class="project-name">{projectName}</span>
    </div>
  {/if}

  <!-- Navigation sections -->
  <nav class="sidebar-nav">
    {#each navSections as section}
      {#if !collapsed}
        <div class="section-label">{section.label}</div>
      {:else}
        <div class="section-divider"></div>
      {/if}
      {#each section.items as item (item.id)}
        <button
          class="nav-item"
          class:active={activeView === item.id}
          on:click={() => handleNavigate(item.id)}
          data-tooltip={collapsed ? item.label : undefined}
          aria-label={item.label}
          aria-current={activeView === item.id ? "page" : undefined}
        >
          <span class="nav-icon">
            {#if item.icon === "home"}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
                <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            {:else if item.icon === "pipeline"}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="6" height="6" rx="1" />
                <rect x="15" y="3" width="6" height="6" rx="1" />
                <rect x="9" y="15" width="6" height="6" rx="1" />
                <path d="M6 9v3a1 1 0 0 0 1 1h4" />
                <path d="M18 9v3a1 1 0 0 1-1 1h-4" />
                <path d="M12 13v2" />
              </svg>
            {:else if item.icon === "batch"}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M9 9h6" />
                <path d="M9 13h6" />
                <path d="M9 17h4" />
              </svg>
            {:else if item.icon === "template"}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
              </svg>
            {:else if item.icon === "sessions"}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            {/if}
          </span>
          {#if !collapsed}
            <span class="nav-label">{item.label}</span>
          {/if}
        </button>
      {/each}
    {/each}
  </nav>

  <!-- Footer -->
  <div class="sidebar-footer">
    <div class="footer-divider"></div>

    <!-- Settings -->
    <button
      class="nav-item"
      class:active={activeView === "settings"}
      on:click={() => handleNavigate("settings")}
      data-tooltip={collapsed ? "設定" : undefined}
      aria-label="設定"
    >
      <span class="nav-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </span>
      {#if !collapsed}
        <span class="nav-label">設定</span>
      {/if}
    </button>

    <!-- Theme segment control -->
    {#if !collapsed}
      <div class="theme-segment">
        <button
          class="theme-option"
          class:active={!darkMode}
          on:click={() => { if (darkMode) dispatch("toggleTheme"); }}
          aria-label="ライトモード"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" /><path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" /><path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
          </svg>
          <span>ライト</span>
        </button>
        <button
          class="theme-option"
          class:active={darkMode}
          on:click={() => { if (!darkMode) dispatch("toggleTheme"); }}
          aria-label="ダークモード"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
          <span>ダーク</span>
        </button>
      </div>
    {:else}
      <button
        class="nav-item"
        on:click={() => dispatch("toggleTheme")}
        data-tooltip={darkMode ? "ライトモード" : "ダークモード"}
        aria-label={darkMode ? "ライトモードに切替" : "ダークモードに切替"}
      >
        <span class="nav-icon">
          {#if darkMode}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" /><path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" /><path d="M20 12h2" />
              <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
            </svg>
          {:else}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          {/if}
        </span>
      </button>
    {/if}

    <!-- Collapse toggle -->
    <button
      class="nav-item collapse-toggle"
      on:click={() => dispatch("toggleCollapse")}
      aria-label={collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}
    >
      <span class="nav-icon" class:rotated={collapsed}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </span>
      {#if !collapsed}
        <span class="nav-label">折りたたむ</span>
      {/if}
    </button>
  </div>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    background: rgba(244,241,237,0.80);
    backdrop-filter: blur(24px) saturate(190%);
    border-right: 1px solid var(--c-divider);
    width: var(--sidebar-w);
    height: 100vh;
    position: sticky;
    top: 0;
    overflow-x: hidden;
    overflow-y: auto;
    transition: width var(--duration-slow) var(--ease);
    z-index: 100;
  }

  .sidebar.collapsed {
    width: var(--sidebar-collapsed);
  }

  /* Header */
  .sidebar-header {
    padding: var(--sp-4);
    min-height: 56px;
    display: flex;
    align-items: center;
  }

  .sidebar-brand {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    overflow: hidden;
  }

  .brand-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    color: var(--c-accent);
  }

  .brand-icon-only {
    margin: 0 auto;
  }

  .brand-name {
    font-size: var(--sz-lg);
    font-weight: 700;
    color: var(--c-text);
    white-space: nowrap;
    letter-spacing: -0.02em;
  }

  /* Project */
  .sidebar-project {
    padding: 0 var(--sp-4) var(--sp-3);
    overflow: hidden;
  }

  .project-name {
    display: block;
    font-size: var(--sz-sm);
    font-weight: 500;
    color: var(--c-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Navigation */
  .sidebar-nav {
    flex: 1;
    padding: var(--sp-2);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .section-label {
    font-size: var(--sz-2xs);
    color: var(--c-text-3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 500;
    padding: var(--sp-3) var(--sp-3) var(--sp-1);
  }

  .section-divider {
    height: 1px;
    background: var(--c-divider);
    margin: var(--sp-2) var(--sp-3);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-md);
    color: var(--c-text-2);
    font-size: var(--sz-sm);
    font-weight: 400;
    cursor: pointer;
    transition: all var(--duration-instant);
    white-space: nowrap;
    overflow: hidden;
    position: relative;
    border: none;
    background: none;
    width: 100%;
    text-align: left;
  }

  .nav-item:hover {
    background: rgba(0, 0, 0, 0.04);
    color: var(--c-text);
  }

  :global([data-theme="dark"]) .nav-item:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .nav-item.active {
    background: var(--c-accent-subtle);
    color: var(--c-accent);
    font-weight: 500;
  }

  .nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    transition: transform var(--duration-normal) var(--ease);
  }

  .nav-icon.rotated {
    transform: rotate(180deg);
  }

  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Footer */
  .sidebar-footer {
    padding: var(--sp-2);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .footer-divider {
    height: 1px;
    background: var(--c-divider);
    margin: 0 var(--sp-2) var(--sp-2);
  }

  /* Theme segment control */
  .theme-segment {
    display: flex;
    background: #f0eeea;
    border-radius: var(--r-md);
    padding: 3px;
    gap: 2px;
    margin: var(--sp-1) var(--sp-1);
  }

  .theme-option {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-2);
    font-size: var(--sz-xs);
    color: var(--c-text-2);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: all var(--duration-normal) var(--ease);
    border: none;
    background: transparent;
    white-space: nowrap;
  }

  .theme-option.active {
    background: var(--c-surface);
    color: var(--c-text);
    font-weight: 500;
    box-shadow: var(--shadow-sm);
  }

  /* Collapsed sidebar tooltips */
  .sidebar.collapsed .nav-item[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    left: calc(100% + var(--sp-2));
    top: 50%;
    transform: translateY(-50%);
    padding: var(--sp-1) var(--sp-2);
    font-size: var(--sz-xs);
    font-weight: 500;
    color: var(--c-text-inverse);
    background: var(--c-text);
    border-radius: var(--r-sm);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--duration-fast);
    z-index: 1000;
  }

  .sidebar.collapsed .nav-item[data-tooltip]:hover::after {
    opacity: 1;
  }

  .sidebar.collapsed .nav-item {
    justify-content: center;
    padding: var(--sp-2);
  }
</style>
