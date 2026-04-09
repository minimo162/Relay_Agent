import { For, Show, createSignal, type JSX } from "solid-js";
import { Button } from "./ui";
import type { UserQuestion } from "./shell-types";

export function UserQuestionOverlay(props: {
  questions: UserQuestion[];
  onSubmit: (questionId: string, answer: string) => void;
  onCancel: (questionId: string) => void;
}): JSX.Element {
  const [drafts, setDrafts] = createSignal<Record<string, string>>({});

  return (
    <Show when={props.questions.length > 0}>
      <div class="absolute inset-0 z-[11]" role="dialog" aria-modal="true" aria-label="Agent question">
        <div class="ra-modal-backdrop absolute inset-0" aria-hidden />
        <div class="absolute inset-x-0 bottom-0 p-4 z-10 flex justify-center pointer-events-none">
          <div class="w-full max-w-2xl max-h-[min(55vh,32rem)] overflow-y-auto pointer-events-auto">
            <For each={props.questions}>
              {(q) => (
                <div class="ra-modal-panel mb-3 last:mb-0">
                  <p class="ra-modal-panel__title">Agent question</p>
                  <pre class="text-sm font-sans whitespace-pre-wrap text-[var(--ra-text-primary)] leading-snug mt-2">
                    {q.prompt}
                  </pre>
                  <textarea
                    class="mt-3 w-full min-h-[5rem] rounded border border-[var(--ra-border)] bg-[var(--ra-surface)] text-sm p-2 text-[var(--ra-text-primary)]"
                    placeholder="Your answer…"
                    value={drafts()[q.questionId] ?? ""}
                    onInput={(e) =>
                      setDrafts((d) => ({ ...d, [q.questionId]: e.currentTarget.value }))
                    }
                  />
                  <div class="flex flex-wrap gap-2 mt-3 justify-end">
                    <Button
                      variant="secondary"
                      onClick={() => props.onCancel(q.questionId)}
                      class="px-3 py-1.5 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() =>
                        props.onSubmit(q.questionId, (drafts()[q.questionId] ?? "").trim())
                      }
                      class="px-3 py-1.5 text-xs"
                    >
                      Submit answer
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}
