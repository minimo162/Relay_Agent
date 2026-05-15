import test from "node:test";
import assert from "node:assert/strict";

import { getCopilotPromptTiming } from "./copilot_send_timing.mjs";

test("getCopilotPromptTiming shortens the no-attachment fast path", () => {
  assert.deepEqual(getCopilotPromptTiming(), {
    fastInline: true,
    composerReadyDelayMs: 240,
    afterClearDelayMs: 40,
    afterRefocusDelayMs: 90,
    postPasteDelayMs: 420,
    sendButtonStableMs: 700,
    submitConfirmDelayMs: 950,
  });
});

test("getCopilotPromptTiming keeps the attachment safety delays", () => {
  assert.deepEqual(getCopilotPromptTiming({ hadAttachments: true }), {
    fastInline: false,
    composerReadyDelayMs: 520,
    afterClearDelayMs: 120,
    afterRefocusDelayMs: 160,
    postPasteDelayMs: 360,
    sendButtonStableMs: 900,
    submitConfirmDelayMs: 900,
  });
});
