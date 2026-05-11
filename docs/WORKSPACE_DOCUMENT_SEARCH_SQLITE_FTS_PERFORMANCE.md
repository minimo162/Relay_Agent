# Workspace Document Search SQLite/FTS Performance

Generated: 2026-05-11T00:00:00.000Z

## Scope

WDS03 measures the SQLite/FTS path with a synthetic large-folder-like corpus.
No real user documents, snippets, raw FTS rows, raw DB contents, absolute temp
paths, or copied files are recorded in this report.

## Corpus

- Synthetic files: 600
- Synthetic FTS rows per file: 3
- Total synthetic FTS rows: 1800
- Temporary working directory pattern: relay-wds03-perf-*

## SQLite/FTS Timings

| Operation | Result |
| --- | ---: |
| Metadata write | 1013.07 ms |
| Derived FTS writes total | 29959.94 ms |
| Derived FTS write average/file | 49.93 ms |
| Selective search p50 | 5.84 ms |
| Selective search p95 | 6.57 ms |
| Broad truncated search p50 | 6.10 ms |
| Broad truncated search p95 | 50.33 ms |
| WAL checkpoint | 0.59 ms |

## Size And Checkpoint

| File | Before Checkpoint | After Checkpoint |
| --- | ---: | ---: |
| SQLite DB | 1376256 bytes | 1376256 bytes |
| WAL | 0 bytes | 0 bytes |
| SHM | 0 bytes | 0 bytes |

## Search Probe Behavior

- Selective query rows returned: 18; truncated: no.
- Broad query rows returned: 20; truncated: yes.
- Executor default FTS probe cap is now 20 rows, configurable with
  `indexDbSearchMaxRows` or `RELAY_DOCUMENT_SEARCH_INDEX_DB_SEARCH_MAX_ROWS`,
  and bounded to 100 rows.
- Evidence anchors remain capped separately at 3 per result.

## Scheduler Backpressure

- Pressure snapshot state: throttled.
- Queue depth under one-root pressure: 15.
- Active jobs under one-root pressure: 1.
- Throttled roots: 1.
- First root reasons: per_root_concurrency_limit_reached.
- Drain result: completed=16, failed=0.

## Tuned Thresholds

- Keep SQLite/FTS primary mode behind the WDS02 ready gate; any truncated broad
  probe remains a rollback signal.
- Use 20 FTS probe rows as the default candidate-scoring cap for MVP. This is
  above the 3 citation-anchor cap; search p95 stayed below 60 ms on this
  synthetic corpus, but the higher outlier should be rechecked on a
  representative customer-approved folder.
- Keep the hard FTS probe bound at 100 rows for support/debug experiments until
  a representative customer-approved corpus proves broader probes are safe.
- Treat non-empty WAL files as checkpoint candidates after background indexing;
  this run records the checkpoint cost and before/after WAL size without
  exporting DB contents.
- Keep per-root background indexing concurrency at 1 by default for shared or
  network-share-like roots; the scheduler reports per-root throttling rather
  than letting one root consume all workers.

## Follow-Up

- Repeat this script with a user-approved real shared folder before release
  acceptance.
- WDS04 should surface the active path and degraded/rollback state in
  beginner-safe UX without exposing DB paths or raw rows.
