# Codex プロンプト — Windows E2E テスト修正

## 背景

Windows 環境での `cargo test` と `workflow:test` の実行で 3 件の問題が発見された。
本プロンプトで修正し、CODEX_PROMPT_E2E_WINDOWS.md で要求されていた
テストインフラも合わせて実装する。

---

## Fix 1: MCP stdio コマンドの Windows パス解釈バグ

### 問題

`apps/desktop/src-tauri/src/mcp_client.rs:232` の `spawn_stdio_session()` が
`shell_words::split()` でコマンド文字列を分割している。

```rust
// 現状
let argv = shell_words::split(&config.url)
    .map_err(|error| format!("failed to parse MCP stdio command: {error}"))?;
```

`shell_words` は POSIX シェルのパーサーで、バックスラッシュをエスケープ文字として扱う。
Windows のパス（`C:\Users\...`）を含むコマンド文字列を渡すと、
バックスラッシュが消費されてパスが壊れ、子プロセスが即終了する。

テストの失敗箇所:
```rust
// mcp_client.rs のテスト
let config = McpServerConfig {
    url: format!("node {}", script_path.display()),  // Windows では "node C:\Temp\..."
    ...
};
```

### 修正

#### `apps/desktop/src-tauri/src/mcp_client.rs`

`spawn_stdio_session()` を修正:

```rust
fn spawn_stdio_session(config: &McpServerConfig) -> Result<StdioSession, String> {
    // Windows 対応: バックスラッシュを shell_words に通さず
    // OS ネイティブのコマンド実行を使う
    #[cfg(target_os = "windows")]
    let (program, args) = {
        // Windows では cmd /C でコマンド文字列をそのまま渡す
        ("cmd".to_string(), vec!["/C".to_string(), config.url.clone()])
    };

    #[cfg(not(target_os = "windows"))]
    let (program, args) = {
        let argv = shell_words::split(&config.url)
            .map_err(|error| format!("failed to parse MCP stdio command: {error}"))?;
        let mut iter = argv.into_iter();
        let prog = iter
            .next()
            .ok_or_else(|| "MCP stdio command was empty".to_string())?;
        (prog, iter.collect::<Vec<_>>())
    };

    let mut child = Command::new(&program)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to spawn MCP stdio command `{}`: {}", program, error))?;

    // ... 以降は変更なし
```

#### テストの Windows パス対応

テスト内で `config.url` を組み立てる箇所も修正:

```rust
// Before
url: format!("node {}", script_path.display()),

// After
#[cfg(target_os = "windows")]
let url = format!("node \"{}\"", script_path.display());
#[cfg(not(target_os = "windows"))]
let url = format!("node {}", script_path.display());

// ... そして
url,
```

`discovers_and_calls_mcp_tools_over_stdio` と
`reuses_stdio_session_for_multiple_requests` の両テストに適用する。

---

## Fix 2: `workflow:test` の Windows での Xvfb 無条件起動

### 問題

`apps/desktop/scripts/launch_workflow_smoke.mjs:66` が
OS に関わらず常に `Xvfb` を起動しようとする。
Windows では `Xvfb` が存在しないため `spawn Xvfb ENOENT` で即クラッシュする。

### 修正

**`apps/desktop/scripts/launch_workflow_smoke.mjs`** を修正:

```js
import os from "node:os";

const isWindows = os.platform() === "win32";

// Xvfb は Linux/macOS のみ起動
const xvfb = isWindows
  ? null
  : startProcess("Xvfb", [display, "-screen", "0", "1280x840x24", "-ac"], {
      cwd: process.cwd()
    });

// Xvfb の生存チェックも条件付きに
if (!isWindows) {
  await delay(1_500);
  if (xvfb.child.exitCode !== null) {
    summary.reason = `Xvfb exited early: ${xvfb.readLogs().trim() || "unknown error"}`;
    console.log(JSON.stringify(summary));
    process.exit(1);
  }
}
```

また `stopProcess(xvfb)` を呼んでいる `finally` ブロックも条件付きにする:

```js
} finally {
  if (!isWindows && xvfb) {
    stopProcess(xvfb);
  }
  // ...
}
```

`findAvailableDisplay()` の呼び出しも Windows では不要なので条件付きにする:

```js
const display = isWindows ? null : findAvailableDisplay();
```

`DISPLAY` 環境変数のセットも Linux のみに限定する（既存コードで設定している場合）。

同様の修正を `apps/desktop/scripts/launch_tauri_smoke.mjs` にも適用する。

---

## Fix 3: テストインフラの実装

CODEX_PROMPT_E2E_WINDOWS.md で要求されていた 3 つのファイルを作成する。

### 3-A: `apps/desktop/src-tauri/src/integration_tests.rs`

`#[cfg(test)]` モジュールを含む新規ファイルを作成する。
`apps/desktop/src-tauri/src/lib.rs` に `#[cfg(test)] mod integration_tests;` を追加する。

テスト対象（各テストは `tempfile` クレートで一時ディレクトリを使用）:

**Phase 7 — ファイル操作:**

```rust
use std::fs;
use tempfile::tempdir;

// file_copy_creates_destination_and_keeps_source
// file_move_removes_source
// file_delete_removes_target  (recycle=false)
// text_search_returns_matching_lines
// text_replace_modifies_content_and_creates_backup
```

**Phase 8 — プロジェクト管理:**

```rust
// project_crud_roundtrip
//   AppStorage::default() → create_project → read_project → update_project
//   各 step で期待値が一致すること

// project_scope_rejects_out_of_scope_path
//   storage::is_within_project_scope(root, out_of_scope_path) == false

// project_scope_accepts_in_scope_path
//   storage::is_within_project_scope(root, in_scope_path) == true

// project_memory_add_then_remove
//   add_project_memory → memory.len() == 1
//   remove_project_memory → memory.len() == 0
```

**Phase 9 — ツールレジストリ:**

```rust
// tool_registry_has_at_least_21_builtin_tools
//   ToolRegistry::new().list().len() >= 21

// disabled_tool_returns_error
//   registry.set_enabled("workbook.inspect", false)
//   registry.invoke("workbook.inspect", ...) → Err containing "disabled"

// mcp_tool_returns_delegation_error
//   register_mcp_tools 後に registry.invoke("mcp.*") → Err containing "invoke_mcp_tool"

// parse_mcp_tool_name_validation
//   "invalid" → Err
//   "mcp.s" → Err (セグメント不足)
//   "mcp.server.tool" → Ok("tool")
```

**Phase 10 — 品質バリデーター:**

品質バリデーターのテストは既存の `#[cfg(test)]` に追加済みのものを維持する。
`integration_tests.rs` には重複させず、カバーされていない
「複数フォーマット出力」の検証のみ追加する:

```rust
// multi_format_output_produces_expected_files
//   OutputFormat::Csv と OutputFormat::Xlsx を同一変換から生成
//   (XLSX 書き込みが未実装の場合は #[ignore] でマーク)
```

**注意:** `AppStorage` の初期化は `AppStorage::new_for_test(temp_dir.path())` のような
ヘルパーを使うか、既存のテストコードを参照して適切な初期化方法を使うこと。

---

### 3-B: `apps/desktop/scripts/e2e_windows_smoke.mjs`

`apps/desktop/scripts/tauri_smoke_shared.mjs` の共通関数を再利用して作成:

```js
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  fetchFrontendReady,
  startProcess,
  stopProcess,
  waitForJsonFile
} from "./tauri_smoke_shared.mjs";

// Windows 固有: Xvfb なし、DISPLAY なし
// 環境変数 RELAY_USE_BUILD=1 でビルド済み .exe を使用
// デフォルトは tauri:dev

const isWindows = os.platform() === "win32";
const useBuild = process.env.RELAY_USE_BUILD === "1";

async function main() {
  const summary = {
    scenario: "windows-smoke",
    status: "failed",
    platform: process.platform,
    frontendReady: false,
    launchMode: useBuild ? "release-binary" : "tauri-dev",
    reason: ""
  };

  try {
    // ビルド済みバイナリ or tauri:dev を起動
    // 10 秒以内にフロントエンドが応答すること
    // 5 秒間異常終了しないこと
    // ...（launch_tauri_smoke.mjs を参考に実装）
    summary.status = "passed";
    summary.frontendReady = true;
  } catch (error) {
    summary.reason = String(error);
  }

  console.log(JSON.stringify(summary));
  process.exit(summary.status === "passed" ? 0 : 1);
}

main();
```

**`apps/desktop/package.json` の `scripts` に追加:**

```json
"e2e:windows": "node ./scripts/e2e_windows_smoke.mjs"
```

---

### 3-C: `docs/E2E_WINDOWS_MANUAL_CHECKLIST.md`

CODEX_PROMPT_E2E_WINDOWS.md の「Task 3: 手動チェックリスト」セクションの内容を
そのまま独立した Markdown ファイルとして作成する。

---

## `Cargo.toml` への `tempfile` 追加

`integration_tests.rs` で一時ディレクトリを使用するため、
`apps/desktop/src-tauri/Cargo.toml` の `[dev-dependencies]` に追加:

```toml
[dev-dependencies]
tempfile = "3"
```

`tempfile` クレートがすでに存在する場合は追加不要。

---

## 検証チェックリスト

- [ ] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` が全 64 件以上パスすること
  - 特に `mcp_client::tests::discovers_and_calls_mcp_tools_over_stdio`
  - 特に `mcp_client::tests::reuses_stdio_session_for_multiple_requests`
  - 特に `storage::tests::persists_tool_settings_and_restores_mcp_tools_after_reload`
- [ ] `pnpm -C packages/contracts build` がパスすること
- [ ] `pnpm -C apps/desktop exec node scripts/e2e_windows_smoke.mjs` が
      Linux 環境でも終了コード 0 で完了すること（Windows 固有処理は適切にスキップ）
- [ ] `workflow:test` / `launch:test` が Linux で引き続き動作すること（Xvfb 分岐のリグレッションなし）
- [ ] Windows 環境で `workflow:test` が `Xvfb ENOENT` なく実行されること
