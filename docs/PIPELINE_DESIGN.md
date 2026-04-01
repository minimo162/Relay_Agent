# Workflow Pipeline Design

Date: 2026-04-02

## Scope

Tasks `164`-`169` define a sequential workflow pipeline that chains multiple agent-style turns while preserving save-copy only behavior.

## Data Model

### Pipeline

- `id`: unique pipeline identifier
- `title`: user-visible workflow name
- `projectId`: optional linked project
- `initialInputPath`: first step input file path supplied by the user
- `steps[]`: ordered `PipelineStep` records
- `status`: `idle | running | done | failed`
- `createdAt`: RFC3339 timestamp
- `updatedAt`: RFC3339 timestamp

### PipelineStep

- `id`: unique step identifier
- `order`: zero-based execution order
- `goal`: natural-language objective for the step
- `inputSource`: `user | prev_step_output`
- `outputArtifactKey`: resolved output file path for the step save-copy
- `status`: `pending | running | waiting_approval | done | failed`
- `errorMessage`: optional failure detail

## File Handoff Protocol

1. Step `0` resolves input from `Pipeline.initialInputPath`.
2. Any step with `inputSource = user` reuses `initialInputPath`.
3. Any step with `inputSource = prev_step_output` reads the immediately previous step `outputArtifactKey`.
4. Each completed step writes a new save-copy path alongside the input file using the suffix `pipeline-step-{n}`.
5. Original input files are never mutated in place.

## Approval Gate Behavior

- Approval context is step-scoped, not pipeline-global.
- If a future step enters `waiting_approval`, the UI shows the existing intervention panel with that step's goal and output path.
- Approval never grants write access to the original file; it only unlocks the step's save-copy output.

## Error Policy

- Missing input path or missing source file fails the current step and marks the pipeline `failed`.
- A user-triggered cancel marks the active step `failed` with a cancellation message and stops later steps.
- No implicit skip occurs after a failure. The operator can clone or rebuild a new pipeline if partial success should continue from a later point.

## Eventing

- Backend emits `pipeline:step_update` on every step status transition.
- Payload contains the full `Pipeline`, the updated `stepId`, and the new status.
- Frontend treats the event payload as the single live source for progress rendering.
