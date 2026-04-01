# Batch Processing Design

Date: 2026-04-02

## Scope

Tasks `170`-`174` add a sequential batch runner that applies one goal to many workbook files.

## Data Model

### BatchJob

- `id`: unique job identifier
- `workflowGoal`: shared goal applied to all targets
- `projectId`: optional linked project
- `targets[]`: ordered `BatchTarget` rows
- `concurrency`: fixed to `1`
- `stopOnFirstError`: whether to halt after the first failure
- `status`: `idle | running | done | failed`
- `outputDir`: derived save-copy folder for batch outputs
- `createdAt`: RFC3339 timestamp
- `updatedAt`: RFC3339 timestamp

### BatchTarget

- `filePath`: source workbook path
- `status`: `pending | running | done | failed | skipped`
- `outputPath`: generated save-copy destination
- `errorMessage`: optional failure detail
- `sessionId`: optional session created for auditability

## Sequential Execution Constraint

- Concurrency is fixed to `1`.
- Reason: the current Copilot/CDP workflow is single-session oriented, so parallel runs would compete for browser state and approval attention.
- Result: targets are processed one by one in deterministic order.

## Failure Policy

- Default behavior: failed targets are marked `failed` and the job continues.
- If `stopOnFirstError = true`, the job halts immediately after the first failure.
- Operators can mark a pending target as `skipped` before it starts.

## Approval Strategy

- Approval remains target-scoped.
- The batch dashboard is responsible for surfacing any future approval-required target inline.
- Even when targets are auto-approved by policy, writes remain save-copy only.

## Output Rules

- Outputs are placed under a derived `relay-batch-output` folder next to the first selected target.
- Each output uses the suffix `.batch-copy`.
- Original batch inputs are treated as read-only.
