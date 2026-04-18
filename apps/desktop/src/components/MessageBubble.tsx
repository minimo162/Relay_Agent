import { Show, createMemo, createSignal, type JSX } from "solid-js";
import { IconButton } from "./ui";
import { assistantMarkdownToSafeHtml } from "../lib/assistant-markdown";
import { ui } from "../lib/ui-tokens";

const COLLAPSE_CHAR_THRESHOLD = 1400;

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

export function MessageBubble(props: {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}): JSX.Element {
  const isUser = props.role === "user";
  const [expanded, setExpanded] = createSignal(false);
  const assistantHtml = createMemo(() => assistantMarkdownToSafeHtml(props.text));
  const long = () => props.text.length > COLLAPSE_CHAR_THRESHOLD;
  const collapsed = () => !props.streaming && long() && !expanded();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
    } catch {
      /* ignore */
    }
  };

  return (
    <div class={`flex flex-col items-start mb-5 ra-sei-bubble-wrap`}>
      <div class="ra-sei-turn" aria-hidden="true">
        <span class="ra-sei-turn__char">{isUser ? "人" : "相"}</span>
        <span class="ra-sei-turn__who">{isUser ? "you" : "relay"}</span>
      </div>
      <div
        class={`group relative w-full ra-bubble ${isUser ? "ra-bubble-user" : "ra-bubble-assistant"}`}
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
            class={`!w-7 !h-7 ${isUser ? "!text-[var(--ra-text-muted)] hover:!bg-[var(--ra-hover)] hover:!text-[var(--ra-text-primary)]" : ""}`}
            onClick={() => void copy()}
          >
            <CopyIcon />
          </IconButton>
        </div>
        <Show
          when={isUser}
          fallback={
            <>
              <Show when={props.streaming}>
                <div class="px-4 pt-3 pb-0.5">
                  <span class="ra-assistant-streaming-badge">Drafting…</span>
                </div>
              </Show>
              <div
                class={`ra-md-assistant px-4 py-2.5 break-words ${
                  collapsed() ? "max-h-48 overflow-hidden" : ""
                } ${props.streaming ? "pt-2" : ""}`}
                innerHTML={assistantHtml()}
              />
            </>
          }
        >
          <div
            class={`ra-type-body-sans px-4 py-2.5 whitespace-pre-wrap break-words ${
              collapsed() ? "max-h-48 overflow-hidden" : ""
            }`}
          >
            {props.text}
          </div>
        </Show>
        <Show when={long() && !props.streaming}>
          <div class="px-4 pb-2 -mt-1">
            <button
              type="button"
              class={`ra-type-button-label font-normal text-[var(--ra-accent)] underline-offset-2 hover:underline`}
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
