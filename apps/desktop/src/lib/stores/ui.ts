import { writable, derived } from "svelte/store";

// --- Navigation ---
export type NavView = "home" | "pipeline" | "batch" | "template" | "sessions" | "settings";

export const activeView = writable<NavView>("home");
export const sidebarVisible = writable(false);
export const settingsOpen = writable(false);

// --- Theme ---
export const darkMode = writable(false);

export function initTheme() {
  const saved = localStorage.getItem("ra-theme");
  if (saved === "dark") {
    darkMode.set(true);
    document.documentElement.setAttribute("data-theme", "dark");
  } else if (saved === "light") {
    darkMode.set(false);
    document.documentElement.setAttribute("data-theme", "light");
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    darkMode.set(true);
  }
}

export function toggleTheme() {
  darkMode.update((v) => {
    const next = !v;
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("ra-theme", next ? "dark" : "light");
    return next;
  });
}

// --- Toast ---
export type ToastItem = {
  id: string;
  message: string;
  type: "success" | "error" | "info";
};

export const toasts = writable<ToastItem[]>([]);

export function addToast(message: string, type: ToastItem["type"] = "info") {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  toasts.update((t) => [...t, { id, message, type }]);
  setTimeout(() => {
    toasts.update((t) => t.filter((item) => item.id !== id));
  }, 4000);
}

export function dismissToast(id: string) {
  toasts.update((t) => t.filter((item) => item.id !== id));
}

// --- Command Palette ---
export const commandPaletteOpen = writable(false);
