# Template Library Design

Date: 2026-04-02

## Scope

Tasks `175`-`179` add reusable workflow templates for common spreadsheet goals.

## Data Model

### WorkflowTemplate

- `id`: template identifier
- `title`: display name
- `category`: `sales | accounting | hr | general | custom`
- `description`: short summary
- `goal`: text injected into the main goal input
- `expectedTools[]`: hint list of expected tools
- `exampleInputFile`: optional sample file label
- `tags[]`: search keywords
- `isBuiltIn`: distinguishes bundled templates from user-created templates
- `createdAt`: RFC3339 timestamp

## Storage Strategy

- Built-in templates live under `apps/desktop/src-tauri/assets/templates/` and are bundled with `include_str!`.
- Custom templates are stored as JSON under the app-local `storage-v1/templates/` directory.
- `template_list` merges bundled and custom templates at read time.

## Search and Filter Strategy

- Category filter applies first.
- Keyword search matches title, description, goal, tags, and expected tools.
- UI keeps the selected category and text query as lightweight local state.

## Session-to-Template Flow

1. User completes or prepares a session.
2. Completion UI triggers `template_from_session`.
3. Session title/objective become the new template title/goal.
4. Result is persisted as a custom template and appears in the browser immediately.

## Initial Built-in Set

- 売上データフィルタ
- 月次集計
- 列名統一・型変換
- 重複行除去
- 請求書データ整形
