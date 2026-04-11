import { type JSX } from "solid-js";
import { ui } from "../lib/ui-tokens";

export function StatusBar(props: {
  copilotBridgeHint?: string | null;
  /** Short success line (e.g. after Copilot warmup); shown when no error/login hint. */
  copilotSuccessFlash?: string | null;
  onRetryCopilot?: () => void;
  copilotRetryDisabled?: boolean;
}): JSX.Element {
  const hint = props.copilotBridgeHint?.trim();
  const successFlash = props.copilotSuccessFlash?.trim();
  const footerExtra = hint || successFlash;

  return (
    <footer
      class={`ra-shell-footer px-3 py-1 flex flex-col gap-0.5 ra-type-button-label ${ui.mutedText}`}
      style={{ "min-height": footerExtra ? "36px" : "28px" }}
    >
      <div class="flex items-center gap-2 w-full flex-wrap">
        <span class="text-[var(--ra-text-muted)]">Agent hints</span>
        <span class="mx-auto" />
        {props.onRetryCopilot ? (
          <button
            type="button"
            class="ra-type-caption text-[var(--ra-text-muted)] hover:text-[var(--ra-text-primary)] underline-offset-2 hover:underline disabled:opacity-40 disabled:pointer-events-none"
            disabled={props.copilotRetryDisabled}
            onClick={() => props.onRetryCopilot?.()}
            data-ra-copilot-reconnect
          >
            Reconnect Copilot
          </button>
        ) : null}
      </div>
      {hint ? (
        <div
          role="status"
          data-ra-copilot-warmup-hint
          class="w-full truncate text-[var(--ra-accent)] opacity-95"
          title={hint}
        >
          {hint}
        </div>
      ) : successFlash ? (
        <div
          role="status"
          data-ra-copilot-warmup-success
          class="w-full truncate text-[var(--ra-text-secondary)] opacity-90"
          title={successFlash}
        >
          {successFlash}
        </div>
      ) : null}
    </footer>
  );
}
