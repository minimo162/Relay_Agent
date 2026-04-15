import { createSignal, type JSX, Show } from "solid-js";
import { Button, Textarea } from "./ui";
import type { UiUserQuestionChunk } from "../lib/ipc";

function questionStateLabel(status: UiUserQuestionChunk["status"]): string {
  switch (status) {
    case "answered":
      return "Answered";
    case "cancelled":
      return "Cancelled";
    case "pending":
    default:
      return "Input required";
  }
}

export function InlineQuestionCard(props: {
  chunk: UiUserQuestionChunk;
  onSubmit: (questionId: string, answer: string) => void;
  onCancel: (questionId: string) => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal("");
  const pending = () => props.chunk.status === "pending";

  return (
    <section
      class="ra-inline-card ra-inline-card--question"
      data-ra-user-question-card
      data-status={props.chunk.status}
      data-question-id={props.chunk.questionId}
      aria-label="Agent question"
    >
      <div class="ra-inline-card__eyebrow">
        <span class="ra-inline-card__title">Agent question</span>
        <span class="ra-inline-card__status">{questionStateLabel(props.chunk.status)}</span>
      </div>
      <pre class="ra-type-body-sans whitespace-pre-wrap text-[var(--ra-text-primary)] leading-snug m-0">
        {props.chunk.prompt}
      </pre>
      <Show
        when={pending()}
        fallback={
          <p class="ra-inline-card__note">
            {props.chunk.status === "answered"
              ? "Your answer was sent to Relay."
              : "The question was skipped."}
          </p>
        }
      >
        <Textarea
          class="ra-inline-question__textarea"
          placeholder="Your answer…"
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <div class="ra-inline-card__actions">
          <Button
            variant="secondary"
            type="button"
            class="ra-type-button-label px-3 py-1.5"
            onClick={() => props.onCancel(props.chunk.questionId)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            class="ra-type-button-label px-3 py-1.5"
            disabled={draft().trim().length === 0}
            onClick={() => props.onSubmit(props.chunk.questionId, draft().trim())}
          >
            Submit answer
          </Button>
        </div>
      </Show>
    </section>
  );
}
