export function getCopilotPromptTiming({ hadAttachments = false } = {}) {
  const withAttachments = hadAttachments === true;
  return {
    fastInline: !withAttachments,
    composerReadyDelayMs: withAttachments ? 420 : 120,
    afterClearDelayMs: withAttachments ? 120 : 40,
    afterRefocusDelayMs: withAttachments ? 120 : 40,
    postPasteDelayMs: withAttachments ? 220 : 220,
    sendButtonStableMs: withAttachments ? 750 : 420,
    submitConfirmDelayMs: withAttachments ? 700 : 700,
  };
}
