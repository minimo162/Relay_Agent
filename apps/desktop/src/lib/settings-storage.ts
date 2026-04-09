import type { BrowserAutomationSettings } from "./ipc";

const LS_WORKSPACE = "relay.settings.workspacePath";
const LS_BROWSER = "relay.settings.browser";
const LS_MAX_TURNS = "relay.settings.maxTurns";
/** When unset, tool steps show inline in the chat stream (OpenWork-style default). */
const LS_SHOW_TOOL_ACTIVITY = "relay.showToolActivity";

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

export function loadShowToolActivityInChat(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    const v = localStorage.getItem(LS_SHOW_TOOL_ACTIVITY);
    if (v === "0") return false;
    if (v === "1") return true;
    return true;
  } catch {
    return true;
  }
}

export function saveShowToolActivityInChat(on: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_SHOW_TOOL_ACTIVITY, on ? "1" : "0");
    }
  } catch {
    /* ignore */
  }
}
