import { type JSX } from "solid-js";
import { ui } from "../lib/ui-tokens";

export function MessageBubble(props: { role: "user" | "assistant"; text: string }): JSX.Element {
  const isUser = props.role === "user";
  return (
    <div class={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        class={`max-w-[min(80%,42rem)] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
          isUser
            ? "bg-[var(--ra-accent)] text-white shadow-[0_4px_14px_-6px_rgba(var(--ra-accent-rgb),0.55)]"
            : `${ui.surfaceElevated} ${ui.border} border`
        }`}
        data-ra-bubble-role={props.role}
      >
        {props.text}
      </div>
    </div>
  );
}
