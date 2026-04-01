# Artifact Output Design

## Goal

Preview, approval, execution, and post-save validation need one output model that works for spreadsheet diffs, file operations, text transforms, extracted documents, and tabular exports. The current `DiffSummary` path remains valid, but it becomes one artifact renderer instead of the only renderer.

## Pipeline

```text
Transform execution
  -> OutputArtifact[]
    -> ArtifactPreview
      -> write approval
        -> save / execute
          -> QualityCheckResult
            -> activity feed + audit artifact
```

## Artifact Model

`OutputArtifact` is the transport object shared by preview, execution, persistence, and UI rendering.

- `spreadsheet_diff`: wraps the existing `DiffSummary`
- `file_operation`: file copy/move/delete and text-replace write intents
- `text_diff`: before/after preview for regex-backed text replacement
- `text_extraction`: extracted document text with format metadata
- `csv_table`: tabular preview for CSV-like output
- `raw_text`: plain text output or fallback content

The artifact model is additive. Existing `diffSummary` and `fileWriteActions` fields stay in IPC responses for compatibility while the UI migrates to `artifacts`.

## Preview Rules

- Workbook write previews produce one `spreadsheet_diff` artifact.
- File write previews produce one or more of:
  - `file_operation`
  - `text_diff` when `text.replace` can show before/after content
- Artifact labels are user-facing and should identify the target path or operation.
- Warnings stay attached both at the top-level preview response and per artifact so the UI can show aggregate warnings and per-artifact warnings.

## Execution Rules

- `run_execution` returns executed artifacts for the default save path.
- `run_execution_multi` executes the reviewed workbook response against the requested output specs instead of creating an implicit default save-copy first.
- Multi-output is best-effort by format:
  - workbook copy paths can emit native `csv` or `xlsx` when the source format supports that write path
  - derived `json` and `text` outputs are generated from a temporary transformed CSV materialization and do not leave an extra default save-copy behind
  - `xlsx` remains copy-only; transformed CSV output is not mislabeled as `.xlsx`
- Each execution result still records its own turn artifact and output path for audit.

## Quality Validation

Post-save validation is a separate command, not part of write execution. That keeps execution deterministic and allows the UI to re-run validation later if needed.

Current checks:

- row-count sanity
- empty-value ratio regression
- UTF-8 readability
- CSV injection scan

If a format cannot support a strict comparison, the validator returns warnings instead of silently passing.

## UI Contract

`ArtifactPreview.svelte` owns renderer selection and tab switching.

- single artifact: render inline without tabs
- multiple artifacts: tab strip
- unsupported artifact: JSON fallback

The review UI and intervention panel should consume `artifacts` directly. `SheetDiffCard` and `FileOpPreview` remain leaf renderers.

## Persistence / Audit

- preview artifacts are recorded in the preview turn artifact payload
- execution artifacts are recorded in the execution turn artifact payload
- quality results are pushed into the activity feed and can be recorded later as dedicated audit artifacts without changing the preview contract

## Guardrails

- save-copy only remains the default workbook write path
- original workbook inputs remain read-only
- artifact rendering must not execute embedded content
- raw text / extracted document previews are truncated in the UI, not mutated in storage
