# Codex プロンプト 18-FIX — Artifact Output 修正（Tasks 160–163 フォロー）

## 背景

CODEX_PROMPT_18 の実装レビューで以下の問題が見つかった。
本プロンプトでこれらを修正する。

---

## Fix 1: quality_validator.rs の素朴な CSV パース修正

### 問題

`count_empty_ratio()` と `check_csv_injection()` が `line.split(',')` で CSV を分割している。
引用符付きフィールド（例: `"value,with,commas"`）を含む CSV では誤動作する:

```rust
// 現状（危険）: "hello,world","test" を 3 セルとカウント
for cell in line.split(',') { ... }
```

### 修正

**`apps/desktop/src-tauri/src/quality_validator.rs`** に `split_csv_line()` ヘルパーを追加し、
`split(',')` を置き換える:

```rust
/// RFC 4180 準拠の簡易 CSV 行分割（引用符付きフィールド対応）
fn split_csv_line(line: &str) -> Vec<&str> {
    let mut fields = Vec::new();
    let mut start = 0;
    let mut in_quotes = false;
    let bytes = line.as_bytes();

    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'"' => in_quotes = !in_quotes,
            b',' if !in_quotes => {
                fields.push(&line[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    fields.push(&line[start..]);
    fields
}
```

`count_empty_ratio()` と `check_csv_injection()` の `line.split(',')` を
`split_csv_line(line)` に置き換える:

```rust
// Before
for cell in line.split(',') {

// After
for cell in split_csv_line(line) {
```

**テスト追加:**

```rust
#[test]
fn test_split_csv_line_quoted() {
    let line = r#""hello,world","test","","val""#;
    let fields = split_csv_line(line);
    assert_eq!(fields.len(), 4);
    assert_eq!(fields[0], r#""hello,world""#);
    assert_eq!(fields[2], r#""""#);  // 空フィールド
}

#[test]
fn test_split_csv_line_plain() {
    let fields = split_csv_line("a,b,,d");
    assert_eq!(fields.len(), 4);
    assert_eq!(fields[2], "");  // 空フィールド
}
```

---

## Fix 2: 大容量ファイルの読み込み上限追加

### 問題

`count_rows()` と `count_empty_ratio()` と `check_csv_injection()` が
`fs::read_to_string()` でファイル全体をメモリに読み込む。
大容量 CSV（数百 MB 〜 GB 級）で OOM が発生しうる。

### 修正

**`apps/desktop/src-tauri/src/quality_validator.rs`** に定数とサンプリング読み込みを追加:

```rust
/// 品質チェックのサンプリング上限（バイト）
const MAX_QUALITY_CHECK_BYTES: u64 = 10 * 1024 * 1024; // 10 MB

/// ファイルをサンプリング読み込み（上限 MAX_QUALITY_CHECK_BYTES バイト）
/// 上限に達した場合は truncated = true を返す
fn read_sample(path: &str) -> Result<(String, bool), String> {
    use std::io::Read;
    let file = std::fs::File::open(path)
        .map_err(|e| format!("failed to open '{}': {}", path, e))?;
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let truncated = size > MAX_QUALITY_CHECK_BYTES;

    let mut reader = std::io::BufReader::new(file.take(MAX_QUALITY_CHECK_BYTES));
    let mut content = String::new();
    reader
        .read_to_string(&mut content)
        .map_err(|e| format!("failed to read '{}': {}", path, e))?;

    Ok((content, truncated))
}
```

`count_rows()`・`count_empty_ratio()`・`check_csv_injection()` で
`fs::read_to_string()` を `read_sample()` に置き換える。
`truncated == true` の場合は `QualityCheckResult.warnings` に以下を追加:

```
"ファイルが大きいため先頭 10MB のみを検査しました（実際のファイルサイズ: X MB）"
```

**`validate_output_quality()` のシグネチャ変更なし**。warnings に追記するだけ。

---

## Fix 3: ターン詳細インスペクションでアーティファクトプレビューを表示

### 問題

`+page.svelte` のターン詳細インスペクション画面で
`execution.outputArtifactId` が表示されるだけで、実際のアーティファクトコンテンツが
表示されない。

### 修正

**`apps/desktop/src/routes/+page.svelte`** のターン詳細表示部分を更新する。

`readTurnArtifacts` IPC を呼び出した結果（`turnInspectionArtifacts`）は既に存在するので、
インスペクション表示部分でアーティファクトが存在すれば `ArtifactPreview` を表示する:

```svelte
<!-- ターン詳細インスペクション内の execution セクションに追加 -->
{#if turnInspectionArtifacts.length > 0}
  <div class="inspection-artifacts">
    <h4 class="inspection-section-label">出力アーティファクト</h4>
    <ArtifactPreview artifacts={turnInspectionArtifacts} />
  </div>
{:else if turnInspectionDetails?.execution?.outputArtifactId}
  <p class="inspection-detail-value muted">
    アーティファクト ID: {turnInspectionDetails.execution.outputArtifactId}
  </p>
{/if}
```

`ArtifactPreview` が既にインポートされていることを確認し、なければ追加:

```svelte
import ArtifactPreview from "$lib/components/ArtifactPreview.svelte";
```

---

## 検証チェックリスト

- [ ] `cargo build` がエラーなくパス
- [ ] `pnpm -C packages/contracts build` がパス
- [ ] 引用符付きカンマ（`"a,b",c`）の CSV で空値率チェックが正しく動作する
- [ ] 引用符付きカンマを含む CSV で CSV インジェクションチェックが誤検知しない
- [ ] 10MB 超ファイルでサンプリング警告が表示される
- [ ] 10MB 以下ファイルでは従来通りフルチェックされる
- [ ] ターン詳細インスペクションでアーティファクトプレビューが表示される
