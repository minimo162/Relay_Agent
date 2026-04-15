import type { BrowserAutomationSettings } from "./ipc";

const LS_WORKSPACE = "relay.settings.workspacePath";
const LS_BROWSER = "relay.settings.browser";
const LS_MAX_TURNS = "relay.settings.maxTurns";
const LS_ALWAYS_ON_TOP = "relay.settings.window.alwaysOnTop";

const DEFAULT_BROWSER: BrowserAutomationSettings = {
  cdpPort: 9360,
  autoLaunchEdge: true,
  timeoutMs: 120_000,
};

export const DEFAULT_MAX_TURNS = 16;
export function loadWorkspacePath(): string {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(LS_WORKSPACE) ?? "" : "";
  } catch {
    return "";
  }
}

export function saveWorkspacePath(path: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      if (path.trim()) localStorage.setItem(LS_WORKSPACE, path.trim());
      else localStorage.removeItem(LS_WORKSPACE);
    }
  } catch {
    /* ignore */
  }
}

export function loadBrowserSettings(): BrowserAutomationSettings {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_BROWSER };
    const raw = localStorage.getItem(LS_BROWSER);
    if (!raw) return { ...DEFAULT_BROWSER };
    const o = JSON.parse(raw) as Partial<BrowserAutomationSettings>;
    return {
      cdpPort: typeof o.cdpPort === "number" && o.cdpPort > 0 ? o.cdpPort : DEFAULT_BROWSER.cdpPort,
      autoLaunchEdge: typeof o.autoLaunchEdge === "boolean" ? o.autoLaunchEdge : DEFAULT_BROWSER.autoLaunchEdge,
      timeoutMs: typeof o.timeoutMs === "number" && o.timeoutMs > 0 ? o.timeoutMs : DEFAULT_BROWSER.timeoutMs,
    };
  } catch {
    return { ...DEFAULT_BROWSER };
  }
}

export function saveBrowserSettings(s: BrowserAutomationSettings): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_BROWSER, JSON.stringify(s));
    }
  } catch {
    /* ignore */
  }
}

export function loadMaxTurns(): number {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_MAX_TURNS;
    const raw = localStorage.getItem(LS_MAX_TURNS);
    if (!raw) return DEFAULT_MAX_TURNS;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 && n <= 256 ? n : DEFAULT_MAX_TURNS;
  } catch {
    return DEFAULT_MAX_TURNS;
  }
}

export function saveMaxTurns(n: number): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_MAX_TURNS, String(n));
    }
  } catch {
    /* ignore */
  }
}

export function loadAlwaysOnTop(): boolean {
  try {
    const value = typeof localStorage !== "undefined" ? localStorage.getItem(LS_ALWAYS_ON_TOP) : null;
    return value === "1";
  } catch {
    return false;
  }
}

export function saveAlwaysOnTop(enabled: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      if (enabled) localStorage.setItem(LS_ALWAYS_ON_TOP, "1");
      else localStorage.removeItem(LS_ALWAYS_ON_TOP);
    }
  } catch {
    /* ignore */
  }
}
