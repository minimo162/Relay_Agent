# AionUi-First Relay Agent Migration

Date: 2026-05-08

This document fixes the implementation direction for rebuilding Relay Agent on
top of AionUi while keeping Relay's M365 Copilot provider gateway and Tool Call
Emulation Layer.

## Decision

Relay Agent should move from the OpenCode Web first-run UX to an
AionUi-first, Relay-branded desktop shell.

This is not a compatibility migration. No public release has shipped, so the
new product path may break the current OpenCode-only bootstrap assumptions.

## Role Split

```text
Relay-branded AionUi shell
  owns the primary UX, conversations, workspace files, skills, approvals,
  OfficeCLI assistants, previews, and normal agent interaction

Relay provider gateway
  starts before the AionUi shell, exposes an OpenAI-compatible local endpoint,
  and presents M365 Copilot as the relay-agent/m365-copilot model

Relay Tool Call Emulation Layer
  treats M365 Copilot as a strict JSON planner or final-answer writer,
  normalizes supported structured output into OpenAI tool calls, and never
  lets M365 Copilot claim local execution

OfficeCLI portable bootstrap
  downloads and verifies a pinned OfficeCLI binary into Relay-managed
  user-local storage with no admin approval

OpenCode
  is optional future backend capacity, not the first-run UX
```

## Upstream Baseline

The first Relay fork/wrapper target is:

- AionUi `v1.9.25`
  - repository: `https://github.com/iOfficeAI/AionUi`
  - commit: `bbada2a9268060d2b41ddf1d885a9b27ecd2103d`
  - license: Apache-2.0
- OfficeCLI `v1.0.76`
  - repository: `https://github.com/iOfficeAI/OfficeCLI`
  - commit: `958717ea25351b8920a3d8313d46e08b24b9c95b`
  - license: Apache-2.0
  - Windows x64 asset: `officecli-win-x64.exe`

AionUi already supports OpenAI-compatible custom providers. The Relay fork
must seed a provider equivalent to:

```json
{
  "id": "relay-agent",
  "platform": "custom",
  "name": "Relay Agent / M365 Copilot",
  "baseUrl": "http://127.0.0.1:<relay-port>/v1",
  "apiKey": "<local relay token>",
  "model": ["m365-copilot"],
  "useModel": "m365-copilot"
}
```

The user-facing model reference remains `relay-agent/m365-copilot`.

The Relay fork/wrapper must apply these fixed branding values from
`apps/desktop/src-tauri/bootstrap/aionui-relay.json`:

- product name: `Relay Agent`
- executable name: `Relay Agent`
- window title: `Relay Agent`
- protocol: `relay-agent`
- installer artifact prefix: `Relay.Agent`
- icon source: `apps/desktop/src-tauri/icons/source/relay-agent.svg`
- browser/support title: `Relay Agent`

## Product Guardrails

- The installed app name, title, icon, installer, protocol, and browser/web
  labels are `Relay Agent`, not AionUi.
- The first-run path must not ask the user to add a provider, paste an API key,
  choose a backend, install OfficeCLI manually, or open a terminal.
- Relay starts the local provider gateway before the AionUi shell becomes
  interactive.
- The AionUi model provider list starts with the Relay provider selected.
- First startup imports the Relay seed bundle into AionUi config storage,
  replacing any stale `relay-agent` provider while preserving unrelated user
  settings.
- The seed bundle carries the Office assistant policy: `word-creator`,
  `excel-creator`, and `ppt-creator` are the default visible assistants, with
  `officecli-docx`, `officecli-xlsx`, and `officecli-pptx` enabled by default.
- OfficeCLI is Relay-managed. Do not use AionUi's upstream `irm ... | iex` or
  `curl ... | bash` auto-install path in the Relay product path.
- OfficeCLI is cached under Relay-managed user-local storage by version,
  verified by size and SHA256, and then prepended to the AionUi child-process
  `PATH`.
- Remote access, channel bots, and unrelated provider marketplace features are
  hidden or advanced-only in the Relay fork.
- OpenWork is not part of this path. It was removed because its installer
  needs admin approval in the target environment.
- OpenCode Web is demoted to an optional future backend. It is not the product
  first screen.

## Implementation Phases

1. Add a source-controlled AionUi/OfficeCLI manifest and provider seed helpers.
2. Apply the Relay AionUi overlay to a fork or checkout. The overlay copies
   `relaySeed.ts` into AionUi and patches `initStorage.ts` so the Relay seed is
   imported during startup.
3. Fork or vendor AionUi under a separated source directory and apply Relay
   branding.
4. Add a Relay bootstrap step that starts the provider gateway, writes the
   AionUi provider seed, and launches the Relay-branded AionUi shell.
5. Replace AionUi's OfficeCLI auto-install bridge with the Relay-managed
   portable OfficeCLI cache.
6. Enable OfficeCLI assistants and skills by default for Word, Excel,
   PowerPoint, and Office file preview.
7. Hide remote/channel/provider onboarding surfaces unless explicitly enabled
   for diagnostics.
8. Remove or demote the OpenCode Web launcher and OpenWork/OpenCode naming from
   the installed first-run UI.
9. Add Windows validation for first install, M365 sign-in, provider readiness,
   OfficeCLI download, Office document creation/editing, and Defender behavior.

## Release Workflow Boundary

- `.github/workflows/release-aionui-windows-installer.yml` owns the primary
  `release-windows-installer` workflow. It builds the Relay-branded AionUi
  installer from the pinned AionUi baseline after applying the Relay overlay.
- `.github/workflows/release-windows-installer.yml` is retained only as a
  manual legacy Tauri/OpenCode diagnostic release path. It has no tag push
  trigger and requires explicit `confirm_legacy_tauri_release=true`.

## Compatibility Position

The current OpenCode-only implementation remains useful as a reference for the
provider gateway and tool-call emulation. It should not constrain the AionUi
product surface.

Code that belongs in Relay:

- M365 Copilot CDP transport
- OpenAI-compatible provider gateway
- tool-call JSON extraction and normalization
- local provider token management
- gateway diagnostics
- OfficeCLI portable artifact bootstrap
- AionUi provider/default-model seeding

Code that should live in AionUi or upstream extension points:

- conversation UX
- workspace navigation
- session history
- approvals
- skill selection
- Office document preview/edit workflows
- optional ACP/OpenCode backends

## Verification Gates

Linux/CI-safe gates:

- AionUi/OfficeCLI manifest parses and pins exact upstream references.
- Relay provider seed has a valid AionUi provider shape.
- Provider seed preserves unrelated existing providers while replacing the
  Relay provider deterministically.
- Relay writes a seed bundle before shell startup that records the provider
  base URL, selected model, Aionrs base URL, and the provider-before-shell
  lifecycle requirement.
- `node scripts/apply-aionui-overlay.mjs --aionui-dir <checkout>` copies
  Relay's `relaySeed.ts` into AionUi and patches AionUi startup to apply the
  provider seed before MCP/model initialization and the assistant seed after
  built-in assistants are created.
- OfficeCLI bootstrap derives a user-local cache path from the pinned manifest,
  verifies size/SHA256, and produces a PATH value without requiring admin
  approval.
- The provider base URL keeps the `/v1` suffix for AionUi's OpenAI SDK path.
- Aionrs handoff can strip `/v1` when it appends `/v1/chat/completions`.

Windows gates:

- Installer launches without console flicker.
- First launch starts the provider gateway and opens the Relay-branded AionUi
  shell.
- M365 Copilot sign-in state is visible and recoverable.
- OfficeCLI downloads into a user-local Relay directory, verifies SHA256, and
  runs `officecli --version`.
- Word, Excel, and PowerPoint assistants can create a file in the selected
  workspace.
- Defender/SmartScreen result is recorded for the signed installer.
