import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectContext } from "./prompt-templates";

test("buildProjectContext formats instructions and memory entries", () => {
  const context = buildProjectContext("CSV を優先する", [
    { key: "delimiter", value: "comma" }
  ]);

  assert.match(context, /プロジェクト指示/);
  assert.match(context, /CSV を優先する/);
  assert.match(context, /delimiter: comma/);
});
