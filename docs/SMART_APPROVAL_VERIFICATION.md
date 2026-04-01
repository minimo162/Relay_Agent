# Smart Approval Verification

Date: 2026-04-02

## Automated

- `pnpm check`
- `pnpm typecheck`
- `pnpm --filter @relay-agent/desktop build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

Result: passed in this environment.

## Manual Checklist

- [ ] `safe` では手動承認が必要なプレビューが自動承認されない
- [ ] `standard` で `readonly` / `low` 相当のプレビューが自動承認される
- [ ] `fast` で `medium` 相当のプレビューも自動承認される
- [ ] 自動承認時に Activity Feed にバッジが表示される
- [ ] `critical` 操作は全ポリシーで手動承認のまま維持される

## Suggested Scenario

1. 設定から `safe` / `standard` / `fast` を切り替える
2. 同一の保存系プレビューを実行して `requiresApproval` と自動実行の差を確認する
3. Activity Feed の `自動承認済み` バッジ表示を確認する
