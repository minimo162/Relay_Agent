/**
 * Preserve the checked-in Copilot DOM helper modules and verify they are present.
 * Run: node build-copilot-dom-modules.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const targets = [
  {
    path: path.join(root, "copilot_dom_poll.mjs"),
    marker: "Shared DOM IIFEs + strips for M365 Copilot",
  },
  {
    path: path.join(root, "copilot_wait_dom_response.mjs"),
    marker: "waitForDomResponse — same logic as copilot_server.js",
  },
];

for (const target of targets) {
  const source = fs.readFileSync(target.path, "utf8");
  if (!source.includes(target.marker)) {
    throw new Error(`unexpected helper module contents: ${path.basename(target.path)}`);
  }
  fs.writeFileSync(target.path, source, "utf8");
}

console.error("Verified copilot_dom_poll.mjs and copilot_wait_dom_response.mjs");
