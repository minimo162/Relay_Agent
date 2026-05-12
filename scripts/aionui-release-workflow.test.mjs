import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflowPath = resolve(".github/workflows/release-aionui-windows-installer.yml");
const legacyWorkflowPath = resolve(".github/workflows/release-windows-installer.yml");
const manifestPath = resolve("apps/desktop/src-tauri/bootstrap/aionui-relay.json");

function workflow() {
  return readFileSync(workflowPath, "utf8");
}

function manifest() {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function legacyWorkflow() {
  return readFileSync(legacyWorkflowPath, "utf8");
}

test("AionUi release workflow checks out the pinned upstream baseline", () => {
  const text = workflow();
  const pinned = manifest().upstreams.aionUi;

  assert.match(text, /name: release-windows-installer/);
  assert.match(text, /runs-on: windows-latest/);
  assert.match(text, new RegExp(`AIONUI_TAG: ${pinned.tag}`));
  assert.match(text, new RegExp(`AIONUI_COMMIT: ${pinned.commit}`));
  assert.match(text, /git clone --branch "\$AIONUI_TAG" --depth 1 "\$AIONUI_REPOSITORY" aionui/);
  assert.match(text, /AionUi baseline drift/);
  assert.match(text, /AionUi tag drifted from the Relay manifest/);
  assert.match(text, /AionUi commit drifted from the Relay manifest/);
});

test("AionUi release workflow installs pinned dependencies before overlay and builds after overlay", () => {
  const text = workflow();
  const installIndex = text.indexOf("bun install --frozen-lockfile");
  const ripgrepIndex = text.indexOf("node apps/desktop/scripts/fetch-bundled-ripgrep.mjs");
  const nodeIndex = text.indexOf("node apps/desktop/scripts/fetch-bundled-node.mjs");
  const liteparseIndex = text.indexOf("npm ci --omit=dev --prefix apps/desktop/src-tauri/liteparse-runner");
  const overlayIndex = text.indexOf("node scripts/apply-aionui-overlay.mjs --aionui-dir aionui");
  const validateIndex = text.indexOf("name: Validate Relay overlay");
  const buildIndex = text.indexOf("bun run build-win:x64");

  assert.ok(installIndex > 0, "workflow should install pinned upstream dependencies");
  assert.ok(ripgrepIndex > installIndex, "workflow should fetch bundled ripgrep after frozen install");
  assert.ok(nodeIndex > ripgrepIndex, "workflow should fetch bundled Node after bundled ripgrep");
  assert.ok(liteparseIndex > nodeIndex, "workflow should prepare LiteParse after bundled Node");
  assert.ok(overlayIndex > liteparseIndex, "workflow should apply Relay overlay after PDF search resources are ready");
  assert.ok(validateIndex > overlayIndex, "workflow should validate overlay after applying it");
  assert.ok(buildIndex > validateIndex, "workflow should build after overlay validation");
  assert.match(text, /Relay overlay did not update productName/);
  assert.match(text, /resources\/relay-gateway/);
  assert.match(text, /resources\/relay-tools/);
  assert.match(text, /relay-document-search-mcp-stdio\\\.js/);
  assert.match(text, /Relay document-search MCP statically imports search dependencies before tool registration/);
  assert.match(text, /Relay document-search MCP does not lazy-load search dependencies/);
  assert.match(text, /import\\\('\\\.\/relayDocumentSearchBridge'\\\)/);
  assert.match(text, /import\\\('\\\.\/relayDocumentSearchSyncProducer'\\\)/);
  assert.match(text, /TAURI_ENV_TARGET_TRIPLE: x86_64-pc-windows-msvc/);
  assert.match(text, /relay-tools\\ripgrep\\rg\.exe/);
  assert.match(text, /relay-tools\\node\\relay-node\.exe/);
  assert.match(text, /relay-tools\\liteparse-runner\\parse\.mjs/);
  assert.match(text, /Relay Agent shared-folder search override/);
  assert.match(text, /Relay Agent shared-folder grep override/);
  assert.match(text, /performRelayRipgrepFileListing/);
  assert.match(text, /RELAY_SHARED_SEARCH_PER_BRANCH_LIMIT/);
  assert.match(text, /RELAY_SHARED_SEARCH_NAMES_ONLY_MAX_MATCHES/);
  assert.match(text, /copilot_server\.js/);
  assert.match(text, /isMcpQualifiedRelayDocumentSearchToolName/);
  assert.match(text, /copilot_dom_poll\.mjs/);
  assert.match(text, /copilot_send_timing\.mjs/);
  assert.match(text, /copilot_wait_dom_response\.mjs/);
  assert.match(text, /relayGateway\.ts/);
  assert.match(text, /startRelayGatewayBeforeShell/);
  assert.match(text, /Where-Object \{ \$_.Name -like "Relay Agent-\*-win-x64.exe" \}/);
  assert.match(text, /Installer candidate: \$\(\$_\.Name\)/);
  assert.match(text, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(text, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
});

test("AionUi release workflow validates artifact manifest gate before publishing", () => {
  const text = workflow();
  const digestIndex = text.indexOf("name: Collect installer digest");
  const manifestGateIndex = text.indexOf("name: Validate release artifact manifest gate");
  const publishIndex = text.indexOf("name: Publish installer to GitHub Releases");

  assert.ok(digestIndex > 0, "workflow should collect installer digest");
  assert.ok(manifestGateIndex > digestIndex, "workflow should validate the release manifest after digest collection");
  assert.ok(publishIndex > manifestGateIndex, "workflow should publish only after the manifest gate");
  assert.match(text, /releaseArtifactManifest/);
  assert.match(text, /RelayAionUiReleaseArtifactManifest\.v1/);
  assert.match(text, /primaryArtifactPattern/);
  assert.match(text, /requiredBundledPayloads/);
  assert.match(text, /formalReleaseSigningMode/);
  assert.match(text, /prereleaseSigningModes/);
  assert.match(text, /release-workflow-artifact-manifest-verified/);
  assert.match(text, /Workspace Document Search result-flow contract is missing/);
  assert.match(text, /Installer asset name does not match the Relay-branded Windows x64 pattern/);
  assert.match(text, /Required bundled payload '\$\(\$payload\.id\)' is missing/);
  assert.match(text, /AION02/);
  assert.match(text, /ConvertTo-Json -Depth 20/);
  assert.match(text, /RELEASE_MANIFEST_PATH: \$\{\{ steps\.release_manifest\.outputs\.path \}\}/);
  assert.match(text, /Release manifest: \$env:RELEASE_MANIFEST_NAME/);
});

test("AionUi release workflow publishes signed or clearly marked prerelease assets", () => {
  const text = workflow();

  assert.match(text, /azure\/artifact-signing-action@v1/);
  assert.match(text, /windows-self-sign-installer\.ps1/);
  assert.match(text, /self-signed for smoke testing only/);
  assert.match(text, /\$unsignedName = "\$stem-unsigned\.exe"/);
  assert.match(text, /\$releaseName = \$name -replace '\^Relay Agent-', 'Relay\.Agent-'/);
  assert.match(text, /\$assets = @\(\$env:INSTALLER_PATH, \$env:RELEASE_MANIFEST_PATH\)/);
  assert.match(text, /RELEASE_MANIFEST_NAME: \$\{\{ steps\.release_manifest\.outputs\.name \}\}/);
  assert.match(text, /RELAY_OVERLAY_VERSION: \$\{\{ steps\.release_manifest\.outputs\.overlay_version \}\}/);
  assert.match(text, /gh release upload \$env:RELEASE_TAG @assets --clobber/);
  assert.match(text, /gh @args/);
  assert.match(text, /Manifest schema: \\`\$\{\{ steps\.release_manifest\.outputs\.schema \}\}\\`/);
});

test("legacy Tauri/OpenCode release workflow is manual-only and guarded", () => {
  const text = legacyWorkflow();

  assert.match(text, /name: legacy-release-tauri-windows-installer/);
  assert.doesNotMatch(text, /push:\n\s+tags:/);
  assert.match(text, /confirm_legacy_tauri_release/);
  assert.match(text, /deprecated Tauri\/OpenCode diagnostic installer/);
  assert.match(text, /Use release-windows-installer from release-aionui-windows-installer\.yml/);
});
