# Relay_Agent Execution Tasks

Date: 2026-05-17

## Active Goal

Move Relay away from a growing Relay-specific tool/runtime design and toward an
OpenCode-compatible local tool contract hosted by Microsoft Agent Framework and
projected through AG-UI.

Relay still uses M365 Copilot through Edge CDP as the reasoning controller.
Relay should not adopt Codex app-server as the runtime in this task queue, but
Codex app-server remains useful prior art for approvals, sessions, tool
results, sandboxing, streaming, and diagnostics.

The next active queue is `DCI*`. It incorporates the 2026-05-17 Direct Corpus
Interaction plan from `PLANS.md`: improve local search and document/data review
by giving Copilot high-resolution raw-corpus tools through Agent Framework and
OpenCode-compatible tool semantics, not by rebuilding a Relay-specific
retriever or a separate document-search mode.

The previous `POSTLIVE*` queue remains completed history below. It should not
be extended unless a regression proves those acceptance criteria have broken.

## Execution Rules

- Execute tasks in order unless a task explicitly says it can run in parallel.
- Do not add new model-visible Relay-specific tool names.
- Do not fix Copilot mistakes by adding broad prompt-only folklore.
- Prefer Agent Framework function/MCP tools and middleware for tool admission,
  approval, terminal eligibility, and tool-result feedback.
- Keep AG-UI as the only frontend run/event/state/approval protocol.
- Every completed task must update `docs/IMPLEMENTATION.md` with the artifact
  and verification result.
- Run at least `pnpm check` before marking a milestone complete.

## Task Queue

### DCI01 - Document The DCI Tool Contract Boundary

Status: completed

Scope:

- Update `docs/OPENCODE_TOOL_CONTRACT.md` with a DCI section that explains how
  `glob`, `grep`, `read`, bounded `bash`, and `apply_patch` compose into raw
  corpus interaction.
- Explicitly state that Relay will not revive `RelayDocumentSearch*`,
  SQLite/FTS, or a dedicated search mode for this milestone.
- Map DCI paper concepts to Relay ownership:
  - Agent Framework: session, continuation, middleware, tool loop;
  - OpenCode: model-facing local tool shape;
  - Relay: policy, Office/PDF extraction, Windows/shared-folder safety,
    diagnostics, packaging;
  - AG-UI: investigation trace and approvals.

Artifacts:

- Updated `docs/OPENCODE_TOOL_CONTRACT.md`.
- Implementation log entry with the paper/repo references.

Acceptance:

- The doc makes it clear that DCI is a generic agent recipe over existing
  tools, not a new retrieval subsystem.
- The doc lists which DCI capabilities are implemented as first-class tools
  and which are intentionally blocked or bounded.

Verification:

- `git diff --check`

### DCI02 - Add DCI-Grade Structured Grep

Status: completed

Scope:

- Extend the Agent Framework `grep` function signature with structured
  arguments for:
  - `allTerms`;
  - `anyTerms`;
  - `excludeTerms`;
  - `fixedStrings`;
  - `caseInsensitive`;
  - `contextLines`;
  - `includeGlobs`;
  - `excludeGlobs`;
  - `maxMatchesPerFile`;
  - `limit`;
  - `timeoutMs`.
- Keep the existing `pattern` and `glob` arguments as OpenCode-compatible
  simple paths.
- Compile structured filters to safe ripgrep argv. Always put `--` before
  model/user patterns.
- Return structured observations with path, displayPath, line number, excerpt,
  matched terms, truncation, and continuation guidance.
- Do not route Office/PDF containers through `grep`; keep exact `read` for
  those.

Artifacts:

- Sidecar grep implementation update.
- Tool catalog snapshot update.
- Grep smoke covering conjunctive terms, exclusion terms, context lines,
  caps, and a pattern starting with `-`.

Acceptance:

- A request such as "部品売上" can require both concept terms to appear in the
  same file/context before a candidate is promoted.
- Misleading entity-name-only matches can be demoted by requiring contextual
  evidence instead of relying on filename rank.
- Existing simple `grep(pattern, glob)` behavior remains compatible.

Verification:

- new DCI grep smoke
- `pnpm agent:tool-catalog-smoke`
- `pnpm agent:rg-stream-smoke`
- `pnpm check`

### DCI03 - Improve Read Observations For Evidence Anchors

Status: completed

Scope:

- Extend `read` observations with stable evidence anchors:
  - text/code: line ranges and offset/limit continuation;
  - Excel/CSV: sheet/table/cell/range hints when available;
  - Word/PDF/PPT: page/section/slide anchors when available.
- Keep full local artifacts in Relay storage/support bundles, but project
  bounded excerpts and hashes to Copilot.
- Add `evidenceState` values that distinguish filename/path candidates,
  generic content hits, conjunctive concept hits, and exact local evidence.

Artifacts:

- Sidecar read observation update.
- Office/PDF extraction smoke updates.
- Updated AG-UI replay fixture if event payload shape changes.

Acceptance:

- Copilot can cite or reason from exact local observations without receiving
  entire large files.
- Office/PDF candidate promotion can depend on actual extracted content when
  available.
- Local full artifacts remain user-controlled and redacted by default in
  support bundles.

Verification:

- `pnpm agent:office-pdf-read-smoke`
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI04 - Add Agent Framework DCI Context Middleware

Status: completed

Scope:

- Implement deterministic tool-result truncation by tool type in the Agent
  Framework middleware/projection layer.
- Add compaction that preserves the ordered trajectory skeleton:
  tool name, args summary, paths, hashes, counts, latest evidence snippets,
  and artifact IDs.
- Keep the most recent turns intact and compact older bulky observations when
  accumulated tool output crosses a threshold.
- Do not add LLM summarization in this task. Summarization can be considered
  later only if replayable and observable.

Artifacts:

- Middleware/projection update.
- Context compaction smoke with repeated `grep`/`read` observations.
- Implementation note describing thresholds and artifact retention.

Acceptance:

- Long DCI investigations do not flood Copilot with raw tool output.
- The AG-UI replay/support bundle can reconstruct what was searched and read.
- Compaction cannot hide a mutation or approval event.

Verification:

- new context compaction smoke
- `pnpm agent:framework-trace-smoke`
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI05 - Add DCI Search Recipe To Framework Guidance

Status: completed

Scope:

- Add concise Agent Framework instruction/projection guidance for DCI behavior:
  search direct terms, combine weak clues, inspect local context, extract new
  terms/entities, refine, cross-check, and answer only after relevant
  observations exist.
- Keep this guidance generic across local file search, codebase exploration,
  Office review, and evidence-backed Q&A.
- Do not add a `document_search` tool, a fixed taxonomy, or a task-specific
  planner.

Artifacts:

- Agent instructions/tool projection update.
- Golden smoke where a misleading filename/entity candidate must not win over
  a lower-ranked file with conjunctive local evidence.

Acceptance:

- The model has enough guidance to use DCI-style iterative exploration without
  being forced into a brittle fixed query plan.
- `final` is blocked or corrected when local evidence was required but no
  local observation exists.

Verification:

- new DCI golden smoke
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm agent:framework-native-prevention-smoke`
- `pnpm check`

### DCI06 - Render AG-UI Investigation Timeline

Status: completed

Scope:

- Update Workbench run rendering so DCI-style runs show:
  - search terms tried;
  - files inspected;
  - evidence snippets/anchors;
  - refinements;
  - caveats and terminal confidence.
- Keep the default surface minimal and professional. Diagnostics and raw JSON
  stay collapsed under support details.
- Ensure approvals and mutations remain visually distinct from read-only
  investigation events.

Artifacts:

- Workbench timeline UI update.
- UX E2E snapshot or Playwright assertion.

Acceptance:

- Users can understand why a candidate was selected without reading raw
  Copilot/tool JSON.
- The UI does not reintroduce separate "file search / Office / code" modes.
- The trace remains AG-UI-event driven.

Verification:

- `pnpm workbench:ux-e2e`
- `pnpm check`

### DCI07 - Add Local Corpus Golden Benchmarks

Status: completed

Scope:

- Create deterministic local corpora under test fixtures:
  - sparse clue conjunction;
  - misleading entity-name match;
  - exact phrase with nearby negation;
  - Office/Excel content evidence;
  - codebase symbol lookup and edit verification.
- Run them through the Agent Framework mock Copilot path so the acceptance does
  not depend on live Copilot quota.
- Save sanitized AG-UI event logs as replay fixtures.

Artifacts:

- DCI golden smoke script.
- Fixture corpus.
- Replay fixtures.

Acceptance:

- The benchmark proves DCI behavior over raw local files, not retriever rank.
- The same generic tools handle search, Office inspection, and codebase
  exploration.

Verification:

- new DCI golden smoke
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI08 - Build Live DCI E2E Corpus And Runner

Status: completed

Scope:

- Add a live E2E runner, e.g. `scripts/workbench-live-dci-e2e.mjs`, that uses
  the real signed-in M365 Copilot provider through Edge CDP.
- The runner must create an isolated temporary corpus with:
  - sparse clue conjunction;
  - misleading entity-name/filename decoys;
  - local context negation;
  - text/Markdown/CSV files;
  - Office fixtures once DCI03 anchors are available.
- The user task should be natural language and should not reveal the exact file
  names that contain the answer.
- The runner must require actual Relay tools through AG-UI/Agent Framework:
  `glob`, `grep`, `read`, and, where appropriate, bounded `bash`.
- The runner must fail if the final answer appears before required local tool
  observations exist.

Artifacts:

- Live DCI E2E script.
- Temporary-corpus fixture generator.
- Acceptance assertions for tool sequence, evidence file, final answer, and
  decoy rejection.
- Run output under `dist/e2e/live-dci/`.

Acceptance:

- The script can run independently from the older live project E2E.
- It verifies the DCI pattern from the paper: iterative raw-corpus interaction,
  local context reads, and refined search.
- It does not use `RelayDocumentSearch*`, SQLite/FTS, a mock model, or a
  fallback heuristic answer.

Verification:

- `pnpm workbench:live-copilot-e2e`
- live DCI E2E command when Edge/Copilot is available
- `pnpm check`

### DCI09 - Add Live DCI E2E Classification And Artifacts

Status: completed

Scope:

- Classify live DCI failures as:
  - provider quota/rate limit;
  - Edge CDP readiness or selector drift;
  - Copilot prompt delivery/response extraction;
  - Agent Framework continuation/session state;
  - OpenCode tool contract violation;
  - AG-UI replay/state rendering;
  - DCI logic failure.
- Save sanitized artifacts:
  - AG-UI event log;
  - framework trace IDs;
  - tool-call trajectory summary;
  - evidence snippets/anchors;
  - decoy rejection evidence;
  - provider diagnostics;
  - Workbench screenshot.
- Redact raw document contents by default. Include enough excerpts to prove
  acceptance without exposing unnecessary local data.

Artifacts:

- Updated live DCI E2E report schema.
- Implementation log entry template for live DCI runs.
- Optional AG-UI replay fixture derived from a sanitized successful run.

Acceptance:

- A failed live DCI run is actionable without reading raw Copilot logs.
- A successful run proves the paper-style DCI behavior, not just Copilot
  connectivity.
- Release notes can distinguish provider-blocked, framework-blocked, and
  DCI-logic failures.

Verification:

- live DCI E2E command
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### DCI10 - Run Live Copilot DCI E2E And Record Result

Status: completed (live attempt environment-blocked)

Scope:

- After DCI01-DCI09 pass, run a signed-in live Copilot E2E that performs a
  realistic local-corpus investigation.
- Use the DCI08 fixture that requires iterative search, decoy rejection, and
  local context checks.
- Classify failures as provider/CDP, framework continuation, tool contract,
  AG-UI replay, or DCI logic.
- Record the outcome in `docs/IMPLEMENTATION.md` with artifact paths and the
  exact command.

Artifacts:

- `dist/e2e/live-dci/` run artifacts.
- Implementation log entry with command, result, and failure/success class.

Acceptance:

- Live Copilot can complete at least one DCI investigation without relying on a
  dedicated document-search mode.
- The run demonstrates at least two search/refinement steps and at least one
  local context `read` before final answer.
- The final answer identifies evidence-backed files/snippets and rejects the
  decoy candidate.
- If Copilot or Edge fails, the run ends with a structured provider/adapter
  diagnostic, not a fallback answer.

Verification:

- `pnpm workbench:live-copilot-e2e`
- live DCI E2E command, e.g. `pnpm workbench:live-dci-e2e`
- `pnpm check`

### POSTLIVE01 - Keep Tool Validation Failures Out Of Approval

Status: completed

Scope:

- Audit current validation paths that throw before Agent Framework can feed a
  tool result back into the same session, starting with `apply_patch_invalid`.
- Keep invalid mutations away from user approval.
- Repair malformed Copilot JSON tool projections once in the M365 provider
  adapter before they can become approval requests; execution-time validation
  failures remain Agent Framework tool observations.
- Preserve hard AG-UI `RUN_ERROR` only for provider, framework, or executor
  health failures that cannot safely continue.

Artifacts:

- Sidecar adapter path for validation repair before approval plus normal
  framework observation feedback after tool execution starts.
- Regression smoke covering invalid patch -> correction -> valid patch in the
  same session.
- Implementation note explaining why this is Agent Framework continuation
  rather than a Relay retry planner.

Acceptance:

- Malformed `apply_patch` does not ask the user for approval.
- Copilot receives one strict repair prompt and may return a corrected
  OpenCode-shaped tool call without a new user run.
- AG-UI replay shows only the corrected tool call or a structured blocked
  state; the invalid mutating call never reaches approval.

Verification:

- `pnpm agent:patch-conformance-smoke`
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### POSTLIVE02 - Define OpenCode-Style Read Observation Projection

Status: completed

Scope:

- Replace raw file-body prompt projection with an OpenCode-style read
  observation contract: path, size, hash, excerpt, tail, omitted count, and
  explicit `read` continuation guidance for exact context.
- Keep full local content in AG-UI/support artifacts and local tool results.
- Ensure `read(offset, limit)` remains the way to request exact follow-up
  context instead of injecting entire files into every Copilot turn.
- Cover HTML/JS/CSS/Markdown reads because live project E2E times out after
  read observations.

Artifacts:

- Prompt-safe read observation projector.
- Fixture or smoke showing a large `read` result projected without raw body
  echo.
- Documentation update in `docs/OPENCODE_TOOL_CONTRACT.md` if the public
  read-result semantics are clarified.

Acceptance:

- Copilot prompt payload after `read` is bounded and deterministic.
- Follow-up edits still have a clear path to exact context through `read`
  offset/limit.
- AG-UI replay/support bundles still include enough data to debug the full
  file read.

Verification:

- read observation projection smoke
- `pnpm agent:agui-replay-smoke`
- `pnpm check`

### POSTLIVE03 - Make Provider Timeout A Resumable Framework State

Status: completed

Scope:

- Keep the same Agent Framework `AgentSession` and AG-UI thread when the M365
  Copilot provider times out after a tool observation.
- Add a named provider-adapter retry/resume policy only at the Copilot CDP
  boundary. It must be visible in framework trace/AG-UI diagnostics and must
  not fabricate a tool/final decision.
- Surface a user-visible blocked state only after retry policy is exhausted.
- Ensure timeout classification distinguishes provider response timeout from
  framework continuation timeout, approval wait, and tool execution timeout.

Artifacts:

- Provider timeout state/trace update.
- Resume or retry smoke using mock Copilot timeout followed by success.
- Updated live E2E classification assertions.

Acceptance:

- A provider timeout after a tool result does not lose session context.
- A retry, when performed, is recorded as provider-adapter behavior.
- If still blocked, AG-UI replay shows a named provider-blocked terminal state.

Verification:

- provider timeout continuation smoke
- `pnpm agent:framework-trace-smoke`
- `pnpm check`

### POSTLIVE04 - Centralize Copilot Patch Projection Repair Diagnostics

Status: completed

Scope:

- Treat Markdown Add File leading-`+` repair as Copilot projection repair, not
  as relaxed OpenCode patch grammar.
- Move repair notes into trace/support diagnostics and approval metadata so
  users can see that the approved patch is the revalidated OpenCode form.
- Add negative cases showing non-Markdown malformed Add File bodies still fail.

Artifacts:

- Repair metadata in framework trace or tool projection diagnostics.
- Smoke fixture covering repairable Markdown and non-repairable malformed
  patch.

Acceptance:

- The model-facing contract remains strict OpenCode `patchText`.
- Repair is deterministic, narrow, and observable.
- Non-repairable malformed patches remain blocked before approval.

Verification:

- `pnpm agent:patch-conformance-smoke`
- `pnpm agent:framework-trace-smoke`
- `pnpm check`

### POSTLIVE05 - Reduce Relay AAE Authority To Middleware Projection

Status: completed

Scope:

- Review remaining `RelayAdmissibleActionEnvelope` authority after LIVEFIX.
- Move any remaining durable final/tool/question eligibility into Agent
  Framework middleware/session state.
- Keep the envelope only as a Copilot prompt projection and diagnostic
  serialization, or document the remaining deletion blocker.

Artifacts:

- Middleware/projection refactor or explicit blocker note.
- Updated `docs/HARNESS_ARCHITECTURE.md` delete/adapt/keep matrix.

Acceptance:

- The framework registry and middleware are the source of tool availability.
- Prompt text cannot be the only enforcement point for `final`, `ask_user`, or
  mutation requirements.
- No new Relay-specific planner state is introduced.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:framework-native-prevention-smoke`
- `pnpm check`

### POSTLIVE06 - Split Live E2E Acceptance By Framework Capability

Status: completed

Scope:

- Split live E2E reporting into canary, project creation, project improvement,
  and provider-blocked continuation outcomes.
- Save AG-UI event logs and framework traces for each stage.
- Make project improvement the release-readiness gate once provider availability
  is sufficient; provider-blocked remains acceptable for development runs only
  when clearly classified.

Artifacts:

- Updated live E2E script/reporting.
- AG-UI replay fixture or assertion for project creation and read-continuation
  provider-blocked outcomes.
- Implementation log entry.

Acceptance:

- A create-pass/improve-provider-timeout run is reported as exactly that, not
  as generic failure or full success.
- The same script can prove a full create -> improve -> render pass when
  Copilot responds.
- Release readiness cannot silently ignore project-improvement failure.

Verification:

- `pnpm workbench:live-copilot-e2e`
- `pnpm workbench:live-project-e2e`
- `pnpm check`

### LIVEFIX01 - Capture Live E2E Baseline And Failure Classes

Status: completed

Scope:

- Record the latest live canary and multi-file project E2E results in
  `docs/IMPLEMENTATION.md`.
- Classify failures as:
  - provider quota;
  - Copilot CDP prompt insertion/composer normalization;
  - OpenCode tool contract validation;
  - Agent Framework continuation/final eligibility;
  - AG-UI replay/artifact export.
- Link the concrete artifacts under `dist/e2e/live-copilot/` and
  `dist/e2e/live-project/` without committing sensitive prompt dumps.

Artifacts:

- Implementation log entry with command, result, and classification.
- Optional sanitized excerpt or fixture when it is safe to commit.

Acceptance:

- The passing lightweight canary and failing project E2E are recorded as
  different outcomes.
- A failed project run is not described as quota-limited when Copilot was
  available.
- The next fix task can start from a named failure class, not a vague
  "Copilot unstable" bucket.

Verification:

- `git diff --check`

### LIVEFIX02 - Add OpenCode `apply_patch` Conformance Gate

Status: completed

Scope:

- Keep `apply_patch(req:patchText)` as the only model-visible patch shape.
- Validate `patchText` grammar before approval and execution.
- Return malformed patches as structured tool observations in the same Agent
  Framework session.
- Add golden cases for:
  - valid multi-file add;
  - valid update;
  - malformed add-file body missing leading `+`;
  - duplicate Begin/End envelopes;
  - legacy executor-only `patch` compatibility.

Artifacts:

- Sidecar conformance validator or existing validator integration.
- Regression smoke/fixture for malformed patch observations.
- Updated `docs/OPENCODE_TOOL_CONTRACT.md` only if the public contract changes.

Acceptance:

- A malformed patch never reaches approval as a side-effect action.
- Copilot receives a structured observation that tells it exactly why the patch
  failed and can continue in the same `AgentSession`.
- No new Relay-specific patch tool or argument name is introduced.

Verification:

- `pnpm agent:tool-catalog-smoke`
- patch conformance smoke
- `pnpm check`

### LIVEFIX03 - Harden Copilot CDP Composer Normalization

Status: completed

Scope:

- Keep prompt insertion, submission, and response extraction inside the M365
  Copilot CDP provider adapter.
- Normalize both intended and visible composer text before corruption checks:
  line endings, trailing newline, Unicode normalization, zero-width
  characters, and Copilot markdown/code-fence rendering transformations.
- Save a small redacted prompt-diff artifact when normalized verification
  still fails.
- Do not submit when normalized verification fails; return a provider-adapter
  blocked error with diagnostics.

Artifacts:

- Provider adapter normalization helper.
- Unit/smoke coverage for one-character composer differences.
- Redacted diagnostic fixture.

Acceptance:

- Benign one-character UI normalization differences do not fail live E2E.
- Real prompt corruption fails before submit and points to the exact
  normalized diff.
- The adapter does not make tool/final eligibility decisions.

Verification:

- Copilot prompt insertion smoke
- `pnpm workbench:live-copilot-e2e` when quota allows
- `pnpm check`

### LIVEFIX04 - Compact Tool Observations Through Framework State

Status: completed

Scope:

- Make tool observations deterministic, bounded, and artifact-backed before
  they are projected into Copilot prompts.
- For `read` and large command outputs, send hash, size, artifact ID, concise
  summary, and bounded excerpt by default.
- Preserve exact full content as a local artifact for diagnostics and follow-up
  tool use.
- Ensure compaction rules are middleware/framework state rules, not
  task-specific prompt folklore.

Artifacts:

- Observation compaction implementation or documented wiring to existing
  framework state.
- Fixture showing compacted `read` observation for HTML/JS/CSS files.
- Implementation log entry.

Acceptance:

- Follow-up edit tasks still have enough context to act correctly.
- Copilot composer payloads are smaller and less prone to CDP insertion
  corruption.
- AG-UI replay and support bundles still expose artifact IDs needed for debug.

Verification:

- transcript/observation smoke
- AG-UI replay smoke
- `pnpm check`

### LIVEFIX05 - Make Agent Framework Continuation The Terminal Authority

Status: completed

Scope:

- Audit timeout/final/continuation logic after tool observations.
- Ensure the same `AgentSession` owns continuation after tool result feedback.
- Move any remaining Relay-only final eligibility or continuation timers into
  framework middleware or a thin framework-adapter policy.
- Classify timeout source as provider response, framework continuation,
  approval wait, or tool execution.

Artifacts:

- Continuation/final eligibility refactor.
- Session continuation smoke covering: tool error -> retry, successful
  mutation -> final, and read -> mutation.
- Implementation log entry.

Acceptance:

- A successful tool call followed by a missing final does not become an
  unclassified `StreamingError`.
- A malformed patch observation can continue to a corrected patch or a
  structured blocked state.
- `final` and `question` remain middleware decisions.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:framework-native-prevention-smoke`
- `pnpm check`

### LIVEFIX06 - Make AG-UI Replay The Live E2E Acceptance Surface

Status: completed

Scope:

- Save AG-UI event logs for lightweight canary and multi-step project E2E.
- Make the replay smoke validate:
  - run lifecycle;
  - tool call args and results;
  - malformed tool observation;
  - final or structured blocked state;
  - artifact references.
- Keep raw Relay support dumps as attachments, not the primary acceptance
  format.

Artifacts:

- Live E2E AG-UI event log export.
- Replay fixture or test update.
- Implementation log entry.

Acceptance:

- A live E2E failure can be explained from AG-UI replay plus framework trace.
- Workbench-visible state does not require parsing Relay-only raw event text.

Verification:

- `pnpm agent:agui-replay-smoke`
- live project E2E artifact inspection
- `pnpm check`

### LIVEFIX07 - Rerun Live Copilot Project E2E

Status: completed

Scope:

- After LIVEFIX02 through LIVEFIX06 pass deterministic checks, rerun:
  - lightweight signed-in Copilot canary;
  - multi-file project creation;
  - follow-up project improvement.
- Treat provider quota as provider-blocked.
- Treat prompt corruption, malformed patch loops, or unclassified streaming
  errors as harness failures.

Artifacts:

- Ignored live E2E artifacts under `dist/e2e/`.
- Implementation log entry with commands and outcome.

Acceptance:

- If Copilot is available, the project E2E reaches final output after creation
  and after improvement.
- If Copilot is unavailable, the result is a structured provider-blocked state.

Verification:

- `pnpm workbench:live-copilot-e2e`
- `pnpm workbench:live-project-e2e`
- `pnpm check`

The completed `REUSE*` queue below is retained as the foundation for the new
`LIVEFIX*` queue. It reduced wheel-reinvention risk by forcing every
Relay-owned harness component to map to Microsoft Agent Framework, AG-UI,
OpenCode, MCP, or a documented Relay-only local policy/tool-body need.

### REUSE01 - Build Delete/Adapt/Keep Matrix

Status: completed

Scope:

- Inventory every active harness-facing component in `apps/sidecar` and
  Workbench code, including:
  - `RelayTurnState`;
  - `RelayAdmissibleActionEnvelope`;
  - `RelayProtocolGuard`;
  - approval bridge/resume code;
  - tool registry/projection code;
  - `RelayToolObservation`;
  - Copilot CDP transport;
  - Workbench event/state rendering.
- For each component, classify it as:
  - `delete`: replaced by Agent Framework / AG-UI / OpenCode / MCP;
  - `adapt`: thin adapter over a framework primitive;
  - `keep`: Relay-owned because of M365 Copilot CDP, workspace policy,
    packaging, OfficeCLI, or local safety.
- Add the matrix to `docs/HARNESS_ARCHITECTURE.md`.

Artifacts:

- Updated `docs/HARNESS_ARCHITECTURE.md`.
- Implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- No active component remains in an uncategorized "Relay harness" bucket.
- Every `keep` item has a concrete reason tied to Copilot CDP, local policy,
  approved local function bodies, packaging, or diagnostics.
- Every `delete`/`adapt` item names the exact replacement primitive.

Verification:

- `rg -n "delete|adapt|keep|RelayTurnState|RelayAdmissibleActionEnvelope|ApprovalRequired|AG-UI|OpenCode|MCP" docs/HARNESS_ARCHITECTURE.md`
- `git diff --check`

### REUSE02 - Align `apply_patch` Argument Shape With OpenCode

Status: completed

Scope:

- Change the model-facing `apply_patch` argument from Relay-specific `patch`
  to OpenCode-compatible `patchText`.
- Keep executor compatibility for legacy `patch`, but hide it from prompts,
  catalog snapshots, and new tests.
- Update the tool catalog smoke, protocol-state smoke, golden smoke, and live
  project E2E script.
- Update `docs/OPENCODE_TOOL_CONTRACT.md`.

Artifacts:

- Sidecar tool registration/projection update.
- Updated smoke fixtures.
- Implementation note.

Acceptance:

- New prompts and catalog snapshots show `apply_patch(req:patchText)`.
- Executor still accepts old `patch` only as compatibility.
- No new model-visible Relay-only patch argument remains.

Verification:

- `pnpm agent:tool-catalog-smoke`
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### REUSE03 - Decide OpenCode Built-In Coverage

Status: completed

Scope:

- Compare Relay's model-facing tools with OpenCode built-ins:
  `bash`, `edit`, `write`, `read`, `grep`, `glob`, `list`, `apply_patch`,
  `skill`, `todoread`, `todowrite`, `webfetch`, `websearch`, and `question`.
- For each tool, decide `adopt now`, `defer`, `deny`, or `extension`.
- Specifically evaluate:
  - `list` as a read-only directory overview tool;
  - `todoread`/`todowrite` as session-scoped planning artifacts for complex
    work;
  - `skill` as future packaged guidance, not ad hoc prompt text;
  - `webfetch`/`websearch` as denied unless policy later allows them.
- Record the decision in `docs/OPENCODE_TOOL_CONTRACT.md`.

Artifacts:

- Updated `docs/OPENCODE_TOOL_CONTRACT.md`.
- Optional tool-catalog fixture update only if a tool is adopted.

Acceptance:

- Every OpenCode built-in has an explicit decision.
- If a tool is not adopted, the reason is policy, scope, or user value, not
  oversight.
- No Relay-specific replacement is proposed when an OpenCode tool is the right
  fit.

Verification:

- `rg -n "list|todoread|todowrite|skill|webfetch|websearch|question" docs/OPENCODE_TOOL_CONTRACT.md`
- `git diff --check`

### REUSE04 - Evaluate Local MCP Reuse Before More Tool Bodies

Status: completed

Scope:

- Review Agent Framework local MCP support against Relay's current local
  function tools.
- Evaluate local MCP candidates for:
  - filesystem read/list/search;
  - git status/diff;
  - sqlite/index access;
  - future app integrations.
- For each candidate, decide whether to:
  - use Agent Framework local MCP;
  - keep Relay function body;
  - expose a Relay tool as local MCP later;
  - reject due to data/security/packaging policy.

Artifacts:

- Add `docs/MCP_REUSE_DECISION.md`.
- Link the decision from `PLANS.md` and `docs/HARNESS_ARCHITECTURE.md`.

Acceptance:

- No future generic local tool can be added without referencing the MCP reuse
  decision.
- Decisions include security, Windows share behavior, approval policy, audit,
  packaging, and offline usability.

Verification:

- `rg -n "filesystem|git|sqlite|MCP|approval|packaging|security" docs/MCP_REUSE_DECISION.md`
- `git diff --check`

### REUSE05 - Move Session Continuity To Agent Framework First

Status: completed

Scope:

- Audit all state keyed by run ID, request ID, thread ID, and Relay-specific
  state IDs.
- Move continuity-sensitive state to Agent Framework `AgentSession` or a
  session-scoped transcript store.
- Keep run IDs only as AG-UI/UI correlation IDs.
- Demote `RelayTurnState` to a derived projection object, then document the
  remaining deletion path.

Artifacts:

- Sidecar state refactor.
- Session continuity smoke.
- Implementation note.

Acceptance:

- Follow-up user turns and approval responses resume the same Agent Framework
  session.
- Completed tool results from an old run cannot satisfy a new run.
- `RelayTurnState` is no longer a durable source of truth.

Verification:

- Add/update session continuity smoke.
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### REUSE06 - Replace Approval Ledger With Native HITL

Status: completed

Scope:

- Wrap mutating tools with Agent Framework approval-required primitives such as
  `ApprovalRequiredAIFunction` or the current .NET equivalent.
- Project approval requests/responses through AG-UI human-in-the-loop events.
- Keep Relay's backup/diff/audit data as metadata on the approved function
  result, not as a separate approval protocol.
- Delete or quarantine any path that can execute a mutation outside the pending
  approved function call.

Artifacts:

- Approval cutover implementation.
- AG-UI approval replay fixture.
- Approval audit fixture.

Acceptance:

- Approve resumes the exact pending function call.
- Reject records a structured denied observation and does not retry through
  another mutation path.
- Workbench approval UI can replay from AG-UI events alone.

Verification:

- `pnpm agent:agui-client-tool-smoke`
- approval replay smoke
- `pnpm check`

### REUSE07 - Replace AAE With Middleware-Derived Projection

Status: completed

Scope:

- Keep the useful behavior of `RelayAdmissibleActionEnvelope`, but make Agent
  Framework middleware/tool registry filtering the source of truth.
- Generate the Copilot prompt's visible tool list from the framework registry
  and middleware decision.
- Ensure final/question/tool availability is enforced before and after Copilot
  output, not by prompt instructions alone.
- Add hard assertions that local-action tasks cannot reach Copilot with an
  empty tool registry.

Artifacts:

- Middleware-derived projection implementation.
- Prompt dump fixture.
- Protocol guard regression tests.

Acceptance:

- `RelayAdmissibleActionEnvelope` is either deleted or explicitly reduced to a
  diagnostic serialization of framework state.
- `local tools unavailable`, unnecessary `ask_user`, and premature `final` are
  blocked structurally.
- Prompt text is a projection, not a policy engine.

Verification:

- `pnpm agent:framework-native-prevention-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### REUSE08 - Make AG-UI Replay The Primary E2E Artifact

Status: completed

Scope:

- Save standard AG-UI event logs for deterministic and live E2E runs.
- Add a replay smoke that reconstructs:
  - run lifecycle;
  - tool call start/args/end/result;
  - approval request/response;
  - state snapshot/delta;
  - final output.
- Ensure Workbench UI can render from replayed AG-UI events without depending
  on Relay-only raw state.

Artifacts:

- AG-UI event log fixture.
- Replay smoke script.
- Implementation note.

Acceptance:

- A failed E2E can be debugged from AG-UI events plus framework trace.
- Relay-specific raw dumps are support attachments only.
- No primary Workbench state depends on a custom run-event union.

Verification:

- AG-UI replay smoke.
- `pnpm check`

### REUSE09 - Add Framework-Compatible Observability

Status: completed

Scope:

- Define an OpenTelemetry-compatible trace shape for:
  - Copilot provider readiness and send/receive;
  - prompt projection;
  - tool call admission;
  - approval pause/resume;
  - local tool execution;
  - final eligibility.
- Export traces in support bundles while redacting sensitive prompt/file data.
- Keep prompt dumps as opt-in sensitive artifacts.

Artifacts:

- Trace schema or implementation.
- Support bundle update.
- Redaction test.

Acceptance:

- Provider failures such as Copilot quota are distinguishable from harness
  failures.
- Tool failures include call ID, tool name, workspace, artifact IDs, and
  retryability without leaking file contents by default.
- Traces line up with AG-UI event IDs.

Verification:

- support bundle smoke
- `pnpm check`

### REUSE10 - Rerun Live Copilot Canaries After Structural Smokes

Status: completed

Scope:

- After REUSE02 through REUSE09 pass deterministic checks, rerun live Copilot
  E2E canaries:
  - multi-file project creation;
  - follow-up project improvement;
  - file search/discovery;
  - Office inspect/edit/verify.
- Treat Copilot quota as provider-blocked, not as pass or harness failure.

Artifacts:

- Live E2E artifacts under ignored diagnostics paths.
- `docs/IMPLEMENTATION.md` entry with command, date, environment, and result.

Acceptance:

- If Copilot is available, the canaries complete without local-tools-unavailable
  prose, unnecessary `ask_user`, premature `final`, or duplicated mutation.
- If Copilot quota blocks the run, the app emits structured
  `copilot_quota_limited` and the E2E is marked provider-blocked.

Verification:

- `pnpm workbench:live-project-e2e`
- `pnpm workbench:live-copilot-e2e`
- `pnpm check`

The `HARN*` and `OCT*` queues below remain as historical context. Their useful
intent has been folded into the completed `REUSE*` queue above; any older
pending marker below should not be scheduled without first reconciling it
against `PLANS.md`, `docs/HARNESS_ARCHITECTURE.md`, and the OpenCode-compatible
tool contract.

### HARN01 - Write Harness Architecture ADR

Status: completed

Scope:

- Create `docs/HARNESS_ARCHITECTURE.md`.
- Map OpenCode semantics to Microsoft Agent Framework constructs:
  - tools and permissions;
  - session continuity;
  - approval pause/resume;
  - tool observations;
  - compaction;
  - final eligibility;
  - AG-UI projection.
- Record why Relay is not adopting Codex app-server or OpenCode runtime
  binaries in this milestone.
- Record the hard boundary: Relay owns adapters and local tool bodies, not a
  second agent harness.

Artifacts:

- `docs/HARNESS_ARCHITECTURE.md`.
- Implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- The ADR names the canonical owner for each concern: Copilot adapter, Agent
  Framework, OpenCode-compatible tool contract, AG-UI, or Relay packaging.
- No concern is assigned to a vague "Relay harness" bucket.
- The ADR cites the official/prior-art URLs listed in `PLANS.md`.

Verification:

- `rg -n "OpenCode|Agent Framework|AgentSession|AG-UI|approval|middleware" docs/HARNESS_ARCHITECTURE.md`
- `git diff --check`

Completion artifact:

- `docs/HARNESS_ARCHITECTURE.md`
- `docs/IMPLEMENTATION.md` entry "OpenCode-Compatible Harness Alignment"

### HARN02 - Build Tool Contract Parity Matrix

Status: completed

Scope:

- Update `docs/OPENCODE_TOOL_CONTRACT.md` with a parity matrix.
- For each canonical tool, document:
  - OpenCode-compatible name;
  - Agent Framework registration type;
  - permission class;
  - result shape;
  - approval behavior;
  - AG-UI event projection;
  - known Relay-specific implementation gap.
- Include `officecli` as an extension tool, not a separate planning mode.

Artifacts:

- Updated `docs/OPENCODE_TOOL_CONTRACT.md`.
- Tool registry snapshot fixture or documented command.

Acceptance:

- `read`, `glob`, `grep`, `edit`, `write`, `apply_patch`, bounded `bash`,
  `question`, and `officecli` have explicit mappings.
- `rg_files`, `rg_search`, and `patch` alias behavior is documented as
  compatibility only.
- The matrix is specific enough to drive implementation without inventing new
  model-visible Relay tool names.

Verification:

- `rg -n "read|glob|grep|edit|write|apply_patch|bash|question|officecli" docs/OPENCODE_TOOL_CONTRACT.md`
- `git diff --check`

Completion artifact:

- `docs/OPENCODE_TOOL_CONTRACT.md`
- `scripts/fixtures/agent-tool-catalog-snapshot.json`
- `pnpm agent:tool-catalog-smoke`

### HARN03 - Make AgentSession the State Authority

Status: pending

Scope:

- Audit sidecar state that is keyed by run ID, request ID, or Relay-specific
  protocol state.
- Move continuity-sensitive state to Agent Framework `AgentSession` or a
  session-scoped transcript store.
- Ensure approval responses and follow-up user turns resume the same session.
- Keep run IDs only for UI correlation and diagnostics.

Artifacts:

- Sidecar state refactor.
- Session continuity regression test.
- Implementation note describing removed or demoted Relay state.

Acceptance:

- Approval resume does not create a fresh task from the original prompt.
- The same session contains user message, assistant tool call, approval request,
  approval response, tool observation, continuation, and final answer.
- No tool loop depends on frontend-only state.

Verification:

- Add/update a session continuity smoke test.
- `pnpm check`

### HARN04 - Replace Custom Approval Handling with Agent Framework HITL

Status: pending

Scope:

- Register side-effect tools through Agent Framework approval-required function
  wrappers or equivalent approval metadata.
- Convert approval requests/responses through the Agent Framework + AG-UI HITL
  bridge.
- Batch approvals for coherent multi-file `apply_patch` operations.
- Remove custom approval replay messages that bypass Agent Framework approval
  content.

Artifacts:

- Approval middleware/update.
- AG-UI approval fixture.
- Approval audit log fixture.

Acceptance:

- `write`, `edit`, `apply_patch`, bounded `bash` with side effects, and
  `officecli` mutations pause before execution when policy is `ask`.
- Approving resumes the exact pending function call.
- Denying records a structured denied observation and does not fallback to an
  alternate mutation path.

Verification:

- Add/update approval smoke.
- `pnpm check`

### HARN05 - Add Terminal Eligibility Middleware

Status: completed

Scope:

- Implement middleware that decides whether a model final answer is allowed.
- Track pending required artifacts, pending tool calls, pending approvals,
  failed verifications, and unresolved blocked states.
- Hide or deny `question`/ask-user unless middleware marks the run as
  user-blocked.
- Stop before Copilot if a local-action task has an empty or invalid tool
  registry.

Artifacts:

- Terminal eligibility middleware.
- Protocol-state tests covering:
  - no local tools available;
  - premature final;
  - unnecessary ask-user;
  - genuine user-blocked state.

Acceptance:

- "local tools unavailable" never comes from Copilot prose. It is a pre-model
  `blocked` state with diagnostics.
- A final answer is rejected while required local artifacts are missing.
- `question` appears only after a deterministic user-blocked decision.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm check`

Completion artifact:

- `RelayAdmissibleActionEnvelope` and protocol guard updates in
  `apps/sidecar/`
- `pnpm agent:protocol-state-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### HARN06 - Normalize Tool Observations and Transcript Storage

Status: partial

Scope:

- Define one structured observation envelope for all tool results.
- Include tool name, call ID, status, concise summary, artifact IDs, warnings,
  stdout/stderr summaries, diff summaries, hashes, and retryability.
- Add deterministic transcript export for live E2E debugging.
- Add compaction rules that preserve objective, workspace, completed tool
  calls, artifacts, failures, approvals, and next action.

Artifacts:

- Transcript/observation schema in code or docs.
- Transcript export fixture.
- Compaction fixture.

Acceptance:

- Large tool outputs are summarized without dropping artifact references.
- Copilot receives enough structured observation data to continue after each
  tool call.
- E2E failures can be debugged from exported transcript plus AG-UI replay.

Verification:

- Transcript export smoke.
- `pnpm check`

Progress artifact:

- `RelayToolObservation.v1` metadata and artifact extraction are implemented in
  `apps/sidecar/AgentRunner.cs`.
- Live E2E prompt/raw-event artifacts are written under the ignored
  `dist/e2e/live-project/` diagnostics path.

Remaining:

- Add a deterministic transcript export smoke and compaction fixture.

### HARN07 - Rework Multi-File Project Creation Around `apply_patch`

Status: blocked by provider quota

Scope:

- Make `apply_patch` the preferred coherent mutation tool for multi-file
  project creation and improvements.
- Keep `write` for single-file creation/overwrite.
- Ensure one multi-file patch can be reviewed and approved as one change set.
- Prevent repeated one-file approval loops when Copilot can produce a patch.

Artifacts:

- Prompt/tool projection update derived from the tool registry.
- Multi-file patch E2E fixture.
- Diff/approval UI fixture.

Acceptance:

- A request to create a small project produces either one coherent
  `apply_patch` call or a clearly justified small sequence.
- The first write/patch is not duplicated after approval.
- Follow-up improvement reads existing project state before patching.

Verification:

- Live or recorded project-create E2E.
- `pnpm check`

Progress artifact:

- `apply_patch` is canonical in prompt/tool projection and tool-catalog smoke.
- The patch parser now accepts multi-hunk OpenCode-style updates.
- `scripts/workbench-live-project-e2e.mjs` covers multi-file project creation
  plus follow-up improvement.

Blocker:

- Real Copilot project E2E currently stops at Microsoft 365 Copilot's hourly
  request limit (`copilot_quota_limited`) before tool execution can complete.

### HARN08 - Project Agent Framework Runs Through AG-UI Only

Status: pending

Scope:

- Ensure frontend run state is derived from AG-UI events and state snapshots.
- Map Agent Framework run lifecycle, tool calls, tool results, approvals,
  errors, and final output to AG-UI events.
- Remove or quarantine custom Relay run/event streams from Workbench UI.
- Add replay fixtures for normal, approval, blocked, and failed runs.

Artifacts:

- AG-UI projection code/update.
- Replay fixtures.
- Minimal Workbench UI rendering path.

Acceptance:

- Workbench can replay a saved run from AG-UI events.
- Diagnostic details remain available but are not the primary UI protocol.
- No UI path depends on legacy Relay custom run-stream contracts.

Verification:

- AG-UI replay smoke.
- `pnpm check`

### HARN09 - Live Copilot Harness E2E Suite

Status: blocked by provider quota

Scope:

- Add or update live E2E tests that use actual M365 Copilot through Edge CDP.
- Cover:
  - multi-file HTML/CSS/JS project creation;
  - follow-up project improvement in the same session;
  - local file discovery with `glob`, `grep`, and exact `read`;
  - Office file inspect/edit/verify through `officecli`;
  - side-effect approval resume.
- Assert absence of:
  - empty tool catalog;
  - "local tools unavailable" as Copilot prose;
  - unnecessary `ask_user`;
  - premature final;
  - duplicated first mutation after approval.

Artifacts:

- Live E2E scripts.
- Saved transcripts and AG-UI event logs under an ignored diagnostics location.
- Implementation note with command, date, environment, and result.

Acceptance:

- The suite passes against a logged-in Edge/Copilot profile, or fails with a
  structured harness/provider defect and reproducible artifacts.
- No failure is hidden by a fallback harness path.

Verification:

- Live E2E command documented in `docs/IMPLEMENTATION.md`.
- `pnpm check`

Progress artifact:

- `scripts/workbench-live-project-e2e.mjs` exists and records prompts, raw AG-UI
  events, screenshots, sidecar stderr, and workspace path.
- The latest run reached real Copilot and failed with a structured
  `copilot_quota_limited` provider error, documented in
  `docs/IMPLEMENTATION.md`.

Remaining:

- Re-run the live suite after the Microsoft 365 Copilot request quota resets.

### HARN10 - Remove Superseded Relay Harness Paths

Status: pending

Scope:

- Delete or quarantine Relay-specific harness code that duplicates Agent
  Framework responsibilities.
- Keep only:
  - Copilot CDP adapter;
  - local tool function bodies;
  - policy configuration;
  - diagnostics/export;
  - AG-UI projection glue;
  - packaging.
- Update docs to remove historical claims that conflict with the active design.

Artifacts:

- Code cleanup.
- Updated `README.md`, `AGENTS.md` if needed, `docs/IMPLEMENTATION.md`.

Acceptance:

- No active path treats Relay-specific protocol state as the canonical run
  state.
- The tool registry and Agent Framework middleware are the only active
  execution control surface.
- Historical docs are either updated or clearly archived.

Verification:

- `rg -n "RelayTurnState|RunEvent|rg_files|rg_search|custom run stream|local tools unavailable" apps docs`
- `pnpm check`

### HARN11 - Release Readiness Gate for Harness Migration

Status: pending

Scope:

- Run all verification gates required by the harness migration.
- Confirm installer packaging includes required local tool binaries and excludes
  obsolete runtime assets.
- Confirm Windows no-admin install behavior remains intact.
- Confirm Linux/Windows shared Workbench path remains documented.

Artifacts:

- `docs/IMPLEMENTATION.md` release-readiness entry.
- Packaging verification log.

Acceptance:

- `pnpm check` passes.
- Live E2E artifacts exist for the current commit.
- Installer/tool-binary readiness is verified before any release.

Verification:

- `pnpm check`
- Packaging command documented in `docs/IMPLEMENTATION.md`

## Historical Tool-Contract Queue

### OCT01 - Inventory Current Model-Visible Tools

Status: completed

Scope:

- Inspect all model-visible tool registrations and prompt projections in
  `apps/sidecar`.
- List canonical tool names, aliases, parameters, result shapes, approval
  requirements, and current descriptions.
- Identify Relay-specific names that should become aliases or disappear from
  prompts.

Artifacts:

- Add `docs/OPENCODE_TOOL_CONTRACT.md` with an inventory section.
- Add an implementation note in `docs/IMPLEMENTATION.md`.

Acceptance:

- The inventory clearly separates canonical OpenCode-compatible tools,
  compatibility aliases, and Relay/Office extension tools.
- `rg_files`, `rg_search`, and `apply_patch` are explicitly classified.

Verification:

- `rg -n "rg_files|rg_search|apply_patch|workspace_status|officecli" apps/sidecar`
- `git diff --check`

### OCT02 - Define the OpenCode-Compatible Tool Contract

Status: completed

Scope:

- Complete `docs/OPENCODE_TOOL_CONTRACT.md`.
- Define canonical tools:
  - `read`
  - `glob`
  - `grep`
  - `edit`
  - `write`
  - `patch`
  - bounded `bash`
- For each tool, define:
  - when to use it;
  - when not to use it;
  - parameters;
  - result shape;
  - permission/approval class;
  - failure semantics;
  - aliases accepted during migration.

Artifacts:

- `docs/OPENCODE_TOOL_CONTRACT.md`.
- Updated references from `PLANS.md` and `docs/IMPLEMENTATION.md`.

Acceptance:

- The contract can be implemented without inventing new model-visible Relay
  action names for ordinary file/code work.
- OfficeCLI is documented as an extension tool, not a parallel planner.

Verification:

- Documentation review.
- `git diff --check`

### OCT03 - Centralize Tool Registration Around the Contract

Status: completed

Scope:

- Create or refactor a single tool registry/source of truth in the sidecar.
- Register canonical contract tools from that registry into Agent Framework.
- Keep compatibility aliases internal:
  - `rg_files` -> `glob`;
  - `rg_search` -> `grep`;
  - `patch` -> `apply_patch`.
- Ensure aliases are accepted by the executor only where required for backward
  compatibility and are not preferred in new prompts.

Artifacts:

- Sidecar registry code.
- Tool inventory snapshot or smoke output.
- Implementation note.

Acceptance:

- Prompt/tool projection no longer builds an independent static Relay catalog.
- A model-visible inventory dump shows canonical OpenCode-compatible tools.

Verification:

- Add/update a tool-inventory smoke.
- `pnpm check`

### OCT04 - Project Only Contract Tools to Copilot

Status: completed

Scope:

- Refactor Copilot prompt/tool projection to derive visible tools from the
  Agent Framework registry and current middleware state.
- Use canonical names in prompts.
- Hide aliases unless a legacy continuation requires them.
- Remove or quarantine prompt lines that implement broad Relay-specific
  recovery rules instead of contract semantics.

Artifacts:

- Updated Copilot adapter/prompt projection.
- Prompt dump fixtures showing canonical tool names.

Acceptance:

- New prompts prefer `apply_patch`, not `patch`, when patching is visible.
- No prompt exposes `rg_files` or `rg_search`.
- No prompt introduces new Relay-only local file/code tools.

Verification:

- Prompt-dump fixture.
- `pnpm agent:protocol-state-smoke`
- `pnpm check`

### OCT05 - Align Executor Behavior and Results

Status: completed

Scope:

- Ensure executor implementations match the contract result shapes.
- Implement `apply_patch` as the canonical mutation tool.
- Keep `patch` as an alias only if existing tests or continuations need it.
- Ensure `bash` remains bounded to explicit verification/build/test/git/rg
  command use and cannot become arbitrary shell execution.

Artifacts:

- Executor changes.
- Contract-result smoke tests.

Acceptance:

- Tool results are consistent enough that Copilot can recover from normal tool
  errors without custom Relay planner state.
- Patch context failure returns a clear standard tool failure result.

Verification:

- Tool executor smoke tests.
- `pnpm check`

### OCT06 - Reframe OfficeCLI as a Contract Extension

Status: completed

Scope:

- Keep OfficeCLI available, but expose it as a documented extension tool
  aligned with the same inspect-before-mutate and approval semantics.
- Remove Office-specific planner assumptions that duplicate the general
  Agent Framework tool loop.
- Ensure Office mutation uses Agent Framework approval and AG-UI HITL.

Artifacts:

- Updated Office tool docs in `docs/OPENCODE_TOOL_CONTRACT.md`.
- OfficeCLI readiness and mutation smoke results.

Acceptance:

- Natural-language Office work follows the same run loop as code/file work:
  inspect/read -> approved mutation -> result/verification.
- No separate Office-only prompt harness is required for normal operation.

Verification:

- `pnpm agent:officecli-registry-smoke`
- Office approval smoke.
- `pnpm check`

### OCT07 - Remove or Quarantine Relay-Specific Recovery Rules

Status: completed

Scope:

- Audit Copilot adapter, protocol guard, and prompt builder for ad hoc rules
  added to handle repeated reads, early finals, patch failures, or local-tools
  unavailable outputs.
- Keep only narrow compatibility normalizers that are backed by tests and do
  not define a second tool system.
- Move prevention into Agent Framework middleware/session state where possible.

Artifacts:

- Cleanup diff.
- Implementation note explaining what was removed, retained, and why.

Acceptance:

- Normal E2E does not depend on hidden guard repair or broad prompt folklore.
- Contract violations fail visibly with diagnostics instead of silently
  creating new fallback behavior.

Verification:

- Choice-error reduction smoke.
- Protocol-state smoke.
- `pnpm check`

### OCT08 - Update Regression Tests to the Contract

Status: completed

Scope:

- Update existing smokes and fixtures to use canonical tool names and contract
  result shapes.
- Add alias tests proving legacy names still map internally but are not shown
  in new prompts.
- Add a no-new-Relay-tool-name assertion for the model-visible catalog.

Artifacts:

- Updated smoke scripts.
- Tool inventory snapshot.

Acceptance:

- Tests enforce OpenCode-compatible naming and semantics.
- Tests fail if a new model-visible Relay-specific tool is added without
  updating the contract.

Verification:

- `pnpm agent:protocol-state-smoke`
- `pnpm agent:choice-error-reduction-smoke`
- `pnpm check`

### OCT09 - Live Copilot E2E: Complex Project Create and Improve

Status: completed

Scope:

- Re-run a real signed-in Copilot E2E where Relay creates a hierarchical
  project and then improves it.
- The test must exercise:
  - project creation with multiple files/directories;
  - reading existing files;
  - improving the project through canonical contract tools;
  - browser/runtime verification of the generated app.
- If the run fails, classify it as:
  - Copilot transport issue;
  - Agent Framework/tool contract issue;
  - executor implementation issue;
  - generated app quality issue.
- Do not add new ad hoc Relay planner features to make one scenario pass.

Artifacts:

- E2E logs under `dist/e2e/...`.
- Browser screenshot or validation output.
- Implementation note.

Acceptance:

- The run succeeds through the OpenCode-compatible contract, or fails with a
  clear contract/tool-result error and a follow-up task.

Verification:

- Live Copilot E2E script.
- Generated app smoke/browser check.
- `pnpm check`

### OCT10 - Documentation and Cleanup

Status: completed

Scope:

- Update `README.md`, `AGENTS.md` if needed, `PLANS.md`, and
  `docs/IMPLEMENTATION.md` to describe the new contract.
- Remove or archive obsolete references that imply Relay owns a custom local
  tool taxonomy.
- Ensure release/packaging notes do not mention removed modes or old tool names
  as public behavior.

Artifacts:

- Documentation updates.
- Final verification log.

Acceptance:

- A new contributor can understand that Relay is:
  - M365 Copilot controller;
  - Agent Framework run loop;
  - AG-UI frontend protocol;
  - OpenCode-compatible local tool contract;
  - Relay implementation glue, policy, packaging, and diagnostics.

Verification:

- `pnpm check`
- `git diff --check`

## Milestone Definition of Done

The OpenCode-compatible tool contract migration is complete when:

- `docs/OPENCODE_TOOL_CONTRACT.md` exists and matches implementation.
- The model-visible inventory uses canonical OpenCode-compatible local tool
  names plus documented extension tools only.
- Existing Relay-specific tool names are internal aliases or removed.
- Agent Framework remains the run loop and AG-UI remains the UI protocol.
- Live Copilot can create and improve a non-trivial project without requiring
  new Relay-specific planner rules.
