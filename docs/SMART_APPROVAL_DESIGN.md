# Smart Approval Design

Date: 2026-04-02

## Scope

Tasks `180`-`183` classify action risk and decide whether approval can be skipped safely.

## Risk Table

| Tool | Risk |
| --- | --- |
| `file.list` | `readonly` |
| `file.stat` | `readonly` |
| `workbook.inspect` | `readonly` |
| `sheet.preview` | `readonly` |
| `sheet.profile_columns` | `readonly` |
| `session.diff_from_base` | `readonly` |
| `table.rename_columns` | `low` |
| `table.filter_rows` | `low` |
| `table.cast_columns` | `medium` |
| `table.derive_column` | `medium` |
| `table.group_aggregate` | `medium` |
| `workbook.save_copy` | `medium` |
| `file.copy` | `medium` |
| `file.move` | `high` |
| `file.delete` | `critical` |

Unknown tools are treated as `medium`.

## Policy Table

| Policy | Auto-approval threshold |
| --- | --- |
| `safe` | none |
| `standard` | `readonly + low` |
| `fast` | `readonly + low + medium` |

`critical` is always manual.

## Integration Rules

- Risk is evaluated at preview time from the proposed action list.
- Highest risk wins for the preview.
- If policy permits auto-approval, the backend records an approval artifact automatically and returns `autoApproved = true`.
- The frontend suppresses the intervention panel for auto-approved previews and records the decision in the activity feed.
- Save-copy only remains mandatory regardless of policy.

## Guardrails

- `high` and `critical` are never auto-approved in the current implementation.
- Original source files stay read-only.
- Auto-approval does not bypass diff preview generation; it only removes the manual confirmation step.
