export function getCopilotPromptTiming({ hadAttachments = false } = {}) {
  const withAttachments = hadAttachments === true;
  return {
    fastInline: !withAttachments,
    composerReadyDelayMs: withAttachments ? 520 : 240,
    afterClearDelayMs: withAttachments ? 120 : 40,
    afterRefocusDelayMs: withAttachments ? 160 : 90,
    postPasteDelayMs: withAttachments ? 360 : 420,
    sendButtonStableMs: withAttachments ? 900 : 700,
    submitConfirmDelayMs: withAttachments ? 900 : 950,
  };
}
