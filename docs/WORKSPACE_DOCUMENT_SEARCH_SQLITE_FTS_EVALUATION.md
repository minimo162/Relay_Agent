# Workspace Document Search SQLite/FTS Evaluation

Generated: 2026-05-11T00:00:00.000Z

## Scope

WDS01 evaluates the current SQLite/FTS advisory path against the repository-local
documentation corpus available in this environment. No customer or shared-folder
corpus was available here, so this is a reproducible local baseline rather than
a release acceptance run for real customer data.

## Privacy Boundary

- The evaluation report records aggregate diagnostics and result basenames only.
- It does not store snippets, extracted document text, raw FTS rows, raw DB
  contents, or absolute source paths.
- The temporary SQLite database is created under a temporary directory and
  removed at the end of the run.
- Temporary working directory pattern: relay-wds01-eval-*

## Corpus

- docs: 86 Markdown files

## Query Results

| Case | Status | Expected Hits | Best Rank | Top Result | Top Source | Index DB | Truncated | Stale Rows | Cap Loss |
| --- | --- | ---: | ---: | --- | --- | --- | --- | ---: | ---: |
| workspace-search-cutover | ok | 1/2 | 3 | WORKSPACE_DOCUMENT_SEARCH_SQLITE_FTS_EVALUATION.md | derived_content_index | degraded | yes | 0 | 56 |
| aionui-windows-validation | ok | 1/1 | 1 | AIONUI_WINDOWS_VALIDATION.md | derived_content_index | degraded | yes | 0 | 56 |
| opencode-provider-gateway | ok | 1/1 | 1 | OPENCODE_PROVIDER_GATEWAY.md | derived_content_index | degraded | yes | 0 | 64 |
| trusted-signing-release | ok | 1/2 | 1 | TRUSTED_SIGNING_SETUP.md | derived_content_index | degraded | yes | 0 | 56 |

## Summary

- Expected-file coverage: 4/4 cases.
- Top-rank expected-file coverage: 3/4 cases.
- Total SQLite/FTS candidate score cap loss: 232.
- Total stale SQLite/FTS rows reported: 0.

## Recommendations

- Keep SQLite/FTS primary promotion behind the WDS02 ready gate; this run is a local repository corpus, not a customer/shared-folder acceptance run.
- Expected files were present for every evaluation query, so the current filename/content/SQLite blend is acceptable as an MVP baseline.
- Keep score-cap telemetry enabled and inspect saturated queries before raising SQLite weight: workspace-search-cutover, aionui-windows-validation, opencode-provider-gateway, trusted-signing-release hit the cap.
- Treat truncated FTS probes as degraded for cutover decisions: workspace-search-cutover, aionui-windows-validation, opencode-provider-gateway, trusted-signing-release reached the search row bound.

## Follow-Up

- WDS02 consumes this report as a local baseline and keeps SQLite/FTS primary
  promotion behind an explicit ready/rollback gate.
- WDS03 complements this quality baseline with synthetic large-folder latency,
  DB size, WAL/SHM, checkpoint, and scheduler/backpressure measurements.
- WDS09 complements this repository-corpus baseline with a privacy-safe
  synthetic golden-query gate for top-k coverage, folder skew, warning
  correctness, unsupported-claim prevention, and latency.
- A release acceptance run still needs a representative user-approved folder
  set outside this repository.
