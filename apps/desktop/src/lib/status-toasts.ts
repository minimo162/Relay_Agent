/**
 * Status toasts — small ephemeral notifications for confirmations.
 *
 * Module-level signal so any component can call `showToast(...)` without
 * threading context. The <StatusToasts> Solid component renders the live
 * stack; mount it once in the Shell.
 */

import { createSignal } from "solid-js";

export type StatusToastTone = "info" | "ok" | "warn" | "danger";

export interface StatusToast {
  id: number;
  tone: StatusToastTone;
  message: string;
  detail?: string;
  expiresAt: number;
}

export interface ShowToastInput {
  tone: StatusToastTone;
  message: string;
  detail?: string;
  /** Lifetime in ms before auto-dismiss. Defaults to 3500ms (4500 for warn/danger). */
  lifetimeMs?: number;
}

const MAX_STACK = 4;

const [toasts, setToasts] = createSignal<StatusToast[]>([]);
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function getToasts(): () => StatusToast[] {
  return toasts;
}

export function showToast(input: ShowToastInput): number {
  const id = nextId++;
  const lifetime =
    input.lifetimeMs ??
    (input.tone === "warn" || input.tone === "danger" ? 4500 : 3500);
  const toast: StatusToast = {
    id,
    tone: input.tone,
    message: input.message,
    detail: input.detail,
    expiresAt: Date.now() + lifetime,
  };
  setToasts((prev) => {
    const next = [...prev, toast];
    if (next.length > MAX_STACK) return next.slice(next.length - MAX_STACK);
    return next;
  });
  const timer = setTimeout(() => dismissToast(id), lifetime);
  timers.set(id, timer);
  return id;
}

export function dismissToast(id: number): void {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  setToasts((prev) => prev.filter((t) => t.id !== id));
}
