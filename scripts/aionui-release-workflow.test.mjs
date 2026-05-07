import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflowPath = resolve(".github/workflows/release-aionui-windows-installer.yml");
const manifestPath = resolve("apps/desktop/src-tauri/bootstrap/aionui-relay.json");

function workflow() {
  return readFileSync(workflowPath, "utf8");
}

function manifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

test("AionUi release workflow checks out the pinned upstream baseline", () => {
  const text = workflow();
  const pinned = manifest().upstreams.aionUi;

  assert.match(text, /name: release-aionui-windows-installer/);
  assert.match(text, /runs-on: windows-latest/);
  assert.match(text, new RegExp(`AIONUI_TAG: ${pinned.tag}`));
  assert.match(text, new RegExp(`AIONUI_COMMIT: ${pinned.commit}`));
  assert.match(text, /git clone --branch "\$AIONUI_TAG" --depth 1 "\$AIONUI_REPOSITORY" aionui/);
  assert.match(text, /AionUi baseline drift/);
});

test("AionUi release workflow installs pinned dependencies before overlay and builds after overlay", () => {
  const text = workflow();
  const installIndex = text.indexOf("bun install --frozen-lockfile");
  const overlayIndex = text.indexOf("node scripts/apply-aionui-overlay.mjs --aionui-dir aionui");
  const buildIndex = text.indexOf("bun run build-win:x64");

  assert.ok(installIndex > 0, "workflow should install pinned upstream dependencies");
  assert.ok(overlayIndex > installIndex, "workflow should apply Relay overlay after frozen install");
  assert.ok(buildIndex > overlayIndex, "workflow should build after overlay");
  assert.match(text, /Where-Object \{ \$_.Name -like "Relay Agent-\*-win-x64.exe" \}/);
});

test("AionUi release workflow publishes signed or clearly marked prerelease assets", () => {
  const text = workflow();

  assert.match(text, /azure\/artifact-signing-action@v1/);
  assert.match(text, /windows-self-sign-installer\.ps1/);
  assert.match(text, /self-signed for smoke testing only/);
  assert.match(text, /\$unsignedName = "\$stem-unsigned\.exe"/);
  assert.match(text, /gh release upload \$env:RELEASE_TAG @assets --clobber/);
  assert.match(text, /gh @args/);
});
