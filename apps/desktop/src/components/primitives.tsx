import { For, Show, type JSX } from "solid-js";
import { ui } from "../lib/ui-tokens";

export function TabTrack<T extends string>(props: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <div class="ra-tab-track" role="tablist" aria-label={props.ariaLabel ?? "Panel"}>
      <For each={props.tabs}>
        {(tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.active === tab.id}
            id={`ra-tab-${tab.id}`}
            classList={{
              "ra-tab-track__btn": true,
              "ra-tab-track__btn--active": props.active === tab.id,
            }}
            onClick={() => props.onChange(tab.id)}
          >
            {tab.label}
          </button>
        )}
      </For>
    </div>
  );
}

export function EmptyState(props: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}): JSX.Element {
  return (
    <div class="flex h-full min-h-[12rem] items-center justify-center px-4 text-center">
      <div>
        <div class="ra-empty-state__mark" aria-hidden />
        <Show when={props.eyebrow}>
          <p class="ra-empty-state__eyebrow">{props.eyebrow}</p>
        </Show>
        <p class={`text-base font-medium ${ui.textPrimary}`}>{props.title}</p>
        <Show when={props.subtitle}>
          <p class={`text-sm ${ui.mutedText} mt-1 max-w-[18rem] mx-auto leading-relaxed`}>{props.subtitle}</p>
        </Show>
      </div>
    </div>
  );
}

export function ToolStatusDot(props: {
  status: "running" | "done" | "error";
}): JSX.Element {
  return (
    <span
      class={`ra-tool-status ra-tool-status--${props.status}`}
      aria-hidden
      title={props.status === "running" ? "Running" : props.status === "done" ? "Done" : "Error"}
    />
  );
}
