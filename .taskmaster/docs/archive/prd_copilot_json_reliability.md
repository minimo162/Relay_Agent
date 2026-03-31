# Copilot JSON やりとり信頼性改善 PRD

Date: 2026-03-31
Revision: 1

## 現状の問題

Copilot とのJSON やりとりが失敗するケースが頻発している。主な原因は以下の通り。

### 1. 依頼テキストにワークブック列情報がない

Copilot に渡す依頼テキスト（ステップ2でコピーする文章）に、対象ファイルの列名が含まれていない。
そのため Copilot が列名を推測し、実際のカラムと異なる名前を JSON に記述してしまう。

例：
- 実際の列名: `approved`, `amount`, `posted_on`
- Copilot が返す: `"column": "Approved"`, `"predicate": "[approval_flag] == true"`

### 2. auto-fix が対応できていないケース

現在の auto-fix（7種類）で拾えない変形が複数ある：

- **スマートクォート** — `"` `"` `'` `'`（Word や IME 補完で混入）
- **JSON ブロック前後の prose** — 「以下がJSONです：」「以上になります。」など Copilot が説明文を前後に付ける
- **全角スペース・全角記号** — キー名や値に全角文字が混入
- **ネストされた markdown フェンス** — ` ```json ` の代わりに ` ~~~json ` を使うケース

### 3. `outputPath` がプレースホルダーのまま

依頼テキスト内の回答例と回答テンプレートで `outputPath` が `/absolute/path/output.copy.csv` というプレースホルダーになっている。
Copilot がこれを文字通り使って `/absolute/path/reviewed-output.copy.csv` などを返し、実行時にパスエラーになる。

### 4. 回答テンプレートがやりたいことと無関係

`expectedResponseTemplate` が `filter_rows` + `save_copy` 固定のため、ユーザーが「列名を変更したい」（rename_columns）や「型を変換したい」（cast_columns）を選んでいても、関係のないテンプレートが表示される。
Copilot が「なぜ filter_rows の例があるのに rename_columns を使わなければならないのか」と混乱し、例をそのまま流用してしまう。

### 5. 修正依頼プロンプトが弱い

バリデーション失敗時に「修正を依頼するテキストをコピー」ボタンで生成されるプロンプトが：
- 失敗箇所のパス（`actions[0].args.column`）のみで、どう直せばよいかを示していない
- `expectedResponseTemplate` を含むが実際のエラーとテンプレートの対応が分かりにくい
- Level 1（JSON 構文エラー）と Level 2/3（スキーマエラー）で同じ文章が使われている

---

## ゴール

Copilot が初回で正しい JSON を返す確率を高め、失敗時もユーザーが1回のやり直しで通過できるようにする。

---

## 改善仕様

### 改善 A: 依頼テキストへのカラム情報埋め込み

**対象ファイル:** `apps/desktop/src/routes/+page.svelte`、`apps/desktop/src-tauri/src/storage.rs`

セッション作成時（「準備する」ボタン押下後）に `workbook.inspect` を呼び出し、シート名とカラム名の一覧を取得する。
`buildCopilotInstructionText` の「2. 対象ファイル」セクションに以下を追加する：

```
2. 対象ファイル
- ファイル: /path/to/data.csv
- シート: Sheet1
- 列（使える名前をそのまま使うこと）:
  - id (integer)
  - name (string)
  - amount (number)
  - approved (boolean)
  - posted_on (date)
```

カラム数が多い場合（20列超）は最初の20列と `（他 N 列）` を表示。

**変更箇所:**
- `handleStep1` 内でセッション作成後に `inspectWorkbook` を追加で呼び出す
- `buildCopilotInstructionText` 引数に `WorkbookProfile | null` を追加
- 「2. 対象ファイル」セクションにシート・列情報を含める

### 改善 B: `outputPath` 推奨値の自動生成

**対象ファイル:** `apps/desktop/src/routes/+page.svelte`

依頼テキストの回答テンプレートと回答例に含まれる `outputPath` を、入力ファイルパスから自動生成した推奨値に差し替える。

生成ルール:
- 入力: `/Users/you/data.csv`
- 出力: `/Users/you/data.copy.csv`
- 入力: `/Users/you/report.xlsx`
- 出力: `/Users/you/report.copy.xlsx`

`buildCopilotInstructionText` の中でテンプレートと例の `outputPath` に推奨値を埋め込む。
ユーザーが任意のパスに変更しても動作するよう、バリデーションは「入力と同一パスでないこと」のみ。

### 改善 C: テンプレートに対応した回答例の追加

**対象ファイル:** `apps/desktop/src/routes/+page.svelte`

現在は回答例が `filter_rows` + `save_copy` 固定。
選択されたテンプレート（`objectiveKey`）に応じて回答例を切り替える。

| テンプレートキー | 回答例に使うツール |
|---|---|
| `rename_columns` | `table.rename_columns` + `workbook.save_copy` |
| `cast_columns` | `table.cast_columns` + `workbook.save_copy` |
| `filter_rows` | `table.filter_rows` + `workbook.save_copy` |
| `derive_column` | `table.derive_column` + `workbook.save_copy` |
| `group_aggregate` | `table.group_aggregate` + `workbook.save_copy` |
| `(custom)` | `table.filter_rows` + `workbook.save_copy`（現状維持） |
| `(サンプルCSV)` | 既存の revenue-workflow-demo 例を維持 |

各例には実際に使えそうな具体的なダミー値を使う（`"column": "your_column"` ではなく `"column": "amount"` など）。

### 改善 D: auto-fix の強化

**対象ファイル:** `apps/desktop/src/lib/auto-fix.ts`

以下の変換を追加する（既存7種に追加）：

1. **スマートクォート正規化** — `"` `"` → `"` / `'` `'` → `'`
   - 対象: JSON 全体の文字列を正規表現で置換
   - 修正メッセージ: `スマートクォートを修正しました`

2. **JSON ブロック抽出** — 先頭の `{` から対応する `}` を抽出（prose の除去）
   - 適用条件: 文字列が `{` で始まらない && `{` が含まれる
   - ネスト深度を追跡して正確にペアを見つける
   - 修正メッセージ: `JSON ブロック前後の余分なテキストを除去しました`

3. **全角スペースの除去** — `　`（U+3000）をスペースに変換
   - 適用条件: 全角スペースが含まれる場合
   - 修正メッセージ: `全角スペースを修正しました`

4. **`~~~` フェンス対応** — ` ~~~json ` / ` ~~~ ` も markdown fence として除去
   - 既存の markdown fence 除去ロジックを拡張

### 改善 E: Level 別修正依頼プロンプトの強化

**対象ファイル:** `apps/desktop/src/routes/+page.svelte`（`buildRetryPrompt` 関数）

Level ごとに異なる修正依頼を生成する。

**Level 1（JSON 構文エラー）:**
```
先ほどの回答は JSON として読めませんでした。
エラー箇所: {specificError}

JSON を返すときのルール:
1. ``` で囲まない
2. 説明文を前後に付けない（JSON だけを返す）
3. カンマや引用符の閉じ忘れを確認する
4. 以下のテンプレートをそのまま使って返してください:
{template}
```

**Level 2（スキーマエラー）:**
```
先ほどの回答は形式が合っていませんでした。
問題箇所: {path} — {message}

修正のヒント:
- version / summary / actions をすべて含めてください
- actions は配列（[...]）にしてください
- 各 action に tool と args を含めてください

以下のテンプレートで返してください:
{template}
```

**Level 3（ツールエラー）:**
```
先ほどの回答で使われた tool 名が正しくありません。
問題: {specificError}

使える tool（この名前をそのまま使ってください）:
{allowedTools}

以下のテンプレートで返してください:
{template}
```

---

## 非ゴール

- Copilot API との直接接続（手動リレー方式を維持）
- バックエンド（Rust）の IPC インターフェース変更
- JSON スキーマ（contracts）の変更
- XLSX write 実行の実装

---

## 技術的制約

- フロントエンド（SvelteKit）のみの変更で A / B / C / D / E を実現する
- `workbook.inspect` は既存 IPC コマンドをそのまま使う
- `auto-fix.ts` は純粋関数（副作用なし）を維持する
- テンプレート例のダミー値は汎用的な列名（`amount`, `name`, `category`）を使う

---

## 受け入れ条件

- `svelte-check` 0 errors、`vite build` 成功
- auto-fix テスト（auto-fix.test.ts）がすべて通る（新規テストケース追加）
- サンプル CSV でステップ1を完了すると依頼テキストに列名が表示される
- 依頼テキストの `outputPath` が `/absolute/path/...` でなく実際のパスベースになっている
- `filter_rows` テンプレート選択時に `filter_rows` の回答例が表示される
- スマートクォートを含む JSON が auto-fix で正しく修正される
- Level 1/2/3 で異なる修正依頼プロンプトが生成される
