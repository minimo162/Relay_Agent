import { For, Show, type JSX } from "solid-js";
import {
  dismissToast,
  getToasts,
  type StatusToast,
  type StatusToastTone,
} from "../lib/status-toasts";

function glyph(tone: StatusToastTone): JSX.Element {
  if (tone === "ok") {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 8.5 6.5 12 13 4.5" />
      </svg>
    );
  }
  if (tone === "warn") {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 2.5 L14.5 13 L1.5 13 Z" />
        <line x1="8" y1="6.5" x2="8" y2="9.5" />
        <line x1="8" y1="11" x2="8" y2="11.2" />
      </svg>
    );
  }
  if (tone === "danger") {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="8" cy="8" r="6" />
        <line x1="5" y1="5" x2="11" y2="11" />
        <line x1="11" y1="5" x2="5" y2="11" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="8" r="6" />
      <line x1="8" y1="7" x2="8" y2="11.5" />
      <line x1="8" y1="4.5" x2="8" y2="4.7" />
    </svg>
  );
}

export function StatusToasts(): JSX.Element {
  const toasts = getToasts();
  return (
    <div
      class="ra-toast-stack"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      data-ra-toast-stack
    >
      <For each={toasts()}>
        {(toast: StatusToast) => (
          <button
            type="button"
            class={`ra-toast ra-toast--${toast.tone}`}
            data-tone={toast.tone}
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss notification"
          >
            <span class="ra-toast__glyph" aria-hidden="true">
              {glyph(toast.tone)}
            </span>
            <span class="ra-toast__body">
              <span class="ra-toast__message">{toast.message}</span>
              <Show when={toast.detail}>
                <span class="ra-toast__detail">{toast.detail}</span>
              </Show>
            </span>
          </button>
        )}
      </For>
    </div>
  );
}
