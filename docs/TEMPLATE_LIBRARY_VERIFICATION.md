# Template Library Verification

Date: 2026-04-02

## Automated

- `pnpm typecheck`
- `pnpm --filter @relay-agent/desktop build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

Result: passed in this environment.

## Manual Checklist

- [ ] 組み込みテンプレートが 5 件以上表示される
- [ ] カテゴリ切り替えでフィルタ結果が変わる
- [ ] キーワード検索でカードが絞り込まれる
- [ ] テンプレート選択でゴール入力へテキストが反映される
- [ ] 完了セッションからテンプレート保存できる
- [ ] カスタムテンプレート削除後に一覧から消える

## Suggested Scenario

1. 組み込みテンプレートを選択してゴール入力へ反映する
2. 通常フローを 1 回実行する
3. 完了後に「テンプレートとして保存」を押す
4. テンプレートタブに戻ってカスタムテンプレートが追加されたことを確認する
