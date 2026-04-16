import test from "node:test";
import assert from "node:assert/strict";

import { getCopilotPromptTiming } from "./copilot_send_timing.mjs";

test("getCopilotPromptTiming shortens the no-attachment fast path", () => {
  assert.deepEqual(getCopilotPromptTiming(), {
    fastInline: true,
    composerReadyDelayMs: 120,
    afterClearDelayMs: 40,
    afterRefocusDelayMs: 40,
    postPasteDelayMs: 80,
    sendButtonStableMs: 180,
    submitConfirmDelayMs: 250,
  });
});

test("getCopilotPromptTiming keeps the attachment safety delays", () => {
  assert.deepEqual(getCopilotPromptTiming({ hadAttachments: true }), {
    fastInline: false,
    composerReadyDelayMs: 420,
    afterClearDelayMs: 120,
    afterRefocusDelayMs: 120,
    postPasteDelayMs: 220,
    sendButtonStableMs: 750,
    submitConfirmDelayMs: 700,
  });
});
