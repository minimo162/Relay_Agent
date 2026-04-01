# Autonomous Execution Design

## 1. Scope

This document defines the planning-first autonomous execution protocol described in `.taskmaster/docs/prd.txt` section `18`.

This slice adds:

- a planning phase before autonomous execution
- structured `ExecutionPlan` / `PlanStep` contracts
- a plan approval contract for later backend and UI work
- frontend loop behavior for `plan_proposed`

This slice does not yet add:

- backend persistence for approved plans
- plan review UI
- step-level execution persistence

Those remain in tasks `114` and later.

## 2. Integrated State Machine

```text
idle
  -> planning                 planningEnabled=true
  -> thinking                 planningEnabled=false

planning
  -> plan_proposed            Copilot returns executionPlan
  -> thinking                 Copilot falls back to direct read actions
  -> error

plan_proposed
  -> awaiting_plan_approval   UI receives the proposed plan

awaiting_plan_approval
  -> executing                user approves the plan
  -> planning                 user rejects with feedback
  -> idle                     user cancels

executing
  -> awaiting_step_approval   a write step is reached
  -> completed                all steps complete
  -> error

awaiting_step_approval
  -> executing                user approves or skips
  -> idle                     user cancels
```

## 3. Planning Prompt Contract

The planning phase asks Copilot for a plan before any action execution.

Prompt requirements:

- include the original objective
- include workbook or file context already collected by the app
- list the allowed read tools and write tools separately
- require strict JSON only
- require `status: "plan_proposed"`
- require `actions: []` during the planning phase
- require `executionPlan.summary`, `executionPlan.totalEstimatedSteps`, and `executionPlan.steps`

The plan prompt is intentionally distinct from the existing follow-up prompt:

- planning prompt: asks for a plan only
- follow-up prompt: asks for the next action JSON after read results exist
- step execution prompt: asks for a concrete action for a single approved step

## 4. ExecutionPlan / PlanStep Schema

`PlanStep`:

- `id`: stable step identifier
- `description`: human-readable step label
- `tool`: tool id to use for the step
- `phase`: `read | write`
- `args`: optional suggested arguments
- `estimatedEffect`: short explanation of the expected outcome

`ExecutionPlan`:

- `steps`: ordered list of one or more `PlanStep`
- `summary`: user-facing overall summary
- `totalEstimatedSteps`: positive integer for the full plan length

`CopilotTurnResponse` planning extension:

- `status: "plan_proposed"`
- `actions: []`
- `executionPlan: ExecutionPlan`

Backward compatibility rules:

- `executionPlan` stays optional
- the existing one-shot payload still parses
- `status` still defaults to `ready_to_write` when omitted

## 5. Approval Protocol

The later approval contract uses three user intents:

- approve: accept the selected plan steps and start execution
- modify: reorder, edit, or drop steps before approval
- reject: return feedback and request replanning

Contract surface reserved in this slice:

- `approvePlanRequest`
- `approvePlanResponse`
- `planProgressRequest`
- `planProgressResponse`
- `planStepStatus`

Execution semantics:

1. Copilot proposes a plan.
2. The frontend stops in `awaiting_plan_approval`.
3. UI/backend will later exchange the approved plan over typed IPC.
4. Approved read steps execute automatically.
5. Approved write steps still stop at the existing preview and approval gate.

## 6. Safety Guards

Inherited guardrails remain mandatory:

- save-copy only
- preview before write
- approval before write
- original input remains read-only

Planning-specific guards:

- maximum plan steps default: `20`
- maximum loop turns still apply while Copilot is generating the plan
- per-turn timeout still applies to planning and step execution prompts
- write steps are never auto-executed, even after plan approval
- if Copilot returns `plan_proposed` without `executionPlan`, the frontend treats it as invalid planning output

## 7. Frontend Runtime Behavior

`runAgentLoop()`:

- preserves legacy behavior when `planningEnabled` is `false` or omitted
- stops with `awaiting_plan_approval` when `planningEnabled=true` and a valid `plan_proposed` response arrives

`resumeAgentLoopWithPlan()`:

- executes approved read steps sequentially
- generates one execution prompt per step
- accumulates prior read results for later steps
- stops at the first write step and returns `ready_to_write`
- returns `done` when all approved steps complete

## 8. Implementation Boundary

Tasks covered by this document:

- `109` design artifact
- `110` relay contract extensions
- `111` plan approval IPC contract extensions
- `112` planning prompt generation
- `113` frontend loop planning-phase support

Deferred to later tasks:

- `114` backend approval IPC commands
- `115` through `120` plan review UI, progress UI, persistence, pause, and replanning
