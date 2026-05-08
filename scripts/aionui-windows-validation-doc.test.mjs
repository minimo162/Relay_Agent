import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const validationDoc = readFileSync("docs/AIONUI_WINDOWS_VALIDATION.md", "utf8");
const signingDoc = readFileSync("docs/TRUSTED_SIGNING_SETUP.md", "utf8");
const selfSignedDoc = readFileSync("docs/WINDOWS_SELF_SIGNED_SIGNING.md", "utf8");

test("AionUi Windows validation checklist covers install, provider, OfficeCLI, and Office workflows", () => {
  assert.match(validationDoc, /release-aionui-windows-installer\.yml/);
  assert.match(validationDoc, /no administrator rights/i);
  assert.match(validationDoc, /Relay\.Agent-\*-win-x64\*\.exe/);
  assert.match(validationDoc, /Get-AuthenticodeSignature/);
  assert.match(validationDoc, /Defender/);
  assert.match(validationDoc, /Relay Agent \/ M365 Copilot/);
  assert.match(validationDoc, /relay-agent\/m365-copilot/);
  assert.match(validationDoc, /OfficeCLI downloads into a user-local Relay-managed cache/);
  assert.match(validationDoc, /relay\.advancedSurfaces\.enabled/);
  assert.match(validationDoc, /Word assistant/);
  assert.match(validationDoc, /Excel assistant/);
  assert.match(validationDoc, /PowerPoint assistant/);
});

test("signing docs point normal releases at the AionUi workflow and mark Tauri release as legacy", () => {
  assert.match(signingDoc, /release-aionui-windows-installer\.yml/);
  assert.match(signingDoc, /Relay-branded AionUi\s+installer/);
  assert.match(signingDoc, /legacy Tauri\/OpenCode diagnostic workflow/);
  assert.match(selfSignedDoc, /release-aionui-windows-installer\.yml/);
  assert.match(selfSignedDoc, /confirm_legacy_tauri_release=true/);
  assert.doesNotMatch(selfSignedDoc, /gh workflow run release-windows-installer\.yml/);
});
