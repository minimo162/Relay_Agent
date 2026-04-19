import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { UiApprovalRequestChunk } from "../lib/ipc";
import type { ApprovalActionHandler } from "./shell-types";

function approvalStateLabel(status: UiApprovalRequestChunk["status"]): string {
  switch (status) {
    case "approved":
      return "Allowed";
    case "rejected":
      return "Not allowed";
    case "pending":
    default:
      return "Needs your approval";
  }
}

export function InlineApprovalCard(props: {
  chunk: UiApprovalRequestChunk;
  onApproveOnce: ApprovalActionHandler;
  onApproveForSession: ApprovalActionHandler;
  onApproveForWorkspace: ApprovalActionHandler;
  onReject: ApprovalActionHandler;
}): JSX.Element {
  const pending = () => props.chunk.status === "pending";
  const [rememberOpen, setRememberOpen] = createSignal(false);
  let rememberRef: HTMLDivElement | undefined;

  onMount(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (!rememberOpen()) return;
      if (rememberRef && !rememberRef.contains(e.target as Node)) {
        setRememberOpen(false);
      }
    };
    document.addEventListener("mousedown", handleDocClick);
    onCleanup(() => document.removeEventListener("mousedown", handleDocClick));
  });

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
        <div class="ra-approval-actions">
          <button
            type="button"
            class="ra-approval-btn ra-approval-btn--primary"
            onClick={() => props.onApproveOnce(props.chunk.sessionId, props.chunk.approvalId)}
          >
            Allow
          </button>
          <button
            type="button"
            class="ra-approval-btn ra-approval-btn--ghost"
            onClick={() => props.onReject(props.chunk.sessionId, props.chunk.approvalId)}
          >
            Reject
          </button>
          <div
            ref={rememberRef}
            class="ra-approval-remember"
            classList={{ "is-open": rememberOpen() }}
          >
            <button
              type="button"
              class="ra-approval-btn ra-approval-btn--ghost ra-approval-remember__trigger"
              aria-expanded={rememberOpen()}
              onClick={() => setRememberOpen((v) => !v)}
            >
              Remember <span aria-hidden="true">▾</span>
            </button>
            <Show when={rememberOpen()}>
              <div class="ra-approval-remember__menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  class="ra-approval-remember__item"
                  onClick={() => {
                    setRememberOpen(false);
                    props.onApproveForSession(props.chunk.sessionId, props.chunk.approvalId);
                  }}
                >
                  Always in this conversation
                </button>
                <Show when={props.chunk.workspaceCwdConfigured}>
                  <button
                    type="button"
                    role="menuitem"
                    class="ra-approval-remember__item"
                    onClick={() => {
                      setRememberOpen(false);
                      props.onApproveForWorkspace(props.chunk.sessionId, props.chunk.approvalId);
                    }}
                  >
                    Always in this project
                  </button>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}
