# Batch Verification

Date: 2026-04-02

## Automated

- `pnpm typecheck`
- `pnpm --filter @relay-agent/desktop build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

Result: passed in this environment.

## Manual Checklist

- [ ] 複数ファイル選択とフォルダ選択の両方で対象を読み込める
- [ ] バッチ実行時にターゲットのステータスが `pending -> running -> done/failed/skipped` と遷移する
- [ ] 失敗したターゲットがあっても、`stopOnFirstError = false` なら後続へ進む
- [ ] 完了後に `relay-batch-output` フォルダを開ける
- [ ] 元ファイルが未変更で、出力は別コピーになっている

## Suggested Scenario

1. CSV を 3 件選択する
2. 1 件のファイル名に `[fail]` を含めて失敗ケースを混ぜる
3. バッチを起動し、2 件成功・1 件失敗になることを確認する
4. `stopOnFirstError` を有効にして、最初の失敗で停止することを確認する
