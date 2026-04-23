import test from "node:test";
import assert from "node:assert/strict";

import { shouldStartNewChatForRequest } from "./copilot_server.js";

test("shouldStartNewChatForRequest opens a new chat only for uninitialized or forced fresh-chat cases", () => {
  assert.equal(
    shouldStartNewChatForRequest({
      relaySessionInitialized: false,
    }),
    true,
  );
  assert.equal(
    shouldStartNewChatForRequest({
      relaySessionInitialized: true,
    }),
    false,
  );
  assert.equal(
    shouldStartNewChatForRequest({
      probeMode: true,
      relaySessionInitialized: true,
    }),
    true,
  );
  assert.equal(
    shouldStartNewChatForRequest({
      relayForceFreshChat: true,
      relaySessionInitialized: true,
    }),
    true,
  );
});

test("shouldStartNewChatForRequest ignores relayNewChat once a session is initialized", () => {
  assert.equal(
    shouldStartNewChatForRequest({
      relayNewChat: true,
      relaySessionInitialized: true,
      repairStage: true,
      repairReplayUsed: false,
    }),
    false,
  );
  assert.equal(
    shouldStartNewChatForRequest({
      relayNewChat: true,
      relaySessionInitialized: true,
      repairStage: false,
    }),
    false,
  );
  assert.equal(
    shouldStartNewChatForRequest({
      relaySessionInitialized: true,
      repairStage: true,
      repairReplayUsed: true,
    }),
    true,
  );
});
