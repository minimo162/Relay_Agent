# Workbook Engine Selection

## Selected Libraries

- `csv` is the MVP source of truth for CSV read and write plumbing.
- `calamine` is the limited spreadsheet reader for `.xlsx` / `.xlsm` / `.xlam` inspection.
- `std::fs` remains the save-copy mechanism for passthrough output handling.

## Why This Stack

- The MVP path is CSV-first, so the primary engine should stay lightweight and explicit instead of introducing a heavier dataframe runtime before the inspect and preview slice is stable.
- `csv` gives the project direct reader and writer builders, record-level control, and a predictable path for later CSV sanitization and save-copy output.
- `calamine` is pure Rust and read-oriented, which matches the repo guardrail that xlsx support should stay limited to inspect and save-copy preparation rather than full workbook mutation.
- No xlsx writer crate is selected yet because Milestone 3 only needs inspect support plus save-copy planning, not rich round-tripping.

## Module Boundaries

- `apps/desktop/src-tauri/src/workbook/source.rs`
  Responsibility: format detection, source-path normalization, and derived save-copy output paths.
- `apps/desktop/src-tauri/src/workbook/csv_backend.rs`
  Responsibility: CSV reader/writer builder ownership for the CSV-first inspect and preview path.
- `apps/desktop/src-tauri/src/workbook/xlsx_backend.rs`
  Responsibility: read-only spreadsheet opening for the limited xlsx inspection slice.
- `apps/desktop/src-tauri/src/workbook/inspect.rs`
  Responsibility: inspect-time limits and policies for `workbook.inspect`, `sheet.preview`, and `sheet.profile_columns`.
- `apps/desktop/src-tauri/src/workbook/preview.rs`
  Responsibility: source-format gating plus CSV-backed write-preview synthesis for the supported `table.*` action subset.
- `apps/desktop/src-tauri/src/workbook/engine.rs`
  Responsibility: bind the selected libraries and module boundaries into one backend-facing workbook engine surface.

## MVP Support Matrix

- CSV
  Inspect: yes
  Sheet preview: yes
  Column profile: yes
  Write preview: yes
  Save-copy output: yes
- XLSX family
  Inspect: yes
  Sheet preview: yes
  Column profile: yes
  Write preview: no
  Save-copy output: yes, as copy-oriented handoff rather than rich workbook mutation

## Deferred Beyond 8.1

- No formula execution or formula authoring from model output.
- No in-place workbook mutation.
- No high-fidelity xlsx rewrite path.
- No dataframe engine unless the CSV-first preview slice proves too costly to maintain with the current direct-reader approach.
