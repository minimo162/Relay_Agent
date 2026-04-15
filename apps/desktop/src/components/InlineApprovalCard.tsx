import { Show, type JSX } from "solid-js";
import { Button } from "./ui";
import type { UiApprovalRequestChunk } from "../lib/ipc";

function approvalStateLabel(status: UiApprovalRequestChunk["status"]): string {
  switch (status) {
    case "approved":
      return "Allowed";
    case "rejected":
      return "Denied";
    case "pending":
    default:
      return "Approval required";
  }
}

export function InlineApprovalCard(props: {
  chunk: UiApprovalRequestChunk;
  onApproveOnce: (approvalId: string) => void;
  onApproveForSession: (approvalId: string) => void;
  onApproveForWorkspace: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
}): JSX.Element {
  const pending = () => props.chunk.status === "pending";

  return (
    <section
      class="ra-inline-card ra-inline-card--approval"
      data-ra-approval-card
      data-status={props.chunk.status}
      data-approval-id={props.chunk.approvalId}
      aria-label="Permission required"
    >
      <div class="ra-inline-card__eyebrow">
        <span class="ra-inline-card__title">Permission required</span>
        <span class="ra-inline-card__status">{approvalStateLabel(props.chunk.status)}</span>
      </div>
      <p class="ra-type-body-sans text-[var(--ra-text-primary)] leading-snug m-0">
        {props.chunk.description}
      </p>
      <div class="ra-inline-card__meta">
        <span class="ra-type-mono-small text-[var(--ra-text-muted)]">{props.chunk.toolName}</span>
        <Show when={props.chunk.target}>
          {(target) => <span class="ra-type-mono-small text-[var(--ra-text-muted)] break-all">{target()}</span>}
        </Show>
      </div>
      <Show
        when={pending()}
        fallback={
          <p class="ra-inline-card__note">
            {props.chunk.status === "approved"
              ? "Relay can continue this step."
              : "Relay will not run this step unless you retry it."}
          </p>
        }
      >
        <div class="ra-inline-card__actions">
          <Button
            variant="secondary"
            type="button"
            class="ra-type-button-label px-3 py-1.5"
            onClick={() => props.onReject(props.chunk.approvalId)}
          >
            Don&apos;t allow
          </Button>
          <Button
            variant="primary"
            type="button"
            class="ra-type-button-label px-3 py-1.5"
            onClick={() => props.onApproveOnce(props.chunk.approvalId)}
          >
            Allow once
          </Button>
        </div>
        <div class="ra-inline-card__remember">
          <span class="ra-type-caption text-[var(--ra-text-muted)]">Remember this choice</span>
          <div class="ra-inline-card__actions">
            <Button
              variant="secondary"
              type="button"
              class="ra-type-button-label px-3 py-1.5"
              onClick={() => props.onApproveForSession(props.chunk.approvalId)}
            >
              Always allow in this conversation
            </Button>
            <Show when={props.chunk.workspaceCwdConfigured}>
              <Button
                variant="secondary"
                type="button"
                class="ra-type-button-label px-3 py-1.5"
                onClick={() => props.onApproveForWorkspace(props.chunk.approvalId)}
              >
                Always allow in this folder
              </Button>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}
