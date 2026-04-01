import test from "node:test";
import assert from "node:assert/strict";

import {
  extractActionFilePaths,
  isWithinProjectScope,
  validateProjectScopeActions
} from "./project-scope";

test("isWithinProjectScope handles Windows paths case-insensitively", () => {
  assert.equal(
    isWithinProjectScope(
      "C:\\Workspace\\Revenue\\exports\\result.csv",
      "c:\\workspace\\revenue"
    ),
    true
  );
});

test("extractActionFilePaths returns supported path arguments only", () => {
  assert.deepEqual(
    extractActionFilePaths({
      tool: "file.copy",
      args: {
        sourcePath: "/workspace/revenue/input.csv",
        destPath: "/workspace/revenue/output.csv",
        ignored: 42
      }
    }),
    ["/workspace/revenue/input.csv", "/workspace/revenue/output.csv"]
  );
});

test("validateProjectScopeActions deduplicates out-of-scope paths", () => {
  assert.deepEqual(
    validateProjectScopeActions(
      [
        {
          tool: "file.copy",
          args: {
            sourcePath: "/workspace/revenue/input.csv",
            destPath: "/tmp/outside.csv"
          }
        },
        {
          tool: "workbook.save_copy",
          args: {
            outputPath: "/tmp/outside.csv"
          }
        }
      ],
      "/workspace/revenue"
    ),
    ["/tmp/outside.csv"]
  );
});
