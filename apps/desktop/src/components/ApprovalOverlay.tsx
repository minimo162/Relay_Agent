import { For, Show, type JSX } from "solid-js";
import { Button } from "./ui";
import type { Approval } from "./shell-types";

export function ApprovalOverlay(props: {
  approvals: Approval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}): JSX.Element {
  return (
    <Show when={props.approvals.length > 0}>
      <div class="absolute inset-0 z-10" role="dialog" aria-modal="true" aria-label="Permission required">
        <div class="ra-modal-backdrop absolute inset-0" aria-hidden />
        <div class="absolute inset-x-0 bottom-0 p-4 z-10 flex justify-center pointer-events-none">
          <div class="w-full max-w-2xl max-h-[min(50vh,28rem)] overflow-y-auto pointer-events-auto">
          <For each={props.approvals}>
            {(approval) => (
              <div class="ra-modal-panel mb-3 last:mb-0">
                <p class="ra-modal-panel__title">Permission required</p>
                <p class="text-sm font-medium text-[var(--ra-text-primary)] leading-snug">
                  {approval.description}
                </p>
                <details class="mt-3">
                  <summary class="text-[11px] text-[var(--ra-text-muted)] cursor-pointer select-none">
                    Technical details
                  </summary>
                  <p class="text-[11px] text-[var(--ra-text-muted)] mt-1 font-mono break-all">
                    {approval.toolName}
                  </p>
                  <Show when={approval.target}>
                    <p class="text-[11px] text-[var(--ra-text-muted)] mt-0.5 font-mono break-all">
                      {approval.target}
                    </p>
                  </Show>
                </details>
                <div class="flex gap-2 mt-4 justify-end">
                  <Button
                    variant="secondary"
                    onClick={() => props.onReject(approval.approvalId)}
                    class="px-4 py-1.5 text-xs"
                  >
                    Don&apos;t allow
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => props.onApprove(approval.approvalId)}
                    class="px-4 py-1.5 text-xs"
                  >
                    Allow
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
