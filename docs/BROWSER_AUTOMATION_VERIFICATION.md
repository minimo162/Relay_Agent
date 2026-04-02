# Browser Automation Verification

検証日: ___________
検証者: ___________
環境: Windows ___  Edge バージョン: ___  M365 テナント: ___

## 1. セットアップ確認

| 項目 | 期待値 | 実測値 | 合否 |
|---|---|---|---|
| Node.js バージョン | 22 以上 | | |
| Playwright インストール済み | `pnpm --filter @relay-agent/desktop typecheck` が通る | | |
| `scripts/dist/copilot-browser.js` が存在する | ファイル存在 | | |
| Edge 自動接続または自動起動が動く | `{ "status": "ready", "cdpPort": ... }` が返る | | |

確認コマンド:

```bash
node apps/desktop/scripts/dist/copilot-browser.js --action connect --auto-launch
node apps/desktop/scripts/dist/copilot-browser.js --action inspect --auto-launch --prompt "Reply with exactly OK and nothing else."
```

`inspect` の JSON 出力から `selectorProbes`、`responseSelectorProbes`、`suggestedApiPatterns`、`sendProbe.usedSelectors` をこのシートへ転記する。

## 2. 正常フロー検証

### シナリオ A: 自動送信ボタン → レスポンス自動入力

手順:

1. `examples/revenue-workflow-demo.csv` をステップ1で選択
2. テンプレート「列名を変更」を選択して「準備する」
3. ステップ2の「Copilotに自動送信 ▶」ボタンを押す

| 確認項目 | 期待値 | 実測値 | 合否 |
|---|---|---|---|
| ボタン押下後にスピナーが表示される | スピナー表示 | | |
| Copilot レスポンスがテキストエリアに自動入力される | テキストが入る | | |
| 所要時間 | 60秒以内 | ___秒 | |
| 「確認する」ボタンが有効化される | 有効 | | |

### シナリオ B: 保存まで完走

| 確認項目 | 期待値 | 実測値 | 合否 |
|---|---|---|---|
| auto-fix 後に JSON として parse できる | parse 成功 | | |
| バリデーション（Level 1/2/3）が通る | PASS | | |
| SheetDiff カードが表示される | 表示 | | |
| 「保存する」を押して save-copy が生成される | ファイル存在 | | |
| 元の CSV が変更されていない | 未変更 | | |

## 3. エラーケース検証

| シナリオ | 手順 | 期待メッセージ | 実測メッセージ | 合否 |
|---|---|---|---|---|
| CDP 未起動 | Edge を起動せずに送信ボタンを押す | Edge が自動起動される、または接続エラーがわかりやすく表示される | | |
| 未ログイン | Edge でログアウト後に送信ボタンを押す | 「M365 Copilot にログインしていません…」 | | |
| 全ポート使用中 | 9333-9342 を別プロセスで占有して送信ボタンを押す | 「ポート 9333-9342 がすべて使用中です。」 | | |
| 手動フォールバック | エラー後に「手動入力に切り替え」リンクを押す | テキストエリアにフォーカスが当たる | | |

## 4. セレクタ確認結果

まず `--action inspect` の JSON を記録し、必要に応じて playwright codegen / DevTools で裏取りする:

| 項目 | `inspect` 出力 | 裏取り結果 |
|---|---|---|
| `selectorProbes` | | |
| `responseSelectorProbes` | | |
| `sendProbe.usedSelectors` | | |
| `suggestedApiPatterns` | | |

最終的に採用する実際の値:

| 定数名 | 確認した実際の値 | 更新要否 |
|---|---|---|
| `NEW_CHAT_SELECTOR` | | |
| `EDITOR_SELECTOR` | | |
| `SEND_READY_SEL` | | |
| `RESPONSE_SEL` | | |
| `API_URL_PATTERN` | | |

## 5. 総合判定

| 項目 | 判定 |
|---|---|
| 正常フロー | PASS / FAIL |
| エラーハンドリング | PASS / FAIL |
| セレクタ更新要否 | 要 / 不要 |

備考・追加アクション:

____________________________________________________________

____________________________________________________________

____________________________________________________________
