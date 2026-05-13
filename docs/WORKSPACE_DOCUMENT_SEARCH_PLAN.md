# Workspace Document Search Plan

Date: 2026-05-09
Status: planning
References:

- Docufinder / Anything: https://github.com/chrisryugj/Docufinder
- Docufinder design system: https://github.com/chrisryugj/Docufinder/blob/main/DESIGN.md
- Dedoc: https://github.com/ispras/dedoc
- Dedoc API schema: https://dedoc.readthedocs.io/en/latest/dedoc_api_usage/api_schema.html

This plan replaces the ad-hoc "ask Copilot to chain glob/grep/read correctly"
posture for broad shared-folder document lookup. It is a bridge-first plan:
Relay Agent's core product remains the connection between M365 Copilot and the
Relay-branded AionUi shell. Document search exists only as an AionUi skill-led
workflow that Relay can make reliable through provider, tool-call, result,
status, evidence, redaction, and diagnostic contracts.

The product direction is:

1. Make local workspace search trustworthy by default: show progress and early
   candidates quickly, but wait for content/evidence confirmation before final
   conclusions.
2. Normalize parsed documents into a structured, rebuildable document IR.
3. Build evidence-backed answers from search results without trusting M365
   Copilot as the search planner or the source of truth.

Relay may still normalize low-level tool-shaped requests (`glob`, `grep`,
`read`) where appropriate, but broad document lookup should be driven through
AionUi skills and deterministic bridge contracts rather than by model-only tool
planning. Relay must not become a parallel document-search app, conversation
store, preview surface, or approval surface.

## 2026-05-13 Implemented Bridge Slice

The first Docufinder-inspired slice has landed in the Relay bridge. It does not
copy Docufinder code and does not create a separate search product surface.
Instead, it makes the existing high-level `relay_document_search` tool a safer
first step for Copilot-backed AionUi sessions:

- Query planning now records mode, content strategy, ignored intent words,
  exclusion terms, and recency preference.
- Japanese natural-language finance searches keep terms such as
  `キャッシュフロー計算書`, `CFS`, `連結CF`, and `精算表` even when the user writes
  one unspaced sentence.
- Search-time exclusions such as `バックアップ除外` are applied before indexing
  and ranking.
- Ranking exposes a recency component when the user asks for latest/current
  files.
- Result diagnostics include candidate buckets so answers can distinguish
  source/workpapers from disclosure/output files, backup/archive material, and
  review/audit files.
- When SQLite/FTS is explicitly enabled, it is eligible to become the primary
  path only after the existing cutover readiness gate says the index is safe.

The next acceptance step remains installed Windows validation on a representative
shared folder: top-k relevance, folder-skew behavior, preview/open/copy/refine
actions, partial/no-result/permission states, and support export.

## Bridge-First Scope Correction

The plan must be read with this ownership boundary:

- AionUi owns product UX: `/guid`, composer, skills, workspace tree, preview,
  history, approvals, file actions, and result rendering.
- M365 Copilot owns language: intent phrasing, optional planning text, and final
  answer wording after validation.
- Relay owns the bridge: local OpenAI-compatible provider, Copilot transport,
  tool-call normalization, AionUi provider seed/defaults, result/status schema,
  evidence validation, redaction, and diagnostics.
- Search/index/parser components are implementation details behind AionUi
  skills or upstream extension points. Relay may define contracts and minimal
  adapters, but it should not grow a standalone search product surface.

Any future implementation task that cannot be expressed as an AionUi skill,
AionUi renderer, AionUi workspace/preview integration, or Relay bridge contract
is out of scope until the ownership boundary is re-reviewed.

## Zero-Base Architecture Decision

This is not a prompt-engineering or tool-repair feature. Treat it as a
document-search capability behind AionUi skills with Relay-owned bridge
contracts, not as a new Relay-owned product shell:

```text
AionUi /guid, composer, workspace, skills, preview
  -> Relay bridge contract and status translation
  -> AionUi skill runtime / local search adapter
  -> Result and evidence validation boundary
  -> AionUi result cards and preview
  -> optional Copilot polish through Relay provider
```

Core engineering rules:

- Every stage is idempotent for the same input state.
- Every derived artifact records the source metadata version, parser version,
  profile, and build parameters used to create it.
- Rebuilds are normal operations, not recovery-only operations.
- Partial failures must leave the previous good searchable state intact until
  the replacement state is committed.

The low-level tools remain useful for exact operations, but they are no longer
the product retrieval strategy for broad document lookup. A model may suggest
terms or ask to inspect a specific file; it must not be the component that
decides which folders were searched, whether indexing is complete, which files
count as evidence, or whether an answer is safe to present as complete. Those
facts are passed through explicit contracts and rendered by AionUi.

The key product promise is Docufinder-like:

- Add a folder.
- Show scan progress and early filename candidates as progress, not as final
  answers.
- Let content indexing and evidence expansion complete for the default
  `しっかり検索` path.
- Show what was searched, still pending, stale, failed, skipped, or denied.
- Answer only from local indexed evidence or exact reads, with incomplete
  coverage made explicit.

The key parsing promise is Dedoc-like:

- Convert each document to a strict `ParsedDocument`.
- Preserve structure, tables, metadata, warnings, annotations, and attachments.
- Derive search indexes and evidence from the IR, not from ad-hoc parser text.

## Reference Alignment

### Docufinder-aligned search principles

Docufinder is primarily a local document search engine. The Relay search plan
should follow these principles:

- Register a folder, then start indexing automatically.
- Keep filename/path search available from a local metadata cache while content
  indexing is still running, but label those hits as candidates/progress unless
  the user explicitly chooses quick filename search.
- Maintain an in-memory filename/path cache built from the persistent metadata
  cache so startup and first-query lookup do not wait for document parsing.
- Keep document parsing, indexing, filename search, keyword search, and optional
  semantic/OCR features local by default.
- Do not copy original files into Relay storage. Store only metadata, extracted
  text/IR, and rebuildable indexes.
- Treat AI answers as optional consumers of retrieved chunks. Search must still
  work when Copilot is unavailable.
- Keep sync/freshness explicit: added, modified, deleted, stale, failed, and
  skipped files must be visible to diagnostics and, where useful, to the UI.
- Support several search postures without collapsing them into one vague query:
  filename, content keyword, hybrid, evidence lookup, similar-document lookup,
  and future semantic search.
- Treat search results as product objects, not raw tool output: each result must
  have preview/open actions, match mode, evidence state, index state, and
  warning state.
- Keep the result list content-led and medium-density. The useful document
  facts, path, snippet, status, and actions come first; AI prose is secondary.
- Prefer capped result batches with an explicit "show more" action for chat
  result cards. Avoid making broad search depend on infinite scroll or virtual
  scrolling inside the conversation result surface.

Docufinder's source is Business Source License 1.1 with production-use limits
until its change date. Relay must use the ideas only unless a separate legal
review approves dependency or code reuse.

### Docufinder fit matrix

| Docufinder behavior | Relay plan decision |
|---|---|
| Folder registration starts automatic indexing | Workspace root registration immediately starts metadata scan and background content indexing. |
| Filename search works before full indexing | Persistent metadata store feeds an in-memory filename/path cache at startup and during scans. |
| Content search is local | ParsedDocument IR and derived FTS/table indexes live locally. |
| Search modes include keyword, hybrid, semantic, filename | MVP ships filename/content/hybrid/evidence; semantic/vector/OCR remain optional Phase 6. |
| AI Q&A is optional and evidence-backed | A validated local draft works without Copilot; Copilot polish is validated against Evidence Pack. |
| Real-time sync updates changed files | Watchers are best-effort; periodic sync handles mapped/UNC/network folders. |
| Original files are not copied | The local skill/search adapter stores metadata, IR, and rebuildable indexes only. |
| Local privacy boundary | Search/index/draft work without network access; external AI receives only selected Evidence Pack snippets when enabled. |
| Result click opens preview, file open remains available | Contracted result objects carry preview anchors and open actions separately from answer text. |
| Result UI keeps content primary | AionUi chat result cards show title, path, snippet, status, and actions before optional Copilot wording. |
| Large result lists use explicit continuation | Result cards return capped batches with "show more"; workspace tree filtering may keep AionUi's native behavior. |

### Docufinder-style result UX contract

Docufinder's UX is search-first rather than chat-first. Relay should preserve
that inside AionUi instead of letting Copilot prose become the main interface:

- The first visible output for a search is a structured result group, not a
  paragraph that claims what was found.
- Each result row/card includes file-type signal, title, path, modified time
  when available, match snippet, match mode, evidence/index state, and primary
  actions.
- Result groups are capped by default. The UI exposes `さらに表示`, refine, and
  folder/filter adjustment actions rather than dumping an unbounded list into a
  chat message.
- The first batch should preserve directory diversity for broad searches so a
  single deep folder does not crowd out other matching folders.
- Selection state is stable across "show more", background index refresh, and
  preview/open actions.
- File-type colors and badges are semantic hints only; status must always be
  expressed with text plus icon.
- Loading uses skeleton rows or progress text for slow operations, and long
  background indexing stays cancellable or pausable where the scheduler allows.
- AionUi's existing preview and workspace surfaces remain the interaction
  frame. Relay does not add a second Docufinder-like full page.

### Search mode contracts

Docufinder's search modes are not just labels; each mode has a different
contract. Relay should preserve that distinction:

- `filename`: searches path/name metadata only. Always fast. Results are
  candidates, not content evidence.
- `keyword`: searches local FTS/n-gram content indexes. Requires fresh
  `ParsedDocument` IR or extracted text.
- `hybrid`: merges filename, keyword, table, and future semantic ranks. Uses a
  deterministic merge such as reciprocal-rank fusion and exposes the score
  breakdown.
- `semantic`: future optional vector search. It is a derived index, never the
  only source of evidence for a factual answer.
- `evidence`: builds an Evidence Pack for answer generation. It can consume
  filename/keyword/hybrid results but must downgrade incomplete coverage.
- `similar`: finds related documents through lineage, version, title/path,
  shared structure, and later embeddings.

No mode is allowed to silently fall through to another mode without exposing
that in the result contract.

### Query normalization and Japanese/CJK handling

Search quality depends on normalizing user queries and indexed terms in the same
way. The normalizer is shared by filename cache, FTS/n-gram indexes, query
planning, and golden-query evaluation.

Required normalization:

- Unicode normalization: NFKC for full-width/half-width variants.
- Case folding for Latin terms.
- Width and punctuation folding for common accounting file names.
- Slash/space/underscore/hyphen normalization for path and filename tokens.
- CJK token support through character n-grams and exact substring matching.
- Domain synonym expansion for configured aliases, for example `C/F`, `CF`,
  `CFS`, `キャッシュフロー`, `キャッシュ・フロー`,
  `キャッシュフロー計算書`.
- Period/quarter normalization, for example `160期`, `FY160`, `160-1Q`,
  `160期-1Q`, `1Q`, `4Q`.
- Extension normalization, including `.xlsx`, `.xlsm`, `.xls`, `.pdf`, `.docx`.

Normalization must be inspectable in diagnostics: a support report should show
the original query, normalized terms, synonym expansions, and rejected/ignored
tokens.

### Query planning and Copilot suggestion boundary

Query construction is a Relay-owned deterministic step. Copilot may suggest
language expansions, but it must not be the query planner, validator, or
executor.

Relay owns:

- search root and root-boundary validation
- default mode selection (`thorough`) and explicit quick filename mode
- search targets: filename, path, content, table, heading, metadata, evidence
- normalized terms, synonym expansion, period/quarter aliases, extension hints,
  include/exclude terms, and rejected tokens
- file type filters and supported/unsupported format warnings
- search budget, coverage policy, candidate promotion policy, and stopping
  criteria for the thorough pass
- whether a result can be called confirmed

Copilot may optionally provide:

- related natural-language terms and abbreviations
- likely file type hints
- possible user-clarification questions
- alternative Japanese wording for the visible query summary

Copilot suggestions are accepted only after Relay validates them against root,
format, budget, privacy, and normalization policy. Rejected suggestions are
recorded in Query Trace. The same user query, workspace state, and accepted
suggestions must produce the same `QueryPlan`.

Minimal `QueryPlan` shape:

```json
{
  "mode": "thorough",
  "root_ids": ["workspace-root-id"],
  "targets": ["filename", "content", "table", "heading"],
  "terms": ["キャッシュフロー", "C/F", "CF", "CFS"],
  "file_types": ["xlsx", "xlsm", "pdf", "docx"],
  "include": [],
  "exclude": [],
  "must_verify_content": true,
  "candidate_policy": "show-as-progress",
  "confirmation_policy": "content-or-evidence-backed"
}
```

### Analyzer Strategy

Different fields should not share one blunt tokenizer. Relay should define
versioned analyzers and record the analyzer version on every derived index:

- `path_analyzer`: path separators, drive letters, UNC roots, folder names,
  extension tokens, and folder-role signals such as backup, filing, audit, or
  output.
- `filename_analyzer`: NFKC, CJK n-grams, accounting synonyms, period/quarter
  terms, version suffixes, and extension boosts.
- `content_analyzer`: normalized text, CJK n-grams, phrase windows, paragraph
  headings, and exact substring fallback.
- `table_analyzer`: sheet names, cell addresses, row/column labels, formula
  cached values, table titles, and nearby header terms.
- `heading_analyzer`: document headings, PDF page headings, Word paragraph
  types, slide titles, and profile-specific section labels.
- `query_analyzer`: user query normalization, synonym expansion, search-mode
  classification, and rejected token reporting.

Analyzer changes are schema changes for derived indexes. A change to an
analyzer version must either rebuild dependent indexes or mark them stale.

### Indexing ladder

Search availability should climb a ladder rather than wait for one monolithic
"index complete" event:

1. `discovered`: path seen during scan.
2. `metadata_indexed`: path/name/type/size/mtime persisted.
3. `filename_searchable`: in-memory filename cache updated.
4. `text_extracted`: raw text or reader output available.
5. `parsed_document_ready`: strict `ParsedDocument` IR persisted.
6. `keyword_index_ready`: FTS/n-gram content indexes built.
7. `table_index_ready`: table/cell indexes built where applicable.
8. `preview_ready`: preview spans and open anchors available.
9. `semantic_index_ready`: optional vector index built.
10. `ocr_index_ready`: optional OCR-derived content built.

User-facing status should say which rungs are ready. A folder can be useful at
rung 3 even if content indexing is still catching up.

### Dedoc-aligned document principles

Dedoc is primarily a document parsing and structure-normalization system. The
Relay document plan should follow these principles:

- Parse every supported file into a strict document IR, not directly into a
  final answer.
- Separate converters, readers, metadata extractors, structure extractors,
  table extractors, attachment extractors, and warning collection.
- Preserve structure as a tree plus tables, metadata, annotations, warnings,
  attachments, parser version, and source freshness.
- Treat document metadata as parser output, not filesystem discovery state. The
  scanner owns FileRecord/FileMetadata; the parser only records
  DocumentMetadata for the FileRecord snapshot it was given.
- Prefer Dedoc-compatible vocabulary for IR objects: `ParsedDocument`,
  `DocumentContent`, `DocumentMetadata`, `TreeNode`, `LineWithMeta`,
  `LineMetadata`, `Table`, `CellWithMeta`, `Annotation`, `warnings`, and
  recursive `attachments`.
- Keep parser output pure. It may say "this table/cell/paragraph was found" or
  "this workbook had hidden sheets"; it must not say "this is the correct file
  for the user's task." That claim belongs to the evidence layer.
- Make structure extraction configurable by document profile rather than by
  hard-coded user-task rules.
- Keep reader output, constructed structure, derived indexes, and answer
  evidence as separate artifacts.

Dedoc itself should be treated as a future optional adapter. The MVP should
define a Dedoc-compatible internal IR and lightweight parsers first, then decide
later whether bundling Dedoc's Python stack is worth the size and dependency
cost.

### Dedoc fit matrix

| Dedoc concept | Bridge-first plan decision |
|---|---|
| `ParsedDocument` with content, metadata, warnings, attachments | The local skill/search adapter uses the same top-level shape and keeps attachments recursive. |
| `DocumentContent` contains structure tree and tables | The adapter stores `TreeNode` structure plus `Table` / `CellWithMeta` records. |
| `DocumentMetadata` preserves document identity and parser-visible timestamps | It may repeat file id/name/type/mtime for traceability, but FileMetadata remains the source of truth for root/path/access/freshness. |
| Readers determine whether they can parse a file | Parser registry has `can_read` / `read` style interfaces by extension, MIME, and profile. |
| Reader composition chooses the first suitable parser | Ordered parser candidates record which parser/profile won. |
| Warnings capture partial failures | Warnings drive answer downgrade and support diagnostics through Relay contracts. |
| Structure types are configurable | Structure profiles include `spreadsheet`, `financial_workpaper`, and `audit_material`. |
| Dedoc is a parsing module, not a search engine | IR generation stays separate from indexes, Evidence Packs, and final answers. |
| Reader output and structure construction are distinct | Parsed lines/tables are stored before deriving `TreeNode` hierarchy through profile-specific constructors. |

### Dedoc API schema field contract

Relay should treat Dedoc compatibility as a field-level contract, not only as
inspiration:

- `ParsedDocument` top-level fields are `content`, `metadata`, `version`,
  `warnings`, and recursive `attachments`. Relay extensions go under explicit
  extension fields such as `parser` or metadata `extra_data`; they do not
  replace Dedoc-compatible fields.
- `DocumentContent` has exactly two source-of-truth branches:
  `structure` for a recursive `TreeNode` hierarchy and `tables` for tabular
  content. Flattened preview text and FTS rows are derived artifacts.
- `DocumentMetadata` preserves parser-visible identity fields such as `uid`,
  `file_name`, `temporary_file_name`, `size`, `modified_time`, `created_time`,
  `access_time`, and `file_type` where available. Relay may add stable file id,
  source metadata version, parser profile, and source trace ids under extension
  metadata, but root/path/access/freshness authority stays in FileMetadata.
- `TreeNode` preserves `node_id`, `text`, `annotations`, `metadata`, and
  `subparagraphs`. Evidence anchors point to stable node ids, not to copied
  prose in a Copilot answer.
- `LineMetadata` preserves `paragraph_type`, `page_id`, and `line_id` when
  available. Missing page or line information lowers anchor confidence instead
  of being guessed.
- `Table` preserves rectangular row/cell structure separately from text
  snippets. `TableMetadata` preserves `page_id`, `uid`, `rotated_angle`, and
  `title` where available.
- `CellWithMeta` preserves cell lines, `rowspan`, `colspan`, and `invisible`.
  Spreadsheet-specific sheet/range/cell details are Relay extensions attached
  to table/cell metadata, not replacements for the Dedoc-style cell shape.
- `Annotation` preserves `start`, `end`, `name`, and `value`. Formatting,
  link, heading, list, font, and reader-tag signals become annotations or
  metadata, not search-only side channels.

Acceptance:

- Serialized IR can be validated against a Relay schema that mirrors Dedoc's
  top-level object names and required branches.
- Schema compatibility tests fail if a parser flattens tables into text only,
  drops warnings, drops recursive attachments, or stores evidence anchors only
  as free-text paths.
- Relay-specific fields are allowed only where the schema explicitly marks
  extension points.

### Structure profile and pattern contract

Dedoc supports configurable structure extraction through document type and
patterns. Relay should model that explicitly:

- `profile` is Relay's equivalent of a Dedoc structure type. It selects the
  line classifiers, heading/list/table heuristics, and structure constructor.
- Profiles are data/config plus versioned code, not ad-hoc task prompts. A
  profile can use reader tags, formatting annotations, regular expressions,
  path/file-type hints, sheet names, and table headers.
- Profile selection may use file type, path signals, and explicit user context,
  but it cannot create answer claims. It only controls how a file is parsed.
- Each profile records a `structure_profile_version`. Changing the profile,
  pattern set, or constructor invalidates dependent ParsedDocument and derived
  indexes.
- Diagnostics expose which profile and patterns were applied, what lines/nodes
  they matched, and which candidate patterns were rejected.
- Unknown or low-confidence documents fall back to `default` profile and emit a
  warning rather than being forced into a domain-specific structure.

### Format strategy matrix

The format plan follows Dedoc's "many formats to one uniform output" idea while
keeping Docufinder's "search works locally first" constraint.

| Format group | MVP stance | Parser strategy | Warning behavior |
|---|---|---|---|
| `.txt`, `.md` | MVP | Raw text reader, encoding detection | `encoding_guessed` when not certain |
| `.csv`, `.tsv` | MVP | Table-first reader | lossy cell/quote issues become warnings |
| `.docx` | MVP | Office XML reader, paragraphs/tables/annotations | unsupported drawings/charts warn |
| `.xlsx`, `.xlsm` | MVP | Sheet/table/cell reader with formula cached values | hidden sheets, missing cached formulas, external links warn |
| `.pptx` | MVP | Slide/notes reader | unsupported charts/media warn |
| text-layer `.pdf` | MVP | PDF text reader with page anchors when available | layout uncertainty warns |
| scanned `.pdf`, images | Phase 6 | OCR adapter | `ocr_disabled` or `ocr_failed` until enabled |
| archives/email | Phase 6 | Attachment extractor to recursive `ParsedDocument` | `attachment_skipped` until enabled |
| old Office `.doc`, `.xls`, `.ppt` | Later adapter | Converter-first pipeline | `converter_unavailable` in MVP |
| HWP/HWPX and regional formats | Later adapter | Optional parser/converter plugin | `unsupported_format` in MVP |

Unsupported formats should still be discoverable by filename search. They are
skipped only for content indexing.

## Layered Architecture

The architecture is now explicitly four layers, not three. This keeps the
Docufinder search responsibilities and Dedoc parsing responsibilities separate.

### Layer 1: Search Availability

Purpose: make "what files exist here?" and "what likely candidates are here?"
fast and dependable.

Owned data:

- Workspace registry
- Root folders and scan policy
- Persistent file metadata cache
- In-memory filename/path cache
- Filename/path n-gram or substring index
- Basic extension/type classification
- Index status and failure summaries

Invariants:

- Folder registration starts a metadata scan immediately.
- Filename/path search works before content indexing finishes.
- Startup rebuilds the in-memory filename cache from persistent metadata before
  any slow content indexing work starts.
- Search works without Copilot and without network access.
- Metadata records are cheap to refresh and safe to rebuild.

### Layer 2: Content Indexing Scheduler

Purpose: turn a huge shared folder into an ordered, bounded indexing workload
without blocking filename search.

Owned data:

- Index job queue
- Per-root scan cursor
- Per-file priority
- Per-root concurrency and network-drive throttle state
- Retry/backoff state
- Parse budget and cancellation state
- Backpressure, pause/resume, and foreground-query promotion state
- Network-folder periodic scan state

Invariants:

- Filename search does not wait for this layer.
- Query-related candidates can be promoted ahead of idle background work.
- Foreground search work has priority over idle indexing, but it cannot create
  an unbounded stampede on a slow network share.
- Queues are bounded, cancellable, and resumable.
- CPU, disk, battery, and network budgets are explicit scheduler inputs.
- Per-root concurrency prevents one large root from starving smaller roots.
- One oversized, locked, or malformed file cannot block the whole root.
- Stale files are marked before fresh evidence is reused.

### Layer 3: Document Normalization

Purpose: convert exact files into structured, reusable document facts.

Owned data:

- `ParsedDocument` IR
- Parser pipeline configuration
- `DocumentContent`
- `DocumentMetadata`
- `TreeNode` / `LineWithMeta` / `LineMetadata`
- `Table` / `CellWithMeta`
- `Annotation`
- Recursive attachments
- Parser warnings
- Parser confidence and freshness

Invariants:

- IR has no answer text, no recommendations, and no Copilot prose.
- All derived indexes can be rebuilt from metadata plus IR.
- Unsupported or partially parsed files produce warnings, not silent certainty.
- Attachments are first-class nested `ParsedDocument` records even when the MVP
  only records an unsupported-attachment warning.

### Layer 4: Evidence And Answering

Purpose: turn search results and IR nodes into a grounded response.

Owned data:

- Evidence Pack
- Coverage score
- Included/excluded roots
- Candidate ranking explanation
- Warning-driven answer downgrade
- Deterministic Relay draft
- Optional Copilot polish output

Invariants:

- Search snippets are candidate evidence, not final proof.
- Important conclusions require exact-file reads or indexed IR evidence.
- Relay can return a useful candidate list without Copilot.
- Copilot may polish wording, but it does not get to invent searched paths,
  evidence, or completion status.

## Subsystems

### Workspace Registry

Responsibilities:

- Store roots selected by the user or inferred from explicit requests.
- Record whether a path is local, mapped drive, UNC/network, removable, or
  unavailable.
- Apply scan policy: `metadata_first`, `manual`, `exclude`, or future
  `content_first_for_small_roots`.

### Path Security Boundary

Responsibilities:

- Canonicalize every local, mapped-drive, and UNC path before scan, parse,
  preview, open, or support-export handling.
- Preserve display paths separately from canonical identity paths; do not rely
  on lossy lowercasing for file identity.
- Reject path traversal, ambiguous roots, and candidates outside the registered
  workspace root.
- Apply the same denylist, hidden/system-folder policy, and path-boundary checks
  to scanner output, filesystem watcher events, periodic reconciliation, query
  paths, and attachment paths.
- Treat symlinks, junctions, and Windows reparse points as explicit policy
  decisions. The default is to not follow links that escape the registered root.
- Normalize Windows extended-length paths and long paths without truncation.
  Preserve display paths separately from canonical `\\?\` or UNC identity paths.
- Detect DFS, mapped-drive, UNC, OneDrive/SharePoint sync-provider, and
  placeholder/offline-file states where the platform exposes them. A cloud
  placeholder that is not locally available is searchable by metadata only and
  must not be treated as content evidence until hydrated/readable under the
  current user.
- Avoid creating an existence oracle for denied paths: denied or out-of-boundary
  paths report a policy reason without confirming unrelated file existence.
- Redact or root-relative shorten paths in support exports according to the
  same Evidence Pack redaction policy.

Invariants:

- Boundary checks happen before any file is parsed, read, indexed, previewed, or
  opened.
- A path accepted by one subsystem is not implicitly trusted by another
  subsystem; every candidate passes through the shared boundary module.
- Long path, DFS, sync-provider, and placeholder handling is tested on Windows
  before release; unsupported platform states downgrade results with structured
  warnings instead of falling back to Copilot prose.

### Process Coordination And Store Locks

Relay-branded AionUi can be launched more than once, and updater/restart flows
can leave old processes behind. The search store and executor therefore need a
single-writer contract:

Current implementation foundation:

- `relayDocumentSearchIndexCoordinator.ts` implements an advisory
  `RelayDocumentSearchIndexCoordinator.v1` lock with owner id, pid, app
  version, acquired/heartbeat times, active job ids, stale-lock recovery, and
  JSONL health events.
- `executeRelayDocumentSearch()` can opt into the coordinator through
  `useIndexCoordinator` or `RELAY_DOCUMENT_SEARCH_INDEX_COORDINATOR=1` and
  reports lock/busy/recovery events in diagnostics.
- `relayDocumentSearchJobStore.ts` implements a durable
  `RelayDocumentSearchJobStore.v1` snapshot store. When enabled, duplicate
  equivalent searches from another process attach to the active job snapshot,
  and stale active snapshots are marked `abandoned` before a new scan starts.
- The current coordinator does not yet replace the future SQLite/FTS store. It
  is the single-writer and health-event contract that persistent indexing must
  reuse.

- Use one writer lock per search database. Read-only UI views may attach while a
  writer is active, but only one process may mutate metadata, indexes, jobs, or
  cache state.
- Record lock owner process id, app version, started time, heartbeat time, and
  active job ids.
- Treat a stale lock as recoverable only after proving the owner process is gone
  or its heartbeat has exceeded the stale threshold.
- When a second Relay/AionUi window starts, it should attach to the active
  provider/executor where possible instead of starting duplicate scans.
- Job takeover after crash is explicit: incomplete jobs become `partial` or
  `abandoned`, and the next run may resume metadata scan/index work but must not
  silently continue a user-visible answer as if uninterrupted.
- Startup repair handles stale locks before index health checks and records the
  action in `index_health_events`.

Acceptance:

- Two windows cannot corrupt the same index DB or run competing full scans over
  the same root.
- Killing the writer process leaves a recoverable stale lock and explainable
  partial jobs, not a permanently broken search store.
- Support export can show which process owned or recovered the lock without
  including file contents.

### Permission And ACL Freshness

Shared folders change permissions independently from file content. Relay should
treat access state as freshness data, not as a generic parser failure.

Responsibilities:

- Record the last successful metadata access, content access, preview access,
  and open-action access separately.
- Distinguish `access_denied`, `not_found`, `offline_share`, `locked_file`,
  `policy_denied`, and `permission_changed` in warnings and sync journal events.
- Mark content evidence stale or unavailable when a previously readable file
  becomes unreadable under the current user account.
- Keep filename metadata searchable only when policy allows showing the path;
  otherwise downgrade to a redacted/denied result or remove it from active
  results according to workspace policy.
- Recheck access before preview, open, parse, and Evidence Pack expansion.
- Preserve previous good parsed/indexed content only as stale historical data
  when current access is denied; do not use it as fresh evidence.

Invariants:

- Relay never escalates privileges, impersonates another user, or bypasses
  Windows/share ACLs.
- Access failures are explainable in index status and support export without
  leaking contents of denied files.

### Metadata Scanner

Responsibilities:

- Walk roots incrementally.
- Persist path, file name, extension, size, mtime, and basic type hints.
- Skip denied paths and unsupported file types with explicit reasons.
- Pass all discovered paths through the path security boundary before storing
  metadata or scheduling content work.
- Emit progress events and partial availability.

### Sync Journal

Responsibilities:

- Record `created`, `modified`, `deleted`, `moved`, `scan_failed`,
  `parse_failed`, and `stale_marked` events.
- Preserve enough event history to explain why a result is missing or stale.
- Use filesystem watchers where reliable and periodic scan reconciliation for
  mapped drives, UNC paths, and missed events.
- Coalesce duplicate events without hiding the latest state.
- Feed stale-state decisions before search ranking so stale content is never
  presented as fresh evidence.

### Delete / Move / Rename Semantics

Responsibilities:

- Preserve a stable `file_id` across rename or move when identity confidence is
  high. Prefer platform file ids where available; otherwise use guarded
  size/mtime/hash heuristics.
- Record old paths as tombstones instead of silently erasing history.
- Migrate pins, search history, and derived index ownership to the new path only
  when move confidence is high.
- Remap derived indexes without reparsing only when the content identity is
  unchanged and parser parameters remain compatible.
- Treat low-confidence move detection as `deleted` plus `created`.
- Keep old Evidence Packs historically honest: show `moved`, `deleted`, or
  `stale` state rather than rewriting previous answers to the new path.
- Include previous path, new path, move confidence, and decision reason in
  support export.

Invariants:

- Deleted files disappear from active search results, but tombstones remain
  available for diagnostics and stale Evidence Pack explanation.
- A moved file is never shown as fresh evidence until freshness checks confirm
  the active metadata and derived indexes match the new path.

### Filename Cache

Responsibilities:

- Rebuild in memory from the metadata store on startup.
- Update incrementally while scans run.
- Support substring, token, and CJK-friendly matching.
- Return results with `filename_only` evidence state and coverage metadata.

### Parser Registry

Responsibilities:

- Select ordered parser candidates with `can_read(file_path, extension, mime,
  profile, parameters)`.
- Run converter/reader/metadata/structure/table/attachment/warning steps.
- Persist parser identity, profile, version, confidence, and warnings.
- Use reader capabilities when deciding whether a parser is suitable for a
  requested evidence task.

### Reader Capability Registry

Responsibilities:

- Describe each reader with explicit capabilities, including tables,
  annotations, attachments, page anchors, cell anchors, cached formula values,
  OCR, hidden-state reporting, and maximum safe budgets.
- Return `yes`, `no`, or `degraded` from `can_read`, with machine-readable
  reasons and warning defaults.
- Record capability profile, reader version, confidence defaults, parser
  parameters, and missing capabilities in Query Trace and parse diagnostics.
- Map reader-specific warnings into the shared warning taxonomy.
- Prevent search and Evidence Pack code from claiming support for evidence a
  selected reader cannot produce.

Invariants:

- A file can be filename-searchable even when no reader can produce content
  evidence.
- Missing capabilities lower evidence confidence; they do not cause Relay to
  invent anchors, tables, annotations, OCR text, or formula values.

### Indexer Backpressure And Scheduling

Responsibilities:

- Maintain bounded queues for metadata scan, content parse, derived-index build,
  preview build, and optional heavy-feature jobs.
- Prioritize foreground query expansion over idle background indexing while
  respecting per-root and per-drive concurrency limits.
- Throttle mapped drives and UNC/network roots more conservatively than local
  disks.
- Support pause/resume from UI, low-resource detection, and cancellation tokens
  for long-running parse/index jobs.
- Persist scheduler state so Relay can resume after restart without restarting
  a large shared-folder crawl from scratch.
- Expose queue depth, running jobs, throttled roots, paused state, promoted
  query files, and budget decisions in index status and Query Trace.

Invariants:

- Filename cache updates remain on the fast path even when content queues are
  saturated.
- A query can promote a small candidate set, but cannot force unbounded parsing
  of an entire deep folder tree.

### Index Builder

Responsibilities:

- Derive FTS/n-gram/table/preview indexes from `ParsedDocument` only.
- Mark stale derived indexes when metadata changes.
- Rebuild indexes without rereading original files when IR is still fresh.

### Search Coordinator

Responsibilities:

- Execute filename, content, hybrid, evidence, and similar-document searches.
- Merge rankings without hiding coverage and warning state.
- Keep search deterministic and inspectable.
- Optionally accept Copilot-suggested terms, but never delegate coverage or
  evidence decisions to Copilot.
- Merge hybrid rankings with explicit components: filename rank, keyword rank,
  table rank, recency, pin/history boosts, folder grouping, warning penalties,
  and future semantic rank.

### Evidence Pack Composer

Responsibilities:

- Convert search hits into per-query evidence.
- Track source, anchor, snippet, parser warnings, freshness, and coverage.
- Reject unsupported claims before an answer is shown.
- Export only the minimal selected snippets needed for optional AI polish.

Current implementation foundation:

- `relayDocumentSearchQualityGates.ts` emits
  `RelayDocumentSearchQuality.v1` with coverage, evidence, and freshness
  confidence.
- The executor reports `answerPolicy` and
  `canAskCopilotForFinalAnswer` so candidate-only or incomplete searches cannot
  silently become final Copilot prose.

### Product Search Surface

Responsibilities:

- Show folder/indexing state before and during search.
- Let the user choose or inspect search mode: filename, content, hybrid,
  evidence, similar, and future semantic.
- Show whether each result is filename-only, content-backed, stale, failed, or
  skipped.
- Provide preview and open-file actions independently from AI answers.
- Keep the search interface useful when Copilot is signed out or disabled.

### GuidPage-First Beginner Journey

AionUi v1.9.25 already has a first-run task surface at `/guid`. Relay should
reuse that surface instead of adding another beginner document-search page.

The beginner journey is:

1. Choose a curated task: `資料を探す` or `Officeファイルを編集する`.
2. Select a folder or keep the recent workspace in the existing `GuidActionRow`
   workspace control.
3. Use an example prompt or type a request in `GuidInputCard`.
4. Start the conversation through AionUi's normal send flow
   (`GuidInputCard` submit, `GuidActionRow` send, or later `SendBox` send).
5. Review chat results with AionUi result cards backed by Relay contracts.
6. Open a file in `PreviewPanel`, open it externally, or refine the query from
   the same conversation.

This keeps the user's mental model simple: Relay Agent opens to "what do you
want to do?" and AionUi continues with its normal conversation, workspace,
preview, file-mention, and command UX.

AionUi actually renders `/guid` task choices from preset assistant records, not
from arbitrary Relay metadata. Therefore `資料を探す` must be one
Relay-managed preset assistant entry (`relay-workspace-search`) with localized
name, description, examples, context, and enabled skills. Search, content
checking, and evidence-backed summary remain internal stages behind that one
entry, so beginners do not have to decide whether they are "searching" or
"summarizing" before starting.

At runtime, `資料を探す` should not ask Copilot to hand-pick raw filesystem
tools as the first step. If the OpenAI-compatible tool catalog advertises
`relay_document_search`, `relay-document-search`, `workspace_document_search`,
`workspace-search`, or `find-files`, Relay routes document search and local
document summary intents to that high-level tool first. Raw `glob`, `grep`, and
`read` remain fallback/substep tools for runtimes that do not advertise the
high-level contract or for narrower follow-up work after the document-search
pipeline has returned evidence.

Beginner controls that must remain visible:

- `AssistantSelectionArea`: curated task/assistant selection.
- `GuidInputCard`: prompt text, examples, selected files, and selected
  workspace context.
- `GuidActionRow`: folder selection, file attachment, quick actions, and send.
- Workspace search in the right panel after the conversation starts.
- Preview/open actions on each result.

Avoid forced tutorials. UX research favors letting users skip or go back during
onboarding, so Relay should use lightweight empty states and examples rather
than blocking first use behind a tour.

The `GuidActionRow` plus menu should keep file/folder actions but hide the
auto-injected skills submenu in beginner mode. AionUi still loads the right
skills through the selected preset; the user should not have to inspect or
toggle implementation skills before searching.

The main input is the primary CTA. Treat `GuidInputCard` as a search/task bar,
not as a passive chat box, and do not add a separate `検索開始` button. Search
starts when the user sends the normal AionUi task/message. It should support
task-aware examples and recent suggestions, for example:

- `このフォルダからキャッシュフロー計算書に関係するファイルを探して`
- `このPDFを根拠つきで要約して`
- `このExcelファイルの指定セルを編集して`
- `このフォルダの最新の報告書を探して`
- `この資料を開いて要点と根拠ページをまとめて`

The examples should adapt to the selected task, recent workspace, and visible
file context. They should not expose upstream assistant names, parser terms, or
implementation concepts.

### Search UX State Model

Search should never collapse all states into "searching" or "0 results." The
beginner UI uses plain labels while advanced details keep parser/index terms.
The default mode is `しっかり検索`: filename hits may appear early, but final
answer text waits for content-backed or Evidence Pack-backed confirmation, or
clearly reports incomplete coverage.

- `フォルダ未選択`: search needs a folder. Show the folder button and recent
  workspaces.
- `準備中`: Relay is scanning metadata and planning the search scope.
- `候補を表示中`: early filename/path candidates are visible as progress. They
  are not final findings.
- `ファイルの中身まで確認中`: content parsing/indexing, exact reads, or Evidence
  Pack expansion is running for the default thorough path.
- `確認済みの結果`: show only content-backed or evidence-backed result cards with
  match type, preview/open actions, and coverage state.
- `結果なし`: show next actions, not a dead end: broaden keywords, change
  folder, remove extension filters, try synonyms, or wait for content indexing.
- `一部のみ検索`: show that some folders/files were skipped, denied, stale, or
  still indexing.
- `権限なし`: explain the current Windows account cannot read the selected path.
- `失敗`: show retry and support detail actions without asking the user to open
  a terminal.

No-results states should include suggestions and autocomplete-like affordances:
recent folders, recent searches, detected filename tokens, extension chips, and
domain synonyms such as `C/F`, `CF`, `CFS`, and `キャッシュフロー`.

Progressive disclosure rule:

- Beginner view shows status chips, result cards, preview/open, and simple
  recovery actions.
- Details drawer shows Query Trace, parser warnings, skipped files, analyzer
  expansions, and Evidence Pack ids only when the user opens support details.

### Search Result Card UX

Search results are product objects, not terminal output. Every result card
should carry enough visible information to decide whether it is useful:

- Title or filename.
- Root-relative path with copy-path action.
- Modified time or freshness indicator.
- Match reason such as filename, content, table/cell, heading, or recent
  workspace history.
- Match mode: filename, keyword, hybrid, evidence, or similar.
- Index/evidence state: candidate-only, filename-only, content-indexed,
  evidence-backed, content-pending, stale, skipped, denied, or failed.
- Warning state when evidence is partial, stale, truncated, unsupported, or
  permission-limited.

Every result card should expose these actions without requiring the user to
understand tools:

- Preview in `PreviewPanel`.
- Open file externally.
- Copy path.
- Use as evidence for the current answer.
- Refine search from this file or folder.

Answer wording must respect the card state. Use candidate language until the
claim is backed by current Evidence Pack items. Examples:

- Filename-only: "候補です。内容確認はまだです。"
- Thorough search running: "候補を表示しています。ファイルの中身まで確認しています。"
- Partial index: "このフォルダは一部のみ検索済みです。"
- Evidence-backed: "根拠として確認したファイルです。"

### Empty And Recovery States

Empty states are part of the search workflow, not errors by default. They should
offer concrete next actions:

- Select or change folder.
- Broaden keywords.
- Try related terms or synonyms.
- Clear extension/type filters.
- Show indexing status.
- Retry denied or failed folders where appropriate.

Avoid telling the user to open a terminal. Beginner recovery stays inside
AionUi's existing workspace/search/conversation surfaces; advanced diagnostics
remain available for support.

## Artifact Boundaries

The implementation must keep these artifacts separate:

- FileRecord / FileMetadata: what files exist, where they live, size/mtime,
  extension/type guesses, scan state, root ownership, access snapshots, and
  freshness. This is produced only by the workspace scan/sync layer.
- ParsedDocument IR / DocumentMetadata: what a selected file contains,
  expressed as document structure, document-internal metadata, tables,
  annotations, warnings, and attachments. This is produced only by the
  parser/reader layer from an existing FileRecord snapshot.
- Derived indexes: filename cache, FTS, n-gram indexes, table indexes, previews,
  future vectors, and similar-document links. These are rebuildable.
- Evidence Pack: the subset of FileMetadata and IR-derived matches used for one
  user query.
- Answer: a Relay draft or Copilot-polished response generated from an Evidence
  Pack.

No layer may write claims backwards into a lower layer. For example, a cash-flow
query can create Evidence Pack relevance scores, but it must not mutate the IR
to say a workbook is "the cash-flow source of truth."

### FileMetadata And DocumentMetadata Boundary

Docufinder-style metadata scanning and Dedoc-style parsing must not become two
competing discovery systems:

- `FileMetadata` is filesystem-derived: root id, canonical path, display path,
  filename, extension, size, mtime, ctime where available, file id, access
  state, scan state, sync state, and type guess.
- `DocumentMetadata` is document-derived: parser uid, document title/subject,
  author fields when available, mime type, parser profile, document-specific
  timestamps, page/sheet counts, warnings, and parser provenance.
- The parser never walks folders, expands globs, decides roots, or updates
  access snapshots. It receives a `FileRecord` plus a source metadata version
  and returns a `ParsedDocument` or a parser warning.
- The scanner never reads full Office/PDF content to infer document structure.
  It may do bounded file-type sniffing only when needed for safe scheduling and
  warning classification.
- `ParsedDocument.source_file_id` and `ParsedDocument.source_metadata_version`
  are mandatory. When FileMetadata changes, existing ParsedDocument and derived
  indexes become stale until rebuilt from the new FileRecord snapshot.
- Search, ranking, Evidence Pack generation, and support export must name which
  layer supplied each fact: file metadata, document metadata, IR node/table, or
  derived index.

## AI Boundary Contract

AI is a consumer of local search, not the search engine:

- Local search, index status, previews, and validated local draft must work with
  Copilot signed out or disabled.
- Optional Copilot polish receives only the user question, validated local
  draft, and selected Evidence Pack snippets.
- Original files are never uploaded for polish.
- Copilot output is accepted only if validation proves every file, path, and
  claim is present in the Evidence Pack.
- If validation fails, AionUi shows the validated local draft and Relay records
  a polish rejection metric.
- Online summaries are optional. Offline extractive summaries from IR/evidence
  are preferred for privacy-sensitive folders.

## Copilot Integration Protocol

M365 Copilot is integrated through Relay's OpenAI-compatible provider gateway,
but it is never the local execution authority. The integration has four explicit
phases:

1. **Intent capture**: Copilot may restate the user's intent or suggest query
   terms, abbreviations, file-type hints, and clarification questions.
2. **Tool-call entry**: when a high-level document-search tool is advertised,
   Copilot's first model-visible tool call must be `relay_document_search` or a
   schema-compatible alias. Raw filesystem/tool calls are rejected before
   execution.
3. **Local execution**: Relay/AionUi executes search, indexing, reading,
   evidence packaging, and result rendering locally. Copilot is not consulted
   for coverage, file access, ranking authority, or evidence state.
4. **Optional polish**: after Relay creates a validated local draft and Evidence
   Pack, Copilot may rewrite wording only within a strict citation-bound answer
   contract.

The local executor can run without Copilot. If Copilot is signed out, disabled
by policy, warming up, disconnected, rate limited, tenant restricted, or if CDP
capture is unhealthy, AionUi still shows result cards and the validated local
draft. Copilot polish is skipped or queued only when the user explicitly asks to
retry polish; search jobs do not wait indefinitely for Copilot.

### Copilot Prompt And Template Versioning

Every Copilot-facing prompt must have an id, semantic version, input schema,
expected output schema, and deterministic tests:

- `relay_document_search_tool_prompt.v1`: makes `relay_document_search` the
  first tool call for document-search intents.
- `relay_document_search_repair_prompt.v1`: repairs invalid or low-level first
  tool calls only toward the high-level tool.
- `relay_query_suggestion_prompt.v1`: requests optional related terms,
  abbreviations, file-type hints, or clarification questions.
- `relay_answer_polish_prompt.v1`: rewrites the validated local draft using
  only cited Evidence Pack items.
- `relay_polish_repair_prompt.v1`: one strict retry when Copilot returns prose
  that is not citation-bound or introduces unsupported claims.

Prompt versions are recorded in Query Trace and support export. A prompt change
that alters tool choice, accepted arguments, citation format, or polish output
requires fixture updates and regression tests before release.

### Copilot Correlation And State Model

Every search/polish turn must preserve correlation ids across AionUi, Relay, and
Copilot:

- `aionui_conversation_id`
- `aionui_message_id`
- `relay_job_id`
- `query_id`
- `tool_call_id`
- `copilot_session_id`
- `copilot_request_id`
- `copilot_turn_id`
- `evidence_pack_id`
- `local_draft_id`
- `polished_answer_id`
- `prompt_template_id` and `prompt_template_version`

State transitions are explicit:

- `copilot_ready`
- `copilot_warming`
- `copilot_sign_in_required`
- `copilot_disconnected`
- `copilot_capture_unhealthy`
- `copilot_timeout`
- `copilot_rate_limited`
- `copilot_tenant_restricted`
- `copilot_policy_disabled`
- `polish_skipped`
- `polish_rejected`
- `polish_accepted`

A Copilot state change can affect optional suggestion/polish behavior, but it
cannot invalidate already computed local search results. AionUi renders search
state from `RelayDocumentSearchResult.v1`, not from Copilot DOM text.

### Citation-Bound Polish Validation

Copilot polish is accepted only when it satisfies a strict answer contract:

- Output must be structured or parseable into:
  - `answer_markdown`
  - `claims[]`
  - `citations[]`
  - `used_evidence_ids[]`
  - `omitted_evidence_ids[]` when relevant
- Every factual claim must cite at least one `evidence_id` from the current
  Evidence Pack.
- Every mentioned file, path, sheet, cell, page, date, amount, or count must be
  present in the Evidence Pack or local draft.
- Copilot may not introduce new files, paths, searched folders, completion
  status, unsupported recommendations, or stronger certainty than the weakest
  relevant confidence dimension permits.
- Filename-only candidates must remain candidate language even if Copilot tries
  to make them final.
- If the response is duplicated, truncated, unstructured, contains unsupported
  claims, or loses required citations, Relay performs at most one strict polish
  repair retry. If that retry fails, AionUi shows the validated local draft and
  records `polish_rejected`.

The UI must not stream arbitrary Copilot prose into the final result card.
Streaming is allowed only for progress/status placeholders. Final answer content
is committed once: validated local draft first, then accepted Copilot polish if
available and valid.

## Enterprise Policy And Local-Only Controls

Relay must be useful in managed Windows environments where administrators may
limit local indexing, network scanning, or external AI sharing. The product
defaults stay beginner-friendly, but the executor must read an explicit policy
layer before scanning or sending evidence to Copilot.

Policy-controlled settings:

- `documentSearch.enabled`: enable or disable Workspace Document Search.
- `documentSearch.allowedRoots` / `documentSearch.deniedRoots`: constrain which
  local, mapped, or UNC roots can be registered.
- `documentSearch.contentIndexing`: `enabled`, `metadata_only`, or `disabled`.
- `documentSearch.copilotPolish`: `enabled`, `redacted_only`, or `disabled`.
- `documentSearch.cacheProtectionRequired`: require at-rest protection before
  storing extracted text/IR.
- `documentSearch.maxRootCount`, `maxFilesPerRoot`, `maxCacheBytes`, and
  `maxNetworkConcurrency`.
- `documentSearch.supportExport`: `metadata_only`, `evidence_snippets_allowed`,
  or `disabled`.

Invariants:

- Policy denial returns `needs_input` or `partial` with beginner-safe guidance;
  it does not fall back to hidden raw tools or Copilot prose.
- AionUi shows policy-limited states as product states, not as broken setup.
- Support diagnostics include active policy values after redaction so support
  can distinguish a bug from a managed restriction.

## Data Model

### Workspace

```json
{
  "id": "workspace-uuid",
  "display_name": "Finance shared drive",
  "roots": [
    {
      "id": "root-uuid",
      "path": "H:/example/shared/root",
      "kind": "local_or_network",
      "scan_policy": "metadata_first",
      "status": "filename_searchable"
    }
  ]
}
```

### File Metadata

```json
{
  "file_id": "stable-id",
  "workspace_id": "workspace-uuid",
  "root_id": "root-uuid",
  "path": "H:/example/shared/root/report.xlsx",
  "name": "report.xlsx",
  "extension": "xlsx",
  "size": 123456,
  "mtime": "2026-05-09T00:00:00Z",
  "index_state": "filename_searchable",
  "content_status": "content_pending",
  "last_scan_error": null
}
```

### Stores

MVP storage should be local and rebuildable:

- `workspace_roots`: registered roots and scan policy.
- `file_metadata`: one row per discovered file, containing only
  filesystem-derived FileMetadata and scan/access state.
- `path_tombstones`: deleted, moved, renamed, and denied-path diagnostics.
- `filename_terms`: optional persisted terms for faster startup; otherwise
  rebuilt from `file_metadata`.
- `indexer_jobs`: queued, running, paused, failed, promoted, and throttled
  scheduler work.
- `access_snapshots`: last known access result, ACL/freshness state, and
  permission-change diagnostics for each file/root.
- `parsed_documents`: serialized `ParsedDocument` payloads keyed by file id,
  source FileMetadata version, parser profile, and parser version.
- `converter_lineage`: source file, converter, temporary converted artifact,
  reader input, and cleanup/audit state.
- `reader_capabilities`: registered reader capabilities, versions, confidence
  defaults, and warning mappings.
- `feature_pack_registry`: installed/enabled/disabled optional search and parser
  packs, versions, capabilities, and local model/dependency state.
- `parse_warnings`: normalized warning rows for diagnostics and downgrade.
- `content_nodes_fts`: FTS over `TreeNode` text.
- `table_cells_fts`: FTS over table/cell text.
- `preview_spans`: compact preview material derived from IR.
- `attachment_index`: parent-child attachment references, attachment anchors,
  parse state, and skipped-attachment warnings.
- `sync_journal`: recent filesystem and indexing events for diagnostics.
- `index_health_events`: integrity checks, rebuilds, compaction, checkpoints,
  corruption recovery, and cancelled repair actions.
- `search_results_cache`: short-lived query result materialization for UI
  pagination and support export.
- `normalization_rules`: versioned query/index normalization and synonym rules.
- `golden_queries`: local evaluation definitions for curated fixtures.
- `search_history` and `pins`: user-confirmed useful files/folders.

SQLite with FTS is the default store shape because it matches the local-first
Docufinder model and avoids adding server infrastructure. Vector/semantic
stores are optional derived stores in Phase 6.

Implemented first-pass readiness boundary: `RelayDocumentSearchIndexDbHealth.v1`
is emitted by index maintenance results to make the active JSON-store backend,
future SQLite/FTS required tables, content-bearing tables, DB-only actions, and
unsupported/not-enabled state explicit. Implemented follow-up:
`RelayDocumentSearchIndexDb.v1` can initialize the local SQLite schema and FTS5
tables when explicitly enabled, and index maintenance can run real WAL
checkpoint and compact actions against that backend. Implemented next slice:
`RelayDocumentSearchIndexDb.v1` can mirror cached file metadata and
`RelayDocumentSearchDerivedSearchStore.v1` rows into SQLite FTS tables and run
bounded content/table FTS searches. Implemented runtime mirroring: when
`useIndexDb` or `RELAY_DOCUMENT_SEARCH_INDEX_DB=1` enables the backend, the
executor writes filtered metadata and derived search-store rows into SQLite/FTS,
runs a bounded FTS probe, and reports content-free diagnostics. Implemented
first ranking integration: content-confirmed results can carry a
`sqlite_fts_index` source index and bounded `sqlite_fts` score component when
the same file already has JSON-derived evidence anchors. Implemented guarded
evidence-anchor promotion: SQLite/FTS search rows carry preview/source metadata
and serialized anchor JSON, and the executor promotes FTS-only hits only when
the row source metadata matches the current file and anchor plus preview data
are present. Stale or incomplete rows are counted but not promoted. Implemented
schema migration hardening: schema revision `2`, migration audit rows,
preview-span expansion migration state, and SQLite `user_version` are reported
through index maintenance health. Implemented first cutover diagnostics:
runtime metadata writes, derived-store writes, and FTS searches propagate the
same schema revision and migration state into executor `diagnostics.indexDb`.
Implemented first cutover readiness summary:
`diagnostics.indexDb.cutoverReadiness` reports status/reason codes plus schema,
migration, write, search, and evidence-promotion readiness booleans, including
backend write/search report errors. Implemented first result-usage diagnostics:
`diagnostics.indexDb.resultUsage` separates FTS-scored candidate/result counts
from FTS-promoted evidence counts and returned SQLite score totals. Implemented
first sync-journal cutover telemetry: metadata-only search completion events
record index DB enablement, readiness status/reasons, matched-file count,
scored-result count, and promoted-result count without storing extracted
content. Implemented first Query Trace cutover facts: `index_db` stages now
carry SQLite/FTS enablement, readiness, result-usage, stale-row, and backend
error counters for support surfaces without storing extracted content.
Implemented first support display cutover facts: AionUi support detail items
now surface Query Trace `index_db` readiness, result-usage, stale-row, and
error counters while omitting DB paths and document content. Implemented first
metadata-only support export: `RelayDocumentSearchSupportExport.v1` summarizes
coverage, result metadata, selected diagnostics, and SQLite/FTS cutover state
without original files, raw DB paths, or extracted text by default. Evidence
snippets require an explicit selected-snippet mode. Implemented first
support-export cache quota/protection summary: exports now summarize
ParsedDocument cache protection policy, quota pressure, eviction counts by
reason, and derived-index cache activity without exposing cache directories or
evicted record paths. Implemented first cutover tuning for stale/incomplete
SQLite/FTS rows: the executor records reason counts for rows blocked by source
metadata mismatch, missing parsed-document uid, missing preview text, or
missing anchor data, and Query Trace, support display details, and support
export surface those counts without DB paths or document content. Implemented
first cutover tuning for bounded FTS result limits: searches now report max
rows, raw row counts, dropped row counts, and truncation state. Query Trace,
sync-journal telemetry, support details, and cutover readiness now mark when
the FTS result limit was reached without exporting raw rows or document text.
Implemented follow-up cutover tuning for FTS rows outside the current scan:
executor diagnostics now count FTS rows/files returned for file ids that are
not in the current filtered scan set, keep them out of evidence promotion,
surface the counts through Query Trace, sync-journal telemetry, support details,
and metadata-only support export, and mark cutover readiness degraded with
`fts_rows_outside_current_scan` without exporting raw rows or document text.
Implemented follow-up cutover coverage diagnostics for current-scan FTS rows:
executor diagnostics now count FTS rows/files that do belong to the current
filtered scan set separately from outside-scan rows, and surface those counts
through Query Trace, sync-journal telemetry, support details, and metadata-only
support export without exporting raw rows or document text.
Implemented follow-up fresh-row scoring hardening: SQLite/FTS ranking now uses
only current-scan rows that pass source metadata, ParsedDocument uid, preview
text, and anchor validation; stale/incomplete current rows are still diagnosed
but no longer boost ranked results or count as fresh cutover evidence.
Implemented follow-up result-usage split for SQLite/FTS matched files:
`diagnostics.indexDb.resultUsage` now separates raw FTS matched files from
current-scan, fresh-current-scan, and outside-current-scan matched files, and
surfaces that split through Query Trace, support details, and metadata-only
support export.
Implemented follow-up stale current-scan diagnostics: executor diagnostics now
count stale/incomplete FTS rows that belong to files in the current filtered
scan set as `staleCurrentScanFtsRowCount` and
`staleCurrentScanFtsFileCount`, and surface those counts through Query Trace,
sync-journal telemetry, support details, and metadata-only support export.
Implemented follow-up result-usage split for stale current-scan matched files:
`diagnostics.indexDb.resultUsage` now includes
`staleCurrentScanMatchedFileCount` alongside raw, current, fresh, and outside
matched-file counts, so support surfaces can identify current-scan SQLite/FTS
matches that were stale or incomplete without exporting raw rows or document
text.
Implemented follow-up sync-journal telemetry for the same matched-file split:
metadata-only `search_completed.details` now records current-scan,
fresh-current-scan, stale-current-scan, and outside-current-scan matched-file
counts alongside the raw FTS matched-file count without storing raw rows or
document text.
Implemented follow-up sync-journal stale reason telemetry:
metadata-only `search_completed.details` now records stale SQLite/FTS row
counts and compact `reason=count` summaries for stale/incomplete FTS rows
without storing raw rows, DB paths, or document text.
Implemented follow-up sync-journal readiness breakdown telemetry:
metadata-only `search_completed.details` now records schema, migration, write,
search, and evidence-promotion readiness booleans alongside the cutover status
and reason codes without storing raw rows, DB paths, or document text.
Implemented follow-up Query Trace readiness breakdown telemetry: `index_db`
stage facts now carry the same schema, migration, write, search, and
evidence-promotion readiness booleans, support details display those gates
when present, and metadata-only support export preserves them without raw rows,
DB paths, or document text.
Implemented follow-up support export normalization: metadata-only support
export now allowlists SQLite/FTS cutover readiness and result-usage fields so
unexpected diagnostic fields cannot leak DB paths, raw rows, or document text
through `diagnostics.indexDb` or Query Trace `index_db` facts.
Implemented follow-up candidate score telemetry: SQLite/FTS `resultUsage` now
separates candidate score totals/max scores from returned-result score
totals/max scores, and surfaces that split through Query Trace, support
details, metadata-only support export, and sync-journal search completion
metadata without raw rows, DB paths, or document text.
Implemented follow-up non-returned candidate telemetry: SQLite/FTS
`resultUsage` now records scored/promoted candidates and score totals that did
not survive into the returned result set, while sync-journal completion
metadata records scored/promoted candidate counts alongside result counts
without raw rows, DB paths, or document text.
Implemented follow-up title/location ranking boost: fresh SQLite/FTS rows now
receive small title and location-label score boosts on top of the existing
text/table base score and cap, so persistent preview-span metadata can affect
deterministic ranking without exposing raw rows, DB paths, or document text.
Implemented follow-up metadata-boost diagnostics: executor diagnostics now
count fresh SQLite/FTS rows and files that received title/location ranking
boosts, and surface those counts through Query Trace, support details,
metadata-only support export, and sync-journal completion metadata without raw
rows, DB paths, or document text.
Implemented follow-up metadata-boost split diagnostics: the same support
surfaces now split fresh SQLite/FTS metadata boosts into title-derived and
location-label-derived row/file counts, while preserving the combined counters
for compatibility and avoiding raw rows, DB paths, or document text.
Implemented follow-up score-cap diagnostics: SQLite/FTS `resultUsage` now
records candidate/returned uncapped score totals, cap-loss totals, and capped
candidate/result counts so ranking saturation is visible in Query Trace,
support details, metadata-only support export, and sync-journal completion
metadata without changing capped ranking behavior or exposing raw rows, DB
paths, or document text.
The broad SQLite/FTS cutover tuning bucket is closed for MVP diagnostics.
Remaining work is split into explicit follow-up tasks:

- WDS01 real-data search-quality evaluation.
- WDS02 primary-path SQLite/FTS cutover gate.
- WDS03 large-folder performance tuning.
- WDS04 user-facing index-status UX.

Implemented WDS01 local search-quality evaluation:
`docs/WORKSPACE_DOCUMENT_SEARCH_SQLITE_FTS_EVALUATION.md` now records the
repository-local docs baseline with aggregate-only diagnostics and no snippets,
raw FTS rows, raw DB contents, absolute source paths, or copied documents. The
run exercises the real SQLite/FTS path and reports one expected-file hit across
four probes, degraded index DB state for all probes due to bounded FTS
truncation, no stale rows, and score-cap loss on two probes. WDS02 must treat
this as a "do not promote to primary yet" input until it defines explicit
cutover thresholds and rollback behavior.

Implemented WDS02 primary-path cutover gate:
SQLite/FTS primary mode is now Relay-controlled with `disabled`, `shadow`,
`primary`, and `rollback` modes. The active path is `sqlite_fts_primary` only
when cutover readiness is ready, the bounded FTS probe is not truncated, stale
or outside-current-scan rows are absent, write/search errors are absent, and at
least one fresh current-scan FTS row/file exists. Degraded or blocked states
fall back to `filename_content` and record rollback reasons in Query Trace,
support export, support display details, and sync-journal completion metadata.

Implemented WDS03 synthetic large-folder performance tuning:
`docs/WORKSPACE_DOCUMENT_SEARCH_SQLITE_FTS_PERFORMANCE.md` records aggregate-only
measurements for a synthetic 600-file / 1,800-row SQLite/FTS corpus, including
metadata write time, derived FTS write time, selective and broad search latency,
DB/WAL/SHM size, checkpoint cost, and scheduler per-root backpressure. The
runtime now separates the FTS candidate-scoring probe cap from the 3-anchor
citation cap: `indexDbSearchMaxRows` defaults to 20, can be overridden by
Relay-controlled options or `RELAY_DOCUMENT_SEARCH_INDEX_DB_SEARCH_MAX_ROWS`,
and is bounded to 100 rows. Broad truncated probes still keep WDS02 primary
mode in rollback.

Implemented WDS04 user-facing index-status UX:
the display adapter now exposes beginner-safe `indexStatus`,
`partialResultExplanations`, and `repairActions` fields. Normal details include
an `索引状態` section with active-path labels, readable reasons, and retry /
rebuild / status affordances, while support-only diagnostics remain available
separately for raw reason codes. Product result action models now add retry and
rebuild actions for stale or failed index states without exposing DB paths, raw
FTS rows, or document text.

New task list after WDS01-WDS04:

- WDS05: Completed cache quota, retention, and at-rest protection gate.
- WDS06: Completed scoped root removal and derived-cache cleanup.
  The confirmed `remove-root` maintenance action deletes selected-root metadata,
  parsed payload cache records, derived-content-index cache records, SQLite FTS
  rows, parsed-document rows, and preview spans while preserving unrelated
  roots, jobs, user memory, pins, and search-history policy. There is no
  separate short-lived root-scoped result cache in the current implementation.
- WDS07: Completed transactional content-index commit semantics.
  ParsedDocument and derived-content-index records now stage before active
  promotion, SQLite derived FTS/table/preview rows commit transactionally, and
  the active content-index pointer swaps only after required derived artifacts
  complete. Failed staging, DB writes, or cache promotion mark any previous
  pointer stale while keeping it available for fallback diagnostics.
- WDS08: Completed schema migration and rebuild recovery gates.
  Metadata cache, ParsedDocument cache, and SQLite/FTS now expose versioned
  migration/downgrade state. Newer durable or content-bearing cache/index
  records are preserved read-only instead of overwritten, while incompatible
  rebuildable stores are reported as rebuild-required. Index maintenance
  summarizes metadata, analyzer, parser pipeline, ParsedDocument cache, derived
  indexes, SQLite/FTS, Evidence Pack, result contract, and preserved user state
  through metadata-only schema-gate diagnostics, health events, Query Trace,
  and support export.
- WDS09: Completed golden-query search quality regression gate.
  The runnable gate creates a synthetic Markdown corpus, measures expected
  top-k coverage, folder skew, forbidden false positives, unsupported-claim
  prevention, expected warning codes, and latency, and writes the privacy-safe
  `docs/WORKSPACE_DOCUMENT_SEARCH_GOLDEN_QUERIES.md` artifact without original
  documents, snippets, raw FTS rows, DB contents, or absolute source paths.
- WDS10: Completed deterministic ranking and grouping score breakdown.
  Product results now expose `RelayDocumentSearchScoreBreakdown.v1` with
  component totals for filename, path, keyword, SQLite/FTS, content,
  table/cell, recency, pin/history, grouping, warning penalties, and hybrid
  merge behavior. Query Trace, support export, and display cards use the same
  metadata-only score contract.
- WDS11: Completed parser structure-profile validation gates.
  ParsedDocument IR now stores `RelayParsedDocumentStructureProfile.v1`
  metadata-only summaries keyed to the selected parser profile. The validator
  keeps tree nodes, tables, cells, annotations, metadata, warnings, and
  attachments as distinct channels, records lossy or unsupported reader
  behavior as warnings, rejects flattened text-only parser output, blocks
  invalid IR from ParsedDocument and derived-content caches, and carries the
  profile summary into Evidence Pack and executor diagnostics without exporting
  full IR or original file contents.
- WDS12: Completed AionUi result-flow continuation and stable selection.
  The display adapter now emits `RelayDocumentSearchResultFlow.v1` with
  capped-batch offsets, `show-more-results` continuation, refine actions,
  stable selection-key state, partial/index state summaries, and an explicit
  Copilot-prose-secondary marker. Bridge/MCP integration wraps the raw
  `RelayDocumentSearchResult.v1` plus `RelayDocumentSearchDisplay.v1` in a
  Relay-branded AionUi result-flow envelope.

The intended order is safety and retention first, then scoped deletion,
transactional index semantics, migration/rebuild recovery, quality regression,
ranking explainability, parser-profile validation, and finally the AionUi
result-flow integration that depends on the safer lower layers.

Implemented WDS05 cache quota/protection gate:
the content-bearing derived-content-index cache now mirrors the ParsedDocument
cache policy boundary. It supports `plaintext_allowed`,
`protection_required`, and `disabled` modes, declared protected-at-rest state,
entry/byte quota enforcement, invalid-record cleanup, deterministic oldest
eviction, and metadata-only policy/quota callbacks. The executor exposes those
summaries beside ParsedDocument cache diagnostics, the index report aggregates
quota pressure and protection denial, and support export strips cache paths,
raw snippets, raw FTS rows, DB paths, and document text while retaining counts,
limits, protection state, and eviction reasons.

### Cache Quota, Retention, And At-Rest Protection

Extracted text, IR, FTS indexes, snippets, pins, and history may contain
sensitive business information even when original files are not copied. The
first implementation must therefore define cache limits and local protection
before content indexing is enabled by default:

- Keep metadata, extracted text/IR, FTS/table/preview indexes, search history,
  pins, and short-lived result caches in separate logical stores so retention
  and deletion can be applied independently.
- Define default per-root and global cache quotas. When quotas are exceeded,
  evict disposable derived artifacts first, then old result caches, then stale
  parsed payloads; never evict workspace roots, user pins, or scan policy
  silently.
- On Windows, protect extracted text/IR/result snippets with user-scoped OS
  protection where feasible, such as DPAPI-backed encryption or an equivalent
  AionUi-native secure store. If at-rest protection is unavailable, content
  caching must be disabled or clearly downgraded to filename/metadata search
  until the user or policy allows plaintext local caches.
- Metadata-only caches may remain unencrypted only when paths are redacted or
  root-relative in support exports and local policy allows path storage.
- Workspace-root removal must offer deletion of derived metadata/text/index
  caches for that root and must leave unrelated roots intact.
- Uninstall/reinstall behavior is explicit: application uninstall should not
  silently leave content caches that the user cannot discover; support docs and
  diagnostics must show the cache location and cleanup action.
- Support export excludes original files, raw FTS databases, and full extracted
  text by default. Including evidence snippets is an explicit user action.

Acceptance:

- A support report can state cache size, quota pressure, encryption/protection
  state, and what was evicted without exposing document contents.
- Removing a root deletes that root's derived caches after confirmation and
  cannot delete another root's cache by path-prefix accident.
- Content indexing does not ship enabled-by-default on Windows unless the chosen
  at-rest protection or documented local-cache policy is implemented and tested.

### Index consistency and rebuild semantics

Indexing must be transaction-like even when parsing is slow:

- Metadata writes are committed before background content work starts.
- Parser output is written to a staging record first.
- Derived FTS/table/preview indexes are built from the staged
  `ParsedDocument`.
- The active content index pointer is swapped only after all required derived
  indexes for that parser version are complete.
- If parsing or index building fails, the previous active content index remains
  usable but is marked stale when the source metadata changed.
- Schema migrations may drop and rebuild derived indexes, but must preserve
  workspace roots, file metadata, pins, search history, and user-visible scan
  policy.
- Application upgrades write the previous schema/app version, attempted target
  version, and migration result before mutating stores.
- Failed migrations roll back to the previous active metadata/index state when
  possible. If rollback is not possible, Relay preserves workspace roots and
  user settings, disables stale content evidence, and asks for an explicit
  rescan instead of using questionable data.
- Downgrades to an older app version open the search store read-only or request
  rebuild; they must not write older schema data over newer stores.
- Rebuild actions are scoped: per file, per root, per parser version, or full
  search database.
- Index health actions are explicit: check integrity, checkpoint WAL, compact,
  rebuild derived indexes, rebuild one root, rebuild all metadata, and discard
  only disposable derived artifacts.
- If the metadata store is healthy but derived FTS/table/preview indexes are
  corrupt, Relay keeps metadata and pins while rebuilding only disposable
  artifacts.
- If the metadata store is corrupt, Relay preserves the workspace registry and
  user settings where possible, then requests an explicit rescan rather than
  pretending old evidence is reliable.
- Support export should include metadata, warnings, sync journal, and index
  health, but not original file contents unless the user explicitly chooses to
  include extracted snippets.

This mirrors Docufinder's "indexes, not original files" model while making
large shared-folder indexing safe to interrupt and resume.

### Index DB Health And Repair

Local search quality depends on the search database being repairable without
reinstalling Relay or deleting user state:

- Run lightweight startup health checks for schema version, missing tables,
  pending migrations, incomplete staging records, and stale WAL/checkpoint
  state.
- Record repair decisions in `index_health_events` with the affected roots,
  stores, schema versions, and whether the action was automatic or user-started.
- Support user-visible repair actions: retry failed files, rebuild derived
  indexes, rebuild previews, rebuild one root, compact database, and full
  rescan.
- Keep long repairs cancellable and scheduled through the same backpressure
  layer as parsing.
- Never treat a repaired index as fresh unless source metadata and parser
  versions match the active artifacts.

Invariants:

- Repair must not erase workspace roots, pins, search history, or scan policy
  unless the user explicitly chooses a destructive reset.
- Query Trace and support export must show when results came from an index that
  was recently repaired, rebuilt, or partially unavailable.

Implemented first index health event surfacing: maintenance actions can record
metadata-only `maintenance_completed` / `maintenance_failed` events with action,
status, store names, schema revision, missing required table counts, pending
required migration counts, WAL/SHM sidecar sizes, checkpoint recommendations,
and warning/error counts when the index coordinator event directory is supplied.
Index DB health also reports explicit `missingTables`, `pendingMigrations`,
incomplete ParsedDocument staging counts, and WAL checkpoint readiness facts.
Executor runs read recent health event summaries and expose them through Query
Trace, support-only details, and metadata-only support export without DB paths
or document contents. `rebuild-previews` now clears the rebuildable,
preview-bearing derived content cache while preserving metadata, filename
indexes, parsed document caches, pins, and job state; repair cache actions also
honor cancellation before destructive work. Maintenance actions can also be
queued through the document-search background scheduler as `index_maintenance`
work so long repairs share queueing, backpressure, and scheduler cancellation
metadata. `full-rescan` now clears metadata and rebuildable search indexes
while preserving user memory and job state. `rebuild-root` now clears one
root's metadata and filename index while preserving other roots, user memory,
job state, and content-bearing caches; when SQLite FTS is enabled it also
invalidates matching root rows. `retry-failed-files` now uses the same
metadata-only failure registry to select root-scoped failed-file candidates,
then invalidates only matching ParsedDocument/derived-content caches and SQLite
FTS content rows when candidates exist; root-scoped invalidation remains only
as the empty-registry fallback. Remaining repair work is broader SQLite/FTS
cutover tuning.

### Schema evolution and migration

Version these contracts separately:

- Metadata schema version.
- Normalization/analyzer version.
- Parser pipeline version.
- Parser implementation version.
- Structure profile version.
- ParsedDocument IR version.
- Derived index schema version.
- Evidence Pack schema version.
- Search Result Contract version.

Migration rules:

- Metadata and user state are durable and should be migrated in place where
  practical.
- ParsedDocument payloads can be invalidated per parser/profile/version.
- Derived indexes are disposable and should be rebuilt rather than migrated
  when their schema or analyzer changes.
- Evidence Packs are per-query artifacts; old packs may be kept for diagnostics
  but are not reused for fresh answers after schema changes.
- A migration must write an index-health event explaining what was invalidated
  and what will rebuild.
- A migration failure must leave an inspectable rollback or recovery record and
  cannot result in silent filename/content mismatch.

### Ranking and grouping

Ranking must be deterministic and explainable:

- Filename rank: path/name/token match, extension, root relevance.
- Keyword rank: FTS score, term proximity, field/table/heading boosts.
- Table rank: matching sheet/cell/table anchors, profile-specific table labels.
- Recency: mtime and user search history.
- Pin/history boost: user-confirmed files/folders.
- Grouping: collapse backup/copy/version siblings under a representative result.
- Warning penalty: stale, partial, truncated, unsupported, or lossy parse
  warnings reduce confidence without hiding the candidate.
- Hybrid merge: use a deterministic merge such as reciprocal-rank fusion and
  expose `score_breakdown`.

The ranking layer may say "likely relevant candidate"; only the Evidence Pack
validator may permit stronger answer language.

### Search Quality Regression Gate

Ranking changes need a release gate, not only unit tests. Relay should keep a
curated golden-query set that represents real shared-folder failures and enforce
minimum quality before enabling or updating broad document search:

- Each golden query declares expected top files, acceptable near misses,
  forbidden false positives, required warning states, and whether content
  evidence is required before answer text.
- The gate measures top-k recall, folder-skew rate, unsupported-claim rate,
  coverage-message correctness, no-results recovery quality, and latency budget.
- Ranking or analyzer changes must either preserve the previous golden-query
  score or record an intentional, reviewed baseline update.
- A release cannot promote semantic/OCR/optional adapters if they improve recall
  by hiding warnings, omitting coverage gaps, or increasing unsupported claims.
- Golden-query reports are local test artifacts; they must not include original
  business documents or unredacted extracted content.

Implemented WDS09:
`scripts/relay-document-search-golden-query-gate.mjs` now provides the first
privacy-safe gate using generated local Markdown fixtures. It exercises the
current executor and records only case IDs, aggregate counters, warning codes,
and synthetic fixture labels in
`docs/WORKSPACE_DOCUMENT_SEARCH_GOLDEN_QUERIES.md`. The quality-gate contract
can represent a release-blocking `golden_query_regression` warning, and Query
Trace records the metadata-only golden-gate summary under the quality stage.

Implemented WDS10:
`RelayDocumentSearchScoreBreakdown.v1` is now embedded in every built product
result's `score_breakdown` object. The executor records deterministic
component contributions, grouping records representative/collapsed score
facts, Query Trace carries aggregate component totals, display cards can show a
compact ranking label, and support export preserves only score metadata and
warning codes. The contract keeps original documents, snippets, raw FTS rows,
DB paths, and extracted text out of the ranking diagnostics.

Acceptance:

- A ranking change that pushes known-good CFS/BS/PL files out of the declared
  top-k fails before release.
- A change that returns only one filing folder for a broad shared-folder query
  fails the folder-skew check unless the coverage report explains the skew.

### Index State Model

The search UI and diagnostics should use these states rather than a single
"indexed/not indexed" flag:

- `discovered`: found during a scan, but metadata is not fully persisted yet.
- `metadata_indexed`: path/name/extension/size/mtime are persisted.
- `filename_searchable`: present in the in-memory filename cache.
- `content_pending`: supported file type waiting for content parsing.
- `content_indexing`: parsing or IR generation is in progress.
- `content_indexed`: ParsedDocument IR and derived content indexes are current.
- `content_failed`: content parsing failed; the reason is recorded.
- `stale`: metadata changed after content indexing; content evidence must be
  downgraded until reindexed.
- `deleted`: file was present before but is now missing.
- `skipped`: intentionally not indexed because of extension, size, policy,
  denied path, or unsupported format.

### ParsedDocument IR

The internal IR should stay close to Dedoc's shape:

```json
{
  "version": "relay-ir-v1",
  "parser": {
    "name": "relay-office",
    "version": "1",
    "profile": "spreadsheet"
  },
  "source_file_id": "stable-id",
  "source_metadata_version": "file-metadata-v42",
  "source_path": "H:/example/shared/root/report.xlsx",
  "source_mtime": "2026-05-09T00:00:00Z",
  "metadata": {
    "uid": "parsed-document-uuid",
    "file_name": "report.xlsx",
    "file_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "size": 123456,
    "modified_time": 1778256000
  },
  "content": {
    "structure": {
      "node_id": "root",
      "text": "",
      "annotations": [],
      "metadata": {
        "paragraph_type": "root",
        "page_id": null,
        "line_id": null
      },
      "subparagraphs": []
    },
    "tables": []
  },
  "warnings": [],
  "attachments": [],
  "parser_confidence": "high | medium | low"
}
```

Attachments are recursive `ParsedDocument` values. For MVP formats where
attachments cannot yet be extracted, Relay should record the attachment presence
or unsupported-container warning in `warnings` rather than silently dropping it.

`metadata` inside `ParsedDocument` is Dedoc-style `DocumentMetadata`. It may
repeat some source identity fields for traceability, but it must not become the
authoritative filesystem record. The authoritative root/path/access/freshness
record remains FileMetadata.

### Intermediate Representation Stages

Dedoc separates reader output from final constructed structure. Relay should
keep that split so parser bugs and structure-construction bugs can be diagnosed
independently:

1. `ReaderOutput`: raw lines, raw table cells, raw annotations, attachment
   handles, and extraction warnings.
2. `NormalizedDocument`: normalized lines/tables with stable ids, source
   anchors, encoding decisions, and basic metadata.
3. `ParsedDocument`: Dedoc-compatible content tree, tables,
   DocumentMetadata, warnings, and attachments.
4. `DerivedIndex`: FTS/n-gram/table/preview/vector artifacts built from
   `ParsedDocument`.

Only FileMetadata, `ParsedDocument`, and derived indexes are used for Evidence
Packs. Raw reader output is for parser diagnostics and reproducibility, not for
answer claims.

### Annotation and table detail

The IR should preserve enough detail for Office/PDF evidence without pretending
to be Excel or Word:

- Table cells: row, column, `rowspan`, `colspan`, hidden/invisible state where
  known, sheet/page/table id, and source anchor.
- Spreadsheet cells: address, displayed/cached value, formula text when safely
  available, formula cached-value state, hyperlink/comment/note presence, and
  hidden sheet/row/column warnings.
- Text annotations: bold/italic/font size/color when available, hyperlinks,
  heading/list/table markers, page/line ids.
- PDF anchors: page id when available, layout confidence, and extraction method.
- Missing or lossy details become warnings; they are not silently invented.

### Dedoc-Compatible Schema Rules

- Keep the top-level shape compatible with Dedoc's `ParsedDocument`: `content`,
  `metadata`, `version`, `warnings`, and `attachments`.
- Put Relay-specific parser details under explicit extension fields such as
  `parser` or metadata `extra_data`; do not rename Dedoc-compatible fields for
  stylistic reasons.
- Preserve `DocumentContent.structure` as a recursive `TreeNode` and
  `DocumentContent.tables` as a list of tables.
- Preserve `TreeNode.text`, `TreeNode.annotations`, `TreeNode.metadata`, and
  `TreeNode.subparagraphs`.
- Preserve table rows/cells separately from flattened preview text. Flattened
  text is a derived index, not the IR source of truth.
- Use stable node, table, cell, and attachment ids so Evidence Pack anchors can
  survive index rebuilds when the source content is unchanged.
- If a parser cannot provide a field accurately, record a warning instead of
  fabricating a value.
- Preserve schema-level distinctions even when the UI shows a simplified view:
  tree nodes, tables, cells, annotations, metadata, warnings, and attachments
  are separate stored branches.
- Make schema validation part of parser acceptance. A parser that returns text
  without `DocumentContent.structure` or `DocumentContent.tables` is a reader
  diagnostic artifact, not a completed `ParsedDocument`.

### Structure Profiles

Structure extraction should be configurable by profile. The profile is selected
from file type, path signals, and query context, but profile selection does not
create answer claims.

- `default`: generic paragraph/table extraction.
- `spreadsheet`: sheets, ranges, formulas, hidden sheets, cached values, and
  table-like regions.
- `financial_workpaper`: period labels, reconciliation sheets, BS/PL/CFS terms,
  adjustment tables, review sheets, and version suffixes.
- `filing_or_disclosure`: final reports, statutory filings, PDFs/Word outputs,
  page/section anchors, and disclosure labels.
- `audit_material`: audit submission folders, auditor-provided files,
  evidence/supporting schedules, and dated submission variants.
- `technical_document`: headings, lists, code blocks, diagrams-as-warnings, and
  procedure sections.
- `contract`: clauses, parties, dates, obligations, signatures, and attachment
  references.

Each profile has a Dedoc-style pattern set:

- Reader-tag patterns consume existing heading/list/table information from the
  source format when available.
- Formatting patterns use annotations such as bold, font size, indentation, and
  numbering to classify headings and lists.
- Regex patterns identify domain sections, period labels, numbered schedules,
  disclosure sections, and accounting terms.
- Table patterns identify title rows, header rows, total rows, hidden/merged
  cells, and sheet/table boundaries.
- Pattern results are auditable: matched text, source anchor, pattern id,
  confidence, and rejected alternatives are recorded in Query Trace or parser
  diagnostics.

### Parser Pipeline Contract

Each parser follows a Dedoc-style pipeline:

1. `Converter`: optionally converts legacy or wrapped formats to a readable
   form. Unsupported converter paths produce warnings or `skipped`, not shell
   fallbacks.
2. `Reader`: extracts raw lines, table cells, annotations, and attachments.
3. `DocumentMetadataExtractor`: normalizes document-internal and parser
   metadata from the reader output and the input FileRecord snapshot. It must
   not walk folders, mutate FileMetadata, or decide freshness.
4. `StructureExtractor`: assigns paragraph/table/section types according to the
   selected profile.
5. `StructureConstructor`: builds the `TreeNode` hierarchy.
6. `TableExtractor`: emits rectangular table/cell structures where possible and
   warns when merged/hidden/unsupported structures are lossy.
7. `AttachmentExtractor`: emits recursive `ParsedDocument` records or explicit
   unsupported-attachment warnings.
8. `WarningCollector`: normalizes parser warnings for diagnostics, search
   downgrade, and Evidence Pack validation.

Pipeline output must be deterministic for the same file bytes, FileMetadata
snapshot, parser version,
profile, and parameters.

### Converter Lineage

Dedoc-style parsing often converts or unwraps a document before a reader sees
it. Relay must keep that lineage explicit:

- Record source file id, source metadata version, converter name/version,
  converter parameters, temporary converted artifact id, reader input artifact
  id, reader name/version, cleanup state, and warnings.
- Record whether the reader consumed original bytes, a converted file, an
  archive entry, an attachment stream, OCR output, or another intermediate
  artifact.
- Treat converter output as a temporary or rebuildable artifact, not as a copied
  original document.
- Include lineage in parser cache keys when converter parameters can change the
  reader input.
- If conversion succeeds but reading fails, report both stages separately.
- If conversion is unavailable, disabled, lossy, or partial, emit normalized
  warnings and keep the file filename-searchable.

Invariants:

- A `ParsedDocument` must be traceable back to the exact source metadata,
  converter lineage, reader input, parser version, profile, and parameters used
  to create it.
- Support export may include lineage metadata, but must not include converted
  artifact bytes unless the user explicitly chooses to attach diagnostic
  snippets.

### Parser parameters and budgets

Dedoc-style parsing is parameterized. Relay should make those parameters
explicit so tests and support reports can reproduce a parse:

- `profile`: selected structure profile.
- `with_attachments`: whether recursive attachments are parsed.
- `extract_tables`: whether table structures are emitted.
- `document_type`: Dedoc-style structure type hint, mapped to Relay `profile`.
- `structure_patterns_version`: selected profile/pattern-set version.
- `ocr_enabled`: whether OCR is allowed.
- `pdf_text_layer_policy`: whether to trust, verify, or OCR fallback PDF text.
- `pdf_table_analysis`: whether PDF table extraction is attempted.
- `orientation_detection`: whether image/PDF orientation detection is allowed.
- `page_range`: optional page range for PDF/image documents.
- `sheet_filter`: optional sheet filter for spreadsheets.
- `include_hidden_sheets`: whether hidden spreadsheet sheets are parsed or only
  warned.
- `max_pages`, `max_rows`, `max_cells`, `max_text_bytes`: safety budgets.
- `max_attachment_depth`, `max_attachment_count`, `max_attachment_bytes`: safe
  recursion budgets for archives, email, and embedded documents.
- `timeout_ms`: parser timeout budget.
- `language_hint`: optional language/script hint for tokenization and OCR.

Parameters are part of the parser cache key. Changing them creates a new
`ParsedDocument` version or invalidates the derived indexes that depend on
them.

### Attachments Policy

Attachments follow Dedoc's recursive `ParsedDocument` idea, but they must be
bounded and scheduled like independent work:

- Emails, archives, Office-embedded files, PDF attachments, and nested
  containers produce child `ParsedDocument` records when enabled and supported.
- Parent-child provenance records parent file id, attachment id, attachment
  path/name, container type, source anchor, parser profile, and warning state.
- Attachment ids and anchors are stable across rebuilds when parent bytes and
  attachment bytes are unchanged.
- Attachment extraction has explicit maximum depth, total bytes, per-attachment
  bytes, count, timeout, and archive-entry budgets.
- Zip/archive paths are canonicalized before indexing to prevent traversal and
  duplicate-name ambiguity.
- Archive-bomb, nested-archive, password-protected, unsupported, or disabled
  attachments produce warnings instead of blocking the parent parse.
- Attachment parse jobs may be scheduled separately from the parent so a large
  attachment tree does not delay parent metadata, filename search, or top-level
  evidence.
- Original attachments are not uploaded or copied into Relay storage; only
  metadata, extracted IR, warnings, and indexes are stored.

Invariants:

- Attachments do not silently disappear. They are either indexed as child
  documents or represented by a normalized warning.
- Attachment warnings lower coverage/evidence confidence for claims that depend
  on embedded material.

### Optional Dedoc adapter boundary

A future Dedoc adapter is allowed only behind the parser registry:

- It must output Relay's `ParsedDocument` schema without bypassing the warning
  taxonomy.
- It must not become a required dependency for filename search or metadata
  scanning.
- It must run under the same parse budgets, cancellation, local-storage, and
  privacy rules as native parsers.
- If its Python/runtime dependencies are unavailable, files fall back to native
  parsers or receive `converter_unavailable` / `unsupported_format` warnings.

Adoption criteria:

- It improves golden-query or fixture parse quality for formats Relay cannot
  handle well natively.
- It adds meaningful supported formats or structure quality, not only another
  way to parse already-good MVP formats.
- Installer size, startup cost, Windows packaging, and offline behavior remain
  acceptable.
- It can be disabled without breaking filename search, metadata scan, Relay
  Draft, or native parser paths.
- It emits normalized warnings and parser confidence compatible with Relay's
  Evidence Pack policy.
- It has deterministic fixture coverage and a rollback path.

### Feature Pack And Optional Dependency Policy

Docufinder-style systems often include OCR, semantic vectors, local embedding
models, and format-specific parsers. Relay should keep the core dependable and
make heavy capabilities explicit feature packs:

- Core pack: workspace registry, metadata scan, filename cache, query
  normalization, keyword/table indexes for MVP readers, Evidence Packs, Relay
  Draft, index status, and repair.
- Optional OCR pack: scanned PDF/image OCR, OCR warnings, OCR-derived indexes,
  and local model dependency state.
- Optional semantic pack: embeddings, vector index, semantic/hybrid boosts, and
  local model dependency state.
- Optional converter pack: old Office, HWP/HWPX, archive/email, or Dedoc adapter
  converters that may require larger dependencies.
- Feature packs record installed version, enabled state, dependency health,
  local model path, download state, disabled reason, and provided capabilities.
- Search mode availability is derived from feature pack state. A disabled
  semantic pack disables semantic mode rather than silently falling back to a
  weaker mode.

Invariants:

- Core filename, keyword, IR, Evidence Pack, and validated local draft flows
  work without optional packs.
- Missing optional packs create explicit warnings and UI state, not hidden
  shell fallbacks or speculative AI answers.

### Warning Taxonomy

Warnings should be normalized so UI, diagnostics, ranking, and answer downgrade
all interpret them consistently:

- `unsupported_format`
- `converter_unavailable`
- `password_protected`
- `inaccessible_path`
- `access_denied`
- `permission_changed`
- `offline_share`
- `locked_file`
- `parse_truncated`
- `converter_lineage_missing`
- `converter_output_lossy`
- `ocr_disabled`
- `ocr_failed`
- `formula_cached_value_missing`
- `hidden_sheet_present`
- `external_link_skipped`
- `attachment_skipped`
- `attachment_depth_exceeded`
- `attachment_budget_exceeded`
- `table_structure_lossy`
- `encoding_guessed`
- `stale_index`
- `index_coverage_incomplete`
- `path_outside_workspace`
- `symlink_escape_blocked`
- `reader_capability_missing`
- `feature_pack_unavailable`
- `preview_unavailable`
- `open_action_unavailable`
- `index_db_repair_required`
- `index_db_repair_partial`
- `move_confidence_low`
- `scheduler_throttled`

Each warning code must have a beginner-safe Japanese display message, a support
message, severity, retryability, result-state effect, and answer-downgrade
effect. Example mapping:

| Warning code | Beginner message | Effect |
|---|---|---|
| `access_denied` | このファイルは現在のユーザーでは開けません | Do not use stale content as fresh evidence. |
| `offline_share` | 共有フォルダに接続できません | Mark root partial and suggest reconnect/retry. |
| `locked_file` | ファイルが使用中のため中身を確認できません | Keep filename candidate, downgrade content evidence. |
| `unsupported_format` | この形式はファイル名のみ検索できます | Candidate only. |
| `timeout_partial` | 時間内に一部だけ検索しました | Return partial result with continuation/retry. |
| `cloud_placeholder_unavailable` | クラウド上のファイルで、まだこのPCにありません | Metadata only until locally available. |
| `long_path_unsupported` | パスが長すぎるため一部の操作ができません | Keep metadata, block unsafe read/open. |

The UI may use shorter labels, but it must not replace warning semantics with
generic Copilot prose. The support drawer can show raw warning codes and traces.

### External Command Safety Boundary

The executor may call `rg`, OfficeCLI, PDF readers, or parser adapters, but it
must treat every external process as untrusted implementation detail:

- Spawn tools with explicit executable path plus argument array. Do not compose
  shell strings or run through `cmd.exe`, PowerShell, or `/bin/sh` for search
  queries, paths, or parser arguments.
- Resolve tool paths from the Relay-managed portable cache or pinned AionUi
  dependency location. Do not search arbitrary user-controlled `PATH` entries
  for Phase -1 document search.
- Apply per-process timeout, stdout/stderr byte caps, result-count caps, and
  cancellation tokens.
- Treat non-zero exit codes, timeout, output truncation, invalid UTF-8, and
  malformed JSON/text as structured warnings or failures.
- Log command kind, tool version, args after redaction, exit status, elapsed
  time, and truncation state. Do not log raw document contents.
- Preserve path identity through argument arrays and boundary-checked canonical
  paths; never rely on quoting in a shell string for safety.

Acceptance:

- A malicious filename, query, or folder name cannot inject an extra shell
  command.
- A hung parser or huge command output cannot freeze AionUi or hide the partial
  result state.
- Support diagnostics explain command failures without exposing document
  contents.

### Confidence model

Do not collapse all confidence into one score. Search and answer policy should
track separate confidence dimensions:

- `relevance_confidence`: how likely the result matches the query.
- `evidence_confidence`: whether content-backed anchors support the claim.
- `coverage_confidence`: how complete the searched/indexed scope is.
- `parser_confidence`: how reliable the parse is for this file.
- `freshness_confidence`: whether the index reflects current disk state.

Answer wording is based on the weakest relevant confidence dimension. A result
with high filename relevance but low evidence confidence remains a candidate.

The MVP quality report currently implements the non-negotiable subset:
coverage, evidence, freshness, answer policy, and warning severity. Relevance
and parser confidence remain result/parser fields until the derived index and
Evidence Pack layers are promoted.

### Evidence Pack

```json
{
  "query_id": "query-uuid",
  "workspace_id": "workspace-uuid",
  "searched_roots": ["root-uuid"],
  "query_plan": {
    "mode": "filename | content | hybrid | evidence | similar",
    "terms": ["cash flow", "CFS"],
    "file_types": ["xlsx", "xlsm", "pdf"],
    "period_hints": ["160", "1Q"]
  },
  "coverage": {
    "metadata_scanned_files": 10000,
    "content_ready_files": 8000,
    "failed_files": 20,
    "stale_files": 15,
    "truncated": false
  },
  "evidence": [],
  "warnings": []
}
```

### Evidence Pack Redaction Policy

Evidence Pack snippets are local by default. Before optional Copilot polish,
Relay must apply a configurable redaction policy:

- Preserve file ids, result ids, anchors, warning codes, and confidence values.
- Optionally redact or shorten full paths to root-relative display paths.
- Redact configured sensitive terms, email addresses, employee ids, and personal
  names when the user enables privacy mode.
- Never include original files, full ParsedDocument payloads, or hidden sheets
  wholesale.
- Include enough context for answer quality but keep snippets bounded by an
  explicit byte/token budget.
- Record which redaction policy was applied in the query trace.

If redaction would remove the evidence needed for safe polish, Relay should skip
Copilot polish and AionUi should show the validated local draft.

Current implementation foundation:

- `relayDocumentSearchEvidenceRedaction.ts` emits
  `RelayDocumentSearchEvidenceRedaction.v1`.
- The default policy is `local_only`, so no evidence snippets are prepared for
  Copilot unless explicitly changed.
- `snippets_allowed` produces bounded, root-relative redacted evidence and
  still requires the quality gate to allow final Copilot wording.
- `RelayDocumentSearchPolishRequest.v1` turns that redacted evidence plus the
  validated local draft into a versioned Copilot prompt payload; it does not
  include original files or full paths.

### Search Result Contract

Search results should be stable product objects:

```json
{
  "result_id": "query-result-uuid",
  "file_id": "stable-id",
  "path": "H:/example/shared/root/report.xlsx",
  "display_name": "report.xlsx",
  "match_mode": "filename | content | hybrid | table | similar",
  "evidence_state": "filename_only | content_backed | table_backed | stale | failed | skipped",
  "index_state": "content_indexed",
  "score": 0.82,
  "score_breakdown": {
    "filename": 0.3,
    "content": 0.4,
    "recency": 0.05,
    "pin": 0.0,
    "warning_penalty": -0.03
  },
  "anchors": [
    {
      "kind": "sheet_cell | page | paragraph | table_cell | line",
      "id": "Sheet1!A1",
      "preview": "..."
    }
  ],
  "open_action": {
    "kind": "open_file",
    "path": "H:/example/shared/root/report.xlsx"
  },
  "warnings": []
}
```

Filename-only results may rank highly as candidates, but their
`evidence_state` must remain `filename_only` until content or IR evidence is
available.

### Query Trace

Every search should produce an inspectable trace for diagnostics and quality
evaluation:

```json
{
  "trace_id": "query-trace-uuid",
  "raw_query": "160連結 キャッシュフロー 精算表",
  "normalized_terms": ["160", "1q", "キャッシュフロー", "精算表"],
  "expanded_terms": ["cf", "c/f", "cfs", "キャッシュフロー計算書"],
  "mode": "hybrid",
  "searched_roots": ["root-uuid"],
  "index_versions": {
    "metadata_schema": 1,
    "analyzer": "jp-cjk-v1",
    "parsed_document": "relay-ir-v1",
    "content_index": 1
  },
  "matched_indexes": ["filename", "content_nodes_fts", "table_cells_fts"],
  "reader_capabilities": [],
  "scheduler": {},
  "ranking_steps": [],
  "coverage": {},
  "evidence_pack_id": "query-uuid",
  "redaction_policy": "local_only"
}
```

The trace is not shown by default, but support export and golden-query tests
should use it to explain why a result appeared, why a result was missing, and
whether an AI-polished answer was accepted or rejected.

Current implementation foundation:

- `relayDocumentSearchQueryTrace.ts` emits
  `RelayDocumentSearchQueryTrace.v1`.
- The executor records request validation, query normalization, index
  coordination, SQLite/FTS index DB cutover state, metadata scan, content scan,
  ranking, quality gate, and redaction facts in diagnostics.
- Copilot is recorded as `optional_language_only`; Relay remains the planner
  owner for search state and evidence safety.

## Query Flow

### Default thorough search query

This is the default for beginner-facing broad folder requests.

1. Register or reuse the workspace root and build the search scope.
2. Show metadata scan progress and early filename candidates as `候補を表示中`.
3. Promote likely candidates and relevant folders for content parsing, exact
   reads, table search, or Evidence Pack expansion.
4. Wait for the bounded thorough pass to finish, be cancelled, or hit an
   explicit coverage limit before presenting `確認済みの結果`.
5. Report searched roots, pending/skipped/failed/denied counts, and whether any
   result remains candidate-only.
6. Generate final answer text only from evidence-backed results; otherwise show
   candidates plus the reason confirmation is incomplete.

### Quick filename query

1. Search in-memory filename cache.
2. Return candidates immediately with `evidence_state = filename_only`.
3. Include root coverage, scan progress, truncation, and stale/deleted counts.
4. Promote top candidates for background content indexing if useful.
5. Use this mode only when the user explicitly asks for fast filename search or
   chooses a quick filter. It is progress/candidate output, not the default
   final-answer path.

### Content query

1. Search content indexes for files with fresh `ParsedDocument` IR.
2. Report pending/failed/skipped/stale counts separately.
3. Optionally combine with filename hits for hybrid ranking.
4. Require exact anchors before a result becomes content evidence.

### Hybrid query

1. Run filename and keyword/table searches independently.
2. Merge with deterministic rank fusion.
3. Preserve per-mode evidence state and score components.
4. Promote high-ranking filename-only candidates for content indexing.
5. Downgrade answer language until content-backed evidence exists.

### Evidence lookup query

1. Build a deterministic `QueryPlan`.
2. Run filename/content/hybrid searches as needed.
3. Expand top candidates into an Evidence Pack.
4. Validate claims against the pack.
5. Produce a validated local draft.
6. Optionally send only the Evidence Pack and draft to Copilot for wording
   polish.

### Similar-document query

MVP uses deterministic similarity: filename/path overlap, lineage/version
signals, shared profile, shared table/heading terms, and user pins. Embedding
similarity is a Phase 6 derived index.

## Product UX Flow

The user-facing flow should stay close to Docufinder's search app model:

1. User adds or confirms a folder.
2. AionUi immediately shows metadata scan progress.
3. Filename results become available as soon as files are discovered.
4. Content status catches up in the background.
5. Search results show preview snippets, evidence state, warnings, and open
   actions.
6. Optional AI answer uses the same result/evidence objects; it is not a
   separate hidden search path.

The UI must not make users infer whether a result came from filename search,
content search, stale content, or Copilot prose. That state is part of the
result object.

### Current UX Recheck

Current source state matters because the repository still contains two visible
surfaces:

- Current SolidJS/Tauri shell: a legacy OpenCode diagnostic console. It shows
  provider setup, Copilot warmup, OpenCode compatibility status, and advanced
  diagnostics. It is not the Workspace Document Search product surface.
- Target product shell: Relay-branded AionUi. It owns first-run, normal
  navigation, conversation history, approvals, skills, Office previews, and
  lightweight Workspace Document Search result renderers.
- Manifest and seed state: `aionui-relay.json` and the AionUi seed now mark
  Workspace Document Search as `aionui-skills-relay-bridge-contracts`, with
  AionUi skills as the entrypoint/runtime owner and Relay as bridge/contract
  owner.
- Current gap: the Workspace Document Search skills and lightweight result
  renderers are planned and seeded, but not yet implemented in the visible
  AionUi overlay. Until that
  lands, any installed user-facing build must not imply the legacy diagnostic
  shell is the normal search experience.

Cutover rules:

- The legacy SolidJS shell may mention Workspace Document Search only as
  future/diagnostic context. It must not expose a real folder-add/search UI.
- A release that claims Workspace Document Search support must expose AionUi
  skills wired through Relay bridge contracts and the result renderer inside
  Relay-branded AionUi, not the legacy diagnostic shell.
- AionUi skill invocation and result-renderer snapshots are required before
  labeling the feature beginner-ready.
- If AionUi is unavailable, Relay may show a diagnostic/support screen, but that
  fallback must not look like the normal product path.

### AionUi Skill-First Surface Boundary

Workspace Document Search is not a replacement for AionUi, and it is not the
core identity of Relay Agent. It is an AionUi skill workflow made safer by
Relay bridge contracts:

- AionUi owns the product shell: window, navigation, workspace layout, session
  history, approvals, skills, preview surfaces, and normal user interaction.
- Relay owns the Copilot connection and bridge layer: provider endpoint,
  tool-call normalization, skill/result/status contracts, evidence validation,
  redaction policy, diagnostics, and optional Copilot polish validation.
- Search/index/parser implementations should live behind AionUi skills,
  AionCLI/OfficeCLI-style tools, or future upstream extension points whenever
  feasible. Relay may supply minimal local adapters only when needed to make the
  Copilot-to-AionUi bridge deterministic.
- The legacy Relay SolidJS desktop shell is diagnostic-only. It must not become
  a second production document-search UI.
- The installed app, window title, tray, navigation labels, icons, and support
  copy remain `Relay Agent`; AionUi is the upstream shell baseline, not a
  beginner-facing brand.
- AionUi should expose this feature primarily as skills/commands such as
  `検索`, `ファイル検索`, and `根拠つき回答`, not as a separate Relay search app,
  `ParsedDocument`, `Dedoc`, `Evidence Pack`, or `AionUi plugin`.
- Relay must curate AionUi's builtin assistant catalog for the beginner
  surface. The default visible presets are Word, Excel, and PowerPoint, plus
  one document-finding task entry wired through Relay contracts. Other upstream presets
  remain available only through advanced/custom assistant flows, so the search
  and Office paths do not disappear among unrelated default skills.
- Dedicated UI is limited to lightweight result renderers, index/status chips,
  and preview/evidence details that plug into AionUi's existing chat, history,
  and preview surfaces.
- Search result actions reuse AionUi primitives for preview, open, approval,
  skills, and history. Relay does not create a separate action model for the
  same file.
- Query Trace, parser lineage, reader capabilities, scheduler state, and support
  export live behind an advanced drawer or support view in AionUi.
- AionUi extension or fork code renders the UX and invokes the skill/tool
  runtime. Relay contracts should prevent that flow from falling back to
  Copilot-planned low-level filesystem tool chains.

Integration invariants:

- First-run lands in the Relay-branded AionUi `/guid` shell. The first search
  path uses `AssistantSelectionArea`, `GuidInputCard`, and the existing
  `GuidActionRow` folder button. After a conversation starts, `SendBox` slash
  commands, `@` file mentions, and workspace controls can invoke search through
  the Relay bridge without a separate onboarding screen.
- Folder add uses AionUi's existing file/folder affordances where possible;
  Relay supplies bridge-readable status, error, and validation facts when those
  facts cross the Copilot/AionUi boundary.
- Closing, reopening, or switching conversations in AionUi does not lose the
  local search index or workspace registry.
- AionUi can show and act on search result objects without requiring Copilot to
  be signed in.
- Copilot-polished answers stay attached to AionUi conversation history, but the
  answer anchors must resolve back through the same result/evidence contracts
  rendered by AionUi.

### AionUi Core UX Recheck

Relay should build on AionUi v1.9.25's existing product mechanics:

- `/guid` is the first-run task launcher. It has `AssistantSelectionArea`,
  `GuidInputCard`, `GuidActionRow`, file attachment, folder selection, and
  quick actions. It does not have the normal conversation slash-command menu,
  so beginner search must start from curated assistant/task entries, example
  prompts, and the visible folder selector rather than a generic skill picker.
- ConversationTabs is the task/session switcher. The `+` menu already separates
  detected execution engines from preset assistants, so `資料を探す` should
  appear as the single curated search/read/summarize preset entry there.
- SendBox is the normal command surface. It already supports `/` command
  autocomplete, `@` file mentions from the workspace, drag/drop attachments,
  selected-file chips, reply quotes, voice input, and preview-to-chat snippets.
  Search should use slash commands and file mentions before adding another
  query box.
- The right Workspace panel is the folder/file frame. It already has workspace
  title, collapse/expand, refresh, local tree search, import/paste operations,
  context menus, changes tab, and file operations. Contracted search/index
  state should augment this panel instead of replacing it. The existing
  Workspace toolbar search currently filters the workspace tree through
  `loadWorkspace(workspace, search)`; do not treat it as the whole document
  search product. Use it as a filename/tree quick filter and compact status
  affordance, while broad document search remains a skill/result-card flow.
- PreviewPanel is the document detail surface. It already supports Office/PDF,
  images, code/markdown/html/diff, tabs, history, context menu, and selection
  toolbar. Search results should open evidence and previews here.
- ConversationSkillsIndicator is the existing loaded-skill signal, but it
  currently opens capability settings when clicked. In beginner mode it should
  be passive or route only when `relay.advancedSurfaces.enabled` is enabled;
  do not let the indicator become a hidden path into advanced skills settings.
  Search skills wired through Relay bridge contracts should reuse this signal
  instead of adding a second "active tools" area.
- AionUi `/guid` also exposes advanced assistant/agent controls by default:
  detected-agent pill selection, selected-assistant edit/details, preset
  backend switching, and the assistant management drawer. Relay beginner mode
  must hide those entrypoints so the first screen remains a task launcher, not
  an AionUi administration surface.

UX consequence:

- Do not design a new beginner search page as the default product path.
- Add small AionUi-native extensions: curated assistant entries, slash commands,
  workspace quick-filter/status augmentation, structured chat result cards,
  preview anchors, and advanced diagnostics drawers.
- If a feature cannot be placed in one of those primitives, treat that as a
  design smell and revisit the feature boundary before implementing it.

### AionUi / Docufinder / Dedoc Collision-Avoidance Contract

The three UX models are compatible only if each owns a different layer:

| Concern | AionUi owns | Relay bridge owns | UI rule |
|---|---|---|---|
| Shell and navigation | Window, routes, panels, command entry, conversation frame | Skill contracts and result-renderer data contracts | Do not open a separate Relay search shell. |
| Folder/workspace picker | Visible root rail, recent/pinned UI, open-folder action, workspace state | Status/error contract when workspace state is exposed to Copilot | One folder list; AionUi renders workspace state. |
| Search input and suggestions | `/guid` task entries, `GuidInputCard`, `GuidActionRow` folder selection, SendBox slash commands, `@` file mentions, workspace quick filter, focus, shortcuts, autocomplete UI | Tool-call normalization and result/status schema | Suggestions are UI hints, not evidence claims. |
| Results | Lightweight result renderer, grouping controls, selection, context menu | Result contract, status translation, validation boundary | UI never reconstructs result meaning from Copilot prose. |
| Preview/open | Preview panes, file open flow, permission prompts | Anchor contract and validation state crossing the bridge | One preview/open action model; no duplicate Relay buttons. |
| Conversation answer | Conversation storage, message rendering, citations | Copilot provider bridge, evidence validation, redaction | Answers cite result/evidence ids, not free text paths. |
| Skills/assistants | Curated assistant presets, OfficeCLI assistants, loaded-skill indicator, approvals, skill invocation UX | Skill schemas and normalized tool-call handoff | Search is an AionUi skill workflow; Office edits stay in AionUi/OfficeCLI; beginner views do not expose advanced skill management. |
| Advanced diagnostics | Drawer/panel placement, support export trigger | Query Trace, parser lineage, reader capabilities, scheduler | Advanced terms stay collapsed by default. |
| Branding | Relay Agent app name, icon, window title, support copy | Search feature labels and local privacy copy | Never expose AionUi as a second product brand. |
| Offline/Copilot state | Sign-in indicators and conversation availability | Local search works without Copilot | No local-search feature is blocked by Copilot sign-in. |

Conflict rules:

- If AionUi already has a primitive for navigation, preview, approval, history,
  or context menu, Workspace Document Search must adapt to it instead of
  creating another control family.
- If a deterministic search/status fact crosses the Copilot/AionUi boundary,
  AionUi must render it from the contract rather than re-deriving it from
  filenames, snippets, or Copilot text.
- If Copilot generates answer text, AionUi stores the message but Relay remains
  the authority for validating what evidence may be sent to or accepted from
  Copilot.
- If a Dedoc detail is useful for trust but not for task completion, it goes in
  details or advanced views, not the default result row.
- If a feature cannot decide whether it is a chat feature, a skill feature, or a
  search feature, default to AionUi skill invocation first, then bridge result
  contracts, then optional Copilot answer text.

### UX Design System And Information Architecture

The product should feel like AionUi with strong local document-search skills,
not a second search application or diagnostics console. The default screen stays
AionUi's normal conversation/workspace shell:

- Skill entry: `/guid` curated task entries, the normal AionUi composer,
  assistant preset selection, and the SendBox command palette expose `検索`,
  `ファイル検索`, `根拠つき回答`, and related examples. Do not depend on a
  beginner-visible generic skill picker.
- Assistant catalog: the default picker is a curated task launcher, not the full
  upstream AionUi gallery. It shows `資料を探す` and
  `Officeファイルを編集する`; advanced presets are collapsed behind advanced/custom
  assistant management.
- Folder context: AionUi's existing workspace/folder controls show registered
  roots, pinned folders, recent searches, and compact index status. The current
  Workspace toolbar search remains a quick tree/filename filter unless a
  contracted result renderer is active.
- Result renderer: search results appear as structured AionUi message content
  with grouping, match mode, evidence state, warnings, and open/preview actions.
- Preview/evidence details: AionUi's existing preview pane or details drawer
  shows snippets, page/sheet/cell/paragraph anchors, warnings, and open actions.
- Answer content: optional validated local draft / Copilot-polished answer is generated
  only from selected result/evidence objects and stored in AionUi conversation
  history.
- Advanced drawer: Query Trace, parser warnings, reader capabilities, feature
  pack state, scheduler, and support export stay behind support/advanced UI.

Visual and interaction guidelines:

- Use a restrained productivity UI with dense but readable information, not a
  marketing landing page or decorative card-heavy dashboard.
- Use Japanese-first typography: `Noto Sans JP`, `Meiryo`, `Yu Gothic UI`,
  system sans-serif fallback. Avoid fonts that render Japanese text with
  inconsistent glyphs.
- Use icons for actions such as add folder, search, refresh, open, pin, copy,
  retry, and details. Text labels remain visible for primary beginner actions.
- Use status badges with text plus icon, never color alone: `ファイル名のみ`,
  `内容まで検索済み`, `準備中`, `古い可能性`, `権限なし`, `失敗`.
- Keep loading states explicit for operations over 300 ms: skeleton rows,
  progress text, cancellable long tasks, and disabled duplicate-submit buttons.
- Chat result cards use capped batches and an explicit `さらに表示` continuation
  by default. Preserve selection across continuation and background index
  updates. Use AionUi-native virtualization only where an existing workspace tree
  surface already owns it, not as the default document-result-card model.
- Respect keyboard and screen-reader flows: visible focus, logical tab order,
  ARIA labels for progress/status, and no focus stealing during background
  indexing.

### Beginner UX Contract

Beginner-facing flows should hide internal vocabulary while preserving exact
state:

- First run empty state: "検索したいフォルダを追加してください" with one primary
  `フォルダを追加` action and a short note that files stay local.
- After folder selection: show "ファイル名検索は使えます。内容検索を準備しています"
  as soon as the metadata cache is ready.
- Search input placeholders use concrete examples, such as
  `例: 160連結 キャッシュフロー 精算表`.
- Search suggestions appear for recent searches, pinned folders, recognized file
  types, and normalized synonyms without requiring the user to know search modes.
- Search modes are shown as plain labels: `すべて`, `ファイル名`, `内容`,
  `根拠つき回答`, `類似ファイル`. Internal mode names stay in diagnostics.
- Hide AionUi setup/platform controls from beginner views: provider/model
  settings, Gemini setup, agent management, tools/system/dev settings,
  WebUI/channel setup, extension settings, Skills Market, model switchers, ACP
  config selectors, permission-mode controls, detected-agent selectors, preset
  assistant edit controls, preset backend switchers, and assistant-management
  entrypoints.
- Show support-only surfaces only when `relay.advancedSurfaces.enabled` is
  deliberately enabled.
- No-results state offers next actions: check spelling, broaden folder, include
  filename-only results, wait for content indexing, or retry failed files.
- Errors use task language, not stack language. For example, say "このファイルは
  現在のユーザー権限では読めません" instead of exposing parser exceptions.
- Advanced details are one click away but collapsed by default.

### Dedoc Detail Progressive Disclosure

Dedoc-style structure should improve trust without overwhelming beginners:

- Default result view shows friendly evidence: file name, folder, snippet,
  matched sheet/page/paragraph/cell, freshness, and warnings.
- Details view shows document structure: headings, pages, sheets, tables,
  attachments, annotations, parser confidence, and warnings.
- Advanced view shows Dedoc-compatible field names and Query Trace only for
  support, test, or developer workflows.
- Tables and spreadsheets show source anchors such as sheet name, cell/range,
  row/column labels, hidden-state warnings, and cached-formula warnings.
- PDF/Word previews show page/paragraph anchors and layout confidence when
  available.
- Attachment results show parent document, attachment path/name, depth, skipped
  reason, and whether the attachment was indexed separately.

### Preview / Open / Evidence UX Contract

Docufinder-style usability depends on search results being actionable without
turning the AI answer into the only interface:

- Every result exposes independent actions for preview, open containing folder,
  open file, copy path, pin, hide, and rebuild/retry where policy allows.
- Preview state is explicit: `preview_ready`, `preview_pending`,
  `preview_unavailable`, `preview_stale`, `preview_denied`, or
  `preview_failed`.
- Open state is explicit: `open_ready`, `open_denied`, `open_missing`,
  `open_offline`, or `open_policy_blocked`.
- Evidence anchors in AI/Relay answers must link back to the same result object
  and preview/open state; an answer cannot cite a file that is not present in
  the current result contract.
- If a result is stale, moved, deleted, denied, or preview-limited, the UI shows
  that state near the result and in any generated answer section that uses it.
- Preview failures do not hide the result. They lower evidence confidence and
  expose retry/rebuild actions when available.
- Batch operations such as "index this folder", "retry failed", or "rebuild
  previews" run through scheduler backpressure and report progress.

Invariants:

- Search remains useful without Copilot: result list, preview, open, index
  status, warnings, and repair actions are product features, not AI side effects.
- AI polish can improve wording only; it cannot create a separate, untraceable
  search result or file action.

## Local Privacy And Data Flow

| Artifact | Stored locally | Sent to Copilot by default | Notes |
|---|---:|---:|---|
| Workspace roots and file metadata | yes | no | Paths remain local unless user exports diagnostics. |
| In-memory filename cache | yes | no | Rebuilt from local metadata. |
| QueryPlan | yes, per query | no | Relay-owned plan. Copilot suggestions are optional inputs, not authority. |
| Copilot query suggestions | yes, per query | received from Copilot | Accepted only after Relay validation; rejected items are traced. |
| ParsedDocument IR | yes | no | Original files are not copied; extracted IR is local. |
| Derived indexes and previews | yes | no | Rebuildable from IR. |
| Feature pack registry and local model state | yes | no | Optional dependencies are local capability state. |
| Converter lineage | yes | no | Converted artifacts are temporary/rebuildable and not sent by default. |
| Access snapshots | yes | no | Records current-user access state, not file contents. |
| Search Result objects | yes, short-lived | no | May be included in support export if user chooses. |
| Evidence Pack | yes, per query | optional | Only selected snippets are sent for optional polish. |
| Validated local draft | yes | optional | Sent only when Copilot polish is enabled. |
| Copilot polished answer | yes | received from Copilot | Must validate against Evidence Pack. |

This table is part of the product contract. Any future feature that changes a
`no` to `optional` or `yes` needs an explicit settings and release-note change.

## Observability, Logs, And Telemetry

Diagnostics are local-first and redacted by default:

- Runtime logs, Query Trace, index health events, command diagnostics, and
  warning metrics are stored locally with rotation and size caps.
- Logs may include tool kind, version, elapsed time, warning code, counts, and
  redacted/root-relative paths. They must not include raw document contents,
  full extracted text, unredacted Evidence Pack snippets, or original files.
- Product metrics are local diagnostic metrics by default. Any network telemetry
  requires an explicit setting, documented destination, and redaction boundary.
- Support export is user-initiated, previewable before saving, and split into
  `metadata-only` and `include selected evidence snippets` modes.
- Copilot polish rejection, unsupported-claim rejection, command failures,
  index corruption, cache protection downgrade, and policy denial are recorded
  as machine-readable events for support.
- Log retention and support export follow the same root-removal and cache
  deletion rules as search artifacts.

Acceptance:

- A support export can diagnose slow search, policy denial, parser failure,
  lock recovery, and Copilot rejection without exposing document contents by
  default.
- Turning off network telemetry does not reduce local diagnostics or search
  reliability.

## Phases

### Phase -1: Relay Document Search Tool Contract And Executor Entry

Goal: make `資料を探す` a real high-level execution contract before
optimizing search internals. M365 Copilot may provide intent wording and
optional query suggestions, but it must not be the component that manually
chains `glob`, `grep`, `read`, or parser tools for the first search step.

Tasks:

- Define `RelayDocumentSearchRequest.v1` as the only beginner-facing document
  search tool input:
  - `query`: the user's original request.
  - `roots`: workspace root ids or canonical local/UNC paths selected through
    AionUi controls.
  - `intent`: `auto`, `find_files`, `answer_with_evidence`, `summarize`, or
    `review_candidates`.
  - `thoroughness`: `thorough` by default; `quick` is allowed only for
    filename/path candidate progress.
  - `fileTypes`, `timeHints`, `excludeTerms`, and `maxResults` as optional
    filters.
  - `includeContent`: whether content extraction is needed for this request.
  - `evidence`: `required` by default for any answer that claims file contents.
- Store the request schema, result schema, validator, and TypeScript types in a
  source-controlled Relay bridge contract module. The implementation task must
  name the exact files before coding begins, and tests must fail if the runtime
  advertises a schema that the validator does not accept.
- Make that contract module the single source of truth. The OpenAI-compatible
  tool schema, AionUi manifest metadata, runtime validator, fixtures, and tests
  must import or compare against the same schema definitions instead of copying
  divergent hand-written shapes.
- Use these initial file responsibilities unless implementation discovery finds
  a better AionUi-native extension point:
  - `integrations/aionui/overlay/src/process/utils/relayDocumentSearchContract.ts`
    defines schemas, validators, types, warning codes, status codes, and
    alias-validation helpers.
  - `integrations/aionui/overlay/src/process/utils/relayDocumentSearchExecutor.ts`
    implements the first local filename/FileMetadata executor plus bounded
    `.txt` / `.md` / `.csv` content confirmation for safe text evidence.
  - `integrations/aionui/overlay/src/process/utils/relayDocumentSearchMetadataCache.ts`
    persists Docufinder-style discovery metadata only: path/name/type/size/mtime
    and source metadata versions. It does not store extracted text,
    ParsedDocument IR, Office/PDF contents, previews, embeddings, or answer
    drafts. Writes use an atomic temp-file swap protected by a stale-recoverable
    single-writer lock.
  - `integrations/aionui/overlay/src/process/utils/relayParsedDocumentIr.ts`
    defines the first Dedoc-compatible IR boundary: `ReaderOutput`,
    `NormalizedDocument`, `ParsedDocument`, `DocumentContent`, recursive
    `TreeNode`, table/cell records, parser profiles, warnings, attachments, and
    reader capabilities. The MVP text/CSV readers use this IR so later
    Office/PDF readers can share the same evidence path.
  - `integrations/aionui/overlay/src/process/utils/relayDocumentSearchJobLifecycle.ts`
    wraps executor runs with progress, cancellation, retry tokens,
    timeout-to-partial handling, and duplicate-submit attachment.
  - `integrations/aionui/overlay/src/process/utils/relayDocumentSearchBridge.ts`
    validates OpenAI/AionUi tool-call shapes, enforces high-level alias
    contract metadata, invokes the lifecycle runner, and emits structured
    tool-result content for AionUi's existing conversation renderer.
  - `integrations/aionui/overlay/src/process/utils/relayDocumentSearchDisplay.ts`
    maps `RelayDocumentSearchResult.v1` to beginner-safe result cards, status
    labels, coverage copy, and refine actions for AionUi chat/preview rendering.
  - `integrations/aionui/overlay/src/process/utils/relayDocumentSearchMcpStdio.ts`
    exposes the same high-level tool as a stdio MCP server so aionrs sessions
    can execute `relay_document_search` without treating raw filesystem tools
    as the beginner workflow entrypoint.
  - `integrations/aionui/overlay/src/process/utils/relayGateway.ts` wires the
    Relay seed/tool catalog metadata into the AionUi fork.
  - `apps/desktop/src-tauri/binaries/copilot_server.mjs` remains responsible for
    model-facing tool-call normalization, low-level first-call rejection, and
    repair toward `relay_document_search`.
  - `scripts/apply-aionui-overlay.mjs` copies the
    contract/executor/job-lifecycle/bridge/display/MCP overlays, builds the MCP
    entry, injects it into aionrs sessions, and keeps the generated skill instructions
    aligned with the runtime tool.
- Define the OpenAI-compatible tool schema separately from the internal request
  type. The model-facing schema must stay small: `query`, `roots`, `intent`,
  `thoroughness`, `fileTypes`, `maxResults`, and `evidence`. Internal fields
  such as cache ids, job ids, parser versions, and redaction policy are Relay
  controlled and must not be accepted from Copilot.
- Define Copilot-facing prompt templates as versioned artifacts:
  `relay_document_search_tool_prompt.v1`,
  `relay_document_search_repair_prompt.v1`,
  `relay_query_suggestion_prompt.v1`, `relay_answer_polish_prompt.v1`, and
  `relay_polish_repair_prompt.v1`. Each template records its version in Query
  Trace and has fixture tests before it can be changed.
- Define `RelayDocumentSearchResult.v1` as the stable executor output:
  - `status`: `ok`, `partial`, `needs_input`, or `failed`.
  - `progress`: current stage, percent, scanned counts, and skipped counts.
  - `job`: `job_id`, lifecycle state, started/finished timestamps,
    cancellable flag, retry token, and duplicate-submit correlation id.
  - `correlation`: AionUi conversation/message ids, Relay job/query ids,
    Copilot session/request/turn ids when present, Evidence Pack id, local draft
    id, polish answer id, and prompt template versions.
  - `queryPlan`: Relay-built normalized terms, roots, budgets, accepted Copilot
    suggestions, rejected Copilot suggestions, and confirmation policy.
  - `coverage`: searched roots, incomplete roots, inaccessible paths,
    truncation, one-folder skew, stale indexes, and parser failures.
  - `results`: ranked candidate/result objects with path, title, file type,
    modified time, score, score breakdown, match mode, evidence state, index
    state, snippets, anchors, warnings, and actions.
  - `evidencePack`: the small validated evidence set allowed into optional
    Copilot polish.
  - `display`: beginner-safe Japanese summary, empty-state guidance, and
    refine actions that AionUi can render without needing Copilot prose.
  - `diagnostics`: support-only trace ids, analyzer versions, parser lineage,
    and raw tool failures.
- Advertise the high-level tool from the Relay/AionUi provider bridge using
  stable aliases: `relay_document_search`, `relay-document-search`,
  `workspace_document_search`, `workspace-search`, and `find-files`.
- Treat `workspace-search` and `find-files` as aliases only when the advertised
  tool schema matches `RelayDocumentSearchRequest.v1` or the runtime explicitly
  declares `resultContract: RelayDocumentSearchResult.v1`. Otherwise they
  remain ordinary skills/tools and cannot satisfy the beginner high-level
  document-search contract.
- Assign ownership explicitly:
  - Relay provider gateway advertises the OpenAI-compatible tool and validates
    incoming tool calls.
  - Relay document-search executor owns root validation, job lifecycle, query
    plan, coverage, evidence validation, redaction, diagnostics, and result
    contract emission.
  - AionUi owns skill invocation UX, progress/result rendering, preview/open
    actions, conversation history, and cancel/retry buttons wired to the job
    contract.
  - AionCLI/OfficeCLI/ripgrep/parser adapters are replaceable executor
    dependencies, not model-facing tools for this workflow.
- Extend process coordination before enabling persistent indexing: wire the
  existing single-writer lock and health events into the future SQLite/FTS store,
  add second-window attachment to active jobs, and add abandoned-job downgrade
  after crash.
- In the Tool Call Emulation Layer, make document-search and grounded-summary
  intents require the high-level tool whenever it is advertised. A first call
  to raw `glob`, `grep`, `read`, `bash`, or parser tools is rejected before
  execution and repaired only toward the high-level document-search tool.
- Handle Copilot session failures as explicit state, not hidden waiting:
  warming, sign-in required, disconnected, CDP capture unhealthy, timeout,
  rate limited, tenant restricted, and policy disabled all downgrade to local
  execution/result rendering. Optional suggestions or polish can be retried
  explicitly, but a search job never waits indefinitely for Copilot.
- Implement the first executor as a conservative wrapper over existing AionUi
  and local primitives: root validation, metadata scan, ripgrep/filename
  candidate search, Office/PDF read where available, evidence packaging, and
  deterministic result-card output.
- Implement all `rg`, OfficeCLI, PDF reader, and parser invocations through the
  External Command Safety Boundary: executable path plus argument array, no
  shell strings, pinned tool path, timeout, output caps, cancellation, and
  redacted diagnostics.
- Fix the Phase -1 MVP file format promise:
  - `.txt`, `.md`, and `.csv`: filename plus content keyword search.
  - `.docx`, `.xlsx`, `.xlsm`, `.pptx`, and `.pdf`: filename search plus best
    available text extraction through existing read/Office/PDF capabilities.
  - `.doc`, `.xls`, archives, images, encrypted/password-protected files, and
    unsupported formats: filename-searchable only with normalized warnings.
  - If a supported reader is missing or fails, the result is downgraded to
    candidate/partial instead of being hidden or treated as evidence.
- Define the long-running job behavior before broad shared-folder search ships:
  - first visible progress within 1 second after send;
  - first filename candidates within 10 seconds for a warmed 100k-file metadata
    cache, and within 30 seconds during a cold metadata scan when the drive is
    responsive;
  - cancel request acknowledged within 2 seconds and no new file reads started
    after cancellation;
  - default query timeout produces `partial`, not silent failure;
  - duplicate sends with the same query/root while a job is active attach to the
    active job rather than starting another full scan.
- Define cache and privacy rules for the first executor:
  - store metadata, extracted text/IR, indexes, pins, and history under
    user-local Relay/AionUi app data only;
  - never copy original files;
  - enforce per-root and global cache quotas with deterministic eviction of
    disposable derived artifacts before user state;
  - protect extracted text/IR/result snippets at rest on Windows where feasible,
    or downgrade content caching until the local-cache policy is explicit;
  - deleting a workspace root removes its derived cache after confirmation;
  - app upgrade, rollback, downgrade, and uninstall behavior for caches and
    schema migration are explicit and tested;
  - support export excludes original files and includes only selected
    diagnostics/result metadata unless the user explicitly includes evidence;
  - optional Copilot polish receives only redacted Evidence Pack snippets, not
    full files or raw indexes.
- Define policy and consent gates:
  - adding a folder explains whether Relay will store metadata only or extracted
    content indexes locally;
  - local-only mode disables Copilot polish while keeping search/result cards;
  - managed policy can disable content indexing, Copilot polish, support export,
    network roots, or unprotected content caches;
  - `needs_input` is returned when policy or missing folder consent prevents
    the requested search.
- Define local diagnostics/log behavior with rotation, redaction, support-export
  preview, and no network telemetry unless explicitly enabled.
- Define the first warning-to-Japanese-copy map for every warning emitted by
  Phase -1, including access denied, offline share, locked file, unsupported
  format, timeout partial, cloud placeholder, and long path cases.
- Keep raw tools available only behind the executor or in advanced/support
  flows. They are implementation details, not the beginner product contract.
- Stream executor progress to AionUi result cards, but render the final answer
  from `RelayDocumentSearchResult.v1` rather than repeatedly appending Copilot
  partial prose.
- Validate optional Copilot polish before display: every factual claim must map
  to Evidence Pack ids; every mentioned file, path, sheet, cell, page, date,
  amount, or count must already exist in the validated local draft or Evidence
  Pack; duplicate, truncated, prose-only, or unsupported output is repaired at
  most once and otherwise rejected. AionUi commits the final answer once from
  the local draft, then optionally replaces it once with accepted polish.
- Add Windows validation cases for shared folders, mapped drives, Japanese
  paths, inaccessible files, high-volume trees, Office/PDF evidence, and
  Copilot returning low-level tool calls despite the high-level tool being
  advertised.
- Add release/feature-flag gates so Workspace Document Search cannot be
  beginner-visible unless schema, catalog, executor, local-only, policy,
  privacy/cache, warning-copy, golden-query, and Windows smoke gates pass.
- Replace the existing live workspace-search smoke that asserts direct
  `glob_search` / `grep_search` model calls with a high-level smoke that
  asserts the first model-visible call is `relay_document_search`, raw tools are
  used only inside the executor trace, and the UI renders
  `RelayDocumentSearchResult.v1`.

Acceptance:

- A request such as `このフォルダからキャッシュフロー計算書に関係するファイルを探して`
  starts with `relay_document_search` or an approved alias, not raw `glob`.
- If Copilot returns a low-level first call for a document-search intent, Relay
  stops that call before execution and asks for the high-level tool instead.
- AionUi can display useful progress, candidate cards, partial coverage, and
  failure states from the executor without waiting for Copilot final prose.
- Content claims remain impossible unless the result is backed by current
  Evidence Pack items.
- Copilot sign-in, capture, timeout, rate-limit, tenant, or policy failures do
  not block local search, local draft rendering, cancel, retry, or preview/open
  actions.
- Accepted Copilot polish carries prompt versions and correlation ids and cites
  Evidence Pack ids; rejected, duplicated, truncated, or unstructured polish is
  not displayed as the search result.
- Cancellation, retry, duplicate-submit, timeout, and partial-result states are
  visible in AionUi and represented in the result contract.
- Schema tests prove advertised tool aliases, request validation, result
  validation, and rejected low-level first calls are consistent.
- If the high-level tool is unavailable, Relay may use the current guarded
  low-level path only as an explicit degraded fallback with a visible warning.

### Phase 0: Guarded Low-Level Fallback Over Current Tools

Goal: keep the existing low-level tool path safe while Phase -1 and later
indexing work are being implemented. This path is a fallback and test harness,
not the primary beginner workflow.

Tasks:

- Treat `glob` results as candidates only.
- Require `read` or indexed IR evidence before making content claims.
- Mark broad searches as incomplete when limits, inaccessible folders, stale
  files, or one-folder skew are detected.
- Return a deterministic Relay candidate list when Copilot gives prose without
  grounded evidence.
- Surface a degraded-mode warning whenever this fallback is used because the
  high-level `relay_document_search` tool is not advertised or unavailable.

Acceptance:

- A broad shared-folder lookup cannot claim "these are the necessary files"
  from filename hits alone.
- Repeated Copilot prose does not cause repeated UI answers or hidden retries.
- Failures are surfaced as failures, not converted into speculative answers.
- The fallback cannot become the normal beginner path once the high-level tool
  is advertised.

### Phase 0.4: Workspace Registration And Immediate Metadata Scan

Goal: make folder registration the beginning of search, not a one-off tool call.

Tasks:

- Add workspace/root registration for local and mapped/network folders.
- Add the first-run empty state and one primary `フォルダを追加` action.
- Add shared path canonicalization and root-boundary checks before scanning,
  parsing, previewing, or opening files.
- Add symlink/junction/reparse-point policy with escape blocking by default.
- Start metadata scan immediately after root registration.
- Persist FileRecord/FileMetadata fields: root id, canonical path, display path,
  file id, name, extension, size, mtime, type guess, scan status, and source
  metadata version.
- Record access snapshots for metadata, content, preview, and open actions so
  permission changes are freshness events rather than generic failures.
- Build and update the in-memory filename cache incrementally as metadata
  records are discovered.
- Show scan progress and last scan result in diagnostics/UI.

Acceptance:

- A beginner can launch Relay, add a folder, and see when filename search is
  ready without opening diagnostics or understanding indexing terms.
- A newly added folder becomes filename-searchable before content extraction
  completes.
- Denied, out-of-root, symlink-escape, and hidden/system-policy paths are
  skipped with explicit warnings before any read or parse occurs.
- ACL changes, offline shares, and current-user access failures are visible in
  diagnostics without leaking denied file contents.
- Relay restart rebuilds the in-memory filename cache from persisted metadata
  before slow content work resumes.
- Closing and reopening Relay keeps the metadata cache.
- The scanner does not parse Office/PDF internals and does not write
  DocumentMetadata.

### Phase 1: Candidate Filename Search For Thorough Mode

Goal: provide Docufinder-style immediate candidate discovery without making
filename hits look like final findings.

Tasks:

- Build a local filename/path index from the metadata cache.
  - Implemented first pass: `RelayDocumentSearchFilenameIndex.v1` builds a
    metadata-only index, persists it when enabled, and never stores extracted
    document text or ParsedDocument IR.
- Rebuild an in-memory filename cache at startup and update it during scans.
  - Implemented first pass: every executor run rebuilds an in-memory
    filename/path index from current FileMetadata; AionUi MCP enables persistent
    filename index writes for reuse across sessions.
- Support substring and CJK-friendly token matching.
  - Implemented first pass: shared NFKC/case/punctuation normalization plus
    CJK bi/tri-grams and substring matching for names and paths.
- Implement shared query normalization for filename and later content indexes.
  - Implemented first pass: filename index uses
    `relay-query-normalizer-v1`, the same normalizer as QueryPlan.
- Rank by path/name match, extension, recency, root relevance, and user pins.
- Return truncation and coverage metadata with every result set.
- Implement the indexing ladder through at least `filename_searchable`.
- Treat filename results as `candidate_only` unless an explicit quick filename
  mode is selected or the candidate is later confirmed by content/evidence.

Acceptance:

- Large folders can return filename candidates quickly without parsing Office
  files first.
- Results show whether they are candidate-only, filename-only, content-backed,
  or evidence-backed.
- Filename search latency is measured separately from metadata scan and content
  indexing latency.
- Diagnostics show original query, normalized terms, synonym expansion, and
  search mode.
- Default broad search continues into content/evidence confirmation instead of
  stopping at filename candidates.

### Phase 1.2: Smart Query Plan

Goal: parse user intent into a search plan without trying to encode all domain
knowledge as hard-coded rules, while keeping Relay as the planner/validator and
Copilot only as an optional suggestion provider.

Tasks:

- Extract terms, quoted paths, file type hints, period/quarter hints, exclude
  terms, and requested output style.
- Build a deterministic `QueryPlan` with mode, roots, targets, normalized
  terms, filters, budgets, candidate policy, and confirmation policy.
- Add beginner-facing suggestions for recent searches, pinned folders, file
  types, and normalized synonyms.
- Accept optional Copilot term/file-type/clarification suggestions only after
  Relay validates them against root, format, budget, privacy, and normalization
  policy.
- Record accepted and rejected Copilot suggestions in Query Trace.
- Classify search mode: filename, content, hybrid, evidence, similar.
- Keep the plan inspectable and deterministic.
- Preserve search mode instead of silently falling through between filename,
  keyword, hybrid, evidence, and similar.

Acceptance:

- The same query produces a stable `QueryPlan`.
- Copilot wording or suggestions cannot change roots, budgets, confirmation
  policy, or searched coverage without a Relay-visible validated diff.
- Suggestions help users broaden or narrow searches without exposing internal
  query analyzer details.
- Domain terms influence ranking and expansion, but do not create unverified
  claims.

### Phase 1.5: Index Status, Reports, And Cache Management

Goal: make "what has Relay actually searched?" visible.

Tasks:

- Add per-root and per-workspace index reports.
  - Implemented first pass: `RelayDocumentSearchIndexReport.v1` summarizes
    per-root scanned, metadata-ready, filename-searchable, content-ready,
    inaccessible, extension-filtered, and cache-state facts without storing
    document contents.
- Track scanned files, metadata-ready files, content-ready files, failed files,
  stale files, skipped extensions, elapsed time, and last successful scan.
  - Implemented first pass: executor diagnostics now include scanned,
    metadata-ready, filename-searchable, content-ready, skipped-extension, and
    inaccessible counts. Failed/stale/scheduler fields remain future work.
- Add sync-journal reporting for created/modified/deleted/moved/failed/stale
  events.
  - Implemented first pass: `RelayDocumentSearchSyncJournal.v1` persists
    metadata-only search, metadata-scan, content-scan, inaccessible-path,
    truncation, cancellation, timeout, and filesystem-event records for local
    diagnostics without storing extracted document text, snippets, previews, or
    ParsedDocument IR.
- Add scheduler/backpressure reporting for queue depth, promoted files,
  throttled roots, paused state, and per-root concurrency.
  - Implemented first pass: `RelayDocumentSearchSchedulerReport.v1` reports the
    inline executor's queue depth, promoted content-inspection count, throttled
    roots, pause/busy/throttle reasons, per-root concurrency, writer-busy
    state, and scan/content budgets so support can explain waits and partial
    results.
  - Implemented follow-up: `RelayDocumentSearchBackgroundScheduler.v1` provides
    a real in-process bounded scheduler queue with pause/resume, cancellation,
    foreground promotion, global concurrency, and per-root concurrency. It is
    the execution boundary future watcher and periodic-scan producers can feed.
- Add rebuild/update/delete cache actions.
  - Implemented first pass: `RelayDocumentSearchCacheActions.v1` can inspect
    stores and clear rebuildable derived caches while preserving metadata,
    pins, recent searches, and job snapshots.
- Add index DB health checks and repair actions: integrity check, WAL
  checkpoint, compact, rebuild derived indexes, rebuild previews, rebuild one
  root, and full rescan.
  - Implemented first pass: `RelayDocumentSearchIndexMaintenance.v1` provides
    JSON-store integrity checks and a real `rebuild-derived-indexes` action
    backed by safe derived-cache clearing. DB-only operations (`wal-checkpoint`,
    `compact`) and preview/workspace-registry operations return explicit
    `not_applicable` results until the persistent index DB and workspace
    registry exist.

Acceptance:

- A user or support report can explain why a result set is incomplete.
- A user or support report can tell whether indexing is waiting because of
  network throttling, pause state, resource budget, retry backoff, or a long
  parse job.
- A user can repair a corrupt or stale derived index without reinstalling Relay
  or losing workspace roots, pins, search history, or scan policy.
- Cache rebuild does not require reinstalling Relay.

### Phase 1.6: Result Grouping, Pins, And History

Goal: reduce skew and repeated-file noise in shared folders.

Tasks:

- Collapse backup/copy/version variants under representative groups.
  - Implemented first pass: `RelayDocumentSearchResultGrouping.v1` groups clear
    backup/copy/version families, prefers non-variant/content-backed
    representatives, reports collapsed counts, and does not collapse normal
    period/date differences.
- Detect filing/output/audit/backups/work folders from path and metadata.
  - Implemented first pass: `RelayDocumentSearchFolderRoles.v1` classifies
    filing, output, audit, backup, work, source, and review folders from
    metadata-only path segments. Results carry `folder_role` / `folder_roles`,
    diagnostics summarize primary roles, and display cards can show
    beginner-safe folder role labels.
- Add pinned files/folders and recent search memory.
  - Implemented first pass: `RelayDocumentSearchUserMemory.v1` stores
    metadata-only pins and recent search records in a separate local store.
- Boost user-confirmed good candidates without hiding unpinned results.
  - Implemented first pass: pinned file/folder and recent-result boosts are
    added to ranking and score breakdown, while unpinned candidates remain in
    the result set.

Acceptance:

- A filing folder cannot dominate the top results solely because it has many
  similarly named files.
- Users can pin a known-good folder or file for future searches.

### Phase 1.7: Product Search Result Contract

Goal: make search results reliable UI objects rather than raw command output.

Tasks:

- Implement the Search Result Contract with match mode, evidence state, index
  state, score breakdown, anchors, preview, open action, and warnings.
  - Implemented first pass: `RelayDocumentSearchProductResult.v1` now wraps
    every executor result with match mode, evidence state, index state, score
    breakdown, anchors, preview/open state, preview/open action descriptors,
    action models, warnings, stable selection keys, and Copilot-independent
    citation/open/preview flags. `RelayDocumentSearchResult.v1` validation now
    rejects non-contracted result entries.
  - Implemented follow-up: product results now carry `source_indexes` and
    `primary_source_index` so AionUi can explain whether a card came from
    metadata, filename index, fallback filename matching, ParsedDocument IR,
    derived content index, table index, preview anchors, or user memory.
- Implement the Current UX Recheck cutover rules so the legacy SolidJS
  diagnostic shell never presents itself as the Workspace Document Search
  product surface.
- Implement the AionUi Skill-First Surface Boundary so Workspace Document
  Search is exposed through AionUi skills wired to Relay bridge contracts and
  lightweight result renderers, while the legacy Relay desktop shell remains
  diagnostic-only.
- Implement the AionUi / Docufinder / Dedoc Collision-Avoidance Contract so
  shell/navigation, folder roots, results, preview/open, conversation answers,
  skills, diagnostics, branding, and Copilot state each have one owner.
- Implement the AionUi Core UX Recheck so search uses ConversationTabs,
  SendBox, AtFileMenu, SlashCommandMenu, Workspace, PreviewPanel, and
  ConversationSkillsIndicator before any new page-level UX is considered.
- Implement the GuidPage Beginner Visibility Recheck so detected-agent pill
  bars, selected-assistant edit buttons, preset backend switchers, and
  assistant-management drawers are hidden unless advanced/support mode is
  deliberately enabled.
- Implement the UX Design System and Information Architecture around AionUi's
  `/guid` task launcher, composer, assistant presets, command palette,
  existing workspace controls, structured result renderer, preview/details
  pane, optional answer content, and advanced drawer.
- Implement the Curated Assistant Catalog so AionUi's upstream builtin presets
  are hidden by default unless they serve the beginner Word/Excel/PowerPoint,
  file-search, or grounded-summary workflows.
- Implement the Beginner UX Contract with Japanese-first labels, no-results
  guidance, simple mode labels, hidden setup/platform controls, and collapsed
  advanced details.
- Implement Dedoc Detail Progressive Disclosure so structure, tables,
  attachments, warnings, and Query Trace appear at the correct detail level.
  - Implemented first pass: `RelayDocumentSearchDisplay.v1` now exposes
    beginner-hidden detail levels and sections. Evidence locations, table/cell
    or structure anchors, attachment warnings, and Query Trace support facts are
    separated from the default result-card view so AionUi can disclose them only
    in details/support surfaces.
- Implement the Preview / Open / Evidence UX Contract with explicit preview and
  open states plus retry/rebuild actions.
  - Implemented first pass: product result objects expose `preview_state`,
    `open_state`, `preview_action`, `open_action`, and `action_models`;
    display cards convert those into beginner-safe labels and keep
    preview/open/evidence actions independent from Copilot answer text.
- Implement the Docufinder-Style Result UX Contract so result cards are
  content-led, batch-limited, continuation-capable, preview/open actionable, and
  independent of Copilot prose.
  - Implemented first pass: `RelayDocumentSearchDisplay.v1` reports total
    result count, shown count, next offset, and a `さらに表示`
    `show-more-results` continuation action for capped chat result cards.
  - Implemented follow-up: `RelayDocumentSearchResultFlow.v1` adds explicit
    batch offset/limit/range metadata, stable selection-key state for refresh
    and continuation, refine actions, partial/index state visibility, and
    Copilot-prose-secondary metadata. The AionUi bridge/MCP path now returns a
    result-flow envelope containing both the raw result contract and the
    renderer-neutral display contract.
- Show filename-only/content-backed/stale/failed/skipped state in the result UI.
  - Implemented first pass: display cards now map filename-only,
    content-backed, table-backed, stale, failed, skipped, metadata/content/table
    index, preview, and open states to beginner-safe Japanese labels.
- Show which local search path produced each result without exposing advanced
  implementation terms by default.
  - Implemented first pass: display cards expose beginner-safe labels such as
    `ファイル名索引から検索`, `本文の中身から検索`, and `表の中身から検索`,
    while the details layer can show the underlying source index list.
- Keep preview/open actions independent of Copilot answers.

Acceptance:

- A user can tell why a result appeared and whether it is evidence or only a
  candidate.
- A release cannot claim Workspace Document Search support unless AionUi search
  skills wired through Relay bridge contracts and the lightweight result
  renderer are reachable and covered by snapshots.
- Workspace Document Search is reachable from Relay-branded AionUi skills
  without exposing AionUi as a separate app or opening the legacy diagnostic
  shell.
- The default AionUi assistant/skill picker does not show unrelated upstream
  presets such as Cowork, OpenClaw setup, roleplay, Moltbook, Mermaid, academic
  paper, dashboard, or financial-model helpers.
- AionUi conversation/history state can reference result/evidence anchors
  without duplicating search state or file actions.
- Search UI, conversation answer UI, OfficeCLI skill UI, preview UI, and
  diagnostics never present competing actions or conflicting states for the same
  file/result.
- The default file-search workflow is reachable through AionUi-native surfaces:
  curated assistant menu, `/` command menu, `@` file mentions, workspace quick
  tree/filename filter plus status, chat result cards, and PreviewPanel.
- Broad result lists do not flood chat. The first batch is capped, `さらに表示`
  continues the same result set, and selection/preview state survives
  continuation and index refresh.
- The default UI does not expose `ParsedDocument`, `IR`, `Evidence Pack`, or
  `Query Trace` terminology unless the advanced drawer is opened.
- Result previews and file-open actions work without Copilot.
- Preview/open failures remain visible, actionable, and separate from AI answer
  text.

### Phase 2: Dedoc-Style Parser Pipeline And Document IR

Goal: normalize exact files into structured facts.

Tasks:

- Define `ParsedDocument` IR schema and versioning using Dedoc-compatible object
  names.
- Define a Dedoc API schema compatibility table for `ParsedDocument`,
  `DocumentContent`, `DocumentMetadata`, `TreeNode`, `LineMetadata`, `Table`,
  `TableMetadata`, `CellWithMeta`, and `Annotation`.
- Define `ReaderOutput`, `NormalizedDocument`, `ParsedDocument`, and
  `DerivedIndex` stages.
- Add parser pipeline interfaces: converter, reader, metadata extractor,
  structure extractor, table extractor, attachment extractor, warnings.
- Rename the parser metadata step conceptually to
  `DocumentMetadataExtractor` and keep it downstream of FileRecord input. The
  parser consumes FileMetadata snapshots; it does not perform directory
  discovery or own filesystem freshness.
- Add Converter Lineage so source file, converter output, reader input,
  parser/profile/parameters, and cleanup state are diagnosable.
- Add a Reader Capability Registry with explicit table, annotation, attachment,
  page-anchor, cell-anchor, cached-formula, OCR, hidden-state, and budget
  capabilities.
- Add structure profiles for `default`, `spreadsheet`, `financial_workpaper`,
  `filing_or_disclosure`, `audit_material`, `technical_document`, and
  `contract`.
- Add Dedoc-style pattern sets for each structure profile, including
  reader-tag, formatting, regex, and table patterns with versioned diagnostics.
- Implement MVP readers for existing supported formats:
  `.txt`, `.md`, `.csv`, `.docx`, `.xlsx`, `.xlsm`, `.pptx`, `.pdf`.
- Implement the format strategy matrix so unsupported but discoverable formats
  remain filename-searchable with explicit content-index warnings.
- Model attachments as recursive `ParsedDocument` records from the first schema
  version, even if most attachment extraction starts as warnings-only.
- Add the Attachments Policy with depth, count, byte, timeout, archive-path, and
  archive-bomb safeguards.
- Persist parser parameters and budgets as part of the parser cache key.
- Include source FileMetadata version in every parser cache key and
  ParsedDocument lineage record.
- Persist `document_type`, structure pattern version, PDF text-layer policy,
  PDF table-analysis policy, orientation-detection policy, and hidden-sheet
  policy as parser cache-key inputs.
- Version metadata schema, analyzer, parser pipeline, structure profile,
  ParsedDocument IR, derived indexes, Evidence Pack, and Search Result Contract
  separately.
- Emit warnings for unsupported old Office formats, password-protected files,
  hidden sheets, formulas without cached values, truncated extraction, and
  stale metadata.
- Normalize warnings with the shared warning taxonomy.
- Keep reader output, structure construction, tables, annotations, warnings, and
  attachments distinct in the stored IR.
- Preserve table/cell/annotation details needed for evidence, while warning on
  lossy or unavailable details.

Acceptance:

- Every successful parse produces IR with metadata, structure or tables, and
  warnings.
- Every successful parse references exactly one source FileRecord/FileMetadata
  version, plus recursive FileRecord references for extracted attachments where
  applicable.
- Unsupported or partial parses are explicit.
- Parser output remains pure and contains no query-specific relevance claims.
- Parser output cannot create or update workspace roots, filename cache entries,
  access snapshots, or scan state.
- Relay-specific extension fields do not break the Dedoc-compatible top-level
  schema.
- Schema validation proves `content.structure`, `content.tables`,
  `metadata`, `warnings`, and recursive `attachments` are present in the
  correct branches.
- Structure-profile diagnostics show applied pattern ids, matched anchors,
  rejected alternatives, and profile version.
- Reader-output and structure-construction failures are distinguishable in
  diagnostics.
- Conversion, reader, structure, table, attachment, and warning failures are
  distinguishable and traceable to exact lineage artifacts.
- Search and Evidence Packs cannot claim tables, OCR text, annotations,
  formulas, or attachments when the chosen reader capability is missing or
  degraded.

### Phase 3: Derived Content Indexes And Previews

Goal: search inside indexed documents without reparsing every query.

Tasks:

- Build node/table FTS indexes from IR.
  - Implemented first pass: `RelayDocumentSearchDerivedContentIndex.v1`
    builds rebuildable node/table-cell entries from `ParsedDocument` IR and
    searches those entries with the shared normalizer before the executor emits
    content evidence.
  - Implemented follow-up: `RelayDocumentSearchDerivedSearchStore.v1`
    materializes normalized keyword rows and preview span seeds into the
    durable derived-content cache. This is a JSON-backed local store boundary;
    SQLite/FTS-backed storage remains future work.
- Add table/cell and paragraph/page anchors.
  - Implemented first pass: derived entries emit
    `RelayDocumentSearchPreviewAnchor.v1` anchors for text nodes and table
    cells, preserving sheet/cell, row/column, page/line, parser profile, and
    confidence metadata where available.
- Add preview APIs for matched evidence.
  - Implemented first pass: preview anchor objects now carry title, location,
    snippet, source metadata version, ParsedDocument uid, and parser version so
    AionUi preview/details surfaces can render matched evidence without asking
    Copilot to restate it.
  - Implemented follow-up: `RelayDocumentSearchPreviewSpan.v1` is emitted for
    returned derived-content matches, carrying compact snippet text, matched
    terms, and deterministic highlight ranges for AionUi preview/details
    rendering.
  - Implemented follow-up: durable derived search-store records now preserve
    preview span seeds beside normalized keyword rows so cache hits can emit the
    same compact preview spans without reparsing documents.
- Keep all derived indexes rebuildable from metadata and IR.
  - Implemented first pass: the derived index consumes only `ParsedDocument` and
    stores source file id, source metadata version, ParsedDocument uid/version,
    and parser identity in the index contract.
- Commit derived indexes through the staging/swap flow so failed rebuilds do not
  erase the previous searchable state.
  - Implemented first pass: `RelayDocumentSearchDerivedContentIndexCache.v1`
    writes cache records through temp-file staging plus atomic rename, validates
    source metadata/parser lineage on read, rejects stale cache entries, and is
    cleared by `rebuild-derived-indexes` together with other rebuildable derived
    stores.
- Track whether a result came from filename cache, content FTS, table index,
  preview index, or future vector index.
  - Implemented first pass: executor diagnostics now report derived content
    index cache hits/misses/writes and entry/match counts separately from
    filename index and ParsedDocument cache state.
  - Implemented follow-up: each product result now records result-level source
    provenance through `source_indexes` and `primary_source_index`; executor
    ranking emits filename-index, ParsedDocument IR, derived-content,
    table/cell, preview-anchor, metadata, and user-memory sources where used.
- Implement deterministic ranking/grouping with score breakdown and warning
  penalties.
  - Implemented first pass: executor ranking now applies deterministic
    tie-breakers, carries base/final score breakdowns, subtracts explicit
    warning penalties for filename-only or unconfirmed content candidates, and
    reports penalty counts in diagnostics and Query Trace. Grouping also uses a
    stable file-id tie-breaker.

Acceptance:

- Search can show exact evidence locations such as sheet/cell, page, paragraph,
  line, or table row where available.
- Preview never fabricates content outside the indexed IR.

### Phase 4: Evidence Lifecycle And Validated Local Draft

Goal: answer from evidence, not from Copilot intuition.

Tasks:

- Build Evidence Pack generation from FileMetadata, filename hits, content
  hits, DocumentMetadata, IR nodes, warnings, and coverage.
  - Implemented first pass: `RelayDocumentSearchEvidencePack.v1` now composes
    per-query candidate files, content evidence items, minimal document
    metadata, parser identity, warnings, coverage, query-plan facts, and an
    explicit AI boundary while preserving the existing `evidence` / `warnings`
    compatibility fields.
- Build and persist Query Trace records for support export and golden-query
  evaluation.
- Add answer downgrade rules for filename-only, low coverage, stale index,
  failed parse, password protection, hidden content, and truncation.
- Enforce the FileMetadata / DocumentMetadata / ParsedDocument IR /
  Derived Index / Evidence Pack / Answer boundary during validation.
- Apply the Evidence Pack Redaction Policy before optional Copilot polish.
- Generate a deterministic local draft with candidate files, evidence, and
  caveats.
  - Implemented first pass: `RelayDocumentSearchLocalDraft.v1` is generated
    from `RelayDocumentSearchEvidencePack.v1` plus
    `RelayDocumentSearchQuality.v1`. It carries citation ids, candidate-only
    wording, caveats, next actions, and an AI boundary that allows Copilot only
    to polish after citation validation.
- Allow Copilot polish only after validation against the Evidence Pack and only
  through the citation-bound answer contract.
  - Implemented first pass for handoff input: `RelayDocumentSearchPolishRequest.v1`
    builds a `relay_answer_polish_prompt.v1` request only when the local draft
    is polishable and redaction produced Copilot-safe snippets. Local-only,
    metadata-only, and low-quality states produce `not_allowed` without a
    prompt.
  - Implemented first pass for live handoff: `RelayDocumentSearchPolishProvider.v1`
    can invoke an injected runner or the Relay OpenAI-compatible provider when
    explicitly enabled, sends only the prepared redacted prompt with no tools or
    original files, records optional Copilot request/turn ids, and hands the
    returned JSON candidate to the existing citation-bound validation path.
  - Implemented first pass: `RelayDocumentSearchPolishValidation.v1` validates
    optional `RelayDocumentSearchPolishedAnswer.v1` candidates against the
    current Evidence Pack/local draft ids, declared and inline citation ids,
    known file/sheet/cell mentions, truncation/duplication checks, redaction
    skip state, and an at-most-once repair boundary before any polish can
    replace the local draft.
- Commit the local draft first, then replace the visible answer at most once
  with accepted Copilot polish.
  - Implemented first pass: `RelayDocumentSearchAnswer.v1` records whether the
    visible answer came from the local draft or accepted citation-bound Copilot
    polish, keeps the local-draft commit explicit, and sets
    `canReplaceAgain: false` after one accepted replacement.
- Enforce the AI Boundary Contract for optional Copilot polish and summaries.
- Persist prompt template ids/versions and correlation ids from AionUi message
  through Relay job, Copilot request, Evidence Pack, local draft, and accepted
  polish.
  - Implemented first pass: `RelayDocumentSearchPolishValidation.v1` now
    records answer-polish and polish-repair prompt template ids plus a
    correlation block for Relay job/query ids, AionUi conversation/message ids,
    optional Copilot request/turn ids, Evidence Pack id, local draft id, and
    accepted polished answer id.
- Treat Copilot warming, sign-in, capture failure, timeout, rate limit, tenant
  restriction, or policy disablement as visible optional-polish states. They
  must not block result cards, local drafts, preview/open actions, cancel, or
  retry.
  - Implemented first pass: `RelayDocumentSearchCopilotState.v1` records
    `copilot_ready`, warming/sign-in/disconnected/capture/timeout/rate-limit/
    tenant/policy-disabled, and terminal polish states as support-visible
    optional-polish state. Every state preserves `local_search_blocked: false`,
    `local_draft_blocked: false`, `preview_open_blocked: false`, and
    `should_wait_for_copilot: false`.
- Reject duplicated, truncated, unstructured, or unsupported Copilot polish
  after at most one strict repair request, then keep the validated local draft.

Acceptance:

- AionUi can show broad lookup requests with a grounded candidate list even when
  Copilot is unavailable.
- Copilot-polished answers cannot mention files or claims outside the Evidence
  Pack.
- Copilot abnormal states are represented in Query Trace and support export
  without causing indefinite UI waiting.
- The final result card is committed once from the local draft, and replaced at
  most once by accepted citation-bound Copilot polish.

### Phase 5: Freshness Sync For Local And Shared Folders

Goal: keep the index close to disk reality without blocking the UI.

Tasks:

- Detect mtime/size changes and mark content stale.
  - Implemented first pass: `RelayDocumentSearchFreshness.v1` compares expired
    metadata-cache records with the current scan, records created/modified/
    deleted metadata changes, and marks changed entries as `content_stale`
    without storing extracted content or original files.
- Detect access/ACL changes and mark content evidence stale or unavailable when
  current-user access changes.
  - Implemented first pass: metadata records now support separate metadata,
    content, preview, and open access snapshots. `RelayDocumentSearchFreshness.v1`
    records `access_changed` stale/unavailable evidence, and product result
    state downgrades preview/open/citation actions for denied, missing, offline,
    locked, or policy-blocked files without using stale content as fresh
    evidence.
- Preserve stable file identity across high-confidence rename/move and record
  tombstones for deleted or moved paths.
  - Implemented first pass: `RelayDocumentSearchFreshness.v1` detects unique
    size/mtime/extension delete-create pairs as high-confidence `moved`
    metadata changes, preserves the previous file id for that freshness event,
    and records tombstone counts for deleted or moved paths without treating
    low-confidence moves as stable identity migration.
- Migrate pins, history, and derived-index ownership only for high-confidence
  moves.
  - Implemented first pass for user memory: `RelayDocumentSearchUserMemory.v1`
    remaps pinned file paths and recent-search result paths/file ids only from
    high-confidence `moved` freshness events before ranking applies
    user-memory boosts.
  - Implemented first pass for derived-index ownership:
    `RelayDocumentSearchDerivedIndexOwnership.v1` records high-confidence moves
    as transfer-on-rebuild events owned by the current file id/source metadata
    and explicitly disallows implicit cache reuse when path or metadata lineage
    changes.
  - Implemented follow-up for content-bearing cache migration:
    `RelayParsedDocumentCacheMoveMigration.v1` rewrites existing
    ParsedDocument cache records to the current file id/path/source metadata
    only for high-confidence moves with matching size and modified time. This
    keeps moved-file cache reuse explicit and lineage-bound rather than relying
    on stale path metadata.
- Use filesystem watchers where reliable.
  - Implemented first pass: `RelayDocumentSearchSyncProducer.v1` starts
    filesystem watcher handles through an injectable/default `fs.watch`
    adapter, records metadata-only `watcher_started` / `watcher_event` journal
    entries, and feeds `watcher_sync` work into the background scheduler.
  - Implemented follow-up: the producer expands watcher coverage recursively
    with explicit max-depth, max-directory, and excluded-directory limits, and
    reports watched/skipped/limit state per root.
  - Implemented follow-up: network-share-looking roots default to
    periodic-only watcher policy, avoiding filesystem watcher startup while
    exposing the policy reason in per-root sync producer diagnostics.
- Use periodic scan for mapped drives, UNC shares, or watcher-missed events.
  - Implemented first pass:
    `RelayDocumentSearchSyncReconciliation.v1` derives watcher freshness and
    periodic-scan due state from metadata-only sync journal events. Executor
    diagnostics expose that reconciliation report when the sync journal is
    enabled.
  - Implemented follow-up: `RelayDocumentSearchSyncProducer.v1` schedules
    periodic root scans into `RelayDocumentSearchBackgroundScheduler.v1` and
    records metadata-only `periodic_scan_started` /
    `periodic_scan_completed` journal entries.
  - Implemented startup boundary: the AionUi MCP stdio entry can opt in to
    sync-producer startup with `RELAY_DOCUMENT_SEARCH_SYNC_PRODUCER=1`, using
    the current workspace root and existing sync journal configuration.
- Prioritize query-related stale files before idle background work.
  - Implemented first pass: `RelayDocumentSearchBackgroundScheduler.v1` can
    promote queued work to `foreground` with an explicit promotion reason so
    query-related stale files run ahead of idle indexing.
- Enforce scheduler backpressure so sync, parse, and rebuild work cannot starve
  filename search.
  - Implemented first pass: `RelayDocumentSearchBackgroundScheduler.v1`
    enforces a bounded queue, global concurrency, per-root concurrency,
    pause/resume, and cancellation before running background document-search
    work.

Acceptance:

- Changed files are marked stale before being reused as fresh evidence.
- Previously indexed content is not reused as fresh evidence after access is
  denied or a share goes offline.
- Deleted files are removed from active search but explainable through
  tombstones and old Evidence Packs.
- Low-confidence moves are treated as delete plus create rather than silently
  migrating evidence.
- Network folders do not depend solely on watcher reliability.

### Phase 6: Optional Heavy Features

Goal: add higher-recall features only after the deterministic foundation works.

Candidates:

- OCR for scanned PDFs/images.
- Local embeddings and vector index.
- Semantic/hybrid search with reciprocal-rank fusion.
- Archive and email attachment indexing.
- Old Office conversion adapter.
- Optional Dedoc adapter.
- Offline extractive summaries derived from IR/Evidence Pack.

Acceptance:

- Heavy features can be disabled without breaking filename, keyword, IR, or
  evidence search.
- Feature pack state controls search-mode availability and warnings instead of
  silent mode fallthrough.
- Optional adapters never become prerequisites for local filename search or
  validated local drafts.
- Optional adapters must satisfy the Adapter Adoption Criteria before becoming
  default-enabled.

## MVP Completion Gate

The MVP is complete when a broad shared-folder request can:

- Register or reuse the target folder as a workspace root.
- Show early filename candidates from the in-memory filename cache backed by
  persisted metadata.
- Report indexing progress and incomplete coverage.
- Expand top candidates with exact reads or IR evidence where available.
- Avoid claiming completeness when results are filename-only or skewed.
- Return confirmed results where possible, plus any remaining deterministic
  candidate list with searched roots, skipped/failed/pending counts, and next
  suggested narrowing steps.
- Preserve mode/evidence/index state in every result.
- Keep optional Copilot polish disabled without reducing local search utility.
- Respect managed policy and local-only mode without hidden fallback behavior.
- Provide a previewable metadata-only support export for failed or partial
  searches.

## Release And Feature-Flag Gate

Workspace Document Search should remain behind a release flag until the product
contract is proven end to end. The flag can be internal-only, beta, or
beginner-visible:

- `internal-only`: schema, executor, and tests may exist, but `/guid` does not
  expose `資料を探す` as a beginner production entry.
- `beta`: visible only when `relay.advancedSurfaces.enabled` or a beta flag is
  enabled; support export and diagnostics must be complete.
- `beginner-visible`: default product path after all release gates pass.

Promotion gates:

- high-level tool catalog and alias validation pass;
- executor job lifecycle, cancel/retry/timeout, store lock, safe subprocess,
  cache/privacy, policy, and warning-copy tests pass;
- golden-query quality and skew gates pass;
- local-only mode works with Copilot signed out;
- Windows smoke covers Japanese paths, mapped/UNC roots, long paths,
  OneDrive/SharePoint placeholders, denied files, and 100k-file warmed cache
  latency;
- support export is redacted and previewable;
- rollback disables the beginner entry without deleting roots, pins, history, or
  healthy metadata.

Acceptance:

- A release cannot accidentally expose a half-wired `資料を探す` entry because
  the seed/manifest checks fail when the feature flag is not promoted.
- Rolling back a bad search release hides the beginner entry and preserves local
  user state for repair/rescan.

## Verification Plan

Required checks:

- Query-normalization tests for NFKC, case, punctuation, CJK n-grams, C/F/CF/CFS
  synonyms, period/quarter aliases, and extension handling.
- Analyzer strategy tests for path, filename, content, table, heading, and query
  analyzer versioning.
- Query-plan unit tests for path, filename, content, period, and file-type hints.
- Tool-contract schema tests proving the OpenAI-compatible
  `relay_document_search` schema maps to `RelayDocumentSearchRequest.v1`, does
  not accept internal Relay-controlled fields, and rejects invalid roots,
  unsupported intent values, malformed file-type filters, and unsafe paths.
- Schema single-source tests proving the OpenAI tool schema, AionUi manifest
  metadata, runtime validator, fixtures, and generated skill/tool instructions
  cannot drift from the source contract module.
- Tool-catalog registration tests proving AionUi/OpenAI-compatible provider
  metadata advertises `relay_document_search` with the expected schema, and
  treats `workspace-search` / `find-files` as high-level aliases only when the
  advertised schema or `resultContract` matches the Relay contract.
- Bridge-boundary tests proving OpenAI/AionUi tool-call shapes are accepted
  only for the exact tool or contract-bound aliases, invalid JSON stops as a
  structured error, and successful execution returns a valid
  `RelayDocumentSearchResult.v1` tool message without hidden fallback.
- MCP wiring tests proving the Relay document-search stdio server is built,
  aionrs sessions receive it with the selected workspace root, and the server
  delegates to the bridge instead of duplicating search logic.
- Display-adapter tests proving result-card fields, Japanese status/warning
  copy, coverage copy, first-batch truncation, and invalid-result fallback are
  deterministic without relying on Copilot prose.
- Executor lifecycle tests for `job_id`, progress events, duplicate-submit
  attachment, cancellation acknowledgement, timeout-to-partial behavior, retry
  tokens, and deterministic result ids.
- Process coordination tests proving single-writer locking, second-window
  read/attach behavior, stale-lock recovery, crash-abandoned jobs, and no
  competing full scans for the same root.
- External command safety tests proving `rg`, OfficeCLI, PDF readers, and
  parser adapters are spawned without shell strings, reject injected filenames
  and queries, enforce stdout/stderr caps, propagate cancellation, and report
  timeout/truncation as structured warnings.
- Live M365 smoke replacement proving broad document-search prompts call
  `relay_document_search` first, keep raw `glob_search` / `grep_search` out of
  the model-visible first step, and render `RelayDocumentSearchResult.v1` in
  the Relay-branded AionUi UI.
- Copilot prompt-version tests proving model-facing tool prompts, repair
  prompts, query-suggestion prompts, answer-polish prompts, and polish-repair
  prompts are versioned artifacts recorded in Query Trace.
- Copilot correlation tests proving AionUi conversation/message ids, Relay
  job/query ids, Copilot session/request/turn ids, Evidence Pack ids, local
  draft ids, and accepted polish ids are connected in diagnostics without using
  Copilot DOM text as search state.
- Copilot session-state tests proving warming, sign-in required, disconnected,
  capture unhealthy, timeout, rate limit, tenant restriction, and policy
  disablement downgrade to local result/local draft rendering without blocking
  cancel, retry, preview, or open.
- Feature-flag and release-gate tests proving `資料を探す` is hidden in
  internal-only mode, beta-gated in beta mode, beginner-visible only after all
  gates pass, and rollback hides the entry without deleting user state.
- Enterprise/local-only policy tests proving content indexing, Copilot polish,
  support export, network roots, and unprotected content caches can be disabled
  without exposing raw fallback tools.
- Observability/log tests proving logs rotate, stay local by default, redact
  paths/snippets, avoid raw document contents, and support export is previewable
  before saving.
- Golden-query quality-gate tests proving top-k recall, folder-skew,
  unsupported-claim, coverage-message, and latency thresholds are enforced.
- Copilot suggestion-boundary tests proving suggestions can add only validated
  terms, file-type hints, or clarification prompts and cannot change roots,
  budgets, confirmation policy, or searched coverage.
- Metadata scanner tests with nested folders, large file counts, inaccessible
  files, and deleted/modified files.
- Path-boundary tests for mapped drives, UNC paths, traversal attempts,
  hidden/system policy, symlinks, junctions, and reparse points escaping the
  registered root.
- Windows path/sync-provider tests for extended-length paths, DFS paths,
  OneDrive/SharePoint placeholders, offline cloud files, and hydrated cloud
  files.
- Permission/ACL freshness tests for access denied, offline shares, permission
  changes after indexing, preview denial, open denial, and stale historical
  content.
- Sync-journal tests for create/modify/delete/move and periodic reconciliation.
- Delete/move/rename tests for stable ids, tombstones, pin/history migration,
  low-confidence delete-plus-create, and stale historical Evidence Packs.
- Scheduler/backpressure tests for bounded queues, foreground promotion,
  per-root concurrency, network throttling, pause/resume, cancellation, retry
  backoff, and restart resume.
- In-memory filename cache tests for startup rebuild, incremental scan updates,
  and cache/database consistency.
- Filename search tests for substring, CJK terms, extension filters, and
  truncation.
- Search Result Contract tests for match mode, evidence state, score breakdown,
  anchors, preview, open action, and warning propagation.
- Current-UX recheck tests proving the SolidJS shell remains diagnostics-only,
  does not expose Workspace Document Search as a normal product path, and points
  users to the Relay-branded AionUi shell.
- AionUi integration tests proving search skills are reachable from the
  Relay-branded AionUi shell, render contracted result objects, and do not route
  users into the legacy diagnostic shell.
- AionUi history/anchor tests proving Copilot-polished answers, previews, and
  open actions resolve to the same contracted result objects after restart.
- Collision-avoidance tests proving one owner per concern: AionUi shell/routes,
  AionUi preview/open/actions, contracted result/status facts, Relay evidence
  validation, AionUi conversation storage, and advanced diagnostics.
- Conflict-copy tests proving the UI never shows AionUi as a separate product,
  never offers a second Relay search shell, and never presents Dedoc/internal
  vocabulary in beginner result rows.
- UX information-architecture tests or snapshots for first-run empty state,
  skill invocation, folder registration, structured search results,
  preview/evidence details, answer content, advanced drawer, and no-results
  state.
- Beginner-language tests proving main UI copy avoids internal terms such as
  `ParsedDocument`, `IR`, `Evidence Pack`, `Query Trace`, parser pipeline, and
  schema version.
- Accessibility tests for keyboard navigation, visible focus, ARIA progress and
  status labels, color-not-only badges, reduced motion, and Japanese font
  fallback.
- Search mode contract tests proving filename, keyword, hybrid, evidence, and
  similar modes do not silently change semantics.
- ParsedDocument IR schema tests for text, spreadsheet, Office, PDF, recursive
  attachment placeholders, annotations, tables, warnings, and parser profiles.
- FileMetadata/DocumentMetadata boundary tests proving the scanner owns
  FileRecord discovery, access snapshots, filename cache state, and freshness,
  while the parser owns only DocumentMetadata and ParsedDocument artifacts for a
  supplied FileRecord snapshot.
- No-duplicate-scan tests proving parser, reader, Dedoc adapter, and optional
  converters never walk workspace roots or start independent glob/list discovery
  outside the scheduler-owned FileRecord queue.
- Converter-lineage tests proving source, converter output, reader input,
  parser parameters, cleanup state, and stage-specific failures are preserved.
- Reader Capability Registry tests proving missing/degraded capabilities lower
  evidence confidence and prevent impossible anchors or unsupported claims.
- Intermediate-representation tests proving `ReaderOutput`,
  `NormalizedDocument`, `ParsedDocument`, and `DerivedIndex` boundaries are
  preserved.
- Dedoc-compatibility tests for top-level `ParsedDocument` field names,
  `DocumentContent.structure`, `DocumentContent.tables`, `DocumentMetadata`,
  recursive `TreeNode`, `LineMetadata`, `TableMetadata`, `CellWithMeta`, and
  `Annotation` shape.
- Structure-pattern tests proving reader-tag, formatting, regex, and table
  patterns produce auditable profile decisions and invalidate derived indexes
  when pattern versions change.
- Format strategy tests proving unsupported formats stay filename-searchable and
  content indexing reports normalized warnings.
- Attachment-policy tests for recursive child documents, parent-child
  provenance, depth/count/byte limits, archive path canonicalization, archive
  bomb guards, nested containers, and disabled/unsupported attachment warnings.
- Warning tests for password-protected/unsupported/truncated/stale cases.
- Evidence Pack validator tests proving unsupported claims are rejected.
- AI boundary tests proving optional Copilot polish receives only Evidence Pack
  snippets and cannot introduce unsupported claims.
- Citation-bound polish tests proving every factual claim cites Evidence Pack
  ids, every mentioned file/path/sheet/cell/page/date/amount/count exists in
  the local draft or Evidence Pack, and duplicated, truncated, unstructured, or
  unsupported Copilot output is repaired at most once before rejection.
- Redaction policy tests proving sensitive values are removed before optional
  Copilot polish.
- Query Trace tests proving normalization, matched indexes, ranking steps,
  coverage, redaction policy, and validation outcome are inspectable.
- Index consistency tests proving failed parser/index rebuilds preserve the
  previous searchable state.
- Parser parameter cache-key tests proving profile/budget/filter changes do not
  reuse incompatible `ParsedDocument` payloads.
- Source metadata-version cache-key tests proving mtime/size/access/type-guess
  changes stale ParsedDocument and derived indexes without duplicating
  FileMetadata rows.
- Schema evolution tests proving analyzer/index/IR version changes invalidate or
  rebuild only the correct artifacts.
- Adapter adoption tests for optional Dedoc/OCR/vector adapters against fixture
  quality, fallback, packaging, and disablement criteria.
- Feature-pack tests proving disabled, missing, unhealthy, or version-mismatched
  optional packs change mode availability and warnings without breaking core
  filename/keyword/IR flows.
- Index DB health tests for startup integrity checks, incomplete staging
  cleanup, WAL checkpoint/compact, derived-index rebuild, root rebuild,
  cancellation, and non-destructive repair.
- Preview/open UX tests proving result actions, preview states, open states,
  stale/denied/missing handling, and answer-to-result anchors stay consistent.
- UI/diagnostic smoke for index progress, coverage, and failed-file reporting.
- Large-result UI performance tests for capped batches, `さらに表示`, stable
  selection, background index updates, loading states over 300 ms, and disabled
  duplicate actions. Existing AionUi workspace-tree virtualization, if any,
  remains covered separately from chat result cards.
- Local privacy/data-flow tests proving Copilot polish receives only selected
  Evidence Pack snippets.
- Cache-retention and deletion tests proving workspace-root removal deletes
  derived metadata/text/index caches after confirmation, preserves unrelated
  roots, and keeps support export free of original files by default.
- Cache quota and at-rest protection tests proving quota eviction order,
  retained user state, Windows user-scoped protection or explicit downgrade,
  uninstall/cleanup discoverability, and support export redaction.
- Upgrade/rollback/downgrade tests proving schema migrations preserve roots,
  pins, history, and scan policy; failed migrations roll back or disable stale
  evidence; and older app versions cannot overwrite newer stores.
- Warning copy-map tests proving every Phase -1 warning has beginner Japanese
  text, support text, severity, retryability, result-state effect, and
  answer-downgrade effect.
- Phase -1 format-coverage tests proving `.txt`, `.md`, `.csv`, `.docx`,
  `.xlsx`, `.xlsm`, `.pptx`, and `.pdf` follow the promised search/read
  behavior, while `.doc`, `.xls`, archives, images, encrypted files, and
  unsupported formats remain filename-searchable with warnings.

## Evaluation Corpus

Maintain a small local fixture corpus that represents expected field failures:

- Deep shared-folder tree with many irrelevant files.
- Filename-only candidates that should not be treated as evidence.
- Backup/copy/version-heavy folders that test grouping and skew control.
- Spreadsheet with hidden sheets, formulas without cached values, merged cells,
  external links, and multiple candidate CFS/BS/PL sheets.
- DOCX/PDF with headings, tables, footers, and page/paragraph anchors.
- Unsupported `.doc`, `.xls`, archive, and image files that remain
  filename-searchable but content-skipped.
- Locked/inaccessible file fixtures.
- Windows long-path, DFS, OneDrive/SharePoint placeholder, and hydrated cloud
  file fixtures.
- Stale index fixture where mtime/size changes after indexing.
- Permission-change fixture where a previously readable file becomes denied and
  a denied file later becomes readable.
- Rename/move/delete fixture with stable identity and low-confidence conflict
  cases.
- Converter-lineage fixture with original, converted, lossy, failed, and
  unavailable conversion paths.
- Symlink, junction, reparse-point, and traversal fixtures that try to escape a
  registered root.
- Archive/email fixture with nested attachments, duplicate names, path
  traversal entries, and budget-exceeded cases.
- Optional feature-pack fixture matrix where OCR/semantic/converter packs are
  present, disabled, missing, stale, or version-incompatible.
- Index DB repair fixture with corrupt disposable indexes, incomplete staging
  records, stale previews, and preserved user state.
- UX fixture/snapshot set for empty workspace, indexing in progress, partial
  results, no results, access denied, stale/moved/deleted result, parser warning,
  attachment warning, and Copilot unavailable.
- Policy fixture set for metadata-only mode, Copilot-polish disabled,
  content-cache protection required, denied network roots, support-export
  disabled, and root consent not yet granted.
- Release-gate fixture set for internal-only, beta, beginner-visible, and
  rollback states.

The corpus should support repeatable top-k relevance checks, warning checks,
Evidence Pack validation, and UI result-state snapshots.

Golden queries should be checked into the repo beside the fixture corpus:

```json
{
  "query": "160連結 キャッシュフロー 精算表",
  "mode": "hybrid",
  "expected_top_files": [
    "160期-1Q/.../連結CFS精算表.xlsx",
    "160期-1Q/.../XSA_連結CF.xlsx"
  ],
  "must_not_claim_complete_without_content_evidence": true
}
```

Golden results are not only for ranking. They also assert evidence state,
warning propagation, coverage messaging, and answer downgrade behavior.

## Quality Metrics

Relay should record these metrics for diagnostics and regression testing:

- Filename search latency.
- First-progress latency for a submitted search.
- Metadata scan throughput.
- Content indexing throughput.
- Indexer queue depth, throttling duration, pause duration, cancellation count,
  and foreground-promotion latency.
- In-memory filename cache size and rebuild time.
- Top-k relevance for curated shared-folder fixtures.
- Golden-query pass rate.
- Golden-query top-k recall, forbidden false-positive count, unsupported-claim
  count, and folder-skew failure count.
- Folder skew rate, such as one filing/backup folder dominating results.
- Stale index rate.
- Move/rename confidence distribution and tombstone lookup count.
- Path-boundary block count by reason.
- Permission/access-denied rate by root and action type.
- Failed parse rate by extension and warning type.
- Converter success/failure/lossy rate by format and converter version.
- Reader degraded-capability rate.
- Attachment skipped/depth/byte/count warning rate.
- Feature pack unavailable/disabled/unhealthy rate.
- Preview/open failure rate by reason.
- Index DB health check, repair, rebuild, compact, and cancellation counts.
- Store lock contention, stale-lock recovery, and abandoned-job counts.
- First-result time and first-filename-searchable time after folder add.
- Cancel acknowledgement latency and post-cancel read suppression count.
- Duplicate-submit attachment rate versus duplicate job creation rate.
- Timeout-to-partial rate and partial-result recovery action rate.
- No-results recovery action rate.
- Preview open-through rate and file-open success rate.
- Advanced drawer open rate, to monitor whether beginner UI is leaking too much
  complexity.
- Accessibility regression count for keyboard, focus, contrast, and Japanese
  font fallback.
- Evidence coverage score.
- Copilot polish rejection rate when validation catches unsupported claims.
- Copilot session-state counts by warming, sign-in, disconnected, capture
  unhealthy, timeout, rate-limited, tenant-restricted, and policy-disabled
  state.
- Copilot prompt-template version usage and prompt-regression failure count.
- Copilot polish acceptance, strict-repair, rejection, duplicate-output,
  truncation, unsupported-claim, and citation-missing counts.
- Time to local draft versus time to accepted Copilot polish, with local draft
  treated as the primary completion metric.
- Search mode fallback rate.
- Unsupported-format discovery count versus content-index skip count.
- Workspace-root cache delete duration and retained-cache warning count.
- Cache quota pressure, eviction count by artifact type, at-rest protection
  state, and plaintext-cache downgrade count.
- External command timeout, output truncation, cancellation, and unsafe-argument
  rejection counts by tool kind.
- Windows long-path, DFS, sync-provider placeholder, hydration-required, and
  cloud-offline warning counts.
- Schema migration success, rollback, downgrade-readonly, and rescan-required
  counts.
- Warning-copy coverage rate for beginner and support messages.
- Feature-flag promotion state and release-gate failure reason.
- Policy-denial count by policy key and local-only usage count.
- Log redaction failure count, support-export preview count, and network
  telemetry enabled/disabled state.
- Query normalization expansion count and false-positive rate.
- Query trace completeness rate.
- Redaction skip/polish rate.
- Analyzer-version rebuild count.
- Optional-adapter improvement delta on golden queries.

## Explicit Non-Goals

- Do not copy Docufinder code into Relay.
- Do not bundle Dedoc until dependency, size, license, and Windows packaging
  impact are reviewed.
- Do not reintroduce `office_search` as an unrestricted model-facing tool.
- Do not require Copilot for local search.
- Do not use arbitrary shell, VBA, or uncontrolled COM execution as a search
  workaround.
- Do not silently treat filename hits as document-content evidence.
