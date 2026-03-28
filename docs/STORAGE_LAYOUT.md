# Relay Agent Storage Layout

Date: 2026-03-28

## Purpose

This document defines the on-disk layout for app-local persistence under the Tauri
app data directory. It is the design artifact for Task Master task `5.1` and the
baseline for the later local JSON persistence work.

The storage root is defined as:

`<app_local_data_dir>/storage-v1/`

Notes:

- `app_local_data_dir` is already app-scoped by Tauri, so the repository does not
  add another product-name directory inside it.
- `storage-v1` is explicit so future migrations can introduce `storage-v2`
  without guessing the previous shape.
- The layout below is conservative and local-only. It does not assume any cloud
  sync or shared-machine coordination.

## Root Layout

```text
storage-v1/
  manifest.json
  sessions/
    index.json
    {sessionId}/
      session.json
      turns/
        {turnId}.json
      artifacts/
        {artifactId}/
          meta.json
          payload.json
      logs/
        session.ndjson
        {turnId}.ndjson
```

## Record Roles

`manifest.json`

- Holds storage-level metadata such as `schemaVersion`, `createdAt`,
  `updatedAt`, and the last successful migration marker.
- Exists once per storage root.

`sessions/index.json`

- Stores the listable session summary set used by `list_sessions`.
- Contains only fields needed for fast listing and ordering:
  `id`, `title`, `status`, `createdAt`, `updatedAt`, `latestTurnId`,
  `primaryWorkbookPath`.
- Is rewritten whenever a session summary changes.

`sessions/{sessionId}/session.json`

- Stores the canonical serialized `Session` object.
- Remains the source of truth for `read_session`.
- Keeps stable references such as `turnIds` and `latestTurnId`.

`sessions/{sessionId}/turns/{turnId}.json`

- Stores one canonical `Turn` object per file.
- Uses the turn ID as the filename so lookup never depends on a mutable title.
- Is loaded by `read_session` using the ordered `turnIds` list from `session.json`.

`sessions/{sessionId}/artifacts/{artifactId}/meta.json`

- Stores artifact metadata for replay and inspection.
- Covers relay packets, pasted Copilot responses, validation results, preview
  payloads, and execution result records.
- Keeps stable linkage fields such as `sessionId`, `turnId`, `artifactType`,
  `createdAt`, and either `relativePayloadPath` or `externalOutputPath`.

`sessions/{sessionId}/artifacts/{artifactId}/payload.json`

- Stores the JSON payload for app-managed artifacts when the payload is naturally
  serializable.
- If later work needs text or binary payloads, the artifact directory keeps the
  same `meta.json` contract and swaps the payload filename or extension without
  changing lookup rules.

`sessions/{sessionId}/logs/session.ndjson`

- Holds append-only session-level log events in newline-delimited JSON.
- Covers storage events, summary status changes, and cross-turn system notes.

`sessions/{sessionId}/logs/{turnId}.ndjson`

- Holds append-only turn-level log events such as packet generation, response
  validation results, preview creation, approval decisions, and execution
  outcomes.

## Naming Conventions

- Session IDs, turn IDs, and artifact IDs are the canonical path keys.
- IDs use the existing lowercase UUID string form already generated in the Rust
  backend.
- Human-readable titles are never used in filenames.
- JSON records use camelCase keys so the stored shape matches the shared
  contracts package and frontend payloads.
- Timestamps use RFC3339 UTC strings.
- Log files use `.ndjson` because they are append-oriented and line-addressable.
- Artifact directories are named only by `artifactId`; the artifact type lives in
  `meta.json`, not in the directory name.

## Lookup and Reload

`initialize_app`

- Ensures `storage-v1/`, `manifest.json`, and `sessions/index.json` exist.
- Loads manifest metadata before any session writes occur.

`list_sessions`

- Reads `sessions/index.json` first.
- If the index is missing or stale in a later recovery path, the fallback is to
  scan `sessions/*/session.json` and rebuild the index.

`read_session`

- Reads `sessions/{sessionId}/session.json`.
- Uses `turnIds` from that file to load `turns/{turnId}.json` in stable order.
- Artifact and log lookup remain relative to the same session directory.

Artifact lookup

- Packet, response, validation, preview, and execution artifact records are found
  through artifact IDs stored in future turn-linked metadata.
- User-selected save-copy outputs are not moved into the app data directory.
  Instead, artifact metadata stores the external output path so the app can
  reference the file without claiming ownership of it.

Log lookup

- Session-level diagnostics come from `logs/session.ndjson`.
- Turn detail logs come from `logs/{turnId}.ndjson`.

## Write Rules

- Writes are local-only and synchronous from the app point of view.
- File creation is lazy: a session directory is created when the first session is
  persisted.
- Each JSON write uses a temporary file and rename pattern so partial writes do
  not leave truncated canonical files behind.
- Canonical leaf records are written first, then `sessions/index.json`, then
  `manifest.json` timestamps if needed.
- The MVP does not physically delete session directories. Archival is represented
  by `session.status`.

## Deferred To Later Tasks

- The actual local JSON read or write implementation belongs to `5.2`.
- Persisting turn-linked artifact payloads and log emission belongs to `5.3`.
- Restart verification and index rebuild behavior belongs to `5.4`.
