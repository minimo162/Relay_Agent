# Pipeline Verification

Date: 2026-04-02

## Automated

- `pnpm typecheck`
- `pnpm --filter @relay-agent/desktop build`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

Result: passed in this environment.

## Manual Checklist

- [ ] 2 ステップのパイプラインを作成できる
- [ ] ステップ 1 の完了後、`outputArtifactKey` がステップ 2 の入力へ引き継がれる
- [ ] `pipeline:step_update` でステータスがリアルタイム更新される
- [ ] 入力パスを壊した場合、該当ステップが `failed` になり後続が停止する
- [ ] パイプライン実行後も元ファイルは未変更である

## Suggested Scenario

1. `examples/revenue-workflow-demo.csv` を初期入力に設定する
2. ステップ 1 を通常実行する
3. ステップ 2 を `prev_step_output` で実行する
4. 2 つの出力ファイルが段階的に生成されることを確認する
5. ステップ 1 または入力ファイル名に `[fail]` を含めて失敗ケースを確認する
