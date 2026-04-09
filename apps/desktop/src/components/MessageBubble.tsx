import { Show, createMemo, createSignal, type JSX } from "solid-js";
import { IconButton } from "./ui";
import { assistantMarkdownToSafeHtml } from "../lib/assistant-markdown";
import { ui } from "../lib/ui-tokens";

const COLLAPSE_CHAR_THRESHOLD = 480;

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 8V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2M8 8H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2M8 8h10a2 2 0 0 1 2 2v2"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export function MessageBubble(props: { role: "user" | "assistant"; text: string }): JSX.Element {
  const isUser = props.role === "user";
  const [expanded, setExpanded] = createSignal(false);
  const assistantHtml = createMemo(() => assistantMarkdownToSafeHtml(props.text));
  const long = () => props.text.length > COLLAPSE_CHAR_THRESHOLD;
  const collapsed = () => long() && !expanded();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
    } catch {
      /* ignore */
    }
  };

  return (
    <div class={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        class={`group relative max-w-[min(80%,42rem)] rounded-xl text-sm leading-relaxed ${
          isUser
            ? "ra-fill-accent ring-1 ring-inset ring-white/12"
            : `${ui.surfaceElevated} ${ui.border} border text-[var(--ra-text-primary)]`
        }`}
        data-ra-bubble-role={props.role}
      >
        <div
          class={`absolute top-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
            isUser ? "right-1.5" : "right-1.5"
          }`}
        >
          <IconButton
            label="Copy message"
            variant="default"
            class={`!w-7 !h-7 ${isUser ? "!text-white/90 hover:!bg-white/15 hover:!text-white" : ""}`}
            onClick={() => void copy()}
          >
            <CopyIcon />
          </IconButton>
        </div>
        <Show
          when={isUser}
          fallback={
            <div
              class={`ra-md-assistant px-4 py-2.5 break-words text-sm leading-relaxed ${
                collapsed() ? "max-h-48 overflow-hidden" : ""
              }`}
              innerHTML={assistantHtml()}
            />
          }
        >
          <div
            class={`px-4 py-2.5 whitespace-pre-wrap break-words ${
              collapsed() ? "max-h-48 overflow-hidden" : ""
            }`}
          >
            {props.text}
          </div>
        </Show>
        <Show when={long()}>
          <div class="px-4 pb-2 -mt-1">
            <button
              type="button"
              class={`text-xs font-medium underline-offset-2 hover:underline ${
                isUser ? "text-white/90" : "text-[var(--ra-accent)]"
              }`}
              onClick={() => setExpanded(!expanded())}
            >
              {expanded() ? "Show less" : "Show more"}
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
